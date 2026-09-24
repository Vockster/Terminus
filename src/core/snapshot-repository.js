import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_ERROR_MESSAGES,
  SNAPSHOT_KINDS,
  SETTINGS_BACKUP_KINDS,
  SnapshotError,
  createDefaultSnapshotIndex,
  createDefaultSnapshotScheduleState,
  migrateSnapshotScheduleState,
  parseRestoreJournal,
  parseSnapshotRestoreReport,
  parseSnapshotIndex,
  parseSnapshotScheduleState,
  serializeBackup,
  snapshotIndexEntry,
  verifySettingsBackup,
  verifySnapshotRecord
} from "../contracts/snapshots.js";
import { selectAutomaticRemovals } from "./automatic-retention-policy.js";

const SETTINGS_BACKUP_ID_PATTERN = /^settings-backup-[a-z0-9][a-z0-9-]{0,127}$/;

function automaticIndexEntries(index, protectedSnapshotId = null) {
  return index.entries.filter(({ id, kind }) => (
    kind === SNAPSHOT_KINDS.AUTOMATIC && id !== protectedSnapshotId
  ));
}

function storageUnavailable(cause) {
  return new SnapshotError(
    SNAPSHOT_ERROR_CODES.STORAGE_UNAVAILABLE,
    SNAPSHOT_ERROR_MESSAGES[SNAPSHOT_ERROR_CODES.STORAGE_UNAVAILABLE],
    { cause }
  );
}

function notFound() {
  return new SnapshotError(SNAPSHOT_ERROR_CODES.NOT_FOUND);
}

function summary(entry, protectedSnapshotId = null) {
  return {
    id: entry.id,
    kind: entry.kind,
    createdAt: entry.createdAt,
    payloadDigest: entry.payloadDigest,
    byteLength: entry.byteLength,
    hasExport: entry.downloadIds.length > 0,
    protected: entry.id === protectedSnapshotId
  };
}

function settingsBackupSummary(id, backup) {
  return {
    id,
    kind: backup.backupKind,
    reason: backup.reason,
    createdAt: backup.createdAt,
    payloadDigest: backup.payloadDigest,
    byteLength: new TextEncoder().encode(serializeBackup(backup)).byteLength
  };
}

export class SnapshotRepository {
  #storage;
  #operationTail = Promise.resolve();
  #initialized = false;
  #warnings = [];

  constructor(storage) {
    this.#storage = storage;
  }

  initialize() {
    return this.#enqueue(() => this.#initialize());
  }

  save(record) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const parsed = await verifySnapshotRecord(record);
      if (parsed.kind === SNAPSHOT_KINDS.MASTER) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      const byteLength = new TextEncoder().encode(serializeBackup(parsed)).byteLength;
      const index = await this.#readIndex();
      const existing = index.entries.find((entry) => entry.id === parsed.id);
      if (existing) {
        if (existing.payloadDigest === parsed.payloadDigest) {
          return summary(existing);
        }
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_BACKUP);
      }
      await this.#callStorage(() => this.#storage.writeRecord(parsed));
      const readBack = await this.#callStorage(() => this.#storage.readRecord(parsed.id));
      await verifySnapshotRecord(readBack);
      const entry = snapshotIndexEntry(parsed, { byteLength });
      index.entries = [entry, ...index.entries].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
      );
      await this.#writeIndex(index);
      return summary(entry);
    });
  }

  async get(id) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const value = await this.#callStorage(() => this.#storage.readRecord(id));
      if (value === undefined) {
        throw notFound();
      }
      return verifySnapshotRecord(value);
    });
  }

  list() {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      const schedule = await this.#readScheduleState();
      return {
        records: index.entries.map((entry) => summary(
          entry,
          schedule.startupProtection.snapshotId
        )),
        warnings: [...this.#warnings]
      };
    });
  }

  delete(id) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      const entry = index.entries.find((candidate) => candidate.id === id);
      if (!entry) {
        throw notFound();
      }
      await this.#deleteEntries(index, [entry]);
      await this.#clearStartupProtectionIf(entry.id);
      return { kind: entry.kind, downloadIds: [...entry.downloadIds] };
    });
  }

  clearViewerRecords() {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      const removed = index.entries.filter(({ kind }) =>
        [SNAPSHOT_KINDS.MANUAL, SNAPSHOT_KINDS.AUTOMATIC].includes(kind)
      );
      if (removed.length > 0) {
        await this.#deleteEntries(index, removed);
        const removedIds = new Set(removed.map(({ id }) => id));
        const schedule = await this.#readScheduleState();
        if (removedIds.has(schedule.startupProtection.snapshotId)) {
          await this.#writeScheduleState({
            ...schedule,
            startupProtection: createDefaultSnapshotScheduleState().startupProtection
          });
        }
      }
      return removed.map(summary);
    });
  }

  addDownloadId(id, downloadId) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      const entry = index.entries.find((candidate) => candidate.id === id);
      if (!entry) {
        throw notFound();
      }
      if (!entry.downloadIds.includes(downloadId)) {
        entry.downloadIds.push(downloadId);
        await this.#writeIndex(index);
      }
      return true;
    });
  }

  latestAutomaticDigest() {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      return index.entries.find(({ kind }) => kind === SNAPSHOT_KINDS.AUTOMATIC)?.payloadDigest ?? null;
    });
  }

  downloadIds(kind) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      return index.entries
        .filter((candidate) => candidate.kind === kind)
        .flatMap((candidate) => [...candidate.downloadIds].reverse());
    });
  }

  saveSettingsBackup(id, backup) {
    return this.#enqueue(async () => {
      if (typeof id !== "string" || !SETTINGS_BACKUP_ID_PATTERN.test(id)) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      const verified = await verifySettingsBackup(backup);
      const existing = await this.#callStorage(() => this.#storage.readSettingsBackup(id));
      if (existing !== undefined) {
        const current = await verifySettingsBackup(existing);
        if (current.payloadDigest === verified.payloadDigest) {
          return settingsBackupSummary(id, current);
        }
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_BACKUP);
      }
      await this.#callStorage(() => this.#storage.writeSettingsBackup(id, verified));
      const readBack = await verifySettingsBackup(
        await this.#callStorage(() => this.#storage.readSettingsBackup(id))
      );
      return settingsBackupSummary(id, readBack);
    });
  }

  getSettingsBackup(id) {
    return this.#enqueue(async () => {
      const value = await this.#callStorage(() => this.#storage.readSettingsBackup(id));
      if (value === undefined) {
        throw notFound();
      }
      return verifySettingsBackup(value);
    });
  }

  listSettingsBackups() {
    return this.#enqueue(async () => {
      const records = [];
      for (const candidate of await this.#callStorage(() => this.#storage.listSettingsBackups())) {
        try {
          if (!SETTINGS_BACKUP_ID_PATTERN.test(candidate.id)) {
            continue;
          }
          const backup = await verifySettingsBackup(candidate.value);
          records.push(settingsBackupSummary(candidate.id, backup));
        } catch {
          // Invalid settings records stay isolated and are omitted from the library.
        }
      }
      return records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    });
  }

  deleteSettingsBackup(id) {
    return this.#enqueue(async () => {
      const value = await this.#callStorage(() => this.#storage.readSettingsBackup(id));
      if (value === undefined) {
        throw notFound();
      }
      await verifySettingsBackup(value);
      await this.#callStorage(() => this.#storage.removeSettingsBackup(id));
      return { id };
    });
  }

  latestAutomaticSettingsDigest() {
    return this.listSettingsBackups().then((records) =>
      records.find(({ kind }) => kind === SETTINGS_BACKUP_KINDS.AUTOMATIC)?.payloadDigest ?? null
    );
  }

  applyAutomaticSettingsRetention(rule, now) {
    return this.#enqueue(async () => {
      const removed = selectAutomaticRemovals(await this.#automaticSettingsBackups(), rule, now);
      await Promise.all(removed.map(({ id }) =>
        this.#callStorage(() => this.#storage.removeSettingsBackup(id))
      ));
      return removed;
    });
  }

  previewAutomaticSettingsRetention(rule, now) {
    return this.#enqueue(async () =>
      selectAutomaticRemovals(await this.#automaticSettingsBackups(), rule, now).length
    );
  }

  applyAutomaticRetention(rule, now) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      const schedule = await this.#readScheduleState();
      const removed = selectAutomaticRemovals(
        automaticIndexEntries(index, schedule.startupProtection.snapshotId),
        rule,
        now
      );
      if (removed.length > 0) {
        await this.#deleteEntries(index, removed);
      }
      return removed.map((entry) => ({ ...summary(entry), downloadIds: [...entry.downloadIds] }));
    });
  }

  previewAutomaticRetention(rule, now) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const index = await this.#readIndex();
      const schedule = await this.#readScheduleState();
      return selectAutomaticRemovals(
        automaticIndexEntries(index, schedule.startupProtection.snapshotId),
        rule,
        now
      ).length;
    });
  }

  ensureStartupProtection(protectedAt) {
    return this.#enqueue(async () => {
      await this.#initialize();
      const at = protectedAt instanceof Date ? protectedAt.toISOString() : protectedAt;
      if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      const [index, schedule] = await Promise.all([
        this.#readIndex(),
        this.#readScheduleState()
      ]);
      const existing = index.entries.find(({ id, kind }) => (
        id === schedule.startupProtection.snapshotId && kind === SNAPSHOT_KINDS.AUTOMATIC
      ));
      if (existing) {
        return { ...schedule.startupProtection, created: false };
      }
      const newest = index.entries.find(({ kind }) => kind === SNAPSHOT_KINDS.AUTOMATIC);
      const startupProtection = newest
        ? { snapshotId: newest.id, protectedAt: at }
        : createDefaultSnapshotScheduleState().startupProtection;
      if (JSON.stringify(schedule.startupProtection) !== JSON.stringify(startupProtection)) {
        await this.#writeScheduleState({ ...schedule, startupProtection });
      }
      return { ...startupProtection, created: Boolean(newest) };
    });
  }

  readScheduleState() {
    return this.#enqueue(() => this.#readScheduleState());
  }

  writeScheduleState(value) {
    return this.#enqueue(() => this.#writeScheduleState(value));
  }

  readRestoreJournal() {
    return this.#enqueue(async () => {
      const value = await this.#callStorage(() => this.#storage.readRestoreJournal());
      return value === undefined ? null : parseRestoreJournal(value);
    });
  }

  writeRestoreJournal(value) {
    return this.#enqueue(async () => {
      const parsed = parseRestoreJournal(value);
      await this.#callStorage(() => this.#storage.writeRestoreJournal(parsed));
      return parsed;
    });
  }

  clearRestoreJournal() {
    return this.#enqueue(() => this.#callStorage(() => this.#storage.removeRestoreJournal()));
  }

  readLastRestoreReport() {
    return this.#enqueue(async () => {
      const value = await this.#callStorage(() => this.#storage.readLastRestoreReport());
      return value === undefined ? null : parseSnapshotRestoreReport(value);
    });
  }

  writeLastRestoreReport(report) {
    return this.#enqueue(async () => {
      const safe = parseSnapshotRestoreReport(report);
      await this.#callStorage(() => this.#storage.writeLastRestoreReport(safe));
      return safe;
    });
  }

  readLastSettingsRestoreReport() {
    return this.#enqueue(async () => {
      const value = await this.#callStorage(() => this.#storage.readLastSettingsRestoreReport());
      return value === undefined ? null : parseSnapshotRestoreReport(value);
    });
  }

  writeLastSettingsRestoreReport(report) {
    return this.#enqueue(async () => {
      const safe = parseSnapshotRestoreReport(report);
      if (safe.scope !== "settings") {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      await this.#callStorage(() => this.#storage.writeLastSettingsRestoreReport(safe));
      return safe;
    });
  }

  bytesInUse() {
    return this.#enqueue(() => this.#callStorage(() => this.#storage.bytesInUse()));
  }

  async #initialize() {
    if (this.#initialized) {
      return;
    }
    let index = await this.#readIndex();
    let changed = false;
    for (const id of index.tombstones) {
      await this.#callStorage(() => this.#storage.removeRecord(id));
      changed = true;
    }
    if (index.tombstones.length > 0) {
      index.tombstones = [];
    }

    const warnings = [];
    const legacyMaster = await this.#callStorage(() => this.#storage.readMaster());
    if (legacyMaster !== undefined) {
      try {
        const verified = await verifySnapshotRecord(legacyMaster);
        const converted = await verifySnapshotRecord({
          ...verified,
          kind: SNAPSHOT_KINDS.MANUAL,
          reason: "legacy-master"
        });
        const existing = await this.#callStorage(() => this.#storage.readRecord(converted.id));
        if (existing === undefined) {
          await this.#callStorage(() => this.#storage.writeRecord(converted));
        } else {
          const verifiedExisting = await verifySnapshotRecord(existing);
          if (verifiedExisting.payloadDigest !== converted.payloadDigest) {
            throw new Error("legacy master ID conflicts with a stored snapshot");
          }
        }
        await this.#callStorage(() => this.#storage.removeMaster());
        changed = true;
      } catch {
        warnings.push({ kind: "corrupt-master" });
      }
    }

    const stored = await this.#callStorage(() => this.#storage.listRecords());
    const validById = new Map();
    for (const candidate of stored) {
      try {
        const record = await verifySnapshotRecord(candidate.value);
        if (record.id !== candidate.id || record.kind === SNAPSHOT_KINDS.MASTER) {
          throw new Error("record identity does not match its storage key");
        }
        validById.set(record.id, {
          record,
          migrated: candidate.value?.schemaVersion !== record.schemaVersion
        });
      } catch {
        warnings.push({ kind: "corrupt-record", id: candidate.id });
      }
    }

    const survivingEntries = [];
    for (const entry of index.entries) {
      const storedRecord = validById.get(entry.id);
      if (!storedRecord) {
        warnings.push({ kind: "missing-or-invalid-indexed-record", id: entry.id });
        changed = true;
        continue;
      }
      const rebuilt = snapshotIndexEntry(storedRecord.record, {
        byteLength: new TextEncoder().encode(serializeBackup(storedRecord.record)).byteLength,
        downloadIds: entry.downloadIds
      });
      if (entry.payloadDigest !== rebuilt.payloadDigest && !storedRecord.migrated) {
        warnings.push({ kind: "missing-or-invalid-indexed-record", id: entry.id });
      }
      if (JSON.stringify(entry) !== JSON.stringify(rebuilt)) {
        changed = true;
      }
      survivingEntries.push(rebuilt);
      validById.delete(entry.id);
    }
    for (const { record } of validById.values()) {
      survivingEntries.push(
        snapshotIndexEntry(record, {
          byteLength: new TextEncoder().encode(serializeBackup(record)).byteLength
        })
      );
      changed = true;
    }
    survivingEntries.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    index.entries = survivingEntries;
    if (changed) {
      await this.#writeIndex(index);
    }
    this.#warnings = warnings;
    this.#initialized = true;
  }

  async #automaticSettingsBackups() {
    const records = [];
    for (const candidate of await this.#callStorage(() => this.#storage.listSettingsBackups())) {
      try {
        const backup = await verifySettingsBackup(candidate.value);
        if (backup.backupKind === SETTINGS_BACKUP_KINDS.AUTOMATIC) {
          records.push(settingsBackupSummary(candidate.id, backup));
        }
      } catch {
        // Invalid records are never selected for automatic deletion.
      }
    }
    return records;
  }

  async #deleteEntries(index, entries) {
    const ids = new Set(entries.map(({ id }) => id));
    index.entries = index.entries.filter(({ id }) => !ids.has(id));
    index.tombstones = [...new Set([...index.tombstones, ...ids])];
    await this.#writeIndex(index);
    for (const id of ids) {
      await this.#callStorage(() => this.#storage.removeRecord(id));
    }
    index.tombstones = index.tombstones.filter((id) => !ids.has(id));
    await this.#writeIndex(index);
  }

  async #clearStartupProtectionIf(snapshotId) {
    const schedule = await this.#readScheduleState();
    if (schedule.startupProtection.snapshotId !== snapshotId) return;
    await this.#writeScheduleState({
      ...schedule,
      startupProtection: createDefaultSnapshotScheduleState().startupProtection
    });
  }

  async #readScheduleState() {
    const value = await this.#callStorage(() => this.#storage.readScheduleState());
    if (value === undefined) {
      return createDefaultSnapshotScheduleState();
    }
    const parsed = migrateSnapshotScheduleState(value);
    if (value.schemaVersion !== parsed.schemaVersion) {
      await this.#callStorage(() => this.#storage.writeScheduleState(parsed));
    }
    return parsed;
  }

  async #writeScheduleState(value) {
    const parsed = parseSnapshotScheduleState(value);
    await this.#callStorage(() => this.#storage.writeScheduleState(parsed));
    return parsed;
  }

  async #readIndex() {
    const value = await this.#callStorage(() => this.#storage.readIndex());
    return value === undefined ? createDefaultSnapshotIndex() : parseSnapshotIndex(value);
  }

  async #writeIndex(index) {
    const parsed = parseSnapshotIndex(index);
    await this.#callStorage(() => this.#storage.writeIndex(parsed));
    return parsed;
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.catch(() => undefined);
    return result;
  }

  async #callStorage(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SnapshotError) {
        throw error;
      }
      throw storageUnavailable(error);
    }
  }
}

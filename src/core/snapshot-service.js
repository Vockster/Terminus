import {
  SETTINGS_BACKUP_DOCUMENT_TYPE,
  SETTINGS_BACKUP_KINDS,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_KINDS,
  SnapshotError,
  createSnapshotRecord,
  finalizeSettingsBackup,
  parseBackupText,
  serializeBackup
} from "../contracts/snapshots.js";
import { createDefaultSettingsState } from "../contracts/settings-state.js";
import {
  automaticRetentionRule,
  ordinaryCleanupApplies
} from "./automatic-retention-policy.js";
import {
  settingsBackupExportFilename,
  snapshotExportFilename
} from "./export-filenames.js";

function snapshotFilename(record) {
  return snapshotExportFilename(record);
}

export class SnapshotService {
  #repository;
  #captureService;
  #downloads;
  #clock;
  #idGenerator;
  #operationTail = Promise.resolve();

  constructor({
    repository,
    captureService,
    downloadsAdapter,
    clock = () => new Date(),
    idGenerator
  }) {
    this.#repository = repository;
    this.#captureService = captureService;
    this.#downloads = downloadsAdapter;
    this.#clock = clock;
    this.#idGenerator = idGenerator ?? (() => globalThis.crypto.randomUUID());
  }

  initialize() {
    return this.#repository.initialize();
  }

  createFromInventory(inventory, settings, options = {}) {
    return this.#enqueue(() => this.#createFromInventory(inventory, settings, options));
  }

  async #createFromInventory(
    inventory,
    settings,
    {
      kind = SNAPSHOT_KINDS.MANUAL,
      reason = null,
      download = false,
      saveAs = false,
      force = false
    } = {}
  ) {
    const payload = await this.#captureService.capture(inventory);
    const createdAt = this.#clock().toISOString();
    const record = await createSnapshotRecord({
      id: `snapshot-${this.#idGenerator()}`.toLowerCase(),
      kind,
      createdAt,
      reason,
      payload
    });
    if (
      kind === SNAPSHOT_KINDS.AUTOMATIC &&
      !force &&
      (await this.#repository.latestAutomaticDigest()) === record.payloadDigest
    ) {
      return { created: false, reason: "unchanged", record: null, download: null, removed: [] };
    }

    const stored = await this.#repository.save(record);
    let downloadResult = null;
    if (download) {
      try {
        const downloadId = await this.#downloads.downloadJson({
          text: serializeBackup(record),
          filename: snapshotFilename(record),
          saveAs
        });
        if ([SNAPSHOT_KINDS.AUTOMATIC, SNAPSHOT_KINDS.MANUAL].includes(kind)) {
          await this.#repository.addDownloadId(record.id, downloadId);
        }
        downloadResult = { ok: true, downloadId };
      } catch (error) {
        downloadResult = { ok: false, code: error.code ?? "DOWNLOAD_FAILED" };
      }
    }

    const cleanup = await this.#cleanupAutomatic(settings);
    const removed = cleanup.removed;
    return { created: true, reason: null, record: stored, download: downloadResult, removed };
  }

  cleanupAutomatic(settings) {
    return this.#enqueue(() => this.#cleanupAutomatic(settings));
  }

  async #cleanupAutomatic(settings) {
    if (!ordinaryCleanupApplies(settings)) {
      return { removed: [], removedSettings: [], files: [] };
    }
    const rule = automaticRetentionRule(settings);
    const now = this.#clock();
    const [removed, removedSettings] = await Promise.all([
      this.#repository.applyAutomaticRetention(rule, now),
      this.#repository.applyAutomaticSettingsRetention(rule, now)
    ]);
    return { removed, removedSettings, files: [] };
  }

  // Read-only count of the automatic saves these settings would remove now.
  async previewCleanup(settings) {
    if (!ordinaryCleanupApplies(settings)) {
      return { sidebarSnapshots: 0, settingsBackups: 0 };
    }
    const rule = automaticRetentionRule(settings);
    const now = this.#clock();
    const [sidebarSnapshots, settingsBackups] = await Promise.all([
      this.#repository.previewAutomaticRetention(rule, now),
      this.#repository.previewAutomaticSettingsRetention(rule, now)
    ]);
    return { sidebarSnapshots, settingsBackups };
  }

  async overview() {
    const [
      { records, warnings },
      storageBytes,
      schedule,
      legacyLastRestoreReport,
      storedSettingsRestoreReport,
      downloadsPermission
    ] =
      await Promise.all([
        this.#repository.list(),
        this.#repository.bytesInUse(),
        this.#repository.readScheduleState(),
        this.#repository.readLastRestoreReport(),
        this.#repository.readLastSettingsRestoreReport(),
        this.#downloads.hasPermission()
      ]);
    const settingsBackups = await this.#repository.listSettingsBackups();
    const lastSnapshotRestoreReport =
      legacyLastRestoreReport?.scope === "settings" ? null : legacyLastRestoreReport;
    const lastSettingsRestoreReport =
      storedSettingsRestoreReport ??
      (legacyLastRestoreReport?.scope === "settings" ? legacyLastRestoreReport : null);
    return {
      records,
      warnings,
      storageBytes,
      schedule,
      lastSnapshotRestoreReport,
      lastSettingsRestoreReport,
      settingsBackups,
      downloadsPermission
    };
  }

  get(id) {
    return this.#repository.get(id);
  }

  async openFileLocation(kind) {
    if (![SNAPSHOT_KINDS.MANUAL, SNAPSHOT_KINDS.AUTOMATIC].includes(kind)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    const downloadIds = await this.#repository.downloadIds(kind);
    return this.#downloads.openFileLocation(downloadIds);
  }

  async delete(id) {
    const deleted = await this.#repository.delete(id);
    return { id, kind: deleted.kind, cleanup: [] };
  }

  async clearViewer() {
    const removed = await this.#repository.clearViewerRecords();
    return {
      removed: removed.length,
      manual: removed.filter(({ kind }) => kind === SNAPSHOT_KINDS.MANUAL).length,
      automatic: removed.filter(({ kind }) => kind === SNAPSHOT_KINDS.AUTOMATIC).length
    };
  }

  async export(id, { saveAs = true } = {}) {
    const record = await this.#repository.get(id);
    const downloadId = await this.#downloads.downloadJson({
      text: serializeBackup(record),
      filename: snapshotFilename(record),
      saveAs
    });
    if ([SNAPSHOT_KINDS.AUTOMATIC, SNAPSHOT_KINDS.MANUAL].includes(record.kind)) {
      await this.#repository.addDownloadId(id, downloadId);
    }
    return { id, downloadId };
  }

  saveSettings(settings, options = {}) {
    return this.#enqueue(() => this.#saveSettings(settings, options));
  }

  async #saveSettings(
    settings,
    { kind = SETTINGS_BACKUP_KINDS.MANUAL, force = false } = {}
  ) {
    const createdAt = this.#clock().toISOString();
    const backup = await finalizeSettingsBackup({
      createdAt,
      settings,
      kind
    });
    if (
      kind === SETTINGS_BACKUP_KINDS.AUTOMATIC &&
      !force &&
      (await this.#repository.latestAutomaticSettingsDigest()) === backup.payloadDigest
    ) {
      return { created: false, reason: "unchanged", record: null };
    }
    const id = `settings-backup-${this.#idGenerator()}`.toLowerCase();
    const record = await this.#saveSettingsBackup(id, backup);
    // Like an automatic snapshot, an automatic backup enforces the maximum at once.
    const removed = kind === SETTINGS_BACKUP_KINDS.AUTOMATIC
      ? (await this.#cleanupAutomatic(settings)).removedSettings
      : [];
    return {
      created: true,
      reason: null,
      record,
      documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
      removed
    };
  }

  async exportSettings(id) {
    const backup = await this.#repository.getSettingsBackup(id);
    const exported = await finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: this.#fullSettings(backup.payload.settings),
      kind: backup.backupKind,
      reason: backup.reason
    });
    const downloadId = await this.#downloads.downloadJson({
      text: serializeBackup(exported),
      filename: settingsBackupExportFilename(backup),
      saveAs: true
    });
    return { id, createdAt: backup.createdAt, downloadId, documentType: SETTINGS_BACKUP_DOCUMENT_TYPE };
  }

  getSettings(id) {
    return this.#repository.getSettingsBackup(id);
  }

  deleteSettings(id) {
    return this.#repository.deleteSettingsBackup(id);
  }

  async importSettingsText(text) {
    const parsed = await parseBackupText(text);
    if (parsed.kind !== "settings") {
      throw new SnapshotError(
        SNAPSHOT_ERROR_CODES.INVALID_BACKUP,
        "This is a Terminus snapshot. Import settings backups from Snapshots > Settings Backups."
      );
    }
    const id = `settings-backup-${this.#idGenerator()}`.toLowerCase();
    // A file import is an explicit user action, so it belongs to protected
    // manual history even when the exported source was automatic. Otherwise
    // the next retention pass can silently delete the imported copy.
    const local = await this.#localizeSettingsBackup(parsed.document, {
      kind: SETTINGS_BACKUP_KINDS.MANUAL,
      reason: null
    });
    const record = await this.#saveSettingsBackup(id, local);
    return { record };
  }

  async previewText(text) {
    const parsed = await parseBackupText(text);
    if (parsed.kind === "settings") {
      return {
        kind: parsed.kind,
        createdAt: parsed.document.createdAt,
        workspaceCount: 0,
        tabCount: 0,
        document: parsed.document
      };
    }
    return {
      kind: parsed.kind,
      createdAt: parsed.document.createdAt,
      workspaceCount: parsed.document.payload.workspaceState.workspaces.length,
      tabCount: parsed.document.payload.windows.reduce(
        (total, window) =>
          total + window.workspaceLayouts.reduce((count, layout) => count + layout.tabs.length, 0),
        0
      ),
      document: parsed.document
    };
  }

  parseText(text) {
    return parseBackupText(text);
  }

  async prepareSettingsBackupForRestore(document) {
    return this.#localizeSettingsBackup(document);
  }

  async importSnapshotText(text) {
    const parsed = await parseBackupText(text);
    if (parsed.kind !== "snapshot") {
      return parsed;
    }
    const document = await createSnapshotRecord({
      id: `snapshot-${this.#idGenerator()}`.toLowerCase(),
      kind: SNAPSHOT_KINDS.MANUAL,
      createdAt: parsed.document.createdAt,
      reason: parsed.document.kind === SNAPSHOT_KINDS.MASTER ? "legacy-master-import" : "file-import",
      payload: parsed.document.payload
    });
    const record = await this.#repository.save(document);
    return { kind: parsed.kind, record };
  }

  async #localizeSettingsBackup(document, {
    kind = document.backupKind,
    reason = document.reason
  } = {}) {
    const parsed = await this.parseText(serializeBackup(document));
    if (parsed.kind !== "settings") {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_BACKUP);
    }
    return finalizeSettingsBackup({
      createdAt: parsed.document.createdAt,
      settings: this.#fullSettings(parsed.document.payload.settings),
      kind,
      reason
    });
  }

  #saveSettingsBackup(id, backup) {
    return this.#repository.saveSettingsBackup(id, backup);
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.catch(() => undefined);
    return result;
  }

  #fullSettings(projection) {
    const defaults = createDefaultSettingsState();
    return {
      ...defaults,
      sidebar: projection.sidebar,
      appearance: projection.appearance,
      snapshots: projection.snapshots,
      navigation: projection.navigation,
      privacy: projection.privacy
    };
  }
}

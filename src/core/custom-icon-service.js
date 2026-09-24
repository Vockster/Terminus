import {
  CUSTOM_ICON_CHANGES,
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_LIMITS,
  CustomIconError,
  createCustomIconId,
  customIconSummary,
  digestCustomIconBytes,
  parseCustomIconCompatibilityRecord,
  parseCustomIconRecord,
  parseCustomIconSource,
  isCustomIconId,
  parseCustomIconLabel,
  validateCustomIconPng
} from "../contracts/custom-icons.js";
import { FALLBACK_WORKSPACE_ICON } from "../contracts/workspace-icons.js";

function usageOf(icons) {
  return {
    iconCount: icons.length,
    byteCount: icons.reduce(
      (total, icon) => total + icon.byteLength + (icon.source?.byteLength ?? 0),
      0
    )
  };
}

export class CustomIconService {
  #storage;
  #decoder;
  #workspaceStateService;
  #onChanged;
  #clock;
  #randomUUID;
  #operationExecutor;
  #operationTail = Promise.resolve();

  constructor({
    storage,
    decoder,
    workspaceStateService,
    onChanged = async () => undefined,
    clock = () => new Date(),
    randomUUID = () => globalThis.crypto.randomUUID(),
    operationExecutor = null
  }) {
    this.#storage = storage;
    this.#decoder = decoder;
    this.#workspaceStateService = workspaceStateService;
    this.#onChanged = onChanged;
    this.#clock = clock;
    this.#randomUUID = randomUUID;
    this.#operationExecutor = operationExecutor;
  }

  async list() {
    const icons = await this.#storage.list();
    return { icons: icons.map(customIconSummary), usage: usageOf(icons) };
  }

  async listForExport() {
    const icons = (await this.#storage.list()).map((icon) => parseCustomIconRecord(icon));
    return { icons, usage: usageOf(icons) };
  }

  async snapshotCompatibility() {
    const [icons, compatibility] = await Promise.all([
      this.#storage.list(),
      this.#storage.listCompatibility()
    ]);
    return Object.freeze({
      icons: Object.freeze(icons.map(({ id, digest }) => Object.freeze({ id, digest }))),
      compatibility: Object.freeze(compatibility.map((record) =>
        parseCustomIconCompatibilityRecord(record)
      ))
    });
  }

  stats() {
    return this.#storage.stats();
  }

  add(rawLabel, rawBytes, rawSource = null, options = {}) {
    return this.#storeIcon(rawLabel, rawBytes, rawSource, options, false);
  }

  importIcon(rawLabel, rawBytes, rawSource = null, options = {}) {
    return this.#storeIcon(rawLabel, rawBytes, rawSource, options, true);
  }

  #storeIcon(
    rawLabel,
    rawBytes,
    rawSource,
    { preferredId = null, executorLease = null } = {},
    includeRollback
  ) {
    return this.#runMutation(executorLease, async () => {
      const label = parseCustomIconLabel(rawLabel);
      const bytes = validateCustomIconPng(rawBytes);
      if (preferredId !== null && !isCustomIconId(preferredId)) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
      }
      // Retained only when it is small and of a listed type; anything else
      // leaves the icon with its normalized PNG alone.
      const source = parseCustomIconSource(rawSource);
      const { width, height } = await this.#decoder.measure(bytes);
      if (width !== CUSTOM_ICON_LIMITS.size || height !== CUSTOM_ICON_LIMITS.size) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE);
      }
      const digest = await digestCustomIconBytes(bytes);
      const existing = await this.#storage.list();
      const duplicate = existing.find((icon) => icon.digest === digest);
      if (duplicate) {
        let stored = duplicate;
        let rollbackToken = null;
        if (source !== null && duplicate.source === null) {
          stored = await this.#storage.put({ ...duplicate, source });
          rollbackToken = Object.freeze({
            kind: "restore",
            record: parseCustomIconRecord(duplicate)
          });
          await this.#notify(CUSTOM_ICON_CHANGES.UPDATED);
        }
        return {
          icon: customIconSummary(stored),
          duplicate: true,
          ...(includeRollback ? { rollbackToken } : {})
        };
      }
      if (existing.length >= CUSTOM_ICON_LIMITS.maxIcons) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED);
      }
      const record = await this.#storage.put({
        id: this.#uniqueId(new Set(existing.map(({ id }) => id)), preferredId),
        label,
        digest,
        createdAt: this.#clock().toISOString(),
        byteLength: bytes.byteLength,
        bytes,
        source
      });
      await this.#notify(CUSTOM_ICON_CHANGES.ADDED);
      return {
        icon: customIconSummary(record),
        duplicate: false,
        ...(includeRollback
          ? { rollbackToken: Object.freeze({ kind: "remove", id: record.id }) }
          : {})
      };
    });
  }

  rollbackImportIcon(token, { executorLease = null } = {}) {
    return this.#runMutation(executorLease, async () => {
      if (!token || typeof token !== "object") {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
      }
      if (token.kind === "remove" && isCustomIconId(token.id)) {
        await this.#storage.remove(token.id);
        await this.#notify(CUSTOM_ICON_CHANGES.REMOVED);
        return;
      }
      if (token.kind === "restore" && token.record) {
        await this.#storage.put(parseCustomIconRecord(token.record));
        await this.#notify(CUSTOM_ICON_CHANGES.UPDATED);
        return;
      }
      throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
    });
  }

  recordLegacyReference(sourceId, targetId, digest, { executorLease = null } = {}) {
    return this.#runMutation(executorLease, async () => {
      if (!isCustomIconId(sourceId) || !isCustomIconId(targetId) || sourceId === targetId) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
      }
      const icons = await this.#storage.list();
      const byId = new Map(icons.map((icon) => [icon.id, icon]));
      if (byId.get(targetId)?.digest !== digest) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
      }
      const previous = await this.#storage.getCompatibility(sourceId);
      const mappings = (previous?.mappings ?? []).filter((mapping) =>
        byId.get(mapping.targetId)?.digest === mapping.digest && mapping.digest !== digest
      );
      mappings.push({ digest, targetId });
      await this.#storage.putCompatibility(parseCustomIconCompatibilityRecord({
        sourceId,
        mappings
      }));
      return Object.freeze({ sourceId, previous });
    });
  }

  restoreLegacyReference(token, { executorLease = null } = {}) {
    return this.#runMutation(executorLease, async () => {
      if (!token || !isCustomIconId(token.sourceId)) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
      }
      if (token.previous === null) {
        await this.#storage.removeCompatibility(token.sourceId);
      } else {
        await this.#storage.putCompatibility(
          parseCustomIconCompatibilityRecord(token.previous)
        );
      }
    });
  }

  remove(rawId, { executorLease = null } = {}) {
    return this.#runMutation(executorLease, async () => {
      if (!isCustomIconId(rawId)) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
      }
      if (!await this.#storage.get(rawId)) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.NOT_FOUND);
      }
      // Reassign before deleting: if deletion then fails, the workspaces
      // already show House and the icon stays listed for a retry.
      const { replacedCount } = await this.#workspaceStateService.replaceWorkspaceIcon(
        rawId,
        FALLBACK_WORKSPACE_ICON.id
      );
      await this.#storage.remove(rawId);
      await this.#notify(CUSTOM_ICON_CHANGES.REMOVED);
      return { id: rawId, reassignedWorkspaceCount: replacedCount };
    });
  }

  #uniqueId(existingIds, preferredId = null) {
    if (preferredId !== null && !existingIds.has(preferredId)) return preferredId;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = createCustomIconId(this.#randomUUID);
      if (!existingIds.has(id)) return id;
    }
    throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);
  }

  async #notify(change) {
    try {
      await this.#onChanged(change);
    } catch {
      // Open pages refresh on their next load when no listener is reachable.
    }
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  #runMutation(executorLease, operation) {
    if (!this.#operationExecutor) return this.#enqueue(operation);
    if (executorLease !== null) {
      if (this.#operationExecutor.ownsLease?.(executorLease)) {
        return Promise.resolve().then(operation);
      }
      return Promise.reject(new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST));
    }
    return this.#operationExecutor.runExclusive(operation);
  }
}

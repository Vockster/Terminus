import {
  PRIVATE_RECOVERY_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_KINDS,
  createPrivateDocument,
  createPrivateSnapshotRecord,
  parsePrivateDocumentText,
  privateDocumentSummary,
  serializePrivateDocument,
  verifyPrivateDocument
} from "../contracts/private-snapshots.js";
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_KINDS,
  SNAPSHOT_RESTORE_SCOPES,
  SnapshotError,
  createSnapshotRecord,
  parsePrivateSnapshotPayload,
  parseSnapshotPayload
} from "../contracts/snapshots.js";
import { noContainerAssignment } from "../contracts/containers.js";
import {
  MAX_WORKSPACES,
  WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceState
} from "../contracts/workspace-state.js";
import {
  automaticRetentionRule,
  privateCleanupApplies,
  selectAutomaticRemovals
} from "./automatic-retention-policy.js";
import { SnapshotCaptureService } from "./snapshot-capture-service.js";
import { privateSnapshotExportFilename } from "./export-filenames.js";
import { validateWorkspaceAssociationMap } from "./workspace-import-policy.js";

const CAPTURE_DELAY_MS = 180;

function tabCount(payload) {
  return payload.windows.reduce(
    (total, window) => total + window.workspaceLayouts.reduce(
      (count, layout) => count + layout.tabs.length,
      0
    ),
    0
  );
}

function compatibleWorkspaceDefinition(current, source) {
  return current?.name === source.name &&
    current?.icon === source.icon &&
    current?.color === source.color;
}

export class PrivateSnapshotService {
  #storage;
  #settingsService;
  #controller;
  #captureService;
  #browserAdapter;
  #restoreService;
  #downloads;
  #clock;
  #captureTimer = null;
  #captureTail = Promise.resolve();
  #historyTail = Promise.resolve();
  #lastClearedDigest = null;
  #recoveryRestoreAttempted = false;
  #idGenerator;

  constructor({
    storage,
    settingsService,
    controller,
    browserAdapter,
    restoreService,
    downloadsAdapter,
    clock = () => new Date(),
    idGenerator = () => globalThis.crypto.randomUUID()
  }) {
    this.#storage = storage;
    this.#settingsService = settingsService;
    this.#controller = controller;
    this.#browserAdapter = browserAdapter;
    this.#captureService = new SnapshotCaptureService(browserAdapter);
    this.#restoreService = restoreService;
    this.#downloads = downloadsAdapter;
    this.#clock = clock;
    this.#idGenerator = idGenerator;
  }

  async overview({ privateAccessAllowed, privateContext }) {
    const settings = await this.#settingsService.getOrInitialize();
    const recovery = await this.#readRecovery();
    return {
      privateAccessAllowed: privateAccessAllowed === true,
      privateContext: privateContext === true,
      keepPrivateTabsBetweenSessions: settings.privacy.keepPrivateTabsBetweenSessions,
      automaticSnapshotsEnabled: settings.privacy.automaticSnapshotsEnabled,
      recovery: recovery ? privateDocumentSummary(recovery) : null,
      snapshots: privateContext === true ? await this.listStored() : [],
      storageBytes: privateContext === true && this.#storage.bytesInUse
        ? await this.#storage.bytesInUse()
        : 0,
      lastRestoreReport: await this.#storage.readLastRestoreReport()
    };
  }

  scheduleRecoveryCapture(windowId) {
    clearTimeout(this.#captureTimer);
    this.#captureTimer = setTimeout(() => {
      this.#captureTimer = null;
      void this.captureRecovery(windowId).catch(() => undefined);
    }, CAPTURE_DELAY_MS);
  }

  async endSession() {
    clearTimeout(this.#captureTimer);
    this.#captureTimer = null;
    this.#recoveryRestoreAttempted = false;
    await this.#captureTail;
    const settings = await this.#settingsService.getOrInitialize();
    if (!settings.privacy.keepPrivateTabsBetweenSessions) {
      await this.clearRecovery();
      return { recoveryCleared: true };
    }
    return { recoveryCleared: false };
  }

  captureRecovery(windowId) {
    const operation = this.#captureTail.then(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (!settings.privacy.keepPrivateTabsBetweenSessions) {
        return { captured: false, reason: "disabled" };
      }
      const payload = await this.#capture(windowId);
      if (tabCount(payload) === 0) {
        return { captured: false, reason: "empty" };
      }
      const previous = await this.#readRecovery();
      const document = await createPrivateDocument({
        documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
        generation: (previous?.generation ?? 0) + 1,
        createdAt: this.#clock().toISOString(),
        payload
      });
      if (document.payloadDigest === this.#lastClearedDigest) {
        return { captured: false, reason: "cleared-unchanged" };
      }
      await this.#storage.writeRecovery(document);
      const verified = await verifyPrivateDocument(
        await this.#storage.readRecovery(),
        PRIVATE_RECOVERY_DOCUMENT_TYPE
      );
      this.#lastClearedDigest = null;
      return { captured: true, document: verified };
    });
    this.#captureTail = operation.catch(() => undefined);
    return operation;
  }

  captureRecoveryFromInventory(inventory) {
    const operation = this.#captureTail.then(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (!settings.privacy.keepPrivateTabsBetweenSessions) {
        return { captured: false, reason: "disabled" };
      }
      const payload = await this.#captureService.capture(inventory);
      if (tabCount(payload) === 0) {
        return { captured: false, reason: "empty" };
      }
      const previous = await this.#readRecovery();
      const document = await createPrivateDocument({
        documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
        generation: (previous?.generation ?? 0) + 1,
        createdAt: this.#clock().toISOString(),
        payload
      });
      if (document.payloadDigest === this.#lastClearedDigest) {
        return { captured: false, reason: "cleared-unchanged" };
      }
      await this.#storage.writeRecovery(document);
      const verified = await verifyPrivateDocument(
        await this.#storage.readRecovery(),
        PRIVATE_RECOVERY_DOCUMENT_TYPE
      );
      this.#lastClearedDigest = null;
      return { captured: true, document: verified };
    });
    this.#captureTail = operation.catch(() => undefined);
    return operation;
  }

  async setPersistence(enabled, windowId = null) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("The private recovery preference must be a boolean.");
    }
    if (!enabled) {
      const settings = await this.#settingsService.update({
        privacy: { keepPrivateTabsBetweenSessions: false }
      });
      return { settings, captured: false, reason: "clears-after-session" };
    }
    const settings = await this.#settingsService.update({
      privacy: { keepPrivateTabsBetweenSessions: true }
    });
    const capture = Number.isInteger(windowId)
      ? await this.captureRecovery(windowId)
      : { captured: false, reason: "no-private-window" };
    return { settings, ...capture };
  }

  async setAutomaticSnapshots(enabled) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("The private automatic snapshot preference must be a boolean.");
    }
    const settings = await this.#settingsService.update({
      privacy: { automaticSnapshotsEnabled: enabled }
    });
    return { settings };
  }

  createStored(windowId, options = {}) {
    return this.#enqueueHistory(() => this.#createStored(windowId, options));
  }

  captureAutomatic(settings, { force = false } = {}) {
    return this.#enqueueHistory(async () => {
      if (!settings.privacy.automaticSnapshotsEnabled) {
        return { created: false, reason: "disabled", record: null };
      }
      const windowIds = await this.#browserAdapter.listNormalWindows();
      const windowId = windowIds.find(({ id }) => Number.isInteger(id))?.id;
      if (!Number.isInteger(windowId)) {
        return { created: false, reason: "no-private-window", record: null };
      }
      const result = await this.#createStored(windowId, {
        kind: PRIVATE_SNAPSHOT_KINDS.AUTOMATIC,
        force
      });
      await this.#cleanupAutomatic(settings);
      return result;
    });
  }

  cleanupAutomatic(settings) {
    return this.#enqueueHistory(() => this.#cleanupAutomatic(settings));
  }

  // Private counts are returned only to a sender in a private window.
  previewCleanup(settings, { privateContext }) {
    if (privateContext !== true) {
      return Promise.resolve({ privateSnapshots: null });
    }
    return this.#enqueueHistory(async () => ({
      privateSnapshots: privateCleanupApplies(settings)
        ? (await this.#selectAutomaticRemovals(settings)).length
        : 0
    }));
  }

  async #selectAutomaticRemovals(settings) {
    const automatic = (await this.#listStoredRecords())
      .filter(({ kind }) => kind === PRIVATE_SNAPSHOT_KINDS.AUTOMATIC);
    return selectAutomaticRemovals(automatic, automaticRetentionRule(settings), this.#clock());
  }

  async #createStored(
    windowId,
    { kind = PRIVATE_SNAPSHOT_KINDS.MANUAL, force = false } = {}
  ) {
    if (!Object.values(PRIVATE_SNAPSHOT_KINDS).includes(kind)) {
      throw new TypeError("The private snapshot kind is invalid.");
    }
    const record = await createPrivateSnapshotRecord({
      id: `private-snapshot-${this.#idGenerator()}`.toLowerCase(),
      kind,
      createdAt: this.#clock().toISOString(),
      payload: await this.#capture(windowId)
    });
    if (!force && kind === PRIVATE_SNAPSHOT_KINDS.AUTOMATIC) {
      const latest = (await this.#listStoredRecords())
        .find((candidate) => candidate.kind === PRIVATE_SNAPSHOT_KINDS.AUTOMATIC);
      if (latest?.payloadDigest === record.payloadDigest) {
        return { created: false, reason: "unchanged", record: null };
      }
    }
    await this.#storage.writeSnapshotRecord(record);
    const verified = await verifyPrivateDocument(
      await this.#storage.readSnapshotRecord(record.id)
    );
    return { created: true, reason: null, record: privateDocumentSummary(verified) };
  }

  async #cleanupAutomatic(settings) {
    if (!privateCleanupApplies(settings)) {
      return { removed: [] };
    }
    const removed = await this.#selectAutomaticRemovals(settings);
    await Promise.all(removed.map(({ id }) => this.#storage.removeSnapshotRecord(id)));
    return { removed: removed.map(privateDocumentSummary) };
  }

  listStored() {
    return this.#enqueueHistory(async () =>
      (await this.#listStoredRecords()).map(privateDocumentSummary)
    );
  }

  getStored(id) {
    return this.#enqueueHistory(async () => {
      const record = await this.#storage.readSnapshotRecord(id);
      if (record === undefined) {
        throw new TypeError("The private snapshot could not be found.");
      }
      const verified = await verifyPrivateDocument(record);
      if (verified.id !== id) {
        throw new TypeError("The private snapshot identity is invalid.");
      }
      return verified;
    });
  }

  deleteStored(id) {
    return this.#enqueueHistory(async () => {
      const record = await this.#storage.readSnapshotRecord(id);
      if (record === undefined) {
        throw new TypeError("The private snapshot could not be found.");
      }
      await verifyPrivateDocument(record);
      await this.#storage.removeSnapshotRecord(id);
      return { id };
    });
  }

  clearStored() {
    return this.#enqueueHistory(async () => {
      const records = await this.#listStoredRecords();
      await Promise.all(records.map(({ id }) => this.#storage.removeSnapshotRecord(id)));
      return {
        removed: records.length,
        manual: records.filter(({ kind }) => kind === PRIVATE_SNAPSHOT_KINDS.MANUAL).length,
        automatic: records.filter(({ kind }) => kind === PRIVATE_SNAPSHOT_KINDS.AUTOMATIC).length
      };
    });
  }

  async exportStored(id) {
    const document = await this.getStored(id);
    const downloadId = await this.#downloads.downloadJson({
      text: serializePrivateDocument(document),
      filename: privateSnapshotExportFilename(document),
      saveAs: true,
      incognito: true
    });
    return { downloadId, summary: privateDocumentSummary(document) };
  }

  async clearRecovery() {
    await this.prepareRecoveryClear();
    return { cleared: true };
  }

  async prepareRecoveryClear() {
    clearTimeout(this.#captureTimer);
    this.#captureTimer = null;
    await this.#captureTail;
    const current = await this.#readRecovery();
    const token = {
      type: "private-recovery-clear",
      recovery: current,
      lastClearedDigest: this.#lastClearedDigest
    };
    this.#lastClearedDigest = current?.payloadDigest ?? null;
    await this.#storage.removeRecovery();
    if (await this.#storage.readRecovery() !== undefined) {
      throw new Error("Private recovery data could not be deleted.");
    }
    return token;
  }

  async restorePreparedRecovery(token) {
    if (!token || token.type !== "private-recovery-clear") {
      throw new TypeError("The private recovery rollback token is invalid.");
    }
    clearTimeout(this.#captureTimer);
    this.#captureTimer = null;
    await this.#captureTail;
    if (token.recovery) {
      await this.#storage.writeRecovery(token.recovery);
      await verifyPrivateDocument(
        await this.#storage.readRecovery(),
        PRIVATE_RECOVERY_DOCUMENT_TYPE
      );
    } else {
      await this.#storage.removeRecovery();
      if (await this.#storage.readRecovery() !== undefined) {
        throw new Error("Private recovery rollback could not be verified.");
      }
    }
    this.#lastClearedDigest = token.lastClearedDigest;
    return true;
  }

  async previewText(text) {
    const document = await parsePrivateDocumentText(text);
    const summary = privateDocumentSummary(document);
    return {
      kind: "snapshot",
      createdAt: summary.createdAt,
      workspaceCount: summary.workspaceCount,
      tabCount: summary.tabCount,
      document
    };
  }

  parseText(text) {
    return parsePrivateDocumentText(text);
  }

  importSnapshotText(text) {
    return this.#enqueueHistory(async () => {
      const document = await parsePrivateDocumentText(text);
      const record = await createPrivateSnapshotRecord({
        id: `private-snapshot-${this.#idGenerator()}`.toLowerCase(),
        kind: PRIVATE_SNAPSHOT_KINDS.MANUAL,
        createdAt: document.createdAt,
        payload: document.payload
      });
      await this.#storage.writeSnapshotRecord(record);
      const verified = await verifyPrivateDocument(
        await this.#storage.readSnapshotRecord(record.id)
      );
      return { kind: "snapshot", record: privateDocumentSummary(verified) };
    });
  }

  async restoreViewer({ source, request, windowId }) {
    if (
      !source ||
      typeof source !== "object" ||
      !request ||
      typeof request !== "object" ||
      !Number.isInteger(windowId)
    ) {
      throw new TypeError("The private restore request is invalid.");
    }
    const document = typeof source.id === "string"
      ? await this.getStored(source.id)
      : await parsePrivateDocumentText(source.text);
    const { restoreBatchSize } = (await this.#settingsService.getOrInitialize()).snapshots;
    return this.#controller.performScopedRestore(
      windowId,
      async ({ inventory, convergeWindow, refreshInventory }) => {
        const currentState = inventory.state;
        const payload = this.#mapWorkspaceDefinitions(
          document.payload,
          currentState
        );
        const record = await createSnapshotRecord({
          id: `snapshot-private-${this.#idGenerator()}`.toLowerCase(),
          kind: SNAPSHOT_KINDS.MANUAL,
          createdAt: document.createdAt,
          reason: "private-snapshot-restore",
          payload
        });
        let safetyRecord = null;
        return this.#restoreService.restoreSnapshot({
          record,
          request,
          inventory,
          createSafetySnapshot: async () => {
            const safetyPayload = await this.#captureService.capture(inventory);
            safetyRecord = await createSnapshotRecord({
              id: `snapshot-private-safety-${this.#idGenerator()}`.toLowerCase(),
              kind: SNAPSHOT_KINDS.SAFETY,
              createdAt: this.#clock().toISOString(),
              reason: "private-snapshot-rollback",
              payload: this.#mapWorkspaceDefinitions(safetyPayload, currentState)
            });
          },
          convergeWindow,
          restoreBatchSize,
          recoverAfterDestructiveFailure: async () => {
            if (!safetyRecord || typeof refreshInventory !== "function") {
              throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
            }
            return this.#restoreService.restoreSnapshot({
              record: safetyRecord,
              request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
              inventory: await refreshInventory(),
              createSafetySnapshot: async () => undefined,
              convergeWindow,
              restoreBatchSize
            });
          }
        });
      }
    );
  }

  async restoreRecoveryIfEligible(windowId) {
    if (this.#recoveryRestoreAttempted) {
      return { restored: false, reason: "already-attempted" };
    }
    this.#recoveryRestoreAttempted = true;
    const settings = await this.#settingsService.getOrInitialize();
    if (!settings.privacy.keepPrivateTabsBetweenSessions) {
      // Recovery is normally cleared when the last private window closes. A
      // crash or forced quit ends the session without that step, and startup
      // only runs it when no private window was restored - so a window Firefox
      // restores alongside us would leave declined private browsing data on
      // disk indefinitely. Delete it here instead.
      if (await this.#storage.readRecovery() !== undefined) {
        await this.#discardRecovery();
        return { restored: false, reason: "disabled-cleared" };
      }
      return { restored: false, reason: "disabled" };
    }
    const recovery = await this.#readRecovery();
    if (!recovery) {
      return { restored: false, reason: "missing" };
    }
    const liveWindows = await this.#browserAdapter.listNormalWindows();
    const liveTabs = liveWindows.flatMap((window) => window.tabs ?? []);
    const bootstrapUrls = new Set(["about:blank", "about:newtab", "about:privatebrowsing"]);
    if (
      liveWindows.length !== 1 ||
      liveWindows[0].id !== windowId ||
      liveTabs.length !== 1 ||
      !bootstrapUrls.has(liveTabs[0].url ?? "about:blank")
    ) {
      return { restored: false, reason: "private-session-already-used" };
    }
    const snapshotDocument = await createPrivateDocument({
      documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
      createdAt: recovery.createdAt,
      payload: recovery.payload
    });
    const result = await this.restoreViewer({
      source: { text: serializePrivateDocument(snapshotDocument) },
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      windowId
    });
    return { restored: true, result };
  }

  async #capture(windowId) {
    const inventory = await this.#controller.captureInventory(windowId);
    return this.#captureService.capture(inventory);
  }

  // Deletes stored recovery without the clear-suppression bookkeeping that
  // `prepareRecoveryClear` keeps. That bookkeeping stops the next capture from
  // immediately undoing a deliberate clear; here the feature is off, and
  // turning it back on must capture again straight away.
  async #discardRecovery() {
    await this.#storage.removeRecovery();
    if (await this.#storage.readRecovery() !== undefined) {
      throw new Error("Private recovery data could not be deleted.");
    }
  }

  async #readRecovery() {
    const raw = await this.#storage.readRecovery();
    if (raw === undefined) {
      return null;
    }
    try {
      return await verifyPrivateDocument(raw, PRIVATE_RECOVERY_DOCUMENT_TYPE);
    } catch (error) {
      await this.#storage.quarantineRecovery({
        quarantinedAt: this.#clock().toISOString(),
        code: error?.code ?? "INVALID_BACKUP",
        document: raw
      });
      return null;
    }
  }

  async #listStoredRecords() {
    const records = [];
    for (const candidate of await this.#storage.listSnapshotRecords()) {
      try {
        const record = await verifyPrivateDocument(candidate.value);
        if (record.id === candidate.id) {
          records.push(record);
        }
      } catch {
        // Invalid private records remain isolated and are omitted from the viewer.
      }
    }
    return records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  #enqueueHistory(operation) {
    const result = this.#historyTail.then(operation, operation);
    this.#historyTail = result.catch(() => undefined);
    return result;
  }

  #mapWorkspaceDefinitions(payload, currentState) {
    const current = parseWorkspaceState(currentState);
    const source = parsePrivateSnapshotPayload(payload);
    const workspaces = current.workspaces.map((workspace) => ({ ...workspace }));
    const rail = current.rail.map((entry) => ({ ...entry }));
    const currentById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const usedIds = new Set(currentById.keys());
    const workspaceMap = new Map();
    const newWorkspaces = [];

    for (const sourceWorkspace of source.workspaceState.workspaces) {
      const exact = currentById.get(sourceWorkspace.id);
      let target = compatibleWorkspaceDefinition(exact, sourceWorkspace) ? exact : null;
      if (!target) {
        let id = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const candidate = `private-${this.#idGenerator()}`.toLowerCase();
          if (!usedIds.has(candidate)) {
            id = candidate;
            usedIds.add(candidate);
            break;
          }
        }
        if (id === null) {
          throw new TypeError("A private snapshot workspace ID could not be allocated.");
        }
        target = { ...sourceWorkspace, id };
        workspaces.push(target);
        currentById.set(id, target);
        newWorkspaces.push(target);
      }
      workspaceMap.set(sourceWorkspace.id, target.id);
    }
    const resolvedWorkspaceMap = validateWorkspaceAssociationMap({
      sourceWorkspaceIds: source.workspaceState.workspaces.map(({ id }) => id),
      targetWorkspaceIds: workspaces.map(({ id }) => id),
      workspaceIdMap: workspaceMap
    });
    if (workspaces.length > MAX_WORKSPACES) {
      throw new TypeError("The private snapshot would exceed the workspace limit.");
    }
    rail.push(...newWorkspaces.map(({ id }) => ({ kind: "workspace", workspaceId: id })));
    const workspaceState = parseWorkspaceState({
      schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaces,
      rail
    });
    const windows = source.windows.map((window) => ({
      ...window,
      activeWorkspaceId: resolvedWorkspaceMap.get(window.activeWorkspaceId),
      selectedTabs: window.selectedTabs.map((selection) => ({
        ...selection,
        workspaceId: resolvedWorkspaceMap.get(selection.workspaceId)
      })),
      workspaceLayouts: window.workspaceLayouts.map((layout) => ({
        ...layout,
        workspaceId: resolvedWorkspaceMap.get(layout.workspaceId)
      }))
    }));
    return parseSnapshotPayload({
      workspaceState,
      windows: windows.map((window) => ({
        ...window,
        workspaceLayouts: window.workspaceLayouts.map((layout) => ({
          ...layout,
          tabs: layout.tabs.map((tab) => ({
            ...tab,
            container: noContainerAssignment()
          }))
        }))
      })),
      containerCatalog: []
    });
  }
}

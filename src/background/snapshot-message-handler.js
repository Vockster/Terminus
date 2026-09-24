import {
  SNAPSHOT_MESSAGE_TYPES,
  cleanupPreviewSettings,
  snapshotFailure,
  snapshotSuccess
} from "../contracts/snapshot-messages.js";
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_KINDS,
  SnapshotError,
  createSnapshotRecord
} from "../contracts/snapshots.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidRequest() {
  return Promise.resolve(snapshotFailure(new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST)));
}

function senderWindowId(sender) {
  return Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : null;
}

async function resolveSnapshotSource(source, snapshotService, { restampText = true } = {}) {
  if (hasExactKeys(source, ["id"]) && typeof source.id === "string") {
    return snapshotService.get(source.id);
  }
  if (hasExactKeys(source, ["text"]) && typeof source.text === "string") {
    const parsed = await snapshotService.parseText(source.text);
    if (parsed.kind !== "snapshot") {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    if (!restampText) return parsed.document;
    return createSnapshotRecord({
      id: parsed.document.id,
      kind: SNAPSHOT_KINDS.MANUAL,
      createdAt: parsed.document.createdAt,
      reason: "file-import",
      payload: parsed.document.payload
    });
  }
  throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
}

export function createSnapshotMessageHandler({
  snapshotService,
  workspaceController,
  settingsService,
  scheduleService
}) {
  return function handleSnapshotMessage(message, sender) {
    if (!isRecord(message)) {
      return undefined;
    }
    const respond = (operation) => Promise.resolve(operation).then(snapshotSuccess, snapshotFailure);
    if (message.type === SNAPSHOT_MESSAGE_TYPES.OVERVIEW) {
      return hasExactKeys(message, ["type"])
        ? respond(snapshotService.overview())
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP) {
      return hasExactKeys(message, ["type", "snapshots"])
        ? respond(
            settingsService.getOrInitialize().then((settings) =>
              snapshotService.previewCleanup(cleanupPreviewSettings(settings, message.snapshots))
            )
          )
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.GET) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(snapshotService.get(message.id))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.CREATE) {
      return hasExactKeys(message, ["type"])
        ? respond(
            workspaceController.createSnapshot({
              kind: SNAPSHOT_KINDS.MANUAL,
              windowId: senderWindowId(sender)
            })
          )
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.TEST_AUTOMATIC) {
      return hasExactKeys(message, ["type"])
        ? respond(scheduleService.scheduleAutomaticTest())
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.SAVE_SETTINGS) {
      if (!hasExactKeys(message, ["type"])) {
        return invalidRequest();
      }
      return respond(
        settingsService.getOrInitialize().then((settings) => snapshotService.saveSettings(settings))
      );
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.GET_SETTINGS) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(snapshotService.getSettings(message.id))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.IMPORT_SETTINGS) {
      return hasExactKeys(message, ["type", "text"]) && typeof message.text === "string"
        ? respond(snapshotService.importSettingsText(message.text))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.EXPORT_SETTINGS) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(snapshotService.exportSettings(message.id))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.DELETE_SETTINGS) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(snapshotService.deleteSettings(message.id))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.EXPORT) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(snapshotService.export(message.id))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.OPEN_FILE_LOCATION) {
      return hasExactKeys(message, ["type", "kind"]) &&
        [SNAPSHOT_KINDS.MANUAL, SNAPSHOT_KINDS.AUTOMATIC].includes(message.kind)
        ? respond(snapshotService.openFileLocation(message.kind))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.DELETE) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(snapshotService.delete(message.id))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.CLEAR_VIEWER) {
      return hasExactKeys(message, ["type"])
        ? respond(snapshotService.clearViewer())
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.PREVIEW) {
      return hasExactKeys(message, ["type", "text"]) && typeof message.text === "string"
        ? respond(snapshotService.previewText(message.text))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.CONTAINER_PREFLIGHT) {
      if (
        !hasExactKeys(message, ["type", "source", "request"]) ||
        !isRecord(message.source) ||
        !isRecord(message.request)
      ) {
        return invalidRequest();
      }
      return respond(
        resolveSnapshotSource(message.source, snapshotService).then((record) =>
          workspaceController.snapshotContainerPreflight(record, message.request)
        )
      );
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.IMPORT) {
      return hasExactKeys(message, ["type", "text"]) && typeof message.text === "string"
        ? respond(snapshotService.importSnapshotText(message.text))
        : invalidRequest();
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.RESTORE) {
      if (
        !hasExactKeys(message, ["type", "source", "request"]) ||
        !isRecord(message.source) ||
        !isRecord(message.request)
      ) {
        return invalidRequest();
      }
      return respond(
        resolveSnapshotSource(message.source, snapshotService).then((record) =>
          workspaceController.restoreSnapshot(senderWindowId(sender), record, message.request)
        )
      );
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.RESTORE_SETTINGS) {
      if (
        !hasExactKeys(message, ["type", "text", "sections"]) ||
        typeof message.text !== "string" ||
        !Array.isArray(message.sections)
      ) {
        return invalidRequest();
      }
      return respond(
        snapshotService.parseText(message.text).then(async (parsed) => {
          if (parsed.kind !== "settings") {
            throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
          }
          const document = await snapshotService.prepareSettingsBackupForRestore(parsed.document);
          return workspaceController.restoreSettingsBackup(
            senderWindowId(sender),
            document,
            message.sections
          );
        })
      );
    }
    if (message.type === SNAPSHOT_MESSAGE_TYPES.RESTORE_STORED_SETTINGS) {
      if (
        !hasExactKeys(message, ["type", "id", "sections"]) ||
        typeof message.id !== "string" ||
        !Array.isArray(message.sections)
      ) {
        return invalidRequest();
      }
      return respond(
        snapshotService.getSettings(message.id).then((document) =>
          workspaceController.restoreSettingsBackup(
            senderWindowId(sender),
            document,
            message.sections
          )
        )
      );
    }
    return undefined;
  };
}

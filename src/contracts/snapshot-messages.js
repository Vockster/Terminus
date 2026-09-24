import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_ERROR_MESSAGES,
  SnapshotError
} from "./snapshots.js";
import { parseSettingsState } from "./settings-state.js";
import { publicMessageWithDetail } from "./public-error-detail.js";

export const SNAPSHOT_MESSAGE_TYPES = Object.freeze({
  OVERVIEW: "snapshots.overview",
  PREVIEW_CLEANUP: "snapshots.previewCleanup",
  GET: "snapshots.get",
  CREATE: "snapshots.create",
  TEST_AUTOMATIC: "snapshots.testAutomatic",
  SAVE_SETTINGS: "snapshots.saveSettings",
  GET_SETTINGS: "snapshots.getSettings",
  IMPORT_SETTINGS: "snapshots.importSettings",
  EXPORT_SETTINGS: "snapshots.exportSettings",
  DELETE_SETTINGS: "snapshots.deleteSettings",
  EXPORT: "snapshots.export",
  OPEN_FILE_LOCATION: "snapshots.openFileLocation",
  DELETE: "snapshots.delete",
  CLEAR_VIEWER: "snapshots.clearViewer",
  PREVIEW: "snapshots.preview",
  CONTAINER_PREFLIGHT: "snapshots.containerPreflight",
  IMPORT: "snapshots.import",
  RESTORE: "snapshots.restore",
  RESTORE_SETTINGS: "snapshots.restoreSettings",
  RESTORE_STORED_SETTINGS: "snapshots.restoreStoredSettings"
});

// The only settings a cleanup preview may propose.
export const CLEANUP_PREVIEW_SNAPSHOT_KEYS = Object.freeze([
  "retentionCount"
]);

// Merges proposed cleanup values onto the current settings and validates the
// result before any library is read.
export function cleanupPreviewSettings(currentSettings, snapshots) {
  const keys = snapshots !== null && typeof snapshots === "object" && !Array.isArray(snapshots)
    ? Object.keys(snapshots).sort()
    : null;
  const expected = [...CLEANUP_PREVIEW_SNAPSHOT_KEYS].sort();
  if (!keys || keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  }
  try {
    return parseSettingsState({
      ...currentSettings,
      snapshots: { ...currentSettings.snapshots, ...snapshots }
    });
  } catch {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  }
}

export function snapshotSuccess(result) {
  return { ok: true, result };
}

export function snapshotFailure(error) {
  const code =
    error instanceof SnapshotError && SNAPSHOT_ERROR_MESSAGES[error.code]
      ? error.code
      : SNAPSHOT_ERROR_CODES.INTERNAL_ERROR;
  return {
    ok: false,
    error: {
      code,
      message: code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
        ? publicMessageWithDetail(SNAPSHOT_ERROR_MESSAGES[code], error.detail)
        : SNAPSHOT_ERROR_MESSAGES[code]
    }
  };
}

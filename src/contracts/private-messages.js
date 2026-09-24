import { snapshotFailure, snapshotSuccess } from "./snapshot-messages.js";

export const PRIVATE_MESSAGE_TYPES = Object.freeze({
  OVERVIEW: "private.overview",
  SET_PERSISTENCE: "private.set-persistence",
  SET_AUTOMATIC_SNAPSHOTS: "private.set-automatic-snapshots",
  CLEAR_RECOVERY: "private.clear-recovery",
  CREATE: "private.create",
  TEST_AUTOMATIC: "private.test-automatic",
  GET: "private.get",
  DELETE: "private.delete",
  CLEAR_VIEWER: "private.clear-viewer",
  IMPORT: "private.import",
  EXPORT_STORED: "private.export-stored",
  PREVIEW: "private.preview",
  PREVIEW_CLEANUP: "private.preview-cleanup",
  RESTORE_VIEWER: "private.restore-viewer"
});

export const privateSuccess = snapshotSuccess;
export const privateFailure = snapshotFailure;

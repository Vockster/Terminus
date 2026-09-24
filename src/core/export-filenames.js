import {
  SETTINGS_BACKUP_KINDS,
  SETTINGS_BACKUP_REASONS,
  SNAPSHOT_KINDS
} from "../contracts/snapshots.js";
import { PRIVATE_SNAPSHOT_KINDS } from "../contracts/private-snapshots.js";

// Exported files are recognized by their contents, never by their names, so
// these names only need to be clear to people. Older exports with any name
// keep importing exactly as before.
export const EXPORT_FOLDER = "Snapshots & Settings";

const MONTHS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
]);
const SYNC_IMPORT_REASON = "firefox-sync-import";

// Local date and time, e.g. "Sep 13, 2026 9.25 PM". Windows forbids ":" in
// file names, so the time uses a period.
export function readableExportTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = date.getHours() < 12 ? "AM" : "PM";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${hours}.${minutes} ${meridiem}`;
}

function exportPath(label, timestamp) {
  return `${EXPORT_FOLDER}/${label} - ${readableExportTime(timestamp)}.json`;
}

export function snapshotExportFilename({ kind, reason = null, createdAt }) {
  const label = reason === SYNC_IMPORT_REASON
    ? "Terminus Imported Snapshot"
    : {
        [SNAPSHOT_KINDS.AUTOMATIC]: "Terminus Automatic Snapshot",
        [SNAPSHOT_KINDS.SAFETY]: "Terminus Safety Snapshot"
      }[kind] ?? "Terminus Snapshot";
  return exportPath(label, createdAt);
}

export function settingsBackupExportFilename({ backupKind, reason = null, createdAt }) {
  const label = reason === SETTINGS_BACKUP_REASONS.FIREFOX_SYNC_IMPORT
    ? "Terminus Imported Settings Backup"
    : backupKind === SETTINGS_BACKUP_KINDS.AUTOMATIC
      ? "Terminus Automatic Settings Backup"
      : "Terminus Settings Backup";
  return exportPath(label, createdAt);
}

export function privateSnapshotExportFilename({ kind, createdAt }) {
  return exportPath(
    kind === PRIVATE_SNAPSHOT_KINDS.AUTOMATIC ? "Terminus Private Automatic Snapshot" : "Terminus Private Snapshot",
    createdAt
  );
}

// The whole workspace setup, icons included, in one zip.
export function workspacePackageExportFilename({ createdAt }) {
  return `${EXPORT_FOLDER}/Terminus Workspaces - ${readableExportTime(createdAt)}.zip`;
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  privateSnapshotExportFilename,
  readableExportTime,
  settingsBackupExportFilename,
  snapshotExportFilename
} from "../../src/core/export-filenames.js";

// Built from local time parts, so the expectation holds in any time zone.
function localTimestamp(year, monthIndex, day, hours, minutes) {
  return new Date(year, monthIndex, day, hours, minutes, 27, 123).toISOString();
}

test("export times read as a local date and a 12-hour time with no characters Windows forbids", () => {
  assert.equal(readableExportTime(localTimestamp(2026, 8, 13, 21, 5)), "Sep 13, 2026 9.05 PM");
  assert.equal(readableExportTime(localTimestamp(2026, 0, 2, 0, 30)), "Jan 2, 2026 12.30 AM");
  assert.equal(readableExportTime(localTimestamp(2026, 11, 31, 12, 0)), "Dec 31, 2026 12.00 PM");
  assert.equal(readableExportTime("not a date"), "Unknown date");
  assert.doesNotMatch(readableExportTime(new Date().toISOString()), /[\\/:*?"<>|]/);
});

test("export names say what each file is, including legacy imported copies", () => {
  const createdAt = localTimestamp(2026, 8, 13, 21, 5);
  const when = "Sep 13, 2026 9.05 PM";
  assert.equal(snapshotExportFilename({ kind: "manual", createdAt }), `Snapshots & Settings/Terminus Snapshot - ${when}.json`);
  assert.equal(snapshotExportFilename({ kind: "manual", reason: "file-import", createdAt }), `Snapshots & Settings/Terminus Snapshot - ${when}.json`);
  assert.equal(snapshotExportFilename({ kind: "automatic", createdAt }), `Snapshots & Settings/Terminus Automatic Snapshot - ${when}.json`);
  assert.equal(snapshotExportFilename({ kind: "safety", reason: "workspace-removal", createdAt }), `Snapshots & Settings/Terminus Safety Snapshot - ${when}.json`);
  assert.equal(
    snapshotExportFilename({ kind: "manual", reason: "firefox-sync-import", createdAt }),
    `Snapshots & Settings/Terminus Imported Snapshot - ${when}.json`
  );
  assert.equal(settingsBackupExportFilename({ backupKind: "manual", reason: null, createdAt }), `Snapshots & Settings/Terminus Settings Backup - ${when}.json`);
  assert.equal(settingsBackupExportFilename({ backupKind: "automatic", reason: null, createdAt }), `Snapshots & Settings/Terminus Automatic Settings Backup - ${when}.json`);
  assert.equal(
    settingsBackupExportFilename({ backupKind: "manual", reason: "firefox-sync-import", createdAt }),
    `Snapshots & Settings/Terminus Imported Settings Backup - ${when}.json`
  );
  assert.equal(privateSnapshotExportFilename({ kind: "manual", createdAt }), `Snapshots & Settings/Terminus Private Snapshot - ${when}.json`);
  assert.equal(privateSnapshotExportFilename({ kind: "automatic", createdAt }), `Snapshots & Settings/Terminus Private Automatic Snapshot - ${when}.json`);
});

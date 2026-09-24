import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  SNAPSHOT_KINDS,
  createSnapshotRecord,
  finalizeSettingsBackup,
  serializeBackup
} from "../../src/contracts/snapshots.js";
import { SnapshotService } from "../../src/core/snapshot-service.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

function serviceHarness({ failDownload = false } = {}) {
  const calls = [];
  const records = [];
  const downloads = [];
  const settingsBackups = new Map();
  const latestDownloadIds = new Map();
  let latestDigest = null;
  let nextId = 0;
  const service = new SnapshotService({
    repository: {
      async latestAutomaticDigest() { return latestDigest; },
      async save(record) {
        calls.push("save");
        records.push(record);
        if (record.kind === SNAPSHOT_KINDS.AUTOMATIC) {
          latestDigest = record.payloadDigest;
        }
        return record;
      },
      async addDownloadId(id, downloadId) {
        calls.push("record-download");
        const record = records.find((candidate) => candidate.id === id);
        latestDownloadIds.set(record.kind, downloadId);
      },
      async downloadIds(kind) {
        calls.push(["latest-download", kind]);
        const downloadId = latestDownloadIds.get(kind);
        return downloadId === undefined ? [] : [downloadId];
      },
      async applyAutomaticRetention() { calls.push("retention"); return []; },
      async applyAutomaticSettingsRetention() { calls.push("settings-retention"); return []; },
      async previewAutomaticRetention() { return 0; },
      async previewAutomaticSettingsRetention() { return 0; },
      async latestAutomaticSettingsDigest() { return null; },
      async saveSettingsBackup(id, backup) {
        calls.push("save-settings");
        settingsBackups.set(id, backup);
        return {
          id,
          kind: backup.backupKind,
          createdAt: backup.createdAt,
          payloadDigest: backup.payloadDigest,
          byteLength: JSON.stringify(backup).length
        };
      },
      async getSettingsBackup(id) { return settingsBackups.get(id); }
    },
    captureService: {
      async capture() { return createSnapshotPayloadFixture(); }
    },
    downloadsAdapter: {
      async downloadJson(options) {
        calls.push("download");
        downloads.push(options);
        if (failDownload) {
          const error = new Error("Synthetic download failure");
          error.code = "DOWNLOAD_FAILED";
          throw error;
        }
        return 42;
      },
      async removeOwnedFile() { calls.push("remove-file"); return { removed: true }; },
      async openFileLocation(downloadIds) {
        calls.push(["open-location", downloadIds]);
        return { opened: downloadIds.length === 0 ? "downloads-folder" : "snapshot-folder" };
      }
    },
    clock: () => new Date("2026-09-05T20:00:00.000Z"),
    idGenerator: () => `id-${++nextId}`
  });
  return { service, calls, records, downloads, settingsBackups };
}

test("opening and discarding a Snapshot Viewer preview changes no live or stored state", async () => {
  const { service, calls, records, settingsBackups } = serviceHarness();
  const record = await createSnapshotRecord({
    id: "snapshot-preview-only",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T20:00:00.000Z",
    payload: createSnapshotPayloadFixture()
  });
  const original = structuredClone(record);

  const preview = await service.previewText(serializeBackup(record));
  assert.equal(preview.kind, "snapshot");
  assert.notStrictEqual(preview.document, record);
  assert.notStrictEqual(preview.document.payload.workspaceState, record.payload.workspaceState);
  assert.deepEqual(record, original);
  assert.deepEqual(calls, []);
  assert.deepEqual(records, []);
  assert.equal(settingsBackups.size, 0);

  // Closing the viewer discards this detached value; no apply/import method ran.
  assert.deepEqual(record, original);
  assert.deepEqual(calls, []);
});

test("automatic snapshots skip unchanged recoverable state", async () => {
  const { service, calls, records } = serviceHarness();
  const settings = createDefaultSettingsState();
  const first = await service.createFromInventory({}, settings, {
    kind: SNAPSHOT_KINDS.AUTOMATIC
  });
  const second = await service.createFromInventory({}, settings, {
    kind: SNAPSHOT_KINDS.AUTOMATIC
  });
  const forced = await service.createFromInventory({}, settings, {
    kind: SNAPSHOT_KINDS.AUTOMATIC,
    force: true
  });

  assert.equal(first.created, true);
  assert.deepEqual(second, {
    created: false,
    reason: "unchanged",
    record: null,
    download: null,
    removed: []
  });
  assert.equal(forced.created, true);
  assert.equal(records.length, 2);
  assert.deepEqual(calls, ["save", "save"]);
});

test("automatic snapshots stay internal even when a legacy Downloads flag is present", async () => {
  const { service, calls, records, downloads } = serviceHarness({ failDownload: true });
  const defaults = createDefaultSettingsState();
  const settings = {
    ...defaults,
    snapshots: {
      ...defaults.snapshots,
      automaticEnabled: true,
      automaticDownloads: true
    }
  };
  const result = await service.createFromInventory({}, settings, {
    kind: SNAPSHOT_KINDS.AUTOMATIC
  });

  assert.equal(result.created, true);
  assert.equal(result.download, null);
  assert.equal(records.length, 1);
  // The always-on maximum runs after every automatic save; nothing is downloaded.
  assert.deepEqual(calls, ["save", "retention", "settings-retention"]);
  assert.deepEqual(downloads, []);
});

test("manual snapshot creation writes the Snapshots & Settings file after committing locally", async () => {
  const { service, calls, downloads } = serviceHarness();
  const result = await service.createFromInventory({}, createDefaultSettingsState(), {
    kind: SNAPSHOT_KINDS.MANUAL,
    download: true,
    saveAs: false
  });

  assert.equal(result.created, true);
  assert.ok(calls.indexOf("save") < calls.indexOf("download"));
  assert.equal(calls.includes("record-download"), true);
  assert.match(
    downloads[0].filename,
    /^Snapshots & Settings\/Terminus Snapshot - [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}\.\d{2} (AM|PM)\.json$/
  );
  assert.equal(downloads[0].saveAs, false);
});

test("manual and automatic file-location requests use the latest tracked export", async () => {
  const { service, calls } = serviceHarness();
  await service.createFromInventory({}, createDefaultSettingsState(), {
    kind: SNAPSHOT_KINDS.MANUAL,
    download: true
  });

  assert.deepEqual(await service.openFileLocation(SNAPSHOT_KINDS.MANUAL), {
    opened: "snapshot-folder"
  });
  assert.deepEqual(await service.openFileLocation(SNAPSHOT_KINDS.AUTOMATIC), {
    opened: "downloads-folder"
  });
  assert.deepEqual(calls.filter(Array.isArray), [
    ["latest-download", SNAPSHOT_KINDS.MANUAL],
    ["open-location", [42]],
    ["latest-download", SNAPSHOT_KINDS.AUTOMATIC],
    ["open-location", []]
  ]);
});

test("settings backups save preferences internally before an explicit portable export", async () => {
  const { service, calls, downloads, settingsBackups } = serviceHarness();
  const settings = createDefaultSettingsState();
  settings.privacy.keepPrivateTabsBetweenSessions = true;
  const saved = await service.saveSettings(settings);
  assert.equal(saved.created, true);
  assert.deepEqual(
    Object.keys(settingsBackups.get(saved.record.id).payload).sort(),
    ["settings"]
  );
  assert.deepEqual(downloads, []);
  await service.exportSettings(saved.record.id);
  assert.ok(calls.indexOf("save-settings") < calls.indexOf("download"));
  assert.match(downloads[0].filename, /^Snapshots & Settings\/Terminus Settings Backup - .+ (AM|PM)\.json$/);
  assert.equal(downloads[0].saveAs, true);
  const exported = JSON.parse(downloads[0].text);
  assert.deepEqual(Object.keys(exported.payload).sort(), ["settings"]);
  assert.equal(exported.payload.settings.privacy.keepPrivateTabsBetweenSessions, true);
});

test("settings backups and their exports never carry font data", async () => {
  const { service, downloads, settingsBackups } = serviceHarness();
  const settings = createDefaultSettingsState();
  settings.appearance.typography = { source: "generic", fontFamily: "serif", fontSize: 20 };
  const saved = await service.saveSettings(settings);
  assert.deepEqual(
    settingsBackups.get(saved.record.id).payload.settings.appearance.typography,
    settings.appearance.typography
  );
  await service.exportSettings(saved.record.id);
  const exported = JSON.parse(downloads[0].text);
  assert.equal(exported.schemaVersion, 27);
  assert.doesNotMatch(downloads[0].text, /fontAsset|dataBase64/);
});

test("an imported automatic settings backup becomes protected manual history", async () => {
  const { service, settingsBackups } = serviceHarness();
  const source = await finalizeSettingsBackup({
    createdAt: "2026-09-04T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  });

  const { record } = await service.importSettingsText(serializeBackup(source));
  const stored = settingsBackups.get(record.id);

  assert.equal(record.kind, "manual");
  assert.equal(stored.backupKind, "manual");
  assert.equal(stored.reason, null);
  assert.equal(stored.createdAt, source.createdAt);
  assert.deepEqual(stored.payload, source.payload);
});

test("an automatic Settings Backup enforces the maximum right after it is saved", async () => {
  const { service, calls } = serviceHarness();
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticSettingsBackupsEnabled = true;

  const manual = await service.saveSettings(settings);
  assert.deepEqual(manual.removed, []);
  assert.equal(calls.includes("settings-retention"), false);

  const automatic = await service.saveSettings(settings, { kind: "automatic" });
  assert.equal(automatic.created, true);
  assert.deepEqual(automatic.removed, []);
  assert.deepEqual(calls.slice(-3), ["save-settings", "retention", "settings-retention"]);
});

function retentionHarness() {
  const calls = [];
  const service = new SnapshotService({
    repository: {
      async applyAutomaticRetention(rule, now) {
        calls.push(["retention", rule, now]);
        return [{ id: "snapshot-old", downloadIds: [17, 23] }];
      },
      async applyAutomaticSettingsRetention(rule, now) {
        calls.push(["settings-retention", rule, now]);
        return [{ id: "settings-backup-old" }];
      },
      async previewAutomaticRetention(rule, now) {
        calls.push(["preview", rule, now]);
        return 12;
      },
      async previewAutomaticSettingsRetention(rule, now) {
        calls.push(["settings-preview", rule, now]);
        return 3;
      }
    },
    captureService: {},
    downloadsAdapter: {
      async removeOwnedFile(id) { calls.push(["remove", id]); return { removed: true }; }
    },
    clock: () => new Date("2026-09-05T20:00:00.000Z")
  });
  return { service, calls };
}

test("automatic cleanup removes internal automatic records and preserves explicit exports", async () => {
  const { service, calls } = retentionHarness();
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.retentionCount = 1;
  const result = await service.cleanupAutomatic(settings);
  assert.deepEqual(result.removed.map(({ id }) => id), ["snapshot-old"]);
  assert.deepEqual(result.removedSettings.map(({ id }) => id), ["settings-backup-old"]);
  assert.deepEqual(calls.filter(([kind]) => kind === "remove"), []);
  assert.deepEqual(result.files, []);
  assert.deepEqual(calls[0][1], { count: 1 });
  assert.equal(calls[0][2].toISOString(), "2026-09-05T20:00:00.000Z");
});

test("the maximum is the only rule, and nothing runs with no automatic library", async () => {
  const off = retentionHarness();
  const settings = createDefaultSettingsState();
  assert.deepEqual(await off.service.cleanupAutomatic(settings), { removed: [], removedSettings: [], files: [] });
  assert.deepEqual(await off.service.previewCleanup(settings), { sidebarSnapshots: 0, settingsBackups: 0 });
  assert.deepEqual(off.calls, []);

  const on = retentionHarness();
  settings.snapshots.automaticSettingsBackupsEnabled = true;
  settings.snapshots.retentionCount = 9999;
  await on.service.cleanupAutomatic(settings);
  assert.deepEqual(on.calls.map(([kind, rule]) => [kind, rule]), [
    ["retention", { count: 9999 }],
    ["settings-retention", { count: 9999 }]
  ]);
});

test("a cleanup preview only counts and never removes", async () => {
  const { service, calls } = retentionHarness();
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.retentionCount = 5;
  assert.deepEqual(await service.previewCleanup(settings), { sidebarSnapshots: 12, settingsBackups: 3 });
  assert.deepEqual(calls.map(([kind]) => kind), ["preview", "settings-preview"]);
  assert.deepEqual(calls[0][1], { count: 5 });
});

test("clearing the snapshot viewer reports removed kinds without deleting exported files", async () => {
  const calls = [];
  const service = new SnapshotService({
    repository: {
      async clearViewerRecords() {
        calls.push("clear-viewer-records");
        return [
          { id: "snapshot-manual-one", kind: SNAPSHOT_KINDS.MANUAL },
          { id: "snapshot-automatic", kind: SNAPSHOT_KINDS.AUTOMATIC },
          { id: "snapshot-manual-two", kind: SNAPSHOT_KINDS.MANUAL }
        ];
      }
    },
    captureService: {},
    downloadsAdapter: {
      async removeOwnedFile() {
        assert.fail("viewer cleanup must preserve exported files");
      }
    }
  });

  assert.deepEqual(await service.clearViewer(), {
    removed: 3,
    manual: 2,
    automatic: 1
  });
  assert.deepEqual(calls, ["clear-viewer-records"]);
});

test("snapshot and settings writes share one full save-and-retention queue", async () => {
  const calls = [];
  let releaseCapture;
  const captureGate = new Promise((resolve) => { releaseCapture = resolve; });
  const service = new SnapshotService({
    repository: {
      async latestAutomaticDigest() { calls.push("snapshot-digest"); return null; },
      async save(record) { calls.push("snapshot-save"); return record; },
      async latestAutomaticSettingsDigest() { calls.push("settings-digest"); return null; },
      async saveSettingsBackup(id, backup) {
        calls.push("settings-save");
        return { id, kind: backup.backupKind };
      },
      async applyAutomaticRetention() { calls.push("snapshot-retention"); return []; },
      async applyAutomaticSettingsRetention() { calls.push("settings-retention"); return []; }
    },
    captureService: {
      async capture() {
        calls.push("capture-start");
        await captureGate;
        calls.push("capture-finish");
        return createSnapshotPayloadFixture();
      }
    },
    downloadsAdapter: {},
    clock: () => new Date("2026-09-05T20:00:00.000Z"),
    idGenerator: (() => { let id = 0; return () => `queued-${++id}`; })()
  });
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.automaticSettingsBackupsEnabled = true;

  const snapshot = service.createFromInventory({}, settings, { kind: SNAPSHOT_KINDS.AUTOMATIC });
  const settingsBackup = service.saveSettings(settings, { kind: "automatic" });
  await Promise.resolve();
  assert.deepEqual(calls, ["capture-start"]);
  releaseCapture();
  await Promise.all([snapshot, settingsBackup]);
  assert.ok(calls.indexOf("settings-digest") > calls.indexOf("settings-retention"));
});

test("a failed automatic save never starts retention or a competing settings write", async () => {
  const calls = [];
  const expected = new Error("synthetic storage failure");
  const service = new SnapshotService({
    repository: {
      async latestAutomaticDigest() { return null; },
      async save() { calls.push("save"); throw expected; },
      async latestAutomaticSettingsDigest() { calls.push("settings-digest"); return null; },
      async saveSettingsBackup(id, backup) {
        calls.push("settings-save");
        return { id, kind: backup.backupKind };
      },
      async applyAutomaticRetention() { calls.push("retention"); return []; },
      async applyAutomaticSettingsRetention() { calls.push("settings-retention"); return []; }
    },
    captureService: { async capture() { return createSnapshotPayloadFixture(); } },
    downloadsAdapter: {},
    clock: () => new Date("2026-09-05T20:00:00.000Z"),
    idGenerator: () => "failure"
  });
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.automaticSettingsBackupsEnabled = true;

  const failed = service.createFromInventory({}, settings, { kind: SNAPSHOT_KINDS.AUTOMATIC });
  const settingsBackup = service.saveSettings(settings, { kind: "automatic" });
  await assert.rejects(failed, (error) => error === expected);
  await settingsBackup;
  assert.deepEqual(calls, ["save", "settings-digest", "settings-save", "retention", "settings-retention"]);
});

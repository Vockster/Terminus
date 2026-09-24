import test from "node:test";
import assert from "node:assert/strict";

import { createSnapshotMessageHandler } from "../../src/background/snapshot-message-handler.js";
import { SNAPSHOT_MESSAGE_TYPES } from "../../src/contracts/snapshot-messages.js";
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_KINDS,
  SnapshotError,
  createSnapshotRecord
} from "../../src/contracts/snapshots.js";
import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

test("snapshot messages delegate explicit create, list, export, and restore intents", async () => {
  const calls = [];
  const handler = createSnapshotMessageHandler({
    snapshotService: {
      async overview() { calls.push(["overview"]); return { records: [] }; },
      async get(id) { calls.push(["get", id]); return { id }; },
      async export(id) { calls.push(["export", id]); return { id }; },
      async openFileLocation(kind) { calls.push(["open-location", kind]); return { opened: "snapshot-folder" }; },
      async clearViewer() { calls.push(["clear-viewer"]); return { removed: 2 }; },
      async parseText() { return { kind: "settings", document: { documentType: "sidebars.settings" } }; },
      async prepareSettingsBackupForRestore(document) { return document; }
    },
    workspaceController: {
      async createSnapshot(options) { calls.push(["create", options]); return { created: true }; },
      async restoreSnapshot(windowId, record, request) { calls.push(["restore", windowId, record, request]); return { status: "complete" }; },
      async restoreSettingsBackup(windowId, backup, sections) { calls.push(["settings", windowId, backup, sections]); return { status: "complete" }; }
    },
    settingsService: { async getOrInitialize() { return createDefaultSettingsState(); } },
    stateService: {},
    scheduleService: {
      async scheduleAutomaticTest() { calls.push(["test-automatic"]); return { dueAt: "2026-09-06T12:00:05.000Z" }; }
    }
  });
  const sender = { tab: { windowId: 7 } };
  assert.equal((await handler({ type: SNAPSHOT_MESSAGE_TYPES.OVERVIEW }, sender)).ok, true);
  assert.equal((await handler({ type: SNAPSHOT_MESSAGE_TYPES.CREATE }, sender)).ok, true);
  assert.equal((await handler({ type: SNAPSHOT_MESSAGE_TYPES.TEST_AUTOMATIC }, sender)).ok, true);
  assert.equal((await handler({ type: SNAPSHOT_MESSAGE_TYPES.EXPORT, id: "snapshot-one" }, sender)).ok, true);
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.OPEN_FILE_LOCATION,
    kind: "manual"
  }, sender)).ok, true);
  assert.equal((await handler({ type: SNAPSHOT_MESSAGE_TYPES.CLEAR_VIEWER }, sender)).ok, true);
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.RESTORE,
    source: { id: "snapshot-one" },
    request: { scope: "all" }
  }, sender)).ok, true);
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.RESTORE_SETTINGS,
    text: "{}",
    sections: ["sidebar"]
  }, sender)).ok, true);
  assert.deepEqual(calls[0], ["overview"]);
  assert.equal(calls[1][0], "create");
  assert.equal(calls[1][1].windowId, 7);
  assert.equal("download" in calls[1][1], false);
  assert.deepEqual(calls[2], ["test-automatic"]);
  assert.deepEqual(calls[3], ["export", "snapshot-one"]);
  assert.deepEqual(calls[4], ["open-location", "manual"]);
  assert.deepEqual(calls[5], ["clear-viewer"]);
  assert.equal(calls[7][0], "restore");
  assert.equal(calls[8][0], "settings");
});

test("cleanup previews merge only the cleanup maximum and reject anything else before counting", async () => {
  const previews = [];
  const handler = createSnapshotMessageHandler({
    snapshotService: {
      async previewCleanup(settings) {
        previews.push(settings);
        return { sidebarSnapshots: 2, settingsBackups: 1 };
      }
    },
    workspaceController: {},
    settingsService: {
      async getOrInitialize() {
        const settings = createDefaultSettingsState();
        settings.snapshots.automaticEnabled = true;
        return settings;
      }
    }
  });
  const snapshots = { retentionCount: 9999 };
  assert.deepEqual(
    await handler({ type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots }),
    { ok: true, result: { sidebarSnapshots: 2, settingsBackups: 1 } }
  );
  assert.equal(previews[0].snapshots.automaticEnabled, true);
  assert.equal(previews[0].snapshots.retentionCount, 9999);

  for (const message of [
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots, extra: true },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { ...snapshots, automaticEnabled: false } },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { ...snapshots, deleteOldAutomaticEnabled: true } },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { ...snapshots, deleteAfterValue: 2 } },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { retentionCount: 0 } },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { retentionCount: 10_000 } },
    { type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: null }
  ]) {
    const response = await handler(message);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  }
  assert.equal(previews.length, 1);
});

test("snapshot messages reject extra keys and hide private service failures", async () => {
  const handler = createSnapshotMessageHandler({
    snapshotService: {
      async overview() {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_BACKUP, "private URL detail");
      }
    },
    workspaceController: {},
    settingsService: {},
    stateService: {}
  });
  const malformed = await handler({ type: SNAPSHOT_MESSAGE_TYPES.OVERVIEW, extra: true });
  assert.equal(malformed.error.code, SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  const failed = await handler({ type: SNAPSHOT_MESSAGE_TYPES.OVERVIEW });
  assert.equal(failed.error.code, SNAPSHOT_ERROR_CODES.INVALID_BACKUP);
  assert.doesNotMatch(failed.error.message, /private URL detail/);
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.OPEN_FILE_LOCATION,
    kind: "safety"
  })).error.code, SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.CLEAR_VIEWER,
    extra: true
  })).error.code, SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  assert.equal(handler({ type: "unknown" }), undefined);
});

test("direct text preflight and restore cannot claim local provenance", async () => {
  const source = await createSnapshotRecord({
    id: "snapshot-claimed-local",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-06T12:00:00.000Z",
    reason: null,
    payload: createSnapshotPayloadFixture()
  });
  const received = [];
  const handler = createSnapshotMessageHandler({
    snapshotService: {
      async parseText() { return { kind: "snapshot", document: source }; }
    },
    workspaceController: {
      async snapshotContainerPreflight(record) {
        received.push(record);
        return { required: false, references: [], choices: [] };
      },
      async restoreSnapshot(_windowId, record) {
        received.push(record);
        return { status: "complete" };
      }
    },
    settingsService: {},
    stateService: {}
  });
  const sender = { tab: { windowId: 7 } };
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.CONTAINER_PREFLIGHT,
    source: { text: "forged" },
    request: { scope: "all" }
  }, sender)).ok, true);
  assert.equal((await handler({
    type: SNAPSHOT_MESSAGE_TYPES.RESTORE,
    source: { text: "forged" },
    request: { scope: "all" }
  }, sender)).ok, true);
  assert.deepEqual(received.map(({ reason }) => reason), ["file-import", "file-import"]);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createPrivateMessageHandler } from "../../src/background/private-message-handler.js";
import { PRIVATE_MESSAGE_TYPES } from "../../src/contracts/private-messages.js";
import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";

// Schema 31 left the maximum as the only cleanup value a preview may propose.
const CLEANUP_PREVIEW = Object.freeze({
  retentionCount: 5
});

function harness() {
  const calls = [];
  const settingsUrl = "moz-extension://sidebars/src/settings/index.html";
  const handler = createPrivateMessageHandler({
    browserApi: {
      runtime: { getURL() { return settingsUrl; } },
      extension: { async isAllowedIncognitoAccess() { return true; } }
    },
    scheduleService: {
      async schedulePrivateAutomaticTest() { calls.push(["test-automatic"]); return {}; }
    },
    settingsService: {
      async getOrInitialize() { calls.push(["settings"]); return createDefaultSettingsState(); }
    },
    service: {
      async previewCleanup(settings, context) {
        calls.push(["preview-cleanup", settings.snapshots.retentionCount, context]);
        return { privateSnapshots: context.privateContext ? 4 : null };
      },
      async overview(context) { calls.push(["overview", context]); return context; },
      async setPersistence(enabled, windowId) { calls.push(["persistence", enabled, windowId]); return {}; },
      async setAutomaticSnapshots(enabled) { calls.push(["automatic", enabled]); return {}; },
      async clearRecovery() { calls.push(["clear"]); return {}; },
      async createStored(windowId) { calls.push(["create", windowId]); return {}; },
      async getStored(id) { calls.push(["get", id]); return {}; },
      async deleteStored(id) { calls.push(["delete", id]); return {}; },
      async clearStored() { calls.push(["clear-viewer"]); return {}; },
      async exportStored(id) { calls.push(["export-stored", id]); return {}; },
      async previewText(text) { calls.push(["preview", text]); return {}; },
      async importSnapshotText(text) { calls.push(["import", text]); return {}; },
      async restoreViewer(request) { calls.push(["restore-viewer", request]); return {}; },
      async restore(request) { calls.push(["restore", request]); return {}; }
    }
  });
  return {
    calls,
    handler,
    normalSender: { tab: { id: 1, windowId: 10, incognito: false, url: settingsUrl } },
    privateSender: { tab: { id: 2, windowId: 20, incognito: true, url: settingsUrl } }
  };
}

test("private cleanup previews validate exact keys and pass the sender's private context", async () => {
  const testHarness = harness();
  const privateResult = await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: CLEANUP_PREVIEW },
    testHarness.privateSender
  );
  assert.deepEqual(privateResult, { ok: true, result: { privateSnapshots: 4 } });
  const normalResult = await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: CLEANUP_PREVIEW },
    testHarness.normalSender
  );
  assert.deepEqual(normalResult, { ok: true, result: { privateSnapshots: null } });
  assert.deepEqual(testHarness.calls.filter(([kind]) => kind === "preview-cleanup"), [
    ["preview-cleanup", 5, { privateContext: true }],
    ["preview-cleanup", 5, { privateContext: false }]
  ]);

  const before = testHarness.calls.length;
  for (const message of [
    { type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: CLEANUP_PREVIEW, extra: true },
    { type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { ...CLEANUP_PREVIEW, automaticEnabled: true } },
    { type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { ...CLEANUP_PREVIEW, retentionCount: 10000 } },
    { type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots: { ...CLEANUP_PREVIEW, deleteAfterUnit: "hours" } }
  ]) {
    assert.equal((await testHarness.handler(message, testHarness.privateSender)).ok, false);
  }
  assert.equal(
    testHarness.calls.slice(before).some(([kind]) => kind === "preview-cleanup"),
    false
  );
});

test("private file operations require the exact private Settings sender", async () => {
  const testHarness = harness();
  const rejected = await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.EXPORT_STORED, id: "private-snapshot-one" },
    testHarness.normalSender
  );
  assert.equal(rejected.ok, false);
  assert.deepEqual(testHarness.calls, []);

  const accepted = await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.EXPORT_STORED, id: "private-snapshot-one" },
    testHarness.privateSender
  );
  assert.equal(accepted.ok, true);
  assert.deepEqual(testHarness.calls, [["export-stored", "private-snapshot-one"]]);
});

test("private automatic opt-in is shared settings while private history stays private-scoped", async () => {
  const testHarness = harness();
  assert.equal((await testHarness.handler({
    type: PRIVATE_MESSAGE_TYPES.SET_AUTOMATIC_SNAPSHOTS,
    enabled: true
  }, testHarness.normalSender)).ok, true);
  assert.equal((await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.CREATE },
    testHarness.normalSender
  )).ok, false);
  assert.equal((await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.CREATE },
    testHarness.privateSender
  )).ok, true);
  assert.deepEqual(testHarness.calls, [["automatic", true], ["create", 20]]);
});

test("privacy overview is readable in either scope but reports private context exactly", async () => {
  const testHarness = harness();
  const normal = await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.OVERVIEW },
    testHarness.normalSender
  );
  const privateResult = await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.OVERVIEW },
    testHarness.privateSender
  );
  assert.equal(normal.result.privateContext, false);
  assert.equal(privateResult.result.privateContext, true);
  assert.deepEqual(testHarness.calls, [
    ["overview", { privateAccessAllowed: true, privateContext: false }],
    ["overview", { privateAccessAllowed: true, privateContext: true }]
  ]);
});

test("private viewer restore rejects malformed sources and extra fields", async () => {
  const testHarness = harness();
  for (const message of [
    {
      type: PRIVATE_MESSAGE_TYPES.RESTORE_VIEWER,
      source: { id: "private-snapshot-one", extra: true },
      request: { scope: "all" }
    },
    { type: PRIVATE_MESSAGE_TYPES.CLEAR_RECOVERY, extra: true }
  ]) {
    const response = await testHarness.handler(message, testHarness.privateSender);
    assert.equal(response.ok, false);
  }
  assert.deepEqual(testHarness.calls, []);
});

test("the shared snapshot pages delegate private viewer actions only from private Settings", async () => {
  const testHarness = harness();
  for (const message of [
    { type: PRIVATE_MESSAGE_TYPES.TEST_AUTOMATIC },
    { type: PRIVATE_MESSAGE_TYPES.CLEAR_VIEWER },
    { type: PRIVATE_MESSAGE_TYPES.IMPORT, text: "{}" },
    {
      type: PRIVATE_MESSAGE_TYPES.RESTORE_VIEWER,
      source: { id: "private-snapshot-one" },
      request: { scope: "all" }
    }
  ]) {
    assert.equal(
      (await testHarness.handler(message, testHarness.privateSender)).ok,
      true
    );
  }
  assert.deepEqual(testHarness.calls, [
    ["test-automatic"],
    ["clear-viewer"],
    ["import", "{}"],
    ["restore-viewer", {
      source: { id: "private-snapshot-one" },
      request: { scope: "all" },
      windowId: 20
    }]
  ]);
  assert.equal((await testHarness.handler(
    { type: PRIVATE_MESSAGE_TYPES.CLEAR_VIEWER },
    testHarness.normalSender
  )).ok, false);
});

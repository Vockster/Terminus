import test from "node:test";
import assert from "node:assert/strict";

import {
  RETIRED_LOCAL_STORAGE_KEYS,
  RETIRED_FONT_DATABASE_NAME,
  deleteRetiredFontDatabase,
  removeRetiredLocalStorage,
  removeRetiredStorage
} from "../../src/platform/firefox/retired-storage.js";

function deleteFactory(outcome) {
  const calls = [];
  return {
    calls,
    deleteDatabase(name) {
      calls.push(name);
      const request = {};
      queueMicrotask(() => request[`on${outcome}`]?.());
      return request;
    }
  };
}

test("retired local feature state is removed and failures never escape", async () => {
  const removed = [];
  const browserApi = { storage: { local: { remove: async (keys) => removed.push(keys) } } };
  assert.equal(await removeRetiredLocalStorage(browserApi), "removed");
  assert.deepEqual(removed, [[...RETIRED_LOCAL_STORAGE_KEYS]]);
  assert.deepEqual(RETIRED_LOCAL_STORAGE_KEYS, [
    "inputBindingsState",
    "configurationSyncState",
    "snapshotSyncState",
    "configurationSyncSafetyAcknowledgement",
    "terminusDeviceIdentity"
  ]);
  assert.equal(RETIRED_LOCAL_STORAGE_KEYS.includes("configurationSyncApplyJournal"), false);

  const rejecting = { storage: { local: { remove: async () => { throw new Error("denied"); } } } };
  assert.equal(await removeRetiredLocalStorage(rejecting), "failed");
  const throwing = { storage: { local: { remove() { throw new Error("denied"); } } } };
  assert.equal(await removeRetiredLocalStorage(throwing), "failed");
});

test("the retired uploaded-font database is deleted without ever blocking startup", async () => {
  assert.equal(RETIRED_FONT_DATABASE_NAME, "sidebars-font-assets");
  for (const [outcome, expected] of [["success", "deleted"], ["blocked", "blocked"], ["error", "failed"]]) {
    const factory = deleteFactory(outcome);
    assert.equal(await deleteRetiredFontDatabase(factory), expected);
    assert.deepEqual(factory.calls, ["sidebars-font-assets"]);
  }
  assert.equal(
    await deleteRetiredFontDatabase({ deleteDatabase() { throw new Error("security"); } }),
    "failed"
  );
  assert.equal(await deleteRetiredFontDatabase(null), "unavailable");
});

test("both retired stores are cleaned together", async () => {
  const factory = deleteFactory("success");
  const browserApi = { storage: { local: { remove: async () => undefined } } };
  assert.deepEqual(
    await removeRetiredStorage({ browserApi, indexedDBFactory: factory }),
    ["removed", "deleted"]
  );
});

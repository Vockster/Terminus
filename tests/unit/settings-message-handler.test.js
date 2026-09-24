import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsMessageHandler } from "../../src/background/settings-message-handler.js";
import { SETTINGS_MESSAGE_TYPES } from "../../src/contracts/settings-messages.js";
import {
  SETTINGS_STATE_ERROR_CODES,
  SettingsStateError,
  createDefaultSettingsState
} from "../../src/contracts/settings-state.js";

test("settings messages delegate get, update, section reset, and global reset", async () => {
  const defaults = createDefaultSettingsState();
  const calls = [];
  const handler = createSettingsMessageHandler({
    async getOrInitialize() { calls.push("get"); return defaults; },
    async update(patch) { calls.push(["update", patch]); return defaults; },
    async resetSection(section) { calls.push(["resetSection", section]); return defaults; },
    async reset() { calls.push("reset"); return defaults; }
  });

  assert.equal((await handler({ type: SETTINGS_MESSAGE_TYPES.GET })).ok, true);
  assert.equal((await handler({ type: SETTINGS_MESSAGE_TYPES.UPDATE, patch: { sidebar: { dividerSize: 20 } } })).ok, true);
  assert.equal((await handler({ type: SETTINGS_MESSAGE_TYPES.RESET_SECTION, section: "sidebar" })).ok, true);
  assert.equal((await handler({ type: SETTINGS_MESSAGE_TYPES.RESET })).ok, true);
  assert.deepEqual(calls, [
    "get",
    ["update", { sidebar: { dividerSize: 20 } }],
    ["resetSection", "sidebar"],
    "reset"
  ]);
});

test("malformed known requests and service failures return safe envelopes", async () => {
  const handler = createSettingsMessageHandler({
    async getOrInitialize() {
      throw new SettingsStateError(SETTINGS_STATE_ERROR_CODES.INVALID_STATE, "private detail");
    }
  });
  const malformed = await handler({ type: SETTINGS_MESSAGE_TYPES.GET, extra: true });
  assert.equal(malformed.error.code, SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST);
  const failed = await handler({ type: SETTINGS_MESSAGE_TYPES.GET });
  assert.equal(failed.error.code, SETTINGS_STATE_ERROR_CODES.INVALID_STATE);
  assert.doesNotMatch(failed.error.message, /private detail/);
});

test("unknown and non-record settings messages remain unhandled", () => {
  const handler = createSettingsMessageHandler({});
  assert.equal(handler({ type: "unknown" }), undefined);
  assert.equal(handler(null), undefined);
  assert.equal(handler([]), undefined);
});

test("global reset uses the safety path and fails closed without a sender window", async () => {
  const calls = [];
  const handler = createSettingsMessageHandler(
    {
      async reset() { assert.fail("the production safety path must not fall back to a plain reset"); }
    },
    {
      async resetWithSafety(windowId) {
        calls.push(windowId);
        return createDefaultSettingsState();
      }
    }
  );

  const succeeded = await handler(
    { type: SETTINGS_MESSAGE_TYPES.RESET },
    { tab: { windowId: 17 } }
  );
  assert.equal(succeeded.ok, true);
  assert.deepEqual(calls, [17]);

  const rejected = await handler({ type: SETTINGS_MESSAGE_TYPES.RESET }, {});
  assert.equal(rejected.error.code, SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST);
  assert.deepEqual(calls, [17]);
});

test("global reset clears device-local state first and a failed clear resets nothing", async () => {
  const calls = [];
  let clearFails = false;
  const handler = createSettingsMessageHandler({}, {
    async beforeReset() {
      calls.push("beforeReset");
      if (clearFails) throw new Error("storage unavailable");
    },
    async resetWithSafety(windowId) {
      calls.push(["reset", windowId]);
      return createDefaultSettingsState();
    }
  });

  assert.equal((await handler({ type: SETTINGS_MESSAGE_TYPES.RESET }, { tab: { windowId: 3 } })).ok, true);
  assert.deepEqual(calls, ["beforeReset", ["reset", 3]]);

  clearFails = true;
  const failed = await handler({ type: SETTINGS_MESSAGE_TYPES.RESET }, { tab: { windowId: 3 } });
  assert.equal(failed.ok, false);
  assert.deepEqual(calls, ["beforeReset", ["reset", 3], "beforeReset"]);

  const noWindow = await handler({ type: SETTINGS_MESSAGE_TYPES.RESET }, {});
  assert.equal(noWindow.error.code, SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(calls.length, 3, "an invalid request clears nothing");
});

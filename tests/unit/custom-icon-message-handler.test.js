import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_MESSAGE_TYPES,
  CustomIconError
} from "../../src/contracts/custom-icons.js";
import { createCustomIconMessageHandler } from "../../src/background/custom-icon-message-handler.js";
import { pngBytes } from "../helpers/custom-icon-fixture.js";

function createService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async list() {
      calls.push(["list"]);
      return { icons: [], usage: { iconCount: 0, byteCount: 0 } };
    },
    async add(label, bytes) {
      calls.push(["add", label, bytes.byteLength]);
      return { icon: { id: "custom-1" }, duplicate: false };
    },
    async remove(id) {
      calls.push(["remove", id]);
      return { id, reassignedWorkspaceCount: 0 };
    },
    ...overrides
  };
}

test("custom icon messages route to the service and wrap results", async () => {
  const service = createService();
  const handle = createCustomIconMessageHandler({ service });
  const id = `custom-${"a".repeat(32)}`;

  assert.deepEqual(await handle({ type: CUSTOM_ICON_MESSAGE_TYPES.LIST }), {
    ok: true,
    type: CUSTOM_ICON_MESSAGE_TYPES.LIST,
    result: { icons: [], usage: { iconCount: 0, byteCount: 0 } }
  });
  assert.equal(
    (await handle({ type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label: "Logo", bytes: pngBytes() })).ok,
    true
  );
  assert.deepEqual(
    (await handle({ type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE, id })).result,
    { id, reassignedWorkspaceCount: 0 }
  );
  assert.deepEqual(service.calls, [["list"], ["add", "Logo", 64], ["remove", id]]);
});

test("other messages are left for other handlers", () => {
  const handle = createCustomIconMessageHandler({ service: createService() });
  assert.equal(handle({ type: "favicon-cache/overview" }), undefined);
  assert.equal(handle({ type: CUSTOM_ICON_MESSAGE_TYPES.CHANGED, change: "added" }), undefined);
  assert.equal(handle(null), undefined);
});

test("malformed requests and service failures return safe error envelopes", async () => {
  const handle = createCustomIconMessageHandler({
    service: createService({
      async add() {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED);
      },
      async list() {
        throw new Error("raw storage detail");
      }
    })
  });
  assert.deepEqual(
    (await handle({ type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE, id: "house" })).error.code,
    CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(
    (await handle({ type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label: "Logo", bytes: pngBytes() })).error.code,
    CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED
  );
  const failure = await handle({ type: CUSTOM_ICON_MESSAGE_TYPES.LIST });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);
  assert.doesNotMatch(failure.error.message, /raw storage detail/);
});

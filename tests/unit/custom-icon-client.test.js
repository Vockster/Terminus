import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOM_ICON_ERROR_CODES, CUSTOM_ICON_MESSAGE_TYPES, customIconSummary, parseCustomIconRecord } from "../../src/contracts/custom-icons.js";
import { createCustomIconClient } from "../../src/ui/custom-icon-client.js";
import { customIconRecord, pngBytes } from "../helpers/custom-icon-fixture.js";

test("the client sends exact messages and validates the list it receives", async () => {
  const sent = [];
  const summary = customIconSummary(parseCustomIconRecord(customIconRecord()));
  const client = createCustomIconClient(async (message) => {
    sent.push(message.type);
    if (message.type === CUSTOM_ICON_MESSAGE_TYPES.LIST) {
      return { ok: true, result: { icons: [summary], usage: { iconCount: 1, byteCount: 64 } } };
    }
    return { ok: true, result: { echoed: message } };
  });
  assert.equal((await client.list()).icons[0].label, summary.label);
  const bytes = pngBytes();
  assert.deepEqual((await client.add("Logo", bytes)).echoed, {
    type: CUSTOM_ICON_MESSAGE_TYPES.ADD,
    label: "Logo",
    bytes
  });
  assert.deepEqual((await client.remove(summary.id)).echoed, {
    type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE,
    id: summary.id
  });
  assert.deepEqual(sent, [
    CUSTOM_ICON_MESSAGE_TYPES.LIST,
    CUSTOM_ICON_MESSAGE_TYPES.ADD,
    CUSTOM_ICON_MESSAGE_TYPES.REMOVE
  ]);
});

test("failures become known custom icon errors", async () => {
  const limited = createCustomIconClient(async () => ({
    ok: false,
    error: { code: CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED, message: "ignored" }
  }));
  await assert.rejects(limited.add("Logo", pngBytes()), (error) => error.code === CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED);

  const unknown = createCustomIconClient(async () => ({ ok: false, error: { code: "SOMETHING" } }));
  await assert.rejects(unknown.list(), (error) => error.code === CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);

  const unreachable = createCustomIconClient(async () => {
    throw new Error("Could not establish connection.");
  });
  await assert.rejects(unreachable.list(), (error) => error.code === CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE);

  const malformed = createCustomIconClient(async () => ({ ok: true, result: { icons: "nope" } }));
  await assert.rejects(malformed.list(), (error) => error.code === CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createSidebarUndoMessageHandler } from "../../src/background/sidebar-undo-message-handler.js";
import { SIDEBAR_UNDO_MESSAGE_TYPES } from "../../src/contracts/sidebar-undo.js";

const emptySummary = { available: false, undoId: null, operation: null, label: null, action: null };
const outcome = {
  status: "applied",
  requestedCount: 1,
  restoredCount: 1,
  skippedCount: 0,
  failedCount: 0,
  approximatedCount: 0,
  retainedSafetyCount: 0,
  reasons: []
};

test("sidebar Undo messages are strict and unknown messages stay unhandled", async () => {
  const handler = createSidebarUndoMessageHandler({
    async getSummary() { return { scope: "normal", summary: emptySummary }; },
    async execute() { return { view: { marker: true }, outcome }; }
  });
  assert.equal(handler({ type: "unrelated" }, {}), undefined);
  assert.equal((await handler({
    type: SIDEBAR_UNDO_MESSAGE_TYPES.GET,
    windowId: 7,
    extra: true
  }, {})).ok, false);
  assert.equal((await handler({
    type: SIDEBAR_UNDO_MESSAGE_TYPES.EXECUTE,
    windowId: 7
  }, {})).ok, false);
});

test("sidebar Undo get and execute expose only parsed public results", async () => {
  const calls = [];
  const handler = createSidebarUndoMessageHandler({
    async getSummary(request) {
      calls.push(["get", request]);
      return { scope: "private", summary: emptySummary };
    },
    async execute(request) {
      calls.push(["execute", request]);
      return { view: { marker: true }, outcome };
    }
  });
  assert.deepEqual(await handler({
    type: SIDEBAR_UNDO_MESSAGE_TYPES.GET,
    windowId: 8
  }, { url: "sidebar" }), {
    ok: true,
    scope: "private",
    summary: emptySummary
  });
  assert.deepEqual(await handler({
    type: SIDEBAR_UNDO_MESSAGE_TYPES.EXECUTE,
    windowId: 8,
    undoId: "undo-one"
  }, { url: "sidebar" }), {
    ok: true,
    view: { marker: true },
    outcome,
    summary: emptySummary
  });
  assert.equal(calls[1][1].undoId, "undo-one");
});

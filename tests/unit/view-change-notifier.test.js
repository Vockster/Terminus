import test from "node:test";
import assert from "node:assert/strict";

import { createViewChangeNotifier } from "../../src/background/view-change-notifier.js";

test("a rebuilt view identical to the last notified one is suppressed per window", async () => {
  const sent = [];
  const notifier = createViewChangeNotifier(async (windowId) => sent.push(windowId));

  assert.equal(await notifier.notify(7, { activeWorkspaceId: "ws-a" }), true);
  assert.equal(await notifier.notify(7, { activeWorkspaceId: "ws-a" }), false);
  assert.equal(await notifier.notify(8, { activeWorkspaceId: "ws-a" }), true);
  assert.equal(await notifier.notify(7, { activeWorkspaceId: "ws-b" }), true);
  assert.deepEqual(sent, [7, 8, 7]);
});

test("a notification without a view always sends and resets the comparison", async () => {
  const sent = [];
  const notifier = createViewChangeNotifier(async (windowId) => sent.push(windowId));

  await notifier.notify(7, { activeWorkspaceId: "ws-a" });
  assert.equal(await notifier.notify(7), true);
  assert.equal(
    await notifier.notify(7, { activeWorkspaceId: "ws-a" }),
    true,
    "a viewless notification invalidates the remembered view"
  );
  assert.deepEqual(sent, [7, 7, 7]);
});

test("forgetting a closed window clears its remembered view", async () => {
  const sent = [];
  const notifier = createViewChangeNotifier(async (windowId) => sent.push(windowId));

  await notifier.notify(7, { activeWorkspaceId: "ws-a" });
  notifier.forget(7);
  assert.equal(await notifier.notify(7, { activeWorkspaceId: "ws-a" }), true);
  assert.deepEqual(sent, [7, 7]);
});

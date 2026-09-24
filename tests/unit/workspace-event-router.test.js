import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceEventRouter } from "../../src/background/workspace-event-router.js";

test("event router coalesces queued bursts and reruns once when dirtied in flight", async () => {
  let listener;
  let releaseFirst;
  const calls = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => { listener = undefined; };
      },
      async listNormalWindowIds() {
        return [7, 8];
      }
    },
    controller: {
      async reconcileWindow(windowId) {
        calls.push(windowId);
        if (calls.length === 1) {
          await new Promise((resolve) => { releaseFirst = resolve; });
        }
      }
    }
  });
  router.start();

  listener({ kind: "tab-created", windowIds: [7] });
  listener({ kind: "tab-updated", windowIds: [7] });
  await Promise.resolve();
  assert.deepEqual(calls, [7]);

  listener({ kind: "tab-moved", windowIds: [7] });
  listener({ kind: "tab-updated", windowIds: [7] });
  releaseFirst();
  await router.whenIdle();
  assert.deepEqual(calls, [7, 7]);
});

test("event router expands unknown and removed-window events to current normal windows", async () => {
  let listener;
  const calls = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => {};
      },
      async listNormalWindowIds() {
        return [7, 8];
      }
    },
    controller: {
      async reconcileWindow(windowId) {
        calls.push(windowId);
      }
    }
  });
  router.start();
  listener({ kind: "window-removed", windowIds: [9] });
  await Promise.resolve();
  await router.whenIdle();
  assert.deepEqual(calls.sort(), [7, 8]);
});

test("event router does not reconcile a window while Firefox is closing it", async () => {
  let listener;
  const calls = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => {};
      },
      async listNormalWindowIds() {
        return [];
      }
    },
    controller: {
      async reconcileWindow(windowId) {
        calls.push(windowId);
      }
    }
  });
  router.start();
  listener({ kind: "tab-removed", windowIds: [7], isWindowClosing: true });
  await Promise.resolve();
  await router.whenIdle();
  assert.deepEqual(calls, []);
});

test("tab removals notify the sidebar immediately and retry reconciliation once", async () => {
  let listener;
  let attempts = 0;
  const removed = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => {};
      },
      async listNormalWindowIds() {
        return [7];
      }
    },
    controller: {
      async reconcileWindow(windowId, evidence) {
        attempts += 1;
        assert.equal(windowId, 7);
        if (attempts === 1) {
          assert.equal(evidence.events[0].generation, 4);
          throw new Error("synthetic lifecycle race");
        }
      }
    },
    onTabRemoved(windowId, tabId) {
      removed.push([windowId, tabId]);
    }
  });
  router.start();

  listener({
    kind: "tab-removed",
    windowIds: [7],
    tabId: 11,
    isWindowClosing: false,
    generation: 4
  });
  assert.deepEqual(removed, [[7, 11]]);
  await router.whenIdle();
  assert.equal(attempts, 2);
});

function controlledClock() {
  let current = 1_000;
  const timers = [];
  return {
    now: () => current,
    setTimer(callback, delay) { timers.push({ at: current + delay, callback }); },
    async advance(ms) {
      current += ms;
      for (const timer of timers.filter(({ at }) => at <= current)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    },
    pending: () => timers.length
  };
}

test("a title storm is reconciled in spaced passes instead of back-to-back", async () => {
  let listener;
  const clock = controlledClock();
  const passes = [];
  let running = 0;
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(next) { listener = next; return () => {}; },
      async listNormalWindowIds() { return [7]; }
    },
    controller: {
      async reconcileWindow(windowId, { events }) {
        running += 1;
        assert.equal(running, 1, "passes for one window never overlap");
        passes.push({ at: clock.now(), events: events.length });
        await Promise.resolve();
        running -= 1;
      }
    },
    presentationDelayMs: 250,
    setTimer: clock.setTimer,
    now: clock.now
  });
  router.start();
  const title = () => listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["title"] });

  title();
  await clock.advance(0);
  assert.equal(passes.length, 1, "the first update reconciles at once");
  for (let step = 0; step < 20; step += 1) {
    title();
    title();
    await clock.advance(50);
  }
  await clock.advance(1000);
  await router.whenIdle();
  const gaps = passes.slice(1).map((pass, index) => pass.at - passes[index].at);
  assert.ok(gaps.every((gap) => gap >= 250), `passes are spaced: ${gaps}`);
  assert.ok(passes.length <= 6, `40 title events over a second took ${passes.length} passes`);
  assert.equal(passes.reduce((sum, pass) => sum + pass.events, 0), 41, "no event is dropped");
});

test("a structural event cuts a pending presentation delay short without a second pass", async () => {
  let listener;
  const clock = controlledClock();
  const passes = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(next) { listener = next; return () => {}; },
      async listNormalWindowIds() { return [7]; }
    },
    controller: {
      async reconcileWindow(_windowId, { events }) {
        passes.push(events.map(({ kind }) => kind));
      }
    },
    presentationDelayMs: 250,
    setTimer: clock.setTimer,
    now: clock.now
  });
  router.start();

  listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["title"] });
  await clock.advance(0);
  listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["audible"] });
  await clock.advance(10);
  assert.equal(passes.length, 1, "the second presentation update waits");
  listener({ kind: "tab-activated", windowIds: [7], tabId: 12 });
  await clock.advance(0);
  assert.deepEqual(passes, [["tab-updated"], ["tab-updated", "tab-activated"]]);
  await clock.advance(500);
  await router.whenIdle();
  assert.equal(passes.length, 2, "the superseded timer does not run another pass");
});

test("open views are told to refresh once after a reconcile finally fails", async () => {
  let listener;
  let attempts = 0;
  const notified = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => {};
      },
      async listNormalWindowIds() {
        return [7];
      }
    },
    controller: {
      async reconcileWindow() {
        attempts += 1;
        throw new Error("synthetic browser failure");
      }
    },
    async onReconciled(windowId) {
      notified.push(windowId);
      throw new Error("no open sidebar");
    }
  });
  router.start();

  listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["title"] });
  await router.whenIdle();
  assert.equal(attempts, 2);
  assert.deepEqual(notified, [7]);
});

test("visibility contention permits one re-hide cycle per burst", async () => {
  let listener;
  const clock = controlledClock();
  let reconciliations = 0;
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(next) { listener = next; return () => {}; },
      async listNormalWindowIds() { return [7]; }
    },
    controller: {
      async reconcileWindow() { reconciliations += 1; }
    },
    now: clock.now,
    setTimer: clock.setTimer
  });
  router.start();

  for (const hidden of [true, false, true, false, true, false]) {
    listener({
      kind: "tab-updated",
      windowIds: [7],
      tabId: 11,
      changed: ["hidden"],
      hidden
    });
    await router.whenIdle();
  }
  assert.equal(reconciliations, 2, "one echo and one counter-mutation are bounded");

  await clock.advance(2000);
  listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["hidden"], hidden: false });
  await router.whenIdle();
  assert.equal(reconciliations, 3, "a later independent visibility change can recover");

  listener({ kind: "tab-moved", windowIds: [7], tabId: 11 });
  await router.whenIdle();
  listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["hidden"], hidden: false });
  await router.whenIdle();
  assert.equal(reconciliations, 5, "structural work resets the contention latch");
});

test("URL-only updates extend snapshot readiness without reconciling workspaces", async () => {
  let listener;
  let reconciliations = 0;
  const activity = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(next) { listener = next; return () => {}; },
      async listNormalWindowIds() { return [7]; }
    },
    controller: {
      async reconcileWindow() { reconciliations += 1; }
    },
    onStructuralActivity: (event) => activity.push(event.kind)
  });
  router.start();

  listener({ kind: "tab-updated", windowIds: [7], tabId: 11, changed: ["url"] });
  await router.whenIdle();
  assert.equal(reconciliations, 0);
  assert.deepEqual(activity, ["tab-updated"]);
});

test("event router hands the reconciled view to onReconciled and skips the container refresh", async () => {
  let listener;
  const reconciled = [];
  const optionsSeen = [];
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => {};
      },
      async listNormalWindowIds() { return [7]; }
    },
    controller: {
      async reconcileWindow(windowId, options) {
        optionsSeen.push(options);
        return { windowId, view: "reconciled" };
      }
    },
    onReconciled: (windowId, view) => { reconciled.push([windowId, view]); }
  });
  router.start();

  listener({ kind: "tab-created", windowIds: [7] });
  await router.whenIdle();

  assert.deepEqual(reconciled, [[7, { windowId: 7, view: "reconciled" }]]);
  assert.equal(optionsSeen.length, 1);
  assert.equal(optionsSeen[0].refreshContainers, false);
  assert.ok(Array.isArray(optionsSeen[0].events));
});

test("event router notifies with no view after the bounded retry finally fails", async () => {
  let listener;
  const reconciled = [];
  let attempts = 0;
  const router = createWorkspaceEventRouter({
    browserAdapter: {
      subscribeWorkspaceEvents(nextListener) {
        listener = nextListener;
        return () => {};
      },
      async listNormalWindowIds() { return [7]; }
    },
    controller: {
      async reconcileWindow() {
        attempts += 1;
        throw new Error("refused");
      }
    },
    onReconciled: (windowId, view) => { reconciled.push([windowId, view]); }
  });
  router.start();

  listener({ kind: "tab-created", windowIds: [7] });
  await router.whenIdle();

  assert.equal(attempts, 2, "one bounded retry follows the first failure");
  assert.deepEqual(reconciled, [[7, null]], "sidebars still hear about the failed pass");
});

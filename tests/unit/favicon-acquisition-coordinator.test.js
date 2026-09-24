import test from "node:test";
import assert from "node:assert/strict";

import { FaviconAcquisitionCoordinator } from "../../src/core/favicon-acquisition-coordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("favicon acquisition is globally bounded at four and coalesces one origin", async () => {
  const coordinator = new FaviconAcquisitionCoordinator({ maximum: 4 });
  const gates = Array.from({ length: 5 }, deferred);
  let running = 0;
  let maximum = 0;
  const work = gates.map((gate, index) => coordinator.enqueue({
    origin: `https://${index}.invalid`,
    sourceDigest: String(index),
    tabId: index,
    async run() {
      running += 1;
      maximum = Math.max(maximum, running);
      await gate.promise;
      running -= 1;
      return index;
    }
  }));
  await Promise.resolve();
  assert.equal(coordinator.activeCount, 4);
  assert.equal(coordinator.pendingCount, 1);
  const duplicate = coordinator.enqueue({
    origin: "https://0.invalid",
    sourceDigest: "0",
    tabId: 99,
    run: () => assert.fail("coalesced work must not run twice")
  });
  assert.strictEqual(duplicate, work[0]);
  gates[0].resolve();
  assert.equal(await work[0], 0);
  await Promise.resolve();
  assert.equal(coordinator.activeCount, 4);
  for (const gate of gates.slice(1)) gate.resolve();
  await Promise.all(work);
  assert.equal(maximum, 4);
  assert.equal(coordinator.activeCount, 0);
});

test("a tab removal aborts work only after its last coalesced reference leaves", async () => {
  const coordinator = new FaviconAcquisitionCoordinator({ maximum: 1 });
  let signal;
  const gate = deferred();
  const first = coordinator.enqueue({
    origin: "https://one.invalid",
    sourceDigest: "same",
    tabId: 1,
    async run(value) { signal = value; await gate.promise; }
  });
  const second = coordinator.enqueue({
    origin: "https://one.invalid",
    sourceDigest: "same",
    tabId: 2,
    run() {}
  });
  await Promise.resolve();
  coordinator.cancelTab(1);
  assert.equal(signal.aborted, false);
  coordinator.cancelTab(2);
  assert.equal(signal.aborted, true);
  gate.resolve();
  await Promise.allSettled([first, second]);
});

test("rapid candidate churn is throttled before a later source replaces work", async () => {
  let now = 0;
  let trailingTimer;
  const coordinator = new FaviconAcquisitionCoordinator({
    maximum: 1,
    sourceChangeRetryMs: 100,
    now: () => now,
    setTimer(callback) { trailingTimer = callback; return 1; },
    clearTimer() { trailingTimer = undefined; }
  });
  const first = coordinator.enqueue({
    origin: "https://one.invalid",
    sourceDigest: "old",
    tabId: 1,
    run(signal) {
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  });
  first.catch(() => undefined);
  now = 50;
  const throttled = coordinator.enqueue({
    origin: "https://one.invalid", sourceDigest: "new", tabId: 1, run() {}
  });
  assert.notStrictEqual(throttled, first);
  now = 101;
  let latestRuns = 0;
  const replacement = coordinator.enqueue({
    origin: "https://one.invalid", sourceDigest: "latest", tabId: 1,
    run() { latestRuns += 1; return "latest"; }
  });
  assert.strictEqual(replacement, throttled);
  trailingTimer();
  await assert.rejects(first);
  assert.equal(await replacement, "latest");
  assert.equal(latestRuns, 1);
});

test("different tabs on one site acquire their different sources independently", async () => {
  const coordinator = new FaviconAcquisitionCoordinator({ maximum: 1, sourceChangeRetryMs: 1000, now: () => 0 });
  const ran = [];
  const first = coordinator.enqueue({
    origin: "https://video.invalid", sourceDigest: "old-build", tabId: 1,
    async run() { ran.push("old-build"); }
  });
  const second = coordinator.enqueue({
    origin: "https://video.invalid", sourceDigest: "new-build", tabId: 2,
    async run() { ran.push("new-build"); }
  });
  assert.notStrictEqual(second, first);
  await Promise.all([first, second]);
  assert.deepEqual(ran, ["old-build", "new-build"]);

  const gate = deferred();
  let signal;
  const running = coordinator.enqueue({
    origin: "https://site.invalid", sourceDigest: "shared", tabId: 3,
    async run(value) { signal = value; await gate.promise; }
  });
  await Promise.resolve();
  coordinator.invalidateOrigin("https://other.invalid");
  assert.equal(signal.aborted, false);
  coordinator.invalidateOrigin("https://site.invalid");
  assert.equal(signal.aborted, true);
  gate.resolve();
  await Promise.allSettled([running]);
});

test("background shutdown aborts and settles running and queued acquisitions", async () => {
  const coordinator = new FaviconAcquisitionCoordinator({ maximum: 1 });
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const running = coordinator.enqueue({
    origin: "https://running.invalid",
    sourceDigest: "running",
    tabId: 1,
    run(signal) {
      markStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  const queued = coordinator.enqueue({
    origin: "https://queued.invalid",
    sourceDigest: "queued",
    tabId: 2,
    run() {
      assert.fail("queued shutdown work must not start");
    }
  });
  await started;
  coordinator.close();
  const results = await Promise.allSettled([running, queued]);
  assert.deepEqual(results.map(({ status }) => status), ["rejected", "rejected"]);
  assert.equal(coordinator.activeCount, 0);
  assert.equal(coordinator.pendingCount, 0);
});

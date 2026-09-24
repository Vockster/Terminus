import test from "node:test";
import assert from "node:assert/strict";

import {
  SNAPSHOT_CAPTURE_ALARM_NAME,
  SNAPSHOT_CLEANUP_ALARM_NAME
} from "../../src/contracts/snapshots.js";
import {
  SnapshotStartupCoordinator,
  SnapshotStartupReadiness
} from "../../src/background/snapshot-startup-coordinator.js";

function immediateReadiness(options = {}) {
  let now = 0;
  const readiness = new SnapshotStartupReadiness({
    quietMilliseconds: 100,
    maxWaitMilliseconds: 500,
    now: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    ...options
  });
  return { readiness, now: () => now };
}

test("an overdue capture waits for initialization and both reconcilers", async () => {
  const sequence = [];
  const { readiness } = immediateReadiness();
  const routers = ["normal", "private"].map((name) => ({
    async enqueueAll() { sequence.push(`${name}:enqueue`); },
    async whenIdle() { sequence.push(`${name}:idle`); }
  }));
  const coordinator = new SnapshotStartupCoordinator({
    async ensureInitialized() { sequence.push("initialized"); },
    scheduleService: {
      async handleAlarm(name) {
        sequence.push(`alarm:${name}`);
        return { created: true };
      }
    },
    routers,
    readiness
  });

  const result = await coordinator.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME);
  assert.deepEqual(sequence, [
    "initialized",
    "normal:enqueue",
    "private:enqueue",
    "normal:idle",
    "private:idle",
    `alarm:${SNAPSHOT_CAPTURE_ALARM_NAME}`
  ]);
  assert.deepEqual(result.startupReadiness, { timedOut: false, waitedMilliseconds: 100 });
});

test("structural churn repeats reconciliation but releases at the hard bound", async () => {
  let now = 0;
  let readiness;
  let reconciliations = 0;
  readiness = new SnapshotStartupReadiness({
    quietMilliseconds: 100,
    maxWaitMilliseconds: 250,
    now: () => now,
    wait: async (milliseconds) => {
      const firstHalf = Math.ceil(milliseconds / 2);
      now += firstHalf;
      readiness.noteStructuralActivity();
      now += milliseconds - firstHalf;
    }
  });

  const result = await readiness.waitUntilSettled(async () => { reconciliations += 1; });
  assert.equal(result.timedOut, true);
  assert.equal(result.waitedMilliseconds, 250);
  assert.ok(reconciliations >= 3);
});

test("a failed initializer blocks capture and a later alarm retries", async () => {
  let initializationAttempts = 0;
  let captures = 0;
  const { readiness } = immediateReadiness();
  const coordinator = new SnapshotStartupCoordinator({
    async ensureInitialized() {
      initializationAttempts += 1;
      if (initializationAttempts === 1) throw new Error("synthetic startup failure");
    },
    scheduleService: {
      async handleAlarm() { captures += 1; return { created: false }; }
    },
    routers: [{ async enqueueAll() {}, async whenIdle() {} }],
    readiness
  });

  await assert.rejects(
    coordinator.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME),
    /synthetic startup failure/
  );
  await coordinator.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME);
  assert.equal(initializationAttempts, 2);
  assert.equal(captures, 1);
});

test("non-capture alarms await initialization without a startup quiet delay", async () => {
  const sequence = [];
  const { readiness, now } = immediateReadiness();
  const coordinator = new SnapshotStartupCoordinator({
    async ensureInitialized() { sequence.push("initialized"); },
    scheduleService: {
      async handleAlarm(name) { sequence.push(name); return { removed: [] }; }
    },
    routers: [],
    readiness
  });

  await coordinator.handleAlarm(SNAPSHOT_CLEANUP_ALARM_NAME);
  assert.deepEqual(sequence, ["initialized", SNAPSHOT_CLEANUP_ALARM_NAME]);
  assert.equal(now(), 0);
});

test("a retry after a failed capture skips the settle burst and still captures", async () => {
  const sequence = [];
  const { readiness } = immediateReadiness();
  const routers = [{
    async enqueueAll() { sequence.push("enqueue"); },
    async whenIdle() { sequence.push("idle"); }
  }];
  const coordinator = new SnapshotStartupCoordinator({
    async ensureInitialized() { sequence.push("initialized"); },
    scheduleService: {
      async lastCaptureFailed() { return true; },
      async handleAlarm(name) {
        sequence.push(`alarm:${name}`);
        return { created: false, reason: "blocked" };
      }
    },
    routers,
    readiness
  });

  const result = await coordinator.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME);
  assert.deepEqual(sequence, ["initialized", `alarm:${SNAPSHOT_CAPTURE_ALARM_NAME}`]);
  assert.deepEqual(result.startupReadiness, {
    timedOut: false,
    waitedMilliseconds: 0,
    skippedForRetry: true
  });
});

test("a healthy capture alarm still settles both reconcilers first", async () => {
  const sequence = [];
  const { readiness } = immediateReadiness();
  const routers = [{
    async enqueueAll() { sequence.push("enqueue"); },
    async whenIdle() { sequence.push("idle"); }
  }];
  const coordinator = new SnapshotStartupCoordinator({
    async ensureInitialized() { sequence.push("initialized"); },
    scheduleService: {
      async lastCaptureFailed() { return false; },
      async handleAlarm(name) {
        sequence.push(`alarm:${name}`);
        return { created: true };
      }
    },
    routers,
    readiness
  });

  await coordinator.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME);
  assert.deepEqual(sequence, [
    "initialized",
    "enqueue",
    "idle",
    `alarm:${SNAPSHOT_CAPTURE_ALARM_NAME}`
  ]);
});

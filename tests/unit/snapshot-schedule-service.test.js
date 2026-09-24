import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  SNAPSHOT_CAPTURE_ALARM_NAME,
  SNAPSHOT_CLEANUP_ALARM_NAME,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_PRIVATE_TEST_ALARM_NAME,
  SNAPSHOT_TEST_ALARM_NAME,
  createDefaultSnapshotScheduleState
} from "../../src/contracts/snapshots.js";
import {
  SnapshotScheduleService,
  snapshotIntervalMilliseconds
} from "../../src/core/snapshot-schedule-service.js";

function schedulerHarness(settings, { captureAutomatic } = {}) {
  let state = createDefaultSnapshotScheduleState();
  const alarms = new Map();
  const calls = [];
  const protections = [];
  const clock = () => new Date("2026-09-05T20:00:00.000Z");
  const service = new SnapshotScheduleService({
    settingsService: { async getOrInitialize() { return structuredClone(settings); } },
    repository: {
      async readScheduleState() { return structuredClone(state); },
      async writeScheduleState(value) { state = structuredClone(value); return state; },
      async ensureStartupProtection(at) { protections.push(at.toISOString()); }
    },
    alarmsAdapter: {
      async get(name) { return alarms.get(name) ?? null; },
      create(name, when, periodInMinutes) {
        calls.push(["create", name, when, periodInMinutes]);
        alarms.set(name, { scheduledTime: when, periodInMinutes });
      },
      async clear(name) { calls.push(["clear", name]); return alarms.delete(name); }
    },
    async captureAutomatic(_settings, libraries) {
      calls.push(["capture", [...libraries]]);
      if (captureAutomatic) return captureAutomatic(_settings, libraries);
      return { created: true };
    },
    async captureAutomaticTest() { calls.push(["test-capture"]); return { created: true }; },
    async capturePrivateAutomaticTest() { calls.push(["private-test-capture"]); return { created: true }; },
    async cleanupAutomatic() { calls.push(["cleanup"]); return { removed: [] }; },
    clock
  });
  return {
    service,
    calls,
    protections,
    alarms,
    state: () => structuredClone(state),
    setState(next) { state = structuredClone(next); }
  };
}

test("the capture schedule stops when automatic snapshots are disabled", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  const harness = schedulerHarness(settings);

  await harness.service.synchronize();
  let state = harness.state();
  assert.equal(state.capture.intervalMilliseconds, 15 * 60 * 1000);
  assert.equal(state.capture.nextDueAt, "2026-09-05T20:15:00.000Z");
  // Schema 31 removed the age limit, so no cleanup is ever scheduled.
  assert.deepEqual(state.cleanup, createDefaultSnapshotScheduleState().cleanup);
  assert.equal(harness.calls.filter(([kind]) => kind === "cleanup").length, 0);

  state.capture.nextDueAt = "2026-09-05T19:00:00.000Z";
  harness.setState(state);
  await harness.service.synchronize({ initializing: true });
  assert.equal(harness.calls.filter(([kind]) => kind === "capture").length, 0);
  assert.deepEqual(harness.state().capture.pendingLibraries, ["sidebar"]);
  assert.equal(
    harness.alarms.get(SNAPSHOT_CAPTURE_ALARM_NAME).scheduledTime,
    Date.parse("2026-09-05T20:00:01.000Z")
  );
  await harness.service.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME);
  assert.equal(harness.calls.filter(([kind]) => kind === "capture").length, 1);
  assert.deepEqual(harness.calls.find(([kind]) => kind === "capture")[1], ["sidebar"]);
  assert.deepEqual(harness.protections, ["2026-09-05T20:00:00.000Z"]);

  settings.snapshots.automaticEnabled = false;
  await harness.service.synchronize();
  state = harness.state();
  assert.equal(state.capture.nextDueAt, null);
  assert.equal(harness.alarms.has(SNAPSHOT_CAPTURE_ALARM_NAME), false);
  assert.equal(harness.alarms.has(SNAPSHOT_CLEANUP_ALARM_NAME), false);

  await harness.service.handleAlarm(SNAPSHOT_CLEANUP_ALARM_NAME);
  assert.equal(harness.calls.filter(([kind]) => kind === "cleanup").length, 0);
});

test("automatic settings backups independently keep the shared schedule active", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticSettingsBackupsEnabled = true;
  const harness = schedulerHarness(settings);

  await harness.service.synchronize();
  assert.equal(harness.state().capture.nextDueAt, "2026-09-05T20:15:00.000Z");
  assert.ok(harness.alarms.has(SNAPSHOT_CAPTURE_ALARM_NAME));
  assert.equal(harness.alarms.has(SNAPSHOT_CLEANUP_ALARM_NAME), false);

  const due = harness.state();
  due.capture.nextDueAt = "2026-09-05T19:00:00.000Z";
  harness.setState(due);
  await harness.service.synchronize();
  await harness.service.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME);
  assert.equal(harness.calls.filter(([kind]) => kind === "capture").length, 1);
  assert.deepEqual(harness.calls.find(([kind]) => kind === "capture")[1], ["settings"]);

  await assert.rejects(
    harness.service.scheduleAutomaticTest(),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_REQUEST
  );
});

test("no cleanup alarm is ever scheduled, and a leftover one retires itself", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  const harness = schedulerHarness(settings);

  await harness.service.synchronize();
  assert.ok(harness.alarms.has(SNAPSHOT_CAPTURE_ALARM_NAME));
  assert.equal(harness.alarms.has(SNAPSHOT_CLEANUP_ALARM_NAME), false);
  assert.deepEqual(harness.state().cleanup, createDefaultSnapshotScheduleState().cleanup);
  assert.deepEqual(
    await harness.service.handleAlarm(SNAPSHOT_CLEANUP_ALARM_NAME),
    { removed: [], reason: "disabled" }
  );
  assert.equal(harness.calls.filter(([kind]) => kind === "cleanup").length, 0);

  // A profile upgraded from schema 30 can still hold the alarm and its job
  // state; the next synchronize clears both.
  const leftover = harness.state();
  leftover.cleanup = {
    ...leftover.cleanup,
    intervalMilliseconds: 86_400_000,
    nextDueAt: "2026-09-06T20:00:00.000Z"
  };
  harness.setState(leftover);
  harness.alarms.set(SNAPSHOT_CLEANUP_ALARM_NAME, {
    name: SNAPSHOT_CLEANUP_ALARM_NAME,
    scheduledTime: Date.parse("2026-09-06T20:00:00.000Z")
  });
  await harness.service.synchronize();
  assert.equal(harness.alarms.has(SNAPSHOT_CLEANUP_ALARM_NAME), false);
  assert.deepEqual(harness.state().cleanup, createDefaultSnapshotScheduleState().cleanup);
});

test("applying a changed rule runs one queued pass without scheduling an age check", async () => {
  const settings = createDefaultSettingsState();
  const harness = schedulerHarness(settings);
  assert.deepEqual(await harness.service.applyRetention(), { removed: [], reason: "disabled" });
  assert.equal(harness.calls.filter(([kind]) => kind === "cleanup").length, 0);

  settings.snapshots.automaticSettingsBackupsEnabled = true;
  await harness.service.applyRetention();
  const cleanup = harness.state().cleanup;
  assert.equal(harness.calls.filter(([kind]) => kind === "cleanup").length, 1);
  assert.equal(cleanup.lastResult, "unchanged");
  assert.equal(cleanup.lastSuccessAt, "2026-09-05T20:00:00.000Z");
  assert.equal(cleanup.intervalMilliseconds, null);
  assert.equal(cleanup.nextDueAt, null);
  assert.equal(harness.alarms.has(SNAPSHOT_CLEANUP_ALARM_NAME), false);

  settings.snapshots.retentionCount = 5;
  await harness.service.applyRetention();
  assert.equal(harness.calls.filter(([kind]) => kind === "cleanup").length, 2);
  assert.equal(harness.state().cleanup.nextDueAt, null);
  assert.equal(harness.alarms.has(SNAPSHOT_CLEANUP_ALARM_NAME), false);
});

test("a failed retention pass is recorded and keeps the last success", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  let state = createDefaultSnapshotScheduleState();
  state.cleanup.lastSuccessAt = "2026-09-01T00:00:00.000Z";
  const service = new SnapshotScheduleService({
    settingsService: { async getOrInitialize() { return structuredClone(settings); } },
    repository: {
      async readScheduleState() { return structuredClone(state); },
      async writeScheduleState(value) { state = structuredClone(value); return state; }
    },
    alarmsAdapter: { async get() { return null; }, create() {}, async clear() { return true; } },
    async captureAutomatic() { return { created: false }; },
    async cleanupAutomatic() { throw new Error("synthetic removal failure"); },
    clock: () => new Date("2026-09-05T20:00:00.000Z")
  });
  await assert.rejects(service.applyRetention(), /synthetic removal failure/);
  assert.equal(state.cleanup.lastResult, "failed");
  assert.equal(state.cleanup.lastSuccessAt, "2026-09-01T00:00:00.000Z");
  assert.equal(state.cleanup.lastAttemptAt, "2026-09-05T20:00:00.000Z");
});

test("duration conversion supports second, week, and year schedules", () => {
  const settings = createDefaultSettingsState().snapshots;
  settings.intervalValue = 30;
  settings.intervalUnit = "seconds";
  assert.equal(snapshotIntervalMilliseconds(settings), 30_000);
  settings.intervalValue = 2;
  settings.intervalUnit = "weeks";
  assert.equal(snapshotIntervalMilliseconds(settings), 1_209_600_000);
  settings.intervalValue = 1;
  settings.intervalUnit = "years";
  assert.equal(snapshotIntervalMilliseconds(settings), 31_536_000_000);
});

test("the one schedule counts from now, at the interval the settings hold", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.intervalValue = 2;
  settings.snapshots.intervalUnit = "hours";
  const harness = schedulerHarness(settings);
  await harness.service.synchronize();
  const capture = harness.state().capture;
  assert.equal(capture.intervalMilliseconds, 7_200_000);
  assert.equal(capture.nextDueAt, "2026-09-05T22:00:00.000Z");
  assert.ok(harness.alarms.has(SNAPSHOT_CAPTURE_ALARM_NAME));
});

test("the five-second automatic test uses its own one-shot alarm", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  const harness = schedulerHarness(settings);
  const scheduled = await harness.service.scheduleAutomaticTest();
  assert.equal(scheduled.delayMilliseconds, 5_000);
  assert.equal(scheduled.dueAt, "2026-09-05T20:00:05.000Z");
  assert.equal(harness.alarms.get(SNAPSHOT_TEST_ALARM_NAME).scheduledTime, Date.parse(scheduled.dueAt));
  await harness.service.handleAlarm(SNAPSHOT_TEST_ALARM_NAME);
  assert.equal(harness.calls.filter(([kind]) => kind === "test-capture").length, 1);
});

test("private automatic snapshots independently schedule and test their private library", async () => {
  const settings = createDefaultSettingsState();
  settings.privacy.automaticSnapshotsEnabled = true;
  const harness = schedulerHarness(settings);

  await harness.service.synchronize();
  assert.ok(harness.alarms.has(SNAPSHOT_CAPTURE_ALARM_NAME));

  const scheduled = await harness.service.schedulePrivateAutomaticTest();
  assert.equal(
    harness.alarms.get(SNAPSHOT_PRIVATE_TEST_ALARM_NAME).scheduledTime,
    Date.parse(scheduled.dueAt)
  );
  await harness.service.handleAlarm(SNAPSHOT_PRIVATE_TEST_ALARM_NAME);
  assert.equal(
    harness.calls.filter(([kind]) => kind === "private-test-capture").length,
    1
  );
});

test("repeated overdue synchronization and duplicate alarms collapse per library", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.automaticSettingsBackupsEnabled = true;
  settings.privacy.automaticSnapshotsEnabled = true;
  const harness = schedulerHarness(settings);
  const state = harness.state();
  state.capture.nextDueAt = "2026-09-05T19:00:00.000Z";
  harness.setState(state);

  await Promise.all([harness.service.synchronize(), harness.service.synchronize()]);
  assert.equal(harness.calls.filter(([kind]) => kind === "capture").length, 0);
  assert.deepEqual(harness.state().capture.pendingLibraries, ["sidebar", "settings", "private"]);

  await Promise.all([
    harness.service.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME),
    harness.service.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME)
  ]);
  assert.equal(harness.calls.filter(([kind]) => kind === "capture").length, 1);
  assert.deepEqual(harness.state().capture.pendingLibraries, []);
});

test("a partial library failure persists only unfinished work for a bounded retry", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.automaticSettingsBackupsEnabled = true;
  const expected = new Error("synthetic sidebar failure");
  expected.completedLibraries = ["settings"];
  const harness = schedulerHarness(settings, {
    async captureAutomatic() { throw expected; }
  });
  const state = harness.state();
  state.capture.pendingLibraries = ["sidebar", "settings"];
  state.capture.pendingSince = "2026-09-05T19:00:00.000Z";
  harness.setState(state);

  await assert.rejects(
    harness.service.handleAlarm(SNAPSHOT_CAPTURE_ALARM_NAME),
    (error) => error === expected
  );
  assert.deepEqual(harness.state().capture.pendingLibraries, ["sidebar"]);
  assert.equal(harness.state().capture.pendingSince, "2026-09-05T19:00:00.000Z");
  assert.equal(
    harness.alarms.get(SNAPSHOT_CAPTURE_ALARM_NAME).scheduledTime,
    Date.parse("2026-09-05T20:01:00.000Z")
  );
});

test("synchronization recreates a missing Firefox alarm without capturing inline", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  const harness = schedulerHarness(settings);
  await harness.service.synchronize();
  harness.alarms.delete(SNAPSHOT_CAPTURE_ALARM_NAME);

  await harness.service.synchronize();
  assert.ok(harness.alarms.has(SNAPSHOT_CAPTURE_ALARM_NAME));
  assert.equal(harness.calls.filter(([kind]) => kind === "capture").length, 0);
});

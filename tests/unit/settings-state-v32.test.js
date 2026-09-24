import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_SECTIONS,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V31_SCHEMA_VERSION,
  SETTINGS_STATE_V32_SCHEMA_VERSION,
  SNAPSHOT_INTERVAL_UNITS,
  applySettingsPatch,
  createDefaultSettingsState,
  createDefaultSettingsStateV31,
  migrateSettingsStateV1,
  migrateSettingsStateV31,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV31,
  resetSettingsSection
} from "../../src/contracts/settings-state.js";

const SCHEDULE_KEYS = ["scheduleMode", "exactTime", "exactDays"];

test("schema 32 keeps one schedule and one workspace-removal answer", () => {
  assert.equal(SETTINGS_STATE_V31_SCHEMA_VERSION, 31);
  assert.equal(SETTINGS_STATE_V32_SCHEMA_VERSION, 32);

  const defaults = createDefaultSettingsState();
  for (const key of SCHEDULE_KEYS) {
    assert.equal(Object.hasOwn(defaults.snapshots, key), false, key);
  }
  // Save every is the one schedule left, and it keeps its own values.
  assert.equal(defaults.snapshots.intervalValue, 15);
  assert.equal(defaults.snapshots.intervalUnit, SNAPSHOT_INTERVAL_UNITS.MINUTES);
  // Removal is reversible instead of warned about; loading many tabs still asks.
  assert.equal(Object.hasOwn(defaults.sidebar, "warnBeforeWorkspaceRemoval"), false);
  assert.equal(defaults.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(defaults.sidebar.warnBeforeClosingMultipleTabs, true);
  assert.deepEqual(parseSettingsState(defaults), defaults);

  // Each version rejects the other's shape, in both directions.
  const v31 = createDefaultSettingsStateV31();
  assert.throws(
    () => parseSettingsState({ ...v31, schemaVersion: SETTINGS_STATE_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV31({ ...defaults, schemaVersion: SETTINGS_STATE_V31_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
});

test("31 to 32 keeps a daily schedule saving, on the interval it already held", () => {
  const previous = createDefaultSettingsStateV31();
  previous.snapshots.scheduleMode = "exact-days";
  previous.snapshots.exactTime = "07:15";
  previous.snapshots.exactDays = [2, 4];
  previous.snapshots.intervalValue = 6;
  previous.snapshots.intervalUnit = SNAPSHOT_INTERVAL_UNITS.HOURS;
  previous.snapshots.retentionCount = 42;
  previous.sidebar.warnBeforeWorkspaceRemoval = false;
  previous.sidebar.showTabSearch = false;

  const migrated = migrateSettingsStateV31(previous);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_V32_SCHEMA_VERSION);
  for (const key of SCHEDULE_KEYS) {
    assert.equal(Object.hasOwn(migrated.snapshots, key), false, key);
  }
  // The interval the profile already carried keeps the schedule running.
  assert.equal(migrated.snapshots.intervalValue, 6);
  assert.equal(migrated.snapshots.intervalUnit, SNAPSHOT_INTERVAL_UNITS.HOURS);
  assert.equal(migrated.snapshots.retentionCount, 42);
  // A silenced removal warning is gone with the warning itself; the new load
  // warning starts on, like every other warning.
  assert.equal(Object.hasOwn(migrated.sidebar, "warnBeforeWorkspaceRemoval"), false);
  assert.equal(migrated.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(migrated.sidebar.showTabSearch, false);
});

test("the oldest documents still migrate all the way to the current schema", () => {
  const legacy = {
    schemaVersion: 1,
    sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 }
  };
  const migrated = migrateSettingsStateV1(legacy);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(migrated.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(Object.hasOwn(migrated.snapshots, "scheduleMode"), false);
});

test("the load warning patches and resets like the other sidebar preferences", () => {
  const patched = applySettingsPatch(createDefaultSettingsState(), {
    sidebar: { warnBeforeLoadingManyTabs: false }
  });
  assert.equal(patched.sidebar.warnBeforeLoadingManyTabs, false);
  assert.equal(
    resetSettingsSection(patched, SETTINGS_SECTIONS.SIDEBAR).sidebar.warnBeforeLoadingManyTabs,
    true
  );
  assert.throws(
    () => parseSettingsPatch({ sidebar: { warnBeforeLoadingManyTabs: "no" } }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("a patch can no longer propose a retired schedule mode or the removal warning", () => {
  for (const patch of [
    { snapshots: { scheduleMode: "exact-time" } },
    { snapshots: { exactTime: "09:00" } },
    { snapshots: { exactDays: [1] } },
    { sidebar: { warnBeforeWorkspaceRemoval: true } }
  ]) {
    assert.throws(
      () => parseSettingsPatch(patch),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST,
      JSON.stringify(patch)
    );
  }
});

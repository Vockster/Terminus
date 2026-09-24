import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_APPEARANCE,
  SETTINGS_SECTIONS,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_V30_SCHEMA_VERSION,
  SETTINGS_STATE_V31_SCHEMA_VERSION,
  SNAPSHOT_SETTINGS_LIMITS,
  applySettingsPatch,
  createDefaultSettingsState,
  createDefaultSettingsStateV30,
  createDefaultSettingsStateV31,
  migrateSettingsStateV30,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV30,
  parseSettingsStateV31,
  resetSettingsSection
} from "../../src/contracts/settings-state.js";

const AGE_KEYS = ["deleteOldAutomaticEnabled", "deleteAfterValue", "deleteAfterUnit"];

test("schema 31 removes the automatic-save age limit and widens the restore batch", () => {
  assert.equal(SETTINGS_STATE_V30_SCHEMA_VERSION, 30);
  assert.equal(SETTINGS_STATE_V31_SCHEMA_VERSION, 31);
  assert.deepEqual(SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize, { min: 1, max: 9999, defaultValue: 10 });
  assert.equal(Object.hasOwn(SNAPSHOT_SETTINGS_LIMITS, "deleteAfterValue"), false);

  const defaults = createDefaultSettingsStateV31();
  for (const key of AGE_KEYS) {
    assert.equal(Object.hasOwn(defaults.snapshots, key), false, key);
  }
  assert.equal(defaults.snapshots.retentionCount, 100);
  assert.equal(defaults.appearance.settingsBackgroundColor, "#2b2a33");
  assert.deepEqual(parseSettingsStateV31(defaults), defaults);

  // Each version rejects the other's shape, in both directions.
  const v30 = createDefaultSettingsStateV30();
  assert.throws(
    () => parseSettingsStateV31({ ...v30, schemaVersion: SETTINGS_STATE_V31_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV30({ ...defaults, schemaVersion: SETTINGS_STATE_V30_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
});

test("30 to 31 keeps more saves, never fewer, and moves only the untouched surface", () => {
  const previous = createDefaultSettingsStateV30();
  previous.snapshots.deleteOldAutomaticEnabled = true;
  previous.snapshots.deleteAfterValue = 7;
  previous.snapshots.deleteAfterUnit = "days";
  previous.snapshots.retentionCount = 42;
  previous.snapshots.restoreBatchSize = 25;
  previous.sidebar.showTabSearch = false;

  const migrated = migrateSettingsStateV30(previous);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_V31_SCHEMA_VERSION);
  for (const key of AGE_KEYS) {
    assert.equal(Object.hasOwn(migrated.snapshots, key), false, key);
  }
  // The maximum, which removes the oldest first, is untouched: a profile that
  // had the age limit on simply keeps more of its own saves.
  assert.equal(migrated.snapshots.retentionCount, 42);
  assert.equal(migrated.snapshots.restoreBatchSize, 25);
  assert.equal(migrated.sidebar.showTabSearch, false);
  // A profile still on the old default follows Settings to the sidebar color.
  assert.equal(migrated.appearance.settingsBackgroundColor, DEFAULT_APPEARANCE.settingsBackgroundColor);
});

test("a Settings background the user chose is never rewritten by the migration", () => {
  const previous = createDefaultSettingsStateV30();
  previous.appearance.settingsBackgroundColor = "#123456";
  assert.equal(
    migrateSettingsStateV30(previous).appearance.settingsBackgroundColor,
    "#123456"
  );
});

test("the restore batch size patches within 1 through 9999 and resets with Snapshots", () => {
  const patched = applySettingsPatch(createDefaultSettingsState(), {
    snapshots: { restoreBatchSize: 1 }
  });
  assert.equal(patched.snapshots.restoreBatchSize, 1);
  assert.equal(
    applySettingsPatch(patched, { snapshots: { restoreBatchSize: 9999 } }).snapshots.restoreBatchSize,
    9999
  );
  assert.equal(resetSettingsSection(patched, SETTINGS_SECTIONS.SNAPSHOTS).snapshots.restoreBatchSize, 10);
  assert.equal(resetSettingsSection(patched, SETTINGS_SECTIONS.SIDEBAR).snapshots.restoreBatchSize, 1);

  for (const invalid of [0, 10_000, 2.5, "10", null]) {
    assert.throws(
      () => parseSettingsPatch({ snapshots: { restoreBatchSize: invalid } }),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST,
      String(invalid)
    );
    const malformed = createDefaultSettingsState();
    malformed.snapshots.restoreBatchSize = invalid;
    assert.throws(
      () => parseSettingsState(malformed),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE,
      String(invalid)
    );
  }
});

test("a patch can no longer propose the retired age limit", () => {
  for (const key of AGE_KEYS) {
    assert.throws(
      () => parseSettingsPatch({ snapshots: { [key]: key === "deleteOldAutomaticEnabled" ? true : 5 } }),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST,
      key
    );
  }
});

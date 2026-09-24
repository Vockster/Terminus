import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_V29_SCHEMA_VERSION,
  SETTINGS_STATE_V30_SCHEMA_VERSION,
  SNAPSHOT_SETTINGS_LIMITS_V30,
  createDefaultSettingsStateV29,
  createDefaultSettingsStateV30,
  migrateSettingsStateV29,
  parseSettingsStateV29,
  parseSettingsStateV30
} from "../../src/contracts/settings-state.js";

test("schema 30 adds a snapshot restore batch size that defaults to 10", () => {
  assert.equal(SETTINGS_STATE_V29_SCHEMA_VERSION, 29);
  assert.equal(SETTINGS_STATE_V30_SCHEMA_VERSION, 30);
  // Schema 30 capped the batch at 100; schema 31 raised it, and this frozen
  // limit keeps a v30 document reading exactly as it was written.
  assert.deepEqual(SNAPSHOT_SETTINGS_LIMITS_V30.restoreBatchSize, { min: 1, max: 100, defaultValue: 10 });

  const defaults = createDefaultSettingsStateV30();
  assert.equal(defaults.snapshots.restoreBatchSize, 10);
  assert.deepEqual(parseSettingsStateV30(defaults), defaults);
  // Schema 30 still carried the automatic-save age limit and the old Settings
  // surface.
  assert.equal(defaults.snapshots.deleteOldAutomaticEnabled, false);
  assert.equal(defaults.snapshots.deleteAfterValue, 30);
  assert.equal(defaults.snapshots.deleteAfterUnit, "days");
  assert.equal(defaults.appearance.settingsBackgroundColor, "#202022");

  const v29 = createDefaultSettingsStateV29();
  assert.equal(Object.hasOwn(v29.snapshots, "restoreBatchSize"), false);
  assert.deepEqual(parseSettingsStateV29(v29), v29);
  assert.throws(
    () => parseSettingsStateV30({ ...v29, schemaVersion: SETTINGS_STATE_V30_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV29({ ...defaults, schemaVersion: SETTINGS_STATE_V29_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV30({ ...defaults, snapshots: { ...defaults.snapshots, restoreBatchSize: 101 } }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
});

test("29 to 30 keeps every existing choice and adds the default batch size", () => {
  const previous = createDefaultSettingsStateV29();
  previous.sidebar.showTabSearch = false;
  previous.snapshots.retentionCount = 42;
  previous.snapshots.automaticDownloads = true;

  const migrated = migrateSettingsStateV29(previous);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_V30_SCHEMA_VERSION);
  assert.equal(migrated.sidebar.showTabSearch, false);
  assert.equal(migrated.snapshots.retentionCount, 42);
  assert.equal(migrated.snapshots.automaticDownloads, true);
  assert.equal(migrated.snapshots.restoreBatchSize, 10);
});

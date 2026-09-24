import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_PANEL_IDS,
  SETTINGS_PANEL_IDS_V33,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V33_SCHEMA_VERSION,
  createDefaultSettingsState,
  createDefaultSettingsStateV33,
  migrateSettingsStateV1,
  migrateSettingsStateV33,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV33
} from "../../src/contracts/settings-state.js";

test("schema 34 removes Sync from current Settings panels", () => {
  assert.equal(SETTINGS_STATE_V33_SCHEMA_VERSION, 33);
  assert.equal(SETTINGS_STATE_SCHEMA_VERSION, 34);
  assert.deepEqual(SETTINGS_PANEL_IDS, SETTINGS_PANEL_IDS_V33.filter((id) => id !== "sync"));
  assert.equal(SETTINGS_PANEL_IDS.includes("sync"), false);
  assert.equal(createDefaultSettingsState().navigation.lastPanel, "sidebar");
});

test("33 to 34 moves a remembered Sync panel to Storage", () => {
  const previous = createDefaultSettingsStateV33();
  previous.navigation = { rememberLastPanel: true, lastPanel: "sync" };
  assert.equal(parseSettingsStateV33(previous).navigation.lastPanel, "sync");

  const migrated = migrateSettingsStateV33(previous);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.deepEqual(migrated.navigation, { rememberLastPanel: true, lastPanel: "storage" });
  assert.deepEqual(parseSettingsState(migrated), migrated);
});

test("33 to 34 leaves every non-Sync choice unchanged", () => {
  const previous = createDefaultSettingsStateV33();
  previous.navigation = { rememberLastPanel: false, lastPanel: "firefox-styling" };
  previous.sidebar.showTabSearch = false;
  previous.snapshots.retentionCount = 42;

  assert.deepEqual(migrateSettingsStateV33(previous), {
    ...previous,
    schemaVersion: SETTINGS_STATE_SCHEMA_VERSION
  });
});

test("current documents and patches reject Sync navigation", () => {
  const defaults = createDefaultSettingsState();
  assert.throws(
    () => parseSettingsState({
      ...defaults,
      navigation: { rememberLastPanel: true, lastPanel: "sync" }
    }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsPatch({ navigation: { lastPanel: "sync" } }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("the oldest settings migrate through the removal edge", () => {
  const migrated = migrateSettingsStateV1({
    schemaVersion: 1,
    sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 }
  });
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.notEqual(migrated.navigation.lastPanel, "sync");
});

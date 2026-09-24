import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_FONT_SIZE_PRESETS,
  SETTINGS_PANEL_IDS_V32,
  SETTINGS_PANEL_IDS_V33,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_V32_SCHEMA_VERSION,
  SETTINGS_STATE_V33_SCHEMA_VERSION,
  createDefaultSettingsStateV32,
  createDefaultSettingsStateV33,
  migrateSettingsStateV32,
  parseSettingsStateV32,
  parseSettingsStateV33
} from "../../src/contracts/settings-state.js";

const STYLING_TAB = "firefox-styling";

test("schema 33 added the Optional Firefox Styling tab and no settings fields", () => {
  assert.equal(SETTINGS_STATE_V32_SCHEMA_VERSION, 32);
  assert.equal(SETTINGS_STATE_V33_SCHEMA_VERSION, 33);
  assert.deepEqual(SETTINGS_PANEL_IDS_V33, [...SETTINGS_PANEL_IDS_V32, STYLING_TAB]);
  assert.equal(SETTINGS_PANEL_IDS_V32.includes(STYLING_TAB), false);

  const defaults = createDefaultSettingsStateV33();
  const remembered = parseSettingsStateV33({
    ...defaults,
    navigation: { rememberLastPanel: true, lastPanel: STYLING_TAB }
  });
  assert.equal(remembered.navigation.lastPanel, STYLING_TAB);

  const v32 = createDefaultSettingsStateV32();
  assert.equal(v32.appearance.typography.fontSize, SETTINGS_FONT_SIZE_PRESETS.SMALL);
  assert.equal(defaults.appearance.typography.fontSize, SETTINGS_FONT_SIZE_PRESETS.MEDIUM);
  assert.deepEqual(
    {
      ...v32,
      schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION,
      appearance: {
        ...v32.appearance,
        typography: { ...v32.appearance.typography, fontSize: SETTINGS_FONT_SIZE_PRESETS.MEDIUM }
      }
    },
    defaults
  );
});

test("the 32 to 33 migration keeps the text size and every user choice", () => {
  const previous = createDefaultSettingsStateV32();
  previous.navigation = { rememberLastPanel: false, lastPanel: "storage" };
  previous.sidebar.showTabSearch = false;
  previous.sidebar.warnBeforeLoadingManyTabs = false;
  previous.snapshots.retentionCount = 42;
  previous.appearance.settingsBackgroundColor = "#123456";

  const migrated = migrateSettingsStateV32(previous);
  assert.deepEqual(migrated, { ...previous, schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION });
  assert.equal(migrated.appearance.typography.fontSize, SETTINGS_FONT_SIZE_PRESETS.SMALL);
  assert.deepEqual(parseSettingsStateV33(migrated), migrated);
});

test("schema 32 keeps its exact tab names and refuses the newer styling tab", () => {
  const v32 = createDefaultSettingsStateV32();
  assert.throws(
    () => parseSettingsStateV32({
      ...v32,
      navigation: { rememberLastPanel: true, lastPanel: STYLING_TAB }
    }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV33(v32),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV32(createDefaultSettingsStateV33()),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
});

test("schema 33 retains Sync only as a historical migration input", () => {
  const previous = createDefaultSettingsStateV33();
  previous.navigation = { rememberLastPanel: true, lastPanel: "sync" };
  assert.equal(parseSettingsStateV33(previous).navigation.lastPanel, "sync");
});

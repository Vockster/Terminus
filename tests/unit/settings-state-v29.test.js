import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_SECTIONS,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_V28_SCHEMA_VERSION,
  SETTINGS_STATE_V29_SCHEMA_VERSION,
  TAB_SEARCH_POSITIONS,
  applySettingsPatch,
  createDefaultSettingsState,
  createDefaultSettingsStateV28,
  createDefaultSettingsStateV29,
  migrateSettingsStateV28,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV28,
  parseSettingsStateV29,
  resetSettingsSection
} from "../../src/contracts/settings-state.js";

const NEW_SIDEBAR_KEYS = [
  "hideUnloadedTabsFromFirefox",
  "showTabSearch",
  "tabSearchPosition"
];

test("schema 29 adds unloaded-tab visibility and tab search preferences", () => {
  assert.equal(SETTINGS_STATE_V28_SCHEMA_VERSION, 28);
  assert.equal(SETTINGS_STATE_V29_SCHEMA_VERSION, 29);
  assert.deepEqual(TAB_SEARCH_POSITIONS, { TOP: "top", BOTTOM: "bottom" });

  const defaults = createDefaultSettingsStateV29();
  assert.equal(defaults.sidebar.hideUnloadedTabsFromFirefox, false);
  assert.equal(defaults.sidebar.showTabSearch, true);
  assert.equal(defaults.sidebar.tabSearchPosition, TAB_SEARCH_POSITIONS.TOP);
  assert.deepEqual(parseSettingsStateV29(defaults), defaults);

  const v28 = createDefaultSettingsStateV28();
  for (const key of NEW_SIDEBAR_KEYS) {
    assert.equal(Object.hasOwn(v28.sidebar, key), false);
  }
  assert.deepEqual(parseSettingsStateV28(v28), v28);
  assert.throws(
    () => parseSettingsStateV29({ ...v28, schemaVersion: SETTINGS_STATE_V29_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
});

test("28 to 29 preserves established settings and installs approved defaults", () => {
  const previous = createDefaultSettingsStateV28();
  previous.sidebar.showAddWorkspaceButton = false;
  previous.sidebar.warnBeforeClosingMultipleTabs = false;
  previous.snapshots.retentionCount = 321;

  const migrated = migrateSettingsStateV28(previous);

  assert.equal(migrated.schemaVersion, SETTINGS_STATE_V29_SCHEMA_VERSION);
  assert.equal(migrated.sidebar.showAddWorkspaceButton, false);
  assert.equal(migrated.sidebar.warnBeforeClosingMultipleTabs, false);
  assert.equal(migrated.snapshots.retentionCount, 321);
  assert.equal(migrated.sidebar.hideUnloadedTabsFromFirefox, false);
  assert.equal(migrated.sidebar.showTabSearch, true);
  assert.equal(migrated.sidebar.tabSearchPosition, TAB_SEARCH_POSITIONS.TOP);
});

test("new sidebar preferences patch strictly and reset with Sidebar", () => {
  const patched = applySettingsPatch(createDefaultSettingsState(), {
    sidebar: {
      hideUnloadedTabsFromFirefox: true,
      showTabSearch: false,
      tabSearchPosition: TAB_SEARCH_POSITIONS.BOTTOM
    }
  });
  assert.equal(patched.sidebar.hideUnloadedTabsFromFirefox, true);
  assert.equal(patched.sidebar.showTabSearch, false);
  assert.equal(patched.sidebar.tabSearchPosition, TAB_SEARCH_POSITIONS.BOTTOM);

  const reset = resetSettingsSection(patched, SETTINGS_SECTIONS.SIDEBAR);
  assert.equal(reset.sidebar.hideUnloadedTabsFromFirefox, false);
  assert.equal(reset.sidebar.showTabSearch, true);
  assert.equal(reset.sidebar.tabSearchPosition, TAB_SEARCH_POSITIONS.TOP);

  for (const invalid of [
    { hideUnloadedTabsFromFirefox: "yes" },
    { showTabSearch: 1 },
    { tabSearchPosition: "left" }
  ]) {
    assert.throws(
      () => parseSettingsPatch({ sidebar: invalid }),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
    );
  }

  for (const [key, value] of [
    ["hideUnloadedTabsFromFirefox", null],
    ["showTabSearch", "yes"],
    ["tabSearchPosition", "center"]
  ]) {
    const malformed = createDefaultSettingsState();
    malformed.sidebar[key] = value;
    assert.throws(
      () => parseSettingsState(malformed),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_SECTIONS,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V27_SCHEMA_VERSION,
  SETTINGS_STATE_V28_SCHEMA_VERSION,
  applySettingsPatch,
  createDefaultSettingsState,
  createDefaultSettingsStateV27,
  createDefaultSettingsStateV28,
  migrateSettingsStateV27,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV27,
  parseSettingsStateV28,
  resetSettingsSection
} from "../../src/contracts/settings-state.js";

const NEW_SIDEBAR_KEY = "warnBeforeClosingMultipleTabs";

test("schema 28 adds the bulk-close warning without count-range preferences", () => {
  assert.equal(SETTINGS_STATE_SCHEMA_VERSION, 34);
  assert.equal(SETTINGS_STATE_V28_SCHEMA_VERSION, 28);
  assert.equal(SETTINGS_STATE_V27_SCHEMA_VERSION, 27);

  const defaults = createDefaultSettingsStateV28();
  assert.equal(defaults.sidebar[NEW_SIDEBAR_KEY], true);
  assert.deepEqual(parseSettingsStateV28(defaults), defaults);

  const v27 = createDefaultSettingsStateV27();
  assert.equal(
    Object.hasOwn(v27.sidebar, NEW_SIDEBAR_KEY), false
  );
  assert.deepEqual(parseSettingsStateV27(v27), v27);
  assert.throws(
    () => parseSettingsStateV28({ ...v27, schemaVersion: SETTINGS_STATE_V28_SCHEMA_VERSION }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV27({
      ...v27,
      sidebar: { ...v27.sidebar, warnBeforeClosingMultipleTabs: false }
    }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
});

test("27 to 28 preserves existing settings and installs conservative defaults", () => {
  const previous = createDefaultSettingsStateV27();
  previous.sidebar.showAddWorkspaceButton = false;
  previous.sidebar.showActionButtons = false;
  previous.snapshots.retentionCount = 321;

  const migrated = migrateSettingsStateV27(previous);

  assert.equal(migrated.schemaVersion, SETTINGS_STATE_V28_SCHEMA_VERSION);
  assert.equal(migrated.sidebar.showAddWorkspaceButton, false);
  assert.equal(migrated.sidebar.showActionButtons, false);
  assert.equal(migrated.snapshots.retentionCount, 321);
  assert.equal(migrated.sidebar[NEW_SIDEBAR_KEY], true);
});

test("the close preference patches, validates, and resets with Sidebar", () => {
  const patched = applySettingsPatch(createDefaultSettingsState(), {
    sidebar: { warnBeforeClosingMultipleTabs: false }
  });
  assert.equal(patched.sidebar[NEW_SIDEBAR_KEY], false);

  const reset = resetSettingsSection(patched, SETTINGS_SECTIONS.SIDEBAR);
  assert.equal(reset.sidebar[NEW_SIDEBAR_KEY], true);

  assert.throws(
    () => parseSettingsPatch({ sidebar: { [NEW_SIDEBAR_KEY]: "yes" } }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
  );
  const malformed = createDefaultSettingsState();
  malformed.sidebar[NEW_SIDEBAR_KEY] = null;
  assert.throws(
    () => parseSettingsState(malformed),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsPatch({ sidebar: { showTabCountsUpTo999: true } }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

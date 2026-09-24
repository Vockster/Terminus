import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_PANEL_IDS_V26,
  SETTINGS_PANEL_IDS_V32,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V26_SCHEMA_VERSION,
  SETTINGS_STATE_V27_SCHEMA_VERSION,
  SNAPSHOT_AGE_UNITS,
  SNAPSHOT_SETTINGS_LIMITS,
  SNAPSHOT_SETTINGS_LIMITS_V26,
  applySettingsPatch,
  createDefaultSettingsState,
  createDefaultSettingsStateV26,
  createDefaultSettingsStateV27,
  migrateSettingsStateV26,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV26,
  parseSettingsStateV27,
  resetSettingsSection
} from "../../src/contracts/settings-state.js";

function v26Settings(snapshots = {}) {
  const defaults = createDefaultSettingsStateV26();
  return { ...defaults, snapshots: { ...defaults.snapshots, ...snapshots } };
}

test("schema 27 separates the always-on maximum from the optional age limit", () => {
  assert.equal(SETTINGS_STATE_V27_SCHEMA_VERSION, 27);
  const defaults = createDefaultSettingsStateV27();
  assert.deepEqual(Object.keys(defaults.snapshots).sort(), [
    "automaticDownloads",
    "automaticEnabled",
    "automaticSettingsBackupsEnabled",
    "deleteAfterUnit",
    "deleteAfterValue",
    "deleteOldAutomaticEnabled",
    "exactDays",
    "exactTime",
    "intervalUnit",
    "intervalValue",
    "retentionCount",
    "scheduleMode",
    "warnBeforeSnapshotDeletion"
  ]);
  assert.equal(defaults.snapshots.retentionCount, 100);
  assert.equal(defaults.snapshots.deleteOldAutomaticEnabled, false);
  assert.equal(defaults.snapshots.deleteAfterValue, 30);
  assert.equal(defaults.snapshots.deleteAfterUnit, "days");
  assert.equal(defaults.sidebar.showAddWorkspaceButton, true);
  assert.deepEqual(SNAPSHOT_SETTINGS_LIMITS.retentionCount, { min: 1, max: 9999, defaultValue: 100 });
  assert.deepEqual(SNAPSHOT_SETTINGS_LIMITS_V26.retentionCount, { min: 1, max: 1000, defaultValue: 100 });
  assert.deepEqual(Object.values(SNAPSHOT_AGE_UNITS), ["days", "weeks", "years"]);

  for (const invalid of [
    { ...defaults, snapshots: { ...defaults.snapshots, retentionCount: 10000 } },
    { ...defaults, snapshots: { ...defaults.snapshots, retentionCount: 0 } },
    { ...defaults, snapshots: { ...defaults.snapshots, deleteAfterUnit: "hours" } },
    { ...defaults, sidebar: { ...defaults.sidebar, showAddWorkspaceButton: "yes" } },
    v26Settings()
  ]) {
    assert.throws(
      () => parseSettingsStateV27({ ...invalid, schemaVersion: SETTINGS_STATE_V27_SCHEMA_VERSION }),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
    );
  }
  assert.equal(
    parseSettingsStateV27({
      ...defaults,
      snapshots: { ...defaults.snapshots, retentionCount: 9999 }
    }).snapshots.retentionCount,
    9999
  );
});

test("schema 26 keeps its own cleanup switch, limits, and panel list", () => {
  const legacy = v26Settings({ retentionCount: 1000, deleteAfterUnit: "hours" });
  assert.equal(parseSettingsStateV26(legacy).snapshots.deleteAutomaticEnabled, false);
  assert.throws(
    () => parseSettingsStateV26(v26Settings({ retentionCount: 1001 })),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.throws(
    () => parseSettingsStateV26({
      ...v26Settings(),
      navigation: { rememberLastPanel: true, lastPanel: "overview" }
    }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.deepEqual(SETTINGS_PANEL_IDS_V32, [...SETTINGS_PANEL_IDS_V26, "overview"]);
  assert.equal(
    parseSettingsStateV27({
      ...createDefaultSettingsStateV27(),
      navigation: { rememberLastPanel: true, lastPanel: "overview" }
    }).navigation.lastPanel,
    "overview"
  );
});

test("26 to 27 keeps every existing save: cleanup off becomes the largest maximum", () => {
  const off = migrateSettingsStateV26(v26Settings({ retentionCount: 40 }));
  assert.equal(off.schemaVersion, SETTINGS_STATE_V27_SCHEMA_VERSION);
  assert.equal(off.snapshots.deleteOldAutomaticEnabled, false);
  assert.equal(off.snapshots.retentionCount, 9999);
  assert.equal(Object.hasOwn(off.snapshots, "deleteAutomaticEnabled"), false);
  assert.equal(off.sidebar.showAddWorkspaceButton, true);

  const on = migrateSettingsStateV26(v26Settings({
    deleteAutomaticEnabled: true,
    retentionCount: 40,
    deleteAfterValue: 6,
    deleteAfterUnit: "weeks"
  }));
  assert.equal(on.snapshots.deleteOldAutomaticEnabled, true);
  assert.equal(on.snapshots.retentionCount, 40);
  assert.equal(on.snapshots.deleteAfterValue, 6);
  assert.equal(on.snapshots.deleteAfterUnit, "weeks");

  const previous = parseSettingsStateV26(v26Settings({ deleteAutomaticEnabled: true }));
  const migrated = migrateSettingsStateV26(previous);
  assert.deepEqual(migrated.appearance, previous.appearance);
  assert.deepEqual(migrated.navigation, previous.navigation);
  assert.deepEqual(migrated.privacy, previous.privacy);
  const { showAddWorkspaceButton: _added, ...sidebar } = migrated.sidebar;
  assert.deepEqual(sidebar, previous.sidebar);
});

test("26 to 27 rounds ages shorter than a day up to whole days", () => {
  const cases = [
    [{ deleteAfterValue: 30, deleteAfterUnit: "seconds" }, [1, "days"]],
    [{ deleteAfterValue: 90, deleteAfterUnit: "minutes" }, [1, "days"]],
    [{ deleteAfterValue: 48, deleteAfterUnit: "hours" }, [2, "days"]],
    [{ deleteAfterValue: 49, deleteAfterUnit: "hours" }, [3, "days"]],
    [{ deleteAfterValue: 999, deleteAfterUnit: "hours" }, [42, "days"]],
    [{ deleteAfterValue: 30, deleteAfterUnit: "days" }, [30, "days"]],
    [{ deleteAfterValue: 3, deleteAfterUnit: "weeks" }, [3, "weeks"]],
    [{ deleteAfterValue: 2, deleteAfterUnit: "years" }, [2, "years"]]
  ];
  for (const [age, [value, unit]] of cases) {
    for (const deleteAutomaticEnabled of [false, true]) {
      const migrated = migrateSettingsStateV26(v26Settings({ ...age, deleteAutomaticEnabled }));
      assert.deepEqual(
        [migrated.snapshots.deleteAfterValue, migrated.snapshots.deleteAfterUnit],
        [value, unit],
        `${age.deleteAfterValue} ${age.deleteAfterUnit}`
      );
    }
  }
});

// Schema 27 introduced `deleteOldAutomaticEnabled`; schema 31 removed the age
// rule altogether, so a patch now carries only the maximum. Both retired
// spellings are still refused below.
test("schema 27 patches keep the add-workspace toggle and the maximum", () => {
  const patched = applySettingsPatch(createDefaultSettingsState(), {
    sidebar: { showAddWorkspaceButton: false },
    snapshots: {
      retentionCount: 9999
    },
    navigation: { lastPanel: "overview" }
  });
  assert.equal(patched.sidebar.showAddWorkspaceButton, false);
  assert.equal(patched.snapshots.retentionCount, 9999);
  assert.equal(patched.navigation.lastPanel, "overview");
  assert.equal(resetSettingsSection(patched, "sidebar").sidebar.showAddWorkspaceButton, true);

  for (const patch of [
    { sidebar: { showAddWorkspaceButton: "yes" } },
    { snapshots: { deleteAutomaticEnabled: true } },
    { snapshots: { deleteOldAutomaticEnabled: true } },
    { snapshots: { deleteAfterValue: 2 } },
    { snapshots: { deleteAfterUnit: "hours" } },
    { snapshots: { deleteAfterUnit: "minutes" } },
    { snapshots: { retentionCount: 10000 } },
    { navigation: { lastPanel: "help" } }
  ]) {
    assert.throws(
      () => parseSettingsPatch(patch),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
    );
  }
});

test("pinned schema-26 defaults describe a valid schema-26 document", () => {
  const defaults = createDefaultSettingsStateV26();
  assert.equal(defaults.schemaVersion, SETTINGS_STATE_V26_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(defaults.sidebar, "showAddWorkspaceButton"), false);
  assert.equal(defaults.snapshots.deleteAutomaticEnabled, false);
  assert.deepEqual(parseSettingsStateV26(defaults), defaults);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_TAB_HIGHLIGHT_MODES,
  APPEARANCE_CONTENT_MODES,
  APPEARANCE_MODES,
  APPEARANCE_TYPOGRAPHY_LIMITS,
  DEFAULT_WORKSPACE_GLOW_MODE,
  DEFAULT_SNAPSHOT_SETTINGS,
  SETTINGS_FONT_SIZE_PRESETS,
  SETTINGS_SECTIONS,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V4_SCHEMA_VERSION,
  SETTINGS_STATE_V5_SCHEMA_VERSION,
  SETTINGS_STATE_V6_SCHEMA_VERSION,
  SETTINGS_STATE_V7_SCHEMA_VERSION,
  SETTINGS_STATE_V8_SCHEMA_VERSION,
  SETTINGS_STATE_V9_SCHEMA_VERSION,
  SETTINGS_STATE_V10_SCHEMA_VERSION,
  SETTINGS_STATE_V11_SCHEMA_VERSION,
  SETTINGS_STATE_V12_SCHEMA_VERSION,
  SETTINGS_STATE_V13_SCHEMA_VERSION,
  SETTINGS_STATE_V14_SCHEMA_VERSION,
  SETTINGS_STATE_V15_SCHEMA_VERSION,
  SETTINGS_STATE_V16_SCHEMA_VERSION,
  SETTINGS_STATE_V17_SCHEMA_VERSION,
  SETTINGS_STATE_V18_SCHEMA_VERSION,
  SETTINGS_STATE_V19_SCHEMA_VERSION,
  SETTINGS_STATE_V20_SCHEMA_VERSION,
  SETTINGS_STATE_V21_SCHEMA_VERSION,
  SETTINGS_STATE_V22_SCHEMA_VERSION,
  SETTINGS_STATE_V23_SCHEMA_VERSION,
  SETTINGS_STATE_V24_SCHEMA_VERSION,
  SETTINGS_STATE_V25_SCHEMA_VERSION,
  SETTINGS_STATE_V26_SCHEMA_VERSION,
  SETTINGS_STATE_V27_SCHEMA_VERSION,
  SETTINGS_STATE_V28_SCHEMA_VERSION,
  SETTINGS_STATE_V29_SCHEMA_VERSION,
  SETTINGS_STATE_V30_SCHEMA_VERSION,
  SNAPSHOT_INTERVAL_UNITS,
  SNAPSHOT_SCHEDULE_MODES,
  SIDEBAR_SIZE_LIMITS,
  SIDEBAR_SIZE_PRESETS,
  SIDEBAR_SIZE_PRESET_ORDER,
  TAB_SIZE_GEOMETRY,
  WORKSPACE_GLOW_MODES,
  WORKSPACE_SIZE_GEOMETRY,
  SettingsStateError,
  applySettingsPatch,
  createDefaultSettingsState,
  createDefaultSettingsStateV32,
  createDefaultSettingsStateV26,
  getMaximumIconSizeForRail,
  getSnapshotIntervalValueLimits,
  migrateSettingsStateV1,
  migrateSettingsStateV3,
  migrateSettingsStateV4,
  migrateSettingsStateV5,
  migrateSettingsStateV6,
  migrateSettingsStateV7,
  migrateSettingsStateV8,
  migrateSettingsStateV9,
  migrateSettingsStateV10,
  migrateSettingsStateV11,
  migrateSettingsStateV12,
  migrateSettingsStateV13,
  migrateSettingsStateV14,
  migrateSettingsStateV15,
  migrateSettingsStateV16,
  migrateSettingsStateV17,
  migrateSettingsStateV18,
  migrateSettingsStateV19,
  migrateSettingsStateV20,
  migrateSettingsStateV21,
  migrateSettingsStateV22,
  migrateSettingsStateV23,
  migrateSettingsStateV24,
  migrateSettingsStateV25,
  migrateSettingsStateV26,
  migrateSettingsStateV27,
  migrateSettingsStateV28,
  migrateSettingsStateV29,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV1,
  parseSettingsStateV11,
  parseSettingsStateV12,
  parseSettingsStateV13,
  parseSettingsStateV14,
  parseSettingsStateV16,
  snapshotDurationMilliseconds,
  resetSettingsSection
} from "../../src/contracts/settings-state.js";

const V22_WORKSPACE_SIZE_GEOMETRY = Object.freeze({
  [SIDEBAR_SIZE_PRESETS.SMALL]: Object.freeze({ railSize: 40, iconSize: 22 }),
  [SIDEBAR_SIZE_PRESETS.MEDIUM]: Object.freeze({ railSize: 48, iconSize: 30 }),
  [SIDEBAR_SIZE_PRESETS.LARGE]: Object.freeze({ railSize: 60, iconSize: 42 }),
  [SIDEBAR_SIZE_PRESETS.MASSIVE]: Object.freeze({ railSize: 72, iconSize: 48 })
});

function removeV15SnapshotSchedule(settings) {
  delete settings.snapshots.automaticSettingsBackupsEnabled;
  delete settings.snapshots.scheduleMode;
  delete settings.snapshots.exactTime;
  delete settings.snapshots.exactDays;
  return settings;
}

function removeV17Typography(settings) {
  delete settings.appearance.typography;
  delete settings.appearance.containerGlowEnabled;
  delete settings.appearance.workspaceGlowMode;
  return settings;
}

function removeV22Interaction(settings) {
  if (settings.sidebar.workspaceSize) {
    const geometry = V22_WORKSPACE_SIZE_GEOMETRY[settings.sidebar.workspaceSize];
    const {
      workspaceSize: _workspaceSize,
      tabSize: _tabSize,
      ...sidebar
    } = settings.sidebar;
    settings.sidebar = {
      railSize: geometry.railSize,
      iconSize: geometry.iconSize,
      ...sidebar
    };
  }
  delete settings.sidebar.rightClickBehavior;
  return settings;
}

test("default settings pin sidebar geometry and the fixed Terminus theme", () => {
  const defaults = createDefaultSettingsState();
  assert.deepEqual(defaults, {
    schemaVersion: SETTINGS_STATE_SCHEMA_VERSION,
    sidebar: {
      workspaceSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
      tabSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
      dividerSize: 16,
      workspaceReorderingLocked: false,
      showActionButtons: true,
      showAddWorkspaceButton: true,
      warnBeforeClosingMultipleTabs: true,
      warnBeforeLoadingManyTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: "top"
    },
    appearance: {
      mode: APPEARANCE_MODES.DEFAULT,
      contentMode: APPEARANCE_CONTENT_MODES.FULL,
      solidColor: "#2b2a33",
      activeTabHighlight: {
        mode: ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM,
        color: "#ffffff"
      },
      applyToSettings: false,
      settingsBackgroundColor: "#2b2a33",
      typography: {
        source: "system",
        fontFamily: "system-ui",
        // Fresh profiles start at Medium; the 16px floor is the old default.
        fontSize: SETTINGS_FONT_SIZE_PRESETS.MEDIUM
      },
      workspaceGlowMode: DEFAULT_WORKSPACE_GLOW_MODE,
      gradient: {
        angle: 135,
        stops: [
          { color: "#2563eb", position: 0 },
          { color: "#7c3aed", position: 100 }
        ]
      }
    },
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: 10
    },
    navigation: {
      rememberLastPanel: true,
      lastPanel: "sidebar"
    },
    privacy: {
      keepPrivateTabsBetweenSessions: false,
      automaticSnapshotsEnabled: false
    }
  });
  assert.equal(defaults.snapshots.automaticEnabled, false);
  assert.equal(Object.hasOwn(defaults.snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(defaults.snapshots.retentionCount, 100);
  assert.equal(defaults.snapshots.automaticDownloads, false);
  assert.equal(defaults.snapshots.warnBeforeSnapshotDeletion, true);
  for (const key of ["scheduleMode", "exactTime", "exactDays"]) {
    assert.equal(Object.hasOwn(defaults.snapshots, key), false, key);
  }
  assert.deepEqual(SETTINGS_FONT_SIZE_PRESETS, {
    SMALL: 16,
    MEDIUM: 20,
    LARGE: 28
  });
  assert.equal(APPEARANCE_TYPOGRAPHY_LIMITS.fontSize.max, 28);
});

test("workspace and tab presets pin the approved icon geometry", () => {
  assert.deepEqual(WORKSPACE_SIZE_GEOMETRY, {
    small: { railSize: 40, buttonSize: 32, iconSize: 20 },
    medium: { railSize: 46, buttonSize: 38, iconSize: 24 },
    large: { railSize: 56, buttonSize: 48, iconSize: 32 },
    massive: { railSize: 68, buttonSize: 60, iconSize: 42 }
  });
  assert.deepEqual(TAB_SIZE_GEOMETRY, {
    small: { iconColumnSize: 40, tileSize: 32, rowSize: 34, faviconSize: 20, fontSize: 14 },
    medium: { iconColumnSize: 46, tileSize: 38, rowSize: 38, faviconSize: 24, fontSize: 16 },
    large: { iconColumnSize: 56, tileSize: 48, rowSize: 46, faviconSize: 32, fontSize: 18 },
    massive: { iconColumnSize: 68, tileSize: 60, rowSize: 58, faviconSize: 42, fontSize: 20 }
  });
});

// A glyph lost in its tile is what made the icons read as too small, so the
// proportion is pinned rather than left to drift with the next size change.
test("every preset fills most of its tile with the glyph", () => {
  for (const preset of SIDEBAR_SIZE_PRESET_ORDER) {
    const workspace = WORKSPACE_SIZE_GEOMETRY[preset];
    const ratio = workspace.iconSize / workspace.buttonSize;
    assert.ok(
      ratio >= 0.6 && ratio <= 0.72,
      `${preset} workspace glyph fills ${Math.round(ratio * 100)}% of its tile`
    );
    const tab = TAB_SIZE_GEOMETRY[preset];
    const tabRatio = tab.faviconSize / tab.tileSize;
    assert.ok(
      tabRatio >= 0.6 && tabRatio <= 0.72,
      `${preset} tab favicon fills ${Math.round(tabRatio * 100)}% of its tile`
    );
    // The icon column carries the tile plus its surrounding padding, and must
    // match the workspace rail so the two panes line up.
    assert.equal(tab.iconColumnSize, workspace.railSize);
  }
});

test("v1 settings migrate without changing stored sidebar choices", () => {
  const legacy = {
    schemaVersion: 1,
    sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 }
  };
  assert.deepEqual(parseSettingsStateV1(legacy), legacy);
  const migrated = migrateSettingsStateV1(legacy);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.deepEqual(migrated.sidebar, {
    workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE,
    tabSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
    dividerSize: 32,
    workspaceReorderingLocked: false,
    showActionButtons: true,
    showAddWorkspaceButton: true,
    warnBeforeClosingMultipleTabs: true,
    warnBeforeLoadingManyTabs: true,
    hideUnloadedTabsFromFirefox: false,
    showTabSearch: true,
    tabSearchPosition: "top"
  });
  assert.equal(migrated.appearance.mode, APPEARANCE_MODES.FIREFOX);
  assert.equal(migrated.appearance.contentMode, APPEARANCE_CONTENT_MODES.FULL);
});

test("v3 through v11 settings add presentation, safe snapshot defaults, and appearance controls", () => {
  const previous = removeV22Interaction(removeV17Typography(createDefaultSettingsStateV26()));
  previous.appearance.mode = APPEARANCE_MODES.FIREFOX;
  previous.schemaVersion = SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION;
  delete previous.navigation;
  delete previous.privacy;
  delete previous.snapshots;
  delete previous.sidebar.workspaceReorderingLocked;
  delete previous.sidebar.showActionButtons;
  delete previous.sidebar.warnBeforeWorkspaceRemoval;
  delete previous.appearance.activeTabHighlight;
  delete previous.appearance.applyToSettings;
  delete previous.appearance.settingsBackgroundColor;
  const v4 = migrateSettingsStateV3(previous);
  assert.equal(v4.schemaVersion, SETTINGS_STATE_V4_SCHEMA_VERSION);
  assert.equal(v4.sidebar.workspaceReorderingLocked, false);
  const v5 = migrateSettingsStateV4(v4);
  assert.equal(v5.schemaVersion, SETTINGS_STATE_V5_SCHEMA_VERSION);
  assert.deepEqual(v5.appearance.activeTabHighlight, {
    mode: ACTIVE_TAB_HIGHLIGHT_MODES.FIREFOX,
    color: "#0060df"
  });
  const v6 = migrateSettingsStateV5(v5);
  assert.equal(v6.schemaVersion, SETTINGS_STATE_V6_SCHEMA_VERSION);
  assert.equal(v6.sidebar.showActionButtons, true);
  const v7 = migrateSettingsStateV6(v6);
  assert.equal(v7.schemaVersion, SETTINGS_STATE_V7_SCHEMA_VERSION);
  const v8 = migrateSettingsStateV7(v7);
  assert.equal(v8.schemaVersion, SETTINGS_STATE_V8_SCHEMA_VERSION);
  const v9 = migrateSettingsStateV8(v8);
  assert.equal(v9.schemaVersion, SETTINGS_STATE_V9_SCHEMA_VERSION);
  const v10 = migrateSettingsStateV9(v9);
  assert.equal(v10.schemaVersion, SETTINGS_STATE_V10_SCHEMA_VERSION);
  const v11 = migrateSettingsStateV10(v10);
  assert.equal(v11.schemaVersion, SETTINGS_STATE_V11_SCHEMA_VERSION);
  const v12 = migrateSettingsStateV11(v11);
  assert.equal(v12.schemaVersion, SETTINGS_STATE_V12_SCHEMA_VERSION);
  const v13 = migrateSettingsStateV12(v12);
  assert.equal(v13.schemaVersion, SETTINGS_STATE_V13_SCHEMA_VERSION);
  const v14 = migrateSettingsStateV13(v13);
  assert.equal(v14.schemaVersion, SETTINGS_STATE_V14_SCHEMA_VERSION);
  const v15 = migrateSettingsStateV14(v14);
  assert.equal(v15.schemaVersion, SETTINGS_STATE_V15_SCHEMA_VERSION);
  const v16 = migrateSettingsStateV15(v15);
  assert.equal(v16.schemaVersion, SETTINGS_STATE_V16_SCHEMA_VERSION);
  const v17 = migrateSettingsStateV16(v16);
  assert.equal(v17.schemaVersion, SETTINGS_STATE_V17_SCHEMA_VERSION);
  const v18 = migrateSettingsStateV17(v17);
  assert.equal(v18.schemaVersion, SETTINGS_STATE_V18_SCHEMA_VERSION);
  const v19 = migrateSettingsStateV18(v18);
  assert.equal(v19.schemaVersion, SETTINGS_STATE_V19_SCHEMA_VERSION);
  const v20 = migrateSettingsStateV19(v19);
  assert.equal(v20.schemaVersion, SETTINGS_STATE_V20_SCHEMA_VERSION);
  const v21 = migrateSettingsStateV20(v20);
  assert.equal(v21.schemaVersion, SETTINGS_STATE_V21_SCHEMA_VERSION);
  const v22 = migrateSettingsStateV21(v21);
  assert.equal(v22.schemaVersion, SETTINGS_STATE_V22_SCHEMA_VERSION);
  const v23 = migrateSettingsStateV22(v22);
  assert.equal(v23.schemaVersion, SETTINGS_STATE_V23_SCHEMA_VERSION);
  const v24 = migrateSettingsStateV23(v23);
  assert.equal(v24.schemaVersion, SETTINGS_STATE_V24_SCHEMA_VERSION);
  const v25 = migrateSettingsStateV24(v24);
  assert.equal(v25.schemaVersion, SETTINGS_STATE_V25_SCHEMA_VERSION);
  const v26 = migrateSettingsStateV25(v25);
  assert.equal(v26.schemaVersion, SETTINGS_STATE_V26_SCHEMA_VERSION);
  assert.equal(v26.snapshots.deleteAutomaticEnabled, false);
  const v27 = migrateSettingsStateV26(v26);
  assert.equal(v27.schemaVersion, SETTINGS_STATE_V27_SCHEMA_VERSION);
  const v28 = migrateSettingsStateV27(v27);
  assert.equal(v28.schemaVersion, SETTINGS_STATE_V28_SCHEMA_VERSION);
  const v29 = migrateSettingsStateV28(v28);
  assert.equal(v29.schemaVersion, SETTINGS_STATE_V29_SCHEMA_VERSION);
  const migrated = migrateSettingsStateV29(v29);
  assert.equal(migrated.schemaVersion, SETTINGS_STATE_V30_SCHEMA_VERSION);
  assert.deepEqual(migrated.snapshots, {
    automaticEnabled: false,
    automaticSettingsBackupsEnabled: false,
    scheduleMode: "interval",
    intervalValue: 15,
    intervalUnit: "minutes",
    exactTime: "09:00",
    exactDays: [1, 2, 3, 4, 5],
    deleteOldAutomaticEnabled: false,
    deleteAfterValue: 30,
    deleteAfterUnit: "days",
    retentionCount: 9999,
    automaticDownloads: false,
    warnBeforeSnapshotDeletion: true,
    restoreBatchSize: 10
  });
  assert.equal(migrated.sidebar.warnBeforeWorkspaceRemoval, true);
  assert.equal(migrated.appearance.applyToSettings, false);
  assert.equal(migrated.appearance.settingsBackgroundColor, "#000000");
  assert.deepEqual(migrated.appearance.activeTabHighlight, {
    mode: ACTIVE_TAB_HIGHLIGHT_MODES.FIREFOX,
    color: "#0060df"
  });
  // An upgraded document gains the typography of its own era (16px), not the
  // Medium a fresh profile starts with.
  assert.deepEqual(migrated.appearance.typography, createDefaultSettingsStateV32().appearance.typography);
  assert.equal(migrated.appearance.workspaceGlowMode, WORKSPACE_GLOW_MODES.CONTAINER);
  assert.deepEqual(migrated.navigation, {
    rememberLastPanel: true,
    lastPanel: "sidebar"
  });
});

test("v23 settings map legacy font sizes and the container-glow boolean deterministically", () => {
  const defaults = createDefaultSettingsStateV26();
  const { workspaceGlowMode: _workspaceGlowMode, ...appearance } = defaults.appearance;
  const cases = [
    { oldSize: 11, expectedSize: SETTINGS_FONT_SIZE_PRESETS.SMALL },
    { oldSize: 18, expectedSize: SETTINGS_FONT_SIZE_PRESETS.SMALL },
    { oldSize: 19, expectedSize: SETTINGS_FONT_SIZE_PRESETS.MEDIUM },
    { oldSize: 20, expectedSize: SETTINGS_FONT_SIZE_PRESETS.MEDIUM }
  ];

  for (const { oldSize, expectedSize } of cases) {
    const migrated = migrateSettingsStateV24(migrateSettingsStateV23({
      ...defaults,
      schemaVersion: SETTINGS_STATE_V23_SCHEMA_VERSION,
      sidebar: { ...defaults.sidebar, rightClickBehavior: "unload" },
      appearance: {
        ...appearance,
        typography: { ...appearance.typography, fontAssetId: null, fontSize: oldSize },
        containerGlowEnabled: oldSize !== 20
      }
    }));
    assert.equal(migrated.appearance.typography.fontSize, expectedSize);
    assert.equal(
      migrated.appearance.workspaceGlowMode,
      oldSize === 20 ? WORKSPACE_GLOW_MODES.OFF : WORKSPACE_GLOW_MODES.CONTAINER
    );
  }
});

test("v7 preferences convert retention before v8 disables legacy automatic toggles", () => {
  const current = createDefaultSettingsStateV26();
  current.appearance.mode = APPEARANCE_MODES.FIREFOX;
  removeV22Interaction(current);
  const legacySidebar = { ...current.sidebar };
  delete legacySidebar.warnBeforeWorkspaceRemoval;
  const legacyAppearance = { ...current.appearance };
  delete legacyAppearance.typography;
  delete legacyAppearance.containerGlowEnabled;
  delete legacyAppearance.workspaceGlowMode;
  delete legacyAppearance.applyToSettings;
  delete legacyAppearance.settingsBackgroundColor;
  const v8 = migrateSettingsStateV7({
    schemaVersion: SETTINGS_STATE_V7_SCHEMA_VERSION,
    sidebar: legacySidebar,
    appearance: legacyAppearance,
    snapshots: {
      automaticEnabled: true,
      intervalValue: 4,
      intervalUnit: "hours",
      retentionDays: 1500,
      retentionCount: 40,
      automaticDownloads: true,
      cleanupExportedFiles: false
    }
  });
  assert.deepEqual(v8.snapshots, {
    automaticEnabled: true,
    intervalValue: 4,
    intervalUnit: "hours",
    deleteAutomaticEnabled: false,
    deleteAfterValue: 215,
    deleteAfterUnit: "weeks",
    retentionCount: 40,
    automaticDownloads: true
  });
  const migrated = migrateSettingsStateV8(v8);
  assert.deepEqual(migrated.snapshots, {
    ...v8.snapshots,
    automaticEnabled: false,
    deleteAutomaticEnabled: false,
    automaticDownloads: false
  });
});

test("settings parsing accepts strict gradients and returns defensive copies", () => {
  const source = createDefaultSettingsState();
  source.appearance.mode = APPEARANCE_MODES.GRADIENT;
  source.appearance.gradient.stops.splice(1, 0, { color: "#ffffff", position: 50 });
  const parsed = parseSettingsState(source);
  parsed.sidebar.workspaceSize = SIDEBAR_SIZE_PRESETS.MASSIVE;
  parsed.appearance.gradient.stops[1].color = "#000000";
  assert.equal(source.sidebar.workspaceSize, SIDEBAR_SIZE_PRESETS.MEDIUM);
  assert.equal(source.appearance.gradient.stops[1].color, "#ffffff");
});

test("v11 transparent mode migrates to Follow Firefox and current patches reject it", () => {
  const legacy = removeV22Interaction(removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26())));
  legacy.schemaVersion = SETTINGS_STATE_V11_SCHEMA_VERSION;
  delete legacy.navigation;
  delete legacy.privacy;
  legacy.appearance.mode = "transparent";
  legacy.appearance.applyToSettings = true;
  legacy.appearance.settingsBackgroundColor = "#123456";
  assert.equal(parseSettingsStateV11(legacy).appearance.mode, "transparent");

  const migrated = migrateSettingsStateV11(legacy);
  assert.equal(migrated.appearance.mode, APPEARANCE_MODES.FIREFOX);
  assert.equal(migrated.appearance.applyToSettings, true);
  assert.equal(migrated.appearance.settingsBackgroundColor, "#123456");
  assert.throws(
    () => applySettingsPatch(createDefaultSettingsState(), {
      appearance: { mode: "transparent" }
    }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("v12 settings add default-on local Settings navigation", () => {
  const legacy = removeV22Interaction(removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26())));
  legacy.schemaVersion = SETTINGS_STATE_V12_SCHEMA_VERSION;
  delete legacy.navigation;
  delete legacy.privacy;
  assert.equal(parseSettingsStateV12(legacy).schemaVersion, SETTINGS_STATE_V12_SCHEMA_VERSION);
  const migrated = migrateSettingsStateV12(legacy);
  assert.deepEqual(migrated.navigation, {
    rememberLastPanel: true,
    lastPanel: "sidebar"
  });
  assert.equal(parseSettingsStateV13(migrated).schemaVersion, SETTINGS_STATE_V13_SCHEMA_VERSION);
  const v14 = migrateSettingsStateV13(migrated);
  assert.deepEqual(v14.privacy, {
    keepPrivateTabsBetweenSessions: false
  });
  assert.equal(parseSettingsStateV14(v14).schemaVersion, SETTINGS_STATE_V14_SCHEMA_VERSION);
  const v15 = migrateSettingsStateV14(v14);
  assert.equal(v15.snapshots.scheduleMode, "interval");
  const v16 = migrateSettingsStateV15(v15);
  assert.equal(parseSettingsStateV16(v16).privacy.automaticSnapshotsEnabled, false);
  assert.deepEqual(
    migrateSettingsStateV17(migrateSettingsStateV16(v16)).appearance.typography,
    { customFontEnabled: false, fontFamily: "system-ui", fontSize: 16 }
  );
});

test("field patches preserve unrelated values and section resets are isolated", () => {
  const customized = applySettingsPatch(createDefaultSettingsState(), {
    sidebar: {
      workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE,
      tabSize: SIDEBAR_SIZE_PRESETS.LARGE
    },
    appearance: { mode: APPEARANCE_MODES.SOLID, solidColor: "#abcdef" }
  });
  const changedDivider = applySettingsPatch(customized, { sidebar: { dividerSize: 28 } });
  const highlighted = applySettingsPatch(changedDivider, {
    appearance: {
      activeTabHighlight: { mode: ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM, color: "#abcdef" }
    }
  });
  assert.deepEqual(highlighted.appearance.activeTabHighlight, {
    mode: ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM,
    color: "#abcdef"
  });
  const typography = applySettingsPatch(highlighted, {
    appearance: {
      typography: {
        source: "generic",
        fontFamily: "serif",
        fontSize: SETTINGS_FONT_SIZE_PRESETS.LARGE
      }
    }
  });
  assert.deepEqual(typography.appearance.typography, {
    source: "generic",
    fontFamily: "serif",
    fontSize: SETTINGS_FONT_SIZE_PRESETS.LARGE
  });
  assert.deepEqual(changedDivider.sidebar, {
    workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE,
    tabSize: SIDEBAR_SIZE_PRESETS.LARGE,
    dividerSize: 28,
    workspaceReorderingLocked: false,
    showActionButtons: true,
    showAddWorkspaceButton: true,
    warnBeforeClosingMultipleTabs: true,
    warnBeforeLoadingManyTabs: true,
    hideUnloadedTabsFromFirefox: false,
    showTabSearch: true,
    tabSearchPosition: "top"
  });
  const locked = applySettingsPatch(changedDivider, {
    sidebar: { workspaceReorderingLocked: true }
  });
  assert.equal(locked.sidebar.workspaceReorderingLocked, true);
  assert.equal(locked.sidebar.dividerSize, 28);
  const actionButtonsHidden = applySettingsPatch(locked, {
    sidebar: { showActionButtons: false }
  });
  assert.equal(actionButtonsHidden.sidebar.showActionButtons, false);
  const deletionWarningsHidden = applySettingsPatch(actionButtonsHidden, {
    sidebar: { warnBeforeLoadingManyTabs: false },
    snapshots: { warnBeforeSnapshotDeletion: false }
  });
  assert.equal(deletionWarningsHidden.sidebar.warnBeforeLoadingManyTabs, false);
  assert.equal(deletionWarningsHidden.snapshots.warnBeforeSnapshotDeletion, false);
  const rememberedSnapshots = applySettingsPatch(deletionWarningsHidden, {
    navigation: { rememberLastPanel: true, lastPanel: "snapshots" }
  });
  assert.equal(rememberedSnapshots.navigation.lastPanel, "snapshots");
  const rememberedStorage = applySettingsPatch(rememberedSnapshots, {
    navigation: { lastPanel: "storage" }
  });
  assert.equal(rememberedStorage.navigation.lastPanel, "storage");
  assert.deepEqual(changedDivider.appearance, customized.appearance);

  const resetSidebar = resetSettingsSection(changedDivider, SETTINGS_SECTIONS.SIDEBAR);
  assert.deepEqual(resetSidebar.sidebar, createDefaultSettingsState().sidebar);
  assert.deepEqual(resetSidebar.appearance, changedDivider.appearance);

  const resetAppearance = resetSettingsSection(changedDivider, SETTINGS_SECTIONS.APPEARANCE);
  assert.deepEqual(resetAppearance.sidebar, changedDivider.sidebar);
  assert.deepEqual(resetAppearance.appearance, createDefaultSettingsState().appearance);

  const snapshotsChanged = applySettingsPatch(changedDivider, {
    snapshots: {
      intervalValue: 2,
      intervalUnit: "hours",
      retentionCount: 40
    }
  });
  assert.equal(snapshotsChanged.snapshots.intervalValue, 2);
  assert.equal(snapshotsChanged.snapshots.intervalUnit, "hours");
  assert.equal(snapshotsChanged.snapshots.retentionCount, 40);
  assert.deepEqual(
    resetSettingsSection(snapshotsChanged, SETTINGS_SECTIONS.SNAPSHOTS).snapshots,
    createDefaultSettingsState().snapshots
  );
  assert.deepEqual(
    resetSettingsSection(rememberedStorage, SETTINGS_SECTIONS.NAVIGATION).navigation,
    createDefaultSettingsState().navigation
  );
});

test("snapshot durations support seconds through years with a 30-second capture floor", () => {
  assert.deepEqual(getSnapshotIntervalValueLimits(SNAPSHOT_INTERVAL_UNITS.SECONDS), {
    min: 30,
    max: 999
  });
  assert.deepEqual(getSnapshotIntervalValueLimits(SNAPSHOT_INTERVAL_UNITS.YEARS), {
    min: 1,
    max: 999
  });
  assert.equal(snapshotDurationMilliseconds(2, SNAPSHOT_INTERVAL_UNITS.WEEKS), 1_209_600_000);
  assert.equal(snapshotDurationMilliseconds(1, SNAPSHOT_INTERVAL_UNITS.YEARS), 31_536_000_000);
});

test("the icon limit is derived from the selected rail size", () => {
  assert.equal(getMaximumIconSizeForRail(48), 30);
  assert.equal(getMaximumIconSizeForRail(68), 50);
  assert.equal(getMaximumIconSizeForRail(96), SIDEBAR_SIZE_LIMITS.iconSize.max);
});

test("invalid shapes, clipping, gradients, patches, and future versions reject", () => {
  const defaults = createDefaultSettingsState();
  const invalidStates = [
    { ...defaults, sidebar: { ...defaults.sidebar, workspaceSize: "giant" } },
    { ...defaults, appearance: { ...defaults.appearance, solidColor: "red" } },
    {
      ...defaults,
      appearance: {
        ...defaults.appearance,
        gradient: {
          angle: 360,
          stops: defaults.appearance.gradient.stops
        }
      }
    },
    {
      ...defaults,
      appearance: {
        ...defaults.appearance,
        gradient: {
          angle: 90,
          stops: [
            { color: "#000000", position: 0 },
            { color: "#ffffff", position: 0 }
          ]
        }
      }
    }
  ];
  for (const value of invalidStates) {
    assert.throws(
      () => parseSettingsState(value),
      (error) => error instanceof SettingsStateError && error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
    );
  }
  assert.throws(
    () => parseSettingsState({ ...defaults, schemaVersion: SETTINGS_STATE_SCHEMA_VERSION + 1 }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
  );
  for (const patch of [
    {},
    { sidebar: {} },
    { sidebar: { workspaceReorderingLocked: "yes" } },
    { sidebar: { showActionButtons: "yes" } },
    { sidebar: { rightClickBehavior: "menu" } },
    { sidebar: { warnBeforeLoadingManyTabs: "yes" } },
    { sidebar: { showWorkspaceCountsUpTo999: "yes" } },
    { sidebar: { showTabCountsUpTo999: "yes" } },
    { sidebar: { warnBeforeClosingMultipleTabs: "yes" } },
    { appearance: { mode: "unknown" } },
    { appearance: { activeTabHighlight: { mode: "custom", color: "red" } } },
    { appearance: { applyToSettings: "yes" } },
    { appearance: { settingsBackgroundColor: "black" } },
    { appearance: { workspaceGlowMode: "yes" } },
    { appearance: { typography: { source: "system", fontFamily: "Arial", fontSize: 16 } } },
    { appearance: { typography: { source: "system", fontFamily: "system-ui", fontSize: 40 } } },
    { appearance: { typography: { source: "generic", fontFamily: "comic-sans", fontSize: 16 } } },
    { appearance: { typography: { source: "legacy", fontFamily: "Arial", fontSize: 16 } } },
    { appearance: { typography: { source: "uploaded", fontFamily: "Anything", fontSize: 16 } } },
    { appearance: { typography: { source: "system", fontFamily: "system-ui", fontAssetId: null, fontSize: 16 } } },
    { snapshots: { intervalValue: 0 } },
    { snapshots: { intervalValue: 29, intervalUnit: "seconds" } },
    { snapshots: { intervalUnit: "fortnights" } },
    { snapshots: { retentionCount: 0 } },
    { snapshots: { retentionCount: 10_000 } },
    { snapshots: { warnBeforeSnapshotDeletion: "yes" } },
    { snapshots: { intervalUnit: "fortnights" } },
    { snapshots: { exactTime: "25:00" } },
    { snapshots: { exactDays: [] } },
    { navigation: { lastPanel: "missing" } },
    { privacy: { automaticSnapshotsEnabled: "yes" } }
  ]) {
    assert.throws(
      () => parseSettingsPatch(patch),
      (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
    );
  }
});

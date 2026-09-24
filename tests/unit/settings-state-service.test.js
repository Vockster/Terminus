import test from "node:test";
import assert from "node:assert/strict";

import {
  APPEARANCE_MODES,
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V16_SCHEMA_VERSION,
  SETTINGS_STATE_V17_SCHEMA_VERSION,
  SETTINGS_STATE_V18_SCHEMA_VERSION,
  SETTINGS_STATE_V23_SCHEMA_VERSION,
  SIDEBAR_SIZE_PRESETS,
  WORKSPACE_GLOW_MODES,
  createDefaultSettingsState,
  createDefaultSettingsStateV26,
  migrateSettingsStateV1,
  migrateSettingsStateV1ToV2
} from "../../src/contracts/settings-state.js";
import { SettingsStateService } from "../../src/core/settings-state-service.js";

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
  delete settings.sidebar.rightClickBehavior;
  downgradePresetSidebar(settings);
  return settings;
}

function useLegacyTypography(settings) {
  settings.appearance.typography = {
    customFontEnabled: false,
    fontFamily: "system-ui",
    fontSize: settings.appearance.typography.fontSize
  };
  delete settings.appearance.workspaceGlowMode;
  delete settings.sidebar.rightClickBehavior;
  downgradePresetSidebar(settings);
  return settings;
}

function downgradePresetSidebar(settings) {
  if (!settings.sidebar.workspaceSize) {
    return settings;
  }
  const geometry = V22_WORKSPACE_SIZE_GEOMETRY[settings.sidebar.workspaceSize];
  const { workspaceSize: _workspaceSize, tabSize: _tabSize, ...rest } = settings.sidebar;
  settings.sidebar = {
    railSize: geometry.railSize,
    iconSize: geometry.iconSize,
    ...rest
  };
  return settings;
}

function createMemoryStorage(initialValue, initialJournal) {
  let value = initialValue;
  let journal = initialJournal;
  const calls = { read: 0, write: 0, readMigration: 0, writeMigration: 0, removeMigration: 0 };
  return {
    calls,
    value: () => structuredClone(value),
    journal: () => structuredClone(journal),
    storage: {
      async read() { calls.read += 1; return structuredClone(value); },
      async write(nextValue) { calls.write += 1; value = structuredClone(nextValue); },
      async readMigration() { calls.readMigration += 1; return structuredClone(journal); },
      async writeMigration(nextJournal) { calls.writeMigration += 1; journal = structuredClone(nextJournal); },
      async removeMigration() { calls.removeMigration += 1; journal = undefined; }
    }
  };
}

test("concurrent missing-settings reads initialize one default document", async () => {
  const memory = createMemoryStorage(undefined);
  const service = new SettingsStateService(memory.storage);
  const [first, second] = await Promise.all([service.getOrInitialize(), service.getOrInitialize()]);
  assert.deepEqual(first, createDefaultSettingsState());
  assert.deepEqual(second, first);
  assert.notStrictEqual(first, second);
  assert.equal(memory.calls.write, 1);
  assert.equal(memory.calls.readMigration, 1);
});

test("stored v1 settings migrate through a verified recoverable journal", async () => {
  const legacy = { schemaVersion: 1, sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 } };
  const memory = createMemoryStorage(legacy);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.deepEqual(loaded.sidebar, {
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
  assert.equal(loaded.appearance.mode, APPEARANCE_MODES.FIREFOX);
  assert.equal(loaded.appearance.contentMode, "full");
  assert.equal(loaded.appearance.applyToSettings, false);
  assert.equal(loaded.appearance.settingsBackgroundColor, "#000000");
  assert.deepEqual(loaded.appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 16
  });
  assert.equal(loaded.appearance.workspaceGlowMode, WORKSPACE_GLOW_MODES.CONTAINER);
  assert.equal(loaded.snapshots.intervalValue, 15);
  assert.equal(loaded.snapshots.automaticEnabled, false);
  assert.equal(loaded.snapshots.automaticSettingsBackupsEnabled, false);
  assert.equal(Object.hasOwn(loaded.snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(loaded.snapshots.retentionCount, 9999);
  assert.equal(loaded.snapshots.automaticDownloads, false);
  assert.equal(loaded.snapshots.warnBeforeSnapshotDeletion, true);
  assert.deepEqual(loaded.navigation, { rememberLastPanel: true, lastPanel: "sidebar" });
  assert.deepEqual(loaded.privacy, {
    keepPrivateTabsBetweenSessions: false,
    automaticSnapshotsEnabled: false
  });
  assert.equal(memory.journal(), undefined);
  assert.deepEqual(memory.calls, {
    read: 34,
    write: 33,
    readMigration: 1,
    writeMigration: 33,
    removeMigration: 33
  });
});

test("stored v8 settings disable automatic snapshot actions before adding deletion warnings", async () => {
  const previous = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  previous.schemaVersion = 8;
  previous.appearance.mode = APPEARANCE_MODES.FIREFOX;
  delete previous.navigation;
  delete previous.privacy;
  delete previous.sidebar.warnBeforeWorkspaceRemoval;
  delete previous.snapshots.warnBeforeSnapshotDeletion;
  delete previous.appearance.applyToSettings;
  delete previous.appearance.settingsBackgroundColor;
  previous.snapshots.automaticEnabled = true;
  previous.snapshots.deleteAutomaticEnabled = true;
  previous.snapshots.automaticDownloads = true;
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.snapshots.automaticEnabled, false);
  assert.equal(Object.hasOwn(loaded.snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(loaded.snapshots.retentionCount, 9999);
  assert.equal(loaded.snapshots.automaticDownloads, false);
  assert.equal(loaded.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(loaded.snapshots.warnBeforeSnapshotDeletion, true);
  assert.equal(memory.calls.write, 26);
  assert.equal(memory.journal(), undefined);
});

test("stored v9 settings add independent deletion warnings once", async () => {
  const previous = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  previous.schemaVersion = 9;
  previous.appearance.mode = APPEARANCE_MODES.FIREFOX;
  delete previous.navigation;
  delete previous.privacy;
  delete previous.sidebar.warnBeforeWorkspaceRemoval;
  delete previous.snapshots.warnBeforeSnapshotDeletion;
  delete previous.appearance.applyToSettings;
  delete previous.appearance.settingsBackgroundColor;
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(loaded.snapshots.warnBeforeSnapshotDeletion, true);
  assert.equal(memory.calls.write, 25);
  assert.equal(memory.journal(), undefined);
});

test("stored v11 transparent appearance migrates once to Follow Firefox", async () => {
  const previous = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  previous.schemaVersion = 11;
  delete previous.privacy;
  delete previous.navigation;
  previous.appearance.mode = "transparent";
  previous.appearance.solidColor = "#123456";
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.appearance.mode, APPEARANCE_MODES.FIREFOX);
  assert.equal(loaded.appearance.solidColor, "#123456");
  assert.equal(memory.calls.write, 23);
  assert.equal(memory.journal(), undefined);
});

test("stored v15 settings add private automatic snapshots off by default", async () => {
  const previous = createDefaultSettingsStateV26();
  downgradePresetSidebar(previous);
  previous.schemaVersion = 15;
  delete previous.snapshots.automaticSettingsBackupsEnabled;
  delete previous.privacy.automaticSnapshotsEnabled;
  delete previous.appearance.typography;
  delete previous.appearance.containerGlowEnabled;
  delete previous.appearance.workspaceGlowMode;
  delete previous.sidebar.rightClickBehavior;
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.privacy.keepPrivateTabsBetweenSessions, false);
  assert.equal(loaded.privacy.automaticSnapshotsEnabled, false);
  assert.equal(memory.calls.write, 19);
  assert.equal(memory.journal(), undefined);
});

test("stored v16 settings add default local typography", async () => {
  const previous = createDefaultSettingsStateV26();
  downgradePresetSidebar(previous);
  previous.schemaVersion = SETTINGS_STATE_V16_SCHEMA_VERSION;
  delete previous.snapshots.automaticSettingsBackupsEnabled;
  delete previous.appearance.typography;
  delete previous.appearance.containerGlowEnabled;
  delete previous.appearance.workspaceGlowMode;
  delete previous.sidebar.rightClickBehavior;
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.deepEqual(loaded.appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 16
  });
  assert.equal(memory.calls.write, 18);
  assert.equal(memory.journal(), undefined);
});

test("a v23 custom font selection migrates to system at the nearest supported size", async () => {
  const stored = createDefaultSettingsStateV26();
  const { workspaceGlowMode: _workspaceGlowMode, ...appearance } = stored.appearance;
  stored.schemaVersion = SETTINGS_STATE_V23_SCHEMA_VERSION;
  stored.sidebar.rightClickBehavior = "unload";
  stored.appearance = {
    ...appearance,
    containerGlowEnabled: true,
    typography: {
      source: "legacy",
      fontFamily: "Atkinson Hyperlegible",
      fontAssetId: null,
      fontSize: 14
    }
  };
  const memory = createMemoryStorage(stored);
  const service = new SettingsStateService(memory.storage);

  const loaded = await service.getOrInitialize();

  assert.deepEqual(loaded.appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 16
  });
  assert.deepEqual(memory.value().appearance.typography, loaded.appearance.typography);
  assert.equal(memory.calls.write, 11);
});

test("stored v17 settings keep user choices while adding automatic settings backups off", async () => {
  const previous = useLegacyTypography(createDefaultSettingsStateV26());
  previous.schemaVersion = SETTINGS_STATE_V17_SCHEMA_VERSION;
  delete previous.snapshots.automaticSettingsBackupsEnabled;
  delete previous.appearance.containerGlowEnabled;
  previous.appearance.typography.fontSize = 14;
  previous.sidebar.showActionButtons = true;
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.appearance.typography.fontSize, 16);
  assert.equal(loaded.sidebar.showActionButtons, true);
  assert.equal(loaded.snapshots.automaticSettingsBackupsEnabled, false);
  assert.equal(memory.calls.write, 17);
  assert.equal(memory.journal(), undefined);
});

test("stored v18 settings migrate through one verified journal without changing choices", async () => {
  const previous = useLegacyTypography(createDefaultSettingsStateV26());
  previous.schemaVersion = SETTINGS_STATE_V18_SCHEMA_VERSION;
  delete previous.appearance.containerGlowEnabled;
  previous.navigation.lastPanel = "sync";
  const memory = createMemoryStorage(previous);
  const loaded = await new SettingsStateService(memory.storage).getOrInitialize();
  assert.equal(loaded.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.navigation.lastPanel, "storage");
  assert.deepEqual(memory.calls, {
    read: 17,
    write: 16,
    readMigration: 1,
    writeMigration: 16,
    removeMigration: 16
  });
  assert.equal(memory.journal(), undefined);
});

test("interrupted settings migrations replay candidates and reject conflicts", async () => {
  const legacy = { schemaVersion: 1, sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 } };
  const candidate = migrateSettingsStateV1ToV2(legacy);
  const journal = {
    schemaVersion: 1,
    sourceVersion: 1,
    targetVersion: 2,
    source: legacy,
    candidate
  };
  const replayMemory = createMemoryStorage(legacy, journal);
  assert.deepEqual(
    await new SettingsStateService(replayMemory.storage).getOrInitialize(),
    migrateSettingsStateV1(legacy)
  );
  assert.equal(replayMemory.journal(), undefined);

  const conflicting = structuredClone(candidate);
  conflicting.sidebar.spacerSize = 20;
  const conflictMemory = createMemoryStorage(conflicting, journal);
  await assert.rejects(
    new SettingsStateService(conflictMemory.storage).getOrInitialize(),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.deepEqual(conflictMemory.value(), conflicting);
  assert.deepEqual(conflictMemory.journal(), journal);
  assert.equal(conflictMemory.calls.write, 0);
});

test("partial updates read latest state and do not clobber other sections", async () => {
  const memory = createMemoryStorage(createDefaultSettingsState());
  const service = new SettingsStateService(memory.storage);
  const appearance = await service.update({
    appearance: { mode: APPEARANCE_MODES.SOLID, solidColor: "#abcdef" }
  });
  const sidebar = await service.update({ sidebar: { dividerSize: 28 } });
  assert.equal(appearance.appearance.solidColor, "#abcdef");
  assert.equal(sidebar.appearance.solidColor, "#abcdef");
  assert.equal(sidebar.sidebar.dividerSize, 28);
  assert.equal(memory.calls.write, 2);
});

test("section reset preserves other sections and global reset recovers defaults", async () => {
  const customized = createDefaultSettingsState();
  customized.sidebar.workspaceSize = SIDEBAR_SIZE_PRESETS.MASSIVE;
  customized.sidebar.tabSize = SIDEBAR_SIZE_PRESETS.LARGE;
  customized.appearance.mode = APPEARANCE_MODES.SOLID;
  customized.appearance.solidColor = "#abcdef";
  const memory = createMemoryStorage(customized);
  const service = new SettingsStateService(memory.storage);

  const sectionReset = await service.resetSection("sidebar");
  assert.deepEqual(sectionReset.sidebar, createDefaultSettingsState().sidebar);
  assert.equal(sectionReset.appearance.solidColor, "#abcdef");
  assert.deepEqual(await service.reset(), createDefaultSettingsState());
  assert.equal(memory.journal(), undefined);
});

test("global reset explicitly clears a conflicting migration journal", async () => {
  const memory = createMemoryStorage(
    { schemaVersion: 1, sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 } },
    { malformed: true }
  );
  const service = new SettingsStateService(memory.storage);
  assert.deepEqual(await service.reset(), createDefaultSettingsState());
  assert.equal(memory.journal(), undefined);
  assert.equal(memory.calls.read, 0);
  assert.equal(memory.calls.removeMigration, 1);
});

test("invalid updates and unavailable storage reject before a write", async () => {
  const memory = createMemoryStorage(createDefaultSettingsState());
  const service = new SettingsStateService(memory.storage);
  await assert.rejects(
    service.update({ sidebar: { workspaceSize: "giant" } }),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(memory.calls.write, 0);

  const failed = new SettingsStateService({
    async readMigration() { throw new Error("synthetic read failure"); }
  });
  await assert.rejects(
    failed.getOrInitialize(),
    (error) => error.code === SETTINGS_STATE_ERROR_CODES.STORAGE_UNAVAILABLE
  );
});

function futureSettingsDocument() {
  return { ...createDefaultSettingsState(), schemaVersion: SETTINGS_STATE_SCHEMA_VERSION + 1 };
}

test("settings from a newer Terminus are preserved verbatim and replaced by defaults", async (t) => {
  const originalWarn = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = originalWarn; });

  const future = futureSettingsDocument();
  const memory = createMemoryStorage(structuredClone(future));
  let backup;
  const storage = {
    ...memory.storage,
    async writeUnsupportedBackup(document) { backup = structuredClone(document); },
    async readUnsupportedBackup() { return structuredClone(backup); }
  };

  const loaded = await new SettingsStateService(storage).getOrInitialize();
  assert.deepEqual(loaded, createDefaultSettingsState());
  // The newer document survives byte-for-byte so a later build can restore it.
  assert.deepEqual(backup, future);
  assert.deepEqual(memory.value(), createDefaultSettingsState());
});

test("a newer settings document is never traded for defaults when it cannot be preserved", async () => {
  const future = futureSettingsDocument();
  const unsupported = (error) =>
    error.code === SETTINGS_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION;

  // No backup support at all: the original fail-closed refusal must stand.
  const withoutBackup = createMemoryStorage(structuredClone(future));
  await assert.rejects(
    () => new SettingsStateService(withoutBackup.storage).getOrInitialize(),
    unsupported
  );
  assert.deepEqual(withoutBackup.value(), future);

  // Backup support that fails must not discard the newer document either.
  const failing = createMemoryStorage(structuredClone(future));
  const storage = {
    ...failing.storage,
    async writeUnsupportedBackup() { throw new Error("storage is full"); }
  };
  await assert.rejects(() => new SettingsStateService(storage).getOrInitialize(), unsupported);
  assert.deepEqual(failing.value(), future);
});

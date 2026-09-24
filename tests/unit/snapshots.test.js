import test from "node:test";
import assert from "node:assert/strict";

import {
  RESTORE_JOURNAL_SCHEMA_VERSION,
  SETTINGS_BACKUP_DOCUMENT_TYPE,
  SETTINGS_BACKUP_PREVIOUS_SCHEMA_VERSION,
  SETTINGS_BACKUP_SCHEMA_VERSION,
  SETTINGS_BACKUP_V10_SCHEMA_VERSION,
  SETTINGS_BACKUP_V11_SCHEMA_VERSION,
  SETTINGS_BACKUP_V12_SCHEMA_VERSION,
  SETTINGS_BACKUP_V13_SCHEMA_VERSION,
  SETTINGS_BACKUP_V14_SCHEMA_VERSION,
  SETTINGS_BACKUP_V15_SCHEMA_VERSION,
  SETTINGS_BACKUP_V17_SCHEMA_VERSION,
  SETTINGS_BACKUP_V18_SCHEMA_VERSION,
  SETTINGS_BACKUP_V19_SCHEMA_VERSION,
  SETTINGS_BACKUP_V20_SCHEMA_VERSION,
  SETTINGS_BACKUP_V21_SCHEMA_VERSION,
  SETTINGS_BACKUP_V22_SCHEMA_VERSION,
  SETTINGS_BACKUP_V23_SCHEMA_VERSION,
  SETTINGS_BACKUP_V24_SCHEMA_VERSION,
  SETTINGS_BACKUP_V25_SCHEMA_VERSION,
  SETTINGS_BACKUP_V26_SCHEMA_VERSION,
  SETTINGS_BACKUP_V9_SCHEMA_VERSION,
  SETTINGS_BACKUP_V2_SCHEMA_VERSION,
  SETTINGS_BACKUP_V4_SCHEMA_VERSION,
  SETTINGS_BACKUP_V5_SCHEMA_VERSION,
  SETTINGS_BACKUP_V6_SCHEMA_VERSION,
  SETTINGS_BACKUP_V8_SCHEMA_VERSION,
  SNAPSHOT_DOCUMENT_TYPE,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_KINDS,
  SNAPSHOT_PREVIOUS_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_RESTORE_MODES,
  SNAPSHOT_RESTORE_SCOPES,
  createDefaultSnapshotIndex,
  createSnapshotRecord,
  canonicalJson,
  finalizeSettingsBackup,
  migrateSnapshotScheduleState,
  parseBackupText,
  parseRestoreJournal,
  parseSnapshotRestoreReport,
  parseSnapshotIndex,
  serializeBackup,
  verifySnapshotRecord
} from "../../src/contracts/snapshots.js";
import {
  SIDEBAR_SIZE_PRESETS,
  createDefaultSettingsState,
  createDefaultSettingsStateV32,
  createDefaultSettingsStateV26
} from "../../src/contracts/settings-state.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

test("snapshot records round-trip grouped, pinned, tree, split, selection, and discarded state", async () => {
  const record = await createSnapshotRecord({
    id: "snapshot-fixture",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T20:00:00.000Z",
    payload: createSnapshotPayloadFixture()
  });
  const verified = await verifySnapshotRecord(JSON.parse(serializeBackup(record)));
  const layout = verified.payload.windows[0].workspaceLayouts[0];
  assert.deepEqual(layout.pinnedTabIds, ["tab-one"]);
  assert.deepEqual(layout.groups[0].tabIds, ["tab-two", "tab-three"]);
  assert.equal(layout.tree[2].parentTabId, "tab-two");
  assert.deepEqual(layout.splitViews[0].tabIds, ["tab-two", "tab-three"]);
  assert.equal(layout.tabs[2].discarded, true);
  assert.deepEqual(Object.keys(verified.payload).sort(), [
    "containerCatalog",
    "windows",
    "workspaceState"
  ]);

  const tampered = structuredClone(record);
  tampered.payload.windows[0].workspaceLayouts[0].tabs[0].url = "https://changed.invalid/";
  await assert.rejects(
    verifySnapshotRecord(tampered),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED
  );
});

test("settings backups contain preferences without workspaces, containers, or live tabs", async () => {
  const settings = createDefaultSettingsState();
  settings.privacy.keepPrivateTabsBetweenSessions = true;
  settings.sidebar.hideUnloadedTabsFromFirefox = true;
  settings.sidebar.showTabSearch = false;
  settings.sidebar.tabSearchPosition = "bottom";
  settings.snapshots.restoreBatchSize = 25;
  const backup = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings
  });
  const parsed = await parseBackupText(serializeBackup(backup));
  assert.equal(parsed.kind, "settings");
  assert.equal(parsed.document.backupKind, "manual");
  assert.deepEqual(Object.keys(parsed.document.payload).sort(), ["settings"]);
  assert.doesNotMatch(serializeBackup(backup), /one\.invalid|tab-one|window-source/);
  assert.deepEqual(parsed.document.payload.settings.privacy, settings.privacy);
  assert.equal(parsed.document.payload.settings.sidebar.hideUnloadedTabsFromFirefox, true);
  assert.equal(parsed.document.payload.settings.sidebar.showTabSearch, false);
  assert.equal(parsed.document.payload.settings.sidebar.tabSearchPosition, "bottom");
  assert.equal(parsed.document.payload.settings.snapshots.restoreBatchSize, 25);
});

test("schema-18 settings backups import without their stored or embedded font", async () => {
  for (const font of [
    legacyFontRecord(),
    legacyFontRecord({ dataBase64: "AAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" })
  ]) {
    const parsed = await parseBackupText(serializeBackup(await schema18Backup({ font })));
    assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(parsed.document.payload), ["settings"]);
    assert.deepEqual(parsed.document.payload.settings.appearance.typography, {
      source: "system",
      fontFamily: "system-ui",
      fontSize: 20
    });
    assert.doesNotMatch(serializeBackup(parsed.document), /fontAsset|Sidebars Uploaded|dataBase64/);
  }
});

test("schema-18 settings backups still reject a tampered font or a mismatched selection", async () => {
  const tampered = await schema18Backup({ font: legacyFontRecord() });
  tampered.payload.fontAssets[0].name = "Changed";
  await assert.rejects(
    parseBackupText(serializeBackup(tampered)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED
  );

  const mismatched = await schema18Backup({
    font: legacyFontRecord(),
    typography: { source: "system", fontFamily: "system-ui", fontAssetId: null, fontSize: 20 }
  });
  await assert.rejects(
    parseBackupText(serializeBackup(mismatched)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("schema-9 settings backups gain an explicit manual kind", async () => {
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    workspaceState: createSnapshotPayloadFixture().workspaceState
  });
  const previous = structuredClone(current);
  makePreviousSettingsBackup(previous);
  previous.schemaVersion = SETTINGS_BACKUP_V9_SCHEMA_VERSION;
  delete previous.backupKind;
  delete previous.reason;
  delete previous.payload.settings.appearance.typography;
  delete previous.payload.settings.snapshots.automaticSettingsBackupsEnabled;
  previous.payloadDigest = await digest(previous.payload);
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "manual");
});

test("schema-10 settings backups add typography while preserving their kind", async () => {
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    workspaceState: createSnapshotPayloadFixture().workspaceState,
    kind: "automatic"
  });
  const previous = structuredClone(current);
  makePreviousSettingsBackup(previous);
  previous.schemaVersion = SETTINGS_BACKUP_V10_SCHEMA_VERSION;
  delete previous.reason;
  delete previous.payload.settings.appearance.typography;
  delete previous.payload.settings.snapshots.automaticSettingsBackupsEnabled;
  previous.payloadDigest = await digest(previous.payload);
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  // A restored older backup gains the typography of its own era (16px), not
  // the Medium a fresh profile starts with.
  assert.deepEqual(
    parsed.document.payload.settings.appearance.typography,
    createDefaultSettingsStateV32().appearance.typography
  );
});

test("schema-11 settings backups add automatic settings opt-in and provenance defaults", async () => {
  const settings = createDefaultSettingsState();
  settings.sidebar.showActionButtons = true;
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings,
    workspaceState: createSnapshotPayloadFixture().workspaceState,
    kind: "automatic"
  });
  const previous = structuredClone(current);
  makePreviousSettingsBackup(previous);
  previous.schemaVersion = SETTINGS_BACKUP_V11_SCHEMA_VERSION;
  delete previous.reason;
  previous.payload.settings.appearance.typography = {
    customFontEnabled: true,
    fontFamily: "Atkinson Hyperlegible",
    fontSize: 18
  };
  delete previous.payload.settings.snapshots.automaticSettingsBackupsEnabled;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));

  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.reason, null);
  assert.equal(parsed.document.backupKind, "automatic");
  assert.equal(
    parsed.document.payload.settings.snapshots.automaticSettingsBackupsEnabled,
    false
  );
  assert.deepEqual(parsed.document.payload.settings.appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 16
  });
  assert.equal(parsed.document.payload.settings.sidebar.showActionButtons, true);
});

test("schema-12 settings backups discard legacy workspace definitions", async () => {
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    workspaceState: createSnapshotPayloadFixture().workspaceState
  });
  const previous = structuredClone(current);
  makePreviousSettingsBackup(previous);
  previous.schemaVersion = SETTINGS_BACKUP_V12_SCHEMA_VERSION;
  previous.payload.settings.appearance.typography = {
    customFontEnabled: false,
    fontFamily: "system-ui",
    fontSize: 16
  };
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal("containerCatalog" in parsed.document.payload, false);
  assert.equal("workspaceState" in parsed.document.payload, false);
  assert.equal(parsed.document.payload.settings.appearance.workspaceGlowMode, "container");
});

test("schema-13 settings backups migrate legacy local fonts without inventing assets", async () => {
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    workspaceState: createSnapshotPayloadFixture().workspaceState
  });
  const previous = structuredClone(current);
  addCurrentLegacyWorkspacePayload(previous);
  downgradeToSettingsV26(previous.payload.settings);
  downgradePresetSidebar(previous.payload.settings);
  useLegacyContainerGlow(previous.payload.settings.appearance);
  previous.schemaVersion = SETTINGS_BACKUP_V13_SCHEMA_VERSION;
  delete previous.payload.fontAssets;
  delete previous.payload.settings.privacy;
  delete previous.payload.settings.sidebar.rightClickBehavior;
  previous.payload.settings.appearance.typography = {
    customFontEnabled: true,
    fontFamily: "Atkinson Hyperlegible",
    fontSize: 17
  };
  previous.payloadDigest = await digest(previous.payload);
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.deepEqual(parsed.document.payload.settings.appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 16
  });
  assert.equal("fontAssets" in parsed.document.payload, false);
});

test("schema-14 settings backups add Privacy defaults and retire right-click actions", async () => {
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    workspaceState: createSnapshotPayloadFixture().workspaceState
  });
  const previous = structuredClone(current);
  addCurrentLegacyWorkspacePayload(previous);
  addLegacyFontFields(previous);
  downgradeToSettingsV26(previous.payload.settings);
  downgradePresetSidebar(previous.payload.settings);
  useLegacyContainerGlow(previous.payload.settings.appearance);
  previous.schemaVersion = SETTINGS_BACKUP_V14_SCHEMA_VERSION;
  delete previous.payload.settings.privacy;
  delete previous.payload.settings.sidebar.rightClickBehavior;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));

  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(parsed.document.payload.settings.sidebar, "rightClickBehavior"), false);
  assert.deepEqual(parsed.document.payload.settings.privacy, {
    keepPrivateTabsBetweenSessions: false,
    automaticSnapshotsEnabled: false
  });
});

test("schema-15 settings backups migrate font presets and disabled container glow", async () => {
  const current = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    workspaceState: createSnapshotPayloadFixture().workspaceState
  });
  const previous = structuredClone(current);
  addCurrentLegacyWorkspacePayload(previous);
  addLegacyFontFields(previous);
  downgradeToSettingsV26(previous.payload.settings);
  previous.schemaVersion = SETTINGS_BACKUP_V15_SCHEMA_VERSION;
  previous.payload.settings.sidebar.rightClickBehavior = "unload";
  useLegacyContainerGlow(previous.payload.settings.appearance, false);
  previous.payload.settings.appearance.typography.fontSize = 19;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));

  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.appearance.typography.fontSize, 20);
  assert.equal(parsed.document.payload.settings.appearance.workspaceGlowMode, "off");
});

test("schema-17 settings backups discard legacy workspaces and container descriptors", async () => {
  const settings = createDefaultSettingsState();
  settings.sidebar.dividerSize = 28;
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings
  }));
  const workspaceState = createSnapshotPayloadFixture().workspaceState;
  workspaceState.workspaces[0].defaultContainerRef = "ctr-work";
  addCurrentLegacyWorkspacePayload(previous, [{
    refId: "ctr-work",
    descriptor: {
      name: "Work",
      color: "blue",
      icon: "briefcase",
      colorCode: "#37adff"
    }
  }]);
  previous.payload.workspaceState = workspaceState;
  addLegacyFontFields(previous);
  downgradeToSettingsV26(previous.payload.settings);
  previous.schemaVersion = SETTINGS_BACKUP_V17_SCHEMA_VERSION;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));

  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.sidebar.dividerSize, 28);
  assert.deepEqual(Object.keys(parsed.document.payload).sort(), ["settings"]);
  assert.doesNotMatch(serializeBackup(parsed.document), /workspaceState|containerCatalog|ctr-work/);
});

test("schema-19 settings backups verify their original digest, then migrate to current", async () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.automaticEnabled = true;
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings,
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V19_SCHEMA_VERSION;
  downgradeToSettingsV26(previous.payload.settings);
  Object.assign(previous.payload.settings.snapshots, {
    deleteAutomaticEnabled: true,
    deleteAfterValue: 48,
    deleteAfterUnit: "hours",
    retentionCount: 250
  });
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  const snapshots = parsed.document.payload.settings.snapshots;
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  assert.equal(parsed.document.payload.settings.sidebar.showAddWorkspaceButton, true);
  assert.equal(Object.hasOwn(snapshots, "deleteAutomaticEnabled"), false);
  // Schema 31 dropped the age limit outright; the maximum is all that carries
  // forward, and it keeps the value the document was written with.
  assert.equal(Object.hasOwn(snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(Object.hasOwn(snapshots, "deleteAfterValue"), false);
  assert.equal(Object.hasOwn(snapshots, "deleteAfterUnit"), false);
  assert.equal(snapshots.retentionCount, 250);

  const tampered = structuredClone(previous);
  tampered.payload.settings.snapshots.retentionCount = 251;
  await assert.rejects(
    parseBackupText(serializeBackup(tampered)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED
  );

  const withNewerKey = structuredClone(previous);
  withNewerKey.payload.settings.sidebar.showAddWorkspaceButton = true;
  withNewerKey.payloadDigest = await digest(withNewerKey.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(withNewerKey)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("schema-20 settings backups verify schema-27 bytes before adding v28 preferences", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V20_SCHEMA_VERSION;
  addSettingsAgeLimit(previous.payload.settings);
  delete previous.payload.settings.snapshots.restoreBatchSize;
  delete previous.payload.settings.sidebar.warnBeforeClosingMultipleTabs;
  delete previous.payload.settings.sidebar.hideUnloadedTabsFromFirefox;
  delete previous.payload.settings.sidebar.showTabSearch;
  delete previous.payload.settings.sidebar.tabSearchPosition;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  assert.equal(parsed.document.payload.settings.sidebar.warnBeforeClosingMultipleTabs, true);

  const withNewKey = structuredClone(previous);
  withNewKey.payload.settings.sidebar.warnBeforeClosingMultipleTabs = false;
  withNewKey.payloadDigest = await digest(withNewKey.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(withNewKey)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("schema-21 settings backups verify schema-28 bytes before adding v29 preferences", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V21_SCHEMA_VERSION;
  addSettingsAgeLimit(previous.payload.settings);
  delete previous.payload.settings.snapshots.restoreBatchSize;
  delete previous.payload.settings.sidebar.hideUnloadedTabsFromFirefox;
  delete previous.payload.settings.sidebar.showTabSearch;
  delete previous.payload.settings.sidebar.tabSearchPosition;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  assert.equal(parsed.document.payload.settings.sidebar.hideUnloadedTabsFromFirefox, false);
  assert.equal(parsed.document.payload.settings.sidebar.showTabSearch, true);
  assert.equal(parsed.document.payload.settings.sidebar.tabSearchPosition, "top");

  const withNewKey = structuredClone(previous);
  withNewKey.payload.settings.sidebar.showTabSearch = false;
  withNewKey.payloadDigest = await digest(withNewKey.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(withNewKey)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("schema-22 settings backups verify schema-29 bytes before adding the restore batch size", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V22_SCHEMA_VERSION;
  addSettingsAgeLimit(previous.payload.settings);
  delete previous.payload.settings.snapshots.restoreBatchSize;
  previous.payload.settings.sidebar.showTabSearch = false;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  assert.equal(parsed.document.payload.settings.snapshots.restoreBatchSize, 10);
  assert.equal(parsed.document.payload.settings.sidebar.showTabSearch, false);

  const withNewKey = structuredClone(previous);
  withNewKey.payload.settings.snapshots.restoreBatchSize = 5;
  withNewKey.payloadDigest = await digest(withNewKey.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(withNewKey)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("schema-27 settings backups hold schema-34 preferences and reject removed Sync navigation", async () => {
  const backup = await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState()
  });
  assert.equal(backup.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(backup.schemaVersion, 27);
  assert.equal(backup.payload.settings.snapshots.restoreBatchSize, 10);
  assert.equal(backup.payload.settings.sidebar.showAddWorkspaceButton, true);
  assert.equal(backup.payload.settings.sidebar.warnBeforeClosingMultipleTabs, true);
  assert.equal(backup.payload.settings.sidebar.hideUnloadedTabsFromFirefox, false);
  assert.equal(backup.payload.settings.sidebar.showTabSearch, true);
  assert.equal(backup.payload.settings.sidebar.tabSearchPosition, "top");
  assert.equal(backup.payload.settings.snapshots.retentionCount, 100);
  // The automatic-save age limit is gone: the maximum is the only rule.
  assert.equal(Object.hasOwn(backup.payload.settings.snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(Object.hasOwn(backup.payload.settings.snapshots, "deleteAfterValue"), false);
  assert.equal(Object.hasOwn(backup.payload.settings.snapshots, "deleteAfterUnit"), false);

  const removedPanel = structuredClone(backup);
  removedPanel.payload.settings.navigation.lastPanel = "sync";
  removedPanel.payloadDigest = await digest(removedPanel.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(removedPanel)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("schema-26 Settings Backups migrate a remembered Sync panel to Storage", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState()
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V26_SCHEMA_VERSION;
  previous.payload.settings.navigation.lastPanel = "sync";
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.navigation.lastPanel, "storage");
});

test("schema-25 settings backups verify schema-32 bytes and refuse a tab name schema 32 never had", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V25_SCHEMA_VERSION;
  previous.payload.settings.navigation = { rememberLastPanel: true, lastPanel: "storage" };
  previous.payload.settings.snapshots.retentionCount = 250;
  previous.payloadDigest = await digest(previous.payload);

  // Schema 32 settings carry forward unchanged; only the version moves.
  const parsed = await parseBackupText(serializeBackup(previous));
  const restored = parsed.document.payload.settings;
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  assert.deepEqual(restored.navigation, { rememberLastPanel: true, lastPanel: "storage" });
  assert.equal(restored.snapshots.retentionCount, 250);

  // Schema 32 never knew the Optional Firefox Styling tab, so a schema-25
  // backup claiming it is malformed rather than silently accepted.
  const newerName = structuredClone(previous);
  newerName.payload.settings.navigation.lastPanel = "firefox-styling";
  newerName.payloadDigest = await digest(newerName.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(newerName)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );

  // The original bytes still have to verify before any of that.
  const tampered = structuredClone(previous);
  tampered.payload.settings.snapshots.retentionCount = 9;
  await assert.rejects(
    parseBackupText(serializeBackup(tampered)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED
  );
});

test("schema-24 settings backups verify schema-31 bytes before dropping the schedule modes", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V24_SCHEMA_VERSION;
  // A schema-31 document saving at an exact time, with its own interval behind
  // it and the removal warning silenced.
  downgradeToSettingsV31(previous.payload.settings);
  Object.assign(previous.payload.settings.snapshots, {
    scheduleMode: "exact-time",
    exactTime: "07:15",
    intervalValue: 6,
    intervalUnit: "hours",
    retentionCount: 250
  });
  previous.payload.settings.sidebar.warnBeforeWorkspaceRemoval = false;
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  const restored = parsed.document.payload.settings;
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  for (const key of ["scheduleMode", "exactTime", "exactDays"]) {
    assert.equal(Object.hasOwn(restored.snapshots, key), false, key);
  }
  // Save every keeps the interval the backup already held.
  assert.equal(restored.snapshots.intervalValue, 6);
  assert.equal(restored.snapshots.intervalUnit, "hours");
  assert.equal(restored.snapshots.retentionCount, 250);
  assert.equal(Object.hasOwn(restored.sidebar, "warnBeforeWorkspaceRemoval"), false);
  assert.equal(restored.sidebar.warnBeforeLoadingManyTabs, true);

  // The original bytes still have to verify before any of that.
  const tampered = structuredClone(previous);
  tampered.payload.settings.snapshots.retentionCount = 9;
  await assert.rejects(
    parseBackupText(serializeBackup(tampered)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED
  );
});

test("schema-23 settings backups verify schema-30 bytes before dropping the age limit", async () => {
  const previous = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState(),
    kind: "automatic"
  }));
  previous.schemaVersion = SETTINGS_BACKUP_V23_SCHEMA_VERSION;
  // A schema-30 document with the age limit on, and a Settings surface still
  // holding the old default.
  addSettingsAgeLimit(previous.payload.settings, {
    deleteOldAutomaticEnabled: true,
    deleteAfterValue: 14,
    deleteAfterUnit: "days"
  });
  previous.payload.settings.snapshots.retentionCount = 250;
  previous.payload.settings.appearance.settingsBackgroundColor = "#202022";
  previous.payloadDigest = await digest(previous.payload);

  const parsed = await parseBackupText(serializeBackup(previous));
  const snapshots = parsed.document.payload.settings.snapshots;
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.backupKind, "automatic");
  // Restoring it keeps more saves, never fewer, and never keeps the age rule.
  assert.equal(Object.hasOwn(snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(Object.hasOwn(snapshots, "deleteAfterValue"), false);
  assert.equal(snapshots.retentionCount, 250);
  assert.equal(snapshots.restoreBatchSize, 10);
  assert.equal(
    parsed.document.payload.settings.appearance.settingsBackgroundColor,
    "#2b2a33"
  );

  const withNewerShape = structuredClone(previous);
  delete withNewerShape.payload.settings.snapshots.deleteOldAutomaticEnabled;
  withNewerShape.payloadDigest = await digest(withNewerShape.payload);
  await assert.rejects(
    parseBackupText(serializeBackup(withNewerShape)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

function legacySettingsV7() {
  const current = createDefaultSettingsStateV26();
  downgradePresetSidebar(current);
  const sidebar = { ...current.sidebar };
  const appearance = { ...current.appearance };
  delete sidebar.warnBeforeWorkspaceRemoval;
  delete sidebar.rightClickBehavior;
  delete appearance.applyToSettings;
  delete appearance.settingsBackgroundColor;
  delete appearance.typography;
  delete appearance.containerGlowEnabled;
  delete appearance.workspaceGlowMode;
  return {
    schemaVersion: 7,
    sidebar,
    appearance,
    snapshots: {
      automaticEnabled: true,
      intervalValue: 15,
      intervalUnit: "minutes",
      retentionDays: 30,
      retentionCount: 100,
      automaticDownloads: false,
      cleanupExportedFiles: false
    }
  };
}

async function digest(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Settings Backup schemas 19 and earlier hold schema-26-or-older settings.
function downgradeToSettingsV26(settings) {
  downgradeToSettingsV31(settings);
  const {
    showAddWorkspaceButton: _showAddWorkspaceButton,
    warnBeforeClosingMultipleTabs: _warnBeforeClosingMultipleTabs,
    hideUnloadedTabsFromFirefox: _hideUnloadedTabsFromFirefox,
    showTabSearch: _showTabSearch,
    tabSearchPosition: _tabSearchPosition,
    ...sidebar
  } = settings.sidebar;
  const {
    restoreBatchSize: _restoreBatchSize,
    ...snapshots
  } = settings.snapshots;
  settings.sidebar = sidebar;
  // Schemas 8-30 carried an automatic-save age limit that schema 31 removed, so
  // a document degraded to v26 has to carry it again.
  settings.snapshots = {
    ...snapshots,
    deleteAutomaticEnabled: false,
    deleteAfterValue: 30,
    deleteAfterUnit: "days"
  };
  return settings;
}

// Settings schemas 27-30 carried the automatic-save age limit that schema 31
// removed, so a document degraded to one of those shapes has to carry it again.
// Every backup below schema 25 carries settings of schema 31 or older: the two
// retired schedule modes and the workspace-removal warning are still there, and
// the many-tab load warning is not.
function downgradeToSettingsV31(settings) {
  const { warnBeforeLoadingManyTabs: _warnBeforeLoadingManyTabs, ...sidebar } = settings.sidebar;
  settings.sidebar = { ...sidebar, warnBeforeWorkspaceRemoval: true };
  settings.snapshots = {
    ...settings.snapshots,
    scheduleMode: "interval",
    exactTime: "09:00",
    exactDays: [1, 2, 3, 4, 5]
  };
  return settings;
}

function addSettingsAgeLimit(settings, overrides = {}) {
  downgradeToSettingsV31(settings);
  Object.assign(settings.snapshots, {
    deleteOldAutomaticEnabled: false,
    deleteAfterValue: 30,
    deleteAfterUnit: "days",
    ...overrides
  });
  return settings;
}

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

function downgradePresetSidebar(settings) {
  if (!settings.sidebar.workspaceSize) {
    return settings;
  }
  const geometry = {
    [SIDEBAR_SIZE_PRESETS.SMALL]: { railSize: 40, iconSize: 22 },
    [SIDEBAR_SIZE_PRESETS.MEDIUM]: { railSize: 48, iconSize: 30 },
    [SIDEBAR_SIZE_PRESETS.LARGE]: { railSize: 60, iconSize: 42 },
    [SIDEBAR_SIZE_PRESETS.MASSIVE]: { railSize: 72, iconSize: 48 }
  }[settings.sidebar.workspaceSize];
  const { workspaceSize: _workspaceSize, tabSize: _tabSize, ...rest } = settings.sidebar;
  settings.sidebar = {
    railSize: geometry.railSize,
    iconSize: geometry.iconSize,
    ...rest
  };
  return settings;
}

function useLegacyContainerGlow(appearance, enabled = true) {
  delete appearance.workspaceGlowMode;
  appearance.containerGlowEnabled = enabled;
  return appearance;
}

function workspaceStateV4(state = createSnapshotPayloadFixture().workspaceState) {
  return {
    ...state,
    schemaVersion: 4,
    workspaces: state.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace)
  };
}

function snapshotPayloadV2() {
  const current = createSnapshotPayloadFixture();
  return {
    workspaceState: workspaceStateV4(current.workspaceState),
    windows: current.windows.map((window) => ({
      ...window,
      workspaceLayouts: window.workspaceLayouts.map((layout) => ({
        ...layout,
        tabs: layout.tabs.map(({ container: _container, ...tab }) => tab)
      }))
    }))
  };
}

// Settings Backup schemas 14-18 carried a font list and the uploaded-font field.
function addLegacyFontFields(backup) {
  backup.payload.fontAssets = [];
  backup.payload.settings.appearance.typography = {
    ...backup.payload.settings.appearance.typography,
    fontAssetId: null
  };
  return backup;
}

function legacyFontRecord({ dataBase64 = null } = {}) {
  const fontDigest = "ab".repeat(32);
  return {
    id: `font-${fontDigest}`,
    digest: fontDigest,
    family: `Sidebars Uploaded ${fontDigest.slice(0, 12).toUpperCase()}`,
    name: "Synthetic",
    format: "truetype",
    mimeType: "font/ttf",
    byteLength: 28,
    createdAt: "2026-09-05T19:00:00.000Z",
    dataBase64
  };
}

async function schema18Backup({ font = null, typography = null } = {}) {
  const backup = structuredClone(await finalizeSettingsBackup({
    createdAt: "2026-09-05T20:00:00.000Z",
    settings: createDefaultSettingsState()
  }));
  backup.schemaVersion = SETTINGS_BACKUP_V18_SCHEMA_VERSION;
  downgradeToSettingsV26(backup.payload.settings);
  backup.payload.settings.appearance.typography = typography ?? (font
    ? { source: "uploaded", fontFamily: font.family, fontAssetId: font.id, fontSize: 20 }
    : { source: "system", fontFamily: "system-ui", fontAssetId: null, fontSize: 20 });
  backup.payload.fontAssets = font ? [font] : [];
  backup.payloadDigest = await digest(backup.payload);
  return backup;
}

function makePreviousSettingsBackup(backup) {
  downgradeToSettingsV26(backup.payload.settings);
  backup.payload.workspaceState = workspaceStateV4();
  delete backup.payload.containerCatalog;
  delete backup.payload.fontAssets;
  downgradePresetSidebar(backup.payload.settings);
  delete backup.payload.settings.appearance.containerGlowEnabled;
  delete backup.payload.settings.appearance.workspaceGlowMode;
  delete backup.payload.settings.sidebar.rightClickBehavior;
  delete backup.payload.settings.privacy;
  return backup;
}

function addCurrentLegacyWorkspacePayload(backup, containerCatalog = []) {
  backup.payload.workspaceState = createSnapshotPayloadFixture().workspaceState;
  backup.payload.containerCatalog = containerCatalog;
  return backup;
}

test("legacy snapshot imports discard embedded settings and migrate to schema 3", async () => {
  const payload = { ...snapshotPayloadV2(), settings: legacySettingsV7() };
  const legacy = {
    documentType: SNAPSHOT_DOCUMENT_TYPE,
    schemaVersion: 1,
    id: "snapshot-legacy",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T20:00:00.000Z",
    reason: null,
    payloadDigest: await digest(payload),
    payload
  };
  const migrated = await verifySnapshotRecord(legacy);
  assert.equal(migrated.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(migrated.payload).sort(), [
    "containerCatalog",
    "windows",
    "workspaceState"
  ]);
  assert.ok(migrated.payload.windows[0].workspaceLayouts[0].tabs.every(
    ({ container }) => container.kind === "none"
  ));
});

test("schema-2 snapshots migrate every tab and workspace to explicit No Container", async () => {
  const payload = snapshotPayloadV2();
  const previous = {
    documentType: SNAPSHOT_DOCUMENT_TYPE,
    schemaVersion: SNAPSHOT_PREVIOUS_SCHEMA_VERSION,
    id: "snapshot-v2",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T20:00:00.000Z",
    reason: null,
    payloadDigest: await digest(payload),
    payload
  };
  const migrated = await verifySnapshotRecord(previous);
  assert.equal(migrated.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(migrated.payload.containerCatalog, []);
  assert.equal(migrated.payload.workspaceState.schemaVersion, 5);
});

test("current snapshots require exact container assignments and catalog closure", async () => {
  const payload = createSnapshotPayloadFixture();
  const descriptor = {
    name: "Work",
    color: "blue",
    icon: "briefcase",
    colorCode: "#37adff"
  };
  payload.windows[0].workspaceLayouts[0].tabs[0].container = {
    kind: "container",
    refId: "ctr-work"
  };
  await assert.rejects(
    createSnapshotRecord({
      id: "snapshot-missing-catalog",
      kind: SNAPSHOT_KINDS.MANUAL,
      createdAt: "2026-09-05T20:00:00.000Z",
      payload
    }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );

  payload.containerCatalog = [{ refId: "ctr-work", descriptor }];
  assert.equal((await createSnapshotRecord({
    id: "snapshot-closed-catalog",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T20:00:00.000Z",
    payload
  })).payload.containerCatalog.length, 1);

  payload.containerCatalog.push({ refId: "ctr-unused", descriptor });
  await assert.rejects(
    createSnapshotRecord({
      id: "snapshot-unused-catalog",
      kind: SNAPSHOT_KINDS.MANUAL,
      createdAt: "2026-09-05T20:00:00.000Z",
      payload
    }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("legacy settings backups migrate their settings contract without adding tabs", async () => {
  const payload = {
    settings: legacySettingsV7(),
    workspaceState: workspaceStateV4()
  };
  const legacy = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: 1,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(legacy));
  assert.equal(parsed.kind, "settings");
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.schemaVersion, undefined);
  assert.deepEqual(parsed.document.payload.settings.privacy, {
    keepPrivateTabsBetweenSessions: false,
    automaticSnapshotsEnabled: false
  });
  assert.equal(
    Object.hasOwn(parsed.document.payload.settings.snapshots, "deleteOldAutomaticEnabled"),
    false
  );
  assert.equal(parsed.document.payload.settings.snapshots.retentionCount, 9999);
  assert.equal(parsed.document.payload.settings.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(Object.hasOwn(parsed.document.payload.settings.sidebar, "warnBeforeWorkspaceRemoval"), false);
  assert.equal(parsed.document.payload.settings.snapshots.warnBeforeSnapshotDeletion, true);
  assert.doesNotMatch(serializeBackup(parsed.document), /tab-one|one\.invalid/);
});

test("schema-2 settings backups migrate through off-by-default automatic controls", async () => {
  const settings = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  settings.schemaVersion = 8;
  delete settings.navigation;
  delete settings.privacy;
  delete settings.sidebar.warnBeforeWorkspaceRemoval;
  delete settings.snapshots.warnBeforeSnapshotDeletion;
  delete settings.appearance.applyToSettings;
  delete settings.appearance.settingsBackgroundColor;
  settings.snapshots.automaticEnabled = true;
  settings.snapshots.deleteAutomaticEnabled = true;
  settings.snapshots.automaticDownloads = true;
  const payload = {
    settings,
    workspaceState: workspaceStateV4()
  };
  const previous = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_V2_SCHEMA_VERSION,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.schemaVersion, undefined);
  assert.equal(parsed.document.payload.settings.snapshots.automaticEnabled, false);
  assert.equal(
    Object.hasOwn(parsed.document.payload.settings.snapshots, "deleteOldAutomaticEnabled"),
    false
  );
  assert.equal(parsed.document.payload.settings.snapshots.retentionCount, 9999);
  assert.equal(parsed.document.payload.settings.snapshots.automaticDownloads, false);
  assert.equal(parsed.document.payload.settings.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(parsed.document.payload.settings.snapshots.warnBeforeSnapshotDeletion, true);
});

test("schema-3 settings backups add independent deletion warnings", async () => {
  const settings = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  settings.schemaVersion = 9;
  delete settings.navigation;
  delete settings.privacy;
  delete settings.sidebar.warnBeforeWorkspaceRemoval;
  delete settings.snapshots.warnBeforeSnapshotDeletion;
  delete settings.appearance.applyToSettings;
  delete settings.appearance.settingsBackgroundColor;
  const payload = {
    settings,
    workspaceState: workspaceStateV4()
  };
  const previous = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_PREVIOUS_SCHEMA_VERSION,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.schemaVersion, undefined);
  assert.equal(parsed.document.payload.settings.sidebar.warnBeforeLoadingManyTabs, true);
  assert.equal(parsed.document.payload.settings.snapshots.warnBeforeSnapshotDeletion, true);
});

test("schema-4 settings backups add Settings appearance controls without changing highlights", async () => {
  const settings = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  settings.schemaVersion = 10;
  delete settings.navigation;
  delete settings.privacy;
  delete settings.appearance.applyToSettings;
  delete settings.appearance.settingsBackgroundColor;
  const payload = {
    settings,
    workspaceState: workspaceStateV4()
  };
  const previous = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_V4_SCHEMA_VERSION,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.schemaVersion, undefined);
  assert.equal(parsed.document.payload.settings.appearance.applyToSettings, false);
  assert.equal(parsed.document.payload.settings.appearance.settingsBackgroundColor, "#000000");
  assert.deepEqual(
    parsed.document.payload.settings.appearance.activeTabHighlight,
    settings.appearance.activeTabHighlight
  );
});

test("schema-5 settings backups migrate Transparent to Follow Firefox", async () => {
  const settings = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  settings.schemaVersion = 11;
  delete settings.navigation;
  delete settings.privacy;
  settings.appearance.mode = "transparent";
  settings.appearance.solidColor = "#123456";
  const payload = {
    settings,
    workspaceState: workspaceStateV4()
  };
  const previous = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_V5_SCHEMA_VERSION,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.document.payload.settings.schemaVersion, undefined);
  assert.equal(parsed.document.payload.settings.appearance.mode, "firefox");
  assert.equal(parsed.document.payload.settings.appearance.solidColor, "#123456");
});

test("schema-6 settings backups add Settings navigation", async () => {
  const settings = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  settings.schemaVersion = 12;
  delete settings.navigation;
  delete settings.privacy;
  const payload = {
    settings,
    workspaceState: workspaceStateV4()
  };
  const previous = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_V6_SCHEMA_VERSION,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  assert.deepEqual(parsed.document.payload.settings.navigation, {
    rememberLastPanel: true,
    lastPanel: "sidebar"
  });
});

test("schema-8 settings backups add exact automatic schedule defaults", async () => {
  const settings = removeV17Typography(removeV15SnapshotSchedule(createDefaultSettingsStateV26()));
  const payload = {
    settings: {
      sidebar: settings.sidebar,
      appearance: settings.appearance,
      snapshots: settings.snapshots,
      navigation: settings.navigation
    },
    workspaceState: workspaceStateV4()
  };
  const previous = {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_V8_SCHEMA_VERSION,
    createdAt: "2026-09-05T20:00:00.000Z",
    payloadDigest: await digest(payload),
    payload
  };
  const parsed = await parseBackupText(serializeBackup(previous));
  assert.equal(parsed.document.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
  // Schema 8 carried an exact schedule; restoring it now leaves Save every.
  for (const key of ["scheduleMode", "exactTime", "exactDays"]) {
    assert.equal(Object.hasOwn(parsed.document.payload.settings.snapshots, key), false, key);
  }
  assert.equal(parsed.document.payload.settings.snapshots.intervalUnit, "minutes");
});

test("snapshot indexes reject malformed identities", () => {
  assert.deepEqual(parseSnapshotIndex(createDefaultSnapshotIndex()), createDefaultSnapshotIndex());
  assert.throws(
    () => parseSnapshotIndex({ schemaVersion: 1, entries: [], tombstones: ["bad"] }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("legacy capture schedules migrate without inventing cleanup history", () => {
  const migrated = migrateSnapshotScheduleState({
    schemaVersion: 1,
    intervalMinutes: 15,
    nextDueAt: "2026-09-05T20:15:00.000Z",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastResult: null
  });
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.capture.intervalMilliseconds, 900_000);
  assert.deepEqual(migrated.capture.pendingLibraries, []);
  assert.equal(migrated.cleanup.intervalMilliseconds, null);
  assert.deepEqual(migrated.startupProtection, { snapshotId: null, protectedAt: null });
});

test("replacement journals keep Firefox and logical window identities aligned", () => {
  const journal = {
    schemaVersion: RESTORE_JOURNAL_SCHEMA_VERSION,
    id: "restore-one",
    snapshotId: "snapshot-one",
    phase: "cleanup",
    mode: SNAPSHOT_RESTORE_MODES.REPLACE,
    scope: SNAPSHOT_RESTORE_SCOPES.ALL,
    targetWindowId: 7,
    createdWindowIds: [100],
    createdTabIds: [1000],
    originalWindowIds: [7],
    originalTabIds: [70],
    originalLogicalWindowIds: ["window-current"],
    originalLogicalTabIds: ["tab-current"],
    replacementState: createSnapshotPayloadFixture().workspaceState,
    startedAt: "2026-09-05T20:00:00.000Z",
    report: null
  };
  assert.deepEqual(parseRestoreJournal(journal), journal);
  assert.throws(
    () => parseRestoreJournal({ ...journal, originalLogicalWindowIds: [] }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("restore reports validate typed counts, lifecycle, and bounded item details", () => {
  const report = {
    id: "restore-one",
    snapshotId: "snapshot-one",
    status: "partial",
    scope: SNAPSHOT_RESTORE_SCOPES.ALL,
    mode: SNAPSHOT_RESTORE_MODES.COPY,
    startedAt: "2026-09-05T20:00:00.000Z",
    finishedAt: "2026-09-05T20:00:01.000Z",
    created: { workspaces: 1, windows: 1, tabs: 3 },
    applied: { groups: 1, pins: 1, discarded: 0 },
    approximations: [{ kind: "split-restored-as-adjacent-tabs", count: 1, detail: null }],
    skipped: [{ kind: "protected-url", title: "Protected" }],
    failures: [{ kind: "discard-restore-failed", count: 1, detail: null }]
  };
  assert.deepEqual(parseSnapshotRestoreReport(report), {
    ...report,
    applied: {
      workspaces: 0,
      replacedTabs: 0,
      closedTabs: 0,
      closedWindows: 0,
      ...report.applied
    }
  });
  const overwriteReport = {
    ...report,
    mode: SNAPSHOT_RESTORE_MODES.OVERWRITE,
    applied: {
      workspaces: 1,
      groups: 1,
      pins: 1,
      discarded: 0,
      replacedTabs: 0,
      closedTabs: 4,
      closedWindows: 1
    }
  };
  assert.deepEqual(parseSnapshotRestoreReport(overwriteReport), overwriteReport);
  assert.throws(
    () => parseSnapshotRestoreReport({ ...report, created: { ...report.created, tabs: -1 } }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
  assert.throws(
    () => parseSnapshotRestoreReport({ ...report, status: "running" }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );
});

test("settings restore reports accept the navigation section and an unknown section list", () => {
  const report = {
    id: "restore-settings",
    snapshotId: null,
    status: "complete",
    scope: SNAPSHOT_RESTORE_SCOPES.SETTINGS,
    mode: SNAPSHOT_RESTORE_MODES.COPY,
    startedAt: "2026-09-13T12:00:00.000Z",
    finishedAt: "2026-09-13T12:00:01.000Z",
    created: { workspaces: 0, windows: 0, tabs: 0 },
    applied: {
      workspaces: 0,
      groups: 0,
      pins: 0,
      discarded: 0,
      replacedTabs: 0,
      closedTabs: 0,
      closedWindows: 0
    },
    approximations: [],
    skipped: [],
    failures: [],
    sections: ["sidebar", "appearance", "navigation", "snapshots"]
  };
  assert.deepEqual(parseSnapshotRestoreReport(report), report);
  assert.deepEqual(parseSnapshotRestoreReport({ ...report, sections: [] }).sections, []);
  assert.deepEqual(parseSnapshotRestoreReport({ ...report, sections: ["workspaces"] }).sections, ["workspaces"]);
  for (const sections of [["privacy"], ["sidebar", "sidebar"], "sidebar"]) {
    assert.throws(
      () => parseSnapshotRestoreReport({ ...report, sections }),
      (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SETTINGS_PANEL_IDS,
  SETTINGS_PANEL_IDS_V18,
  SETTINGS_PANEL_IDS_V26,
  SETTINGS_PANEL_IDS_V32,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_V18_SCHEMA_VERSION,
  SETTINGS_STATE_V19_SCHEMA_VERSION,
  SETTINGS_STATE_V20_SCHEMA_VERSION,
  SETTINGS_STATE_V21_SCHEMA_VERSION,
  SETTINGS_STATE_V22_SCHEMA_VERSION,
  SETTINGS_STATE_V23_SCHEMA_VERSION,
  SETTINGS_STATE_V24_SCHEMA_VERSION,
  SETTINGS_STATE_V25_SCHEMA_VERSION,
  createDefaultSettingsStateV26,
  migrateSettingsStateV18,
  migrateSettingsStateV19,
  migrateSettingsStateV20,
  migrateSettingsStateV21,
  migrateSettingsStateV22,
  migrateSettingsStateV23,
  migrateSettingsStateV24,
  migrateSettingsStateV25,
  parseSettingsStateV18,
  parseSettingsStateV26
} from "../../src/contracts/settings-state.js";

test("settings v18 migrates through storage, font-asset, sidebar, and presentation schemas", () => {
  assert.equal(SETTINGS_STATE_V18_SCHEMA_VERSION, 18);
  assert.equal(SETTINGS_STATE_V19_SCHEMA_VERSION, 19);
  assert.equal(SETTINGS_STATE_V20_SCHEMA_VERSION, 20);
  assert.equal(SETTINGS_STATE_V21_SCHEMA_VERSION, 21);
  assert.equal(SETTINGS_STATE_V23_SCHEMA_VERSION, 23);
  assert.equal(SETTINGS_STATE_V24_SCHEMA_VERSION, 24);
  assert.equal(SETTINGS_STATE_V25_SCHEMA_VERSION, 25);
  assert.equal(SETTINGS_STATE_SCHEMA_VERSION, 34);
  assert.equal(SETTINGS_PANEL_IDS_V18.length, 7);
  assert.deepEqual(SETTINGS_PANEL_IDS_V26, [...SETTINGS_PANEL_IDS_V18, "storage"]);
  assert.deepEqual(SETTINGS_PANEL_IDS_V32, [...SETTINGS_PANEL_IDS_V26, "overview"]);
  assert.deepEqual(SETTINGS_PANEL_IDS, [...SETTINGS_PANEL_IDS_V32, "firefox-styling"].filter((id) => id !== "sync"));
  const current = createDefaultSettingsStateV26();
  const previousAppearance = { ...current.appearance };
  delete previousAppearance.containerGlowEnabled;
  delete previousAppearance.workspaceGlowMode;
  previousAppearance.typography = {
    customFontEnabled: false,
    fontFamily: "system-ui",
    fontSize: 16
  };
  const previousSidebar = { ...current.sidebar };
  delete previousSidebar.workspaceSize;
  delete previousSidebar.tabSize;
  previousSidebar.railSize = 48;
  previousSidebar.iconSize = 30;
  delete previousSidebar.rightClickBehavior;
  const previous = parseSettingsStateV18({
    ...current,
    schemaVersion: 18,
    appearance: previousAppearance,
    sidebar: previousSidebar
  });
  const v19 = migrateSettingsStateV18(previous);
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
  assert.deepEqual(migrateSettingsStateV25(v25), current);
  assert.throws(() => parseSettingsStateV18({
    ...previous,
    navigation: { rememberLastPanel: true, lastPanel: "storage" }
  }));
  assert.equal(parseSettingsStateV26({
    ...current,
    navigation: { rememberLastPanel: true, lastPanel: "storage" }
  }).navigation.lastPanel, "storage");
});

test("workspace views are favicon-URL-free and sidebar presentation uses only cache blobs", async () => {
  const [view, controller, workspaceBrowser, tabPane, presenter, sidebarMain, backgroundMain] = await Promise.all([
    readFile(new URL("../../src/contracts/workspace-view.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/core/workspace-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/platform/firefox/workspace-browser.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/tab-pane.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/favicon-presenter.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/background/main.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(view, /favIconUrl/);
  assert.doesNotMatch(controller, /favIconUrl/);
  assert.match(workspaceBrowser, /delete result\.favIconUrl/);
  assert.doesNotMatch(tabPane, /\.src\s*=\s*tab\./);
  assert.match(presenter, /URL\.createObjectURL|createObjectURL/);
  assert.match(presenter, /URL\.revokeObjectURL|revokeObjectURL/);
  assert.match(presenter, /#releaseResource/);
  assert.match(presenter, /synchronizeLiveTabs/);
  assert.match(presenter, /handleSourceChange/);
  assert.match(presenter, /handleTabUpdate/);
  assert.match(presenter, /handleTabReplaced/);
  assert.match(presenter, /handleTabRemoved/);
  assert.doesNotMatch(presenter, /#revokeAll|#resetImages/);
  assert.doesNotMatch(presenter, /sourceDigest|candidateUrl|pageUrl/);
  assert.doesNotMatch(sidebarMain, /sourceDigest|candidateUrl|pageUrl/);
  assert.match(presenter, /FAVICON_MESSAGE_TYPES\.LOOKUP/);
  assert.match(sidebarMain, /FAVICON_MESSAGE_TYPES\.CHANGED/);
  assert.match(sidebarMain, /"default-search"/);
  assert.equal((backgroundMain.match(/faviconCacheService\.observeTab\(/g) ?? []).length, 1);
  assert.match(backgroundMain, /faviconBrowser\.observe\(\{[\s\S]*?onObserve:[\s\S]*?faviconCacheService\.observeTab/);
  assert.match(backgroundMain, /onDefaultSearchRefresh:[\s\S]*?refreshDefaultSearchIconForOpenTabs/);
});

test("manifest, packaging, and Storage UI pin the local-first boundary", async () => {
  const [manifestText, packageText, html, storagePanel, settingsClient, styles] = await Promise.all([
    readFile(new URL("../../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/storage-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/settings-client.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.permissions, [
    "sessions", "storage", "alarms", "unlimitedStorage", "tabs", "tabHide", "tabGroups", "menus", "theme", "search", "contextualIdentities"
  ]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions,
    { required: ["none"] }
  );
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /img-src 'self' blob: moz-extension:/);
  assert.doesNotMatch(csp.match(/img-src[^;]+/)?.[0] ?? "", /https?:/);
  assert.match(csp, /connect-src 'self' https:/);
  const ignoreFiles = JSON.parse(packageText).webExt.ignoreFiles;
  assert.deepEqual(ignoreFiles, [
    "**/*",
    "!manifest.json",
    "!src",
    "!src/**",
    // The optional Firefox style sheet Settings offers for download; only
    // this one of the three sheets ships.
    "!userchrome",
    "!userchrome/original.css",
    "!CHANGELOG.md",
    "!LICENSE",
    "!PRIVACY.md",
    "!README.md",
    "!SECURITY.md"
  ]);
  assert.match(html, /data-panel-content="storage"/);
  assert.match(html, /See and manage website icons saved by Terminus\./);
  assert.match(html, /settings-card-kicker">Website icons/);
  assert.match(html, /storage-icon-gallery/);
  assert.match(html, /storage-access-list/);
  assert.match(html, /storage-clear-dialog/);
  assert.doesNotMatch(html, /id="storage-refresh"/);
  assert.doesNotMatch(html, /allowance|storage-meter|storage-snapshot-bytes|storage-custom-icon-bytes/i);
  assert.match(storagePanel, /0 B/);
  assert.match(storagePanel, /requestHostAccess/);
  assert.match(storagePanel, /confirmHostAccess/);
  assert.match(storagePanel, /FAVICON_MESSAGE_TYPES\.CHANGED/);
  assert.match(storagePanel, /async function loadAllIcons\(\)/);
  assert.match(storagePanel, /createObjectURL\(new Blob\(\[icon\.bytes\]/);
  assert.match(storagePanel, /revokeObjectURL\(url\)/);
  assert.match(storagePanel, /setActive\(value\)/);
  assert.doesNotMatch(storagePanel, /refreshButton/);
  assert.match(settingsClient, /permissions\.request\(\{ origins: \[pattern\] \}\)/);
  assert.match(styles, /\.storage-access-row/);
  assert.match(styles, /\.storage-actions button/);
});

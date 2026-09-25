import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cleanupSummaryText,
  latestAutomaticSnapshotCreatedAt,
  sanitizeBoundedIntegerText,
  snapshotProvenance
} from "../../src/settings/snapshots-panel.js";
import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  gradientColorAtPosition,
  gradientStopNote,
  normalizeHexDraft
} from "../../src/settings/appearance-panel.js";

test("settings document exposes nine in-tab panels and a separate snapshot viewer", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const textScalingIcon = await readFile(
    new URL("../../src/assets/icons/case-sensitive.svg", import.meta.url),
    "utf8"
  );
  for (const panel of ["sidebar", "appearance", "workspaces", "snapshots", "snapshot-viewer", "privacy", "storage", "firefox-styling", "overview"]) {
    assert.match(html, new RegExp(`data-panel="${panel}"`));
    assert.match(html, new RegExp(`data-panel-content="${panel}"`));
  }
  assert.match(html, /id="settings-section"/);
  assert.match(html, /id="show-action-buttons"/);
  assert.match(html, /id="snapshots-automatic-enabled"/);
  assert.match(html, /id="snapshots-import-file"/);
  assert.match(html, /id="settings-backup-import-file"/);
  assert.match(html, /id="settings-backups-automatic-enabled"/);
  assert.match(html, /id="snapshots-restore-report"/);
  assert.match(html, /id="snapshot-viewer-tree"/);
  assert.match(html, /id="snapshots-open-all"/);
  assert.match(html, /id="snapshot-viewer-last-automatic-save"/);
  assert.match(html, /id="snapshot-viewer-next-automatic-save"/);
  assert.doesNotMatch(html, /Open File Location|snapshots-open-(?:automatic|manual)-location/);
  assert.doesNotMatch(html, /name="appearance-mode" value="transparent"|>Transparent</);
  assert.match(html, /id="apply-theme-to-settings"/);
  assert.match(html, /id="settings-background-color"/);
  assert.match(html, /id="settings-remember-last-panel"/);
  assert.match(html, /id="private-keep-tabs"/);
  assert.doesNotMatch(html, /id="private-automatic-snapshots"|id="private-create"|id="private-snapshot-list"|id="private-export"/);
  assert.match(html, /id="snapshots-navigation-label"/);
  assert.match(html, /id="snapshot-viewer-navigation-label"/);
  assert.match(html, /id="private-clear-recovery-dialog"/);
  assert.doesNotMatch(html, /data-panel="sync"|data-panel-content="sync"|Firefox Sync|Terminus Devices/);
  assert.doesNotMatch(html, /unload-binding|keybind/i);
  assert.doesNotMatch(html, /id="snapshots-duplicate-workspaces"|Create duplicate workspaces/);
  assert.ok(html.indexOf('id="snapshot-viewer-panel"') < html.indexOf('id="snapshot-viewer-tree"'));
  assert.ok(html.indexOf('id="snapshots-panel"') < html.indexOf('id="snapshot-viewer-panel"'));
  assert.doesNotMatch(html, /Master Save|snapshots-update-master|snapshots-restore-mode/);
  assert.match(html, />Snapshot Viewer</);
  assert.doesNotMatch(html, /Save automatic snapshot files|Redirect Snapshots to downloads/);
  assert.match(html, />Automatic backups</);
  assert.match(html, />Settings Backups</);
  assert.doesNotMatch(html, />Sidebar Settings Backups</);
  const snapshotsPanelMarkup = html.slice(
    html.indexOf('id="snapshots-panel"'),
    html.indexOf('id="snapshot-viewer-panel"')
  );
  const snapshotViewerMarkup = html.slice(
    html.indexOf('id="snapshot-viewer-panel"'),
    html.indexOf('id="privacy-panel"')
  );
  assert.match(snapshotsPanelMarkup, /id="settings-backups-heading"/);
  assert.doesNotMatch(snapshotViewerMarkup, /id="settings-backups-heading"/);
  assert.doesNotMatch(html, /id="interface-font-family"|id="font-upload-file"|id="remove-uploaded-font"/);
  assert.match(html, />Text size</);
  assert.equal((html.match(/name="workspaceSize"/g) ?? []).length, 4);
  assert.equal((html.match(/name="tabSize"/g) ?? []).length, 4);
  assert.equal((html.match(/name="settingsFontSize"/g) ?? []).length, 3);
  for (const pixels of [16, 20, 28]) {
    assert.match(html, new RegExp(`name="settingsFontSize" value="${pixels}"`));
  }
  assert.doesNotMatch(html, /name="settingsFontSize" value="40"/);
  assert.doesNotMatch(
    html,
    /(?:16|20|28|40) × (?:16|20|28|40) px|<small>(?:16|20|28|40) px<\/small>/
  );
  for (const name of ["Small", "Medium", "Large", "Extra large"]) {
    assert.match(html, new RegExp(`name="workspaceSize"[^>]*aria-label="${name}"`));
    assert.match(html, new RegExp(`name="tabSize"[^>]*aria-label="${name}"`));
  }
  assert.match(html, /size-preview--workspace/);
  assert.match(html, /size-preview--tab[^>]*>[\s\S]*?<i>A<\/i>/);
  assert.match(html, /size-preview--font[^>]*>[\s\S]*?<i><\/i>/);
  assert.doesNotMatch(html, /id="workspace-size-help"|id="tab-size-help"/);
  assert.doesNotMatch(html, /aria-describedby="(?:workspace|tab)-size-help"/);
  assert.doesNotMatch(html, /Follow your Firefox theme, or set your own color\. Gradients take two to six stops\./);
  assert.match(textScalingIcon, /Terminus original artwork/);
  assert.match(textScalingIcon, /<path d="M2\.5 18 7 6l4\.5 12M4\.2 14h5\.6"\/>/);
  assert.match(textScalingIcon, /<circle cx="17\.25" cy="14\.75" r="3\.25"\/>/);
  assert.doesNotMatch(html, />Delete old automatic saves</);
  assert.doesNotMatch(html, /id="snapshots-delete-old-enabled"|id="snapshots-delete-after-value"|id="snapshots-delete-after-unit"/);
  assert.doesNotMatch(html, /id="snapshots-restore-settings"/);
  assert.doesNotMatch(html, /Workplace saves/);
  assert.doesNotMatch(html, /Unload settings|Deletion settings|Backup settings|Repair settings/);
});

test("the gradient rail, content-mode previews, and snapshot scheduling keep their controls", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const appearance = await readFile(
    new URL("../../src/settings/appearance-panel.js", import.meta.url),
    "utf8"
  );
  const snapshots = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");
  const privacy = await readFile(
    new URL("../../src/settings/privacy-panel.js", import.meta.url),
    "utf8"
  );

  assert.match(html, /name="appearance-mode" value="default"/);
  assert.match(html, /value="default"[\s\S]*?Firefox dark<\/strong><small>The fixed dark surface\.<\/small>/);
  assert.match(
    html,
    /name="appearance-mode" value="firefox"[\s\S]*?name="appearance-mode" value="default"[\s\S]*?name="appearance-mode" value="solid"[\s\S]*?name="appearance-mode" value="gradient"/
  );
  assert.match(html, /id="solid-color-hex" class="hex"/);
  assert.match(html, /id="solid-color" class="btn" type="button">Pick a color<\/button>/);
  assert.match(html, /id="gradient-selected-swatch" class="swatch"/);
  assert.match(html, /id="gradient-stop-note"/);
  assert.match(html, /id="gradient-rail"/);
  assert.match(html, /id="gradient-selected-hex"[^>]*type="text"[^>]*value="#"/);
  assert.doesNotMatch(html, /id="gradient-selected-position"|Selected stop color/);
  assert.match(html, /id="remove-gradient-stop" class="btn is-danger"/);
  assert.match(html, />Add stop</);
  assert.match(html, /id="remove-gradient-stop"[^>]*>Remove stop<\/button>/);
  assert.match(html, /content-mode-preview--full/);
  assert.match(html, /content-mode-preview--icons/);
  // One schedule is left: Save every, with no mode to choose between.
  assert.doesNotMatch(html, /snapshot-schedule-mode|snapshots-exact-time|snapshots-exact-days/);
  assert.match(html, /id="snapshots-interval-value"/);
  assert.match(html, /id="snapshots-test-automatic"[^>]*>Start 5-second test<\/button>/);
  assert.match(appearance, /GRADIENT_LIMITS\.maxStops/);
  assert.match(appearance, /gradientRail\.addEventListener\("pointerdown"/);
  assert.match(appearance, /const markerByStop = new Map\(\)/);
  assert.match(appearance, /updateStopPosition\(railDrag\.stop, positionFromPointer\(event\), \{ save: false \}\)/);
  assert.match(appearance, /const movedStop = railDrag\.stop;[\s\S]*?queueSave\(\)/);
  assert.match(appearance, /ArrowLeft[\s\S]*?ArrowRight[\s\S]*?Home[\s\S]*?End/);
  // A stop owns its colour: moving it never recolours it, and the rail is
  // drawn in the gradient being edited rather than a rainbow scale.
  const moveStop = appearance.match(/function updateStopPosition[\s\S]*?\r?\n  \}/)[0];
  assert.doesNotMatch(moveStop, /\.color =/);
  assert.doesNotMatch(appearance, /rainbow/i);
  assert.match(appearance, /color: gradientColorAtPosition\(stops, position\)/);
  assert.match(appearance, /Enter six hex digits after #/);
  assert.equal(normalizeHexDraft("2b2a33"), "#2B2A33");
  assert.equal(normalizeHexDraft("#ff00aa"), "#FF00AA");
  assert.equal(normalizeHexDraft(""), "#");
  const blackToWhite = [{ color: "#000000", position: 0 }, { color: "#ffffff", position: 100 }];
  assert.equal(gradientColorAtPosition(blackToWhite, 50), "#808080");
  assert.equal(gradientColorAtPosition(blackToWhite, 0), "#000000");
  assert.equal(gradientColorAtPosition(blackToWhite, 100), "#ffffff");
  const inset = [
    { color: "#ff0000", position: 20 },
    { color: "#0000ff", position: 60 },
    { color: "#00ff00", position: 80 }
  ];
  assert.equal(gradientColorAtPosition(inset, 5), "#ff0000");
  assert.equal(gradientColorAtPosition(inset, 40), "#800080");
  assert.equal(gradientColorAtPosition(inset, 70), "#008080");
  assert.equal(gradientColorAtPosition(inset, 95), "#00ff00");
  assert.equal(gradientStopNote(1, 3), "Selected stop 2 of 3. Drag a stop to move it.");
  assert.match(appearance, /"--gradient-rail-fill"/);
  assert.match(css, /\.gradient-rail\s*\{[^}]*background: var\(--gradient-rail-fill/);
  assert.doesNotMatch(css.match(/\.gradient-rail\s*\{[^}]*\}/)[0], /#f00|#0ff/);
  assert.match(css, /\.gradient-marker\[data-selected="true"\]/);
  assert.doesNotMatch(snapshots, /automaticDownloads/);
  assert.match(snapshots, /retentionCount\.disabled = !scheduledEnabled;/);
  assert.doesNotMatch(snapshots, /deleteOldEnabled|deleteAfterValue|deleteAfterUnit/);
  assert.match(snapshots, /classList\.toggle\("is-disabled"/);
  assert.match(snapshots, /snapshotClient\(\)\.testAutomatic\(\)/);
  assert.match(snapshots, /privateClient\.setAutomaticSnapshots\(enabled\)/);
  assert.match(snapshots, /const nextPrivateContext = privateOverview\.privateContext === true;/);
  assert.match(snapshots, /configureScope\(nextPrivateContext\)/);
  assert.match(snapshots, /\? "Saves private workspaces and tabs on this computer\."\s*: "Saves workspaces and tabs\."/);
  assert.doesNotMatch(snapshots, /validateImportedFontAssets|validateFontInDocument|font-assets|font-loader/);
  assert.match(appearance, /selectedStop\.color = color;/);
  assert.doesNotMatch(appearance, /TYPOGRAPHY_SOURCES\.UPLOADED|fontUploadFile|fontClient/);
  assert.match(appearance, /appearance\.typography\.fontSize = Number\(input\.value\)/);
  assert.match(appearance, /--settings-font-size/);
  assert.match(css, /\.setting-row\s*\{[\s\S]*?border: 1px solid[\s\S]*?border-radius: var\(--r-2\)/);
  assert.doesNotMatch(`${html}\n${snapshots}`, /â|Ã|ï¿½|�/);
  assert.doesNotMatch(privacy, /\bconfirm\(/);
});

test("the workspaces editor pairs a selectable rail preview with one inspector", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const panel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );

  // Two panes, with the preview announcing that it takes several selections.
  const preview = html.indexOf('id="rail-preview"');
  const inspector = html.indexOf('id="rail-inspector"');
  assert.ok(preview > 0, "the rail preview exists");
  assert.ok(inspector > preview, "the inspector follows the preview");
  assert.match(html, /id="rail-preview"[^>]*role="listbox"/);
  assert.match(html, /id="rail-preview"[^>]*aria-multiselectable="true"/);
  assert.match(html, /id="rail-selection-status"[^>]*role="status"[^>]*aria-live="polite"/);

  // Selection is keyed, so a whole-state re-render cannot strand or move it.
  assert.match(panel, /from "\.\/rail-selection\.js"/);
  assert.match(panel, /selection = pruneSelection\(selection, state\.rail\);/);
  assert.match(panel, /row\.setAttribute\("role", "option"\);/);
  assert.match(panel, /row\.setAttribute\("aria-selected", String\(active\)\);/);

  // A drag that starts on a selected row carries the whole selection, and a
  // target inside the selection is never a drop point.
  assert.match(panel, /const carriesSelection =/);
  assert.match(panel, /client\.placeMany\(members, target, completedDrag\.position\)/);
  assert.match(panel, /!members\.some\(\(member\) => locatorKey\(member\) === locatorKey\(target\)\)/);

  // Shared edits go through one batch call rather than a loop of singles.
  assert.match(panel, /client\.updateMany\(workspaceIds, \{ icon: iconId \}\)/);
  assert.match(panel, /client\.updateMany\(workspaceIds, \{ color \}\)/);
  assert.match(panel, /client\.insertMany\(\[/);
  assert.match(panel, /client\.duplicateMany\(copiedWorkspaceIds/);

  // Copy never leaves the page.
  assert.doesNotMatch(panel, /navigator\.clipboard|localStorage|sessionStorage/);

  // Mixed values say so instead of claiming a shared one.
  assert.match(panel, /function sharedValue\(values\) \{/);
  assert.match(panel, /rail-mixed-note/);

  // Delete, copy and paste reach the selection from the keyboard.
  assert.match(
    panel,
    /event\.key === "Delete" \|\| event\.key === "Backspace"[\s\S]*?deleteSelection\(\);/
  );
  assert.match(panel, /event\.key === "c" \|\| event\.key === "C"[\s\S]*?copySelection\(\);/);
  assert.match(panel, /event\.key === "v" \|\| event\.key === "V"[\s\S]*?pasteSelection\(\);/);
  // Several workspaces delete in a planned order, so none hands its tabs to a
  // workspace that is itself about to be removed. The parking that arranges
  // that now happens in the background, in the same call as the removals.
  assert.match(panel, /planRemovalIntoFirstWorkspace\(state\.rail, workspaceIds\)/);
  assert.match(panel, /requestWorkspaceRemovals\(workspaces\.map/);
  const controller = await readFile(
    new URL("../../src/core/workspace-controller.js", import.meta.url),
    "utf8"
  );
  assert.match(controller, /prepareWorkspaceBatchRemoval\(workspaceIds, decorations, executorLease = null\)/);
  assert.match(controller, /this\.#stateService\.placeRailEntries\(\r?\n\s*plan\.parkLocators/);
  // Paste keeps the count out of its label.
  assert.match(panel, /paste\.textContent = "Paste";/);

  // The inspector follows the selection instead of sitting at the top of a
  // tall rail, anchored to the first selected row in rail order.
  assert.match(panel, /function positionInspector\(\) \{/);
  assert.match(panel, /railInspector\.style\.marginBlockStart = "";/);
  assert.match(panel, /railPreview\.querySelector\("\.rail-preview-row\.is-selected"\)/);
  // Clamped at the preview's own bottom, so a selection near the end of a long
  // rail cannot hang past it and stretch the editor into a new scroll.
  assert.match(panel, /const reach = previewPane\.offsetHeight - railInspector\.offsetHeight;/);
  assert.match(panel, /Math\.min\(anchor\.getBoundingClientRect\(\)\.top - top, reach\)/);
  // One column stacks the inspector under the rail, where tracking a row means
  // nothing, so the offset is skipped rather than applied to a stacked pane.
  assert.match(panel, /previewPane\.offsetWidth >= editor\.clientWidth - 1/);
  // The sticky inspector reports where it is stuck, not where it belongs, so
  // its own rect must stay out of the measurement.
  const positioning = panel.match(/function positionInspector\(\)[\s\S]*?\n  \}\n/)[0];
  assert.doesNotMatch(positioning, /railInspector\.getBoundingClientRect/);
  // Width changes move the rows and can collapse the layout outright.
  assert.match(panel, /window\.addEventListener\("resize", positionInspector\);/);

  // One icon grid serves a single workspace and a selection, and it offers
  // custom icons too, not only the 40 presets.
  const shared = panel.slice(panel.indexOf("function iconChoiceGrid("), panel.indexOf("function fieldLabel("));
  assert.match(shared, /for \(const icon of WORKSPACE_ICON_CATALOG\)/);
  assert.match(shared, /const customIcons = customIconUrls\?\.list\(\) \?\? \[\];[\s\S]*?appendChoice\(icon\.id, icon\.label, customGroup\)/);

  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");
  // The icons sit in the field itself and scroll there, so the inspector's own
  // edge cannot clip them and no dropdown has to escape its scroll box.
  assert.doesNotMatch(panel, /icon-picker|<details/);
  assert.match(css, /\.rail-shared-icons \{[^}]*overflow-y: auto;/);
  // The inspector stacks its fields so the container select cannot overflow
  // the pane, and stays in view while a long rail scrolls past it.
  assert.match(css, /\.rail-inspector \.workspace-fields \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.rail-inspector \{[\s\S]*?position: sticky;/);
});

test("private Settings reuses the snapshot panels while normal services stay isolated", async () => {
  const backgroundMain = await readFile(
    new URL("../../src/background/main.js", import.meta.url),
    "utf8"
  );

  assert.match(
    backgroundMain,
    /const snapshotResponse = handleSnapshotMessage\(message, sender\);/
  );
  assert.doesNotMatch(
    backgroundMain,
    /const snapshotResponse = sender\?\.tab\?\.incognito === true\s*\?\s*undefined\s*:\s*handleSnapshotMessage/
  );
  const settingsMain = await readFile(
    new URL("../../src/settings/main.js", import.meta.url),
    "utf8"
  );
  const privacyPanel = await readFile(
    new URL("../../src/settings/privacy-panel.js", import.meta.url),
    "utf8"
  );
  assert.match(settingsMain, /createSnapshotsPanel\(\{[\s\S]*?privateClient/);
  assert.match(settingsMain, /PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX[\s\S]*?snapshotsPanel\.refresh/);
  for (const storageKey of [
    "PRIVATE_RECOVERY_STORAGE_KEY",
    "PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY",
    "PRIVATE_RESTORE_JOURNAL_STORAGE_KEY",
    "PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY"
  ]) {
    assert.match(privacyPanel, new RegExp(storageKey));
  }
  assert.match(settingsMain, /privacyPanel\.notifyLocalStorageChanged\(changes\)/);
  assert.match(settingsMain, /pagehide[\s\S]*?privacyPanel\.destroy\(\)/);
  // #private-status is the panel's own live region. Reporting through the
  // page-wide status as well printed and announced every privacy message twice.
  assert.doesNotMatch(privacyPanel, /setStatus/);
  assert.match(settingsMain, /createPrivacyPanel\(\{ client: privateClient \}\)/);

  // The private viewer takes an ordinary snapshot file, so the panel says what
  // the copy loses and how long it stays rather than leaving both to be found
  // out. Private snapshot records live in storage.local and are removed only by
  // an explicit delete, a clear, or automatic retention.
  const snapshotsPanel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  assert.match(
    snapshotsPanel,
    /An ordinary snapshot file imports here as a private copy, without its containers, and stays until you remove it\./
  );
  const privateContracts = await readFile(
    new URL("../../src/contracts/private-snapshots.js", import.meta.url),
    "utf8"
  );
  // The crossing is one way and structural, not a convention.
  assert.match(privateContracts, /value\?\.documentType === SNAPSHOT_DOCUMENT_TYPE/);
  assert.match(privateContracts, /payload: toPrivateSnapshotPayload\(record\.payload\)/);
});

test("container controls expose opt-in disclosure, accessible markers, and private disablement", async () => {
  const settingsHtml = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const workspacePanel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );
  const settingsClient = await readFile(
    new URL("../../src/settings/settings-client.js", import.meta.url),
    "utf8"
  );
  const sidebarHtml = await readFile(new URL("../../src/sidebar/index.html", import.meta.url), "utf8");
  const sidebarPane = await readFile(new URL("../../src/sidebar/tab-pane.js", import.meta.url), "utf8");
  const sidebarCss = await readFile(new URL("../../src/sidebar/styles.css", import.meta.url), "utf8");
  const settingsCss = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  assert.match(settingsHtml, /id="enable-container-support"/);
  assert.match(workspacePanel, /"permission-required": \["Off", "", "Firefox will ask for cookies access when you enable this\."\]/);
  assert.match(settingsHtml, /id="container-support-pill" class="state-pill"/);
  assert.match(settingsHtml, /Terminus never reads cookies/);
  assert.match(settingsHtml, /Use a default container for new tabs opened in that workspace\. Not available in private windows\.<\/p>[\s\S]*?Existing tabs keep their containers\. Terminus never reads cookies\./);
  assert.match(settingsHtml, /id="enable-container-support"[^>]*>Enable containers</);
  assert.match(workspacePanel, /enableContainerSupport\.textContent = "Enable containers";/);
  assert.match(settingsHtml, />Firefox Icons</);
  assert.doesNotMatch(settingsHtml, />Terminus Icons</);
  assert.match(settingsHtml, /id="create-container-color"[^>]*class="btn container-color-button"/);
  assert.match(settingsHtml, /id="submit-create-container"[^>]*>Create container</);
  assert.match(settingsHtml, /id="workspace-glow-mode"/);
  assert.match(settingsHtml, /name="workspace-glow-mode" value="container"[\s\S]*?Container color</);
  assert.match(settingsHtml, /name="workspace-glow-mode" value="workspace"[\s\S]*?Workspace color</);
  assert.match(settingsHtml, /name="workspace-glow-mode" value="off"[\s\S]*?Off</);
  assert.doesNotMatch(settingsHtml, /<select id="workspace-glow-mode"/);
  assert.match(settingsHtml, /workspaces whose default container is available/);
  assert.match(settingsHtml, /id="create-container-dialog"/);
  assert.match(settingsHtml, /id="snapshot-container-dialog"/);
  assert.match(settingsHtml, /Ignore Containers restores the tabs as ordinary browsing tabs/);
  assert.doesNotMatch(settingsHtml, /Rename Firefox container|Delete Firefox container/);
  assert.match(settingsClient, /permissions\.request\(\{[\s\S]*?CONTAINER_OPTIONAL_PERMISSIONS/);
  assert.match(workspacePanel, /containers\.capability === "private-unavailable"/);
  assert.match(workspacePanel, /noneOption\.textContent = "None"/);
  assert.doesNotMatch(workspacePanel, /managedNameConflicts|managedNameConflictMessage/);
  assert.match(settingsCss, /\.workspace-editor\s*\{[\s\S]*?container-type: inline-size/);
  assert.match(settingsCss, /\.container-support-copy/);
  assert.match(
    settingsCss,
    /@container \(max-width: 43rem\)[\s\S]*?\.workspace-editor-row > \.workspace-row-controls[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 2;/
  );
  assert.match(sidebarHtml, /id="new-workspace-tab"/);
  assert.match(sidebarHtml, /id="new-workspace-tab"[^>]*aria-haspopup="menu"/);
  assert.doesNotMatch(sidebarHtml, /id="new-workspace-tab-menu"/);
  assert.match(sidebarPane, /tab-container-marker/);
  assert.match(sidebarPane, /stateIndicator\.setAttribute\("aria-label", stateIndicator\.title\)/);
  assert.match(sidebarPane, /descriptor\?\.colorCode \?\? workspaceColor/);
  assert.match(sidebarCss, /data-workspace-glow-mode="container"/);
  assert.match(sidebarCss, /data-workspace-glow-mode="workspace"/);
  assert.match(sidebarCss, /--workspace-container-color/);
  const workspaceGlowSelectors = sidebarCss
    .split(/\r?\n/)
    .filter((line) => line.includes('[data-workspace-glow-mode="workspace"]'));
  assert.ok(workspaceGlowSelectors.length > 0);
  for (const selector of workspaceGlowSelectors) {
    assert.match(selector, /\.workspace-entry\[data-container-status="available"\]/);
  }
  assert.match(sidebarCss, /mask: url\("\.\.\/assets\/icons\/star\.svg"\)/);
  assert.match(sidebarCss, /data-load-state="loaded"\][\s\S]*?star-filled\.svg/);
  assert.match(sidebarCss, /data-load-state="unloaded"\] \.workspace-icon/);
  assert.match(sidebarCss, /\.workspace-container-unavailable/);
  assert.doesNotMatch(workspacePanel, /â|Ã|ï¿½|�/);
  const snapshotsPanel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  assert.match(snapshotsPanel, /option\.textContent = choice\.descriptor\.name/);
  assert.match(snapshotsPanel, /recreate\.textContent = reference\.descriptor\.name/);
  assert.match(snapshotsPanel, /none\.textContent = "Ignore Containers"/);
  assert.doesNotMatch(snapshotsPanel, /Use Existing:|Restore Saved Container:|Use No Container/);
  assert.doesNotMatch(snapshotsPanel, /Skip affected tabs|metadata match|Create new:/i);
  assert.doesNotMatch(snapshotsPanel, /pendingContainerPreflight|snapshot-container-restore-name/);
});

test("the shared primitives use one corner scale and the runtime palette", async () => {
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  // Four steps plus pills and circles, instead of the eleven arbitrary values
  // the panels had grown.
  assert.match(css, /--r-0: 4px;\s*--r-1: 8px;\s*--r-2: 12px;\s*--r-3: 18px;/);
  const literalRadii = css.match(/border-radius: \d+px;/g) ?? [];
  assert.deepEqual([...new Set(literalRadii)], ["border-radius: 999px;"]);

  // Every primitive color derives from the properties `appearance.js` sets at
  // runtime, so Apply sidebar theme, a chosen background and the light scheme
  // keep working. A pasted mockup value would ignore all three.
  for (const token of [
    "--settings-hair",
    "--settings-hair-strong",
    "--settings-wash",
    "--settings-inner",
    "--settings-accent-wash",
    "--settings-danger-edge"
  ]) {
    assert.match(css, new RegExp(`${token}: color-mix\\(in srgb, var\\(--settings-`));
  }
  // Solid near-black cards on the page, as designed, defined exactly once so
  // no later rule can quietly override the primitive again.
  assert.match(css, /\.settings-card\s*\{[\s\S]*?border-radius: var\(--r-3\);[\s\S]*?background: var\(--settings-surface\);/);
  assert.equal((css.match(/^\.settings-card \{/gm) ?? []).length, 1);
  assert.match(css, /\.settings-card--lifted\s*\{[\s\S]*?box-shadow:/);
  // A row stack paints no background of its own: behind its rounded clip one
  // bled through at the four corners as faint arcs. Hairlines are row borders.
  const stackRule = css.match(/\n\.setting-rows \{[^}]*\}/)?.[0] ?? "";
  assert.match(stackRule, /border-radius: var\(--r-2\);/);
  assert.doesNotMatch(stackRule, /background|gap:/);
  assert.match(css, /\.setting-rows > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{\s*border-block-start: 1px solid var\(--settings-hair\);/);

  // Destructive actions are outlined, not a solid red block, and the state
  // pill never carries meaning alone: forced colors keeps both legible.
  const dangerRule = css.match(/\.btn\.is-danger \{[^}]*\}/)[0];
  assert.match(dangerRule, /border-color: var\(--settings-danger-edge\);/);
  assert.match(dangerRule, /color: color-mix\(in srgb, var\(--settings-danger-text\) 64%, var\(--settings-text\)\);/);
  assert.doesNotMatch(css.match(/\.btn\.is-danger \{[^}]*\}/)?.[0] ?? "", /background: #/);
  assert.match(css, /\.btn\.is-primary\s*\{[\s\S]*?border-color: color-mix\(in srgb, var\(--settings-accent\)/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.settings-card,[\s\S]*?border: 1px solid CanvasText;/);
});

test("the workspaces panel is four cards in the agreed order", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const panel = html.slice(
    html.indexOf('id="workspaces-panel"'),
    html.indexOf('id="create-container-dialog"')
  );

  const order = ["container-support-card", "custom-icon-card", "workspace-rail-card", "workspace-package-card"];
  const positions = order.map((id) => panel.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position > 0), "every workspaces card exists");
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  for (const id of order) {
    assert.match(panel, new RegExp(`id="${id}" class="settings-card`));
  }

  // The rail card owns the editor and its add actions, and the add row sits in
  // the rail pane under the list rather than in a loose bar below the card.
  const railCard = panel.slice(panel.indexOf('id="workspace-rail-card"'), panel.indexOf('id="workspace-package-card"'));
  for (const id of ["workspace-editor", "rail-preview", "rail-inspector", "create-workspace", "add-divider", "add-space"]) {
    assert.match(railCard, new RegExp(`id="${id}"`));
  }
  assert.match(railCard, /<div class="rail-add-row" role="group" aria-label="Add to the rail">/);
  assert.ok(railCard.indexOf('class="rail-add-row"') < railCard.indexOf('id="rail-inspector"'));
  // Short visible labels; each accessible name still says the whole action.
  assert.match(railCard, /id="create-workspace"[^>]*aria-label="Create workspace">Workspace</);
  assert.match(railCard, /id="add-divider"[^>]*aria-label="Add divider">Divider</);
  assert.match(railCard, /id="add-space"[^>]*aria-label="Add space">Space</);

  // One primary action per card, and destructive removals are outlined.
  for (const id of ["enable-container-support", "add-custom-icons", "create-workspace", "export-workspace-package"]) {
    assert.match(panel, new RegExp(`id="${id}" class="btn is-primary"`));
  }
  const workspacesPanel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );
  assert.match(workspacesPanel, /remove\.className = "btn is-danger workspace-remove-button";/);
  assert.doesNotMatch(workspacesPanel, /"danger-button/);
});

test("settings sections avoid stacked divider lines", async () => {
  const [css, html, main] = await Promise.all([
    readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/main.js", import.meta.url), "utf8")
  ]);
  // Sections are bordered cards now, so none draws a divider of its own, and
  // rows inside a stack take their hairlines from the stack's gap.
  assert.doesNotMatch(css, /\.snapshot-section\s*\{[^}]*border/);
  assert.doesNotMatch(css, /\.setting-row\s*\{[^}]*border-block-end:/);
  assert.doesNotMatch(css, /\.choice-row\s*\{[^}]*border-block-end:/);

  // A card never shares its element with an older group wrapper: those rules
  // come later in the stylesheet and would strip the card's padding and border.
  assert.doesNotMatch(html, /class="[^"]*\bsettings-group\b[^"]*\bsettings-card\b/);
  assert.doesNotMatch(html, /class="[^"]*\bsettings-card\b[^"]*\b(settings-group|appearance-modes)\b/);

  // `.snapshot-section` survives as a hook: the settings data gate keeps both
  // Snapshots cards inert until the saved settings have been read.
  assert.match(main, /#snapshots-panel > \.snapshot-section/);
  const snapshotsPanel = html.slice(html.indexOf('<section id="snapshots-panel"'), html.indexOf('<section id="snapshot-viewer-panel"'));
  assert.equal((snapshotsPanel.match(/<section class="snapshot-section settings-card/g) ?? []).length, 2);
});

test("snapshot viewer shows the latest saved automatic backup beside restore status", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");
  const latest = latestAutomaticSnapshotCreatedAt([
    { kind: "manual", createdAt: "2026-09-05T12:00:00.000Z" },
    { kind: "automatic", createdAt: "2026-09-05T13:00:00.000Z" },
    { kind: "automatic", createdAt: "2026-09-05T15:30:45.000Z" }
  ]);

  assert.equal(latest, "2026-09-05T15:30:45.000Z");
  assert.equal(latestAutomaticSnapshotCreatedAt([]), null);
  assert.match(
    html,
    /class="snapshot-viewer-summary"[\s\S]*?id="snapshot-report-heading"[\s\S]*?id="snapshot-automatic-status-heading"/
  );
  assert.match(html, />Last saved<\/dt>[\s\S]*?id="snapshot-viewer-last-automatic-save"/);
  assert.match(html, />Next snapshot<\/dt>[\s\S]*?id="snapshot-viewer-next-automatic-save"/);
  assert.match(
    css,
    /\.snapshot-viewer-summary\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(15rem, 0\.55fr\)/
  );
  assert.match(css, /\.snapshot-automatic-status dd\s*\{[\s\S]*?font-variant-numeric: tabular-nums/);
});

test("internal creates avoid Downloads while explicit exports retain their button reference", async () => {
  const panel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  assert.match(panel, /createButton\.addEventListener[\s\S]*?const trigger = event\.currentTarget;[\s\S]*?await run\(\s*trigger,[\s\S]*?snapshotClient\(\)\.create\(\)/);
  assert.match(panel, /exportButton\.addEventListener\("click", async \(event\) => \{\s*const trigger = event\.currentTarget;[\s\S]*?await ensureDownloadsPermission\(\)[\s\S]*?await run\(\s*trigger,/);
  assert.match(
    panel,
    /const snapshotId = currentView\.summary\.id;[\s\S]*?await ensureDownloadsPermission\(\)[\s\S]*?snapshotClient\(\)\.export\(snapshotId\)/
  );
  assert.doesNotMatch(panel, /snapshotClient\(\)\.export\(currentView\.summary\.id\)/);
  assert.match(panel, /#snapshots-save-settings[\s\S]*?client\.saveSettings\(\)/);
  assert.match(panel, /button\("Export", \(event\) => \{\s*const trigger = event\.currentTarget;[\s\S]*?await ensureDownloadsPermission\(\)[\s\S]*?await run\(\s*trigger,[\s\S]*?client\.exportSettings\(record\.id\)/);
});

test("snapshot viewer uses an in-page delete dialog and clear-history message", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const panel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  const client = await readFile(
    new URL("../../src/settings/settings-client.js", import.meta.url),
    "utf8"
  );

  assert.match(html, /<dialog id="snapshot-delete-dialog"/);
  assert.match(html, /id="snapshot-skip-delete-warning"/);
  assert.match(html, /id="snapshot-skip-delete-warning" type="checkbox" \/>\s*<span>Don&rsquo;t warn me again<\/span>/);
  assert.doesNotMatch(html, /Do not show again/);
  // The warning lives in its dialog now; Settings has no checkbox for it.
  assert.doesNotMatch(html, /id="warn-before-snapshot-deletion"|>Warn before deleting snapshots and tabs</);
  assert.match(html, /id="snapshots-clear-viewer"[^>]*>Clear viewer<\/button>/);
  // One label in both scopes: the panel heading already says which history it is.
  assert.doesNotMatch(panel, /clearViewerButton\.textContent|exportButton\.textContent/);
  assert.doesNotMatch(panel, /globalThis\.confirm|\bconfirm\s*\(/);
  assert.match(panel, /requestDeletion\(\{\s*kind: "clear"/);
  assert.match(panel, /snapshotClient\(\)\.clearViewer\(\)/);
  assert.match(client, /SNAPSHOT_MESSAGE_TYPES\.CLEAR_VIEWER/);
  assert.match(panel, /Exported files were kept/);
  assert.match(panel, /requestRestore\(scope, options, trigger\)/);
  assert.match(panel, /including tabs created after this snapshot/);
  assert.match(panel, /keeps Firefox open/);
  assert.match(panel, /confirmActionButton\.textContent = "Overwrite tabs"/);
});

test("removing workspaces asks nothing and offers one Undo instead", async () => {
  const settingsHtml = await readFile(
    new URL("../../src/settings/index.html", import.meta.url),
    "utf8"
  );
  const sidebarHtml = await readFile(
    new URL("../../src/sidebar/index.html", import.meta.url),
    "utf8"
  );
  const workspacesPanel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );
  const snapshotsPanel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  const sidebarMain = await readFile(
    new URL("../../src/sidebar/main.js", import.meta.url),
    "utf8"
  );
  // No warning, no preference and no dialog anywhere: removal is reversible.
  for (const source of [settingsHtml, sidebarHtml, workspacesPanel, sidebarMain]) {
    assert.doesNotMatch(source, /warnBeforeWorkspaceRemoval|skip-workspace-removal-warning/);
  }
  assert.doesNotMatch(sidebarHtml, /id="remove-workspace-dialog"/);
  assert.doesNotMatch(settingsHtml, /id="settings-remove-workspace-dialog"/);
  // The selection goes in one call, so its Undo is one entry, and Settings
  // offers that entry until the window's slot moves on.
  assert.match(workspacesPanel, /client\.removeWorkspaces\(workspaceIds, decorations\)/);
  assert.match(workspacesPanel, /client\.undoRemoval\(undoId\)/);
  assert.match(workspacesPanel, /function applyUndoSummary\(summary\)/);
  assert.match(settingsHtml, /id="workspace-removal-undo-button"/);
  // Every warning checkbox is gone from Settings; the dialogs keep their own
  // box, and one Overview control turns silenced warnings back on.
  assert.doesNotMatch(settingsHtml, /id="warn-before-snapshot-deletion"|id="warn-before-closing-multiple-tabs"/);
  assert.match(settingsHtml, /id="snapshot-skip-delete-warning"/);
  assert.match(settingsHtml, /id="skip-multiple-tab-close-warning"|id="restore-warnings"/);
  assert.match(snapshotsPanel, /warnBeforeSnapshotDeletion === false[\s\S]*?performDeletion/);
  assert.match(snapshotsPanel, /warnBeforeSnapshotDeletion === false[\s\S]*?performRestore/);
  assert.match(snapshotsPanel, /snapshots: \{ warnBeforeSnapshotDeletion: false \}/);
});

test("every warning that can be silenced is one the Overview can turn back on", async () => {
  const [sidebarHtml, settingsHtml, sidebarMain, snapshotsPanel, warningsPanel] = await Promise.all([
    readFile(new URL("../../src/sidebar/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/snapshots-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/warnings-panel.js", import.meta.url), "utf8")
  ]);
  const { DESTRUCTIVE_WARNINGS } = await import("../../src/settings/warnings-panel.js");

  // Each dialog's own box, the setting it writes, and the code that skips the
  // dialog once that setting is false.
  const silencers = [
    { html: sidebarHtml, box: "skip-multiple-tab-close-warning", source: sidebarMain, section: "sidebar", key: "warnBeforeClosingMultipleTabs" },
    { html: sidebarHtml, box: "skip-many-tab-load-warning", source: sidebarMain, section: "sidebar", key: "warnBeforeLoadingManyTabs" },
    { html: settingsHtml, box: "snapshot-skip-delete-warning", source: snapshotsPanel, section: "snapshots", key: "warnBeforeSnapshotDeletion" }
  ];
  for (const { html, box, source, section, key } of silencers) {
    assert.match(html, new RegExp(`id="${box}" type="checkbox" />\\s*<span>Don(?:&rsquo;|’)t warn me again</span>`), box);
    assert.match(source, new RegExp(`${section}: \\{ ${key}: false \\}`), key);
    assert.match(source, new RegExp(`${section}\\.${key} === false`), key);
    assert.ok(
      DESTRUCTIVE_WARNINGS.some((warning) => warning.section === section && warning.key === key),
      `${key} can be turned back on`
    );
  }
  // No other dialog can silence a warning the Overview does not know about.
  const boxes = [sidebarHtml, settingsHtml].flatMap((html) =>
    [...html.matchAll(/<input id="([a-z-]+)" type="checkbox" \/>\s*<span>Don(?:&rsquo;|’)t warn me again<\/span>/g)].map(([, id]) => id)
  );
  assert.deepEqual(boxes.sort(), silencers.map(({ box }) => box).sort());
  assert.equal(DESTRUCTIVE_WARNINGS.length, silencers.length);

  // The restore control appears only once something is silenced.
  assert.match(settingsHtml, /<div class="card-foot" hidden>\s*<button id="restore-warnings"/);
  assert.match(warningsPanel, /restoreFoot\.hidden = silenced\.length === 0;/);
  assert.match(settingsHtml, /Silenced warnings can be turned back on here\./);
});

test("the settings backup list shows about five rows and then scrolls", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8")
  ]);
  // The list is capped and scrolls, so the restore report below it stays
  // reachable however many automatic backups have piled up.
  assert.match(
    css,
    /\.settings-backup-list \{[^}]*max-block-size: 23rem;[^}]*overflow-y: auto;[^}]*scrollbar-gutter: stable;/
  );
  assert.match(css, /\.settings-backup-list \{[^}]*align-content: start;/);
  assert.match(html, /id="settings-backup-list" class="settings-backup-list" aria-live="polite"/);
  // The report keeps its own place under the list rather than inside it.
  assert.ok(
    html.indexOf('id="settings-backup-list"') < html.indexOf('id="settings-backup-restore-report"')
  );
});

test("snapshot history utilities are boxed above a divided scrolling list", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  for (const id of ["snapshots-refresh", "snapshots-clear-viewer"]) {
    assert.match(html, new RegExp(`id="${id}"(?![^>]*snapshot-quiet-button)`));
  }
  assert.match(
    html,
    /id="snapshots-refresh"[\s\S]*?class="snapshot-list-divider"[\s\S]*?id="snapshots-list"[\s\S]*?class="snapshot-list-foot"[\s\S]*?id="snapshots-clear-viewer"/
  );
  assert.match(css, /\.snapshot-list\s*\{[\s\S]*?flex: 1 1 0;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(css, /\.snapshot-list-divider\s*\{[\s\S]*?flex: 0 0 1px;/);
});

test("snapshot viewer keeps window and bulk restore actions without row-level UI bloat", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const panel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  assert.match(panel, /import \{ presentWorkspaceIcon \} from "\.\.\/ui\/workspace-icon-presentation\.js"/);
  assert.match(panel, /workspaceIcon\.className = "snapshot-workspace-icon"/);
  assert.match(panel, /presentWorkspaceIcon\(workspace\?\.icon, customIconUrls\)/);
  assert.match(panel, /workspaceIcon\.style\.setProperty\("--icon-color", workspace\?\.color/);
  assert.match(css, /\.snapshot-workspace-icon\s*\{[\s\S]*?mask: var\(--icon-mask\)/);

  assert.doesNotMatch(panel, /button\("Open",[\s\S]*?snapshot-row-action/);
  assert.doesNotMatch(panel, /button\("Open tab"/);
  assert.match(panel, /button\("Open window",[\s\S]*?"snapshot-restore-button"\)/);
  assert.doesNotMatch(panel, /button\("Open workspace"/);
  assert.doesNotMatch(css, /\.snapshot-row-action/);
  assert.match(html, /id="snapshots-open-selected" class="btn snapshot-restore-button"/);
  assert.match(html, /id="snapshots-open-all" class="btn snapshot-restore-button"[^>]*>Open all windows<\/button>/);
  // One row under the tree: openers, then export, then the destructive delete.
  assert.match(
    html,
    /<footer class="snapshot-viewer-foot">[\s\S]*?id="snapshots-open-all"[\s\S]*?id="snapshots-open-selected"[\s\S]*?id="snapshots-export"[\s\S]*?id="snapshots-delete"[\s\S]*?<\/footer>/
  );
  assert.match(css, /\.snapshot-restore-button\s*\{[\s\S]*?background: #167744;[\s\S]*?color: white;/);
  // `.btn.is-primary` outranks a single class, so a restore button carrying it
  // would lose its green; the restore identity is a kept product decision.
  assert.doesNotMatch(html, /class="[^"]*is-primary[^"]*snapshot-restore-button/);
  // List entries are selectable rows, not action buttons.
  assert.match(panel, /function listEntry\(onClick\) \{[\s\S]*?element\.className = "snapshot-list-item";/);
  assert.doesNotMatch(panel, /button\("",[\s\S]{0,120}"snapshot-list-item"\)/);
});

test("snapshot badges, exports, and grouped tabs use compact semantic color cues", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const panel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  assert.match(html, /class="settings-backup-list"/);
  assert.match(html, /class="btn snapshot-export-button card-foot-push"/);
  assert.match(css, /\.snapshot-kind::before,\s*\.snapshot-export-button::before\s*\{[^}]*snapshot\.svg/);
  assert.match(panel, /exportButton\.dataset\.snapshotProvenance = provenance\.id/);
  assert.match(css, /\.snapshot-kind--manual,\s*\.snapshot-export-button\[data-snapshot-provenance="manual"\]\s*\{[^}]*#ffffff/);
  assert.match(css, /\.snapshot-kind--automatic,\s*\.snapshot-export-button\[data-snapshot-provenance="automatic"\]\s*\{[^}]*#ffd400/);
  assert.deepEqual(snapshotProvenance({ kind: "manual", reason: "firefox-sync-import" }), {
    id: "imported",
    label: "Imported"
  });
  assert.doesNotMatch(css, /snapshot-kind--sync|data-snapshot-provenance="sync"|data-provenance="sync"/);
  assert.deepEqual(snapshotProvenance({
    documentType: "sidebars.private-snapshot-record",
    kind: "manual"
  }), { id: "private", label: "Private" });
  assert.match(css, /\.snapshot-kind--private\s*\{[\s\S]*?#9059ff/);
  assert.match(css, /\.snapshot-kind--private::before,\s*\.snapshot-export-button\[data-snapshot-provenance="private"\]::before\s*\{[^}]*private-window\.svg/);
  assert.match(css, /#snapshot-viewer-title\[data-provenance="private"\]::before[\s\S]*?private-window\.svg/);
  assert.match(css, /\.settings-backup-row\s*\{/);
  // The group palette has one owner shared with the sidebar, so Settings maps
  // the name through it instead of keeping a second copy that can drift.
  assert.match(panel, /groupColorToken\(group\.color\)/);
  assert.match(panel, /from "\.\.\/ui\/group-colors\.js"/);
  assert.match(panel, /details\.style\.setProperty\("--group-color"/);
  assert.match(panel, /\$\{report\.applied\.closedTabs\} previous tabs closed/);
  assert.match(
    css,
    /\.snapshot-tree-group > \.snapshot-tab-row \{[^}]*border-inline-start: 2px solid var\(--group-color/
  );
});

test("snapshot viewer rows show the tab, not its address, and only real containers", async () => {
  const panel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  // The address stays reachable on hover instead of a second line per tab.
  assert.match(panel, /title\.title = tab\.url;/);
  assert.doesNotMatch(panel, /\.textContent = tab\.url/);
  // No container shows nothing; a missing one says so in words, not colour alone.
  assert.match(panel, /if \(!assignment \|\| assignment\.kind === "none"\) return null;/);
  assert.doesNotMatch(panel, /"No Container"/);
  assert.match(panel, /chip\.textContent = `\$\{name\} · not on this profile`;/);
  assert.match(panel, /pinned\.textContent = "Pinned";/);
  // Workspace headers are quiet rows, not accent-filled bars.
  assert.doesNotMatch(css, /\.snapshot-tree-workspace > summary \{[^}]*background/);
  assert.doesNotMatch(css, /,\s*\.snapshot-tree-workspace > summary \{/);
});

test("snapshot number fields strip non-digits and clamp at their boundaries", () => {
  assert.equal(sanitizeBoundedIntegerText("12words34", { min: 1, max: 999 }), "999");
  assert.equal(sanitizeBoundedIntegerText("29", { min: 30, max: 999 }), "29");
  assert.equal(
    sanitizeBoundedIntegerText("29", { min: 30, max: 999 }, { commit: true }),
    "30"
  );
  assert.equal(sanitizeBoundedIntegerText("1001", { min: 1, max: 1000 }), "1000");
  assert.equal(sanitizeBoundedIntegerText("", { min: 1, max: 999 }, { commit: true }), "1");
});

test("restore all defaults always requires its dedicated confirmation dialog", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const settingsMain = await readFile(
    new URL("../../src/settings/main.js", import.meta.url),
    "utf8"
  );
  const dialogStart = html.indexOf('id="reset-all-settings-dialog"');
  const dialogEnd = html.indexOf("</dialog>", dialogStart);
  const resetDialog = html.slice(dialogStart, dialogEnd);

  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart);
  assert.match(resetDialog, /id="reset-all-settings-confirm"[^>]*required/);
  assert.match(resetDialog, /id="reset-all-settings-submit"[^>]*disabled/);
  assert.match(resetDialog, /display, action, snapshot, navigation, and workspace defaults/i);
  assert.match(resetDialog, /Privacy settings, private recovery, custom icons, native Firefox containers/i);
  assert.match(resetDialog, /existing tab container identities, saved snapshots, exported files, and open tabs are kept/i);
  assert.match(resetDialog, /Container assignments on the original workspaces are kept/i);
  assert.doesNotMatch(resetDialog, /don(?:'|&rsquo;|’)?t warn|skip.*warning/i);
  assert.match(
    settingsMain,
    /resetAllButton\.addEventListener\("click", \(\) => \{[\s\S]*?resetAllDialog\.showModal\(\);[\s\S]*?\}\);/
  );
  assert.match(
    settingsMain,
    /resetAllForm\.addEventListener\("submit", async \(event\) => \{[\s\S]*?if \(!resetAllConfirm\.checked\) \{[\s\S]*?return;[\s\S]*?settingsClient\.reset\(\)/
  );
});

test("automatic save cleanup shows the maximum, a live summary, and asks first", async () => {
  const [html, snapshots, settingsMain] = await Promise.all([
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/snapshots-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/main.js", import.meta.url), "utf8")
  ]);
  const count = html.indexOf('id="snapshots-retention-count"');
  const summary = html.indexOf('id="snapshots-cleanup-summary"');
  assert.ok(count > 0 && count < summary);
  assert.doesNotMatch(html, /Each library is its own choice\. Turning any one on starts the shared schedule\./);
  assert.match(html, /id="snapshots-automatic-description">Saves workspaces and tabs\.<\/span>/);
  assert.match(html, /<strong>Automatic Settings Backups<\/strong>\s*<span>Saves your settings\.<\/span>/);
  assert.doesNotMatch(html, /One schedule serves every enabled library\. Manual saves, safety snapshots and exported files are never removed\./);
  assert.match(html, />Automatic Saves</);
  assert.match(html, /How many saves you can have before the oldest one is deleted\./);
  assert.match(html, /Lowering the limit previews what would be removed and asks before writing\./);
  // Schema 31 removed the age limit; the maximum is the only rule left, so
  // nothing in the panel offers to remove a save for being old.
  assert.doesNotMatch(html, /Delete old automatic saves|Older than|Automatic saves older than this are removed/);
  assert.match(html, /id="snapshots-cleanup-summary"[^>]*role="status"/);
  assert.doesNotMatch(html, /snapshots-delete-automatic-enabled|Delete old automatic backups|Maximum automatic saves per library/);

  const dialogStart = html.indexOf('id="snapshot-cleanup-dialog"');
  const dialog = html.slice(dialogStart, html.indexOf("</dialog>", dialogStart));
  assert.match(dialog, />Remove automatic saves\?</);
  assert.match(dialog, /These settings remove automatic saves you already have:/);
  assert.match(dialog, /id="snapshot-cleanup-counts"/);
  assert.match(dialog, /id="snapshot-cleanup-private-note" hidden>Private Snapshots may also be removed\./);
  assert.match(dialog, /Manual saves, safety snapshots, and exported files are kept\./);
  assert.match(dialog, /id="snapshot-cleanup-cancel" type="button">Cancel</);
  assert.match(dialog, /id="snapshot-cleanup-remove" class="btn is-danger" type="submit">Remove</);

  assert.match(snapshots, /updateCleanupSettings\(\{ retentionCount: value \}\)/);
  assert.doesNotMatch(snapshots, /updateCleanupSettings\(\{ delete/);
  assert.match(snapshots, /if \(!confirmed\) \{\s*apply\(currentSettings\);/);
  assert.match(snapshots, /confirmBackupCleanup\(async \(\) =>\s*\(await client\.getSettings\(record\.id\)\)\.payload\.settings\.snapshots/);
  assert.match(snapshots, /chosen\.includes\("snapshots"\) &&\s*!\(await confirmBackupCleanup/);
  assert.match(snapshots, /cleanupSummary\.textContent = cleanupSummaryText\(settings\);/);

  const resetStart = html.indexOf('id="reset-all-settings-dialog"');
  const reset = html.slice(resetStart, html.indexOf("</dialog>", resetStart));
  assert.match(reset, /id="reset-all-settings-cleanup"[^>]*hidden/);
  assert.match(reset, /id="reset-all-settings-cleanup-counts"/);
  assert.match(settingsMain, /resetAllDialog\.showModal\(\);\s*void previewResetCleanup\(\);/);
  assert.match(settingsMain, /This also removes \$\{impact\.total\} automatic save\$\{[^}]+\} beyond the default maximum of \$\{defaults\.retentionCount\}\./);
});

test("snapshot inputs and buttons share one aligned control column", async () => {
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  assert.match(
    css,
    /\.snapshot-inline-setting,\s*\.snapshot-test-setting \{\s*grid-template-columns: minmax\(0, 1fr\) 12rem;/
  );
  assert.match(
    css,
    /\.snapshot-inline-setting > \.snapshot-input-pair,[\s\S]*?\.snapshot-test-setting > \.btn \{\s*justify-self: start;/
  );
  assert.match(css, /\.snapshot-input-pair \{[\s\S]*?justify-content: flex-start;/);
  assert.match(
    css,
    /@media \(max-width: 46rem\)[\s\S]*?\.snapshot-inline-setting,\s*\.snapshot-test-setting \{\s*grid-template-columns: 1fr;/
  );
});

test("a multi-selection sets one default container through the container path", async () => {
  const [panel, client] = await Promise.all([
    readFile(new URL("../../src/settings/workspaces-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/settings-client.js", import.meta.url), "utf8")
  ]);
  const field = panel.slice(
    panel.indexOf("function sharedContainerField("),
    panel.indexOf("function deleteSelection(")
  );
  assert.ok(field.length > 0);
  // Only offered where containers can be used, and only for 2+ workspaces.
  assert.match(panel, /if \(containers\.capability === "available"\) \{\s*body\.append\(sharedContainerField\(workspaces, workspaceIds\)\);/);
  // None is a real shared value, so "mixed" is tracked separately and never saved.
  assert.match(field, /const mixed = refs\.size > 1;/);
  assert.match(field, /mixedOption\.value = "__mixed__";[\s\S]*?mixedOption\.disabled = true;/);
  assert.match(field, /Mixed — the selected workspaces use different containers\./);
  assert.match(field, /containerClient\.setWorkspaceDefaults\(workspaceIds, refId\)/);
  assert.match(field, /Existing tabs were not changed\./);
  assert.doesNotMatch(field, /client\.updateMany/);
  assert.match(client, /type: CONTAINER_MESSAGE_TYPES\.SET_WORKSPACE_DEFAULTS,\s*workspaceIds: \[\.\.\.workspaceIds\],\s*refId/);
});

test("Storage shows the complete website-icon cache without a computer-space allowance", async () => {
  const [html, css, panel, client, handler, main, manifestText] = await Promise.all([
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/storage-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/settings-client.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/background/favicon-message-handler.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../manifest.json", import.meta.url), "utf8")
  ]);
  const storage = html.slice(
    html.indexOf('<section id="storage-panel"'),
    html.indexOf('<section id="firefox-styling-panel"')
  );

  assert.match(storage, /<h1 id="storage-heading">Storage<\/h1>\s*<p>See and manage website icons saved by Terminus\.<\/p>/);
  assert.match(storage, /id="storage-favicon-count"/);
  assert.match(storage, /id="storage-favicon-bytes"/);
  assert.match(storage, /id="storage-icon-gallery" class="storage-icon-gallery" role="list"/);
  assert.match(storage, /id="storage-icon-gallery-empty"/);
  assert.match(storage, /id="storage-remove-unused"[^>]*>Remove unused</);
  assert.match(storage, /id="storage-clear-favicons"[^>]*>Clear website icons</);
  assert.doesNotMatch(storage, /allowance|quota|storage-meter|snapshot-bytes|custom-icon-bytes|Other local data/i);

  assert.match(css, /\.storage-icon-gallery\s*\{[\s\S]*?grid-template-columns: repeat\(auto-fill, minmax\(7\.5rem, 1fr\)\)/);
  assert.match(css, /\.storage-icon-tile img\s*\{[\s\S]*?inline-size: 32px;[\s\S]*?object-fit: contain/);
  assert.doesNotMatch(css, /\.storage-meter|\.meter-legend/);
  assert.doesNotMatch(html, /sync-file-field|sync-field-copy|sync-status|sync-inline-status/);

  assert.match(client, /async list\(cursor = null\)[\s\S]*?FAVICON_MESSAGE_TYPES\.LIST/);
  assert.match(panel, /do \{[\s\S]*?client\.list\(cursor\)[\s\S]*?while \(cursor !== null\)/);
  assert.match(panel, /new Blob\(\[icon\.bytes\], \{ type: icon\.mime \}\)/);
  assert.match(panel, /releaseObjectUrls\(\)[\s\S]*?revokeObjectURL\(url\)/);
  assert.match(panel, /privateContext[\s\S]*?applyPrivateState\(\)/);
  assert.match(main, /privateContext: browser\.extension\?\.inIncognitoContext === true/);
  assert.match(handler, /sender\?\.tab\?\.incognito === true[\s\S]*?FaviconError\(FAVICON_ERROR_CODES\.NOT_RELEVANT\)/);

  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["none"] });
  assert.equal(JSON.stringify(manifest).includes("technicalAndInteraction"), false);
  assert.equal(JSON.stringify(manifest).includes("browsingActivity"), false);
});

test("the Optional Firefox Styling tab sits before Overview and stays short", async () => {
  const [html, css, main, panelJs] = await Promise.all([
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/firefox-styling-panel.js", import.meta.url), "utf8")
  ]);
  const { COPY_VALUES, DOWNLOAD_FILENAME } = await import("../../src/settings/firefox-styling-panel.js");
  const plain = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/\s+/g, " ").trim();

  // Between Storage and Overview, in the rail and in the narrow-window list.
  const navButtons = [...html.matchAll(/class="navigation-item" type="button" data-panel="([a-z-]+)"/g)]
    .map(([, panel]) => panel);
  assert.deepEqual(navButtons.slice(-3), ["storage", "firefox-styling", "overview"]);
  const mobileNavigation = html.slice(
    html.indexOf('<select id="settings-section">'),
    html.indexOf("</select>", html.indexOf('<select id="settings-section">'))
  );
  const options = [...mobileNavigation.matchAll(/<option (?:id="[^"]+" )?value="([a-z-]+)">/g)]
    .map(([, value]) => value);
  assert.deepEqual(options.slice(-3), ["storage", "firefox-styling", "overview"]);
  assert.match(html, /<option value="firefox-styling">Optional Firefox Styling<\/option>/);
  assert.match(html, /data-panel="firefox-styling" aria-controls="firefox-styling-panel">\s*<span class="navigation-icon navigation-icon--firefox-styling"[^>]*><\/span>\s*<span>Optional Firefox Styling<\/span>/);
  assert.match(css, /\.navigation-icon--firefox-styling\s*\{\s*--navigation-mask: url\("\.\.\/assets\/icons\/workspace\/wrench\.svg"\);/);

  const start = html.indexOf('<section id="firefox-styling-panel"');
  const panel = html.slice(start, html.indexOf('<section id="overview-panel"'));
  assert.ok(start > 0);
  assert.match(panel, /data-panel-content="firefox-styling"[^>]*hidden>/);
  assert.equal((panel.match(/<h1 /g) ?? []).length, 1);
  assert.match(panel, /<p class="eyebrow">Terminus<\/p>\s*<h1 id="firefox-styling-heading">Optional Firefox Styling<\/h1>\s*<p>Hide the header bar Firefox draws above the sidebar\. Optional: Terminus works the same without it\.<\/p>/);
  const sections = [...panel.matchAll(/<h2 id="[^"]+">(?:<span[^>]*><\/span>)?([^<]+)<\/h2>/g)].map(([, title]) => title);
  assert.deepEqual(sections, ["Sidebar header", "Install it", "How to undo", "Header still there?"]);

  // Short copy, as everywhere else in Settings: a card says what it is in a
  // line or two, and every step is a name over one line.
  for (const [, sub] of panel.matchAll(/<div class="settings-card-heading">[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/g)) {
    assert.ok(plain(sub).length <= 170, `card line too long: ${plain(sub)}`);
  }
  for (const [, line] of panel.matchAll(/<\/strong><span>([\s\S]*?)<\/span><\/span>/g)) {
    assert.ok(plain(line).length <= 110, `step line too long: ${plain(line)}`);
  }

  // What disappears, where it applies, and that downloading alone does nothing,
  // all stated before the download button.
  const sheet = panel.slice(panel.indexOf('id="firefox-styling-sheet-heading"'), panel.indexOf('id="firefox-styling-install-heading"'));
  const sheetText = plain(sheet);
  assert.match(sheetText, /This small file hides Firefox's header above every sidebar, including other extensions\. Firefox updates can break it\./);
  assert.ok(sheet.indexOf("Firefox update") < sheet.indexOf('id="firefox-styling-download"'));
  assert.match(sheet, /<button id="firefox-styling-download" class="btn is-primary" type="button">Download CSS<\/button>\s*<span class="settings-note">Saves <code>userChrome\.css<\/code>\. Downloading changes nothing by itself\.<\/span>/);
  assert.equal(DOWNLOAD_FILENAME, "userChrome.css");
  assert.match(sheet, /id="firefox-styling-status" class="settings-status" role="status" aria-live="polite" hidden/);

  // The drawing shows the header only before, keeps Firefox's icon strip in
  // both, and is decoration: its caption says the same in words.
  const frames = [...sheet.matchAll(/<div class="styling-frame" aria-hidden="true">([\s\S]*?)<span class="styling-frame-label">([^<]+)<\/span>/g)]
    .map(([, drawing, label]) => ({ label, header: drawing.includes("styling-header"), launcher: drawing.includes("styling-launcher") }));
  assert.deepEqual(frames, [
    { label: "Now", header: true, launcher: true },
    { label: "With the style sheet", header: false, launcher: true }
  ]);
  assert.match(sheet, /<figcaption class="visually-hidden">[^<]*header bar[^<]*icon strip beside it stays[^<]*<\/figcaption>/);

  // Five steps as setting rows, three of them with the text to paste.
  const install = panel.slice(panel.indexOf('id="firefox-styling-install-heading"'), panel.indexOf('id="firefox-styling-undo-heading"'));
  assert.match(install, /<ol class="setting-rows styling-steps">/);
  const steps = [...install.matchAll(/<li class="setting-row">([\s\S]*?)<\/li>/g)].map(([, row]) => ({
    number: row.match(/<span class="step-tag" aria-hidden="true">(\d)<\/span>/)?.[1],
    title: row.match(/<\/span>([^<]+)<\/strong>/)?.[1],
    copy: row.match(/data-copy="([^"]+)"/)?.[1] ?? null
  }));
  assert.deepEqual(steps, [
    { number: "1", title: "Open your profile folder", copy: COPY_VALUES.support },
    { number: "2", title: "Add the file", copy: null },
    { number: "3", title: "Open advanced settings", copy: COPY_VALUES.config },
    { number: "4", title: "Allow custom styles", copy: COPY_VALUES.preference },
    { number: "5", title: "Restart Firefox", copy: null }
  ]);
  assert.match(plain(install), /Create a folder called chrome and move the userChrome\.css file into the chrome folder\./);
  assert.match(plain(install), /set it to true/);
  assert.equal(new Set([...panel.matchAll(/data-copy="[^"]+" aria-label="([^"]+)">Copy<\/button>/g)].map(([, label]) => label)).size, 3);
  assert.match(install, /id="firefox-styling-copy-status" class="settings-status" role="status" aria-live="polite" hidden/);
  assert.match(css, /\.overview-tag,\s*\.step-tag \{/);

  // No second file to wire up, and internal pages are pasted, never linked.
  assert.doesNotMatch(panel, /@import|extension-styling|@charset/);
  assert.doesNotMatch(panel, /href="about:|<a /);

  const undo = plain(panel.slice(panel.indexOf('id="firefox-styling-undo-heading"'), panel.indexOf('id="firefox-styling-help-heading"')));
  assert.match(undo, /If userChrome\.css contains only Terminus, delete it; otherwise remove only the Terminus block\./);
  assert.match(undo, /The preference can stay on\./);
  assert.doesNotMatch(undo, /false/);

  const checks = [...panel.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, title]) => title);
  assert.deepEqual(checks, ["Wrong profile", "Wrong name", "Preference off", "Not restarted", "After an update"]);
  assert.match(plain(panel), /not userChrome\(1\)\.css or userChrome\.css\.txt/);
  assert.match(plain(panel), /Terminus updates never replace your copy\./);
  assert.match(plain(panel), /replace only the Terminus rule/);

  // Optional in every sense: no stored setting, no status, no toggle.
  assert.doesNotMatch(panel, /state-pill|type="checkbox"|role="switch"|<input/);
  assert.doesNotMatch(panelJs, /settings-client|sendMessage|storage\.(local|sync|session)|downloads\.|\.update\(/);
  assert.match(panelJs, /browser\.runtime\.getURL\(path\)/);
  assert.match(main, /const firefoxStylingPanel = createFirefoxStylingPanel\(\);/);
  assert.match(main, /firefoxStylingPanel\.clearTransientMessages\(\);/);
});

test("the Overview tab sits last with the Summary icon and follows the approved structure", async () => {
  const [html, css, navigation, snapshots] = await Promise.all([
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/panel-navigation.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/snapshots-panel.js", import.meta.url), "utf8")
  ]);
  const navButtons = [...html.matchAll(/class="navigation-item" type="button" data-panel="([a-z-]+)"/g)]
    .map(([, panel]) => panel);
  assert.equal(navButtons.at(-1), "overview");
  assert.match(html, /data-panel="overview" aria-controls="overview-panel">\s*<span class="navigation-icon navigation-icon--overview"[^>]*><\/span>\s*<span>Overview<\/span>/);
  const mobileNavigation = html.slice(
    html.indexOf('<select id="settings-section">'),
    html.indexOf("</select>", html.indexOf('<select id="settings-section">'))
  );
  const options = [...mobileNavigation.matchAll(/<option (?:id="[^"]+" )?value="([a-z-]+)">/g)]
    .map(([, value]) => value);
  assert.equal(options.at(-1), "overview");
  assert.match(css, /\.navigation-icon--overview\s*\{\s*--navigation-mask: url\("\.\.\/assets\/icons\/workspace\/summary\.svg"\);/);
  assert.match(navigation, /document\.querySelectorAll\("\[data-open-panel\]"\)[\s\S]*?selectPanel\(opener\.dataset\.openPanel, \{ focus: true, save: true \}\)/);

  const start = html.indexOf('<section id="overview-panel"');
  const overview = html.slice(start, html.indexOf('<p id="settings-status"'));
  assert.match(overview, /data-panel-content="overview"[^>]*hidden>/);
  assert.equal((overview.match(/<h1 /g) ?? []).length, 1);
  assert.match(overview, /<p class="eyebrow">Terminus<\/p>\s*<h1 id="overview-heading">Overview<\/h1>/);
  assert.match(overview, /Terminus keeps your tabs in workspaces, one for each part of your day\. Here is what it does and where each setting lives\./);
  const sections = [...overview.matchAll(/<h2 id="[^"]+">([^<]+)<\/h2>/g)].map(([, title]) => title);
  assert.deepEqual(sections, [
    "The sidebar, piece by piece",
    "What the marks mean",
    "Snapshot badges",
    "Quick moves",
    "What Terminus does",
    "Warnings before destructive actions"
  ]);
  const cards = [...overview.matchAll(/<article class="overview-card[^"]*" aria-labelledby="([^"]+)">\s*<h3 id="\1">(?:<span[^>]*><\/span>)?([^<]+)<\/h3>([\s\S]*?)<\/article>/g)]
    .map(([, , title, body]) => ({ title, button: body.match(/data-open-panel="([a-z-]+)"/)?.[1] ?? null }));
  assert.deepEqual(cards, [
    { title: "Workspaces", button: "workspaces" },
    { title: "Snapshots", button: "snapshots" },
    { title: "Appearance", button: "appearance" }
  ]);
  const panelIds = new Set([...html.matchAll(/data-panel-content="([a-z-]+)"/g)].map(([, id]) => id));
  for (const { title, button } of cards) {
    assert.ok(panelIds.has(button), `${button} opens an existing Settings tab`);
    // The arrow is decoration; the accessible name is only "Open <tab>".
    assert.match(overview, new RegExp(`data-open-panel="${button}">Open ${title} <span aria-hidden="true">→</span></button>`));
  }

  // The drawing: a rail, one open group, and the current tab, each lettered.
  const drawing = overview.slice(overview.indexOf('<figure class="overview-drawing"'), overview.indexOf("</figure>"));
  assert.match(drawing, /class="overview-sidebar" aria-hidden="true"/);
  assert.match(drawing, /overview-rail-button--active"><span class="overview-mask overview-mask--house">[\s\S]*?overview-mask--user[\s\S]*?overview-mask--notebook[\s\S]*?overview-tag overview-tag--rail">A</);
  assert.match(drawing, /overview-row--group">\s*<span class="overview-folder overview-folder--filled"><\/span>\s*<span class="overview-title">Research<\/span>\s*<span class="overview-tag">B</);
  assert.equal((drawing.match(/overview-row--member/g) ?? []).length, 2);
  assert.match(drawing, /overview-row--current">[\s\S]*?Inbox<\/span>\s*<span class="overview-tag">C</);
  assert.match(drawing, /<figcaption id="overview-drawing-caption"[^>]*>[^<]*A through C\./);
  assert.deepEqual([...drawing.matchAll(/class="overview-tag[^"]*">([A-Z])</g)].map(([, letter]) => letter).sort(), ["A", "B", "C"]);
  const key = overview.slice(overview.indexOf('<ol class="overview-key"'), overview.indexOf("</ol>"));
  assert.deepEqual(
    [...key.matchAll(/<span class="overview-tag" aria-hidden="true">([A-Z])<\/span><p><strong>([^<]+)<\/strong>/g)].map(([, letter, title]) => `${letter} ${title}`),
    ["A Workspace rail", "B Groups and trees", "C The current tab"]
  );
  assert.match(key, /Click an icon to switch\. Drag to reorder, or lock it in Sidebar settings\./);
  assert.match(key, /A collapsed group shows how many tabs it holds\./);
  assert.match(key, /Uses the highlight chosen in Appearance\./);

  // Every mark has a filled and a hollow form, each named in text.
  const marks = overview.slice(overview.indexOf('<table class="overview-legend">'), overview.indexOf("</table>"));
  assert.deepEqual([...marks.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(([, heading]) => heading), ["Loaded", "Unloaded"]);
  assert.deepEqual(
    [...marks.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map(([, row]) => row),
    ["Tab", "Container tab", "Tab group", "Collapsed count"]
  );
  assert.deepEqual(
    [...marks.matchAll(/role="img" aria-label="([^"]+)"/g)].map(([, label]) => label),
    ["Filled circle", "Dashed circle", "Filled star", "Outlined star", "Filled folder", "Hollow folder", "White count", "Grey count"]
  );
  assert.match(overview, /Counts are exact up to 999, then show 999\+\./);

  // The badge legend uses the Viewer's own badges and covers every source the
  // Viewer can show.
  const badges = [...overview.matchAll(/<span class="snapshot-kind snapshot-kind--([a-z]+)">([^<]+)<\/span>/g)]
    .map(([, id, label]) => `${id} ${label}`);
  assert.deepEqual(badges, ["manual Manual", "automatic Automatic", "private Private", "imported Imported"]);
  for (const id of ["private", "imported"]) {
    assert.match(snapshots, new RegExp(`id: "${id}"`));
  }

  const moves = overview.slice(overview.indexOf('<dl class="overview-moves">'), overview.indexOf("</dl>"));
  assert.deepEqual([...moves.matchAll(/<dt><kbd>([^<]+)<\/kbd>/g)].map(([, move]) => move), ["Click", "Right-click", "Middle-click", "Drag"]);
  assert.match(moves, /Other workspaces' tabs are hidden, never closed\./);
  assert.match(moves, /Open every action for that tab, group, or workspace\./);
  assert.match(moves, /Move it on the rail\./);
  assert.match(overview, /Export layouts and custom icons without including tabs\./);
  assert.match(overview, /Removing a workspace moves its tabs instead of closing them\./);
  assert.match(overview, /Restored tabs stay unloaded until selected\./);

  assert.match(css, /\.overview-tag\s*\{[\s\S]*?border-radius: var\(--r-0\);/);
  assert.match(css, /\.overview-count\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?color: #fff;[\s\S]*?font-weight: 600;/);
  assert.match(css, /\.overview-count--unloaded\s*\{[\s\S]*?color: color-mix[\s\S]*?font-weight: 400;/);
  assert.match(css, /@media \(forced-colors: active\) \{\s*\.overview-sidebar,\s*\.overview-moves,\s*\.overview-card \{\s*border-color: CanvasText;/);

  // The window-scope mark existed only for the old Overview's private notes.
  assert.doesNotMatch(overview, /overview-private-note/);
  assert.doesNotMatch(css, /data-window-scope/);
  assert.doesNotMatch(snapshots, /windowScope|snapshotScope/);
});

test("the cleanup summary always describes the current values", () => {
  const settings = createDefaultSettingsState();
  assert.equal(cleanupSummaryText(settings), "Automatic saves are off, so nothing is removed.");
  settings.privacy.automaticSnapshotsEnabled = true;
  assert.equal(
    cleanupSummaryText(settings),
    "Keeps the newest 100 automatic saves in each library and removes the oldest when a new one goes over."
  );
  // Nothing about a save's age appears any more, at any maximum.
  settings.snapshots.retentionCount = 9999;
  assert.equal(
    cleanupSummaryText(settings),
    "Keeps the newest 9999 automatic saves in each library and removes the oldest when a new one goes over."
  );
});

test("custom colors use a centered extension-owned dialog instead of the native picker", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const appearancePanel = await readFile(
    new URL("../../src/settings/appearance-panel.js", import.meta.url),
    "utf8"
  );
  const workspacePanel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");
  assert.match(html, /<dialog id="color-panel"/);
  assert.doesNotMatch(html, /type="color"/);
  assert.doesNotMatch(appearancePanel, /\.type = "color"/);
  assert.doesNotMatch(workspacePanel, /\.type = "color"/);
  assert.match(workspacePanel, /swatch\.className = "swatch swatch--small";/);
  assert.match(workspacePanel, /colorPanel\.open\(\{ title, value: color \?\? mixedColors\[0\], onApply: apply \}\)/);
  assert.doesNotMatch(`${appearancePanel}\n${workspacePanel}`, /color-well/);
  assert.match(css, /\.color-panel\s*\{[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?margin: auto;/);
  assert.match(css, /#color-panel-hue\s*\{[\s\S]*?#f00[\s\S]*?#0f0[\s\S]*?#00f/);
  assert.match(css, /#color-panel-saturation\s*\{[\s\S]*?--color-panel-saturation-start[\s\S]*?--color-panel-saturation-end/);
  assert.match(css, /#color-panel-lightness\s*\{[\s\S]*?#000[\s\S]*?--color-panel-lightness-middle[\s\S]*?#fff/);
  assert.match(css, /::-moz-range-thumb\s*\{[\s\S]*?border: 3px solid white;[\s\S]*?border-radius: 50%/);
  assert.match(appearancePanel, /colorPanel\.open/);
});

test("settings and workspace navigation styling uses themed accents and transparent icon buttons", async () => {
  const settingsCss = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");
  const sidebarCss = await readFile(new URL("../../src/sidebar/styles.css", import.meta.url), "utf8");
  assert.match(settingsCss, /font-size: var\(--settings-font-size, 16px\)/);
  assert.match(sidebarCss, /font-size: var\(--sidebar-font-size, 16px\)/);
  assert.match(settingsCss, /AccentColor/);
  assert.match(settingsCss, /\.mobile-navigation/);
  assert.match(sidebarCss, /\.workspace-entry[\s\S]*?background: transparent;/);
  assert.match(sidebarCss, /\.workspace-icon[\s\S]*?background: var\(--workspace-color\);/);
  assert.doesNotMatch(settingsCss, /#00ffff|cyan/i);
});

test("workspace settings exposes divider sizing, flexible spaces, drag placement, and tab safety", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const workspacePanel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );
  const sidebarPanel = await readFile(
    new URL("../../src/settings/sidebar-panel.js", import.meta.url),
    "utf8"
  );
  const settingsMain = await readFile(
    new URL("../../src/settings/main.js", import.meta.url),
    "utf8"
  );
  const sidebarMain = await readFile(
    new URL("../../src/sidebar/main.js", import.meta.url),
    "utf8"
  );
  const settingsClient = await readFile(
    new URL("../../src/settings/settings-client.js", import.meta.url),
    "utf8"
  );
  const settingsCss = await readFile(
    new URL("../../src/settings/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(workspacePanel, /client\.resizeDivider/);
  assert.match(workspacePanel, /client\.addSpace/);
  assert.match(workspacePanel, /client\.place/);
  assert.match(workspacePanel, /pointerdown/);
  assert.match(workspacePanel, /row\.addEventListener\("pointerdown"/);
  assert.doesNotMatch(workspacePanel, /handle\.addEventListener\("pointerdown"/);
  assert.doesNotMatch(workspacePanel, /function movementButton/);
  assert.match(workspacePanel, /data-drop-position/);
  assert.match(settingsClient, /WORKSPACE_MESSAGE_TYPES\.REMOVE_MANY/);
  assert.doesNotMatch(workspacePanel, /Use global size/);
  assert.match(html, /id="add-space"/);
  assert.match(html, /name="content-mode" value="icons"/);
  assert.match(html, /name="active-tab-highlight-mode" value="custom"/);
  assert.match(html, /id="active-tab-highlight-color"/);
  assert.match(html, /id="workspace-reordering-locked"/);
  assert.doesNotMatch(html, /id="settings-remove-workspace-dialog"/);
  assert.match(html, /class="btn is-danger" type="submit"/);
  assert.match(settingsCss, /grid-template-columns: 16rem minmax\(0, 1fr\)/);
  assert.match(settingsCss, /justify-self: center/);
  assert.match(
    settingsCss,
    /\.size-choice\[data-size="large"\][\s\S]*?--workspace-preview-icon: 28px;[\s\S]*?--tab-preview-icon: 28px;[\s\S]*?--settings-font-preview: 28px;/
  );
  assert.match(
    settingsCss,
    /\.size-choice\[data-size="massive"\][\s\S]*?--workspace-preview-icon: 40px;[\s\S]*?--tab-preview-icon: 40px;/
  );
  assert.match(settingsCss, /\.settings-font-size-grid\s*{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(settingsCss, /\.size-preview--font i[\s\S]*?case-sensitive\.svg/);
  assert.match(
    settingsCss,
    /\.size-preview--font\s*{[\s\S]*?inline-size: calc\(var\(--settings-font-preview\) \+ 20px\);[\s\S]*?block-size: calc\(var\(--settings-font-preview\) \+ 20px\);[\s\S]*?border-radius: var\(--r-1\);/
  );
  assert.match(
    settingsCss,
    /\.size-preview--font i\s*{[\s\S]*?inline-size: calc\(var\(--settings-font-preview\) \+ 8px\);[\s\S]*?block-size: calc\(var\(--settings-font-preview\) \+ 8px\);/
  );
  assert.doesNotMatch(settingsCss, /--settings-font-preview: 40px/);
  assert.match(sidebarPanel, /workspaceReorderingLocked/);
  assert.match(
    sidebarPanel,
    /reorderingLockInput,[\s\S]*?addWorkspaceButtonInput,[\s\S]*?actionButtonsInput,[\s\S]*?showTabSearchInput/
  );
  assert.match(sidebarPanel, /addWorkspaceButtonInput\.checked = settings\.sidebar\.showAddWorkspaceButton/);
  const lock = html.indexOf('id="workspace-reordering-locked"');
  const addToggle = html.indexOf('id="show-add-workspace-button"');
  assert.ok(lock > 0 && addToggle > lock && addToggle < html.indexOf('id="show-action-buttons"'));
  assert.match(html, /<strong>Show add workspace button<\/strong>\s*<span>The \+ after the last rail entry\.<\/span>/);
  assert.match(html, /id="show-add-workspace-button"\s*name="showAddWorkspaceButton"\s*type="checkbox"/);
  assert.doesNotMatch(html, /show-workspace-counts-up-to-999|show-tab-counts-up-to-999/);
  // The multi-tab close warning is answered in its dialog, not in Settings.
  assert.doesNotMatch(html, /id="warn-before-closing-multiple-tabs"/);
  // One Overview control owns every warning, so no panel reads one directly.
  assert.doesNotMatch(sidebarPanel, /warnBeforeClosingMultipleTabs/);
  assert.match(html, /id="hide-unloaded-tabs-from-firefox"\s*name="hideUnloadedTabsFromFirefox"\s*type="checkbox"/);
  assert.match(html, /id="show-tab-search"\s*name="showTabSearch"\s*type="checkbox"/);
  assert.match(html, /id="tab-search-position" name="tabSearchPosition">[\s\S]*?value="top">Top[\s\S]*?value="bottom">Bottom/);
  assert.match(html, /<strong>Show tab search<\/strong>\s*<span>Searches titles first, then site names and paths\.<\/span>/);
  assert.doesNotMatch(html, /title-only search bar in Full Labels|scope starts at This Workspace/);
  assert.match(
    html,
    /<strong>Hide unloaded tabs from Firefox's tab strip<\/strong>\s*<span>Terminus still keeps them\. Active, pinned, sharing, and split tabs always remain visible\.<\/span>/
  );
  assert.match(sidebarPanel, /hideUnloadedTabsInput\.checked = settings\.sidebar\.hideUnloadedTabsFromFirefox/);
  assert.match(sidebarPanel, /showTabSearchInput\.checked = settings\.sidebar\.showTabSearch/);
  assert.match(sidebarPanel, /tabSearchPositionInput\.value = settings\.sidebar\.tabSearchPosition/);
  assert.doesNotMatch(sidebarPanel, /showTabSearchInput\.disabled/);
  assert.match(sidebarPanel, /const searchPositionDisabled = !settings\.sidebar\.showTabSearch;/);
  assert.match(sidebarPanel, /tabSearchPositionInput\.addEventListener\("change"/);
  // Search visibility and its position are neighbouring rows of the one
  // "Tabs and search" stack, so the position always reads as belonging to it.
  const tabsCard = html.slice(html.indexOf('id="tab-controls-heading"'), html.indexOf('id="reset-sidebar"'));
  assert.match(tabsCard, /id="show-tab-search"[\s\S]*?<\/label>\s*<label class="setting-row setting-row--select" for="tab-search-position">/);
  assert.doesNotMatch(settingsCss, /\.sidebar-search-options|\.closing-options/);
  assert.match(settingsCss, /\.setting-row--select select\s*{[\s\S]*?min-inline-size: 9rem;/);
  assert.doesNotMatch(sidebarPanel, /workspaceCountInput|tabCountInput/);
  assert.match(sidebarPanel, /input\.addEventListener\("change"/);
  assert.match(settingsMain, /ensureSettingsCompanion/);
  assert.match(sidebarMain, /entry\.size/);
  assert.doesNotMatch(sidebarMain, /active workspace cannot be unloaded/i);
});

test("sidebar owns detailed tabs, internal drag markers, and explicit compact details", async () => {
  const html = await readFile(new URL("../../src/sidebar/index.html", import.meta.url), "utf8");
  const pane = await readFile(new URL("../../src/sidebar/tab-pane.js", import.meta.url), "utf8");
  const nativeDrop = await readFile(
    new URL("../../src/sidebar/native-tab-drop.js", import.meta.url),
    "utf8"
  );
  const sidebarMain = await readFile(
    new URL("../../src/sidebar/main.js", import.meta.url),
    "utf8"
  );
  const renderCoordinator = await readFile(
    new URL("../../src/sidebar/tab-render-coordinator.js", import.meta.url),
    "utf8"
  );
  const css = await readFile(new URL("../../src/sidebar/styles.css", import.meta.url), "utf8");
  assert.match(
    html,
    /<html lang="en" data-action-buttons="shown" data-content-mode="full">/
  );
  assert.doesNotMatch(html, /data-right-click-behavior/);
  assert.match(html, /id="tab-list"/);
  assert.match(html, /id="tab-search"[^>]*aria-label="Search tabs"[^>]*hidden/);
  assert.match(
    html,
    /id="tab-search-toggle"[\s\S]*?aria-label="Search tabs"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="tab-search-controls"/
  );
  assert.match(html, /id="tab-search-controls" class="tab-search-controls" hidden/);
  assert.match(html, /for="tab-search-input">Search tabs<\/label>/);
  assert.match(html, /id="tab-search-input"[\s\S]*?placeholder="Search all tabs…"/);
  assert.match(html, /id="tab-search-scope"[\s\S]*?value="window">All Workspaces[\s\S]*?value="workspace">This Workspace/);
  assert.match(sidebarMain, /GET_SEARCH_INDEX/);
  assert.match(sidebarMain, /ACTIVATE_SEARCH_RESULT/);
  assert.match(sidebarMain, /createTabSearchController\(\{/);
  assert.doesNotMatch(sidebarMain, /filterTabSearchResults|tabSearchInput|activeWorkspaceSearchIndex/);
  assert.doesNotMatch(sidebarMain, /contentMode === "full"[\s\S]{0,80}showTabSearch/);
  assert.match(sidebarMain, /enabled: currentSettings\?\.sidebar\?\.showTabSearch !== false/);
  assert.match(css, /\.tab-pane\[data-tab-search-position="bottom"\]/);
  assert.match(css, /\.tab-search-toggle-icon\s*{[\s\S]*?mask: url\("\.\.\/assets\/icons\/search\.svg"\)/);
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-pane\[data-tab-search-open="true"\]\s*{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/
  );
  assert.doesNotMatch(
    css,
    /\[data-content-mode="icons"\] \.tab-search,\s*\[data-content-mode="icons"\] \.tab-search-results\s*{\s*display: none;/
  );
  assert.equal((html.match(/id="new-workspace-tab"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /new-tab-inline-slot|new-tab-docked-slot|new-tab-end-marker/);
  const footer = html.slice(html.indexOf('id="tab-footer"'), html.indexOf("</section>"));
  assert.match(footer, /id="undo-sidebar-action"[\s\S]*?id="new-tab-slot"/);
  assert.match(sidebarMain, /currentUndoSummary\.action === SIDEBAR_UNDO_ACTIONS\.REDO \? "Redo" : "Undo"/);
  assert.doesNotMatch(sidebarMain, /`Undo \$\{currentUndoSummary\.label\}`/);
  assert.match(css, /\.undo-sidebar-button\[data-action="redo"\] \.undo-sidebar-icon[\s\S]*?scaleX\(-1\)/);
  assert.match(footer, /id="new-tab-slot"[\s\S]*?id="new-workspace-tab"[\s\S]*?aria-label="New tab"[\s\S]*?aria-haspopup="menu"/);
  assert.match(footer, /class="new-tab-icon"[^>]*><\/span><span class="new-tab-label"[^>]*>New tab<\/span>/);
  assert.doesNotMatch(html, /id="status-badge"|id="status-dialog"|class="status-slot"/);
  assert.match(html, /id="rename-workspace-dialog"/);
  assert.match(html, /id="rename-group-dialog"/);
  assert.doesNotMatch(html, /id="remove-workspace-dialog"/);
  assert.match(html, /id="close-tabs-dialog"/);
  assert.match(html, /id="skip-multiple-tab-close-warning"[\s\S]*?Don’t warn me again/);
  assert.match(
    html,
    /id="move-container-dialog"[\s\S]*?id="move-container-choices"[\s\S]*?Pages reload in the new container\. Sign-ins, form contents, and back\/forward history don’t carry over\.[\s\S]*?id="cancel-container-move"[\s\S]*?id="confirm-container-move"[^>]*>Move</
  );
  assert.match(sidebarMain, /MOVE_TABS_TO_CONTAINER/);
  assert.match(sidebarMain, /createContainerMoveDialog\(\{/);
  assert.match(
    sidebarMain,
    /canMoveToContainer: \(\) =>\s*currentWindowIncognito === false && currentContainers\.capability === "available"/
  );
  assert.doesNotMatch(html, /id="workspace-reorder-lock"/);
  assert.doesNotMatch(html, /title=/);
  assert.match(pane, /application\/x-sidebars-drag-session/);
  assert.match(pane, /textContent = tab\.title/);
  assert.match(
    pane,
    /modified: event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/
  );
  assert.doesNotMatch(pane, /text\/x-moz-text-internal/);
  assert.match(pane, /onAcceptNativeDrop/);
  assert.match(pane, /onRelocateNativeSelection/);
  assert.match(pane, /--group-color/);
  assert.match(pane, /dataset\.splitViewId/);
  assert.match(pane, /tab-split-indicator/);
  assert.match(pane, /tab-container-marker/);
  assert.match(pane, /tab-audio-state/);
  assert.match(pane, /tab-load-state/);
  assert.match(pane, /label: "Unpin"[\s\S]*?label: "Pin"/);
  assert.match(
    pane,
    /\["Move tab up", "up"\], \["Move tab down", "down"\][\s\S]*?"Create new group"[\s\S]*?commands\.push\(\.\.\.containerMove, unload, \.\.\.flatten, close\)/
  );
  assert.match(pane, /label = `Close selected \(\$\{closure\.length\} tabs\)`/);
  assert.match(pane, /label = `Close branch \(\$\{closure\.length\} tabs\)`/);
  assert.match(pane, /return \{ label, action: \(\) => onCloseTarget\(target\), variant: "danger" \}/);
  assert.match(pane, /`Flatten selected \(\$\{nested\.size\} tabs\)`/);
  assert.match(
    pane,
    /`Flatten branch \(\$\{nested\.size \+ 1\} tabs\)`;\s*return \[\{\s*label,\s*action: \(\) => onFlattenBranch\(parents\.map\(tabIdentity\)\),\s*variant: "danger"/
  );
  assert.match(
    pane,
    /return \[unload, \.\.\.flatten, \.\.\.containerMove, close\]/,
    "split-locked menus keep Flatten and Move to container just before Close"
  );
  assert.doesNotMatch(pane, /rightClickBehavior/);
  assert.match(pane, /row\.addEventListener\("contextmenu"[\s\S]*?handleTabContext\(row, tab\)/);
  assert.match(pane, /function unloadTarget\(target\)[\s\S]*?return onUnloadTabs\(withTreeDescendants\(currentView\.activeTabs, sourceRows\(logicalId\)\)\)/);
  assert.match(pane, /row\.draggable = tab\.splitViewId === null/);
  assert.match(pane, /label: "Move group up"[\s\S]*?label: "Move group down"[\s\S]*?label: "Unload group"[\s\S]*?label: "Rename group"[\s\S]*?label: "Delete group"/);
  assert.match(pane, /label: "Delete group"[\s\S]*?variant: "danger"/);
  assert.match(pane, /label: `Close group \(\$\{group\.tabIds\.length\} tabs\)`[\s\S]*?variant: "danger"/);
  assert.doesNotMatch(pane, /Pin group/);
  const dropResolver = await readFile(
    new URL("../../src/sidebar/tab-drop-resolver.js", import.meta.url),
    "utf8"
  );
  assert.match(dropResolver, /destinationForZone\(context\.workspaceId, "group", entry\.group\.id\)/);
  assert.match(pane, /bindListDrop\(scrollRoot\)/);
  assert.match(pane, /header\.draggable = !splitLocked/);
  assert.match(nativeDrop, /text\/x-moz-text-internal/);
  assert.match(nativeDrop, /highlighted: true/);
  assert.doesNotMatch(sidebarMain, /scheduleNewTabPlacement|ResizeObserver|newTabDocked|newTabPlacementFrame/);
  assert.doesNotMatch(css, /new-tab-slot--inline|new-tab-slot--docked|data-new-tab-docked|new-tab-end-marker/);
  assert.match(sidebarMain, /addEventListener\("contextmenu"/);
  assert.match(sidebarMain, /tabPane\.openMenu\(button, workspaceCommands\(workspace\)/);
  assert.match(sidebarMain, /newTabButton\.addEventListener\("contextmenu"[\s\S]*?openNewTabMenu\(\)/);
  assert.match(sidebarMain, /"Move workspace up"/);
  assert.match(sidebarMain, /"Move workspace down"/);
  assert.match(sidebarMain, /label: "Remove workspace"[\s\S]*?variant: "danger"/);
  assert.match(sidebarMain, /label: "Close all tabs"[\s\S]*?variant: "danger"/);
  assert.match(
    sidebarMain,
    /browser\.tabs\.onRemoved\.addListener\(\(tabId, removeInfo\)[\s\S]*?faviconPresenter\.handleTabRemoved\(tabId\)[\s\S]*?scheduleRefresh\(\)/
  );
  assert.match(
    renderCoordinator,
    /renderTree\(view\)[\s\S]*?tabPane\.render\(view\)[\s\S]*?synchronize\(view\.liveTabIdentities\)[\s\S]*?present\(view\.activeTabs\)/
  );
  assert.match(sidebarMain, /tabRenderCoordinator\.renderTree\(view\)/);
  assert.doesNotMatch(sidebarMain, /tabPane\.render\(/);
  assert.doesNotMatch(pane, /removeFirefoxTab|render\(currentView\)/);
  assert.match(html, /id="tab-search-clear"[\s\S]*?aria-label="Clear tab search"/);
  assert.match(
    sidebarMain,
    /const searchFocus = tabSearch\.captureFocus\(\)[\s\S]*?tabSearch\.setView\(view, searchFocus\)/
  );
  assert.match(sidebarMain, /if \(button\.closest\("\.tab-search, \.tab-search-results"\)\) continue;/);
  assert.match(css, /@container tab-pane \(max-width: 17em\)[\s\S]*?\.tab-search-controls/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.tab-search-result-workspace::before/);
  assert.match(sidebarMain, /PREPARE_CLOSE_TABS/);
  assert.match(sidebarMain, /CLOSE_TABS/);
  assert.match(sidebarMain, /warnBeforeClosingMultipleTabs/);
  assert.match(sidebarMain, /SIDEBAR_UNDO_MESSAGE_TYPES\.EXECUTE/);
  assert.match(sidebarMain, /tabPane\.openMenuAtPoint\(event\.clientX, event\.clientY\)/);
  assert.match(
    sidebarMain,
    /event\.target\.closest\("dialog, \.command-menu, \.tab-search, \.tab-search-results"\)/
  );
  assert.match(sidebarMain, /tabPaneElement\.addEventListener\("contextmenu", openBlankSidebarMenu\)/);
  assert.match(sidebarMain, /workspaceNavigation\.addEventListener\("contextmenu", openBlankSidebarMenu\)/);
  assert.match(pane, /const globalCommands = getGlobalCommands\(\)/);
  assert.match(pane, /kind: "separator"/);
  assert.match(sidebarMain, /RENAME_GROUP/);
  assert.doesNotMatch(sidebarMain, /newTabMenuButton/);
  assert.match(css, /\.tab-load-state\[data-load-state="unloaded"\]/);
  assert.match(
    css,
    /:root\[data-content-mode="full"\] \.tab-load-state\s*\{[\s\S]*?position: static;[\s\S]*?inset: auto;/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-load-state\s*\{[\s\S]*?position: absolute;[\s\S]*?inset-inline-end: 3px;[\s\S]*?inset-block-end: 3px;/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-container-marker\s*\{[\s\S]*?inset-inline-end: 3px;[\s\S]*?inset-block-end: 3px;[\s\S]*?inline-size: max\(9px, calc\(var\(--tab-disclosure-size\) \* 0\.72\)\);[\s\S]*?block-size: max\(9px, calc\(var\(--tab-disclosure-size\) \* 0\.72\)\);/
  );
  assert.match(pane, /let stateIndicator = null;[\s\S]*?if \(tab\.container\.kind === "container"\)[\s\S]*?tab-container-marker[\s\S]*?else if \(!hiddenBranch\) \{[\s\S]*?tab-load-state/);
  assert.doesNotMatch(
    css,
    /data-action-buttons="shown"[^{]*\.tab-load-state/
  );
  assert.match(css, /\[data-content-mode="icons"\] \.tab-menu-button[\s\S]*?display: none/);
  assert.match(css, /\.new-tab-button\s*\{[\s\S]*?display: flex;[\s\S]*?flex: 1 1 auto;/);
  assert.match(css, /\[data-content-mode="icons"\] \.new-tab-label\s*\{[\s\S]*?display: none;/);
  assert.match(css, /\[data-content-mode="icons"\] \.new-tab-button\s*\{[\s\S]*?inline-size: var\(--tab-control-size\);/);
  assert.match(css, /\.sidebar-shell::after\s*\{[\s\S]*?inset-block-end: var\(--sidebar-footer-size\)/);
  assert.match(css, /data-content-mode="icons"/);
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.workspace-navigation[\s\S]*?visibility: visible;/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.workspace-icon[\s\S]*?display: block;[\s\S]*?visibility: visible;/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.workspace-tab-count\s*\{[\s\S]*?display: grid;/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-pane\s*\{[\s\S]*?flex: 0 0 var\(--tab-icon-pane-size\);[\s\S]*?inline-size: var\(--tab-icon-pane-size\);[\s\S]*?min-inline-size: var\(--tab-icon-pane-size\);[\s\S]*?max-inline-size: var\(--tab-icon-pane-size\);/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-scroll\s*\{[\s\S]*?min-inline-size: 0;[\s\S]*?inline-size: 100%;[\s\S]*?scrollbar-gutter: stable;[\s\S]*?scrollbar-width: thin;/
  );
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-footer\s*\{[\s\S]*?inline-size: var\(--tab-icon-column-size\);/
  );
  assert.match(css, /\[data-content-mode="icons"\] \.tab-zone-title,[\s\S]*?\.tab-title,[\s\S]*?\.group-title\s*\{[\s\S]*?display: none;/);
  assert.doesNotMatch(css, /\.status-slot|\.status-badge|\.status-dialog/);
  assert.doesNotMatch(sidebarMain, /statusBadge|statusDialog|statusDetails/);
  assert.match(css, /\.drop-inside/);
  const groupRule = css.match(/\n\.tab-group \{[^}]*\}/)?.[0] ?? "";
  assert.match(groupRule, /position: relative;/);
  assert.doesNotMatch(groupRule, /background|box-shadow|outline/);
  assert.doesNotMatch(css.match(/\n\.tab-group-header \{[^}]*\}/)?.[0] ?? "", /border-inline-start/);
  assert.match(
    css,
    /\.tab-group:has\(> \.tab-row\)::before\s*\{[\s\S]*?inset-inline-start: var\(--group-line-start\);[\s\S]*?inline-size: var\(--group-line-width\);[\s\S]*?background: var\(--group-color/
  );
  // The group's color reaches the sidebar in three places: its line, its folder,
  // and the branch its members hang from.
  assert.match(css, /--group-line-width: max\(2px, calc\(var\(--tab-favicon-size\) \/ 10\)\);/);
  assert.match(
    css,
    /\.tab-group \{[\s\S]*?--tree-guide-color: color-mix\(in srgb, var\(--group-color, var\(--sidebar-accent\)\) 70%, transparent\);/
  );
  assert.match(css, /\.group-icon \{\s*color: var\(--group-color, var\(--sidebar-accent\)\);\s*\}/);
  assert.match(css, /--tab-row-inset: calc\(var\(--group-line-start\) \+ 5px\);/);
  assert.match(css, /\.tab-group > \.tab-row\[aria-current="page"\]/);
  assert.match(css, /\.tab-group > \.tab-row\[aria-selected="true"\]/);
  assert.match(css, /--sidebar-active-tab-highlight/);
  assert.match(css, /\.tab-row--split/);
  assert.match(
    css,
    /@media \(forced-colors: active\)[\s\S]*?\.tab-group:has\(> \.tab-row\)::before\s*\{[\s\S]*?background: CanvasText;/
  );
  assert.match(css, /inline-size: min\(13rem, calc\(100vw - 8px\)\)/);
  assert.match(css, /--sidebar-danger: light-dark\(#b00020, #ff8a8a\)/);
  assert.match(css, /\.command-menu-item\[data-variant="danger"\][\s\S]*?color: var\(--sidebar-danger\)/);
  assert.match(css, /\.tab-favicon--fallback\s*\{[\s\S]*?--favicon-fallback-color/);
  assert.doesNotMatch(
    css,
    /\[data-content-mode="icons"\][^{]*\.[^{]*(?:menu-button)[^{]*\{[^}]*opacity:\s*1/
  );
  assert.match(sidebarMain, /application\/x-sidebars-workspace/);
  assert.match(sidebarMain, /workspaceReorderingLocked/);
  assert.match(sidebarMain, /WORKSPACE_MESSAGE_TYPES\.REMOVE/);
  assert.match(sidebarMain, /WORKSPACE_MESSAGE_TYPES\.UPDATE/);
  assert.match(sidebarMain, /WORKSPACE_MESSAGE_TYPES\.OPEN_SETTINGS/);
  assert.match(sidebarMain, /WORKSPACE_MESSAGE_TYPES\.RELOCATE_NATIVE_SELECTION/);
  assert.doesNotMatch(sidebarMain, /\.openOptionsPage\(/);
});

test("unloaded-tab visibility changes reconverge normal and private windows", async () => {
  const backgroundMain = await readFile(
    new URL("../../src/background/main.js", import.meta.url),
    "utf8"
  );
  assert.match(
    backgroundMain,
    /oldValue\?\.sidebar\?\.hideUnloadedTabsFromFirefox[\s\S]*?newValue\?\.sidebar\?\.hideUnloadedTabsFromFirefox[\s\S]*?workspaceEventRouter\.enqueueAll\(\)[\s\S]*?privateWorkspaceEventRouter\.enqueueAll\(\)/
  );
});

test("sidebar draws tree guides, collapsed counts, and the rail + in both content modes", async () => {
  const [css, pane, sidebarMain, countBadge] = await Promise.all([
    readFile(new URL("../../src/sidebar/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/tab-pane.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/ui/count-badge.js", import.meta.url), "utf8")
  ]);
  // The branch is drawn, not striped: one cell per ancestor column, each either
  // carrying its trunk onward or left empty, then a connector pointing at the
  // tab. Cells overlap the row gap at both ends so trunks join up.
  assert.match(css, /\.tree-branch \{[\s\S]*?display: flex;[\s\S]*?inset-block: -2px;[\s\S]*?inset-inline-start: var\(--tab-row-inset, 4px\);/);
  assert.match(css, /\.tree-branch-cell \{[\s\S]*?inline-size: var\(--row-indent-step, var\(--tree-indent-size, 16px\)\);/);
  assert.match(
    css,
    /\.tree-branch-cell\[data-shape="trunk"\]::before,\s*\.tree-branch-cell\[data-shape="tee"\]::before \{\s*inset-block-end: 0;/
  );
  assert.match(css, /\.tree-branch-cell\[data-shape="elbow"\]::before \{\s*block-size: 50%;/);
  // The arm is one indent step wide, which lands it on the tab's own column.
  assert.match(
    css,
    /\.tree-branch-cell\[data-shape="tee"\]::after,\s*\.tree-branch-cell\[data-shape="elbow"\]::after \{[\s\S]*?inset-block-start: 50%;[\s\S]*?inline-size: 100%;[\s\S]*?block-size: 1px;/
  );
  // Icons Only draws nesting as up to four grey edge lines inside the tile,
  // opposite the group line, without changing the column width.
  assert.match(css, /\[data-content-mode="icons"\] \.tree-branch \{\s*inset-block: 9px;\s*inset-inline: auto 1px;/);
  assert.match(css, /\[data-content-mode="icons"\] \.tree-branch-cell \{\s*inline-size: 2px;/);
  assert.match(css, /\[data-content-mode="icons"\] \.tree-branch-cell:nth-child\(n \+ 5\) \{\s*display: none;/);
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tree-branch-cell::before,\s*\[data-content-mode="icons"\] \.tree-branch-cell::after \{\s*content: none;/
  );
  assert.match(css, /forced-colors[\s\S]*?--tree-guide-color: GrayText;/);
  assert.match(pane, /const branch = tab\.pinned \? null : branchShape;/);
  assert.match(pane, /row\.dataset\.nested = "true";\s*row\.append\(treeBranch\(branch\)\);/);
  assert.match(pane, /connector\.dataset\.shape = shape\.lastChild \? "elbow" : "tee";/);
  assert.match(pane, /cell\.dataset\.shape = continues \? "trunk" : "none";/);
  // Indentation follows the drawn columns; aria-level keeps the semantic depth.
  assert.match(pane, /row\.style\.setProperty\("--tree-depth", String\(branch\?\.depth \?\? 0\)\)/);
  assert.match(pane, /row\.setAttribute\("aria-level", String\(tab\.depth \+ 1\)\)/);
  assert.match(css, /padding-inline:\s*calc\(var\(--tab-row-inset, 4px\) \+ var\(--tree-depth\) \* var\(--row-indent-step, var\(--tree-indent-size, 16px\)\)\)/);

  // Counts are plain transparent text: loaded or partial values are bright and
  // semibold, while fully unloaded values are grey and regular weight.
  assert.match(css, /\.count-badge\s*\{[\s\S]*?padding: 0;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?color: #fff;[\s\S]*?font-weight: 600;/);
  assert.match(css, /\.count-badge\[data-load-state="unloaded"\]\s*\{[\s\S]*?color: color-mix[\s\S]*?font-weight: 400;/);
  assert.match(css, /\.workspace-tab-count\s*\{[\s\S]*?grid-row: 2;[\s\S]*?align-self: end;[\s\S]*?font-size: var\(--workspace-count-font-size\);/);
  assert.match(css, /data-content-mode="full"\]\[data-action-buttons="shown"\][\s\S]*?\.workspace-item:hover \.workspace-tab-count[\s\S]*?opacity: 0;/);
  assert.match(css, /\.workspace-container-unavailable\s*\{[\s\S]*?inset-block-start: 2px;/);
  assert.match(sidebarMain, /count\.className = "count-badge workspace-tab-count";/);
  assert.match(sidebarMain, /button\.title = accessibleLabel;/);
  // Full Labels reuses the status column, keeping the title cell untouched.
  assert.match(
    css,
    /\.tab-count-badge\s*\{[\s\S]*?grid-row: 1;[\s\S]*?grid-column: 5;[\s\S]*?justify-self: center;/
  );
  assert.doesNotMatch(css.match(/\n\.tab-count-badge\s*\{[^}]*\}/)?.[0] ?? "", /translate/);
  assert.match(css, /\.tab-row--split \.tab-count-badge \{\s*grid-column: 6;/);
  assert.match(css, /\.tab-group-header > \.tab-count-badge \{\s*grid-column: 4;/);
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-count-badge \{[\s\S]*?position: absolute;[\s\S]*?inset-inline: 0;[\s\S]*?inset-block-end: 0;[\s\S]*?block-size: var\(--tab-count-line-size\);/
  );
  assert.match(css, /\.tab-row > \.tab-favicon,\s*\.tab-group-header > \.group-icon\s*\{\s*grid-row: 1;\s*grid-column: 2;/);
  assert.match(css, /\[data-content-mode="icons"\] \.tab-row\[data-has-count="true"\][\s\S]*?min-block-size: calc\(var\(--tab-tile-size\) \+ var\(--tab-count-line-size\)\);/);
  assert.match(pane, /badge\.textContent = countBadgeText\(count\);/);
  assert.match(countBadge, /COUNT_BADGE_MAXIMUM = 999/);
  assert.doesNotMatch(countBadge, /COMPACT|APPEARANCE_CONTENT_MODES|showTabCountsUpTo999/);
  assert.match(sidebarMain, /count\.textContent = countBadgeText\(summary\.tabCount\);/);
  assert.match(sidebarMain, /const accessibleLabel = `\$\{workspace\.name\}, \$\{tabDescription\}, \$\{containerDescription\}`;[\s\S]*?aria-label", accessibleLabel/);
  assert.match(pane, /\$\{group\.tabIds\.length\} tabs, \$\{GROUP_LOAD_STATE_LABELS\[loadState\]\}/);
  assert.match(pane, /nested \$\{count === 1 \? "tab" : "tabs"\} hidden, \$\{anyLoaded \? "some loaded" : "all unloaded"\}/);
  assert.match(pane, /if \(group\.collapsed\) \{[\s\S]*?header\.append\(countBadge\([\s\S]*?group\.tabIds\.length,[\s\S]*?loadState === "unloaded" \? "unloaded" : "loaded"/);
  assert.match(pane, /function syncSelectionState\(\)[\s\S]*?row\.setAttribute\("aria-selected"/);
  assert.doesNotMatch(pane, /pendingFocusId = tab\.logicalId;\s*render\(currentView\);/);
  assert.match(pane, /isIconsOnly\(\) && childCount > 0 && tab\.active[\s\S]*?onSetTreeCollapsed\(tab\.logicalId, !tab\.collapsed\)/);
  // An untitled group shows no label. A placeholder here put a stray word next
  // to the count on every new folder, which is what the user saw as "New".
  assert.match(pane, /label\.textContent = group\.title;/);
  assert.doesNotMatch(pane, /label\.textContent = group\.title \|\|/);
  // The name must survive for assistive technology on both the header and its
  // actions button, since neither has visible text to fall back on.
  assert.match(pane, /\$\{group\.title \|\| "Unnamed group"\}, \$\{group\.tabIds\.length\} tabs/);
  assert.match(pane, /Actions for \$\{group\.title \|\| "unnamed group"\}/);
  assert.match(pane, /hiddenBranch\.anyLoaded \? "loaded" : "unloaded"/);

  // The rail + and its Sidebar setting.
  assert.match(css, /:root\[data-add-workspace-button="hidden"\] \.workspace-add-item\s*\{\s*display: none;/);
  assert.match(css, /\.workspace-add-icon\s*\{[\s\S]*?mask: url\("\.\.\/assets\/icons\/plus-thin\.svg"\)/);
  assert.match(css, /\.workspace-add-divider::after\s*\{[\s\S]*?border-block-start: 1px solid/);
  assert.match(css, /\[data-content-mode="icons"\] \.tab-group:has\(> \.tab-row\)::before\s*\{[\s\S]*?inset-inline-start: calc\(var\(--group-line-width\) \* -1 - 1px\);/);
});

test("sidebar switch motion is brief, replaceable, and disabled for reduced motion", async () => {
  const sidebarMain = await readFile(
    new URL("../../src/sidebar/main.js", import.meta.url),
    "utf8"
  );
  const sidebarCss = await readFile(
    new URL("../../src/sidebar/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(sidebarMain, /beginSwitchMotion/);
  assert.match(sidebarMain, /switchMotionSequence/);
  assert.match(sidebarMain, /ACKNOWLEDGE_NOTICE/);
  assert.match(sidebarMain, /VIEW_CHANGED/);
  assert.match(sidebarCss, /workspace-switch-in 180ms/);
  assert.match(sidebarCss, /workspace-switch-out 180ms/);
  assert.match(
    sidebarCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;/
  );
});

test("sidebar startup keeps workspace loading independent from optional native drag and theme setup", async () => {
  const sidebarMain = await readFile(
    new URL("../../src/sidebar/main.js", import.meta.url),
    "utf8"
  );

  assert.match(
    sidebarMain,
    /try \{[\s\S]*?nativeTabDropResolver = createNativeTabDropResolver[\s\S]*?await nativeTabDropResolver\.initialize\(\);[\s\S]*?\} catch \{[\s\S]*?nativeTabDropResolver = null;/
  );
  assert.match(
    sidebarMain,
    /try \{[\s\S]*?themeSource = createFirefoxThemeSource[\s\S]*?\} catch \{[\s\S]*?themeSource = null;/
  );
  assert.match(
    sidebarMain,
    /const settingsLoaded = await loadSidebarSettings\(false\);[\s\S]*?await loadWorkspaces\(\);/
  );
  assert.match(
    sidebarMain,
    /initializeSidebar\(\)\.catch\(\(\) => \{[\s\S]*?showError\(WORKSPACE_STATE_ERROR_CODES\.INTERNAL_ERROR\);/
  );
});

test("Middle Mouse unloading, group targets, and hollow folders are wired end to end", async () => {
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [
    pane,
    sidebarMain,
    sidebarCss,
    backgroundMain,
    settingsHtml,
    settingsMain,
    settingsPanel,
    settingsCss,
    manifestText
  ] = await Promise.all([
    read("../../src/sidebar/tab-pane.js"),
    read("../../src/sidebar/main.js"),
    read("../../src/sidebar/styles.css"),
    read("../../src/background/main.js"),
    read("../../src/settings/index.html"),
    read("../../src/settings/main.js"),
    read("../../src/settings/sidebar-panel.js"),
    read("../../src/settings/styles.css"),
    read("../../manifest.json")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(Object.hasOwn(manifest, "commands"), false);

  assert.match(pane, /row\.dataset\.unloadTarget = "tab";/);
  assert.match(pane, /header\.dataset\.groupId = group\.id;\s*header\.dataset\.unloadTarget = "group";/);
  assert.match(sidebarMain, /button\.dataset\.unloadTarget = "workspace";/);
  assert.match(pane, /icon\.dataset\.loadState = loadState === "unloaded" \? "unloaded" : "loaded";/);
  assert.match(pane, /tabs, \$\{GROUP_LOAD_STATE_LABELS\[loadState\]\}/);
  assert.match(pane, /partial: "partly loaded"/);
  assert.match(pane, /function unloadGroupTarget\(target\)[\s\S]*?groupMembers\(group, currentView\.activeTabs\)[\s\S]*?onUnloadTabs\(members\)/);
  assert.match(pane, /label: "Unload group",\s*action: \(\) => onUnloadTabs\(members\)/);
  assert.match(pane, /unloadTarget,\s*unloadGroupTarget,/);

  assert.match(sidebarCss, /\.group-icon::before\s*\{\s*mask-image: url\("\.\.\/assets\/icons\/favicon-group\.svg"\);/);
  assert.match(
    sidebarCss,
    /\.group-icon\[data-load-state="loaded"\]::before\s*\{\s*mask-image: url\("\.\.\/assets\/icons\/favicon-group-filled\.svg"\);/
  );

  assert.match(
    sidebarMain,
    /const middleClickUnload = createMiddleClickUnloadController\(\{\s*isBlocked: [^\n]*\n\s*onUnloadTarget: createUnloadTargetRouter\(\{\s*unloadTab: \(target\) => tabPane\.unloadTarget\(target\),\s*unloadGroup: \(target\) => tabPane\.unloadGroupTarget\(target\),\s*unloadWorkspace,/
  );
  assert.match(sidebarMain, /window\.addEventListener\("pagehide", \(\) => middleClickUnload\.dispose\(\), \{ once: true \}\);/);

  // Unloading has no keybind: no Firefox command, background service, message
  // route, or Settings control remains, and startup drops the retired document.
  for (const source of [sidebarMain, settingsMain, settingsPanel]) {
    assert.doesNotMatch(source, /input[-_]?binding|getPlatformInfo|keybind/i);
  }
  assert.doesNotMatch(backgroundMain, /InputBindingService|input-binding-|commandShortcuts|onCommand/);
  // The retired document's key and removal are owned by retired-storage.js.
  assert.match(backgroundMain, /\["settings-restore-recovery",[\s\S]*?\["retired-storage", \(\) => removeRetiredStorage\(\{ browserApi: browser \}\)\]/);
  assert.doesNotMatch(backgroundMain, /inputBindingsState/);
  assert.doesNotMatch(settingsHtml, /unload-binding|keybind/i);
  assert.doesNotMatch(settingsCss, /keybind/);
});

test("Snapshots exposes the restore batch size and explains unloaded restores", async () => {
  const [html, panel] = await Promise.all([
    readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/snapshots-panel.js", import.meta.url), "utf8")
  ]);
  const snapshotsPanel = html.slice(html.indexOf('<section id="snapshots-panel"'), html.indexOf('<section id="snapshot-viewer-panel"'));
  // The batch size sits in the schedule-and-retention card, and its help keeps
  // the operation tied to unloaded restore work.
  assert.match(
    snapshotsPanel,
    /<p id="snapshots-restore-batch-size-help">Restore this many unloaded tabs at a time\.<\/p>/
  );
  // Both automatic toggles share the automatic card; the schedule, maximum and
  // batch size share the timing card.
  const automaticCard = snapshotsPanel.slice(
    snapshotsPanel.indexOf('aria-labelledby="automatic-snapshots-heading"'),
    snapshotsPanel.indexOf('aria-labelledby="snapshot-schedule-heading"')
  );
  for (const id of ["snapshots-automatic-enabled", "settings-backups-automatic-enabled", "snapshots-test-automatic", "snapshots-schedule-pill"]) {
    assert.match(automaticCard, new RegExp(`id="${id}"`), id);
  }
  const timingCard = snapshotsPanel.slice(
    snapshotsPanel.indexOf('aria-labelledby="snapshot-schedule-heading"'),
    snapshotsPanel.indexOf('id="settings-backups-section"')
  );
  for (const id of ["snapshots-interval-value", "snapshots-interval-unit", "snapshots-retention-count", "snapshots-restore-batch-size"]) {
    assert.match(timingCard, new RegExp(`id="${id}"`), id);
  }
  assert.match(
    snapshotsPanel,
    /<label for="snapshots-restore-batch-size">Tabs reloaded at a time<\/label>[\s\S]*?<p id="snapshots-restore-batch-size-help">Restore this many unloaded tabs at a time\.<\/p>[\s\S]*?id="snapshots-restore-batch-size"[^>]*inputmode="numeric"[^>]*aria-describedby="snapshots-restore-batch-size-help"/
  );
  assert.ok(
    snapshotsPanel.indexOf('id="snapshots-restore-batch-size"') < snapshotsPanel.indexOf('id="settings-backups-section"'),
    "the batch size precedes Settings Backups"
  );
  assert.match(panel, /restoreBatchSize\.value = String\(snapshots\.restoreBatchSize\)/);
  assert.match(
    panel,
    /bindIntegerInput\(\s*restoreBatchSize,\s*\(\) => SNAPSHOT_SETTINGS_LIMITS\.restoreBatchSize,[\s\S]*?updateSettings\(\{ restoreBatchSize: value \}\)/
  );
});

test("the tab pane compacts rows by its own width instead of clipping them", async () => {
  const css = await readFile(new URL("../../src/sidebar/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tab-pane \{\s*container: tab-pane \/ inline-size;/);
  assert.doesNotMatch(css, /@media \(max-width: 240px\)/, "search layout follows the pane, not the viewport");
  assert.match(css, /@container tab-pane \(max-width: 17em\) \{\s*\.tab-search-controls \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  const tier = (width) => {
    const start = css.indexOf(`@container tab-pane (max-width: ${width})`);
    assert.ok(start >= 0, `missing ${width} tier`);
    return css.slice(start, css.indexOf("\n}\n", start));
  };
  assert.match(tier("16em"), /\.tab-menu-button,[\s\S]*?\.group-menu-button \{\s*display: none;/);
  assert.match(tier("16em"), /\.tab-row \{\s*grid-template-columns:\s*var\(--tab-disclosure-size\)\s*var\(--tab-favicon-size\)\s*minmax\(0, 1fr\)\s*auto\s*auto;/);
  assert.match(tier("13em"), /\.tab-group \{[\s\S]*?--group-line-start:/);
  assert.match(tier("9em"), /\.tab-zone \{\s*--tab-disclosure-size: clamp\(/);
  assert.match(tier("9em"), /\.new-tab-label,[\s\S]*?\.undo-sidebar-label \{\s*display: none;/);
  assert.match(css, /--row-indent-step: min\(var\(--tree-indent-size, 16px\), 7cqi\);/);
  assert.match(css, /\.tree-branch-cell \{\s*position: relative;\s*inline-size: var\(--row-indent-step, var\(--tree-indent-size, 16px\)\);/);
  for (const width of ["16em", "13em", "9em"]) {
    assert.doesNotMatch(tier(width).replaceAll(':root:not([data-content-mode="icons"])', ""), /:root|\[data-content-mode="icons"\] \./, `${width} rules stay out of Icons Only`);
  }
});

test("the Snapshot Viewer owns the bookmark import controls and its private-scope note", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");

  const sidebarStart = html.indexOf('<aside class="snapshot-viewer-sidebar"');
  const sidebar = html.slice(sidebarStart, html.indexOf("</aside>", sidebarStart));
  assert.match(sidebar, /id="bookmark-import"[^>]*class="bookmark-import-button btn"/);
  assert.match(sidebar, /id="bookmark-import"[^>]*type="button" aria-label="Import Bookmarks">Bookmarks<\/button>/);
  assert.doesNotMatch(sidebar, /bookmark-import-icon/, "the button carries no icon element");
  assert.match(
    sidebar,
    /id="bookmark-import-private-note"[^>]*hidden>Bookmark import is available in normal windows\./
  );
  assert.match(
    sidebar,
    /id="bookmark-import-file"[^>]*type="file"[^>]*accept="\.html,\.htm,text\/html"/
  );

  assert.match(html, /id="bookmark-import-actions"[^>]*hidden>/);
  assert.match(html, /id="bookmark-import-create"[^>]*>[\s\S]*?New Workspace<\/button>/);
  assert.match(html, /id="bookmark-import-create"[^>]*class="[^"]*snapshot-restore-button/);
  assert.match(html, /<span class="bookmark-import-workspace-icon" aria-hidden="true">/);
  assert.match(html, /id="bookmark-import-cancel"[^>]*>Cancel<\/button>/);
  assert.match(html, /id="bookmark-import-totals"[^>]*aria-live="polite"/);

  assert.match(html, /id="bookmark-import-dialog" class="settings-dialog"/);
  assert.match(html, /id="bookmark-import-dialog-title">Import bookmarks</);
  assert.match(html, /Terminus only reads bookmarks and never changes or deletes them\./);
  assert.match(
    html,
    /id="bookmark-import-firefox-choice"[^>]*>Firefox bookmarks<\/button>[\s\S]*?id="bookmark-import-file-choice"[^>]*>Bookmarks file from another browser<\/button>/
  );
  assert.match(html, /id="bookmark-import-cancel-dialog"[^>]*>Cancel<\/button>/);
});

test("the Import Bookmarks button turns gold on hover and focus and quiets down where it must", async () => {
  const css = await readFile(new URL("../../src/settings/styles.css", import.meta.url), "utf8");

  assert.match(css, /:root\s*\{[\s\S]*?--settings-gold: #d9a441;/);
  // The button sits inside the sidebar's import pair, so a direct-child
  // selector would silently switch the whole gold treatment off.
  assert.doesNotMatch(css, /\.snapshot-viewer-sidebar > \.bookmark-import-button/);
  const goldRule = /\.bookmark-import-button:hover:not\(:disabled\),\n\.snapshot-viewer-sidebar \.bookmark-import-button:focus-visible:not\(:disabled\) \{[^}]*\}/.exec(css);
  assert.ok(goldRule, "hover and focus share one gold rule");
  assert.match(goldRule[0], /border-color: var\(--settings-gold\)/);
  assert.match(goldRule[0], /color: var\(--settings-gold\)/);
  assert.match(goldRule[0], /box-shadow:\s*\n\s*0 0 0 1px var\(--settings-gold\),/);
  assert.doesNotMatch(goldRule[0], /animation/, "focus-visible must not animate");

  assert.match(
    css,
    /\.bookmark-import-button \{[^}]*transition: color 180ms ease, border-color 180ms ease, box-shadow 180ms ease;/
  );
  assert.match(
    css,
    /\.bookmark-import-button:hover:not\(:disabled\) \{\n\s*animation: terminus-gold-pulse 2\.4s ease-in-out infinite;/
  );
  assert.doesNotMatch(css, /bookmark-import-icon/, "the spiral has no styling left");
  assert.doesNotMatch(css, /terminus-portal-spin|portal\.svg/, "no spin rule or artwork survives");
  const pulse = /@keyframes terminus-gold-pulse \{[\s\S]*?\n\}/.exec(css);
  assert.ok(pulse);
  assert.equal([...pulse[0].matchAll(/box-shadow:/g)].length, 2, "the pulse varies the glow only");
  assert.doesNotMatch(pulse[0], /border-color|(?<!box-shadow:\n\s*0 0 0 1px var\(--settings-gold\),\n\s*0 0 \d+px )color:/);

  const reducedMotion = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/.exec(
    css.slice(css.indexOf(".bookmark-import-button"))
  );
  assert.ok(reducedMotion, "the gold button has a reduced-motion block");
  assert.match(reducedMotion[0], /:hover:not\(:disabled\) \{\n\s*animation: none;/);
  assert.doesNotMatch(reducedMotion[0], /--settings-gold/, "reduced motion keeps the gold and glow");

  const forcedColors = css.slice(css.lastIndexOf("@media (forced-colors: active)"));
  assert.match(forcedColors, /\.bookmark-import-button:focus-visible:not\(:disabled\) \{[^}]*border-color: Highlight;/);
  assert.match(forcedColors, /box-shadow: none;/);
  assert.match(forcedColors, /color: ButtonText;/);
  assert.match(forcedColors, /\.bookmark-import-workspace-icon \{\n\s*background: ButtonText;/);
  assert.match(css, /\.bookmark-import-workspace-icon \{[^}]*background: currentColor;/);
  assert.match(css, /\.bookmark-import-workspace-icon \{[^}]*mask: url\("\.\.\/assets\/icons\/workspace\/book-bookmark\.svg"\)/);

  const goldRules = [...css.matchAll(/\.bookmark-import-button[^{]*\{[^}]*var\(--settings-gold\)[^}]*\}/g)];
  assert.ok(goldRules.length > 0);
  for (const [rule] of goldRules) {
    assert.match(rule, /:not\(:disabled\)/, "a disabled button never turns gold");
  }
});

test("bookmark import renders untrusted text without markup and asks for its permission in the click", async () => {
  const view = await readFile(
    new URL("../../src/settings/bookmark-import-view.js", import.meta.url),
    "utf8"
  );
  const client = await readFile(
    new URL("../../src/settings/settings-client.js", import.meta.url),
    "utf8"
  );
  const panel = await readFile(
    new URL("../../src/settings/snapshots-panel.js", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(view, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(view, /\bfetch\s*\(|new Image\(|XMLHttpRequest/);
  assert.match(view, /title\.textContent = bookmarkLabel\(node\)/);
  assert.match(view, /firefoxChoice\.addEventListener\("click"[\s\S]*?client\.requestPermission\(\)/);
  assert.match(client, /permissions\.request\(\{ permissions: BOOKMARK_OPTIONAL_PERMISSIONS \}\)/);
  assert.match(client, /file\.size > BOOKMARK_IMPORT_LIMITS\.maxFileUnits/);

  assert.match(panel, /createBookmarkImportView\(\{/);
  assert.match(panel, /bookmarkImport\.exit\(\{ restore: false \}\)/);
  assert.match(panel, /if \(bookmarkImport\.isActive\(\)\) \{/);
  assert.match(panel, /bookmarkImport\.configureScope\(privateContext\)/);
});

test("the workspace package card sits in the workspaces panel and gates replace", async () => {
  const html = await readFile(new URL("../../src/settings/index.html", import.meta.url), "utf8");
  const panel = html.slice(
    html.indexOf('id="workspaces-panel"'),
    html.indexOf('id="snapshots-panel"')
  );
  // It belongs beside the icon library whose contents it exports, not with the
  // snapshot record libraries.
  assert.match(panel, /id="workspace-package-card"/);
  assert.match(panel, /id="export-workspace-package"/);
  assert.match(panel, /id="import-workspace-package"/);
  // One export now carries the icons too, so the separate save is gone.
  assert.doesNotMatch(panel, /id="save-workspace-icons"|Save icons/);
  assert.match(panel, /id="workspace-package-file"[^>]*accept="\.zip,application\/zip,\.json,application\/json"/);
  assert.match(panel, /<p class="settings-card-kicker">Workspace Export<\/p>/);
  assert.match(panel, /A ZIP file that allows you to move your workspaces with custom icons included\. Great for sharing with friends or saving workspace layouts without including your tabs\./);

  assert.match(panel, /name="workspace-package-mode" value="add" checked/);
  assert.match(panel, /name="workspace-package-mode" value="replace"/);
  assert.match(panel, /Use this setup and keep unmatched workspaces/);
  assert.match(panel, /matching current workspaces will be replaced/);
  assert.doesNotMatch(
    panel,
    /Replace all of my workspaces|I understand my current workspaces will be replaced/
  );
  // Replace never applies on the radio alone.
  assert.match(panel, /id="workspace-package-replace-acknowledged" type="checkbox"/);
  // The zip already holds the icon files, so the import has nothing to offer
  // to save and asks for no Downloads access.
  assert.doesNotMatch(panel, /workspace-package-save-icons/);
  const view = await readFile(new URL("../../src/settings/workspace-package-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(view, /saveIcons|requestDownloadsPermission\(\)[\s\S]{0,80}importSetup/);
  assert.match(view, /pending = \{ document: workspacePackage, preview \}/);
  assert.match(view, /describeDamagedOriginals\(preview\.icons\.damagedOriginals\)/);
  assert.match(view, /normalized \$\{damagedOriginals\.length === 1 \? "icon is" : "icons are"\} still usable/);
  // The file reaches the background as bytes, so a zip survives the trip.
  const client = await readFile(new URL("../../src/settings/settings-client.js", import.meta.url), "utf8");
  assert.match(client, /bytes: new Uint8Array\(await file\.arrayBuffer\(\)\)/);
  assert.doesNotMatch(client, /SAVE_ICONS/);
});

test("overlapping UI reads are guarded so only the newest response can render", async () => {
  const [main, snapshots, customIcons, sidebar] = await Promise.all([
    readFile(new URL("../../src/settings/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/snapshots-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/custom-icons-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8")
  ]);

  assert.match(main, /const generation = \+\+settingsLoadGeneration;[\s\S]*?generation !== settingsLoadGeneration/);
  assert.match(main, /const generation = \+\+workspaceLoadGeneration;[\s\S]*?generation !== workspaceLoadGeneration/);
  assert.match(snapshots, /const generation = \+\+refreshGeneration;[\s\S]*?generation !== refreshGeneration/);
  assert.match(snapshots, /const generation = \+\+snapshotImportGeneration;[\s\S]*?generation !== snapshotImportGeneration/);
  assert.match(snapshots, /const generation = \+\+settingsImportGeneration;[\s\S]*?generation !== settingsImportGeneration/);
  assert.match(customIcons, /const generation = \+\+refreshGeneration;[\s\S]*?generation !== refreshGeneration/);
  assert.match(sidebar, /const sequence = \+\+appearanceRequestSequence;[\s\S]*?sequence !== appearanceRequestSequence/);
  assert.match(sidebar, /const sequence = \+\+containerRequestSequence;[\s\S]*?sequence !== containerRequestSequence/);
  assert.match(sidebar, /const sequence = \+\+customIconRequestSequence;[\s\S]*?sequence !== customIconRequestSequence/);
  assert.match(sidebar, /const sequence = \+\+undoRequestSequence;[\s\S]*?sequence !== undoRequestSequence/);
});

test("Icons Only search, disclosure target, and queued drops keep their contracts", async () => {
  const css = await readFile(new URL("../../src/sidebar/styles.css", import.meta.url), "utf8");
  const sidebarMain = await readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8");
  // An open search hides the tab list and footer only while results show.
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-pane\[data-tab-search-results="true"\] \.tab-list,\s*\[data-content-mode="icons"\] \.tab-pane\[data-tab-search-results="true"\] \.tab-footer \{\s*display: none;/
  );
  assert.doesNotMatch(css, /\[data-tab-search-open="true"\] \.tab-list/);
  assert.match(
    css,
    /\[data-content-mode="icons"\] \.tab-disclosure:not\(:disabled\)::before \{[\s\S]*?inline-size: 18px;\s*block-size: 18px;/
  );
  assert.match(css, /\[data-content-mode="icons"\] \.tab-disclosure:disabled \{\s*pointer-events: none;/);
  assert.match(css, /\.drop-before::before,\s*\.drop-after::after \{[\s\S]*?inset-inline: var\(--drop-indent, 2px\) 2px;/);
  assert.match(sidebarMain, /onDropTabs: \(sources, destination\) => enqueueDrop\(/);
  assert.match(sidebarMain, /onDropGroup: \(source, destination\) => enqueueDrop\(/);
});

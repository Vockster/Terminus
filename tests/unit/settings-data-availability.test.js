import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SETTINGS_DATA_STATES,
  createSettingsDataGate
} from "../../src/settings/data-availability.js";
import {
  restoreIssueLabel,
  settingsRestoreReportSummary
} from "../../src/settings/snapshots-panel.js";
import { createFakeDocument } from "../helpers/fake-dom.js";

function gateFixture() {
  const document = createFakeDocument();
  const root = document.createElement("html");
  const sidebar = document.createElement("section");
  const appearance = document.createElement("section");
  const workspaces = document.createElement("section");
  const gate = createSettingsDataGate({
    root,
    settingsRegions: [sidebar, appearance],
    workspacesRegion: workspaces
  });
  return { gate, root, sidebar, appearance, workspaces };
}

function editable(region) {
  return region.getAttribute("inert") === null;
}

test("editors stay inert until their saved data has been read", () => {
  const { gate, root, sidebar, appearance, workspaces } = gateFixture();

  assert.equal(root.dataset.settingsData, SETTINGS_DATA_STATES.LOADING);
  for (const region of [sidebar, appearance, workspaces]) {
    assert.equal(editable(region), false);
    assert.equal(region.getAttribute("aria-busy"), "true");
  }

  gate.settingsLoaded();
  assert.equal(editable(sidebar), true);
  assert.equal(editable(appearance), true);
  assert.equal(sidebar.getAttribute("aria-busy"), "false");
  // Workspaces also waits for its own definitions.
  assert.equal(editable(workspaces), false);

  gate.workspacesLoaded();
  assert.equal(editable(workspaces), true);
  assert.equal(workspaces.dataset.workspaceData, SETTINGS_DATA_STATES.READY);
});

test("a failed first read leaves editors unavailable, and a later failure keeps loaded values editable", () => {
  const { gate, root, sidebar, workspaces } = gateFixture();

  assert.equal(gate.settingsFailed(), SETTINGS_DATA_STATES.UNAVAILABLE);
  assert.equal(root.dataset.settingsData, SETTINGS_DATA_STATES.UNAVAILABLE);
  assert.equal(editable(sidebar), false);
  assert.equal(sidebar.getAttribute("aria-busy"), "false");

  assert.equal(gate.workspacesFailed(), SETTINGS_DATA_STATES.UNAVAILABLE);
  assert.equal(workspaces.dataset.settingsData, SETTINGS_DATA_STATES.UNAVAILABLE);

  gate.settingsLoaded();
  gate.workspacesLoaded();
  assert.equal(gate.settingsFailed(), SETTINGS_DATA_STATES.READY);
  assert.equal(gate.workspacesFailed(), SETTINGS_DATA_STATES.READY);
  assert.equal(editable(sidebar), true);
  assert.equal(editable(workspaces), true);
});

test("Settings never renders built-in defaults as saved data before its first read", async () => {
  const [settingsMain, workspacesPanel] = await Promise.all([
    readFile(new URL("../../src/settings/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/settings/workspaces-panel.js", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(settingsMain, /createDefaultWorkspaceState/);
  assert.doesNotMatch(settingsMain, /applySettings\(currentSettings/);
  assert.match(settingsMain, /const settings = await settingsClient\.get\(\);[\s\S]*?applySettings\(settings\);\s*dataGate\.settingsLoaded\(\);/);
  assert.match(settingsMain, /workspacesPanel\.apply\(stateResult\.value\);\s*dataGate\.workspacesLoaded\(\);/);
  assert.match(settingsMain, /workspacesPanel\.showDataMessage\(WORKSPACES_LOADING_MESSAGE\)/);
  assert.match(settingsMain, /#sidebar-panel, #appearance-panel, #snapshots-panel > \.snapshot-section/);
  assert.match(settingsMain, /retryUnavailableData\(\);/);
  assert.match(workspacesPanel, /function showDataMessage\(message\) \{\s*if \(state\) \{\s*return;/);
});

test("the sidebar only sends single warning-preference patches and never a settings document", async () => {
  const sidebarMain = await readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8");
  const updates = [...sidebarMain.matchAll(/type: SETTINGS_MESSAGE_TYPES\.(\w+),?\s*(patch: \{[^\n]*\})?/g)];

  // Two warnings are suppressible from the sidebar: the multi-tab close and the
  // many-tab load. Each sends its own one-field patch.
  assert.deepEqual(
    updates.map(([, type]) => type).sort(),
    ["GET", "UPDATE", "UPDATE"]
  );
  for (const [, type, patch] of updates) {
    if (type === "UPDATE") {
      assert.match(patch, /^patch: \{ sidebar: \{ warnBefore\w+: false \} \}$/);
    }
  }
});

test("settings restore reports name their sections and recovery issues in plain words", () => {
  assert.equal(
    settingsRestoreReportSummary({ status: "complete", sections: ["sidebar", "navigation"] }, "13 Sept"),
    "Completed 13 Sept · Sidebar, Settings page"
  );
  assert.equal(
    settingsRestoreReportSummary({ status: "partial", sections: [] }, "13 Sept"),
    "Partly completed 13 Sept · sections unknown"
  );
  assert.equal(restoreIssueLabel("interrupted-restore-undone"), "Interrupted restore undone");
  assert.equal(restoreIssueLabel("newer-changes-kept"), "Newer changes kept");
  assert.equal(restoreIssueLabel("recovery-record-unreadable"), "Unreadable recovery record removed");
  assert.equal(restoreIssueLabel("tab-tidying-failed"), "Tab tidying failed; Terminus will retry");
  assert.equal(restoreIssueLabel("discard-restore-failed"), "Discard restore failed");
});

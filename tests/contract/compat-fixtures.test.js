import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SETTINGS_BACKUP_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  parseBackupText,
  verifySettingsBackup
} from "../../src/contracts/snapshots.js";
import {
  SETTINGS_STATE_SCHEMA_VERSION,
  createDefaultSettingsState,
  parseSettingsState
} from "../../src/contracts/settings-state.js";
import {
  PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
  parsePrivateDocument,
  parsePrivateDocumentText
} from "../../src/contracts/private-snapshots.js";
import {
  WORKSPACE_STATE_SCHEMA_VERSION,
  migrateWorkspaceStateV1,
  migrateWorkspaceStateV2,
  migrateWorkspaceStateV3,
  migrateWorkspaceStateV4,
  parseWorkspaceState
} from "../../src/contracts/workspace-state.js";
import { isWorkspaceIconId } from "../../src/contracts/workspace-icons.js";
import { WORKSPACE_RUNTIME_SCHEMA_VERSION } from "../../src/contracts/workspace-runtime.js";
import { WorkspacePackageService } from "../../src/core/workspace-package-service.js";
import { WorkspaceRuntimeService } from "../../src/core/workspace-runtime-service.js";

// Every fixture under tests/fixtures/compat/ is a real document produced by a
// historical build's own code (see the version notes on each test). These
// tests pin the promise that the current parser and migration chain keep
// lifting every document an older release ever wrote.

const FIXTURES = new URL("../fixtures/compat/", import.meta.url);
const fixtureText = (name) => readFileSync(new URL(name, FIXTURES), "utf8");
const fixtureJson = (name) => JSON.parse(fixtureText(name));
const fixtureBytes = (name) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));

const WORKSPACE_IDS = ["ws-docs", "ws-mail"];

test("historical workspace state documents lift to the current schema", () => {
  const lifts = {
    1: migrateWorkspaceStateV1,
    2: migrateWorkspaceStateV2,
    3: migrateWorkspaceStateV3,
    4: migrateWorkspaceStateV4,
    5: parseWorkspaceState
  };
  const expectedRails = {
    1: [
      { kind: "workspace", workspaceId: "ws-docs" },
      { kind: "workspace", workspaceId: "ws-mail" }
    ],
    2: [
      { kind: "workspace", workspaceId: "ws-docs" },
      { kind: "divider", id: "spacer-gap", size: null },
      { kind: "workspace", workspaceId: "ws-mail" }
    ],
    3: [
      { kind: "workspace", workspaceId: "ws-docs" },
      { kind: "divider", id: "spacer-gap", size: 24 },
      { kind: "workspace", workspaceId: "ws-mail" }
    ],
    4: [
      { kind: "workspace", workspaceId: "ws-docs" },
      { kind: "divider", id: "divider-main", size: 24 },
      { kind: "workspace", workspaceId: "ws-mail" },
      { kind: "space", id: "space-tail" }
    ]
  };
  expectedRails[5] = expectedRails[4];

  for (const [version, lift] of Object.entries(lifts)) {
    const document = fixtureJson(`workspace-state-v${version}.json`);
    assert.equal(document.schemaVersion, Number(version));

    const lifted = lift(document);

    assert.equal(lifted.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);
    assert.deepEqual(
      lifted.workspaces.map(({ id, name, defaultContainerRef }) => [id, name, defaultContainerRef]),
      [["ws-docs", "Docs", null], ["ws-mail", "Mail", null]]
    );
    assert.deepEqual(lifted.rail, expectedRails[version]);
  }
});

function runtimeStorage(initialValue) {
  let value = initialValue;
  let journal;
  return {
    async read() {
      return value;
    },
    async write(nextValue) {
      value = nextValue;
    },
    async readMigration() {
      return journal;
    },
    async writeMigration(nextJournal) {
      journal = nextJournal;
    },
    async removeMigration() {
      journal = undefined;
    }
  };
}

test("historical workspace runtime documents lift to the current schema", async () => {
  for (const version of [1, 2, 3, 4, 5]) {
    const document = fixtureJson(`workspace-runtime-v${version}.json`);
    assert.equal(document.schemaVersion, version);

    const service = new WorkspaceRuntimeService(runtimeStorage(document));
    const lifted = await service.getOrInitialize(WORKSPACE_IDS);

    assert.equal(lifted.schemaVersion, WORKSPACE_RUNTIME_SCHEMA_VERSION);
    assert.deepEqual(lifted.tabs, [
      { id: "tab-guide", workspaceId: "ws-docs" },
      { id: "tab-wiki", workspaceId: "ws-docs" },
      { id: "tab-notes", workspaceId: "ws-docs" },
      { id: "tab-inbox", workspaceId: "ws-mail" }
    ]);
    assert.equal(lifted.windows.length, 1);
    const window = lifted.windows[0];
    assert.equal(window.id, "window-main");
    assert.equal(window.activeWorkspaceId, "ws-docs");
    assert.equal(window.pendingOperation, null);

    if (version === 1) {
      assert.deepEqual(window.selectedTabs, []);
      assert.deepEqual(window.workspaceLayouts, []);
      continue;
    }
    assert.deepEqual(window.selectedTabs[0], { workspaceId: "ws-docs", tabId: "tab-guide" });
    if (version === 2) {
      assert.deepEqual(window.selectedTabs[1], { workspaceId: "ws-mail", tabId: "tab-inbox" });
      assert.deepEqual(window.workspaceLayouts, []);
      continue;
    }

    // v3 and later carry layouts with pins and groups.
    const layout = window.workspaceLayouts.find(({ workspaceId }) => workspaceId === "ws-docs");
    assert.deepEqual(layout.tabIds, ["tab-guide", "tab-wiki", "tab-notes"]);
    assert.deepEqual(layout.pinnedTabIds, ["tab-guide"]);
    assert.deepEqual(layout.groups, [
      { id: "group-research", title: "Research", color: "blue", collapsed: false, tabIds: ["tab-wiki", "tab-notes"] }
    ]);
    const mail = window.workspaceLayouts.find(({ workspaceId }) => workspaceId === "ws-mail");
    assert.deepEqual(mail.tabIds, ["tab-inbox"]);

    if (version === 3) {
      // The tree is synthesized flat during the lift.
      assert.deepEqual(layout.tree, [
        { tabId: "tab-guide", parentTabId: null, collapsed: false },
        { tabId: "tab-wiki", parentTabId: null, collapsed: false },
        { tabId: "tab-notes", parentTabId: null, collapsed: false }
      ]);
    } else {
      // v4 and v5 recorded a real tree; the parent link must survive.
      assert.deepEqual(
        layout.tree.map(({ tabId, parentTabId }) => [tabId, parentTabId]),
        [["tab-guide", null], ["tab-wiki", null], ["tab-notes", "tab-wiki"]]
      );
    }
    assert.deepEqual(
      layout.splitViews,
      version === 5 ? [{ id: "split-main", tabIds: ["tab-wiki", "tab-notes"] }] : []
    );
  }
});

test("a v2 snapshot file from a pre-container build imports as a current snapshot", async () => {
  const raw = JSON.parse(fixtureText("snapshot-file-v2.json"));
  assert.equal(raw.schemaVersion, 2);
  assert.equal(raw.payload.workspaceState.schemaVersion, 4);

  const { kind, document } = await parseBackupText(fixtureText("snapshot-file-v2.json"));

  assert.equal(kind, "snapshot");
  assert.equal(document.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(document.id, "snapshot-compat-v2");
  assert.equal(document.kind, "manual");
  assert.equal(document.payload.workspaceState.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);
  assert.deepEqual(document.payload.containerCatalog, []);

  const layout = document.payload.windows[0].workspaceLayouts[0];
  assert.deepEqual(
    layout.tabs.map(({ id, url, container }) => [id, url, container.kind]),
    [
      ["tab-guide", "https://example.com/docs", "none"],
      ["tab-wiki", "https://example.org/wiki", "none"],
      ["tab-notes", "https://example.com/notes", "none"]
    ]
  );
  assert.deepEqual(layout.pinnedTabIds, ["tab-guide"]);
  assert.deepEqual(layout.groups[0].tabIds, ["tab-wiki", "tab-notes"]);
  assert.deepEqual(layout.splitViews, [{ id: "split-main", tabIds: ["tab-wiki", "tab-notes"] }]);
});

test("a v3 snapshot file from an older build imports with its container catalog", async () => {
  const raw = JSON.parse(fixtureText("snapshot-file-v3.json"));
  assert.equal(raw.schemaVersion, 3);

  const { kind, document } = await parseBackupText(fixtureText("snapshot-file-v3.json"));

  assert.equal(kind, "snapshot");
  assert.equal(document.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(document.payload.workspaceState.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);
  assert.deepEqual(
    document.payload.workspaceState.workspaces.map(({ id, defaultContainerRef }) => [id, defaultContainerRef]),
    [["ws-docs", "ctr-work"], ["ws-mail", null]]
  );
  assert.deepEqual(document.payload.containerCatalog, [
    {
      refId: "ctr-work",
      descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" }
    }
  ]);
  const layout = document.payload.windows[0].workspaceLayouts[0];
  assert.deepEqual(layout.tabs[0].container, { kind: "container", refId: "ctr-work" });
  assert.deepEqual(
    layout.tree.map(({ tabId, parentTabId }) => [tabId, parentTabId]),
    [["tab-guide", null], ["tab-wiki", null], ["tab-notes", "tab-wiki"]]
  );
});

test("historical settings backup files verify and lift to current settings", async () => {
  for (const version of [4, 17, 26, 27]) {
    const document = fixtureJson(`settings-backup-v${version}.json`);
    assert.equal(document.schemaVersion, version);

    const verified = await verifySettingsBackup(document);

    assert.equal(verified.schemaVersion, SETTINGS_BACKUP_SCHEMA_VERSION);
    const settings = parseSettingsState({
      ...createDefaultSettingsState(),
      ...verified.payload.settings
    });
    assert.equal(settings.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  }
});

function packageService() {
  return new WorkspacePackageService({
    workspaceStateService: {
      getOrInitialize: async () => parseWorkspaceState({
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [
          { id: "ws-existing", name: "Existing", icon: "house", color: "#ffffff", defaultContainerRef: null }
        ],
        rail: [{ kind: "workspace", workspaceId: "ws-existing" }]
      })
    },
    customIconService: { listForExport: async () => ({ icons: [] }) },
    decoder: { measure: async () => ({ width: 128, height: 128 }) },
    normalController: { listSplitViewWorkspaceIds: async () => [] }
  });
}

function assertLegacyPackageDocument(document) {
  const { workspaces, rail } = document.payload.workspaces;
  assert.deepEqual(
    workspaces.map(({ id, icon }) => [id, icon]),
    [
      ["ws-docs", "folder"],
      ["ws-mail", "mail"],
      ["ws-maps", `custom-${"ab".repeat(16)}`]
    ]
  );
  // The retired icon id is preserved as stored and is still recognized.
  assert.equal(isWorkspaceIconId("folder"), true);
  assert.deepEqual(rail, [
    { kind: "workspace", workspaceId: "ws-docs" },
    { kind: "divider", id: "divider-main", size: 24 },
    { kind: "workspace", workspaceId: "ws-mail" },
    { kind: "space", id: "space-tail" },
    { kind: "workspace", workspaceId: "ws-maps" }
  ]);
  assert.deepEqual(
    document.payload.icons.map(({ id, label }) => [id, label]),
    [[`custom-${"ab".repeat(16)}`, "Compass"]]
  );
}

test("a legacy JSON workspace package still reads through the package service", async () => {
  const { document } = await packageService().readFile(fixtureBytes("workspace-package-legacy.json"));
  assert.equal(document.documentType, "sidebars.workspace-package");
  assertLegacyPackageDocument(document);
});

test("a legacy ZIP workspace package still reads through the package service", async () => {
  const { document } = await packageService().readFile(fixtureBytes("workspace-package-legacy.zip"));
  assertLegacyPackageDocument(document);

  // Both fixtures were exported from the same setup, so the two import routes
  // must agree on every workspace and rail entry.
  const { document: json } = await packageService().readFile(fixtureBytes("workspace-package-legacy.json"));
  assert.deepEqual(document.payload.workspaces, json.payload.workspaces);
});

test("a private snapshot embedding workspace schema 4 lifts to the current schema", () => {
  const raw = fixtureJson("private-snapshot-v4.json");
  assert.equal(raw.documentType, PRIVATE_SNAPSHOT_DOCUMENT_TYPE);
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.payload.workspaceState.schemaVersion, 4);

  // parsePrivateDocument lifts the embedded workspace state. The stored
  // payloadDigest was computed by the writing build over the v4 payload, so
  // verification digests the stored bytes while the parsed document carries
  // the lifted payload.
  const document = parsePrivateDocument(raw);

  assert.equal(document.payload.workspaceState.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);
  assert.deepEqual(
    document.payload.workspaceState.workspaces.map(({ id, defaultContainerRef }) => [id, defaultContainerRef]),
    [["ws-docs", null], ["ws-mail", null]]
  );
  assert.deepEqual(
    document.payload.windows[0].workspaceLayouts[0].tabs.map(({ id, url }) => [id, url]),
    [
      ["tab-guide", "https://example.com/docs"],
      ["tab-wiki", "https://example.org/wiki"],
      ["tab-notes", "https://example.com/notes"]
    ]
  );
});

test("a genuine early private export passes verification through the real import route", async () => {
  const raw = fixtureJson("private-snapshot-v4.json");

  // The file route the Viewer uses: text in, verified lifted document out.
  const imported = await parsePrivateDocumentText(JSON.stringify(raw));

  assert.equal(imported.documentType, PRIVATE_SNAPSHOT_DOCUMENT_TYPE);
  assert.equal(imported.payload.workspaceState.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);

  // Integrity still holds: a tampered old payload is refused.
  const tampered = structuredClone(raw);
  tampered.payload.windows[0].workspaceLayouts[0].tabs[0].url = "https://tampered.invalid/";
  await assert.rejects(
    parsePrivateDocumentText(JSON.stringify(tampered)),
    (error) => error.code === "INTEGRITY_FAILED"
  );
});

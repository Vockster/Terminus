import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { WORKSPACE_SCOPES } from "../../src/contracts/workspace-scope.js";
import { createFirefoxSnapshotBrowser } from "../../src/platform/firefox/snapshot-browser.js";
import { createFirefoxWindowScopeRegistry } from "../../src/platform/firefox/window-scope-registry.js";
import { createFirefoxWorkspaceBrowser } from "../../src/platform/firefox/workspace-browser.js";
import {
  PRIVATE_WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY,
  PRIVATE_WORKSPACE_RUNTIME_STORAGE_KEY,
  createFirefoxWorkspaceRuntimeStorage
} from "../../src/platform/firefox/workspace-runtime-storage.js";
import { PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX } from "../../src/contracts/private-snapshots.js";
import { createFirefoxPrivateSnapshotStorage } from "../../src/platform/firefox/private-snapshot-storage.js";

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) { listeners.splice(listeners.indexOf(listener), 1); },
    emit(...args) { for (const listener of [...listeners]) listener(...args); }
  };
}

function scopedBrowser() {
  const windows = new Map([
    [1, { id: 1, incognito: false, type: "normal" }],
    [2, { id: 2, incognito: true, type: "normal" }]
  ]);
  const tabs = new Map([
    [11, { id: 11, windowId: 1, incognito: false, index: 0, title: "Normal" }],
    [22, { id: 22, windowId: 2, incognito: true, index: 0, title: "Private" }]
  ]);
  const calls = [];
  return {
    calls,
    windows,
    api: {
      runtime: {
        getURL(path) { return `moz-extension://sidebars/${path}`; },
        async openOptionsPage() { calls.push(["options"]); }
      },
      windows: {
        onCreated: event(),
        onRemoved: event(),
        async get(id) {
          if (!windows.has(id)) throw new Error("missing");
          return { ...windows.get(id) };
        },
        async getAll() { return [...windows.values()].map((window) => ({ ...window })); },
        async update(id, changes) { calls.push(["window-update", id, changes]); }
      },
      tabs: {
        async get(id) {
          if (!tabs.has(id)) throw new Error("missing");
          return { ...tabs.get(id) };
        },
        async query(query) {
          if (Number.isInteger(query.windowId)) {
            return [...tabs.values()].filter(({ windowId }) => windowId === query.windowId);
          }
          return [];
        },
        async create(options) { calls.push(["tab-create", options]); return { id: 23, ...options, incognito: true }; },
        async update(id, changes) { calls.push(["tab-update", id, changes]); }
      },
      sessions: {},
      tabGroups: {}
    }
  };
}

test("window registry and workspace adapters keep normal and private instances disjoint", async () => {
  const browser = scopedBrowser();
  const registry = createFirefoxWindowScopeRegistry(browser.api);
  registry.start();
  await registry.initialize();
  const normal = createFirefoxWorkspaceBrowser(browser.api, undefined, {
    scope: WORKSPACE_SCOPES.NORMAL,
    windowScopeRegistry: registry
  });
  const privateInstance = createFirefoxWorkspaceBrowser(browser.api, undefined, {
    scope: WORKSPACE_SCOPES.PRIVATE,
    windowScopeRegistry: registry
  });

  assert.deepEqual(await normal.listNormalWindowIds(), [1]);
  assert.deepEqual(await privateInstance.listNormalWindowIds(), [2]);
  assert.deepEqual((await normal.listTabs(1)).map(({ id }) => id), [11]);
  assert.deepEqual((await privateInstance.listTabs(2)).map(({ id }) => id), [22]);
  await assert.rejects(normal.activateTab(22), /outside this workspace scope/);
  await assert.rejects(privateInstance.activateTab(11), /outside this workspace scope/);
  await privateInstance.openSettingsPage(2);
  assert.deepEqual(browser.calls.at(-1), ["tab-create", {
    windowId: 2,
    url: "moz-extension://sidebars/src/settings/index.html",
    active: true
  }]);
  assert.equal(registry.scopeForWindow(1), WORKSPACE_SCOPES.NORMAL);
  assert.equal(registry.scopeForWindow(2), WORKSPACE_SCOPES.PRIVATE);
});

test("private snapshot fallback creation keeps the incognito flag", async () => {
  const calls = [];
  let attempts = 0;
  const adapter = createFirefoxSnapshotBrowser({
    windows: {
      async create(options) {
        calls.push(options);
        attempts += 1;
        if (attempts === 1) throw new Error("geometry rejected");
        return { id: 8, incognito: true };
      }
    },
    tabs: {},
    sessions: {},
    tabGroups: {}
  }, { scope: WORKSPACE_SCOPES.PRIVATE });

  const result = await adapter.createWindow("https://example.invalid/", {
    left: 10, top: 10, width: 1200, height: 800, state: "normal"
  });
  assert.equal(result.geometryApplied, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].incognito, true);
  assert.equal(calls[1].incognito, true);
});

test("private runtime storage owns only its storage.session keys", async () => {
  const calls = [];
  let stored = { unrelated: true };
  const adapter = createFirefoxWorkspaceRuntimeStorage({
    storage: {
      session: {
        async get(key) { return key in stored ? { [key]: stored[key] } : {}; },
        async set(value) { calls.push(["set", value]); stored = { ...stored, ...value }; },
        async remove(keys) {
          calls.push(["remove", keys]);
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
        }
      }
    }
  }, {
    areaName: "session",
    storageKey: PRIVATE_WORKSPACE_RUNTIME_STORAGE_KEY,
    migrationKey: PRIVATE_WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY
  });

  await adapter.write({ schemaVersion: 1 });
  await adapter.writeMigration({ schemaVersion: 1 });
  await adapter.clear();
  assert.deepEqual(calls.at(-1), ["remove", [
    PRIVATE_WORKSPACE_RUNTIME_STORAGE_KEY,
    PRIVATE_WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY
  ]]);
  assert.equal(stored.unrelated, true);
});

test("private snapshot history uses a distinct local-storage namespace", async () => {
  const values = { unrelated: "keep" };
  const local = {
    async get(key) {
      if (key === null) return structuredClone(values);
      return key in values ? { [key]: structuredClone(values[key]) } : {};
    },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(key) { delete values[key]; }
  };
  const storage = createFirefoxPrivateSnapshotStorage({ storage: { local } });
  await storage.writeSnapshotRecord({ id: "private-snapshot-one", documentType: "test" });
  assert.equal(
    values[`${PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX}private-snapshot-one`].documentType,
    "test"
  );
  assert.deepEqual((await storage.listSnapshotRecords()).map(({ id }) => id), [
    "private-snapshot-one"
  ]);
  await storage.removeSnapshotRecord("private-snapshot-one");
  assert.equal(values.unrelated, "keep");
});

test("startup does not recreate private runtime without a private window", async () => {
  const backgroundMain = await readFile(
    new URL("../../src/background/main.js", import.meta.url),
    "utf8"
  );

  assert.match(
    backgroundMain,
    /if \(\(await privateWindowIds\(\)\)\.length > 0\) \{\s*await privateWorkspaceRuntimeService\.getOrInitialize\(await workspaceIds\(\)\);/
  );
  assert.match(
    backgroundMain,
    /requested\.has\(SNAPSHOT_AUTOMATIC_LIBRARIES\.PRIVATE\)[\s\S]*privateSnapshotService\.captureAutomatic\(settings\)/
  );
});

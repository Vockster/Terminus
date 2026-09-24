import test from "node:test";
import assert from "node:assert/strict";

import { createEmptyWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { WORKSPACE_STATE_ERROR_CODES } from "../../src/contracts/workspace-state.js";
import { WorkspaceRuntimeService } from "../../src/core/workspace-runtime-service.js";

const WORKSPACE_IDS = ["ws-default-work", "ws-default-personal"];

function createMemoryStorage(initialValue, initialJournal) {
  let value = initialValue;
  let journal = initialJournal;
  const calls = { read: 0, write: 0, readMigration: 0, writeMigration: 0, removeMigration: 0 };
  return {
    calls,
    value: () => value,
    journal: () => journal,
    storage: {
      async read() {
        calls.read += 1;
        return value;
      },
      async write(nextValue) {
        calls.write += 1;
        value = nextValue;
      },
      async readMigration() {
        calls.readMigration += 1;
        return journal;
      },
      async writeMigration(nextJournal) {
        calls.writeMigration += 1;
        journal = nextJournal;
      },
      async removeMigration() {
        calls.removeMigration += 1;
        journal = undefined;
      }
    }
  };
}

test("missing runtime initializes current empty state and can be saved", async () => {
  const memory = createMemoryStorage(undefined);
  const service = new WorkspaceRuntimeService(memory.storage);

  const runtime = await service.getOrInitialize(WORKSPACE_IDS);
  runtime.tabs.push({ id: "tab-alpha", workspaceId: "ws-default-work" });
  const saved = await service.save(runtime, WORKSPACE_IDS);

  assert.deepEqual(saved, memory.value());
  assert.deepEqual(memory.calls, {
    read: 1,
    write: 2,
    readMigration: 1,
    writeMigration: 0,
    removeMigration: 0
  });
});

test("reset removes all logical layout state without touching unrelated storage and clears migration state", async () => {
  const populated = {
    schemaVersion: 5,
    tabs: [{ id: "tab-alpha", workspaceId: "ws-default-personal" }],
    windows: [
      {
        id: "window-alpha",
        activeWorkspaceId: "ws-default-personal",
        selectedTabs: [{ workspaceId: "ws-default-personal", tabId: "tab-alpha" }],
        workspaceLayouts: [
          {
            workspaceId: "ws-default-personal",
            tabIds: ["tab-alpha"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-alpha", parentTabId: null, collapsed: false }],
            splitViews: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
  const memory = createMemoryStorage(populated, { interrupted: true });
  const service = new WorkspaceRuntimeService(memory.storage);

  const reset = await service.reset(WORKSPACE_IDS);

  assert.deepEqual(reset, createEmptyWorkspaceRuntime());
  assert.deepEqual(memory.value(), createEmptyWorkspaceRuntime());
  assert.equal(memory.journal(), undefined);
  assert.deepEqual(memory.calls, {
    read: 0,
    write: 1,
    readMigration: 0,
    writeMigration: 0,
    removeMigration: 1
  });
});

test("stored v1 runtime migrates through v2 and retains tab and active-workspace identity", async () => {
  const legacy = {
    schemaVersion: 1,
    tabs: [{ id: "tab-alpha", workspaceId: "ws-default-work" }],
    windows: [{ id: "window-alpha", activeWorkspaceId: "ws-default-work" }]
  };
  const memory = createMemoryStorage(legacy);
  const service = new WorkspaceRuntimeService(memory.storage);

  assert.deepEqual(await service.getOrInitialize(WORKSPACE_IDS), {
    schemaVersion: 5,
    tabs: legacy.tabs,
    windows: [
      {
        id: "window-alpha",
        activeWorkspaceId: "ws-default-work",
        selectedTabs: [],
        workspaceLayouts: [],
        pendingOperation: null
      }
    ]
  });
  assert.equal(memory.value().schemaVersion, 5);
  assert.equal(memory.journal(), undefined);
});

test("stored v2 runtime migrates to current without changing selections", async () => {
  const legacy = {
    schemaVersion: 2,
    tabs: [{ id: "tab-alpha", workspaceId: "ws-default-work" }],
    windows: [
      {
        id: "window-alpha",
        activeWorkspaceId: "ws-default-work",
        selectedTabs: [{ workspaceId: "ws-default-work", tabId: "tab-alpha" }]
      }
    ]
  };
  const memory = createMemoryStorage(legacy);
  const service = new WorkspaceRuntimeService(memory.storage);

  assert.deepEqual(await service.getOrInitialize(WORKSPACE_IDS), {
    schemaVersion: 5,
    tabs: legacy.tabs,
    windows: [
      {
        ...legacy.windows[0],
        workspaceLayouts: [],
        pendingOperation: null
      }
    ]
  });
  assert.equal(memory.value().schemaVersion, 5);
  assert.equal(memory.journal(), undefined);
});

test("invalid runtime and storage failures never become silent replacement", async () => {
  const invalidMemory = createMemoryStorage({
    schemaVersion: 3,
    tabs: [],
    windows: [],
    extra: true
  });
  const invalidService = new WorkspaceRuntimeService(invalidMemory.storage);
  await assert.rejects(
    invalidService.getOrInitialize(WORKSPACE_IDS),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.equal(invalidMemory.calls.write, 0);
  assert.equal(invalidMemory.calls.writeMigration, 0);

  const failingService = new WorkspaceRuntimeService({
    async readMigration() {
      throw new Error("synthetic failure");
    },
    async read() {
      assert.fail("canonical read must not follow a journal read failure");
    }
  });
  await assert.rejects(
    failingService.getOrInitialize(WORKSPACE_IDS),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE
  );
});

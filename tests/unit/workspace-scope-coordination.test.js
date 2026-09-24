import test from "node:test";
import assert from "node:assert/strict";

import { parseWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { parseWorkspaceState } from "../../src/contracts/workspace-state.js";
import { WorkspaceController } from "../../src/core/workspace-controller.js";
import {
  WORKSPACE_IMPORT_ERROR_CODES,
  WorkspaceImportError
} from "../../src/core/workspace-import-policy.js";

const CURRENT_STATE = {
  schemaVersion: 5,
  workspaces: [
    { id: "ws-keep", name: "Keep", icon: "briefcase", color: "#336699", defaultContainerRef: null },
    { id: "ws-remove", name: "Remove", icon: "briefcase", color: "#993366", defaultContainerRef: null }
  ],
  rail: [
    { kind: "workspace", workspaceId: "ws-keep" },
    { kind: "workspace", workspaceId: "ws-remove" }
  ]
};

const NEXT_STATE = {
  schemaVersion: 5,
  workspaces: [CURRENT_STATE.workspaces[0]],
  rail: [CURRENT_STATE.rail[0]]
};

test("a peer scope remaps removed definitions before shared state replacement and can roll back", async () => {
  let runtime = {
    schemaVersion: 5,
    tabs: [{ id: "tab-private", workspaceId: "ws-remove" }],
    windows: [{
      id: "window-private",
      activeWorkspaceId: "ws-remove",
      selectedTabs: [{ workspaceId: "ws-remove", tabId: "tab-private" }],
      workspaceLayouts: [
        {
          workspaceId: "ws-keep",
          tabIds: [],
          pinnedTabIds: [],
          groups: [],
          tree: [],
          splitViews: []
        },
        {
          workspaceId: "ws-remove",
          tabIds: ["tab-private"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-private", parentTabId: null, collapsed: false }],
          splitViews: []
        }
      ],
      pendingOperation: null
    }]
  };
  const controller = new WorkspaceController({
    browserAdapter: { async listNormalWindowIds() { return []; } },
    stateService: { async getOrInitialize() { return parseWorkspaceState(CURRENT_STATE); } },
    runtimeService: {
      async getOrInitialize(workspaceIds) { return parseWorkspaceRuntime(runtime, workspaceIds); },
      async save(nextRuntime, workspaceIds) {
        runtime = parseWorkspaceRuntime(nextRuntime, workspaceIds);
        return parseWorkspaceRuntime(runtime, workspaceIds);
      }
    }
  });

  const token = await controller.prepareWorkspaceStateReplacement(NEXT_STATE);
  assert.deepEqual(runtime.tabs, [{ id: "tab-private", workspaceId: "ws-keep" }]);
  assert.equal(runtime.windows[0].activeWorkspaceId, "ws-keep");
  assert.deepEqual(runtime.windows[0].workspaceLayouts.map(({ workspaceId }) => workspaceId), [
    "ws-keep"
  ]);
  await controller.restorePreparedWorkspaceState(token);
  assert.deepEqual(runtime.tabs, [{ id: "tab-private", workspaceId: "ws-remove" }]);
  assert.equal(runtime.windows[0].activeWorkspaceId, "ws-remove");
});

test("an explicit replacement map keeps tabs and groups in their own destination workspaces", async () => {
  const currentState = parseWorkspaceState({
    schemaVersion: 5,
    workspaces: [
      { id: "ws-a", name: "A", icon: "house", color: "#111111", defaultContainerRef: null },
      { id: "ws-b", name: "B", icon: "user", color: "#222222", defaultContainerRef: null }
    ],
    rail: [
      { kind: "workspace", workspaceId: "ws-a" },
      { kind: "workspace", workspaceId: "ws-b" }
    ]
  });
  const nextState = parseWorkspaceState({
    schemaVersion: 5,
    workspaces: [
      { id: "ws-new-a", name: "A", icon: "house", color: "#111111", defaultContainerRef: null },
      { id: "ws-new-b", name: "B", icon: "user", color: "#222222", defaultContainerRef: null }
    ],
    rail: [
      { kind: "workspace", workspaceId: "ws-new-a" },
      { kind: "workspace", workspaceId: "ws-new-b" }
    ]
  });
  let runtime = parseWorkspaceRuntime({
    schemaVersion: 5,
    tabs: [
      { id: "tab-a-one", workspaceId: "ws-a" },
      { id: "tab-a-two", workspaceId: "ws-a" },
      { id: "tab-b", workspaceId: "ws-b" }
    ],
    windows: [{
      id: "window-normal",
      activeWorkspaceId: "ws-b",
      selectedTabs: [
        { workspaceId: "ws-a", tabId: "tab-a-one" },
        { workspaceId: "ws-b", tabId: "tab-b" }
      ],
      workspaceLayouts: [
        {
          workspaceId: "ws-a",
          tabIds: ["tab-a-one", "tab-a-two"],
          pinnedTabIds: [],
          groups: [{
            id: "group-a",
            title: "A group",
            color: "blue",
            collapsed: false,
            tabIds: ["tab-a-one", "tab-a-two"]
          }],
          tree: [
            { tabId: "tab-a-one", parentTabId: null, collapsed: false },
            { tabId: "tab-a-two", parentTabId: null, collapsed: false }
          ],
          splitViews: []
        },
        {
          workspaceId: "ws-b",
          tabIds: ["tab-b"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-b", parentTabId: null, collapsed: false }],
          splitViews: []
        }
      ],
      pendingOperation: null
    }]
  }, ["ws-a", "ws-b"]);
  const controller = new WorkspaceController({
    browserAdapter: { async listNormalWindowIds() { return []; } },
    stateService: { async getOrInitialize() { return currentState; } },
    runtimeService: {
      async getOrInitialize() { return runtime; },
      async save(nextRuntime, workspaceIds) {
        runtime = parseWorkspaceRuntime(nextRuntime, workspaceIds);
        return runtime;
      }
    }
  });

  await controller.prepareWorkspaceStateReplacement(nextState, {
    workspaceIdMap: new Map([["ws-a", "ws-new-a"], ["ws-b", "ws-new-b"]])
  });

  assert.deepEqual(runtime.tabs, [
    { id: "tab-a-one", workspaceId: "ws-new-a" },
    { id: "tab-a-two", workspaceId: "ws-new-a" },
    { id: "tab-b", workspaceId: "ws-new-b" }
  ]);
  assert.equal(runtime.windows[0].activeWorkspaceId, "ws-new-b");
  assert.deepEqual(
    runtime.windows[0].workspaceLayouts.map(({ workspaceId }) => workspaceId),
    ["ws-new-a", "ws-new-b"]
  );
  assert.deepEqual(runtime.windows[0].workspaceLayouts[0].groups[0].tabIds, [
    "tab-a-one",
    "tab-a-two"
  ]);
});

test("an unresolved or many-to-one explicit replacement map fails before runtime mutation", async () => {
  let saveCount = 0;
  const controller = new WorkspaceController({
    browserAdapter: { async listNormalWindowIds() { return []; } },
    stateService: { async getOrInitialize() { return parseWorkspaceState(CURRENT_STATE); } },
    runtimeService: {
      async getOrInitialize() { throw new Error("runtime must not be read"); },
      async save() { saveCount += 1; }
    }
  });

  await assert.rejects(
    controller.prepareWorkspaceStateReplacement(NEXT_STATE, {
      workspaceIdMap: new Map([["ws-remove", "ws-missing"]])
    }),
    (error) => error instanceof WorkspaceImportError &&
      error.code === WORKSPACE_IMPORT_ERROR_CODES.UNRESOLVED_ASSOCIATION
  );
  assert.equal(saveCount, 0);
});

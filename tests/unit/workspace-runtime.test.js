import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_STATE_ERROR_CODES,
  WorkspaceStateError
} from "../../src/contracts/workspace-state.js";
import {
  WORKSPACE_RUNTIME_SCHEMA_VERSION,
  WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
  WORKSPACE_PENDING_OPERATION_KINDS,
  createEmptyWorkspaceRuntime,
  migrateWorkspaceRuntimeV1ToV2,
  migrateWorkspaceRuntimeV2ToV3,
  migrateWorkspaceRuntimeV3ToV4,
  migrateWorkspaceRuntimeV4ToV5,
  parseWorkspaceRuntime,
  parseWorkspaceRuntimeV1,
  parseWorkspaceRuntimeV2,
  parseWorkspaceRuntimeV4
} from "../../src/contracts/workspace-runtime.js";

const WORKSPACE_IDS = ["ws-default-work", "ws-default-personal"];

function expectCode(expectedCode) {
  return (error) => {
    assert.ok(error instanceof WorkspaceStateError);
    assert.equal(error.code, expectedCode);
    return true;
  };
}

function validRuntime() {
  return {
    schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
    tabs: [
      { id: "tab-alpha", workspaceId: "ws-default-work" },
      { id: "tab-beta", workspaceId: "ws-default-work" },
      { id: "tab-gamma", workspaceId: "ws-default-personal" }
    ],
    windows: [
      {
        id: "window-alpha",
        activeWorkspaceId: "ws-default-personal",
        selectedTabs: [
          { workspaceId: "ws-default-work", tabId: "tab-alpha" },
          { workspaceId: "ws-default-personal", tabId: "tab-gamma" }
        ],
        workspaceLayouts: [
          {
            workspaceId: "ws-default-work",
            tabIds: ["tab-alpha", "tab-beta"],
            pinnedTabIds: ["tab-alpha"],
            groups: [
              {
                id: "group-alpha",
                title: "Research",
                color: "purple",
                collapsed: true,
                tabIds: ["tab-beta"]
              }
            ],
            tree: [
              { tabId: "tab-alpha", parentTabId: null, collapsed: false },
              { tabId: "tab-beta", parentTabId: null, collapsed: false }
            ],
            splitViews: []
          },
          {
            workspaceId: "ws-default-personal",
            tabIds: ["tab-gamma"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-gamma", parentTabId: null, collapsed: false }],
            splitViews: []
          }
        ],
        pendingOperation: {
          id: "operation-alpha",
          kind: WORKSPACE_PENDING_OPERATION_KINDS.ACTIVATE
        }
      }
    ]
  };
}

test("workspace runtime returns a defensive validated current copy", () => {
  const source = validRuntime();
  const parsed = parseWorkspaceRuntime(source, WORKSPACE_IDS);

  assert.deepEqual(parsed, source);
  assert.notStrictEqual(parsed.tabs[0], source.tabs[0]);
  assert.notStrictEqual(parsed.windows[0], source.windows[0]);
  assert.notStrictEqual(parsed.windows[0].selectedTabs[0], source.windows[0].selectedTabs[0]);
  assert.notStrictEqual(parsed.windows[0].workspaceLayouts[0], source.windows[0].workspaceLayouts[0]);
  assert.notStrictEqual(
    parsed.windows[0].workspaceLayouts[0].groups[0],
    source.windows[0].workspaceLayouts[0].groups[0]
  );
  assert.notStrictEqual(parsed.windows[0].pendingOperation, source.windows[0].pendingOperation);

  parsed.windows[0].workspaceLayouts[0].groups[0].tabIds[0] = "tab-alpha";
  assert.equal(source.windows[0].workspaceLayouts[0].groups[0].tabIds[0], "tab-beta");
});

test("empty current runtime is deterministic and valid", () => {
  assert.deepEqual(parseWorkspaceRuntime(createEmptyWorkspaceRuntime(), WORKSPACE_IDS), {
    schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
    tabs: [],
    windows: []
  });
});

test("strict v1 through v5 migration preserves assignments and selections", () => {
  const v1 = {
    schemaVersion: 1,
    tabs: [{ id: "tab-alpha", workspaceId: "ws-default-work" }],
    windows: [{ id: "window-alpha", activeWorkspaceId: "ws-default-work" }]
  };
  const v2 = {
    schemaVersion: 2,
    tabs: v1.tabs,
    windows: [
      {
        id: "window-alpha",
        activeWorkspaceId: "ws-default-work",
        selectedTabs: []
      }
    ]
  };

  assert.deepEqual(parseWorkspaceRuntimeV1(v1, WORKSPACE_IDS), v1);
  assert.deepEqual(migrateWorkspaceRuntimeV1ToV2(v1, WORKSPACE_IDS), v2);
  assert.deepEqual(parseWorkspaceRuntimeV2(v2, WORKSPACE_IDS), v2);
  const v3 = {
    schemaVersion: 3,
    tabs: v2.tabs,
    windows: [
      {
        ...v2.windows[0],
        workspaceLayouts: [],
        pendingOperation: null
      }
    ]
  };
  assert.deepEqual(migrateWorkspaceRuntimeV2ToV3(v2, WORKSPACE_IDS), v3);
  const v4 = {
    schemaVersion: WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
    tabs: v2.tabs,
    windows: [{ ...v3.windows[0], workspaceLayouts: [] }]
  };
  assert.deepEqual(migrateWorkspaceRuntimeV3ToV4(v3, WORKSPACE_IDS), v4);
  assert.deepEqual(parseWorkspaceRuntimeV4(v4, WORKSPACE_IDS), v4);
  assert.deepEqual(migrateWorkspaceRuntimeV4ToV5(v4, WORKSPACE_IDS), {
    schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
    tabs: v2.tabs,
    windows: [{ ...v3.windows[0], workspaceLayouts: [] }]
  });
});

test("runtime rejects duplicate IDs, unknown workspaces, old current input, and future schemas", () => {
  const duplicate = validRuntime();
  duplicate.tabs[1].id = duplicate.tabs[0].id;
  assert.throws(
    () => parseWorkspaceRuntime(duplicate, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const unknown = validRuntime();
  unknown.tabs[0].workspaceId = "ws-missing";
  assert.throws(
    () => parseWorkspaceRuntime(unknown, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  assert.throws(
    () => parseWorkspaceRuntime({ schemaVersion: 2, tabs: [], windows: [] }, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
  assert.throws(
    () => parseWorkspaceRuntime({ schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION + 1, tabs: [], windows: [] }, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION)
  );
});

test("runtime rejects invalid selections, layouts, pins, and groups", () => {
  const duplicateWorkspace = validRuntime();
  duplicateWorkspace.windows[0].selectedTabs.push({
    workspaceId: "ws-default-work",
    tabId: "tab-alpha"
  });
  assert.throws(
    () => parseWorkspaceRuntime(duplicateWorkspace, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const crossWorkspaceLayout = validRuntime();
  crossWorkspaceLayout.windows[0].workspaceLayouts[0].tabIds.push("tab-gamma");
  assert.throws(
    () => parseWorkspaceRuntime(crossWorkspaceLayout, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const missingLayoutPin = validRuntime();
  missingLayoutPin.windows[0].workspaceLayouts[0].tabIds.shift();
  assert.throws(
    () => parseWorkspaceRuntime(missingLayoutPin, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const pinnedGroupMember = validRuntime();
  pinnedGroupMember.windows[0].workspaceLayouts[0].pinnedTabIds.push("tab-beta");
  assert.throws(
    () => parseWorkspaceRuntime(pinnedGroupMember, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  for (const mutate of [
    (runtime) => { runtime.windows[0].workspaceLayouts[0].groups[0].id = "bad"; },
    (runtime) => { runtime.windows[0].workspaceLayouts[0].groups[0].color = "teal"; },
    (runtime) => { runtime.windows[0].workspaceLayouts[0].groups[0].collapsed = "yes"; },
    (runtime) => { runtime.windows[0].workspaceLayouts[0].groups[0].tabIds = []; }
  ]) {
    const runtime = validRuntime();
    mutate(runtime);
    assert.throws(
      () => parseWorkspaceRuntime(runtime, WORKSPACE_IDS),
      expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
    );
  }
});

test("runtime rejects repeated tab placement, group identity, and pending operation identity", () => {
  const secondWindow = {
    id: "window-beta",
    activeWorkspaceId: "ws-default-personal",
    selectedTabs: [],
    workspaceLayouts: [],
    pendingOperation: null
  };

  const duplicatePlacement = validRuntime();
  duplicatePlacement.windows.push({
    ...secondWindow,
    workspaceLayouts: [
      {
        workspaceId: "ws-default-work",
        tabIds: ["tab-alpha"],
        pinnedTabIds: [],
        groups: [],
        tree: [{ tabId: "tab-alpha", parentTabId: null, collapsed: false }],
        splitViews: []
      }
    ]
  });
  assert.throws(
    () => parseWorkspaceRuntime(duplicatePlacement, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const duplicateGroup = validRuntime();
  duplicateGroup.tabs.push({ id: "tab-delta", workspaceId: "ws-default-personal" });
  duplicateGroup.windows[0].workspaceLayouts[1].tabIds.push("tab-delta");
  duplicateGroup.windows[0].workspaceLayouts[1].groups.push({
    id: "group-alpha",
    title: "Duplicate",
    color: "blue",
    collapsed: false,
    tabIds: ["tab-delta"]
  });
  assert.throws(
    () => parseWorkspaceRuntime(duplicateGroup, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const duplicateOperation = validRuntime();
  duplicateOperation.windows.push({
    ...secondWindow,
    pendingOperation: {
      id: duplicateOperation.windows[0].pendingOperation.id,
      kind: WORKSPACE_PENDING_OPERATION_KINDS.MOVE_TAB
    }
  });
  assert.throws(
    () => parseWorkspaceRuntime(duplicateOperation, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
});

test("runtime permits stored tabs without a currently observed layout", () => {
  const source = validRuntime();
  source.windows[0].workspaceLayouts[0].tabIds = [];
  source.windows[0].workspaceLayouts[0].pinnedTabIds = [];
  source.windows[0].workspaceLayouts[0].groups = [];
  source.windows[0].workspaceLayouts[0].tree = [];
  source.windows[0].workspaceLayouts[0].splitViews = [];

  assert.deepEqual(parseWorkspaceRuntime(source, WORKSPACE_IDS), source);
});

test("runtime tree validation rejects membership, ordering, boundaries, and excessive depth", () => {
  const missingNode = validRuntime();
  missingNode.windows[0].workspaceLayouts[0].tree.pop();
  assert.throws(
    () => parseWorkspaceRuntime(missingNode, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const futureParent = validRuntime();
  futureParent.windows[0].workspaceLayouts[0].tree[0].parentTabId = "tab-beta";
  assert.throws(
    () => parseWorkspaceRuntime(futureParent, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const crossedGroup = validRuntime();
  crossedGroup.windows[0].workspaceLayouts[0].tree[1].parentTabId = "tab-alpha";
  crossedGroup.windows[0].workspaceLayouts[0].tree[1].collapsed = true;
  assert.throws(
    () => parseWorkspaceRuntime(crossedGroup, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const ids = Array.from({ length: 34 }, (_, index) => `tab-${index}`);
  const tooDeep = {
    schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
    tabs: ids.map((id) => ({ id, workspaceId: WORKSPACE_IDS[0] })),
    windows: [{
      id: "window-deep",
      activeWorkspaceId: WORKSPACE_IDS[0],
      selectedTabs: [],
      workspaceLayouts: [{
        workspaceId: WORKSPACE_IDS[0],
        tabIds: ids,
        pinnedTabIds: [],
        groups: [],
        tree: ids.map((tabId, index) => ({
          tabId,
          parentTabId: index === 0 ? null : ids[index - 1],
          collapsed: false
        })),
        splitViews: []
      }],
      pendingOperation: null
    }]
  };
  assert.throws(
    () => parseWorkspaceRuntime(tooDeep, WORKSPACE_IDS),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
});

test("runtime split views require one adjacent unpinned pair in one group partition", () => {
  const valid = validRuntime();
  valid.windows[0].workspaceLayouts[0].pinnedTabIds = [];
  valid.windows[0].workspaceLayouts[0].groups = [{
    id: "group-alpha",
    title: "Research",
    color: "purple",
    collapsed: true,
    tabIds: ["tab-alpha", "tab-beta"]
  }];
  valid.windows[0].workspaceLayouts[0].splitViews = [{
    id: "split-alpha",
    tabIds: ["tab-alpha", "tab-beta"]
  }];
  assert.deepEqual(parseWorkspaceRuntime(valid, WORKSPACE_IDS), valid);

  for (const mutate of [
    (runtime) => { runtime.windows[0].workspaceLayouts[0].splitViews[0].tabIds.pop(); },
    (runtime) => { runtime.windows[0].workspaceLayouts[0].pinnedTabIds.push("tab-alpha"); },
    (runtime) => { runtime.windows[0].workspaceLayouts[0].groups[0].tabIds.pop(); },
    (runtime) => { runtime.windows[0].workspaceLayouts[0].splitViews[0].id = "bad"; }
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(
      () => parseWorkspaceRuntime(invalid, WORKSPACE_IDS),
      expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
    );
  }
});

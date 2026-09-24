import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_STATE_ERROR_CODES,
  WorkspaceStateError
} from "../../src/contracts/workspace-state.js";
import { WORKSPACE_MESSAGE_TYPES } from "../../src/contracts/workspace-messages.js";
import { SIDEBAR_UNDO_OPERATION_KINDS } from "../../src/contracts/sidebar-undo.js";
import { createWorkspaceMessageHandler } from "../../src/background/workspace-message-handler.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { CONTAINER_ERROR_CODES, ContainerError } from "../../src/contracts/containers.js";

test("known get-state messages return the success envelope", async () => {
  const state = createDefaultWorkspaceState();
  const handler = createWorkspaceMessageHandler({
    async getOrInitialize() {
      return state;
    }
  });

  assert.deepEqual(await handler({ type: WORKSPACE_MESSAGE_TYPES.GET_STATE }), {
    ok: true,
    state
  });
});

test("view, activation, unload, and removal messages delegate workspace work", async () => {
  const state = createDefaultWorkspaceState();
  const calls = [];
  const handler = createWorkspaceMessageHandler(
    { async getOrInitialize() { return state; } },
    {
      async getView(windowId) {
        calls.push(["view", windowId]);
        return { state, activeWorkspaceId: "ws-default-work" };
      },
      async activateWorkspace(windowId, workspaceId) {
        calls.push(["activate", windowId, workspaceId]);
        return { state, activeWorkspaceId: workspaceId };
      },
      async unloadWorkspace(windowId, workspaceId) {
        calls.push(["unload", windowId, workspaceId]);
        return {
          view: { state, activeWorkspaceId: "ws-default-work" },
          outcome: { workspaceId, requestedTabCount: 2 }
        };
      },
      async removeWorkspace(windowId, workspaceId) {
        calls.push(["remove", windowId, workspaceId]);
        return { state, activeWorkspaceId: "ws-default-personal" };
      },
      async openSettings(windowId) {
        calls.push(["openSettings", windowId]);
        return true;
      }
    }
  );

  const viewResponse = await handler({ type: WORKSPACE_MESSAGE_TYPES.GET_VIEW, windowId: 7 });
  const activateResponse = await handler({
    type: WORKSPACE_MESSAGE_TYPES.ACTIVATE,
    windowId: 7,
    workspaceId: "ws-default-personal"
  });
  const unloadResponse = await handler({
    type: WORKSPACE_MESSAGE_TYPES.UNLOAD,
    windowId: 7,
    workspaceId: "ws-default-personal"
  });
  const removeResponse = await handler({
    type: WORKSPACE_MESSAGE_TYPES.REMOVE,
    windowId: 7,
    workspaceId: "ws-default-work"
  });
  const openSettingsResponse = await handler({
    type: WORKSPACE_MESSAGE_TYPES.OPEN_SETTINGS,
    windowId: 8
  });

  assert.equal(viewResponse.ok, true);
  assert.equal(viewResponse.view.activeWorkspaceId, "ws-default-work");
  assert.equal(activateResponse.ok, true);
  assert.equal(activateResponse.view.activeWorkspaceId, "ws-default-personal");
  assert.equal(unloadResponse.ok, true);
  assert.equal(unloadResponse.outcome.requestedTabCount, 2);
  assert.equal(removeResponse.ok, true);
  assert.equal(removeResponse.view.activeWorkspaceId, "ws-default-personal");
  assert.deepEqual(openSettingsResponse, { ok: true, settingsTabReused: true });
  assert.deepEqual(calls, [
    ["view", 7],
    ["activate", 7, "ws-default-personal"],
    ["unload", 7, "ws-default-personal"],
    ["remove", 7, "ws-default-work"],
    ["openSettings", 8]
  ]);
});

test("search index and exact-result activation require a verified sidebar window", async () => {
  const calls = [];
  const sidebarActionCoordinator = {
    isSidebarSender(sender) {
      return sender?.url === "moz-extension://terminus/src/sidebar/index.html";
    },
    async verifySidebarRequest(request) {
      calls.push(["verify", request.windowId]);
      return "normal";
    }
  };
  const index = { tabs: [] };
  const view = { activeWorkspaceId: "ws-default-personal" };
  const handler = createWorkspaceMessageHandler({}, {
    async getSearchIndex(windowId) {
      calls.push(["index", windowId]);
      return index;
    },
    async activateSearchResult(...args) {
      calls.push(["activate-search", ...args]);
      return view;
    }
  }, { sidebarActionCoordinator });
  const sender = { url: "moz-extension://terminus/src/sidebar/index.html" };

  assert.deepEqual(await handler({
    type: WORKSPACE_MESSAGE_TYPES.GET_SEARCH_INDEX,
    windowId: 7
  }, sender), { ok: true, index });
  assert.deepEqual(await handler({
    type: WORKSPACE_MESSAGE_TYPES.ACTIVATE_SEARCH_RESULT,
    windowId: 7,
    workspaceId: "ws-default-personal",
    logicalTabId: "tab-12",
    firefoxTabId: 12
  }, sender), { ok: true, view });
  assert.deepEqual(calls, [
    ["verify", 7],
    ["index", 7],
    ["verify", 7],
    ["activate-search", 7, "ws-default-personal", "tab-12", 12]
  ]);

  const rejected = await handler({
    type: WORKSPACE_MESSAGE_TYPES.GET_SEARCH_INDEX,
    windowId: 7
  }, { url: "moz-extension://terminus/src/settings/index.html" });
  assert.equal(rejected.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
});

test("workspace editing messages delegate exact intent operations", async () => {
  const state = createDefaultWorkspaceState();
  const calls = [];
  const handler = createWorkspaceMessageHandler({
    async getOrInitialize() { return state; },
    async createWorkspace(workspace) { calls.push(["create", workspace]); return state; },
    async updateWorkspace(id, changes) { calls.push(["update", id, changes]); return state; },
    async moveRailEntry(entry, direction) { calls.push(["move", entry, direction]); return state; },
    async placeRailEntry(entry, target, position) {
      calls.push(["place", entry, target, position]);
      return state;
    },
    async addDivider() { calls.push(["addDivider"]); return state; },
    async resizeDivider(id, size) { calls.push(["resizeDivider", id, size]); return state; },
    async removeDivider(id) { calls.push(["removeDivider", id]); return state; },
    async addSpace() { calls.push(["addSpace"]); return state; },
    async removeSpace(id) { calls.push(["removeSpace", id]); return state; }
  });

  await handler({
    type: WORKSPACE_MESSAGE_TYPES.CREATE,
    workspace: { name: "Media", icon: "gamepad", color: "#112233" }
  });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.UPDATE,
    workspaceId: "ws-default-work",
    changes: { name: "Office" }
  });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.MOVE_RAIL_ENTRY,
    entry: { kind: "workspace", id: "ws-default-work" },
    direction: "down"
  });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRY,
    entry: { kind: "workspace", id: "ws-default-work" },
    target: { kind: "workspace", id: "ws-default-personal" },
    position: "after"
  });
  await handler({ type: WORKSPACE_MESSAGE_TYPES.ADD_DIVIDER });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.RESIZE_DIVIDER,
    dividerId: "divider-one",
    size: 36
  });
  await handler({ type: WORKSPACE_MESSAGE_TYPES.REMOVE_DIVIDER, dividerId: "divider-one" });
  await handler({ type: WORKSPACE_MESSAGE_TYPES.ADD_SPACE });
  await handler({ type: WORKSPACE_MESSAGE_TYPES.REMOVE_SPACE, spaceId: "space-one" });

  assert.deepEqual(calls, [
    ["create", { name: "Media", icon: "gamepad", color: "#112233" }],
    ["update", "ws-default-work", { name: "Office" }],
    ["move", { kind: "workspace", id: "ws-default-work" }, "down"],
    [
      "place",
      { kind: "workspace", id: "ws-default-work" },
      { kind: "workspace", id: "ws-default-personal" },
      "after"
    ],
    ["addDivider"],
    ["resizeDivider", "divider-one", 36],
    ["removeDivider", "divider-one"],
    ["addSpace"],
    ["removeSpace", "space-one"]
  ]);
});

test("generic workspace updates cannot bypass container default validation", async () => {
  let updateCalled = false;
  const handler = createWorkspaceMessageHandler({
    async updateWorkspace() {
      updateCalled = true;
      return createDefaultWorkspaceState();
    }
  });
  const response = await handler({
    type: WORKSPACE_MESSAGE_TYPES.UPDATE,
    workspaceId: "ws-default-work",
    changes: { defaultContainerRef: "ctr-unverified" }
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(updateCalled, false);
});

test("settings companion messages derive the tab and window from the sender", async () => {
  const calls = [];
  const handler = createWorkspaceMessageHandler(
    {},
    {
      async ensureSettingsCompanion(windowId, tabId) {
        calls.push([windowId, tabId]);
        return true;
      }
    }
  );

  const response = await handler(
    { type: WORKSPACE_MESSAGE_TYPES.ENSURE_SETTINGS_COMPANION },
    { tab: { id: 11, windowId: 7 } }
  );
  assert.deepEqual(response, { ok: true, companionCreated: true });
  assert.deepEqual(calls, [[7, 11]]);

  const invalid = await handler({ type: WORKSPACE_MESSAGE_TYPES.ENSURE_SETTINGS_COMPANION });
  assert.equal(invalid.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
});

test("sidebar tab, group, and collapse messages delegate exact typed intents", async () => {
  const calls = [];
  const view = { activeWorkspaceId: "ws-default-work" };
  const result = { view, outcome: { operation: "relocate-tabs" } };
  const closeTarget = { kind: "branch", logicalTabId: "tab-one", firefoxTabId: 11 };
  const closeOutcome = { target: closeTarget, status: "applied" };
  const closePreflight = {
    token: "close-one",
    target: closeTarget,
    targetLabel: "Tab one",
    scope: "normal",
    tabCount: 2,
    fingerprint: "close-set-0123456789abcdef"
  };
  const handler = createWorkspaceMessageHandler({}, {
    async activateTab(...args) { calls.push(["activateTab", ...args]); return view; },
    async relocateTabs(...args) { calls.push(["relocateTabs", ...args]); return result; },
    async createTabGroup(...args) { calls.push(["createTabGroup", ...args]); return view; },
    async unloadTabs(...args) { calls.push(["unloadTabs", ...args]); return view; },
    async prepareCloseTabs(...args) {
      calls.push(["prepareCloseTabs", ...args]);
      return closePreflight;
    },
    async closeTabs(...args) {
      calls.push(["closeTabs", ...args]);
      return { view, outcome: closeOutcome, preflight: null };
    },
    async relocateNativeSelection(...args) {
      calls.push(["relocateNativeSelection", ...args]);
      return result;
    },
    async relocateGroup(...args) { calls.push(["relocateGroup", ...args]); return result; },
    async renameGroup(...args) { calls.push(["renameGroup", ...args]); return view; },
    async deleteGroup(...args) { calls.push(["deleteGroup", ...args]); return view; },
    async setTreeCollapsed(...args) { calls.push(["tree", ...args]); return view; },
    async setGroupCollapsed(...args) { calls.push(["group", ...args]); return view; }
  });
  const source = {
    tabId: "tab-one",
    workspaceId: "ws-default-work",
    pinned: false,
    groupId: null,
    parentTabId: null
  };
  const destination = {
    workspaceId: "ws-default-personal",
    zone: "ungrouped",
    relation: "end",
    anchorTabId: null,
    groupId: null,
    parentTabId: null
  };
  const groupSource = {
    groupId: "group-one",
    workspaceId: "ws-default-work",
    tabIds: ["tab-one"]
  };
  const groupDestination = {
    workspaceId: "ws-default-personal",
    relation: "end",
    anchorTabId: null
  };
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.ACTIVATE_TAB,
    windowId: 7,
    logicalTabId: "tab-one",
    firefoxTabId: 11
  })).ok, true);
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.RELOCATE_TABS,
    windowId: 7,
    sources: [source],
    destination
  })).ok, true);
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.CREATE_GROUP,
    windowId: 7,
    logicalTabIds: ["tab-one", "tab-two"]
  })).ok, true);
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.UNLOAD_TABS,
    windowId: 7,
    logicalTabIds: ["tab-one"]
  })).ok, true);
  assert.deepEqual(await handler({
    type: WORKSPACE_MESSAGE_TYPES.PREPARE_CLOSE_TABS,
    windowId: 7,
    target: closeTarget
  }), { ok: true, preflight: closePreflight });
  assert.deepEqual(await handler({
    type: WORKSPACE_MESSAGE_TYPES.CLOSE_TABS,
    windowId: 7,
    token: "close-one"
  }), { ok: true, view, outcome: closeOutcome, preflight: null });
  const nativeTabs = [{ logicalTabId: "tab-one", firefoxTabId: 11 }];
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.RELOCATE_NATIVE_SELECTION,
    windowId: 7,
    tabs: nativeTabs,
    destinationWorkspaceId: "ws-default-personal"
  })).ok, true);
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.RELOCATE_GROUP,
    windowId: 7,
    source: groupSource,
    destination: groupDestination
  })).ok, true);
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.RENAME_GROUP,
    windowId: 7,
    logicalGroupId: "group-one",
    title: "Renamed"
  })).ok, true);
  assert.equal((await handler({
    type: WORKSPACE_MESSAGE_TYPES.DELETE_GROUP,
    windowId: 7,
    logicalGroupId: "group-one"
  })).ok, true);
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.SET_TREE_COLLAPSED,
    windowId: 7,
    logicalTabId: "tab-one",
    collapsed: true
  });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.SET_GROUP_COLLAPSED,
    windowId: 7,
    logicalGroupId: "group-one",
    collapsed: false
  });
  assert.deepEqual(calls, [
    ["activateTab", 7, "tab-one", 11],
    ["relocateTabs", 7, [source], destination, null],
    ["createTabGroup", 7, ["tab-one", "tab-two"], null],
    ["unloadTabs", 7, ["tab-one"], null],
    ["prepareCloseTabs", 7, closeTarget],
    ["closeTabs", 7, "close-one", null],
    [
      "relocateNativeSelection",
      7,
      nativeTabs,
      "ws-default-personal",
      null
    ],
    ["relocateGroup", 7, groupSource, groupDestination, null],
    ["renameGroup", 7, "group-one", "Renamed", null],
    ["deleteGroup", 7, "group-one", null],
    ["tree", 7, "tab-one", true],
    ["group", 7, "group-one", false]
  ]);
  const malformed = await handler({
    type: WORKSPACE_MESSAGE_TYPES.RELOCATE_TABS,
    windowId: 7,
    sources: [source],
    destination,
    extra: true
  });
  assert.equal(malformed.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);

  const malformedRename = await handler({
    type: WORKSPACE_MESSAGE_TYPES.RENAME_GROUP,
    windowId: 7,
    logicalGroupId: "group-one",
    title: "x".repeat(256)
  });
  assert.equal(malformedRename.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);

  for (const tabs of [
    [],
    [{ logicalTabId: "tab-one", firefoxTabId: -1 }],
    [{ logicalTabId: "not-a-tab", firefoxTabId: 11 }],
    [{ logicalTabId: "tab-one", firefoxTabId: 11, extra: true }],
    [
      { logicalTabId: "tab-one", firefoxTabId: 11 },
      { logicalTabId: "tab-one", firefoxTabId: 12 }
    ],
    [
      { logicalTabId: "tab-one", firefoxTabId: 11 },
      { logicalTabId: "tab-two", firefoxTabId: 11 }
    ]
  ]) {
    const invalidNative = await handler({
      type: WORKSPACE_MESSAGE_TYPES.RELOCATE_NATIVE_SELECTION,
      windowId: 7,
      tabs,
      destinationWorkspaceId: "ws-default-personal"
    });
    assert.equal(invalidNative.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
  }
});

test("notice acknowledgement messages delegate exact window and notice identity", async () => {
  const calls = [];
  const handler = createWorkspaceMessageHandler(
    {},
    {
      async acknowledgeNotice(windowId, noticeId) {
        calls.push([windowId, noticeId]);
        return true;
      }
    }
  );

  assert.deepEqual(
    await handler({
      type: WORKSPACE_MESSAGE_TYPES.ACKNOWLEDGE_NOTICE,
      windowId: 7,
      noticeId: "notice-alpha"
    }),
    { ok: true, acknowledged: true }
  );
  assert.deepEqual(calls, [[7, "notice-alpha"]]);
});

test("known state errors return stable safe error envelopes", async () => {
  const handler = createWorkspaceMessageHandler({
    async getOrInitialize() {
      throw new WorkspaceStateError(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE, "private detail");
    }
  });

  const response = await handler({ type: WORKSPACE_MESSAGE_TYPES.GET_STATE });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_STATE);
  assert.doesNotMatch(response.error.message, /private detail/);
});

test("unexpected errors use a generic internal-error envelope", async () => {
  const handler = createWorkspaceMessageHandler({
    async getOrInitialize() {
      throw new Error("synthetic private detail");
    }
  });

  const response = await handler({ type: WORKSPACE_MESSAGE_TYPES.GET_STATE });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR);
  assert.doesNotMatch(response.error.message, /synthetic private detail/);
});

test("unknown and malformed messages remain unhandled", () => {
  const handler = createWorkspaceMessageHandler({
    getOrInitialize() {
      assert.fail("unknown messages must not call the service");
    }
  });

  assert.equal(handler({ type: "unknown" }), undefined);
  assert.equal(handler(null), undefined);
  assert.equal(handler([]), undefined);
});

test("known workspace requests reject unexpected top-level fields", async () => {
  const handler = createWorkspaceMessageHandler({
    async getOrInitialize() { assert.fail("invalid requests must not call the service"); }
  });
  const response = await handler({ type: WORKSPACE_MESSAGE_TYPES.GET_STATE, extra: true });
  assert.equal(response.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
});

test("Flatten branch runs as one undoable sidebar action and rejects malformed targets", async () => {
  const transaction = { finalization: { unavailable: false, applied: true } };
  const calls = [];
  const sidebarActionCoordinator = {
    isSidebarSender(sender) { return sender?.url === "moz-extension://terminus/src/sidebar/index.html"; },
    async createTransaction(metadata) {
      calls.push(["transaction", metadata]);
      return transaction;
    }
  };
  const handler = createWorkspaceMessageHandler({}, {
    async flattenTreeBranch(windowId, tabs, receivedTransaction) {
      calls.push(["flatten", windowId, tabs, receivedTransaction]);
      return { activeWorkspaceId: "ws-default-work" };
    }
  }, { sidebarActionCoordinator });
  const sender = { url: "moz-extension://terminus/src/sidebar/index.html" };
  const one = { logicalTabId: "tab-one", firefoxTabId: 11 };
  const two = { logicalTabId: "tab-two", firefoxTabId: 12 };

  const response = await handler({
    type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH,
    windowId: 7,
    tabs: [one]
  }, sender);

  assert.deepEqual(response, {
    ok: true,
    view: { activeWorkspaceId: "ws-default-work" },
    undoUnavailable: false
  });
  assert.deepEqual(calls[0], ["transaction", {
    sender,
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN,
    label: "Flatten branch"
  }]);
  assert.deepEqual(calls[1], ["flatten", 7, [one], transaction]);

  await handler({
    type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH,
    windowId: 7,
    tabs: [one, two]
  }, sender);
  assert.equal(calls[2][1].label, "Flatten branches");
  assert.deepEqual(calls[3], ["flatten", 7, [one, two], transaction]);

  for (const malformed of [
    { type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH, windowId: 7, tabs: [] },
    { type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH, windowId: 7, ...one },
    { type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH, windowId: 7, tabs: [{ ...one, firefoxTabId: -1 }] },
    { type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH, windowId: 7, tabs: [{ ...one, logicalTabId: 5 }] },
    { type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH, windowId: 7, tabs: [one, one] },
    {
      type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH,
      windowId: 7,
      tabs: Array.from({ length: 4_097 }, (_, index) => ({
        logicalTabId: `tab-${index}`,
        firefoxTabId: index
      }))
    },
    { type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH, windowId: 7, tabs: [one], selection: [] }
  ]) {
    const rejected = await handler(malformed, sender);
    assert.equal(rejected.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
  }
  assert.equal(calls.length, 4);
});

test("verified sidebar mutations receive an internal Undo transaction and expose only availability", async () => {
  const transaction = {
    finalization: { unavailable: true, applied: true }
  };
  const calls = [];
  const sidebarActionCoordinator = {
    isSidebarSender(sender) { return sender?.url === "moz-extension://terminus/src/sidebar/index.html"; },
    async createTransaction(metadata) {
      calls.push(["transaction", metadata]);
      return transaction;
    }
  };
  const handler = createWorkspaceMessageHandler({}, {
    async renameGroup(windowId, logicalGroupId, title, receivedTransaction) {
      calls.push(["rename", windowId, logicalGroupId, title, receivedTransaction]);
      return { activeWorkspaceId: "ws-default-work" };
    }
  }, { sidebarActionCoordinator });
  const response = await handler({
    type: WORKSPACE_MESSAGE_TYPES.RENAME_GROUP,
    windowId: 7,
    logicalGroupId: "group-one",
    title: "Renamed"
  }, { url: "moz-extension://terminus/src/sidebar/index.html" });

  assert.deepEqual(response, {
    ok: true,
    view: { activeWorkspaceId: "ws-default-work" },
    undoUnavailable: true
  });
  assert.equal(calls[1][4], transaction);
  assert.deepEqual(calls[0][1], {
    sender: { url: "moz-extension://terminus/src/sidebar/index.html" },
    windowId: 7,
    operation: "group-rename",
    label: "Rename group"
  });
});

test("Move to container is a sidebar-only undoable action that keeps container errors", async () => {
  const transaction = { finalization: { unavailable: false, applied: true } };
  const calls = [];
  const sidebarUrl = "moz-extension://terminus/src/sidebar/index.html";
  const sidebarActionCoordinator = {
    isSidebarSender(sender) { return sender?.url === sidebarUrl; },
    async createTransaction(metadata) {
      calls.push(["transaction", metadata]);
      return transaction;
    }
  };
  let failure = null;
  const result = {
    view: { activeWorkspaceId: "ws-default-work" },
    outcome: { status: "applied" }
  };
  const handler = createWorkspaceMessageHandler({}, {
    async moveTabsToContainer(windowId, request, receivedTransaction) {
      calls.push(["move", windowId, request, receivedTransaction]);
      if (failure) throw failure;
      return result;
    }
  }, { sidebarActionCoordinator });
  const sender = { url: sidebarUrl };
  const message = {
    type: WORKSPACE_MESSAGE_TYPES.MOVE_TABS_TO_CONTAINER,
    windowId: 7,
    tabs: [{ logicalTabId: "tab-one", firefoxTabId: 11 }],
    assignment: { kind: "container", refId: "ctr-work" }
  };

  assert.deepEqual(await handler(message, sender), { ok: true, ...result, undoUnavailable: false });
  assert.deepEqual(calls[0], ["transaction", {
    sender,
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE,
    label: "Move to container"
  }]);
  assert.deepEqual(calls[1], [
    "move",
    7,
    { tabs: message.tabs, assignment: message.assignment },
    transaction
  ]);

  failure = new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
  const unavailable = await handler(message, sender);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
  failure = new WorkspaceStateError(WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(
    (await handler(message, sender)).error.code,
    WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );

  for (const [rejected, rejectedSender] of [
    [message, { url: "moz-extension://terminus/src/settings/index.html" }],
    [message, undefined],
    [{ ...message, extra: true }, sender],
    [{ ...message, tabs: [] }, sender],
    [{ ...message, tabs: [{ logicalTabId: "tab-one", firefoxTabId: 11, url: "https://example.invalid/" }] }, sender],
    [{ ...message, assignment: { kind: "container", cookieStoreId: "firefox-container-1" } }, sender]
  ]) {
    const response = await handler(rejected, rejectedSender);
    assert.equal(response.error.code, WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST);
  }
  assert.equal(calls.length, 6);
});

test("batch rail messages delegate exactly and reject an added or missing key", async () => {
  const state = createDefaultWorkspaceState();
  const calls = [];
  const handler = createWorkspaceMessageHandler({
    async updateWorkspaces(ids, changes) { calls.push(["updateMany", ids, changes]); return state; },
    async placeRailEntries(entries, target, position) {
      calls.push(["placeMany", entries, target, position]);
      return state;
    },
    async insertRailEntries(insertions) { calls.push(["insertMany", insertions]); return state; },
    async removeRailEntries(entries) { calls.push(["removeMany", entries]); return state; },
    async duplicateWorkspaces(ids, target, position) {
      calls.push(["duplicateMany", ids, target, position]);
      return state;
    }
  });

  const work = { kind: "workspace", id: "ws-default-work" };
  const personal = { kind: "workspace", id: "ws-default-personal" };

  await handler({
    type: WORKSPACE_MESSAGE_TYPES.UPDATE_MANY,
    workspaceIds: ["ws-default-work"],
    changes: { color: "#112233" }
  });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRIES,
    entries: [work],
    target: personal,
    position: "after"
  });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.INSERT_RAIL_ENTRIES,
    insertions: [{ kind: "divider", target: work, position: "before" }]
  });
  await handler({ type: WORKSPACE_MESSAGE_TYPES.REMOVE_RAIL_ENTRIES, entries: [work] });
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.DUPLICATE_WORKSPACES,
    workspaceIds: ["ws-default-work"],
    target: personal,
    position: "after"
  });

  assert.deepEqual(calls, [
    ["updateMany", ["ws-default-work"], { color: "#112233" }],
    ["placeMany", [work], personal, "after"],
    ["insertMany", [{ kind: "divider", target: work, position: "before" }]],
    ["removeMany", [work]],
    ["duplicateMany", ["ws-default-work"], personal, "after"]
  ]);

  // Exact keys: an extra or a missing field is refused before any mutation.
  const refused = [
    { type: WORKSPACE_MESSAGE_TYPES.UPDATE_MANY, workspaceIds: ["ws-default-work"] },
    {
      type: WORKSPACE_MESSAGE_TYPES.UPDATE_MANY,
      workspaceIds: ["ws-default-work"],
      changes: { color: "#112233" },
      windowId: 7
    },
    { type: WORKSPACE_MESSAGE_TYPES.REMOVE_RAIL_ENTRIES },
    { type: WORKSPACE_MESSAGE_TYPES.INSERT_RAIL_ENTRIES, insertions: [], extra: true }
  ];
  for (const message of refused) {
    const response = await handler(message);
    assert.equal(response.ok, false, `${message.type} must refuse an inexact shape`);
  }
  assert.equal(calls.length, 5, "a refused message never reaches the service");
});

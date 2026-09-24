import test from "node:test";
import assert from "node:assert/strict";

import { parseWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { parseWorkspaceState } from "../../src/contracts/workspace-state.js";
import { WorkspaceReconciler } from "../../src/core/workspace-reconciler.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

const WORKSPACE_ID = "ws-default-work";
const OTHER_WORKSPACE_ID = "ws-default-personal";
const WINDOW_ID = 7;

function nativeTab(id, index, overrides = {}) {
  return {
    id,
    windowId: WINDOW_ID,
    index,
    active: id === 11,
    highlighted: id === 11,
    hidden: false,
    pinned: false,
    groupId: -1,
    splitViewId: -1,
    discarded: id !== 11,
    successorTabId: -1,
    ...overrides
  };
}

function layout({ grouped = false } = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    tabIds: ["tab-11", "tab-12"],
    pinnedTabIds: [],
    groups: grouped
      ? [{
          id: "group-one",
          title: "Research",
          color: "blue",
          collapsed: false,
          tabIds: ["tab-11", "tab-12"]
        }]
      : [],
    tree: [
      { tabId: "tab-11", parentTabId: null, collapsed: false },
      { tabId: "tab-12", parentTabId: null, collapsed: false }
    ],
    splitViews: []
  };
}

function runtimeDocument(options = {}) {
  return {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORKSPACE_ID },
      { id: "tab-12", workspaceId: WORKSPACE_ID }
    ],
    windows: [{
      id: "window-7",
      activeWorkspaceId: WORKSPACE_ID,
      selectedTabs: [{ workspaceId: WORKSPACE_ID, tabId: "tab-11" }],
      workspaceLayouts: [layout(options)],
      pendingOperation: null
    }]
  };
}

function createHarness({
  hideEnabled,
  refused = false,
  grouped = false,
  secondTab = {},
  selectedTabId = "tab-11",
  succession = false,
  closeDuringGroupRead = null,
  switchingFromOtherWorkspace = false,
  layoutTabOrder = null
}) {
  const state = parseWorkspaceState(createDefaultWorkspaceState());
  const workspaceIds = state.workspaces.map(({ id }) => id);
  const document = runtimeDocument({ grouped });
  document.windows[0].selectedTabs = [{ workspaceId: WORKSPACE_ID, tabId: selectedTabId }];
  if (layoutTabOrder) {
    const reordered = document.windows[0].workspaceLayouts[0];
    reordered.tabIds = [...layoutTabOrder];
    reordered.tree = layoutTabOrder.map((tabId) =>
      reordered.tree.find((entry) => entry.tabId === tabId)
    );
  }
  if (switchingFromOtherWorkspace) {
    document.tabs.push({ id: "tab-13", workspaceId: OTHER_WORKSPACE_ID });
    document.windows[0].workspaceLayouts.push({
      workspaceId: OTHER_WORKSPACE_ID,
      tabIds: ["tab-13"],
      pinnedTabIds: [],
      groups: [],
      tree: [{ tabId: "tab-13", parentTabId: null, collapsed: false }],
      splitViews: []
    });
    document.windows[0].pendingOperation = { id: "operation-switch", kind: "activate-workspace" };
  }
  let runtime = parseWorkspaceRuntime(document, workspaceIds);
  const tombstones = new Set();
  let tabs = [
    nativeTab(11, 0, {
      ...(grouped ? { groupId: 42 } : {}),
      ...(switchingFromOtherWorkspace ? { active: false, highlighted: false } : {})
    }),
    nativeTab(12, 1, { ...(grouped ? { groupId: 42 } : {}), ...secondTab }),
    ...(switchingFromOtherWorkspace
      ? [nativeTab(13, 2, { active: true, highlighted: true, discarded: false })]
      : [])
  ];
  let groups = grouped
    ? [{ id: 42, windowId: WINDOW_ID, title: "Research", color: "blue", collapsed: false }]
    : [];
  const logicalGroups = new Map(grouped
    ? [[11, "group-one"], [12, "group-one"]]
    : []);
  const calls = [];
  let settingsReads = 0;
  let nextGroupId = 100;
  let uuid = 0;

  const browserAdapter = {
    async listNormalWindowIds() { return [WINDOW_ID]; },
    async getOrCreateWindowIdentity() { return "window-7"; },
    async getWindowIdentity() { return "window-7"; },
    async getOrCreateTabIdentity(tabId) { return `tab-${tabId}`; },
    async getTabLogicalGroupId(tabId) {
      if (tabId === closeDuringGroupRead && !tombstones.has(tabId)) {
        tombstones.add(tabId);
        tabs = tabs.filter(({ id }) => id !== tabId);
      }
      return logicalGroups.get(tabId) ?? null;
    },
    isTabTombstoned(_windowId, tabId) { return tombstones.has(tabId); },
    async setTabLogicalGroupId(tabId, groupId) {
      calls.push(["logical-group", tabId, groupId]);
      logicalGroups.set(tabId, groupId);
    },
    async clearTabLogicalGroupId(tabId) { logicalGroups.delete(tabId); },
    createLogicalGroupId() { return "group-created"; },
    createLogicalSplitViewId() { return "split-created"; },
    async listTabs() { return tabs.map((tab) => ({ ...tab })); },
    async listTabGroups() { return groups.map((group) => ({ ...group })); },
    async getWindowNotice() { return null; },
    async setWindowNotice(_windowId, notice) { calls.push(["notice", notice.convergenceCheck]); },
    async clearWindowNotice() {},
    ...(succession
      ? {
          async moveTabsInSuccession(tabIds, anchorTabId) {
            calls.push(["succession", [...tabIds], anchorTabId]);
            tabIds.forEach((tabId, index) => {
              tabs.find(({ id }) => id === tabId).successorTabId = tabIds[index + 1] ?? anchorTabId;
            });
          }
        }
      : {}),
    async showTabs(tabIds) {
      calls.push(["show", [...tabIds]]);
      for (const tab of tabs.filter(({ id }) => tabIds.includes(id))) {
        tab.hidden = false;
      }
    },
    async activateTab(tabId) {
      calls.push(["activate", tabId]);
      for (const tab of tabs) {
        tab.active = tab.id === tabId;
        tab.highlighted = tab.id === tabId;
      }
      const selected = tabs.find(({ id }) => id === tabId);
      selected.hidden = false;
      selected.discarded = false;
    },
    async setTabPinned(tabId, pinned) {
      calls.push(["pin", tabId, pinned]);
      tabs.find(({ id }) => id === tabId).pinned = pinned;
    },
    async moveTabs(tabIds, options = {}) {
      calls.push(["move", [...tabIds]]);
      if (tabIds.length > 0) {
        const moving = tabIds
          .map((id) => tabs.find((tab) => tab.id === id))
          .filter(Boolean);
        const remaining = tabs.filter((tab) => !tabIds.includes(tab.id));
        const insertAt = Math.min(options.index ?? remaining.length, remaining.length);
        remaining.splice(insertAt, 0, ...moving);
        tabs = remaining;
        tabs.forEach((tab, index) => { tab.index = index; });
      }
      return tabIds.map((id) => ({ ...tabs.find((tab) => tab.id === id) }));
    },
    async ungroupTabs(tabIds) {
      calls.push(["ungroup", [...tabIds]]);
      for (const tab of tabs.filter(({ id }) => tabIds.includes(id))) {
        tab.groupId = -1;
      }
      groups = groups.filter((group) => tabs.some((tab) => tab.groupId === group.id));
    },
    async createTabGroup(tabIds) {
      const groupId = nextGroupId++;
      calls.push(["group", [...tabIds], groupId]);
      for (const tab of tabs.filter(({ id }) => tabIds.includes(id))) {
        tab.groupId = groupId;
      }
      groups.push({
        id: groupId,
        windowId: WINDOW_ID,
        title: "",
        color: "grey",
        collapsed: false
      });
      return groupId;
    },
    async updateTabGroup(groupId, changes) {
      Object.assign(groups.find((group) => group.id === groupId), changes);
    },
    async hideTabs(tabIds) {
      calls.push(["hide", [...tabIds]]);
      if (refused) return [];
      const hiddenIds = [];
      for (const tab of tabs.filter(({ id }) => tabIds.includes(id))) {
        const sharing = tab.sharingState;
        if (
          tab.active !== true &&
          tab.highlighted !== true &&
          tab.pinned !== true &&
          tab.splitViewId === -1 &&
          tab.closing !== true &&
          !(sharing?.camera || sharing?.microphone || sharing?.screen)
        ) {
          tab.hidden = true;
          hiddenIds.push(tab.id);
        }
      }
      return hiddenIds;
    }
  };

  const reconciler = new WorkspaceReconciler({
    browserAdapter,
    runtimeService: {
      async getOrInitialize() { return parseWorkspaceRuntime(runtime, workspaceIds); },
      async save(nextRuntime) {
        runtime = parseWorkspaceRuntime(nextRuntime, workspaceIds);
        return parseWorkspaceRuntime(runtime, workspaceIds);
      }
    },
    settingsService: {
      async getOrInitialize() {
        settingsReads += 1;
        return { sidebar: { hideUnloadedTabsFromFirefox: hideEnabled } };
      }
    },
    stateService: {
      async getOrInitialize() { return parseWorkspaceState(state); }
    },
    createUuid: () => `visibility-${++uuid}`
  });

  return {
    calls,
    reconciler,
    tabs: () => tabs.map((tab) => ({ ...tab })),
    runtime: () => parseWorkspaceRuntime(runtime, workspaceIds),
    settingsReads: () => settingsReads
  };
}

test("reconciliation hides an eligible discarded active-workspace tab after group materialization", async () => {
  const harness = createHarness({ hideEnabled: true, grouped: true });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  const [first, discarded] = harness.tabs();
  assert.equal(first.groupId, discarded.groupId);
  assert.notEqual(discarded.groupId, -1, "hiding must retain native group membership");
  assert.equal(discarded.hidden, true);
  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  const groupCallIndex = harness.calls.findIndex(([name]) => name === "group");
  const activeHideCallIndex = harness.calls.findIndex(
    ([name, tabIds]) => name === "hide" && tabIds.includes(12)
  );
  assert.ok(groupCallIndex >= 0 && groupCallIndex < activeHideCallIndex);
  assert.equal(harness.settingsReads(), 1, "one reconcile must retain one settings snapshot");

  const settledGroupId = discarded.groupId;
  const mutationCount = harness.calls.length;
  await harness.reconciler.reconcile(WINDOW_ID);
  assert.equal(harness.tabs().find(({ id }) => id === 12).groupId, settledGroupId);
  assert.equal(harness.calls.length, mutationCount, "settled hidden group members stay untouched");
  assert.equal(harness.settingsReads(), 2, "each new reconcile reads exactly one fresh snapshot");
});

test("turning the preference off shows a previously hidden active-workspace tab", async () => {
  const harness = createHarness({
    hideEnabled: false,
    secondTab: { hidden: true }
  });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  assert.equal(harness.tabs().find(({ id }) => id === 12).hidden, false);
  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  assert.equal(
    harness.calls.some(([name, tabIds]) => name === "hide" && tabIds.includes(12)),
    false
  );
});

test("a Firefox refusal is observed as visible and does not leave permanent pending work", async () => {
  const harness = createHarness({ hideEnabled: true, refused: true });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  assert.equal(harness.tabs().find(({ id }) => id === 12).hidden, false);
  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  assert.equal(harness.runtime().windows[0].pendingOperation, null);
  assert.deepEqual(
    harness.calls.filter(([name, tabIds]) => name === "hide" && tabIds.includes(12)),
    [["hide", [12]]]
  );
});

test("a protected discarded tab is visible convergence and is never sent to tabs.hide", async () => {
  const harness = createHarness({
    hideEnabled: true,
    secondTab: { sharingState: { camera: true } }
  });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  assert.equal(harness.tabs().find(({ id }) => id === 12).hidden, false);
  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  assert.equal(
    harness.calls.some(([name, tabIds]) => name === "hide" && tabIds.includes(12)),
    false
  );
});

test("a hidden protected tab is shown once and settled visible tabs are not rewritten", async () => {
  const harness = createHarness({
    hideEnabled: true,
    secondTab: { hidden: true, sharingState: { camera: true } }
  });

  await harness.reconciler.reconcile(WINDOW_ID);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "show"),
    [["show", [12]]]
  );
  const mutationCount = harness.calls.length;
  await harness.reconciler.reconcile(WINDOW_ID);
  assert.equal(harness.calls.length, mutationCount);
});

test("a tab that closes while identities are read is dropped from that inventory", async () => {
  const harness = createHarness({ hideEnabled: false, closeDuringGroupRead: 12 });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID, { converge: false });

  assert.deepEqual(inventory.requestedContext.tabs.map(({ id }) => id), [11]);
});

test("switching to a remembered tab that is not first converges without a close-order warning", async () => {
  const harness = createHarness({
    hideEnabled: false,
    selectedTabId: "tab-12",
    succession: true,
    secondTab: { discarded: false },
    switchingFromOtherWorkspace: true
  });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  assert.equal(harness.tabs().find(({ active }) => active).id, 12);
  assert.equal(harness.tabs().find(({ id }) => id === 13).hidden, true);
  assert.deepEqual(
    harness.tabs().map(({ id, successorTabId }) => [id, successorTabId]),
    [[11, 13], [12, 11], [13, -1]]
  );
  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  assert.equal(harness.calls.some(([name]) => name === "notice"), false);
});

test("an unavailable required active tab aborts before any browser materialization", async () => {
  const harness = createHarness({ hideEnabled: true });

  await assert.rejects(
    harness.reconciler.reconcile(WINDOW_ID, {
      requiredActiveTab: {
        workspaceId: WORKSPACE_ID,
        logicalTabId: "tab-11",
        firefoxTabId: 99
      }
    }),
    /required active tab/i
  );

  assert.deepEqual(harness.calls, []);
});

test("a switch into an already-ordered ungrouped workspace skips the whole-workspace moves", async () => {
  const harness = createHarness({ hideEnabled: false, switchingFromOtherWorkspace: true });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  assert.equal(harness.tabs().find(({ id }) => id === 13).hidden, true);
  assert.equal(harness.tabs().find(({ id }) => id === 11).active, true);
  assert.equal(
    harness.calls.some(([name]) => name === "move"),
    false,
    "an observed order that already matches the layout must not be re-moved"
  );
});

test("a switch into a reordered workspace still issues the explicit whole-workspace moves", async () => {
  const harness = createHarness({
    hideEnabled: false,
    switchingFromOtherWorkspace: true,
    layoutTabOrder: ["tab-12", "tab-11"]
  });

  const inventory = await harness.reconciler.reconcile(WINDOW_ID);

  assert.equal(inventory.requestedContext.windowRuntime.pendingOperation, null);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "move").map(([, tabIds]) => tabIds),
    [[], [12, 11]],
    "a layout order differing from the observed order moves the workspace explicitly"
  );
});

test("group materialization skips logical-group session writes that already match", async () => {
  const harness = createHarness({ hideEnabled: true, grouped: true });

  await harness.reconciler.reconcile(WINDOW_ID);

  assert.ok(
    harness.calls.some(([name]) => name === "group"),
    "the native group is still recreated for the converging window"
  );
  assert.equal(
    harness.calls.some(([name]) => name === "logical-group"),
    false,
    "members whose session value already names the logical group are not rewritten"
  );
});

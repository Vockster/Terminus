import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceMessageHandler } from "../../src/background/workspace-message-handler.js";
import { WORKSPACE_MESSAGE_TYPES } from "../../src/contracts/workspace-messages.js";
import { parseWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { WorkspaceController } from "../../src/core/workspace-controller.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import {
  WORKSPACE_GROUP_SESSION_KEY,
  WORKSPACE_NOTICE_SESSION_KEY,
  WORKSPACE_WINDOW_SESSION_KEY,
  createFirefoxWorkspaceBrowser
} from "../../src/platform/firefox/workspace-browser.js";

const WORK_ID = "ws-default-work";
const PERSONAL_ID = "ws-default-personal";

test("unload messages round-trip through the controller and Firefox browser adapter", async () => {
  const state = createDefaultWorkspaceState();
  const workspaceIds = state.workspaces.map(({ id }) => id);
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: WORK_ID },
      { id: "tab-13", workspaceId: PERSONAL_ID }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: PERSONAL_ID,
        selectedTabs: [
          { workspaceId: WORK_ID, tabId: "tab-11" },
          { workspaceId: PERSONAL_ID, tabId: "tab-13" }
        ],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11", "tab-12"],
            pinnedTabIds: [],
            groups: [],
            tree: [
              { tabId: "tab-11", parentTabId: null, collapsed: false },
              { tabId: "tab-12", parentTabId: null, collapsed: false }
            ],
            splitViews: []
          },
          {
            workspaceId: PERSONAL_ID,
            tabIds: ["tab-13"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-13", parentTabId: null, collapsed: false }],
            splitViews: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
  let runtime = parseWorkspaceRuntime(initialRuntime, workspaceIds);
  const calls = [];
  const tabs = [
    {
      id: 11,
      windowId: 7,
      index: 0,
      active: false,
      hidden: false,
      pinned: false,
      discarded: false,
      splitViewId: -1,
      successorTabId: -1
    },
    {
      id: 12,
      windowId: 7,
      index: 1,
      active: false,
      hidden: false,
      pinned: false,
      discarded: false,
      splitViewId: -1,
      successorTabId: -1
    },
    {
      id: 13,
      windowId: 7,
      index: 2,
      active: true,
      hidden: false,
      pinned: false,
      discarded: false,
      splitViewId: -1,
      successorTabId: -1
    }
  ];
  const tabValues = new Map([
    [11, "tab-11"],
    [12, "tab-12"],
    [13, "tab-13"]
  ]);
  const browserApi = {
    windows: {
      async getAll(options) {
        calls.push(["getAll", options]);
        return [{ id: 7 }];
      }
    },
    sessions: {
      async getTabValue(tabId, key) {
        return key === WORKSPACE_GROUP_SESSION_KEY ? undefined : tabValues.get(tabId);
      },
      async setTabValue() {
        assert.fail("known tabs must not receive replacement identities");
      },
      async getWindowValue(_windowId, key) {
        if (key === WORKSPACE_WINDOW_SESSION_KEY) {
          return "window-7";
        }
        if (key === WORKSPACE_NOTICE_SESSION_KEY) {
          return undefined;
        }
        return undefined;
      },
      async setWindowValue() {
        assert.fail("known windows must not receive replacement identities");
      },
      async removeTabValue() {},
      async removeWindowValue() {}
    },
    tabGroups: {
      async query() {
        return [];
      }
    },
    tabs: {
      async query(query) {
        calls.push(["query", query]);
        return tabs
          .filter(({ windowId }) => windowId === query.windowId)
          .map((tab) => ({ ...tab }));
      },
      async hide(tabIds) {
        calls.push(["hide", [...tabIds]]);
        for (const tab of tabs) {
          if (tabIds.includes(tab.id)) {
            tab.hidden = true;
          }
        }
        return [...tabIds];
      },
      async discard(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        calls.push(["discard", [...ids]]);
        for (const tab of tabs.filter(({ id }) => ids.includes(id))) {
          tab.discarded = true;
        }
      },
      async update(tabId, changes) {
        Object.assign(tabs.find(({ id }) => id === tabId), changes);
      },
      async move(tabIds) {
        return tabIds.map((tabId) => ({ ...tabs.find(({ id }) => id === tabId) }));
      },
      async moveInSuccession(tabIds, anchorTabId) {
        tabIds.forEach((tabId, index) => {
          tabs.find(({ id }) => id === tabId).successorTabId =
            tabIds[index + 1] ?? anchorTabId;
        });
      }
    }
  };
  const runtimeService = {
    async getOrInitialize() {
      return parseWorkspaceRuntime(runtime, workspaceIds);
    },
    async save(nextRuntime) {
      runtime = parseWorkspaceRuntime(nextRuntime, workspaceIds);
      return parseWorkspaceRuntime(runtime, workspaceIds);
    }
  };
  const controller = new WorkspaceController({
    stateService: {
      async getOrInitialize() {
        return structuredClone(state);
      }
    },
    runtimeService,
    browserAdapter: createFirefoxWorkspaceBrowser(browserApi)
  });
  const handler = createWorkspaceMessageHandler(
    {
      async getOrInitialize() {
        return structuredClone(state);
      }
    },
    controller
  );

  const response = await handler({
    type: WORKSPACE_MESSAGE_TYPES.UNLOAD,
    windowId: 7,
    workspaceId: WORK_ID
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.outcome, {
    workspaceId: WORK_ID,
    requestedTabCount: 2,
    unpinnedCount: 0,
    remainingPinnedCount: 0,
    ungroupedCount: 0,
    remainingGroupedCount: 0,
    newlyHiddenCount: 2,
    remainingVisibleCount: 0,
    alreadyDiscardedCount: 0,
    newlyDiscardedCount: 2,
    remainingLoadedCount: 0,
    failedDiscardCount: 0,
    switchedWindowCount: 0,
    pendingWindowCount: 0,
    safetyTabCount: 0
  });
  assert.equal(response.view.workspaceTabs[0].loadState, "unloaded");
  assert.deepEqual(runtime, initialRuntime);
  assert.ok(calls.some(([name, options]) =>
    name === "getAll" && options.windowTypes[0] === "normal"
  ));
  assert.deepEqual(calls.filter(([name]) => name === "hide"), [["hide", [11, 12]]]);
  assert.deepEqual(calls.filter(([name]) => name === "discard"), [
    ["discard", [11]],
    ["discard", [12]]
  ]);
});

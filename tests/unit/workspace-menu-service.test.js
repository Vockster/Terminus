import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_MENU_IDS,
  createWorkspaceMenuService
} from "../../src/background/workspace-menu-service.js";
import { WORKSPACE_STATE_ERROR_CODES } from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    listeners
  };
}

function createHarness({ containerService = null } = {}) {
  let state = createDefaultWorkspaceState();
  const calls = [];
  const onShown = createEvent();
  const onClicked = createEvent();
  const controller = {
    async getMoveMenuContext(tabId) {
      calls.push(["context", tabId]);
      return {
        state: structuredClone(state),
        windowId: 7,
        workspaceId: "ws-default-personal",
        logicalGroupId: "group-alpha",
        splitLocked: false,
        groupSplitLocked: false
      };
    },
    async moveTabToWorkspace(tabId, workspaceId) {
      calls.push(["moveTab", tabId, workspaceId]);
    },
    async moveGroupToWorkspace(tabId, workspaceId) {
      calls.push(["moveGroup", tabId, workspaceId]);
    },
    async copyTabToContainer(windowId, tabId, assignment) {
      calls.push(["copy", windowId, tabId, assignment]);
    },
    async reportOperationFailure(windowId, operation) {
      calls.push(["failure", windowId, operation]);
    }
  };
  const browserApi = {
    menus: {
      onShown,
      onClicked,
      create(properties) {
        calls.push(["create", structuredClone(properties)]);
        return properties.id;
      },
      async removeAll() {
        calls.push(["removeAll"]);
      },
      async update(id, properties) {
        calls.push(["update", id, structuredClone(properties)]);
      },
      async refresh() {
        calls.push(["refresh"]);
      }
    }
  };
  const service = createWorkspaceMenuService({
    browserApi,
    controller,
    stateService: {
      async getOrInitialize() {
        return structuredClone(state);
      }
    },
    containerService,
    async onOperationFinished(windowId) {
      calls.push(["finished", windowId]);
    }
  });
  return {
    calls,
    controller,
    service,
    setState(nextState) {
      state = nextState;
    },
    events: { onShown, onClicked }
  };
}

test("native move menus use deterministic rail order and omit spacers", async () => {
  const harness = createHarness();
  harness.service.start();
  await harness.service.synchronize();

  assert.equal(harness.events.onShown.listeners.length, 1);
  assert.equal(harness.events.onClicked.listeners.length, 1);
  const creations = harness.calls.filter(([name]) => name === "create").map(([, value]) => value);
  assert.deepEqual(creations.slice(0, 2).map(({ id }) => id), [
    WORKSPACE_MENU_IDS.MOVE_TAB,
    WORKSPACE_MENU_IDS.MOVE_GROUP
  ]);
  assert.deepEqual(
    creations
      .filter(({ parentId }) => parentId === WORKSPACE_MENU_IDS.MOVE_TAB)
      .map(({ id, title }) => [id, title]),
    [
      ["sidebars-move-tab:ws-default-work", "Work"],
      ["sidebars-move-tab:ws-default-personal", "Personal"],
      ["sidebars-move-tab:ws-default-research", "Research"]
    ]
  );
});

test("menu show refresh exposes group actions and disables the current workspace", async () => {
  const harness = createHarness();
  await harness.service.synchronize();
  harness.calls.length = 0;

  await harness.service.handleShown({ contexts: ["tab"] }, { id: 11, windowId: 7 });

  assert.ok(harness.calls.some(([name, id, properties]) =>
    name === "update" && id === WORKSPACE_MENU_IDS.MOVE_GROUP && properties.visible === true
  ));
  assert.ok(harness.calls.some(([name, id, properties]) =>
    name === "update" &&
    id === "sidebars-move-tab:ws-default-personal" &&
    properties.enabled === false
  ));
  assert.equal(harness.calls.at(-1)[0], "refresh");
});

test("menu synchronization tracks workspace rename and rail reorder", async () => {
  const harness = createHarness();
  await harness.service.synchronize();
  const state = createDefaultWorkspaceState();
  state.workspaces.find(({ id }) => id === "ws-default-research").name = "Study";
  state.rail = [state.rail[2], state.rail[0], state.rail[1]];
  harness.setState(state);
  harness.calls.length = 0;

  await harness.service.synchronize();

  const titles = harness.calls
    .filter(([, value]) => value?.parentId === WORKSPACE_MENU_IDS.MOVE_TAB)
    .map(([, value]) => value.title);
  assert.deepEqual(titles, ["Study", "Work", "Personal"]);
});

test("native move menus stay hidden for split tabs and groups containing them", async () => {
  const harness = createHarness();
  await harness.service.synchronize();
  harness.controller.getMoveMenuContext = async () => ({
    state: createDefaultWorkspaceState(),
    windowId: 7,
    workspaceId: "ws-default-work",
    logicalGroupId: "group-alpha",
    splitLocked: true,
    groupSplitLocked: true
  });
  harness.calls.length = 0;

  await harness.service.handleShown({ contexts: ["tab"] }, { id: 11, windowId: 7 });

  assert.ok(harness.calls.some(([name, id, properties]) =>
    name === "update" && id === WORKSPACE_MENU_IDS.MOVE_TAB && properties.visible === false
  ));
  assert.ok(harness.calls.some(([name, id, properties]) =>
    name === "update" && id === WORKSPACE_MENU_IDS.MOVE_GROUP && properties.visible === false
  ));
  assert.ok(harness.calls
    .filter(([name, id]) => name === "update" && id.includes(":"))
    .every(([, , properties]) => properties.visible === false));
});

test("menu clicks route tab and group moves while stale clicks fail closed", async () => {
  const harness = createHarness();

  await harness.service.handleClicked(
    { menuItemId: "sidebars-move-tab:ws-default-work" },
    { id: 11, windowId: 7 }
  );
  await harness.service.handleClicked(
    { menuItemId: "sidebars-move-group:ws-default-research" },
    { id: 12, windowId: 7 }
  );
  harness.controller.moveTabToWorkspace = async () => {
    const error = new Error("stale");
    error.code = WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST;
    throw error;
  };
  await harness.service.handleClicked(
    { menuItemId: "sidebars-move-tab:ws-missing" },
    { id: 13, windowId: 7 }
  );

  assert.deepEqual(harness.calls.filter(([name]) => name.startsWith("move")), [
    ["moveTab", 11, "ws-default-work"],
    ["moveGroup", 12, "ws-default-research"]
  ]);
  assert.equal(harness.calls.some(([name]) => name === "failure"), false);
  assert.deepEqual(harness.calls.filter(([name]) => name === "finished"), [
    ["finished", 7],
    ["finished", 7],
    ["finished", 7]
  ]);
});

test("unexpected menu move failures persist a retry notice before refresh", async () => {
  const harness = createHarness();
  harness.controller.moveGroupToWorkspace = async () => {
    throw new Error("Synthetic Firefox failure");
  };

  await harness.service.handleClicked(
    { menuItemId: "sidebars-move-group:ws-default-research" },
    { id: 12, windowId: 7 }
  );

  assert.deepEqual(harness.calls.filter(([name]) => name === "failure"), [
    ["failure", 7, "move-group"]
  ]);
  assert.deepEqual(harness.calls.at(-1), ["finished", 7]);
});

test("native copy menus rebuild from available containers and stay hidden privately", async () => {
  const containerService = {
    async overview({ privateContext = false } = {}) {
      return privateContext
        ? { capability: "private-unavailable", containers: [] }
        : {
            capability: "available",
            containers: [{
              refId: "ctr-work",
              descriptor: {
                name: "Work",
                color: "blue",
                icon: "briefcase",
                colorCode: "#37adff"
              },
              status: "available"
            }]
          };
    }
  };
  const harness = createHarness({ containerService });
  await harness.service.synchronize();
  assert.ok(harness.calls.some(([name, properties]) =>
    name === "create" &&
    properties.id === `${WORKSPACE_MENU_IDS.COPY_TO_CONTAINER_PREFIX}ctr-work` &&
    properties.title === "Work"
  ));

  harness.calls.length = 0;
  await harness.service.handleShown({ contexts: ["tab"] }, {
    id: 11,
    windowId: 7,
    incognito: false
  });
  assert.ok(harness.calls.some(([name, id, properties]) =>
    name === "update" &&
    id === WORKSPACE_MENU_IDS.COPY_TO_CONTAINER &&
    properties.visible === true
  ));
  await harness.service.handleClicked({
    menuItemId: `${WORKSPACE_MENU_IDS.COPY_TO_CONTAINER_PREFIX}ctr-work`
  }, { id: 11, windowId: 7, incognito: false });
  assert.ok(harness.calls.some(([name, windowId, tabId, assignment]) =>
    name === "copy" &&
    windowId === 7 &&
    tabId === 11 &&
    assignment.refId === "ctr-work"
  ));

  harness.calls.length = 0;
  await harness.service.handleShown({ contexts: ["tab"] }, {
    id: 12,
    windowId: 7,
    incognito: true
  });
  assert.ok(harness.calls.some(([name, id, properties]) =>
    name === "update" &&
    id === WORKSPACE_MENU_IDS.COPY_TO_CONTAINER &&
    properties.visible === false
  ));
});

test("menu synchronization can consume a completed container refresh without reentering it", async () => {
  let overviewCalls = 0;
  const containerService = {
    async overview() {
      overviewCalls += 1;
      throw new Error("Container refresh must not reenter itself.");
    }
  };
  const harness = createHarness({ containerService });
  const overview = {
    capability: "available",
    containers: [{
      refId: "ctr-work",
      descriptor: {
        name: "Work",
        color: "blue",
        icon: "briefcase",
        colorCode: "#37adff"
      },
      status: "available"
    }]
  };

  await harness.service.synchronize(overview);

  assert.equal(overviewCalls, 0);
  assert.ok(harness.calls.some(([name, properties]) =>
    name === "create" &&
    properties.id === `${WORKSPACE_MENU_IDS.COPY_TO_CONTAINER_PREFIX}ctr-work`
  ));
});

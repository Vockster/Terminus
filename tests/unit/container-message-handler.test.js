import test from "node:test";
import assert from "node:assert/strict";

import { createContainerMessageHandler } from "../../src/background/container-message-handler.js";
import { CONTAINER_MESSAGE_TYPES } from "../../src/contracts/container-messages.js";

const descriptor = Object.freeze({
  name: "Work",
  color: "blue",
  icon: "briefcase",
  colorCode: "#37adff"
});

function harness() {
  const calls = [];
  const controller = {
    async setWorkspaceDefaultContainer(workspaceId, refId) {
      calls.push(["default", workspaceId, refId]);
      return { schemaVersion: 5 };
    },
    async setWorkspaceDefaultContainers(workspaceIds, refId) {
      calls.push(["defaults", workspaceIds, refId]);
      return { schemaVersion: 5 };
    },
    async createWorkspaceTab(windowId, workspaceId, assignment) {
      calls.push(["new-tab", windowId, workspaceId, assignment]);
      return { activeWorkspaceId: workspaceId };
    },
    async copyTabToContainer(windowId, tabId, assignment) {
      calls.push(["copy", windowId, tabId, assignment]);
      return { activeWorkspaceId: "ws-work" };
    }
  };
  const service = {
    async overview(options) {
      calls.push(["overview", options]);
      return { capability: options.privateContext ? "private-unavailable" : "available" };
    },
    async refresh() { calls.push(["refresh"]); return { capability: "available" }; },
    async create(value) { calls.push(["create", value]); return { refId: "ctr-work", descriptor }; },
    async recreateReference(refId, value) {
      calls.push(["recreate", refId, value]);
      return { refId, descriptor: value };
    }
  };
  return {
    calls,
    handler: createContainerMessageHandler({
      service,
      workspaceController: controller,
      resolveWorkspaceController: () => controller
    })
  };
}

test("container messages delegate only exact logical-reference operations", async () => {
  const { calls, handler } = harness();
  assert.equal((await handler({ type: CONTAINER_MESSAGE_TYPES.OVERVIEW })).ok, true);
  assert.equal((await handler({ type: CONTAINER_MESSAGE_TYPES.ENABLE })).ok, true);
  assert.equal((await handler({ type: CONTAINER_MESSAGE_TYPES.CREATE, descriptor })).ok, true);
  assert.equal((await handler({
    type: CONTAINER_MESSAGE_TYPES.RECREATE,
    refId: "ctr-work",
    descriptor
  })).ok, true);
  assert.equal((await handler({
    type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULT,
    workspaceId: "ws-work",
    refId: "ctr-work"
  })).ok, true);
  assert.equal((await handler({
    type: CONTAINER_MESSAGE_TYPES.CREATE_WORKSPACE_TAB,
    windowId: 7,
    workspaceId: "ws-work",
    assignment: { kind: "none" }
  })).ok, true);
  assert.equal((await handler({
    type: CONTAINER_MESSAGE_TYPES.COPY_TAB,
    windowId: 7,
    tabId: 11,
    assignment: { kind: "container", refId: "ctr-work" }
  })).ok, true);
  assert.deepEqual(calls, [
    ["overview", { privateContext: false }],
    ["refresh"],
    ["create", descriptor],
    ["recreate", "ctr-work", descriptor],
    ["default", "ws-work", "ctr-work"],
    ["new-tab", 7, "ws-work", { kind: "none" }],
    ["copy", 7, 11, { kind: "container", refId: "ctr-work" }]
  ]);
});

test("one default container for a selection is delegated only in its exact shape", async () => {
  const { calls, handler } = harness();
  const ok = await handler({
    type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS,
    workspaceIds: ["ws-work", "ws-research"],
    refId: "ctr-work"
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result, { state: { schemaVersion: 5 } });
  assert.equal((await handler({
    type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS,
    workspaceIds: ["ws-work"],
    refId: null
  })).ok, true);

  for (const message of [
    { type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS, workspaceIds: ["ws-work"] },
    { type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS, workspaceIds: "ws-work", refId: null },
    { type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS, workspaceIds: ["ws-work", 7], refId: null },
    { type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS, workspaceIds: ["ws-work"], refId: "Work" },
    {
      type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS,
      workspaceIds: ["ws-work"],
      refId: null,
      cookieStoreId: "firefox-container-1"
    }
  ]) {
    const response = await handler(message);
    assert.equal(response.ok, false, JSON.stringify(message));
  }

  const refused = await handler({
    type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS,
    workspaceIds: ["ws-work"],
    refId: null
  }, { tab: { incognito: true } });
  assert.equal(refused.error.code, "PRIVATE_UNAVAILABLE");
  assert.deepEqual(calls, [
    ["defaults", ["ws-work", "ws-research"], "ctr-work"],
    ["defaults", ["ws-work"], null]
  ]);
});

test("container mutation messages fail closed in private scope", async () => {
  const { calls, handler } = harness();
  const sender = { tab: { incognito: true } };
  const overview = await handler({ type: CONTAINER_MESSAGE_TYPES.OVERVIEW }, sender);
  assert.equal(overview.result.capability, "private-unavailable");
  for (const message of [
    { type: CONTAINER_MESSAGE_TYPES.ENABLE },
    { type: CONTAINER_MESSAGE_TYPES.CREATE, descriptor },
    { type: CONTAINER_MESSAGE_TYPES.RECREATE, refId: "ctr-work", descriptor },
    {
      type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULT,
      workspaceId: "ws-work",
      refId: null
    },
    {
      type: CONTAINER_MESSAGE_TYPES.CREATE_WORKSPACE_TAB,
      windowId: 7,
      workspaceId: "ws-work",
      assignment: { kind: "none" }
    },
    {
      type: CONTAINER_MESSAGE_TYPES.COPY_TAB,
      windowId: 7,
      tabId: 11,
      assignment: { kind: "none" }
    }
  ]) {
    const response = await handler(message, sender);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "PRIVATE_UNAVAILABLE");
  }
  assert.deepEqual(calls, [["overview", { privateContext: true }]]);
});

test("container messages reject extra fields before delegation", async () => {
  const { calls, handler } = harness();
  const response = await handler({
    type: CONTAINER_MESSAGE_TYPES.CREATE,
    descriptor,
    cookieStoreId: "firefox-container-1"
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.deepEqual(calls, []);
});

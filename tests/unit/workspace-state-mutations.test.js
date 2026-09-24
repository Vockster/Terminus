import test from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_STATE_ERROR_CODES } from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { WorkspaceStateService } from "../../src/core/workspace-state-service.js";

function createStorage(initial = createDefaultWorkspaceState()) {
  let state = structuredClone(initial);
  let journal;
  const writes = [];
  return {
    writes,
    value: () => structuredClone(state),
    storage: {
      async read() { return structuredClone(state); },
      async write(value) { state = structuredClone(value); writes.push(structuredClone(value)); },
      async readMigration() { return structuredClone(journal); },
      async writeMigration(value) { journal = structuredClone(value); },
      async removeMigration() { journal = undefined; }
    }
  };
}

test("workspace create, edit, reorder, divider, and space operations preserve stable identity", async () => {
  const memory = createStorage();
  const ids = ["one", "two", "three"];
  const service = new WorkspaceStateService(memory.storage, { idGenerator: () => ids.shift() });

  const created = await service.createWorkspace({
    name: "Media",
    icon: "gamepad",
    color: "#AABBCC"
  });
  const createdWorkspace = created.workspaces.at(-1);
  assert.deepEqual(createdWorkspace, {
    id: "ws-one",
    name: "Media",
    icon: "gamepad",
    color: "#aabbcc",
    defaultContainerRef: null
  });

  const updated = await service.updateWorkspace(createdWorkspace.id, {
    name: "Entertainment",
    color: "#112233"
  });
  assert.deepEqual(updated.workspaces.at(-1), {
    ...createdWorkspace,
    name: "Entertainment",
    color: "#112233"
  });

  const withDivider = await service.addDivider();
  assert.deepEqual(withDivider.rail.at(-1), {
    kind: "divider",
    id: "divider-two",
    size: 16
  });
  const resized = await service.resizeDivider("divider-two", 40);
  assert.deepEqual(resized.rail.at(-1), {
    kind: "divider",
    id: "divider-two",
    size: 40
  });
  const placedDivider = await service.placeRailEntry(
    { kind: "divider", id: "divider-two" },
    { kind: "workspace", id: "ws-default-personal" },
    "before"
  );
  assert.deepEqual(placedDivider.rail[1], {
    kind: "divider",
    id: "divider-two",
    size: 40
  });
  const placedWorkspace = await service.placeRailEntry(
    { kind: "workspace", id: "ws-one" },
    { kind: "workspace", id: "ws-default-work" },
    "after"
  );
  assert.equal(placedWorkspace.rail[1].workspaceId, "ws-one");
  assert.equal(placedWorkspace.rail[2].id, "divider-two");
  const resetSize = await service.resizeDivider("divider-two", null);
  assert.equal(resetSize.rail.find(({ id }) => id === "divider-two").size, null);
  const moved = await service.moveRailEntry({ kind: "divider", id: "divider-two" }, "up");
  assert.deepEqual(moved.rail[1], {
    kind: "divider",
    id: "divider-two",
    size: null
  });
  const withoutDivider = await service.removeDivider("divider-two");
  assert.equal(withoutDivider.rail.some(({ kind }) => kind === "divider"), false);
  const withSpace = await service.addSpace();
  assert.deepEqual(withSpace.rail.at(-1), { kind: "space", id: "space-three" });
  const removed = await service.removeSpace("space-three");
  assert.equal(removed.rail.some(({ kind }) => kind === "space"), false);
  assert.equal(removed.workspaces.at(-1).id, "ws-one");
});

test("concurrent workspace creates read the latest state instead of clobbering", async () => {
  const memory = createStorage();
  const ids = ["alpha", "beta"];
  const service = new WorkspaceStateService(memory.storage, { idGenerator: () => ids.shift() });
  await Promise.all([
    service.createWorkspace({ name: "Alpha", icon: "star", color: "#112233" }),
    service.createWorkspace({ name: "Beta", icon: "tree", color: "#445566" })
  ]);
  assert.deepEqual(memory.value().workspaces.slice(-2).map(({ id }) => id), ["ws-alpha", "ws-beta"]);
  assert.equal(memory.writes.length, 2);
});

test("workspace removal drops only the definition and refuses the final workspace", async () => {
  const memory = createStorage();
  const service = new WorkspaceStateService(memory.storage);
  const withoutWork = await service.removeWorkspace("ws-default-work");
  assert.equal(withoutWork.workspaces.some(({ id }) => id === "ws-default-work"), false);
  assert.equal(
    withoutWork.rail.some(
      ({ kind, workspaceId }) => kind === "workspace" && workspaceId === "ws-default-work"
    ),
    false
  );
  await service.removeWorkspace("ws-default-personal");
  await assert.rejects(
    service.removeWorkspace("ws-default-research"),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(memory.writes.length, 2);
});

test("invalid edits reject before storage mutation", async () => {
  const memory = createStorage();
  const service = new WorkspaceStateService(memory.storage);
  await assert.rejects(
    service.updateWorkspace("ws-default-work", { icon: "not-in-catalog" }),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  await assert.rejects(
    service.moveRailEntry({ kind: "workspace", id: "missing" }, "up"),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  await assert.rejects(
    service.resizeDivider("divider-missing", 32),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  await assert.rejects(
    service.resizeDivider("divider-missing", 65),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  await assert.rejects(
    service.placeRailEntry(
      { kind: "workspace", id: "ws-default-work" },
      { kind: "workspace", id: "missing" },
      "before"
    ),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  await assert.rejects(
    service.placeRailEntry(
      { kind: "workspace", id: "ws-default-work" },
      { kind: "workspace", id: "ws-default-personal" },
      "sideways"
    ),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(memory.writes.length, 0);
});

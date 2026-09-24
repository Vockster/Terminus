import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceMessageHandler } from "../../src/background/workspace-message-handler.js";
import { WORKSPACE_MESSAGE_TYPES } from "../../src/contracts/workspace-messages.js";
import { WORKSPACE_STATE_STORAGE_KEY } from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { WorkspaceStateService } from "../../src/core/workspace-state-service.js";
import { createFirefoxWorkspaceStorage } from "../../src/platform/firefox/workspace-storage.js";

test("workspace settings intents round-trip through messages, service, and Firefox storage", async () => {
  const stored = { unrelated: "preserved", [WORKSPACE_STATE_STORAGE_KEY]: createDefaultWorkspaceState() };
  const browserApi = {
    storage: {
      local: {
        async get(key) { return Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {}; },
        async set(value) { Object.assign(stored, structuredClone(value)); },
        async remove(key) { delete stored[key]; }
      }
    }
  };
  const stateService = new WorkspaceStateService(
    createFirefoxWorkspaceStorage(browserApi),
    { idGenerator: (() => { const ids = ["media", "divider", "gap"]; return () => ids.shift(); })() }
  );
  const handler = createWorkspaceMessageHandler(stateService);

  const created = await handler({
    type: WORKSPACE_MESSAGE_TYPES.CREATE,
    workspace: { name: "Media", icon: "gamepad", color: "#112233" }
  });
  assert.equal(created.state.workspaces.at(-1).id, "ws-media");
  await handler({
    type: WORKSPACE_MESSAGE_TYPES.UPDATE,
    workspaceId: "ws-media",
    changes: { name: "Entertainment", icon: "star" }
  });
  await handler({ type: WORKSPACE_MESSAGE_TYPES.ADD_DIVIDER });
  const resized = await handler({
    type: WORKSPACE_MESSAGE_TYPES.RESIZE_DIVIDER,
    dividerId: "divider-divider",
    size: 42
  });
  assert.equal(resized.state.rail.at(-1).size, 42);
  const placed = await handler({
    type: WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRY,
    entry: { kind: "divider", id: "divider-divider" },
    target: { kind: "workspace", id: "ws-default-personal" },
    position: "before"
  });
  assert.equal(placed.state.rail[1].id, "divider-divider");
  await handler({ type: WORKSPACE_MESSAGE_TYPES.ADD_SPACE });
  const removedSpace = await handler({
    type: WORKSPACE_MESSAGE_TYPES.REMOVE_SPACE,
    spaceId: "space-gap"
  });
  assert.equal(removedSpace.state.rail.some(({ kind }) => kind === "space"), false);
  const removed = await handler({
    type: WORKSPACE_MESSAGE_TYPES.REMOVE_DIVIDER,
    dividerId: "divider-divider"
  });

  assert.equal(removed.ok, true);
  assert.deepEqual(removed.state.workspaces.at(-1), {
    id: "ws-media",
    name: "Entertainment",
    icon: "star",
    color: "#112233",
    defaultContainerRef: null
  });
  assert.equal(removed.state.rail.some(({ kind }) => kind === "divider"), false);
  assert.deepEqual(stored[WORKSPACE_STATE_STORAGE_KEY], removed.state);
  assert.equal(stored.unrelated, "preserved");
});

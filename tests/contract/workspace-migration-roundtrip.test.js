import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceMessageHandler } from "../../src/background/workspace-message-handler.js";
import { WORKSPACE_MESSAGE_TYPES } from "../../src/contracts/workspace-messages.js";
import {
  WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY,
  WORKSPACE_RUNTIME_STORAGE_KEY
} from "../../src/contracts/workspace-runtime.js";
import {
  WORKSPACE_STATE_MIGRATION_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY
} from "../../src/contracts/workspace-state.js";
import { WorkspaceController } from "../../src/core/workspace-controller.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { WorkspaceRuntimeService } from "../../src/core/workspace-runtime-service.js";
import { WorkspaceStateService } from "../../src/core/workspace-state-service.js";
import { createFirefoxWorkspaceRuntimeStorage } from "../../src/platform/firefox/workspace-runtime-storage.js";
import { createFirefoxWorkspaceStorage } from "../../src/platform/firefox/workspace-storage.js";

test("v1 documents round-trip through Firefox storage adapters and unchanged view messages", async () => {
  const defaults = createDefaultWorkspaceState();
  const operations = [];
  const stored = {
    [WORKSPACE_STATE_STORAGE_KEY]: {
      schemaVersion: 1,
      workspaces: defaults.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace),
      rail: defaults.rail
    },
    [WORKSPACE_RUNTIME_STORAGE_KEY]: {
      schemaVersion: 1,
      tabs: [{ id: "tab-alpha", workspaceId: "ws-default-work" }],
      windows: [{ id: "window-alpha", activeWorkspaceId: "ws-default-work" }]
    }
  };
  const browserApi = {
    storage: {
      local: {
        async get(key) {
          operations.push(["get", key]);
          return Object.prototype.hasOwnProperty.call(stored, key)
            ? { [key]: structuredClone(stored[key]) }
            : {};
        },
        async set(value) {
          const [key] = Object.keys(value);
          operations.push(["set", key]);
          stored[key] = structuredClone(value[key]);
        },
        async remove(key) {
          operations.push(["remove", key]);
          delete stored[key];
        }
      }
    }
  };

  const stateService = new WorkspaceStateService(createFirefoxWorkspaceStorage(browserApi));
  const runtimeService = new WorkspaceRuntimeService(
    createFirefoxWorkspaceRuntimeStorage(browserApi)
  );
  const controller = new WorkspaceController({
    stateService,
    runtimeService,
    browserAdapter: {
      async listNormalWindowIds() {
        return [7];
      },
      async getOrCreateWindowIdentity() {
        return "window-alpha";
      },
      async getWindowIdentity() {
        return "window-alpha";
      },
      async getOrCreateTabIdentity() {
        return "tab-alpha";
      },
      async getTabLogicalGroupId() {
        return null;
      },
      async clearTabLogicalGroupId() {},
      async listTabGroups() {
        return [];
      },
      async getWindowNotice() {
        return undefined;
      },
      async clearWindowNotice() {},
      async listTabs() {
        return [
          {
            id: 11,
            windowId: 7,
            index: 0,
            active: true,
            hidden: false,
            pinned: false
          }
        ];
      }
    }
  });
  const handler = createWorkspaceMessageHandler(stateService, controller);

  const response = await handler({ type: WORKSPACE_MESSAGE_TYPES.GET_VIEW, windowId: 7 });

  assert.equal(response.ok, true);
  assert.equal(response.view.state.schemaVersion, 5);
  assert.equal(response.view.activeWorkspaceId, "ws-default-work");
  assert.equal(stored[WORKSPACE_STATE_STORAGE_KEY].schemaVersion, 5);
  assert.deepEqual(stored[WORKSPACE_RUNTIME_STORAGE_KEY], {
    schemaVersion: 5,
    tabs: [{ id: "tab-alpha", workspaceId: "ws-default-work" }],
    windows: [
      {
        id: "window-alpha",
        activeWorkspaceId: "ws-default-work",
        selectedTabs: [{ workspaceId: "ws-default-work", tabId: "tab-alpha" }],
        workspaceLayouts: [
          {
            workspaceId: "ws-default-work",
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
  });
  assert.equal(stored[WORKSPACE_STATE_MIGRATION_STORAGE_KEY], undefined);
  assert.equal(stored[WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY], undefined);

  const stateWriteIndex = operations.findIndex(
    ([operation, key]) => operation === "set" && key === WORKSPACE_STATE_STORAGE_KEY
  );
  const runtimeJournalIndex = operations.findIndex(
    ([operation, key]) => operation === "set" && key === WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY
  );
  assert.ok(stateWriteIndex >= 0 && stateWriteIndex < runtimeJournalIndex);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createSidebarActionCoordinator } from "../../src/background/sidebar-action-coordinator.js";
import { SIDEBAR_UNDO_OPERATION_KINDS } from "../../src/contracts/sidebar-undo.js";
import { createEmptyWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { fingerprintUndoSnapshot } from "../../src/core/sidebar-undo-service.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

const sidebarUrl = "moz-extension://terminus/src/sidebar/index.html";

function sender(windowId, incognito = false, url = sidebarUrl) {
  return { url, tab: { windowId, incognito } };
}

function fixture() {
  const calls = [];
  const normalController = {
    async restoreSidebarUndo(windowId, entry) {
      calls.push(["restore-normal", windowId, entry]);
      return "normal-restored";
    }
  };
  const privateController = {
    async restoreSidebarUndo(windowId, entry) {
      calls.push(["restore-private", windowId, entry]);
      return "private-restored";
    }
  };
  const undoService = {
    createTransaction(metadata) {
      calls.push(["transaction", metadata]);
      return { kind: "single" };
    },
    createCompositeTransaction(metadata) {
      calls.push(["composite", metadata]);
      return { kind: "composite" };
    },
    summary: { available: false, undoId: null, operation: null, label: null, action: null },
    async getSummary(scope, windowId) {
      calls.push(["summary", scope, windowId]);
      return this.summary;
    },
    async execute(options) {
      calls.push(["execute", options.scope, options.windowId, options.undoId]);
      return options.restore({ scope: options.scope, marker: true });
    }
  };
  const coordinator = createSidebarActionCoordinator({
    browserApi: { runtime: { getURL: (path) => `moz-extension://terminus/${path}` } },
    windowScopeRegistry: {
      async resolveScope(windowId) { return windowId === 8 ? "private" : "normal"; }
    },
    undoService,
    normalController,
    privateController,
    operationExecutor: { runExclusive: (operation) => operation({}) }
  });
  return { coordinator, calls, undoService };
}

const settingsUrl = "moz-extension://terminus/src/settings/index.html";

test("sidebar action coordination accepts only the exact sidebar window and scope", async () => {
  const { coordinator } = fixture();
  assert.equal(coordinator.isSidebarSender(sender(7)), true);
  assert.equal(coordinator.isSidebarSender(sender(7, false, `${sidebarUrl}?copy`)), false);
  await assert.rejects(
    coordinator.getSummary({ sender: sender(9), windowId: 7 }),
    TypeError
  );
  await assert.rejects(
    coordinator.getSummary({ sender: sender(8, false), windowId: 8 }),
    TypeError
  );
  assert.equal(
    await coordinator.verifySidebarRequest({ sender: sender(8, true), windowId: 8 }),
    "private"
  );
});

test("ordinary and workspace-removal actions receive the correct scoped transaction", async () => {
  const { coordinator, calls } = fixture();
  const ordinary = await coordinator.createTransaction({
    sender: sender(7),
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
    label: "Rename group"
  });
  const composite = await coordinator.createTransaction({
    sender: sender(8, true),
    windowId: 8,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
    label: "Remove workspace"
  });
  assert.equal(ordinary.kind, "single");
  assert.equal(composite.kind, "composite");
  assert.deepEqual(calls[0][1], {
    scope: "normal",
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
    label: "Rename group"
  });
  assert.equal(calls[1][1].primaryScope, "private");
});

test("Settings fills and runs its own window's slot only for a workspace removal", async () => {
  const { coordinator, calls, undoService } = fixture();
  const settings = sender(7, false, settingsUrl);
  assert.equal(coordinator.isSettingsSender(settings), true);
  assert.equal(coordinator.isSettingsSender(sender(7)), false);
  assert.equal(coordinator.isSettingsSender({ url: settingsUrl }), false);

  const composite = await coordinator.createSettingsRemovalTransaction({
    sender: settings,
    windowId: 7,
    label: "Remove 2 workspaces"
  });
  assert.equal(composite.kind, "composite");
  assert.deepEqual(calls.at(-1)[1], {
    primaryScope: "normal",
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
    label: "Remove 2 workspaces"
  });
  await assert.rejects(
    coordinator.createSettingsRemovalTransaction({ sender: sender(7), windowId: 7, label: "Remove" }),
    TypeError
  );
  // The window is the Settings tab's own, never one named by the message.
  await assert.rejects(
    coordinator.createSettingsRemovalTransaction({ sender: settings, windowId: 9, label: "Remove" }),
    TypeError
  );
  // Ordinary sidebar transactions stay closed to Settings.
  await assert.rejects(
    coordinator.createTransaction({
      sender: settings,
      windowId: 7,
      operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
      label: "Rename group"
    }),
    TypeError
  );

  // Settings runs the slot only while it still holds its removal's Undo.
  await assert.rejects(
    coordinator.execute({ sender: settings, windowId: 7, undoId: "undo-removal" }),
    TypeError
  );
  undoService.summary = {
    available: true,
    undoId: "undo-removal",
    operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
    label: "Rename group",
    action: "undo"
  };
  await assert.rejects(
    coordinator.execute({ sender: settings, windowId: 7, undoId: "undo-removal" }),
    TypeError
  );
  undoService.summary = { ...undoService.summary, operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE };
  assert.equal(
    await coordinator.execute({ sender: settings, windowId: 7, undoId: "undo-removal" }),
    "normal-restored"
  );
  assert.equal(calls.filter(([kind]) => kind === "execute").length, 1);
});

test("Undo execution dispatches only to the controller for the verified scope", async () => {
  const { coordinator, calls } = fixture();
  assert.equal(await coordinator.execute({
    sender: sender(7), windowId: 7, undoId: "undo-one"
  }), "normal-restored");
  assert.equal(await coordinator.execute({
    sender: sender(8, true), windowId: 8, undoId: "undo-two"
  }), "private-restored");
  assert.deepEqual(
    calls.filter(([kind]) => kind.startsWith("restore-")).map(([kind]) => kind),
    ["restore-normal", "restore-private"]
  );
});

test("shared workspace Undo prevalidates both scopes and reports a companion failure as partial", async () => {
  const current = {
    workspaceState: createDefaultWorkspaceState(),
    workspaceRuntime: createEmptyWorkspaceRuntime(),
    browserTabs: []
  };
  const primaryEntry = {
    scope: "normal",
    affectedKeys: ["workspace:ws-missing"],
    expectedPostFingerprint: fingerprintUndoSnapshot(current, ["workspace:ws-missing"])
  };
  const companionEntry = {
    scope: "private",
    affectedKeys: ["tab:tab-missing"],
    expectedPostFingerprint: fingerprintUndoSnapshot(current, ["tab:tab-missing"])
  };
  const calls = [];
  const normalController = {
    async captureSidebarUndoSnapshot() { calls.push("capture-normal"); return current; },
    async restoreSidebarUndoWithLease() {
      calls.push("restore-normal");
      return {
        view: { marker: "normal" },
        outcome: {
          status: "applied",
          requestedCount: 1,
          restoredCount: 1,
          skippedCount: 0,
          failedCount: 0,
          approximatedCount: 0,
          retainedSafetyCount: 0,
          reasons: []
        }
      };
    }
  };
  const privateController = {
    async captureSidebarUndoSnapshot() { calls.push("capture-private"); return current; },
    async restoreSidebarUndoCompanion() {
      calls.push("restore-private");
      throw new Error("synthetic companion failure");
    }
  };
  const coordinator = createSidebarActionCoordinator({
    browserApi: { runtime: { getURL: (path) => `moz-extension://terminus/${path}` } },
    windowScopeRegistry: { async resolveScope() { return "normal"; } },
    undoService: {
      async execute(options) {
        return options.restoreComposite(primaryEntry, companionEntry);
      }
    },
    normalController,
    privateController,
    operationExecutor: { runExclusive: (operation) => operation(Object.freeze({})) }
  });

  const result = await coordinator.execute({
    sender: sender(7),
    windowId: 7,
    undoId: "undo-workspace-remove"
  });
  assert.deepEqual(calls, [
    "capture-normal",
    "capture-private",
    "restore-normal",
    "restore-private"
  ]);
  assert.deepEqual(result.outcome, {
    status: "partial",
    requestedCount: 2,
    restoredCount: 1,
    skippedCount: 0,
    failedCount: 1,
    approximatedCount: 0,
    retainedSafetyCount: 0,
    reasons: [{ reason: "browser-failure", count: 1 }]
  });
});

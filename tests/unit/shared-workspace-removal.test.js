import test from "node:test";
import assert from "node:assert/strict";

import { withSharedWorkspaceRemoval } from "../../src/background/shared-workspace-removal.js";
import { createEmptyWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { createSerialOperationExecutor } from "../../src/core/serial-operation-executor.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

function snapshot(name = "Work") {
  const workspaceState = createDefaultWorkspaceState();
  workspaceState.workspaces[0].name = name;
  return {
    workspaceState,
    workspaceRuntime: createEmptyWorkspaceRuntime(),
    browserTabs: []
  };
}

function harness({ failRemoval = false, failCommit = false, failAfter = null } = {}) {
  const executor = createSerialOperationExecutor();
  const calls = [];
  const beforePrimary = snapshot("Work");
  const afterPrimary = snapshot(failRemoval ? "Work" : "Office");
  const beforeCompanion = snapshot("Work");
  const afterCompanion = snapshot("Office");
  let primarySnapshot = beforePrimary;
  let companionSnapshot = beforeCompanion;
  const primary = {
    async captureSidebarUndoSnapshot(windowId, lease) {
      assert.equal(executor.ownsLease(lease), true);
      calls.push(["capture-primary", windowId]);
      return structuredClone(primarySnapshot);
    },
    async removeWorkspaceWithLease(windowId, workspaceId, transaction, lease) {
      assert.equal(executor.ownsLease(lease), true);
      calls.push(["remove-primary", windowId, workspaceId]);
      if (failAfter !== null) {
        // The batch path passes no transaction of its own: one composite entry
        // covers the whole selection.
        assert.equal(transaction, null);
        if (workspaceId === failAfter) {
          throw new Error("synthetic removal failure");
        }
        primarySnapshot = afterPrimary;
        return { marker: "removed" };
      }
      await transaction.prepare(primarySnapshot);
      primarySnapshot = afterPrimary;
      await transaction.commit(primarySnapshot);
      if (failRemoval) throw new Error("synthetic removal failure");
      return { marker: "removed" };
    },
    async prepareWorkspaceBatchRemoval(workspaceIds, decorations, lease) {
      assert.equal(executor.ownsLease(lease), true);
      calls.push(["prepare-batch", workspaceIds.join(","), decorations.length]);
      return [...workspaceIds].reverse();
    }
  };
  const secondary = {
    async captureSidebarUndoSnapshot(windowId, lease) {
      assert.equal(executor.ownsLease(lease), true);
      calls.push(["capture-companion", windowId]);
      return structuredClone(companionSnapshot);
    },
    async prepareWorkspaceRemoval(workspaceId, lease) {
      assert.equal(executor.ownsLease(lease), true);
      calls.push(["prepare-companion", workspaceId]);
      companionSnapshot = afterCompanion;
      return { marker: "rollback" };
    },
    async restorePreparedWorkspaceState(token, lease) {
      assert.equal(executor.ownsLease(lease), true);
      calls.push(["rollback-companion", token.marker]);
      companionSnapshot = beforeCompanion;
    }
  };
  let finalization = null;
  const transaction = {
    composite: true,
    async prepareComposite(primaryBefore, companionBefore) {
      calls.push(["prepare-undo", primaryBefore.workspaceState.workspaces[0].name,
        companionBefore.workspaceState.workspaces[0].name]);
    },
    async commitComposite(primaryAfter, companionAfter) {
      calls.push(["commit-undo", primaryAfter.workspaceState.workspaces[0].name,
        companionAfter.workspaceState.workspaces[0].name]);
      if (failCommit) throw new Error("synthetic finalization failure");
      finalization = { unavailable: false, applied: true };
      return finalization;
    },
    async abort() { calls.push(["abort-undo"]); },
    async failApplied() {
      calls.push(["undo-unavailable"]);
      finalization = { unavailable: true, applied: true };
      return finalization;
    },
    get finalization() { return finalization; }
  };
  return {
    calls,
    transaction,
    controller: withSharedWorkspaceRemoval(primary, secondary, executor)
  };
}

test("shared workspace removal captures and commits both scopes under one executor lease", async () => {
  const { calls, controller, transaction } = harness();
  assert.deepEqual(await controller.removeWorkspace(
    7,
    "ws-default-work",
    transaction
  ), { marker: "removed" });
  assert.deepEqual(calls.map(([name]) => name), [
    "capture-primary",
    "capture-companion",
    "prepare-undo",
    "prepare-companion",
    "remove-primary",
    "capture-companion",
    "commit-undo"
  ]);
});

test("a removal failure with no primary change rolls the companion back and aborts Undo", async () => {
  const { calls, controller, transaction } = harness({ failRemoval: true });
  await assert.rejects(
    controller.removeWorkspace(7, "ws-default-work", transaction),
    /synthetic removal failure/
  );
  assert.equal(calls.some(([name]) => name === "rollback-companion"), true);
  assert.equal(calls.some(([name]) => name === "abort-undo"), true);
  assert.equal(calls.some(([name]) => name === "commit-undo"), false);
});

test("Undo finalization failure never rolls back an already applied shared removal", async () => {
  const { calls, controller, transaction } = harness({ failCommit: true });
  assert.deepEqual(await controller.removeWorkspace(
    7,
    "ws-default-work",
    transaction
  ), { marker: "removed" });
  assert.equal(calls.some(([name]) => name === "undo-unavailable"), true);
  assert.equal(calls.some(([name]) => name === "rollback-companion"), false);
  assert.equal(transaction.finalization.unavailable, true);
});

test("a selection removed together is one Undo entry for the whole batch", async () => {
  const { calls, controller, transaction } = harness({ failAfter: "none" });
  assert.equal(await controller.removeWorkspaces(
    7,
    ["ws-default-work", "ws-default-personal"],
    [{ kind: "divider", id: "divider-1" }],
    transaction
  ), 2);
  assert.deepEqual(calls.map(([name]) => name), [
    "capture-primary",
    "capture-companion",
    "prepare-undo",
    "prepare-batch",
    "prepare-companion",
    "remove-primary",
    "prepare-companion",
    "remove-primary",
    "capture-primary",
    "capture-companion",
    "commit-undo"
  ]);
  // Parked in one block, so every removal hands its tabs to the same survivor.
  assert.deepEqual(
    calls.filter(([name]) => name === "remove-primary").map(([, , id]) => id),
    ["ws-default-personal", "ws-default-work"]
  );
  assert.equal(calls.filter(([name]) => name === "prepare-undo").length, 1);
  assert.equal(calls.filter(([name]) => name === "commit-undo").length, 1);
});

test("a batch that fails part way keeps what it applied and still records one Undo", async () => {
  const { calls, controller, transaction } = harness({ failAfter: "ws-default-work" });
  await assert.rejects(
    controller.removeWorkspaces(
      7,
      ["ws-default-work", "ws-default-personal"],
      [],
      transaction
    ),
    (error) => error.removedCount === 1
  );
  // The failing workspace rolls the companion back; the one already removed
  // stays removed and reachable through Undo.
  assert.equal(calls.filter(([name]) => name === "remove-primary").length, 2);
  assert.equal(calls.some(([name]) => name === "rollback-companion"), true);
  assert.equal(calls.some(([name]) => name === "commit-undo"), true);
});

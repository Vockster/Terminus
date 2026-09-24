import test from "node:test";
import assert from "node:assert/strict";

import {
  SIDEBAR_UNDO_ACTIONS,
  SIDEBAR_UNDO_OPERATION_KINDS,
  SIDEBAR_UNDO_STATES,
  createEmptySidebarUndoDocument,
  parseSidebarUndoDocument,
  parseSidebarUndoEntry,
  parseSidebarUndoOutcome,
  sidebarUndoSummary
} from "../../src/contracts/sidebar-undo.js";
import { createEmptyWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { SidebarUndoService } from "../../src/core/sidebar-undo-service.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

function snapshot(overrides = {}) {
  const workspaceState = overrides.workspaceState ?? createDefaultWorkspaceState();
  const workspaceRuntime = overrides.workspaceRuntime ?? createEmptyWorkspaceRuntime();
  return { workspaceState, workspaceRuntime, browserTabs: overrides.browserTabs ?? [] };
}

function memoryStorage(initial = {}) {
  const documents = new Map(Object.entries(initial));
  return {
    async read(scope) {
      return structuredClone(documents.get(scope) ?? createEmptySidebarUndoDocument());
    },
    async write(scope, document) {
      documents.set(scope, structuredClone(document));
      return true;
    },
    async clear(scope) { documents.delete(scope); },
    get(scope) { return structuredClone(documents.get(scope)); }
  };
}

function changedState(name) {
  const state = createDefaultWorkspaceState();
  state.workspaces[0].name = name;
  return state;
}

function browserTab(workspaceId, overrides = {}) {
  return {
    logicalTabId: "tab-one",
    firefoxTabId: 11,
    windowId: 7,
    logicalWindowId: "window-one",
    workspaceId,
    index: 0,
    url: "https://example.com/",
    title: "Example",
    pinned: false,
    discarded: false,
    active: true,
    hidden: false,
    containerRef: null,
    ...overrides
  };
}

test("sidebar Undo contracts reject extras and publish no payload when unavailable", () => {
  const entry = {
    schemaVersion: 1,
    undoId: "undo-one",
    scope: "normal",
    originWindowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace",
    action: SIDEBAR_UNDO_ACTIONS.UNDO,
    state: SIDEBAR_UNDO_STATES.READY,
    affectedKeys: ["workspace:ws-default-work"],
    before: snapshot(),
    expectedPostFingerprint: "undo-post-0123456789abcdef"
  };
  assert.deepEqual(parseSidebarUndoEntry(entry), entry);
  assert.deepEqual(sidebarUndoSummary(), {
    available: false, undoId: null, operation: null, label: null, action: null
  });
  assert.throws(() => parseSidebarUndoEntry({ ...entry, url: "https://private.invalid" }), TypeError);
  assert.throws(() => parseSidebarUndoDocument({
    schemaVersion: 1,
    sequence: 1,
    entries: [entry, { ...entry, undoId: "undo-two" }]
  }, "normal"), TypeError);
});

test("a flattened branch is a parseable session Undo operation", () => {
  const entry = {
    schemaVersion: 1,
    undoId: "undo-flatten",
    scope: "normal",
    originWindowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN,
    label: "Flatten branch",
    action: SIDEBAR_UNDO_ACTIONS.UNDO,
    state: SIDEBAR_UNDO_STATES.READY,
    affectedKeys: ["workspace:ws-default-work"],
    before: snapshot(),
    expectedPostFingerprint: "undo-post-0123456789abcdef"
  };
  assert.equal(SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN, "tree-flatten");
  assert.deepEqual(parseSidebarUndoEntry(entry), entry);
});

test("prepared actions become one ready entry and consuming is one-use", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({
    storage,
    createUuid: () => `entry-${++uuid}`
  });
  const transaction = service.createTransaction({
    scope: "normal",
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace"
  });
  await transaction.prepare(snapshot());
  assert.equal(storage.get("normal").entries[0].state, "prepared");
  const committed = await transaction.commit(snapshot({ workspaceState: changedState("Office") }));
  assert.equal(committed.summary.available, true);
  assert.equal(committed.summary.action, SIDEBAR_UNDO_ACTIONS.UNDO);
  assert.equal(storage.get("normal").entries[0].state, "ready");

  let restored = 0;
  const result = await service.execute({
    scope: "normal",
    windowId: 7,
    undoId: committed.summary.undoId,
    restore: async (entry) => {
      assert.equal(entry.state, "consuming");
      restored += 1;
      return "restored";
    }
  });
  assert.equal(result, "restored");
  assert.equal(restored, 1);
  assert.equal((await service.getSummary("normal", 7)).available, false);
  await assert.rejects(() => service.execute({
    scope: "normal", windowId: 7, undoId: committed.summary.undoId, restore: async () => {}
  }), TypeError);
});

test("one session slot alternates between Undo and Redo from observed state", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const before = snapshot();
  const after = snapshot({ workspaceState: changedState("Office") });
  const transaction = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace"
  });
  await transaction.prepare(before);
  const committed = await transaction.commit(after);

  const undone = await service.execute({
    scope: "normal", windowId: 7, undoId: committed.summary.undoId,
    restore: async (entry) => ({
      marker: "undone",
      reversals: [{ scope: "normal", before: after, after: before }]
    })
  });
  assert.equal(undone.marker, "undone");
  assert.equal(undone.summary.action, SIDEBAR_UNDO_ACTIONS.REDO);
  assert.equal(storage.get("normal").entries[0].action, SIDEBAR_UNDO_ACTIONS.REDO);

  const redone = await service.execute({
    scope: "normal", windowId: 7, undoId: undone.summary.undoId,
    restore: async (entry) => {
      assert.equal(entry.action, SIDEBAR_UNDO_ACTIONS.REDO);
      return {
        marker: "redone",
        reversals: [{ scope: "normal", before, after }]
      };
    }
  });
  assert.equal(redone.marker, "redone");
  assert.equal(redone.summary.action, SIDEBAR_UNDO_ACTIONS.UNDO);
  assert.equal(storage.get("normal").entries.length, 1);
});

test("a no-op restores the displaced entry and interrupted states clear at initialization", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const first = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace"
  });
  await first.prepare(snapshot());
  const ready = await first.commit(snapshot({ workspaceState: changedState("Office") }));

  const noOpSnapshot = snapshot({ workspaceState: changedState("Office") });
  const second = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
    label: "Rename group"
  });
  await second.prepare(noOpSnapshot);
  const noOp = await second.commit(noOpSnapshot);
  assert.equal(noOp.applied, false);
  assert.equal(noOp.summary.undoId, ready.summary.undoId);

  const third = service.createTransaction({
    scope: "private", windowId: 8,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD,
    label: "Unload tabs"
  });
  await third.prepare(snapshot());
  await service.initialize();
  assert.equal((await service.getSummary("private", 8)).available, false);
  assert.equal((await service.getSummary("normal", 7)).available, true);
});

test("inverse outcomes enforce exact accounting", () => {
  const outcome = {
    status: "partial",
    requestedCount: 3,
    restoredCount: 1,
    skippedCount: 1,
    failedCount: 1,
    approximatedCount: 1,
    retainedSafetyCount: 0,
    reasons: [
      { reason: "missing-tab", count: 1 },
      { reason: "browser-failure", count: 1 }
    ]
  };
  assert.deepEqual(parseSidebarUndoOutcome(outcome), outcome);
  assert.throws(() => parseSidebarUndoOutcome({ ...outcome, restoredCount: 2 }), TypeError);
});

test("workspace removal keeps scope-owned companion payloads separate and consumes both once", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const transaction = service.createCompositeTransaction({
    primaryScope: "normal",
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
    label: "Remove workspace"
  });
  const stateBefore = createDefaultWorkspaceState();
  const stateAfter = structuredClone(stateBefore);
  stateAfter.workspaces = stateAfter.workspaces.filter(({ id }) => id !== "ws-default-work");
  stateAfter.rail = stateAfter.rail.filter(
    (entry) => entry.kind !== "workspace" || entry.workspaceId !== "ws-default-work"
  );
  const normalBefore = snapshot({ workspaceState: stateBefore });
  const privateBefore = snapshot({
    workspaceState: stateBefore,
    browserTabs: [browserTab("ws-default-work", { windowId: 8 })]
  });
  await transaction.prepareComposite(normalBefore, privateBefore);
  await transaction.commitComposite(
    snapshot({ workspaceState: stateAfter }),
    snapshot({
      workspaceState: stateAfter,
      browserTabs: [browserTab("ws-default-personal", { windowId: 8 })]
    })
  );

  const normalEntry = storage.get("normal").entries[0];
  const privateEntry = storage.get("private").entries[0];
  assert.equal(normalEntry.state, SIDEBAR_UNDO_STATES.READY);
  assert.equal(privateEntry.state, SIDEBAR_UNDO_STATES.READY);
  assert.ok(normalEntry.affectedKeys.includes("workspace:ws-default-work"));
  assert.deepEqual(privateEntry.affectedKeys, ["tab:tab-one"]);
  assert.equal(normalEntry.before.browserTabs.length, 0);
  assert.equal(privateEntry.before.browserTabs.length, 0);

  let restoredEntries = null;
  const result = await service.execute({
    scope: "normal",
    windowId: 7,
    undoId: normalEntry.undoId,
    restore: async () => assert.fail("workspace removal must use its composite inverse"),
    restoreComposite: async (primary, companion) => {
      restoredEntries = [primary, companion];
      return "restored-both";
    }
  });
  assert.equal(result, "restored-both");
  assert.deepEqual(restoredEntries.map(({ state }) => state), ["consuming", "consuming"]);
  assert.equal(storage.get("normal").entries.length, 0);
  assert.equal(storage.get("private").entries.length, 0);
});

test("ending private browsing also invalidates a linked normal workspace-removal entry", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const transaction = service.createCompositeTransaction({
    primaryScope: "normal",
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
    label: "Remove workspace"
  });
  const before = snapshot({ browserTabs: [browserTab("ws-default-work")] });
  const after = snapshot({ browserTabs: [browserTab("ws-default-personal")] });
  await transaction.prepareComposite(before, before);
  await transaction.commitComposite(after, after);
  assert.equal((await service.getSummary("normal", 7)).available, true);
  await service.clearPrivate();
  assert.equal((await service.getSummary("normal", 7)).available, false);
  assert.equal(storage.get("private"), undefined);
});

test("an applied action whose ready write fails clears the slot and reports Undo unavailable", async () => {
  const storage = memoryStorage();
  const originalWrite = storage.write;
  let failReadyWrite = false;
  storage.write = async (scope, document) => {
    if (failReadyWrite && document.entries.some(({ state }) => state === SIDEBAR_UNDO_STATES.READY)) {
      failReadyWrite = false;
      throw new Error("synthetic session write failure");
    }
    return originalWrite(scope, document);
  };
  const service = new SidebarUndoService({ storage, createUuid: () => "entry-write-failure" });
  const transaction = service.createTransaction({
    scope: "normal",
    windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace"
  });
  await transaction.prepare(snapshot());
  failReadyWrite = true;
  const result = await transaction.commit(snapshot({ workspaceState: changedState("Office") }));
  assert.equal(result.applied, true);
  assert.equal(result.unavailable, true);
  assert.equal(transaction.finalization.unavailable, true);
  assert.equal((await service.getSummary("normal", 7)).available, false);
});

test("failApplied removes an interrupted entry instead of restoring older Undo out of order", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const first = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace"
  });
  await first.prepare(snapshot());
  await first.commit(snapshot({ workspaceState: changedState("Office") }));

  const second = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
    label: "Rename group"
  });
  await second.prepare(snapshot({ workspaceState: changedState("Office") }));
  const result = await second.failApplied();
  assert.equal(result.unavailable, true);
  assert.equal((await service.getSummary("normal", 7)).available, false);
});

test("session entries omit unrelated browsing descriptors and keep only closed tabs needed by recovery", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const firstTab = browserTab("ws-default-work", { logicalTabId: "tab-one", firefoxTabId: 11 });
  const secondTab = browserTab("ws-default-work", { logicalTabId: "tab-two", firefoxTabId: 12 });
  const before = snapshot({ browserTabs: [firstTab, secondTab] });

  const structural = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
    label: "Rename workspace"
  });
  await structural.prepare(before);
  assert.deepEqual(storage.get("normal").entries[0].before.browserTabs, []);
  await structural.abort();

  const close = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE,
    label: "Close tabs"
  });
  await close.prepare(before);
  await close.commit(snapshot({ browserTabs: [secondTab] }));
  assert.deepEqual(
    storage.get("normal").entries[0].before.browserTabs.map(({ logicalTabId }) => logicalTabId),
    ["tab-one"]
  );
});

test("a container-move entry keeps each moved tab's placement and container but not its page", async () => {
  const storage = memoryStorage();
  let uuid = 0;
  const service = new SidebarUndoService({ storage, createUuid: () => `entry-${++uuid}` });
  const moved = browserTab("ws-default-work", { logicalTabId: "tab-one", firefoxTabId: 11 });
  const untouched = browserTab("ws-default-work", { logicalTabId: "tab-two", firefoxTabId: 12 });
  const transaction = service.createTransaction({
    scope: "normal", windowId: 7,
    operation: SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE,
    label: "Move to container"
  });
  await transaction.prepare(snapshot({ browserTabs: [moved, untouched] }));
  await transaction.commit(snapshot({
    browserTabs: [{ ...moved, firefoxTabId: 13, containerRef: "ctr-work" }, untouched]
  }));

  const [entry] = storage.get("normal").entries;
  assert.deepEqual(entry.affectedKeys, ["tab:tab-one"]);
  assert.deepEqual(entry.before.browserTabs, [{ ...moved, url: "about:blank", title: "" }]);
  assert.equal((await service.getSummary("normal", 7)).operation, "tabs-container-move");
});

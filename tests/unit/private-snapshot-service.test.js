import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  PRIVATE_RECOVERY_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
  createPrivateDocument,
  createPrivateSnapshotRecord
} from "../../src/contracts/private-snapshots.js";
import { PrivateSnapshotService } from "../../src/core/private-snapshot-service.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

function inventoryFixture() {
  const payload = createSnapshotPayloadFixture({ containerAware: false });
  const savedWindow = payload.windows[0];
  const savedLayout = savedWindow.workspaceLayouts[0];
  const windowRuntime = {
    id: savedWindow.id,
    activeWorkspaceId: savedWindow.activeWorkspaceId,
    selectedTabs: structuredClone(savedWindow.selectedTabs),
    workspaceLayouts: [{
      workspaceId: savedLayout.workspaceId,
      tabIds: savedLayout.tabs.map(({ id }) => id),
      pinnedTabIds: structuredClone(savedLayout.pinnedTabIds),
      groups: structuredClone(savedLayout.groups),
      tree: structuredClone(savedLayout.tree),
      splitViews: structuredClone(savedLayout.splitViews)
    }],
    pendingOperation: null
  };
  return {
    payload,
    inventory: {
      state: structuredClone(payload.workspaceState),
      runtime: {
        schemaVersion: 5,
        tabs: savedLayout.tabs.map(({ id }) => ({ id, workspaceId: savedLayout.workspaceId })),
        windows: [windowRuntime]
      },
      requestedContext: null,
      contexts: new Map([[7, {
        windowId: 7,
        windowRuntime,
        splitViewChooserTabId: null,
        tabs: savedLayout.tabs.map((tab, index) => ({ id: 20 + index, logicalId: tab.id }))
      }]])
    }
  };
}

function harness({
  recovery = undefined,
  keep = false,
  restoreImplementation = null,
  inventoryState = null,
  idGenerator = () => "one"
} = {}) {
  const fixture = inventoryFixture();
  if (inventoryState) {
    fixture.inventory.state = structuredClone(inventoryState);
  }
  let storedRecovery = recovery;
  let settings = createDefaultSettingsState();
  settings.privacy.keepPrivateTabsBetweenSessions = keep;
  const calls = [];
  const storedSnapshots = new Map();
  const storage = {
    async readRecovery() { return structuredClone(storedRecovery); },
    async writeRecovery(value) { calls.push("write-recovery"); storedRecovery = structuredClone(value); },
    async removeRecovery() { calls.push("remove-recovery"); storedRecovery = undefined; },
    async quarantineRecovery(value) { calls.push(["quarantine", value]); storedRecovery = undefined; },
    async readSnapshotRecord(id) { return structuredClone(storedSnapshots.get(id)); },
    async writeSnapshotRecord(value) {
      calls.push(["write-snapshot", value.id]);
      storedSnapshots.set(value.id, structuredClone(value));
    },
    async removeSnapshotRecord(id) {
      calls.push(["remove-snapshot", id]);
      storedSnapshots.delete(id);
    },
    async listSnapshotRecords() {
      return [...storedSnapshots].map(([id, value]) => ({ id, value: structuredClone(value) }));
    },
    async readLastRestoreReport() { return undefined; },
    async writeRestoreJournal() {},
    async readRestoreJournal() { return undefined; },
    async clearRestoreJournal() {},
    async writeLastRestoreReport() {}
  };
  const browserAdapter = {
    async captureWindows() {
      return [{
        firefoxWindowId: 7,
        geometry: fixture.payload.windows[0].geometry,
        tabs: fixture.payload.windows[0].workspaceLayouts[0].tabs.map((tab, index) => ({
          firefoxTabId: 20 + index,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          highlighted: tab.highlighted,
          discarded: tab.discarded
        }))
      }];
    },
    async listNormalWindows() {
      return [{ id: 7, incognito: true, tabs: [{ id: 70, url: "about:privatebrowsing" }] }];
    }
  };
  let restoreCount = 0;
  let refreshInventoryCount = 0;
  const controller = {
    async captureInventory() { return fixture.inventory; },
    async performScopedRestore(windowId, operation) {
      return operation({
        inventory: fixture.inventory,
        convergeWindow: async () => undefined,
        refreshInventory: async () => {
          refreshInventoryCount += 1;
          return fixture.inventory;
        }
      });
    }
  };
  const service = new PrivateSnapshotService({
    storage,
    settingsService: {
      async getOrInitialize() { return structuredClone(settings); },
      async update(patch) {
        settings = {
          ...settings,
          privacy: { ...settings.privacy, ...patch.privacy }
        };
        return structuredClone(settings);
      }
    },
    controller,
    browserAdapter,
    restoreService: {
      async restoreSnapshot(options) {
        restoreCount += 1;
        return restoreImplementation
          ? restoreImplementation(options, restoreCount)
          : { status: "complete" };
      }
    },
    downloadsAdapter: { async downloadJson() { return 17; } },
    clock: () => new Date("2026-09-06T20:00:00.000Z"),
    idGenerator
  });
  return {
    service,
    calls,
    seedSnapshot(record) { storedSnapshots.set(record.id, structuredClone(record)); },
    recovery: () => structuredClone(storedRecovery),
    settings: () => structuredClone(settings),
    snapshots: () => structuredClone([...storedSnapshots.values()]),
    restoreCount: () => restoreCount,
    refreshInventoryCount: () => refreshInventoryCount
  };
}

test("private recovery is absent by default and opt-in capture is verified", async () => {
  const testHarness = harness();
  assert.deepEqual(await testHarness.service.captureRecovery(7), {
    captured: false,
    reason: "disabled"
  });
  assert.equal(testHarness.recovery(), undefined);

  const enabled = await testHarness.service.setPersistence(true, 7);
  assert.equal(enabled.captured, true);
  assert.equal(testHarness.settings().privacy.keepPrivateTabsBetweenSessions, true);
  assert.equal(testHarness.recovery().documentType, PRIVATE_RECOVERY_DOCUMENT_TYPE);
  assert.equal(testHarness.recovery().generation, 1);
  assert.equal(testHarness.calls.includes("write-recovery"), true);
});

test("disabling private persistence keeps recovery until the private session ends", async () => {
  const testHarness = harness();
  await testHarness.service.setPersistence(true, 7);
  const capturedRecovery = testHarness.recovery();
  assert.ok(capturedRecovery);

  await testHarness.service.setPersistence(false);
  assert.equal(testHarness.settings().privacy.keepPrivateTabsBetweenSessions, false);
  assert.deepEqual(testHarness.recovery(), capturedRecovery);

  assert.deepEqual(await testHarness.service.endSession(), { recoveryCleared: true });
  assert.equal(testHarness.recovery(), undefined);
});

test("explicitly clearing private recovery still suppresses the unchanged session", async () => {
  const testHarness = harness();
  await testHarness.service.setPersistence(true, 7);
  await testHarness.service.clearRecovery();
  assert.deepEqual(await testHarness.service.captureRecovery(7), {
    captured: false,
    reason: "cleared-unchanged"
  });
  assert.equal(testHarness.recovery(), undefined);
});

test("ending a persistent private session keeps its recovery", async () => {
  const testHarness = harness();
  await testHarness.service.setPersistence(true, 7);
  const capturedRecovery = testHarness.recovery();

  assert.deepEqual(await testHarness.service.endSession(), { recoveryCleared: false });
  assert.deepEqual(testHarness.recovery(), capturedRecovery);
});

test("a failed global reset can restore the exact cleared private recovery", async () => {
  const payload = createSnapshotPayloadFixture({ containerAware: false });
  const recovery = await createPrivateDocument({
    documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
    generation: 4,
    createdAt: "2026-09-06T19:30:00.000Z",
    payload
  });
  const testHarness = harness({ recovery, keep: true });

  const token = await testHarness.service.prepareRecoveryClear();
  assert.equal(testHarness.recovery(), undefined);
  await testHarness.service.restorePreparedRecovery(token);
  assert.deepEqual(testHarness.recovery(), recovery);
});

test("first untouched private window restores recovery once", async () => {
  const payload = createSnapshotPayloadFixture({ containerAware: false });
  const recovery = await createPrivateDocument({
    documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
    generation: 2,
    createdAt: "2026-09-06T19:00:00.000Z",
    payload
  });
  const testHarness = harness({ recovery, keep: true });
  const first = await testHarness.service.restoreRecoveryIfEligible(7);
  assert.equal(first.restored, true);
  assert.equal(testHarness.restoreCount(), 1);
  assert.deepEqual(await testHarness.service.restoreRecoveryIfEligible(7), {
    restored: false,
    reason: "already-attempted"
  });
  assert.equal(testHarness.restoreCount(), 1);
});

// Recovery is normally cleared when the last private window closes. A crash
// skips that, and startup only retries it when no private window came back, so
// data the user declined could otherwise sit on disk indefinitely.
test("recovery left by a crash is deleted when the setting is off", async () => {
  const recovery = await createPrivateDocument({
    documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
    generation: 3,
    createdAt: "2026-09-06T19:00:00.000Z",
    payload: createSnapshotPayloadFixture({ containerAware: false })
  });
  const testHarness = harness({ recovery, keep: false });

  assert.deepEqual(await testHarness.service.restoreRecoveryIfEligible(7), {
    restored: false,
    reason: "disabled-cleared"
  });
  assert.equal(testHarness.recovery(), undefined);
  assert.equal(testHarness.restoreCount(), 0);
});

test("nothing to delete reports plainly and writes nothing", async () => {
  const testHarness = harness({ keep: false });
  assert.deepEqual(await testHarness.service.restoreRecoveryIfEligible(7), {
    restored: false,
    reason: "disabled"
  });
  assert.equal(testHarness.calls.includes("remove-recovery"), false);
});

// Deleting a declined recovery must not engage the clear-suppression that an
// explicit clear uses, or turning the feature back on would capture nothing.
test("turning the setting back on captures again after a declined recovery is deleted", async () => {
  const recovery = await createPrivateDocument({
    documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
    generation: 3,
    createdAt: "2026-09-06T19:00:00.000Z",
    payload: createSnapshotPayloadFixture({ containerAware: false })
  });
  const testHarness = harness({ recovery, keep: false });
  await testHarness.service.restoreRecoveryIfEligible(7);

  const enabled = await testHarness.service.setPersistence(true, 7);
  assert.equal(enabled.captured, true);
  assert.equal(testHarness.recovery()?.documentType, PRIVATE_RECOVERY_DOCUMENT_TYPE);
});

test("corrupt recovery is quarantined instead of restored", async () => {
  const testHarness = harness({ recovery: { malformed: true }, keep: true });
  const result = await testHarness.service.restoreRecoveryIfEligible(7);
  assert.deepEqual(result, { restored: false, reason: "missing" });
  assert.equal(testHarness.calls.some((entry) => Array.isArray(entry) && entry[0] === "quarantine"), true);
  assert.equal(testHarness.recovery(), undefined);
});

test("private history requires a separate opt-in and keeps automatic records internal", async () => {
  const testHarness = harness();
  assert.deepEqual(await testHarness.service.captureAutomatic(testHarness.settings()), {
    created: false,
    reason: "disabled",
    record: null
  });

  await testHarness.service.setAutomaticSnapshots(true);
  const first = await testHarness.service.captureAutomatic(testHarness.settings());
  const second = await testHarness.service.captureAutomatic(testHarness.settings());
  assert.equal(first.created, true);
  assert.equal(first.record.private, true);
  assert.equal(first.record.kind, "automatic");
  assert.equal(second.created, false);
  assert.equal(testHarness.snapshots().length, 1);
  assert.equal(testHarness.calls.some(([kind]) => kind === "write-snapshot"), true);
});

async function seedPrivateHistory(testHarness, entries) {
  const payload = createSnapshotPayloadFixture({ containerAware: false });
  for (const [id, kind, createdAt] of entries) {
    testHarness.seedSnapshot(await createPrivateSnapshotRecord({ id, kind, createdAt, payload }));
  }
}

test("private cleanup enforces the maximum and never a save's age", async () => {
  const testHarness = harness();
  await seedPrivateHistory(testHarness, [
    ["private-snapshot-new", "automatic", "2026-09-06T19:00:00.000Z"],
    ["private-snapshot-mid", "automatic", "2026-09-01T00:00:00.000Z"],
    ["private-snapshot-old", "automatic", "2025-01-01T00:00:00.000Z"],
    ["private-snapshot-manual", "manual", "2020-01-01T00:00:00.000Z"]
  ]);
  const settings = testHarness.settings();
  settings.snapshots.retentionCount = 2;
  assert.deepEqual(await testHarness.service.cleanupAutomatic(settings), { removed: [] });

  settings.privacy.automaticSnapshotsEnabled = true;
  const removed = await testHarness.service.cleanupAutomatic(settings);
  assert.deepEqual(removed.removed.map(({ id }) => id), ["private-snapshot-old"]);

  // However old the remaining automatic saves are, only the maximum selects
  // them, and the manual save is never eligible.
  const unchanged = await testHarness.service.cleanupAutomatic(settings);
  assert.deepEqual(unchanged.removed.map(({ id }) => id), []);
  settings.snapshots.retentionCount = 1;
  const tightened = await testHarness.service.cleanupAutomatic(settings);
  assert.deepEqual(tightened.removed.map(({ id }) => id), ["private-snapshot-mid"]);
  assert.deepEqual(testHarness.snapshots().map(({ id }) => id).sort(), [
    "private-snapshot-manual",
    "private-snapshot-new"
  ]);
});

test("private cleanup previews count only for a private sender and never remove", async () => {
  const testHarness = harness();
  await seedPrivateHistory(testHarness, [
    ["private-snapshot-a", "automatic", "2026-09-06T19:00:00.000Z"],
    ["private-snapshot-b", "automatic", "2026-09-05T19:00:00.000Z"],
    ["private-snapshot-c", "automatic", "2026-09-04T19:00:00.000Z"]
  ]);
  const settings = testHarness.settings();
  settings.snapshots.retentionCount = 1;
  settings.privacy.automaticSnapshotsEnabled = true;

  assert.deepEqual(
    await testHarness.service.previewCleanup(settings, { privateContext: false }),
    { privateSnapshots: null }
  );
  assert.deepEqual(
    await testHarness.service.previewCleanup(settings, { privateContext: true }),
    { privateSnapshots: 2 }
  );
  settings.privacy.automaticSnapshotsEnabled = false;
  assert.deepEqual(
    await testHarness.service.previewCleanup(settings, { privateContext: true }),
    { privateSnapshots: 0 }
  );
  assert.equal(testHarness.snapshots().length, 3);
  assert.equal(testHarness.calls.some((entry) => Array.isArray(entry) && entry[0] === "remove-snapshot"), false);
});

test("private history supports the standard viewer import, restore, and clear actions", async () => {
  const testHarness = harness();
  const created = await testHarness.service.createStored(7);
  const stored = await testHarness.service.getStored(created.record.id);
  const preview = await testHarness.service.previewText(
    JSON.stringify(stored)
  );
  assert.equal(preview.kind, "snapshot");
  assert.equal(preview.tabCount, 3);

  const restored = await testHarness.service.restoreViewer({
    source: { id: created.record.id },
    request: { scope: "all" },
    windowId: 7
  });
  assert.equal(restored.status, "complete");
  assert.equal(testHarness.restoreCount(), 1);

  const cleared = await testHarness.service.clearStored();
  assert.deepEqual(cleared, { removed: 1, manual: 1, automatic: 0 });
  assert.equal(testHarness.snapshots().length, 0);

  const imported = await testHarness.service.importSnapshotText(JSON.stringify(stored));
  assert.equal(imported.kind, "snapshot");
  assert.equal(imported.record.private, true);
  assert.equal(testHarness.snapshots().length, 1);
});

test("private destructive restore rolls back from a verified memory-only safety record", async () => {
  const primary = new Error("primary restore failed");
  const seen = [];
  const testHarness = harness({
    restoreImplementation: async (options, restoreCount) => {
      seen.push(options);
      if (restoreCount === 1) {
        await options.createSafetySnapshot();
        await options.recoverAfterDestructiveFailure({
          failure: primary,
          phase: "cleanup",
          report: { status: "partial" }
        });
        throw primary;
      }
      assert.equal(options.record.kind, "safety");
      assert.equal(options.record.reason, "private-snapshot-rollback");
      assert.equal(options.request.scope, "all");
      assert.equal(options.recoverAfterDestructiveFailure, undefined);
      await options.createSafetySnapshot();
      return { status: "complete" };
    }
  });
  const created = await testHarness.service.createStored(7);
  const recordsBefore = testHarness.snapshots();

  await assert.rejects(
    testHarness.service.restoreViewer({
      source: { id: created.record.id },
      request: { scope: "all" },
      windowId: 7
    }),
    (error) => error === primary
  );

  assert.equal(testHarness.restoreCount(), 2);
  assert.equal(testHarness.refreshInventoryCount(), 1);
  assert.equal(seen[0].record.kind, "manual");
  assert.deepEqual(testHarness.snapshots(), recordsBefore);
});

test("private restore maps definitions from the inventory inside the serialized operation", async () => {
  const sourcePayload = createSnapshotPayloadFixture({ containerAware: false });
  const inventoryState = structuredClone(sourcePayload.workspaceState);
  const concurrentWorkspace = {
    ...structuredClone(inventoryState.workspaces[0]),
    id: "ws-concurrent",
    name: "Concurrent workspace"
  };
  inventoryState.workspaces.push(concurrentWorkspace);
  inventoryState.rail.push({ kind: "workspace", workspaceId: concurrentWorkspace.id });
  const document = await createPrivateDocument({
    documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    createdAt: "2026-09-06T19:45:00.000Z",
    payload: sourcePayload
  });
  let restoredState;
  const testHarness = harness({
    inventoryState,
    restoreImplementation: async ({ record }) => {
      restoredState = record.payload.workspaceState;
      return { status: "complete" };
    }
  });

  await testHarness.service.restoreViewer({
    source: { text: JSON.stringify(document) },
    request: { scope: "all" },
    windowId: 7
  });

  assert.ok(restoredState.workspaces.some(({ id }) => id === concurrentWorkspace.id));
  assert.ok(
    restoredState.rail.some(
      ({ kind, workspaceId }) => kind === "workspace" && workspaceId === concurrentWorkspace.id
    )
  );
});

test("private restore keeps an incompatible exact-ID collision separate and remaps its tabs", async () => {
  const sourcePayload = createSnapshotPayloadFixture({ containerAware: false });
  const inventoryState = {
    schemaVersion: sourcePayload.workspaceState.schemaVersion,
    workspaces: [{
      id: "ws-source",
      name: "Unrelated live workspace",
      icon: "user",
      color: "#112233",
      defaultContainerRef: null
    }],
    rail: [{ kind: "workspace", workspaceId: "ws-source" }]
  };
  const document = await createPrivateDocument({
    documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    createdAt: "2026-09-06T19:45:00.000Z",
    payload: sourcePayload
  });
  let restoredPayload;
  const testHarness = harness({
    inventoryState,
    restoreImplementation: async ({ record }) => {
      restoredPayload = record.payload;
      return { status: "complete" };
    }
  });

  await testHarness.service.restoreViewer({
    source: { text: JSON.stringify(document) },
    request: { scope: "all" },
    windowId: 7
  });

  const mappedId = "private-one";
  assert.deepEqual(restoredPayload.workspaceState.workspaces.map(({ id }) => id), [
    "ws-source",
    mappedId
  ]);
  assert.equal(restoredPayload.workspaceState.workspaces[0].name, "Unrelated live workspace");
  assert.equal(restoredPayload.windows[0].activeWorkspaceId, mappedId);
  assert.deepEqual(restoredPayload.windows[0].selectedTabs.map(({ workspaceId }) => workspaceId), [mappedId]);
  assert.deepEqual(restoredPayload.windows[0].workspaceLayouts.map(({ workspaceId }) => workspaceId), [mappedId]);
  assert.deepEqual(
    restoredPayload.windows[0].workspaceLayouts[0].groups[0].tabIds,
    ["tab-two", "tab-three"]
  );
});

test("private restore never merges different IDs solely because their presentation matches", async () => {
  const sourcePayload = createSnapshotPayloadFixture({ containerAware: false });
  const sourceWorkspace = sourcePayload.workspaceState.workspaces[0];
  const inventoryState = {
    schemaVersion: sourcePayload.workspaceState.schemaVersion,
    workspaces: [{ ...sourceWorkspace, id: "ws-lookalike" }],
    rail: [{ kind: "workspace", workspaceId: "ws-lookalike" }]
  };
  const document = await createPrivateDocument({
    documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    createdAt: "2026-09-06T19:45:00.000Z",
    payload: sourcePayload
  });
  let restoredPayload;
  const testHarness = harness({
    inventoryState,
    restoreImplementation: async ({ record }) => {
      restoredPayload = record.payload;
      return { status: "complete" };
    }
  });

  await testHarness.service.restoreViewer({
    source: { text: JSON.stringify(document) },
    request: { scope: "all" },
    windowId: 7
  });

  assert.deepEqual(restoredPayload.workspaceState.workspaces.map(({ id }) => id), [
    "ws-lookalike",
    "private-one"
  ]);
  assert.equal(restoredPayload.windows[0].workspaceLayouts[0].workspaceId, "private-one");
});

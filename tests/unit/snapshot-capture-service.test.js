import test from "node:test";
import assert from "node:assert/strict";

import { SNAPSHOT_ERROR_CODES } from "../../src/contracts/snapshots.js";
import { SnapshotCaptureService } from "../../src/core/snapshot-capture-service.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

function inventoryFixture({ pending = false } = {}) {
  const payload = createSnapshotPayloadFixture();
  const layout = payload.windows[0].workspaceLayouts[0];
  const windowRuntime = {
    id: "window-source",
    activeWorkspaceId: "ws-source",
    selectedTabs: payload.windows[0].selectedTabs,
    workspaceLayouts: [
      {
        workspaceId: layout.workspaceId,
        tabIds: layout.tabs.map(({ id }) => id),
        pinnedTabIds: layout.pinnedTabIds,
        groups: layout.groups,
        tree: layout.tree,
        splitViews: layout.splitViews
      }
    ],
    pendingOperation: pending ? { id: "operation-one", kind: "reconcile-layout" } : null
  };
  return {
    state: payload.workspaceState,
    runtime: {
      schemaVersion: 5,
      tabs: layout.tabs.map(({ id }) => ({ id, workspaceId: "ws-source" })),
      windows: [windowRuntime]
    },
    contexts: new Map([
      [
        7,
        {
          windowId: 7,
          windowRuntime,
          splitViewChooserTabId: null,
          tabs: layout.tabs.map((tab, index) => ({ id: 20 + index, logicalId: tab.id }))
        }
      ]
    ])
  };
}

test("capture joins URL-bearing Firefox tabs to reconciled logical layout", async () => {
  const fixture = createSnapshotPayloadFixture();
  const service = new SnapshotCaptureService({
    async captureWindows() {
      return [
        {
          firefoxWindowId: 7,
          geometry: fixture.windows[0].geometry,
          tabs: fixture.windows[0].workspaceLayouts[0].tabs.map((tab, index) => ({
            firefoxTabId: 20 + index,
            url: tab.url,
            title: tab.title,
            active: tab.active,
            highlighted: tab.highlighted,
            discarded: tab.discarded,
            cookieStoreId: "firefox-default"
          }))
        }
      ];
    }
  }, {
    containerService: {
      async assignmentsForCookieStores(cookieStoreIds) {
        return cookieStoreIds.map(() => ({ kind: "none" }));
      },
      async projectCatalog() { return []; }
    }
  });
  const captured = await service.capture(inventoryFixture());
  assert.deepEqual(captured, fixture);
});

test("capture describes only open windows, not records kept for closed ones", async () => {
  const fixture = createSnapshotPayloadFixture();
  const inventory = inventoryFixture();
  inventory.runtime.tabs.push({ id: "tab-closed-window", workspaceId: "ws-source" });
  inventory.runtime.windows.push({
    id: "window-closed",
    activeWorkspaceId: "ws-source",
    selectedTabs: [],
    workspaceLayouts: [{
      workspaceId: "ws-source",
      tabIds: ["tab-closed-window"],
      pinnedTabIds: [],
      groups: [],
      tree: [{ tabId: "tab-closed-window", parentTabId: null, collapsed: false }],
      splitViews: []
    }],
    pendingOperation: null
  });
  const service = new SnapshotCaptureService({
    async captureWindows(windowIds) {
      assert.deepEqual(windowIds, [7]);
      return [{
        firefoxWindowId: 7,
        geometry: fixture.windows[0].geometry,
        tabs: fixture.windows[0].workspaceLayouts[0].tabs.map((tab, index) => ({
          firefoxTabId: 20 + index,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          highlighted: tab.highlighted,
          discarded: tab.discarded,
          cookieStoreId: "firefox-default"
        }))
      }];
    }
  }, {
    containerService: {
      async assignmentsForCookieStores(cookieStoreIds) {
        return cookieStoreIds.map(() => ({ kind: "none" }));
      },
      async projectCatalog() { return []; }
    }
  });
  assert.deepEqual(await service.capture(inventory), fixture);
});

test("capture refuses pending workspace operations before storing URLs", async () => {
  const service = new SnapshotCaptureService({
    async captureWindows() { assert.fail("blocked capture must not read URL-bearing tabs"); }
  });
  await assert.rejects(
    service.capture(inventoryFixture({ pending: true })),
    (error) => error.code === SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED
  );
});

test("capture records mixed tab assignments and the exact referenced catalog", async () => {
  const fixture = createSnapshotPayloadFixture();
  const inventory = inventoryFixture();
  inventory.state.workspaces[0].defaultContainerRef = "ctr-default";
  const cookieStoreIds = [
    "firefox-container-1",
    "firefox-default",
    "firefox-container-2"
  ];
  let projectedRefs;
  const service = new SnapshotCaptureService({
    async captureWindows() {
      return [{
        firefoxWindowId: 7,
        geometry: fixture.windows[0].geometry,
        tabs: fixture.windows[0].workspaceLayouts[0].tabs.map((tab, index) => ({
          firefoxTabId: 20 + index,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          highlighted: tab.highlighted,
          discarded: tab.discarded,
          cookieStoreId: cookieStoreIds[index]
        }))
      }];
    }
  }, {
    containerService: {
      async assignmentsForCookieStores(actual) {
        assert.deepEqual(actual, cookieStoreIds);
        return [
          { kind: "container", refId: "ctr-work" },
          { kind: "none" },
          { kind: "container", refId: "ctr-personal" }
        ];
      },
      async projectCatalog(refs) {
        projectedRefs = refs;
        return [...new Set(refs)].sort().map((refId) => ({
          refId,
          descriptor: {
            name: refId,
            color: "blue",
            icon: "briefcase",
            colorCode: null
          }
        }));
      }
    }
  });

  const captured = await service.capture(inventory);
  assert.deepEqual(
    captured.windows[0].workspaceLayouts[0].tabs.map(({ container }) => container),
    [
      { kind: "container", refId: "ctr-work" },
      { kind: "none" },
      { kind: "container", refId: "ctr-personal" }
    ]
  );
  assert.deepEqual(projectedRefs, ["ctr-work", "ctr-personal", "ctr-default"]);
  assert.deepEqual(
    captured.containerCatalog.map(({ refId }) => refId),
    ["ctr-default", "ctr-personal", "ctr-work"]
  );
  assert.equal(JSON.stringify(captured).includes("firefox-container-"), false);
});

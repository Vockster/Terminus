import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_DOCUMENT_TYPE,
  SNAPSHOT_KINDS,
  SNAPSHOT_PREVIOUS_SCHEMA_VERSION,
  SNAPSHOT_RESTORE_MODES,
  SNAPSHOT_RESTORE_SCOPES,
  canonicalJson,
  createSnapshotRecord,
  finalizeSettingsBackup,
  parseSnapshotRestoreReport
} from "../../src/contracts/snapshots.js";
import { parseWorkspaceRuntime } from "../../src/contracts/workspace-runtime.js";
import { parseWorkspaceState } from "../../src/contracts/workspace-state.js";
import { SnapshotRestoreService } from "../../src/core/snapshot-restore-service.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

function currentInventory({
  workspace = {
    id: "ws-current",
    name: "Current",
    icon: "home",
    color: "#112233",
    defaultContainerRef: null
  },
  logicalTabs = [{ id: "tab-current", firefoxId: 70 }]
} = {}) {
  workspace = { ...workspace, defaultContainerRef: workspace.defaultContainerRef ?? null };
  const state = parseWorkspaceState({
    schemaVersion: 5,
    workspaces: [workspace],
    rail: [{ kind: "workspace", workspaceId: workspace.id }]
  });
  const windowRuntime = {
    id: "window-current",
    activeWorkspaceId: workspace.id,
    selectedTabs: [{ workspaceId: workspace.id, tabId: logicalTabs[0].id }],
    workspaceLayouts: [
      {
        workspaceId: workspace.id,
        tabIds: logicalTabs.map(({ id }) => id),
        pinnedTabIds: [],
        groups: [],
        tree: logicalTabs.map(({ id }) => ({ tabId: id, parentTabId: null, collapsed: false })),
        splitViews: []
      }
    ],
    pendingOperation: null
  };
  const runtime = parseWorkspaceRuntime(
    {
      schemaVersion: 5,
      tabs: logicalTabs.map(({ id }) => ({ id, workspaceId: workspace.id })),
      windows: [windowRuntime]
    },
    [workspace.id]
  );
  const context = {
    windowId: 7,
    windowRuntime,
    splitViewChooserTabId: null,
    tabs: logicalTabs.map(({ id, firefoxId, splitViewId = -1 }, index) => ({
      id: firefoxId,
      logicalId: id,
      index,
      active: index === 0,
      hidden: false,
      discarded: false,
      splitViewId
    }))
  };
  return {
    state,
    runtime,
    contexts: new Map([[7, context]]),
    requestedContext: context
  };
}

function twoWindowInventory() {
  const inventory = currentInventory();
  const secondWindow = {
    id: "window-other",
    activeWorkspaceId: "ws-current",
    selectedTabs: [{ workspaceId: "ws-current", tabId: "tab-other" }],
    workspaceLayouts: [{
      workspaceId: "ws-current",
      tabIds: ["tab-other"],
      pinnedTabIds: [],
      groups: [],
      tree: [{ tabId: "tab-other", parentTabId: null, collapsed: false }],
      splitViews: []
    }],
    pendingOperation: null
  };
  const context = {
    windowId: 8,
    windowRuntime: secondWindow,
    splitViewChooserTabId: null,
    tabs: [{
      id: 80,
      logicalId: "tab-other",
      index: 0,
      active: true,
      hidden: false,
      discarded: false,
      splitViewId: -1
    }]
  };
  return {
    ...inventory,
    runtime: parseWorkspaceRuntime({
      schemaVersion: 5,
      tabs: [...inventory.runtime.tabs, { id: "tab-other", workspaceId: "ws-current" }],
      windows: [...inventory.runtime.windows, secondWindow]
    }, ["ws-current"]),
    contexts: new Map([...inventory.contexts, [8, context]])
  };
}

function harness({
  initialJournal = null,
  initialWindows = [{ id: 7, tabIds: [70] }],
  failedRemovalIds = [],
  failedWindowRemovalIds = [],
  containerService = null,
  createTabError = null,
  failCreateTabAt = null,
  asyncCreateTab = false,
  failClearCount = 0,
  customIcons = [],
  customIconCompatibility = null
} = {}) {
  const calls = [];
  const tabCallSizes = { hide: [], remove: [] };
  const inFlight = { current: 0, max: 0 };
  let createTabCount = 0;
  let getTabCount = 0;
  let journal = structuredClone(initialJournal);
  const windows = new Map(initialWindows.map(({ id, tabIds }) => [id, new Set(tabIds)]));
  const removalFailures = new Set(failedRemovalIds);
  const windowRemovalFailures = new Set(failedWindowRemovalIds);
  let nextTab = 1000;
  let nextWindow = 100;
  const stateWrites = [];
  const runtimeWrites = [];
  const createdTabWindowIds = [];
  const createdTabOptions = [];
  const journalWrites = [];
  const lastReports = [];
  const updates = [];
  const discards = [];
  const browser = {
    prepareUrl(url) {
      return { url, supported: /^https?:/.test(url) };
    },
    async createWindow(_url, _geometry, options = {}) {
      calls.push("create-window");
      createdTabOptions.push(structuredClone(options));
      const id = nextWindow++;
      const tabId = nextTab++;
      windows.set(id, new Set([tabId]));
      return { window: { id, tabs: [{ id: tabId }] }, geometryApplied: true, urlSupported: true };
    },
    async createTab(windowId, url, options = {}) {
      calls.push("create-tab");
      createdTabWindowIds.push(windowId);
      createdTabOptions.push(structuredClone(options));
      const position = createTabCount++;
      inFlight.current += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.current);
      try {
        if (asyncCreateTab) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (createTabError) throw createTabError;
        if (position === failCreateTabAt) throw new Error("Synthetic tab creation failure");
        const id = nextTab++;
        windows.get(windowId)?.add(id);
        // Mirrors the Firefox adapter: about: and active tabs cannot start unloaded.
        const supported = /^https?:/.test(url);
        return {
          tab: { id },
          urlSupported: supported,
          discarded: options.discarded === true && options.active !== true && supported
        };
      } finally {
        inFlight.current -= 1;
      }
    },
    async setWindowIdentity() {},
    async setTabIdentity() {},
    async setTabGroupIdentity() {},
    async createGroup() { calls.push("create-group"); return 9; },
    async updateTab(tabId, changes) { calls.push("update-tab"); updates.push([tabId, changes]); },
    async hideTabs(ids) { tabCallSizes.hide.push(ids.length); },
    async discardTab(tabId) { calls.push("discard-tab"); discards.push(tabId); },
    async listTabs(windowId) {
      return [...(windows.get(windowId) ?? [])].map((id, index) => ({ id, index, windowId }));
    },
    async highlightTabs() {},
    async getTab(id) {
      getTabCount += 1;
      for (const [windowId, tabIds] of windows) {
        if (tabIds.has(id)) {
          return { id, windowId };
        }
      }
      throw new Error("missing");
    },
    async removeTabs(ids) {
      calls.push("remove-original");
      tabCallSizes.remove.push(ids.length);
      for (const id of ids) {
        if (removalFailures.has(id)) {
          continue;
        }
        for (const tabIds of windows.values()) {
          tabIds.delete(id);
        }
      }
      if (ids.some((id) => removalFailures.has(id))) {
        throw new Error("close refused");
      }
    },
    async removeWindow(windowId) {
      calls.push(`remove-window:${windowId}`);
      if (windowRemovalFailures.has(windowId)) {
        throw new Error("close refused");
      }
      windows.delete(windowId);
    },
    async listNormalWindows() {
      return [...windows].map(([id, tabIds]) => ({
        id,
        tabs: [...tabIds].map((tabId, index) => ({ id: tabId, index, windowId: id }))
      }));
    }
  };
  let id = 0;
  const customIconService = {
    async list() {
      return {
        icons: customIcons.map((icon) => typeof icon === "string" ? { id: icon } : icon),
        usage: { iconCount: customIcons.length, byteCount: 0 }
      };
    }
  };
  if (customIconCompatibility !== null) {
    customIconService.snapshotCompatibility = async () => ({
      icons: customIcons.map((icon) => typeof icon === "string" ? { id: icon } : icon),
      compatibility: structuredClone(customIconCompatibility)
    });
  }
  const service = new SnapshotRestoreService({
    browserAdapter: browser,
    repository: {
      async readRestoreJournal() { return structuredClone(journal); },
      async writeRestoreJournal(value) {
        journal = structuredClone(value);
        journalWrites.push(structuredClone(value));
        calls.push(`journal:${value.phase}`);
      },
      async clearRestoreJournal() {
        calls.push("journal:clear");
        if (failClearCount > 0) {
          failClearCount -= 1;
          throw new Error("journal clear failed");
        }
        journal = null;
      },
      async writeLastRestoreReport(value) {
        lastReports.push(structuredClone(value));
        calls.push(`report:${value.status}`);
      },
      async writeLastSettingsRestoreReport(value) { calls.push(`settings-report:${value.status}`); }
    },
    stateService: {
      async replaceForRestore(value) { stateWrites.push(parseWorkspaceState(value)); calls.push("write-state"); return value; }
    },
    runtimeService: {
      async save(value, workspaceIds) { runtimeWrites.push(parseWorkspaceRuntime(value, workspaceIds)); calls.push("write-runtime"); return value; }
    },
    settingsTransferService: {
      async applyDocuments({ journal: applyJournal, convergeWindows }) {
        calls.push("transaction");
        runtimeWrites.push(applyJournal.after.runtime);
        stateWrites.push(applyJournal.after.workspaceState);
        calls.push("write-runtime", "write-state", "write-settings");
        if (applyJournal.report.workspaceDefinitionsChanged) {
          await convergeWindows();
        }
        return applyJournal.report;
      }
    },
    containerService,
    customIconService,
    clock: () => new Date("2026-09-05T20:00:00.000Z"),
    idGenerator: () => `id-${++id}`
  });
  return {
    service,
    calls,
    stateWrites,
    runtimeWrites,
    createdTabWindowIds,
    createdTabOptions,
    journalWrites,
    lastReports,
    windows,
    updates,
    discards,
    tabCallSizes,
    inFlight,
    getTabCount: () => getTabCount,
    async createSafetySnapshot(reason) { calls.push(`safety:${reason}`); },
    async convergeWindow(windowId) { calls.push(`converge:${windowId}`); }
  };
}

async function snapshotRecord() {
  return createSnapshotRecord({
    id: "snapshot-source",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T19:00:00.000Z",
    payload: createSnapshotPayloadFixture()
  });
}

async function previousSnapshotRecordWithIcon(icon) {
  const current = createSnapshotPayloadFixture();
  current.workspaceState.workspaces[0].icon = icon;
  const payload = {
    workspaceState: {
      ...current.workspaceState,
      schemaVersion: 4,
      workspaces: current.workspaceState.workspaces.map(
        ({ defaultContainerRef: _defaultContainerRef, ...workspace }) => workspace
      )
    },
    windows: current.windows.map((window) => ({
      ...window,
      workspaceLayouts: window.workspaceLayouts.map((layout) => ({
        ...layout,
        tabs: layout.tabs.map(({ container: _container, ...tab }) => tab)
      }))
    }))
  };
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return {
    documentType: SNAPSHOT_DOCUMENT_TYPE,
    schemaVersion: SNAPSHOT_PREVIOUS_SCHEMA_VERSION,
    id: "snapshot-previous-custom-icon",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T19:00:00.000Z",
    reason: null,
    payloadDigest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    payload
  };
}

const workContainerDescriptor = Object.freeze({
  name: "Work",
  color: "blue",
  icon: "briefcase",
  colorCode: "#37adff"
});

async function containerSnapshotRecord({ reason = "file-import", allTabs = false } = {}) {
  const payload = createSnapshotPayloadFixture();
  payload.workspaceState.workspaces[0].defaultContainerRef = "ctr-work";
  for (const [index, tab] of payload.windows[0].workspaceLayouts[0].tabs.entries()) {
    if (allTabs || index === 0) {
      tab.container = { kind: "container", refId: "ctr-work" };
    }
  }
  payload.containerCatalog = [{ refId: "ctr-work", descriptor: workContainerDescriptor }];
  return createSnapshotRecord({
    id: "snapshot-container-source",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T19:00:00.000Z",
    reason,
    payload
  });
}

async function protectedSnapshotRecord() {
  const payload = createSnapshotPayloadFixture();
  payload.windows[0].workspaceLayouts[0].tabs[0].url = "about:config";
  return createSnapshotRecord({
    id: "snapshot-protected",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T19:00:00.000Z",
    payload
  });
}

async function largeSnapshotRecord({ activeCount, otherCount }) {
  const payload = createSnapshotPayloadFixture();
  payload.workspaceState.workspaces.push({
    id: "ws-bulk-other",
    name: "Other",
    icon: "user",
    color: "#446688",
    defaultContainerRef: null
  });
  payload.workspaceState.rail.push({ kind: "workspace", workspaceId: "ws-bulk-other" });
  const layout = (workspaceId, prefix, count) => {
    const tabs = Array.from({ length: count }, (_, index) => ({
      id: `tab-${prefix}-${index}`,
      url: `https://bulk.invalid/${prefix}/${index}`,
      title: `Bulk ${prefix} ${index}`,
      active: index === 0,
      highlighted: index === 0,
      discarded: index % 2 === 1,
      container: { kind: "none" }
    }));
    return {
      workspaceId,
      tabs,
      pinnedTabIds: [],
      groups: [],
      tree: tabs.map(({ id }) => ({ tabId: id, parentTabId: null, collapsed: false })),
      splitViews: []
    };
  };
  payload.windows[0].selectedTabs = [
    { workspaceId: "ws-source", tabId: "tab-a-0" },
    ...(otherCount > 0 ? [{ workspaceId: "ws-bulk-other", tabId: "tab-b-0" }] : [])
  ];
  payload.windows[0].workspaceLayouts = [
    layout("ws-source", "a", activeCount),
    layout("ws-bulk-other", "b", otherCount)
  ];
  return createSnapshotRecord({
    id: "snapshot-bulk",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T19:00:00.000Z",
    payload
  });
}

async function multiWindowSnapshotRecord({ secondSelectedTabId = "tab-four" } = {}) {
  const payload = createSnapshotPayloadFixture();
  const second = structuredClone(payload.windows[0]);
  second.id = "window-second";
  const tabIds = new Map([
    ["tab-one", "tab-four"],
    ["tab-two", "tab-five"],
    ["tab-three", "tab-six"]
  ]);
  second.workspaceLayouts[0].tabs = second.workspaceLayouts[0].tabs.map((tab) => ({
    ...tab,
    id: tabIds.get(tab.id)
  }));
  second.workspaceLayouts[0].pinnedTabIds = ["tab-four"];
  second.workspaceLayouts[0].groups = second.workspaceLayouts[0].groups.map((group) => ({
    ...group,
    id: "group-second",
    tabIds: group.tabIds.map((id) => tabIds.get(id))
  }));
  second.workspaceLayouts[0].tree = second.workspaceLayouts[0].tree.map((node) => ({
    ...node,
    tabId: tabIds.get(node.tabId),
    parentTabId: node.parentTabId === null ? null : tabIds.get(node.parentTabId)
  }));
  second.workspaceLayouts[0].splitViews = second.workspaceLayouts[0].splitViews.map((split) => ({
    ...split,
    id: "split-second",
    tabIds: split.tabIds.map((id) => tabIds.get(id))
  }));
  second.selectedTabs = [{ workspaceId: "ws-source", tabId: secondSelectedTabId }];
  for (const tab of second.workspaceLayouts[0].tabs) {
    tab.active = tab.id === secondSelectedTabId;
  }
  payload.windows.push(second);
  return createSnapshotRecord({
    id: "snapshot-multi-window",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-05T19:00:00.000Z",
    payload
  });
}

test("whole restore replaces the current session with the exact saved workspace state", async () => {
  const {
    service,
    calls,
    stateWrites,
    runtimeWrites,
    createdTabWindowIds,
    windows,
    createSafetySnapshot,
    convergeWindow
  } = harness();
  const report = await service.restoreSnapshot({
    windowId: 7,
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });
  assert.equal(report.status, "complete");
  assert.deepEqual(report.created, { workspaces: 1, windows: 0, tabs: 3 });
  assert.equal(report.applied.groups, 1);
  assert.equal(report.applied.pins, 1);
  assert.equal(report.applied.discarded, 2, "every restored tab except the selected one stays unloaded");
  assert.equal(report.applied.replacedTabs, 0);
  assert.equal(report.applied.closedTabs, 1);
  assert.equal(report.applied.closedWindows, 0);
  assert.equal(report.applied.workspaces, 0);
  assert.equal(report.mode, SNAPSHOT_RESTORE_MODES.OVERWRITE);
  assert.ok(report.approximations.some(({ kind }) => kind === "split-restored-as-adjacent-tabs"));
  assert.equal(stateWrites.at(-1).workspaces.length, 1);
  assert.deepEqual(stateWrites.at(-1).workspaces.map(({ id }) => id), ["ws-source"]);
  assert.deepEqual(
    stateWrites.at(-1).rail.map(({ workspaceId }) => workspaceId),
    ["ws-source"]
  );
  assert.equal(runtimeWrites.at(-1).tabs.length, 3);
  assert.equal(runtimeWrites.at(-1).tabs.some(({ id }) => id === "tab-current"), false);
  assert.ok(runtimeWrites.at(-1).tabs.every(({ id }) => id !== "tab-one"));
  assert.ok(calls.includes("safety:snapshot-session-overwrite"));
  assert.ok(calls.indexOf("safety:snapshot-session-overwrite") < calls.indexOf("journal:planned"));
  assert.equal(calls.includes("create-window"), false);
  assert.deepEqual([...windows.keys()], [7]);
  assert.equal(windows.get(7).size, 3);
  assert.deepEqual(createdTabWindowIds, [7, 7, 7]);
  assert.ok(calls.indexOf("create-tab") < calls.indexOf("write-state"));
  assert.ok(calls.indexOf("write-runtime") < calls.indexOf("remove-original"));
  assert.ok(calls.indexOf("write-runtime") < calls.indexOf("converge:7"));
});

test("a post-cleanup restore failure invokes destructive recovery and preserves the primary error", async () => {
  const {
    service,
    calls,
    lastReports,
    createSafetySnapshot,
    convergeWindow
  } = harness({ failClearCount: 1 });
  let primary;
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow,
      recoverAfterDestructiveFailure: async ({ failure, phase, report }) => {
        assert.equal(failure.message, "journal clear failed");
        assert.equal(phase, "verifying");
        assert.equal(report.status, "partial");
        calls.push("destructive-recovery");
      }
    }),
    (error) => {
      primary = error;
      return true;
    }
  );

  assert.equal(primary.message, "journal clear failed");
  assert.equal(calls.filter((entry) => entry === "destructive-recovery").length, 1);
  assert.equal(calls.filter((entry) => entry === "journal:clear").length, 2);
  assert.ok(lastReports.at(-1).failures.some(
    ({ kind, detail }) => kind === "private-rollback-complete" && detail === "verifying"
  ));
});

test("a pre-cleanup restore failure never invokes destructive recovery", async () => {
  const expected = new Error("create failed");
  const { service, createSafetySnapshot, convergeWindow } = harness({ createTabError: expected });
  let recoveryCalls = 0;
  let actual;
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow,
      recoverAfterDestructiveFailure: async () => { recoveryCalls += 1; }
    }),
    (error) => {
      actual = error;
      return true;
    }
  );

  assert.equal(actual, expected);
  assert.equal(recoveryCalls, 0);
});

test("a failed destructive recovery retains both errors behind a stable restore error", async () => {
  const { service, createSafetySnapshot, convergeWindow } = harness({ failClearCount: 1 });
  const rollbackFailure = new Error("rollback failed");
  let error;
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow,
      recoverAfterDestructiveFailure: async () => { throw rollbackFailure; }
    }),
    (caught) => {
      error = caught;
      return true;
    }
  );

  assert.equal(error.code, SNAPSHOT_ERROR_CODES.INTERNAL_ERROR);
  assert.ok(error.cause instanceof AggregateError);
  assert.equal(error.cause.errors[0].message, "journal clear failed");
  assert.equal(error.cause.errors[1], rollbackFailure);
});

test("container restore preflight counts uses and treats metadata as a suggestion", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [{
          refId: "ctr-local",
          descriptor: workContainerDescriptor,
          status: "available"
        }],
        supportedColors: ["blue"],
        supportedIcons: ["briefcase"]
      };
    }
  };
  const { service } = harness({ containerService });
  const preflight = await service.containerPreflight(
    await containerSnapshotRecord(),
    { scope: SNAPSHOT_RESTORE_SCOPES.ALL }
  );

  assert.equal(preflight.required, true);
  assert.deepEqual(preflight.references, [{
    refId: "ctr-work",
    descriptor: workContainerDescriptor,
    tabCount: 1,
    workspaceDefaultCount: 1,
    autoReuse: false,
    suggestedRefIds: ["ctr-local"],
    nameMatchRefIds: ["ctr-local"]
  }]);
});

test("restore Match candidates require exact-case names and exact native presentation", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [
          {
            refId: "ctr-exact",
            descriptor: workContainerDescriptor,
            status: "available"
          },
          {
            refId: "ctr-wrong-case",
            descriptor: { ...workContainerDescriptor, name: "WORK" },
            status: "available"
          },
          {
            refId: "ctr-wrong-color",
            descriptor: { ...workContainerDescriptor, color: "red", colorCode: "#ff613d" },
            status: "available"
          }
        ],
        supportedColors: ["blue", "red"],
        supportedIcons: ["briefcase"]
      };
    }
  };
  const { service } = harness({ containerService });

  const preflight = await service.containerPreflight(
    await containerSnapshotRecord(),
    { scope: SNAPSHOT_RESTORE_SCOPES.ALL }
  );

  assert.deepEqual(preflight.references[0].suggestedRefIds, ["ctr-exact"]);
  assert.deepEqual(preflight.references[0].nameMatchRefIds, [
    "ctr-exact",
    "ctr-wrong-color"
  ]);
});

test("only a verified same-profile binding can be reused without a prompt", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [{
          refId: "ctr-work",
          descriptor: workContainerDescriptor,
          status: "available"
        }],
        supportedColors: ["blue"],
        supportedIcons: ["briefcase"]
      };
    }
  };
  const { service } = harness({ containerService });
  const local = await service.containerPreflight(
    await containerSnapshotRecord({ reason: null }),
    { scope: SNAPSHOT_RESTORE_SCOPES.ALL }
  );
  const imported = await service.containerPreflight(
    await containerSnapshotRecord({ reason: "firefox-sync-import" }),
    { scope: SNAPSHOT_RESTORE_SCOPES.ALL }
  );
  assert.equal(local.required, false);
  assert.equal(local.references[0].autoReuse, true);
  assert.equal(imported.required, true);
  assert.equal(imported.references[0].autoReuse, false);
});

test("imported container snapshots require an explicit decision before safety", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [{ refId: "ctr-work", descriptor: workContainerDescriptor, status: "available" }],
        supportedColors: ["blue"],
        supportedIcons: ["briefcase"]
      };
    }
  };
  const { service, calls, createSafetySnapshot, convergeWindow } = harness({ containerService });
  await assert.rejects(
    service.restoreSnapshot({
      record: await containerSnapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow
    }),
    (error) => error.code === "CONTAINER_RESOLUTION_REQUIRED"
  );
  assert.equal(calls.some((entry) => entry.startsWith("safety:")), false);
  assert.equal(calls.includes("create-tab"), false);
});

test("confirmed container mappings stay ephemeral during restore", async () => {
  const nativeByRef = new Map([["ctr-local", "firefox-container-7"]]);
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [{
          refId: "ctr-local",
          descriptor: workContainerDescriptor,
          status: "available"
        }],
        supportedColors: ["blue"],
        supportedIcons: ["briefcase"]
      };
    },
    async bindReference(refId, targetRefId) {
      nativeByRef.set(refId, nativeByRef.get(targetRefId));
    },
    async resolve(refId) {
      const value = nativeByRef.get(refId);
      if (!value) throw new Error("unavailable");
      return value;
    }
  };
  const {
    service,
    createdTabOptions,
    journalWrites,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ containerService });
  await service.restoreSnapshot({
    record: await containerSnapshotRecord(),
    request: {
      scope: SNAPSHOT_RESTORE_SCOPES.ALL,
      containerResolutions: [{
        refId: "ctr-work",
        action: "existing",
        targetRefId: "ctr-local"
      }]
    },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(
    createdTabOptions.filter(({ cookieStoreId }) => cookieStoreId === "firefox-container-7").length,
    1
  );
  assert.equal(stateWrites.at(-1).workspaces[0].defaultContainerRef, "ctr-work");
  assert.equal(JSON.stringify(journalWrites).includes("firefox-container-7"), false);
});

test("confirmed recreation revalidates tokens and retains the created identity", async () => {
  let recreated = null;
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [],
        supportedColors: ["blue"],
        supportedIcons: ["briefcase"]
      };
    },
    async recreateReference(refId, descriptor) {
      recreated = { refId, descriptor };
    },
    async resolve() { return "firefox-container-created"; }
  };
  const {
    service,
    createdTabOptions,
    createSafetySnapshot,
    convergeWindow
  } = harness({ containerService });
  const report = await service.restoreSnapshot({
    record: await containerSnapshotRecord(),
    request: {
      scope: SNAPSHOT_RESTORE_SCOPES.ALL,
      containerResolutions: [{ refId: "ctr-work", action: "recreate" }]
    },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });
  assert.deepEqual(recreated, { refId: "ctr-work", descriptor: workContainerDescriptor });
  assert.equal(
    createdTabOptions.filter(({ cookieStoreId }) => cookieStoreId === "firefox-container-created").length,
    1
  );
  assert.equal(
    report.approximations.some(({ kind }) => kind === "created-container-retained"),
    true
  );
});

test("explicit No Container clears affected defaults without a fallback guess", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "permission-required",
        containers: [],
        supportedColors: [],
        supportedIcons: []
      };
    }
  };
  const {
    service,
    createdTabOptions,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ containerService });
  await service.restoreSnapshot({
    record: await containerSnapshotRecord(),
    request: {
      scope: SNAPSHOT_RESTORE_SCOPES.ALL,
      containerResolutions: [{ refId: "ctr-work", action: "none" }]
    },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(stateWrites.at(-1).workspaces[0].defaultContainerRef, null);
  assert.ok(createdTabOptions.every(({ cookieStoreId }) => cookieStoreId === null));
});

test("skip removes affected tabs only with explicit default clearing", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "permission-required",
        containers: [],
        supportedColors: [],
        supportedIcons: []
      };
    }
  };
  const {
    service,
    createdTabOptions,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ containerService });
  const report = await service.restoreSnapshot({
    record: await containerSnapshotRecord(),
    request: {
      scope: SNAPSHOT_RESTORE_SCOPES.ALL,
      containerResolutions: [{
        refId: "ctr-work",
        action: "skip",
        clearWorkspaceDefaults: true
      }]
    },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });
  assert.equal(report.skipped.find(({ kind }) => kind === "container-tabs-skipped").count, 1);
  assert.equal(createdTabOptions.length, 2);
  assert.equal(stateWrites.at(-1).workspaces[0].defaultContainerRef, null);
});

test("skip rejects a restore that would leave no tabs before safety", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "permission-required",
        containers: [],
        supportedColors: [],
        supportedIcons: []
      };
    }
  };
  const { service, calls, createSafetySnapshot, convergeWindow } = harness({ containerService });
  await assert.rejects(
    service.restoreSnapshot({
      record: await containerSnapshotRecord({ allTabs: true }),
      request: {
        scope: SNAPSHOT_RESTORE_SCOPES.ALL,
        containerResolutions: [{
          refId: "ctr-work",
          action: "skip",
          clearWorkspaceDefaults: true
        }]
      },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow
    }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(calls.some((entry) => entry.startsWith("safety:")), false);
});

test("a container deleted after confirmation aborts with originals retained", async () => {
  const containerService = {
    async overview() {
      return {
        capability: "available",
        containers: [{
          refId: "ctr-local",
          descriptor: workContainerDescriptor,
          status: "available"
        }],
        supportedColors: ["blue"],
        supportedIcons: ["briefcase"]
      };
    },
    async bindReference() { throw new Error("deleted"); }
  };
  const {
    service,
    calls,
    journalWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ containerService });
  await assert.rejects(
    service.restoreSnapshot({
      record: await containerSnapshotRecord(),
      request: {
        scope: SNAPSHOT_RESTORE_SCOPES.ALL,
        containerResolutions: [{
          refId: "ctr-work",
          action: "existing",
          targetRefId: "ctr-local"
        }]
      },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow
    }),
    (error) => error.code === "CONTAINER_UNAVAILABLE"
  );
  assert.ok(calls.includes("safety:snapshot-session-overwrite"));
  assert.equal(calls.includes("create-tab"), false);
  assert.equal(calls.includes("remove-original"), false);
  assert.equal(journalWrites.at(-1).phase, "partial");
});

test("a returned container mismatch is typed and never closes original tabs", async () => {
  const mismatch = new TypeError("native detail must not escape");
  mismatch.containerMismatch = true;
  const {
    service,
    calls,
    journalWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ createTabError: mismatch });
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow
    }),
    (error) => error.code === "CONTAINER_MISMATCH" && !error.message.includes("native detail")
  );
  assert.equal(calls.includes("remove-original"), false);
  assert.equal(journalWrites.at(-1).report.failures.at(-1).detail, "CONTAINER_MISMATCH");
});

test("matching workspace identity is restored without retaining current tabs", async () => {
  const inventory = currentInventory({
    workspace: { id: "ws-source", name: "Before", icon: "home", color: "#112233" }
  });
  const {
    service,
    calls,
    stateWrites,
    runtimeWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness();
  const report = await service.restoreSnapshot({
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory,
    createSafetySnapshot,
    convergeWindow
  });
  assert.deepEqual(report.created, { workspaces: 0, windows: 0, tabs: 3 });
  assert.equal(report.applied.workspaces, 1);
  assert.equal(stateWrites.at(-1).workspaces.length, 1);
  assert.deepEqual(stateWrites.at(-1).workspaces[0], {
    id: "ws-source",
    name: "Source",
    icon: "briefcase",
    color: "#336699",
    defaultContainerRef: null
  });
  assert.equal(runtimeWrites.at(-1).tabs.some(({ id }) => id === "tab-current"), false);
  assert.equal(report.applied.closedTabs, 1);
  assert.ok(calls.includes("safety:snapshot-session-overwrite"));
});

test("a ZIP-preserved custom id survives migration of an older snapshot", async () => {
  const iconId = "custom-00000000000000000000000000000099";
  const {
    service,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ customIcons: [iconId] });

  await service.restoreSnapshot({
    record: await previousSnapshotRecordWithIcon(iconId),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(stateWrites.at(-1).workspaces[0].icon, iconId);
});

test("an older snapshot with an unresolved custom id defaults only the replacement icon", async () => {
  const iconId = "custom-00000000000000000000000000000099";
  const {
    service,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness();

  await service.restoreSnapshot({
    record: await previousSnapshotRecordWithIcon(iconId),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: currentInventory({
      workspace: { id: "ws-source", name: "Current", icon: "user", color: "#112233" }
    }),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(stateWrites.at(-1).workspaces[0].icon, "house");
});

test("a legacy snapshot does not use an unrelated icon that now occupies its source id", async () => {
  const sourceId = "custom-00000000000000000000000000000099";
  const targetId = "custom-00000000000000000000000000000100";
  const sourceDigest = "a".repeat(64);
  const targetDigest = "b".repeat(64);
  const {
    service,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({
    customIcons: [
      { id: sourceId, digest: sourceDigest },
      { id: targetId, digest: targetDigest }
    ],
    customIconCompatibility: [{
      sourceId,
      mappings: [{ digest: targetDigest, targetId }]
    }]
  });

  await service.restoreSnapshot({
    record: await previousSnapshotRecordWithIcon(sourceId),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(stateWrites.at(-1).workspaces[0].icon, "house");
});

test("a legacy snapshot follows one verified remap when its original custom id is free", async () => {
  const sourceId = "custom-00000000000000000000000000000099";
  const targetId = "custom-00000000000000000000000000000100";
  const targetDigest = "b".repeat(64);
  const {
    service,
    stateWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({
    customIcons: [{ id: targetId, digest: targetDigest }],
    customIconCompatibility: [{
      sourceId,
      mappings: [{ digest: targetDigest, targetId }]
    }]
  });

  await service.restoreSnapshot({
    record: await previousSnapshotRecordWithIcon(sourceId),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(stateWrites.at(-1).workspaces[0].icon, targetId);
});

test("current-window restore closes matching and post-snapshot tabs after persistence", async () => {
  const inventory = currentInventory({
    workspace: { id: "ws-source", name: "Current", icon: "home", color: "#112233" },
    logicalTabs: [
      { id: "tab-one", firefoxId: 70 },
      { id: "tab-new", firefoxId: 71 }
    ]
  });
  const {
    service,
    calls,
    runtimeWrites,
    createSafetySnapshot,
    convergeWindow
  } = harness({ initialWindows: [{ id: 7, tabIds: [70, 71] }] });
  const report = await service.restoreSnapshot({
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory,
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(report.status, "complete");
  assert.equal(report.applied.replacedTabs, 0);
  assert.equal(report.applied.closedTabs, 2);
  assert.equal(calls.filter((call) => call === "remove-original").length, 1);
  assert.ok(calls.indexOf("safety:snapshot-session-overwrite") < calls.indexOf("create-tab"));
  assert.ok(calls.indexOf("write-runtime") < calls.indexOf("remove-original"));
  const runtime = runtimeWrites.at(-1);
  assert.equal(runtime.tabs.some(({ id }) => id === "tab-new"), false);
  assert.equal(runtime.tabs.some(({ id }) => id === "tab-one"), false);
  assert.equal(runtime.tabs.length, 3);
});

test("a refused original-tab close is reported as a partial replacement", async () => {
  const inventory = currentInventory({
    workspace: { id: "ws-source", name: "Current", icon: "home", color: "#112233" },
    logicalTabs: [{ id: "tab-one", firefoxId: 70 }]
  });
  const {
    service,
    calls,
    windows,
    createSafetySnapshot,
    convergeWindow
  } = harness({ failedRemovalIds: [70] });
  const report = await service.restoreSnapshot({
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory,
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(report.status, "partial");
  assert.equal(report.applied.replacedTabs, 0);
  assert.equal(report.applied.closedTabs, 0);
  assert.ok(report.failures.some(({ kind }) => kind === "original-tab-removal-failed"));
  assert.ok(windows.get(7).has(70));
  assert.ok(calls.includes("converge:7"));
});

test("a protected saved location uses a placeholder and still closes every original tab", async () => {
  const inventory = currentInventory({
    workspace: { id: "ws-source", name: "Current", icon: "home", color: "#112233" },
    logicalTabs: [{ id: "tab-one", firefoxId: 70 }]
  });
  const { service, calls, createSafetySnapshot, convergeWindow } = harness();
  const report = await service.restoreSnapshot({
    record: await protectedSnapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory,
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(report.applied.replacedTabs, 0);
  assert.equal(report.applied.closedTabs, 1);
  assert.equal(calls.includes("remove-original"), true);
  assert.ok(report.skipped.some(({ kind }) => kind === "protected-url"));
});

test("current-window restore closes every member of a live native Split View", async () => {
  const inventory = currentInventory({
    workspace: { id: "ws-source", name: "Current", icon: "home", color: "#112233" },
    logicalTabs: [
      { id: "tab-one", firefoxId: 70, splitViewId: 8 },
      { id: "tab-split-mate", firefoxId: 71, splitViewId: 8 }
    ]
  });
  const { service, calls, createSafetySnapshot, convergeWindow } = harness({
    initialWindows: [{ id: 7, tabIds: [70, 71] }]
  });
  const report = await service.restoreSnapshot({
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory,
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(report.status, "complete");
  assert.equal(report.applied.closedTabs, 2);
  assert.ok(calls.includes("remove-original"));
});

test("current-window restore can switch away from a workspace with a live native Split View", async () => {
  const inventory = currentInventory({
    logicalTabs: [
      { id: "tab-current", firefoxId: 70, splitViewId: 8 },
      { id: "tab-split-mate", firefoxId: 71, splitViewId: 8 }
    ]
  });
  const { service, createSafetySnapshot, convergeWindow } = harness({
    initialWindows: [{ id: 7, tabIds: [70, 71] }]
  });
  const report = await service.restoreSnapshot({
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory,
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(report.status, "complete");
  assert.equal(report.applied.closedTabs, 2);
});

test("overwrite stops before every write and browser mutation when its safety snapshot fails", async () => {
  const { service, calls } = harness();
  const failure = new Error("safety unavailable");
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      async createSafetySnapshot() { throw failure; },
      async convergeWindow() {}
    }),
    failure
  );
  assert.deepEqual(calls, []);
});

test("overwrite requires an aligned inventory for every normal window before safety", async () => {
  const { service, calls } = harness({
    initialWindows: [{ id: 7, tabIds: [70] }, { id: 8, tabIds: [80] }]
  });
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
      inventory: currentInventory(),
      async createSafetySnapshot() { assert.fail("unaligned sessions must not create safety state"); },
      async convergeWindow() { assert.fail("unaligned sessions must not reconcile"); }
    }),
    (error) => error.code === "RESTORE_BLOCKED"
  );
  assert.deepEqual(calls, []);
});

test("removed duplicate mode is rejected before safety or browser mutation", async () => {
  const { service, calls } = harness();
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: {
        scope: SNAPSHOT_RESTORE_SCOPES.ALL,
        mode: SNAPSHOT_RESTORE_MODES.DUPLICATE_WORKSPACES
      },
      inventory: currentInventory(),
      async createSafetySnapshot() { assert.fail("invalid requests must not create safety state"); },
      async convergeWindow() { assert.fail("invalid requests must not reconcile"); }
    }),
    (error) => error.code === "INVALID_REQUEST"
  );
  assert.deepEqual(calls, []);
});

test("snapshot restore requests cannot apply settings", async () => {
  const { service } = harness();
  await assert.rejects(
    service.restoreSnapshot({
      windowId: 7,
      record: await snapshotRecord(),
      request: {
        scope: SNAPSHOT_RESTORE_SCOPES.ALL,
        mode: SNAPSHOT_RESTORE_MODES.COPY,
        confirmedReplacement: false,
        restoreSettings: true
      },
      inventory: currentInventory(),
      async createSafetySnapshot() { assert.fail("invalid requests must not create safety state"); }
    }),
    (error) => error.code === "INVALID_REQUEST"
  );
});

test("settings restore writes its report through the separate settings backup channel", async () => {
  const { service, calls } = harness();
  const importedSettings = createDefaultSettingsState();
  importedSettings.sidebar.workspaceSize = "massive";
  importedSettings.sidebar.tabSize = "large";
  const backup = await finalizeSettingsBackup({
    createdAt: "2026-09-05T19:00:00.000Z",
    settings: importedSettings
  });
  const report = await service.restoreSettingsBackup({
    backup,
    sections: ["sidebar"],
    inventory: currentInventory(),
    currentSettings: createDefaultSettingsState(),
    async createSafetySnapshot() { assert.fail("sidebar-only restore is not destructive"); },
    async convergeWindows() { calls.push("converge-all"); }
  });
  assert.equal(report.scope, SNAPSHOT_RESTORE_SCOPES.SETTINGS);
  assert.ok(calls.includes("transaction"));
  assert.ok(calls.includes("write-settings"));
  assert.ok(calls.includes("settings-report:complete"));
  assert.equal(calls.some((entry) => entry === "report:complete"), false);
  assert.equal(report.created.workspaces, 0);
});

test("settings restore rejects workspace sections before safety or state mutation", async () => {
  const backup = await finalizeSettingsBackup({
    createdAt: "2026-09-05T19:00:00.000Z",
    settings: createDefaultSettingsState()
  });
  const containerService = {
    async importCatalog() {
      assert.fail("Settings Backups must not import workspace container descriptors");
    }
  };
  const { service, calls } = harness({ containerService });
  await assert.rejects(
    service.restoreSettingsBackup({
      backup,
      sections: ["workspaces"],
      inventory: currentInventory(),
      currentSettings: createDefaultSettingsState(),
      createSafetySnapshot: async () => assert.fail("Invalid restore must not create safety data"),
      convergeWindows: async () => assert.fail("Invalid restore must not converge workspaces")
    }),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(calls, []);
});

test("replacement restore requests are rejected before browser mutation", async () => {
  const { service, calls } = harness();
  await assert.rejects(
    service.restoreSnapshot({
      record: await snapshotRecord(),
      request: {
        scope: SNAPSHOT_RESTORE_SCOPES.ALL,
        mode: SNAPSHOT_RESTORE_MODES.REPLACE,
        confirmedReplacement: true
      },
      inventory: currentInventory()
    }),
    (error) => error.code === "INVALID_REQUEST"
  );
  assert.equal(calls.includes("create-window"), false);
  assert.equal(calls.includes("remove-original"), false);
});

test("an interrupted copy restore is reported without closing existing tabs", async () => {
  const journal = {
    schemaVersion: 1,
    id: "restore-recovery",
    snapshotId: "snapshot-source",
    phase: "materializing",
    mode: SNAPSHOT_RESTORE_MODES.COPY,
    scope: SNAPSHOT_RESTORE_SCOPES.ALL,
    targetWindowId: null,
    createdWindowIds: [100],
    createdTabIds: [1000],
    originalWindowIds: [],
    originalTabIds: [],
    originalLogicalWindowIds: [],
    originalLogicalTabIds: [],
    replacementState: null,
    startedAt: "2026-09-05T19:59:00.000Z",
    report: null
  };
  const { service, calls } = harness({ initialJournal: journal });

  const report = await service.recoverPending();
  assert.equal(report.status, "partial");
  assert.equal(calls.filter((call) => call === "create-window").length, 0);
  assert.equal(calls.filter((call) => call === "create-tab").length, 0);
  assert.equal(calls.filter((call) => call === "remove-original").length, 0);
  assert.ok(report.failures.some(({ kind }) => kind === "background-restarted"));
});

test("window and selected-tab restores each replace the current browser session", async () => {
  for (const request of [
    { scope: SNAPSHOT_RESTORE_SCOPES.WINDOW, windowId: "window-source" },
    { scope: SNAPSHOT_RESTORE_SCOPES.TABS, tabIds: ["tab-two", "tab-three"] }
  ]) {
    const {
      service,
      calls,
      createdTabWindowIds,
      windows,
      createSafetySnapshot,
      convergeWindow
    } = harness();
    const report = await service.restoreSnapshot({
      record: await snapshotRecord(),
      request,
      inventory: currentInventory(),
      createSafetySnapshot,
      convergeWindow
    });
    assert.equal(report.created.windows, 0);
    assert.equal(report.applied.closedTabs, 1);
    assert.equal(calls.filter((call) => call === "create-window").length, 0);
    assert.ok(createdTabWindowIds.every((windowId) => windowId === 7));
    assert.equal(calls.filter((call) => call === "remove-original").length, 1);
    assert.deepEqual([...windows.keys()], [7]);
    assert.equal(windows.get(7).size, report.created.tabs);
  }
});

test("partial restores keep the selected workspaces and the rail arrangement", async () => {
  const { service, stateWrites, createSafetySnapshot, convergeWindow } = harness();
  // A rail like the user's: a divider and a flexible space around the
  // workspaces, and one workspace this restore does not include.
  const payload = createSnapshotPayloadFixture();
  payload.workspaceState.workspaces.push({
    id: "ws-elsewhere",
    name: "Elsewhere",
    icon: "user",
    color: "#446688",
    defaultContainerRef: null
  });
  payload.workspaceState.rail = [
    { kind: "divider", id: "divider-top", size: 24 },
    { kind: "workspace", workspaceId: "ws-source" },
    { kind: "space", id: "space-middle" },
    { kind: "workspace", workspaceId: "ws-elsewhere" },
    { kind: "divider", id: "divider-end", size: 16 }
  ];
  await service.restoreSnapshot({
    record: await createSnapshotRecord({
      id: "snapshot-rail",
      kind: SNAPSHOT_KINDS.MANUAL,
      createdAt: "2026-09-05T19:00:00.000Z",
      payload
    }),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.WINDOW, windowId: "window-source" },
    inventory: currentInventory(),
    createSafetySnapshot,
    convergeWindow
  });
  // The unrestored workspace leaves the rail; the dividers and the space,
  // which belong to no workspace, stay exactly where they were.
  assert.deepEqual(
    stateWrites.at(-1).rail,
    [
      { kind: "divider", id: "divider-top", size: 24 },
      { kind: "workspace", workspaceId: "ws-source" },
      { kind: "space", id: "space-middle" },
      { kind: "divider", id: "divider-end", size: 16 }
    ]
  );
});

test("removed workspace-level and legacy copy requests reject before mutation", async () => {
  for (const request of [
    {
      scope: SNAPSHOT_RESTORE_SCOPES.WORKSPACE,
      windowId: "window-source",
      workspaceId: "ws-source"
    },
    { scope: SNAPSHOT_RESTORE_SCOPES.ALL, mode: SNAPSHOT_RESTORE_MODES.COPY }
  ]) {
    const { service, calls } = harness();
    await assert.rejects(
      service.restoreSnapshot({
        record: await snapshotRecord(),
        request,
        inventory: currentInventory()
      }),
      (error) => error.code === "INVALID_REQUEST"
    );
    assert.equal(calls.includes("create-window"), false);
  }
});

test("opening all saved windows keeps the initiating window and closes every other old window", async () => {
  const {
    service,
    calls,
    createdTabWindowIds,
    windows,
    createSafetySnapshot,
    convergeWindow
  } = harness({
    initialWindows: [{ id: 7, tabIds: [70] }, { id: 8, tabIds: [80] }]
  });
  const report = await service.restoreSnapshot({
    record: await multiWindowSnapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: twoWindowInventory(),
    createSafetySnapshot,
    convergeWindow
  });
  assert.equal(report.created.windows, 1);
  assert.equal(report.created.tabs, 6);
  assert.equal(report.applied.closedTabs, 2);
  assert.equal(report.applied.closedWindows, 1);
  assert.equal(calls.filter((call) => call === "create-window").length, 1);
  assert.deepEqual(createdTabWindowIds.slice(0, 3), [7, 7, 7]);
  assert.ok(calls.includes("remove-original"));
  assert.ok(calls.includes("remove-window:8"));
  assert.equal(calls.includes("remove-window:7"), false);
  assert.equal(calls.includes("remove-window:100"), false);
  assert.deepEqual([...windows.keys()], [7, 100]);
});

test("a refused old-window close leaves Firefox open and reports a partial restore", async () => {
  const { service, calls, windows, createSafetySnapshot, convergeWindow } = harness({
    initialWindows: [{ id: 7, tabIds: [70] }, { id: 8, tabIds: [80] }],
    failedWindowRemovalIds: [8]
  });
  const report = await service.restoreSnapshot({
    record: await snapshotRecord(),
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: twoWindowInventory(),
    createSafetySnapshot,
    convergeWindow
  });

  assert.equal(report.status, "partial");
  assert.equal(report.applied.closedTabs, 1);
  assert.equal(report.applied.closedWindows, 0);
  assert.ok(report.failures.some(({ kind }) => kind === "original-window-removal-failed"));
  assert.ok(windows.has(7));
  assert.ok(windows.has(8));
  assert.equal(calls.includes("remove-window:7"), false);
});

function restoreArguments(h, record, extra = {}) {
  return {
    windowId: 7,
    record,
    request: { scope: SNAPSHOT_RESTORE_SCOPES.ALL },
    inventory: currentInventory(),
    createSafetySnapshot: h.createSafetySnapshot,
    convergeWindow: h.convergeWindow,
    ...extra
  };
}

test("restored tabs start unloaded with their saved titles and only the selected tab loads", async () => {
  const h = harness();
  const report = await h.service.restoreSnapshot(restoreArguments(h, await snapshotRecord()));

  assert.deepEqual(
    h.createdTabOptions.map(({ discarded, title }) => [discarded, title]),
    [[true, "One"], [true, "Two"], [true, "Three"]]
  );
  const activations = h.updates.filter(([, changes]) => changes.active === true);
  assert.deepEqual(activations, [[1000, { active: true }]]);
  assert.deepEqual(h.discards, [], "tabs that were created unloaded need no later discard");
  assert.equal(report.applied.discarded, 2);
});

test("a new window's first tab is unloaded unless that window selects it", async () => {
  const selectedFirst = harness();
  await selectedFirst.service.restoreSnapshot(
    restoreArguments(selectedFirst, await multiWindowSnapshotRecord())
  );
  assert.deepEqual(selectedFirst.discards, []);

  const selectedLater = harness();
  const report = await selectedLater.service.restoreSnapshot(
    restoreArguments(selectedLater, await multiWindowSnapshotRecord({ secondSelectedTabId: "tab-five" }))
  );
  const [secondWindowId] = [...selectedLater.windows.keys()].filter((id) => id !== 7);
  const [firstTabOfSecondWindow] = selectedLater.windows.get(secondWindowId);
  assert.deepEqual(selectedLater.discards, [firstTabOfSecondWindow]);
  assert.equal(report.status, "complete");
});

test("the restore batch size must be a whole number from 1 through 9999", async () => {
  for (const restoreBatchSize of [0, 10_000, 2.5, "10"]) {
    const h = harness();
    await assert.rejects(
      h.service.restoreSnapshot(restoreArguments(h, await snapshotRecord(), { restoreBatchSize })),
      (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_REQUEST,
      String(restoreBatchSize)
    );
    assert.equal(h.calls.some((call) => call.startsWith("safety:") || call === "create-tab"), false);
  }
});

for (const restoreBatchSize of [1, 10, 100]) {
  test(`restore creates at most ${restoreBatchSize} tab${restoreBatchSize === 1 ? "" : "s"} at a time`, async () => {
    const h = harness({ asyncCreateTab: true });
    const report = await h.service.restoreSnapshot(restoreArguments(
      h,
      await largeSnapshotRecord({ activeCount: 150, otherCount: 90 }),
      { restoreBatchSize }
    ));
    assert.equal(report.status, "complete");
    assert.equal(report.created.tabs, 240);
    assert.equal(h.inFlight.max, restoreBatchSize);
  });
}

// Stress: a snapshot far larger than typical sessions must restore with every
// browser call and journal write bounded by the batch size, not by tab count.
test("a 2,500-tab restore stays unloaded, bounded, and consistent", async () => {
  const h = harness({ asyncCreateTab: true });
  const started = performance.now();
  const report = await h.service.restoreSnapshot(restoreArguments(
    h,
    await largeSnapshotRecord({ activeCount: 1500, otherCount: 1000 }),
    { restoreBatchSize: 10 }
  ));
  const elapsedMs = performance.now() - started;

  assert.equal(report.status, "complete");
  assert.equal(report.created.tabs, 2500);
  assert.equal(report.applied.discarded, 2499);
  assert.equal(h.inFlight.max, 10);
  assert.ok(h.createdTabOptions.every(({ discarded }) => discarded === true));
  assert.equal(h.updates.filter(([, changes]) => changes.active === true).length, 1);
  assert.deepEqual(h.discards, []);

  const materializingWrites = h.journalWrites.filter(({ phase }) => phase === "materializing");
  assert.ok(materializingWrites.length <= Math.ceil(2500 / 10) + 1, `${materializingWrites.length} journal writes`);
  assert.equal(materializingWrites.at(-1).createdTabIds.length, 2500);
  assert.equal(h.getTabCount(), 0, "existence checks use window listings, not one lookup per tab");
  assert.ok(h.tabCallSizes.hide.every((size) => size <= 200));
  assert.equal(h.tabCallSizes.hide.reduce((sum, size) => sum + size, 0), 1000);

  assert.equal(h.runtimeWrites.at(-1).tabs.length, 2500);
  assert.equal(h.windows.get(7).size, 2500, "the original tab closed and every restored tab remains");
  assert.ok(elapsedMs < 20_000, `restore took ${Math.round(elapsedMs)} ms`);
});

test("a failure inside a batch still journals and removes that batch's created tabs", async () => {
  const h = harness({ asyncCreateTab: true, failCreateTabAt: 13 });
  await assert.rejects(
    h.service.restoreSnapshot(restoreArguments(
      h,
      await largeSnapshotRecord({ activeCount: 30, otherCount: 0 }),
      { restoreBatchSize: 10 }
    ))
  );
  const lastMaterializing = h.journalWrites.filter(({ phase }) => phase === "materializing").at(-1);
  assert.equal(lastMaterializing.createdTabIds.length, 19);
  assert.deepEqual([...h.windows.get(7)], [70], "only the original tab remains");
  assert.equal(h.calls.includes("write-state"), false);
});

test("loading a Settings Backup with every section writes a report the report parser accepts", async () => {
  const { service, calls } = harness();
  const backup = await finalizeSettingsBackup({
    createdAt: "2026-09-05T19:00:00.000Z",
    settings: createDefaultSettingsState()
  });
  const report = await service.restoreSettingsBackup({
    backup,
    sections: ["sidebar", "appearance", "navigation", "snapshots"],
    inventory: currentInventory(),
    currentSettings: createDefaultSettingsState(),
    async createSafetySnapshot(reason) { calls.push(`safety:${reason}`); },
    async convergeWindows() { calls.push("converge-all"); }
  });

  const parsed = parseSnapshotRestoreReport(report);
  assert.deepEqual(parsed.sections, ["sidebar", "appearance", "navigation", "snapshots"]);
  assert.ok(calls.includes("settings-report:complete"));
});

function recoveryReportService() {
  const reports = [];
  const service = new SnapshotRestoreService({
    browserAdapter: {},
    repository: {
      // Mirrors the real repository, which parses before writing.
      async writeLastSettingsRestoreReport(value) {
        const parsed = parseSnapshotRestoreReport(value);
        reports.push(parsed);
        return parsed;
      }
    },
    stateService: {},
    runtimeService: {},
    configurationTransferService: {},
    clock: () => new Date("2026-09-13T12:00:00.000Z"),
    idGenerator: () => "ABC-123"
  });
  return { service, reports };
}

test("interrupted settings restore recovery writes one partial settings report", async () => {
  const { service, reports } = recoveryReportService();

  assert.equal(await service.recordInterruptedSettingsRestore(null), null);
  assert.equal(reports.length, 0);

  await service.recordInterruptedSettingsRestore({
    source: "settings-backup",
    unreadable: false,
    phase: "applying",
    documents: { workspaceState: "unchanged", runtime: "kept-newer", settings: "undone" },
    sections: ["appearance", "navigation"],
    convergenceFailed: true
  });
  assert.deepEqual(reports.at(-1), {
    id: "restore-recovery-abc-123",
    snapshotId: null,
    status: "partial",
    scope: SNAPSHOT_RESTORE_SCOPES.SETTINGS,
    mode: SNAPSHOT_RESTORE_MODES.COPY,
    startedAt: "2026-09-13T12:00:00.000Z",
    finishedAt: "2026-09-13T12:00:00.000Z",
    created: { workspaces: 0, windows: 0, tabs: 0 },
    applied: {
      workspaces: 0,
      groups: 0,
      pins: 0,
      discarded: 0,
      replacedTabs: 0,
      closedTabs: 0,
      closedWindows: 0
    },
    approximations: [
      { kind: "interrupted-restore-undone", count: 1, detail: null },
      { kind: "newer-changes-kept", count: 1, detail: null }
    ],
    skipped: [],
    failures: [{ kind: "tab-tidying-failed", count: 1, detail: null }],
    sections: ["appearance", "navigation"]
  });

  await service.recordInterruptedSettingsRestore({
    source: "unknown",
    unreadable: true,
    phase: null,
    documents: null,
    sections: [],
    convergenceFailed: false
  });
  assert.deepEqual(reports.at(-1).approximations, []);
  assert.deepEqual(reports.at(-1).failures, [
    { kind: "recovery-record-unreadable", count: 1, detail: null }
  ]);
  assert.deepEqual(reports.at(-1).sections, []);
});

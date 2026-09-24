import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyWorkspaceRuntime,
  migrateWorkspaceRuntimeV3ToV4,
  migrateWorkspaceRuntimeV4ToV5,
  parseWorkspaceRuntime
} from "../../src/contracts/workspace-runtime.js";
import {
  WORKSPACE_STATE_ERROR_CODES,
  parseWorkspaceState
} from "../../src/contracts/workspace-state.js";
import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import { WorkspaceController } from "../../src/core/workspace-controller.js";
import { MAX_RETAINED_CLOSED_WINDOWS } from "../../src/core/workspace-reconciler.js";
import {
  NEW_WORKSPACE_FIELDS,
  createDefaultWorkspaceState
} from "../../src/core/workspace-defaults.js";
import { parseBookmarkSource } from "../../src/contracts/bookmark-import.js";
import { mapBookmarkImport } from "../../src/core/bookmark-import-mapping.js";
import {
  parseWorkspaceSearchIndex,
  searchableTabLocation
} from "../../src/contracts/workspace-search.js";
import {
  SIDEBAR_UNDO_ACTIONS,
  SIDEBAR_UNDO_OPERATION_KINDS,
  SIDEBAR_UNDO_SCHEMA_VERSION,
  SIDEBAR_UNDO_STATES,
  parseSidebarUndoEntry
} from "../../src/contracts/sidebar-undo.js";
import {
  deriveUndoAffectedKeys,
  fingerprintUndoSnapshot
} from "../../src/core/sidebar-undo-service.js";
import { createFaviconRenderHarness } from "../helpers/favicon-render-harness.js";
import { CONTAINER_ERROR_CODES, ContainerError } from "../../src/contracts/containers.js";
import {
  destinationForZone,
  tabSourceDescriptor
} from "../../src/sidebar/sidebar-interactions.js";
import {
  groupMoveDestination,
  tabMoveDestination,
  withTreeDescendants
} from "../../src/sidebar/tab-tree-targets.js";

const WORK_ID = "ws-default-work";
const PERSONAL_ID = "ws-default-personal";

function workspaceCloseTarget(workspaceId = WORK_ID) {
  return { kind: "workspace", workspaceId };
}

function tabCloseTarget(logicalTabId, firefoxTabId, kind = "tab") {
  return { kind, logicalTabId, firefoxTabId };
}

function captureUndoTransaction(operation, label = "Test action") {
  let before = null;
  let after = null;
  return {
    async prepare(snapshot) { before = structuredClone(snapshot); },
    async commit(snapshot) {
      after = structuredClone(snapshot);
      return { unavailable: false, applied: true };
    },
    async abort() {},
    entry() {
      const affectedKeys = deriveUndoAffectedKeys(before, after);
      return parseSidebarUndoEntry({
        schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION,
        undoId: "undo-controller-test",
        scope: "normal",
        originWindowId: 7,
        operation,
        label,
        action: SIDEBAR_UNDO_ACTIONS.UNDO,
        state: SIDEBAR_UNDO_STATES.READY,
        affectedKeys,
        before,
        expectedPostFingerprint: fingerprintUndoSnapshot(after, affectedKeys)
      });
    }
  };
}

function reciprocalEntry(original, result, action) {
  const reversal = result.reversals?.[0];
  assert.ok(reversal, "a changed action must expose its observed reversal");
  const affectedKeys = deriveUndoAffectedKeys(reversal.before, reversal.after);
  return parseSidebarUndoEntry({
    schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION,
    undoId: `undo-controller-${action}`,
    scope: original.scope,
    originWindowId: original.originWindowId,
    operation: original.operation,
    label: original.label,
    action,
    state: SIDEBAR_UNDO_STATES.READY,
    affectedKeys,
    before: reversal.before,
    expectedPostFingerprint: fingerprintUndoSnapshot(reversal.after, affectedKeys)
  });
}

function createHarness(initialTabs, options = {}) {
  let state = parseWorkspaceState(options.state ?? createDefaultWorkspaceState());
  let workspaceIds = state.workspaces.map((workspace) => workspace.id);
  const runtimeSource = options.initialRuntime?.schemaVersion === 3
    ? migrateWorkspaceRuntimeV4ToV5(
        migrateWorkspaceRuntimeV3ToV4(options.initialRuntime, workspaceIds),
        workspaceIds
      )
    : options.initialRuntime?.schemaVersion === 4
      ? migrateWorkspaceRuntimeV4ToV5(options.initialRuntime, workspaceIds)
      : options.initialRuntime ?? createEmptyWorkspaceRuntime();
  let runtime = parseWorkspaceRuntime(runtimeSource, workspaceIds);
  let tabs = initialTabs.map((tab) => ({
    splitViewId: -1,
    successorTabId: -1,
    ...tab
  }));
  let nextTabId = Math.max(0, ...tabs.map(({ id }) => id)) + 1;
  let groups = (options.initialGroups ?? []).map((group) => ({ ...group }));
  const logicalGroupValues = new Map(options.logicalGroupValues ?? []);
  const logicalTabValues = new Map(options.logicalTabValues ?? []);
  const logicalWindowValues = new Map(options.logicalWindowValues ?? []);
  const notices = new Map();
  const settingsTabIds = new Set(options.settingsTabIds ?? []);
  let nextGroupId = 100;
  let nextLogicalGroupId = 1;
  let nextLogicalSplitViewId = 1;
  let nextWorkspaceId = 1;
  let hideFailure = options.hideFailure === true;
  let successionNoop = options.successionNoop === true;
  let separateSplitFailure = options.separateSplitFailure === true;
  let failNextRuntimeSave = false;
  const calls = [];
  const createdTabOptions = [];
  const copiedTabOptions = [];
  const replacementOptions = [];
  const events = [];
  let removedRequiredTabAfterPending = false;
  let removedTabAfterVerifiedActivation = false;
  const tabIdentityReadCounts = new Map();

  function normalizeIndexes(windowId) {
    tabs
      .filter((tab) => tab.windowId === windowId)
      .sort((left, right) => left.index - right.index || left.id - right.id)
      .forEach((tab, index) => {
        tab.index = index;
      });
  }

  const browserAdapter = {
    scope: options.scope ?? "normal",
    async getOrCreateWindowIdentity(windowId) {
      if (!logicalWindowValues.has(windowId)) {
        logicalWindowValues.set(windowId, `window-${windowId}`);
      }
      return logicalWindowValues.get(windowId);
    },
    async getWindowIdentity(windowId) {
      return logicalWindowValues.get(windowId) ?? null;
    },
    async getOrCreateTabIdentity(tabId) {
      options.beforeTabIdentityRead?.(tabId);
      if (
        options.removeRequiredTabAfterPending === tabId &&
        !removedRequiredTabAfterPending &&
        runtime.windows.some(({ pendingOperation }) => pendingOperation !== null)
      ) {
        removedRequiredTabAfterPending = true;
        tabs = tabs.filter(({ id }) => id !== tabId);
        logicalTabValues.delete(tabId);
        throw new Error("Synthetic tab close after pending persistence");
      }
      if (options.closeDuringIdentityTabIds?.delete(tabId)) {
        tabs = tabs.filter((tab) => tab.id !== tabId);
        throw new Error("Synthetic tab close during identity lookup");
      }
      const remainingFailures = options.transientIdentityFailures?.get(tabId) ?? 0;
      if (remainingFailures > 0) {
        options.transientIdentityFailures.set(tabId, remainingFailures - 1);
        throw new Error("Synthetic transient tab identity failure");
      }
      if (!logicalTabValues.has(tabId)) {
        logicalTabValues.set(tabId, `tab-${tabId}`);
      }
      return logicalTabValues.get(tabId);
    },
    async getTabIdentity(tabId) {
      const readCount = (tabIdentityReadCounts.get(tabId) ?? 0) + 1;
      tabIdentityReadCounts.set(tabId, readCount);
      if (
        options.replaceTabIdentityOnRead?.tabId === tabId &&
        options.replaceTabIdentityOnRead.readCount === readCount
      ) {
        logicalTabValues.set(
          tabId,
          options.replaceTabIdentityOnRead.logicalTabId ?? `tab-replacement-${tabId}`
        );
      }
      if (
        options.removeRequiredTabAfterPending === tabId &&
        !removedRequiredTabAfterPending &&
        runtime.windows.some(({ pendingOperation }) => pendingOperation !== null)
      ) {
        removedRequiredTabAfterPending = true;
        tabs = tabs.filter(({ id }) => id !== tabId);
        logicalTabValues.delete(tabId);
        throw new Error("Synthetic tab close after pending persistence");
      }
      return logicalTabValues.get(tabId) ?? null;
    },
    async replaceWindowIdentity(windowId) {
      const logicalId = `window-replacement-${windowId}`;
      logicalWindowValues.set(windowId, logicalId);
      return logicalId;
    },
    async replaceTabIdentity(tabId) {
      const logicalId = `tab-replacement-${tabId}`;
      logicalTabValues.set(tabId, logicalId);
      return logicalId;
    },
    async setTabIdentity(tabId, logicalId) {
      logicalTabValues.set(tabId, logicalId);
      return logicalId;
    },
    createLogicalGroupId() {
      return `group-generated-${nextLogicalGroupId++}`;
    },
    createLogicalSplitViewId() {
      return `split-generated-${nextLogicalSplitViewId++}`;
    },
    async getTabLogicalGroupId(tabId) {
      return logicalGroupValues.get(tabId) ?? null;
    },
    async setTabLogicalGroupId(tabId, groupId) {
      logicalGroupValues.set(tabId, groupId);
    },
    async clearTabLogicalGroupId(tabId) {
      logicalGroupValues.delete(tabId);
    },
    async getWindowNotice(windowId) {
      return notices.get(windowId);
    },
    async setWindowNotice(windowId, notice) {
      notices.set(windowId, structuredClone(notice));
    },
    async clearWindowNotice(windowId) {
      notices.delete(windowId);
    },
    async listTabs(windowId) {
      const postCommitRemovalTabId = options.removeTabAfterVerifiedActivation;
      if (
        Number.isInteger(postCommitRemovalTabId) &&
        !removedTabAfterVerifiedActivation &&
        (tabIdentityReadCounts.get(postCommitRemovalTabId) ?? 0) >= 4 &&
        calls.some(
          ([kind, tabId]) => kind === "activate" && tabId === postCommitRemovalTabId
        )
      ) {
        removedTabAfterVerifiedActivation = true;
        tabs = tabs.filter(({ id }) => id !== postCommitRemovalTabId);
        logicalTabValues.delete(postCommitRemovalTabId);
      }
      // Mirrors the Firefox adapter, which strips page addresses from every
      // inventory read, so nothing here can depend on a URL the real
      // extension never sees.
      return tabs
        .filter((tab) => tab.windowId === windowId)
        .map(({ url, favIconUrl, ...tab }) => ({ ...tab }));
    },
    // Mirrors the adapter: raw addresses leave only for an exact tab set.
    async listTabPages(tabIds) {
      calls.push(["tab-pages", [...tabIds]]);
      return tabs
        .filter(({ id }) => tabIds.includes(id))
        .map(({ id, url, title }) => ({
          id,
          url: typeof url === "string" ? url : "about:blank",
          title: typeof title === "string" ? title : "Untitled tab"
        }));
    },
    // Mirrors the Firefox adapter: only the reduced match location leaves it.
    async listTabSearchLocations(windowId) {
      calls.push(["search-locations", windowId]);
      return tabs
        .filter((tab) => tab.windowId === windowId)
        .map((tab) => ({ id: tab.id, location: searchableTabLocation(tab.url) }));
    },
    async listSettingsTabs() {
      calls.push(["settings-tabs"]);
      return tabs
        .filter(({ id }) => settingsTabIds.has(id))
        .map((tab) => ({ ...tab }));
    },
    async getTab(tabId) {
      const found = tabs.find((tab) => tab.id === tabId);
      if (!found) {
        throw new Error("Missing tab");
      }
      return { ...found };
    },
    async listTabGroups(windowId) {
      return groups.filter((group) => group.windowId === windowId).map((group) => ({ ...group }));
    },
    async listNormalWindowIds() {
      calls.push(["windows"]);
      return [...new Set(tabs.map(({ windowId }) => windowId))];
    },
    async focusWindow(windowId) {
      calls.push(["focus-window", windowId]);
    },
    async openSettingsPage() {
      calls.push(["open-settings"]);
    },
    async createTab(windowId, createOptions = {}) {
      if (options.createTabFailureUrls?.has(createOptions.url)) {
        throw new Error("Synthetic tab creation failure");
      }
      const id = nextTabId++;
      if (createOptions.active === true) {
        for (const existing of tabs.filter((entry) => entry.windowId === windowId)) {
          existing.active = false;
          existing.highlighted = false;
        }
      }
      const tab = {
        id,
        windowId,
        index: tabs.filter((entry) => entry.windowId === windowId).length,
        active: createOptions.active === true,
        highlighted: createOptions.active === true,
        hidden: false,
        pinned: false,
        groupId: -1,
        discarded: createOptions.discarded === true,
        cookieStoreId: createOptions.cookieStoreId ?? "firefox-default",
        splitViewId: -1,
        successorTabId: -1,
        // Firefox keeps the page it was asked to open, so a recreated tab can
        // be journaled and recreated again.
        ...(typeof createOptions.url === "string" ? { url: createOptions.url } : {}),
        ...(typeof createOptions.title === "string" ? { title: createOptions.title } : {})
      };
      tabs.push(tab);
      createdTabOptions.push(structuredClone(createOptions));
      calls.push(["create", id]);
      return { ...tab };
    },
    async copyTab(tabId, createOptions = {}) {
      const source = tabs.find(({ id }) => id === tabId);
      if (!source) throw new Error("Missing source tab");
      const id = nextTabId++;
      for (const existing of tabs.filter((entry) => entry.windowId === source.windowId)) {
        existing.active = false;
        existing.highlighted = false;
        if (existing.index > source.index) existing.index += 1;
      }
      const copied = {
        ...source,
        id,
        index: source.index + 1,
        active: true,
        highlighted: true,
        pinned: false,
        groupId: -1,
        splitViewId: -1,
        successorTabId: -1,
        cookieStoreId: createOptions.cookieStoreId ?? "firefox-default"
      };
      tabs.push(copied);
      copiedTabOptions.push(structuredClone(createOptions));
      calls.push(["copy", tabId, id]);
      return { ...copied };
    },
    async createContainerReplacement(tabId, createOptions = {}) {
      const source = tabs.find(({ id }) => id === tabId);
      if (!source) throw new Error("Missing source tab");
      if (options.unsupportedReplacementTabIds?.has(tabId)) {
        throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
      }
      if (options.replacementFailures?.has(tabId)) {
        throw new Error("Synthetic replacement failure");
      }
      const id = nextTabId++;
      for (const existing of tabs.filter((entry) => entry.windowId === source.windowId)) {
        if (existing.index > source.index) existing.index += 1;
      }
      const replacement = {
        ...source,
        id,
        index: source.index + 1,
        active: false,
        highlighted: false,
        hidden: false,
        pinned: false,
        groupId: -1,
        splitViewId: -1,
        successorTabId: -1,
        discarded: source.discarded === true && source.active !== true,
        cookieStoreId: createOptions.cookieStoreId ?? "firefox-default"
      };
      tabs.push(replacement);
      replacementOptions.push({ tabId, ...structuredClone(createOptions) });
      calls.push(["replace-in-container", tabId, id]);
      return { ...replacement };
    },
    async showTabs(tabIds) {
      calls.push(["show", [...tabIds]]);
      events.push(["show", [...tabIds]]);
      for (const tab of tabs) {
        if (tabIds.includes(tab.id)) {
          tab.hidden = false;
        }
      }
    },
    async activateTab(tabId) {
      calls.push(["activate", tabId]);
      events.push(["activate", tabId]);
      if (options.activateFailures?.has(tabId)) {
        throw new Error("Synthetic activation failure");
      }
      if (options.activateNoops?.has(tabId)) {
        return;
      }
      const selected = tabs.find((tab) => tab.id === tabId);
      for (const tab of tabs) {
        if (tab.windowId === selected.windowId) {
          tab.active = tab.id === tabId;
          tab.highlighted = tab.id === tabId;
        }
      }
      selected.hidden = false;
      selected.discarded = false;
      if (options.removeTabsAfterActivate?.has(tabId)) {
        tabs = tabs.filter(({ id }) => id !== tabId);
      }
    },
    async setTabPinned(tabId, pinned) {
      calls.push(["pin", tabId, pinned]);
      const target = tabs.find((tab) => tab.id === tabId);
      target.pinned = pinned;
      if (pinned && target.groupId !== -1) {
        const priorGroupId = target.groupId;
        target.groupId = -1;
        if (!tabs.some((tab) => tab.groupId === priorGroupId)) {
          groups = groups.filter((group) => group.id !== priorGroupId);
        }
      }
    },
    async moveTabs(tabIds, { index, windowId } = {}) {
      calls.push(["move", [...tabIds], { index, windowId }]);
      if (tabIds.length === 0) {
        return [];
      }
      const moving = tabIds.map((id) => tabs.find((tab) => tab.id === id)).filter(Boolean);
      const targetWindowId = windowId ?? moving[0].windowId;
      for (const tab of moving) {
        tab.windowId = targetWindowId;
      }
      const remaining = tabs
        .filter((tab) => tab.windowId === targetWindowId && !tabIds.includes(tab.id))
        .sort((left, right) => left.index - right.index || left.id - right.id);
      remaining.splice(index, 0, ...moving);
      remaining.forEach((tab, nextIndex) => {
        tab.index = nextIndex;
      });
      return moving.map((tab) => ({ ...tab }));
    },
    async separateSplitView(tabIds, separatorTabIds, { index, windowId }) {
      const separators = Array.isArray(separatorTabIds) ? separatorTabIds : [separatorTabIds];
      calls.push(["separate-split", [...tabIds], [...separators], { index, windowId }]);
      if (separateSplitFailure) {
        throw new Error("Synthetic split separation failure");
      }
      const members = tabs.filter((tab) => tabIds.includes(tab.id));
      for (const member of members) {
        member.splitViewId = -1;
      }
      const moved = await browserAdapter.moveTabs(
        [tabIds[0], ...separators, tabIds[1]],
        { index, windowId }
      );
      if (Number.isInteger(options.removeTabDuringSplitSeparation)) {
        const removedTabId = options.removeTabDuringSplitSeparation;
        tabs = tabs.filter(({ id }) => id !== removedTabId);
        logicalTabValues.delete(removedTabId);
      }
      return moved;
    },
    async moveTabsInSuccession(tabIds, anchorTabId = -1) {
      calls.push(["succession", [...tabIds], anchorTabId]);
      if (successionNoop) {
        return;
      }
      tabIds.forEach((tabId, index) => {
        const tab = tabs.find((entry) => entry.id === tabId);
        if (tab) {
          tab.successorTabId = tabIds[index + 1] ?? anchorTabId;
        }
      });
    },
    async createTabGroup(tabIds, windowId) {
      if (tabIds.length === 0) {
        return null;
      }
      const groupId = nextGroupId++;
      const members = tabIds.map((id) => tabs.find((tab) => tab.id === id));
      for (const tab of members) {
        tab.groupId = groupId;
        tab.pinned = false;
      }
      groups.push({
        id: groupId,
        windowId,
        title: "",
        color: "grey",
        collapsed: false
      });
      calls.push(["group", [...tabIds], groupId]);
      return groupId;
    },
    async ungroupTabs(tabIds) {
      calls.push(["ungroup", [...tabIds]]);
      const priorIds = new Set();
      for (const tab of tabs) {
        if (tabIds.includes(tab.id) && tab.groupId !== -1) {
          priorIds.add(tab.groupId);
          tab.groupId = -1;
        }
      }
      groups = groups.filter(
        (group) => !priorIds.has(group.id) || tabs.some((tab) => tab.groupId === group.id)
      );
    },
    async updateTabGroup(groupId, changes) {
      Object.assign(groups.find((group) => group.id === groupId), changes);
    },
    async hideTabs(tabIds) {
      calls.push(["hide", [...tabIds]]);
      if (hideFailure) {
        throw new Error("Synthetic hide failure");
      }
      const hiddenIds = [];
      for (const tab of tabs) {
        if (tabIds.includes(tab.id) && !tab.active && !tab.pinned) {
          tab.hidden = true;
          hiddenIds.push(tab.id);
        }
      }
      return hiddenIds;
    },
    async discardTab(tabId) {
      calls.push(["discard", tabId]);
      if (options.discardFailures?.has(tabId)) {
        throw new Error("Synthetic discard refusal");
      }
      const target = tabs.find((tab) => tab.id === tabId);
      if (target && !target.active) {
        target.discarded = true;
      }
    },
    async discardTabs(tabIds) {
      calls.push(["discard-batch", [...tabIds]]);
      if (tabIds.some((tabId) => options.discardFailures?.has(tabId))) {
        throw new Error("Synthetic discard refusal");
      }
      for (const tab of tabs) {
        if (tabIds.includes(tab.id) && !tab.active) {
          tab.discarded = true;
        }
      }
    },
    async reloadTabs(tabIds) {
      calls.push(["reload-tabs", [...tabIds]]);
      return tabIds.map((tabId) => {
        const target = tabs.find((tab) => tab.id === tabId);
        if (!target || options.reloadFailures?.has(tabId)) return { status: "rejected" };
        target.discarded = false;
        return { status: "fulfilled", value: undefined };
      });
    },
    async removeTabs(tabIds) {
      calls.push(["remove-tabs", [...tabIds]]);
      const refused = options.removeTabRefusals ?? new Set();
      const removable = new Set(tabIds.filter((tabId) => !refused.has(tabId)));
      tabs = tabs.filter(({ id }) => !removable.has(id));
      groups = groups.filter((group) => tabs.some((tab) => tab.groupId === group.id));
      for (const windowId of new Set(tabs.map(({ windowId }) => windowId))) {
        normalizeIndexes(windowId);
      }
      if (options.removeTabsFailure === true || refused.size > 0) {
        throw new Error("Synthetic tab close refusal");
      }
    }
  };

  const runtimeService = {
    async getOrInitialize() {
      return parseWorkspaceRuntime(runtime, workspaceIds);
    },
    async save(nextRuntime) {
      if (failNextRuntimeSave) {
        failNextRuntimeSave = false;
        throw new Error("Synthetic runtime save failure");
      }
      runtime = parseWorkspaceRuntime(nextRuntime, workspaceIds);
      events.push(["runtime-save", structuredClone(runtime)]);
      return parseWorkspaceRuntime(runtime, workspaceIds);
    },
    async reset(resetWorkspaceIds) {
      options.resetEvents?.push("runtime-reset");
      runtime = parseWorkspaceRuntime(createEmptyWorkspaceRuntime(), resetWorkspaceIds);
      return parseWorkspaceRuntime(runtime, resetWorkspaceIds);
    }
  };

  return {
    calls,
    events,
    createdTabOptions,
    copiedTabOptions,
    replacementOptions,
    getRuntime: () => parseWorkspaceRuntime(runtime, workspaceIds),
    getState: () => parseWorkspaceState(state),
    getTabs: () => tabs.map((tab) => ({ ...tab })),
    getGroups: () => groups.map((group) => ({ ...group })),
    getNotice: (windowId) => structuredClone(notices.get(windowId)),
    failNextRuntimeSave() {
      failNextRuntimeSave = true;
    },
    setSuccessionNoop(value) {
      successionNoop = value;
    },
    async setNotice(windowId, notice) {
      notices.set(windowId, structuredClone(notice));
    },
    setHideFailure(value) {
      hideFailure = value;
    },
    setSeparateSplitFailure(value) {
      separateSplitFailure = value;
    },
    addTab(nextTab) {
      tabs.push({ splitViewId: -1, successorTabId: -1, ...nextTab });
    },
    // Session values Firefox attaches when it restores a saved window or tab.
    setSavedWindowIdentity(windowId, logicalId) {
      logicalWindowValues.set(windowId, logicalId);
    },
    setSavedTabIdentity(tabId, logicalId) {
      logicalTabValues.set(tabId, logicalId);
    },
    setNativePinned(tabId, pinned) {
      const target = tabs.find((tab) => tab.id === tabId);
      target.pinned = pinned;
      if (pinned && target.groupId !== -1) {
        const priorGroupId = target.groupId;
        target.groupId = -1;
        groups = groups.filter(
          (group) => group.id !== priorGroupId || tabs.some((tab) => tab.groupId === priorGroupId)
        );
      }
    },
    setNativeGroup(tabIds, metadata = {}) {
      const groupId = nextGroupId++;
      for (const target of tabs.filter((tab) => tabIds.includes(tab.id))) {
        target.groupId = groupId;
        target.pinned = false;
      }
      groups.push({
        id: groupId,
        windowId: tabs.find((tab) => tabIds.includes(tab.id)).windowId,
        title: metadata.title ?? "",
        color: metadata.color ?? "grey",
        collapsed: metadata.collapsed === true
      });
      return groupId;
    },
    setNativeSplit(tabIds, splitViewId = 1) {
      for (const target of tabs.filter((tab) => tabIds.includes(tab.id))) {
        target.splitViewId = splitViewId;
      }
    },
    setActiveTab(tabId) {
      const selected = tabs.find((tab) => tab.id === tabId);
      for (const tab of tabs) {
        if (tab.windowId === selected.windowId) {
          tab.active = tab.id === tabId;
          tab.highlighted = tab.id === tabId;
        }
      }
      selected.hidden = false;
      selected.discarded = false;
    },
    closeTabs(tabIds) {
      const closing = new Set(tabIds);
      const active = tabs.find((tab) => closing.has(tab.id) && tab.active === true);
      let successorId = active?.successorTabId ?? -1;
      while (closing.has(successorId)) {
        successorId = tabs.find((tab) => tab.id === successorId)?.successorTabId ?? -1;
      }
      tabs = tabs.filter((tab) => !closing.has(tab.id));
      if (successorId !== -1) {
        const successor = tabs.find((tab) => tab.id === successorId);
        if (successor) {
          for (const tab of tabs.filter((tab) => tab.windowId === successor.windowId)) {
            tab.active = tab.id === successor.id;
            tab.highlighted = tab.id === successor.id;
          }
          successor.hidden = false;
          successor.discarded = false;
        }
      }
      return tabs.length === 0;
    },
    controller: new WorkspaceController({
      browserAdapter,
      runtimeService,
      settingsService: options.settingsService ?? null,
      snapshotService: options.snapshotService ?? null,
      restoreService: options.restoreService ?? null,
      stateService: {
        async getOrInitialize() {
          return parseWorkspaceState(state);
        },
        async createWorkspace(workspace) {
          const id = `ws-controller-${nextWorkspaceId++}`;
          state = parseWorkspaceState({
            ...state,
            workspaces: [
              ...state.workspaces,
              { id, ...workspace, defaultContainerRef: workspace.defaultContainerRef ?? null }
            ],
            rail: [...state.rail, { kind: "workspace", workspaceId: id }]
          });
          workspaceIds = state.workspaces.map((entry) => entry.id);
          return parseWorkspaceState(state);
        },
        async removeWorkspace(workspaceId) {
          state = parseWorkspaceState({
            ...state,
            workspaces: state.workspaces.filter(({ id }) => id !== workspaceId),
            rail: state.rail.filter(
              ({ kind, workspaceId: id }) => !(kind === "workspace" && id === workspaceId)
            )
          });
          workspaceIds = state.workspaces.map(({ id }) => id);
          return parseWorkspaceState(state);
        },
        async updateWorkspace(workspaceId, changes) {
          state = parseWorkspaceState({
            ...state,
            workspaces: state.workspaces.map((workspace) =>
              workspace.id === workspaceId ? { ...workspace, ...changes } : workspace
            )
          });
          return parseWorkspaceState(state);
        },
        async setDefaultContainerRefs(selectedIds, refId) {
          const selected = new Set(selectedIds);
          state = parseWorkspaceState({
            ...state,
            workspaces: state.workspaces.map((workspace) =>
              selected.has(workspace.id) ? { ...workspace, defaultContainerRef: refId } : workspace
            )
          });
          return parseWorkspaceState(state);
        },
        async placeRailEntry(entry, target, position) {
          const matches = (candidate, locator) => locator.kind === "workspace"
            ? candidate.kind === "workspace" && candidate.workspaceId === locator.id
            : candidate.kind === locator.kind && candidate.id === locator.id;
          const rail = [...state.rail];
          const sourceIndex = rail.findIndex((candidate) => matches(candidate, entry));
          const [moving] = rail.splice(sourceIndex, 1);
          const targetIndex = rail.findIndex((candidate) => matches(candidate, target));
          rail.splice(targetIndex + (position === "after" ? 1 : 0), 0, moving);
          state = parseWorkspaceState({ ...state, rail });
          return parseWorkspaceState(state);
        },
        async replaceForRestore(nextState) {
          options.resetEvents?.push("state-restore");
          state = parseWorkspaceState(nextState);
          workspaceIds = state.workspaces.map(({ id }) => id);
          return parseWorkspaceState(state);
        },
        async reset(nextState = createDefaultWorkspaceState()) {
          options.resetEvents?.push("state-reset");
          state = parseWorkspaceState(nextState);
          workspaceIds = state.workspaces.map(({ id }) => id);
          return parseWorkspaceState(state);
        }
      },
      containerService: options.containerService ?? null,
      retainClosedWindows: options.retainClosedWindows === true
    })
  };
}

function tab(id, windowId, index, active, overrides = {}) {
  return {
    id,
    windowId,
    index,
    active,
    highlighted: active,
    hidden: false,
    pinned: false,
    groupId: -1,
    discarded: false,
    ...overrides
  };
}

function runtimeForWindow({ assignments, layouts, activeWorkspaceId = WORK_ID, selectedTabs = [], pendingOperation = null }) {
  return {
    schemaVersion: 3,
    tabs: assignments.map(([id, workspaceId]) => ({ id: `tab-${id}`, workspaceId })),
    windows: [
      {
        id: "window-7",
        activeWorkspaceId,
        selectedTabs,
        workspaceLayouts: layouts,
        pendingOperation
      }
    ]
  };
}

function customizedResetState() {
  const defaults = createDefaultWorkspaceState();
  return parseWorkspaceState({
    ...defaults,
    workspaces: [
      { ...defaults.workspaces[0], name: "Office" },
      ...defaults.workspaces.slice(1),
      {
        id: "ws-custom-project",
        name: "Project",
        icon: "briefcase",
        color: "#123456",
        defaultContainerRef: null
      }
    ],
    rail: [
      { kind: "workspace", workspaceId: "ws-custom-project" },
      { kind: "divider", id: "divider-custom", size: 24 },
      ...defaults.rail,
      { kind: "space", id: "space-custom" }
    ]
  });
}

function customizedResetRuntime() {
  return {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: "ws-custom-project" }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [
          { workspaceId: WORK_ID, tabId: "tab-11" },
          { workspaceId: "ws-custom-project", tabId: "tab-12" }
        ],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-11", parentTabId: null, collapsed: false }],
            splitViews: []
          },
          {
            workspaceId: "ws-custom-project",
            tabIds: ["tab-12"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-12", parentTabId: null, collapsed: false }],
            splitViews: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
}

function createResetSettingsService(resetEvents, { failReset = false } = {}) {
  let settings = createDefaultSettingsState();
  settings.sidebar.workspaceSize = "large";
  settings.privacy.keepPrivateTabsBetweenSessions = true;
  settings.privacy.automaticSnapshotsEnabled = true;
  return {
    getSettings: () => structuredClone(settings),
    service: {
      async getOrInitialize() {
        return structuredClone(settings);
      },
      async reset(nextSettings = createDefaultSettingsState()) {
        resetEvents.push("settings-reset");
        if (failReset) {
          throw new Error("Synthetic settings reset failure");
        }
        settings = structuredClone(nextSettings);
        return structuredClone(settings);
      },
      async replaceForRestore(previousSettings) {
        resetEvents.push("settings-restore");
        settings = structuredClone(previousSettings);
        return structuredClone(settings);
      }
    }
  };
}

test("first view assigns live tabs and seeds the active workspace selection", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, {
      title: "Private page title",
      favIconUrl: "https://example.invalid/favicon.ico",
      url: "https://secret.invalid/path"
    }),
    tab(12, 7, 1, false)
  ]);

  const view = await harness.controller.getView(7);
  assert.equal(view.activeWorkspaceId, WORK_ID);
  assert.deepEqual(view.workspaceTabs, [
    { workspaceId: WORK_ID, tabCount: 2, discardedTabCount: 0, loadState: "loaded" },
    {
      workspaceId: PERSONAL_ID,
      tabCount: 0,
      discardedTabCount: 0,
      loadState: "empty"
    },
    {
      workspaceId: "ws-default-research",
      tabCount: 0,
      discardedTabCount: 0,
      loadState: "empty"
    }
  ]);
  assert.equal(view.activeTabs[0].title, "Private page title");
  assert.equal(Object.hasOwn(view.activeTabs[0], "favIconUrl"), false);
  assert.equal(Object.hasOwn(view.activeTabs[0], "url"), false);
  assert.deepEqual(view.activeGroups, []);
  assert.deepEqual(view.activeSplitViews, []);
  assert.deepEqual(harness.getRuntime(), {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: WORK_ID }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11", "tab-12"],
            pinnedTabIds: [],
            groups: [],
            tree: [
              { tabId: "tab-11", parentTabId: null, collapsed: false },
              { tabId: "tab-12", parentTabId: null, collapsed: false }
            ],
            splitViews: []
          }
        ],
        pendingOperation: null
      }
    ]
  });
});

test("activating an empty workspace creates and remembers its first tab", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces.find(({ id }) => id === PERSONAL_ID).defaultContainerRef = "ctr-personal";
  const harness = createHarness([tab(11, 7, 0, true), tab(12, 7, 1, false)], {
    state,
    containerService: {
      async refresh() {},
      async resolve(refId) {
        assert.equal(refId, "ctr-personal");
        return "firefox-container-2";
      },
      presentationForCookieStore(cookieStoreId) {
        return cookieStoreId === "firefox-container-2"
          ? {
              kind: "container",
              refId: "ctr-personal",
              descriptor: {
                name: "Personal",
                color: "purple",
                icon: "fingerprint",
                colorCode: "#af51f5"
              },
              status: "available"
            }
          : { kind: "none" };
      }
    }
  });

  await harness.controller.getView(7);
  const personal = await harness.controller.activateWorkspace(7, PERSONAL_ID);
  assert.equal(personal.activeWorkspaceId, PERSONAL_ID);
  assert.equal(personal.hiddenTabCount, 2);
  assert.equal(personal.visibleExceptionCount, 0);
  assert.deepEqual(
    harness.getTabs().map(({ id, active, hidden }) => ({ id, active, hidden })),
    [
      { id: 11, active: false, hidden: true },
      { id: 12, active: false, hidden: true },
      { id: 13, active: true, hidden: false }
    ]
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 13).cookieStoreId, "firefox-container-2");

  const work = await harness.controller.activateWorkspace(7, WORK_ID);
  assert.equal(work.activeWorkspaceId, WORK_ID);
  assert.equal(work.hiddenTabCount, 1);
  assert.equal(work.visibleExceptionCount, 0);
  assert.deepEqual(
    harness.getTabs().map(({ id, active, hidden }) => ({ id, active, hidden })),
    [
      { id: 11, active: true, hidden: false },
      { id: 12, active: false, hidden: false },
      { id: 13, active: false, hidden: true }
    ]
  );
  const mutationNames = harness.calls.map(([name]) => name);
  const personalSwitchStart = harness.calls.findIndex(
    ([name, id]) => name === "create" && id === 13
  );
  const personalMutations = mutationNames.slice(personalSwitchStart);
  assert.ok(personalMutations.indexOf("show") < personalMutations.indexOf("activate"));
  assert.ok(personalMutations.indexOf("activate") < personalMutations.indexOf("hide"));
  assert.deepEqual(harness.getRuntime().windows[0].selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-11" },
    { workspaceId: PERSONAL_ID, tabId: "tab-13" }
  ]);
});

test("new workspace tabs honor explicit choice before the workspace default", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces.find(({ id }) => id === WORK_ID).defaultContainerRef = "ctr-work";
  const resolutions = [];
  const containerService = {
    async refresh(options) {
      assert.deepEqual(options, { notify: false });
    },
    async resolve(refId) {
      resolutions.push(refId);
      if (refId !== "ctr-work") throw new Error("unavailable");
      return "firefox-container-1";
    },
    presentationForCookieStore(cookieStoreId) {
      return cookieStoreId === "firefox-container-1"
        ? {
            kind: "container",
            refId: "ctr-work",
            descriptor: {
              name: "Work",
              color: "blue",
              icon: "briefcase",
              colorCode: "#37adff"
            },
            status: "available"
          }
        : { kind: "none" };
    }
  };
  const harness = createHarness([tab(11, 7, 0, true)], { state, containerService });

  await harness.controller.getView(7);
  await harness.controller.createWorkspaceTab(7, WORK_ID, null);
  await harness.controller.createWorkspaceTab(7, WORK_ID, { kind: "none" });

  assert.deepEqual(resolutions, ["ctr-work"]);
  assert.deepEqual(harness.createdTabOptions, [
    { cookieStoreId: "firefox-container-1", active: true, index: undefined, url: undefined },
    { cookieStoreId: null, active: true, index: undefined, url: undefined }
  ]);
});

test("a stale workspace default rejects before persistence or tab creation", async () => {
  const state = createDefaultWorkspaceState();
  const harness = createHarness([tab(11, 7, 0, true)], {
    state,
    containerService: {
      async resolve() { throw new Error("unavailable"); }
    }
  });

  await assert.rejects(
    harness.controller.setWorkspaceDefaultContainer(WORK_ID, "ctr-stale"),
    /unavailable/
  );
  assert.equal(harness.getState().workspaces[0].defaultContainerRef, null);
  assert.equal(harness.createdTabOptions.length, 0);
});

test("one default container for a selection resolves once and sets every workspace", async () => {
  const resolutions = [];
  const harness = createHarness([tab(11, 7, 0, true)], {
    containerService: {
      async resolve(refId) {
        resolutions.push(refId);
        return "firefox-container-1";
      }
    }
  });

  const next = await harness.controller.setWorkspaceDefaultContainers(
    [WORK_ID, PERSONAL_ID],
    "ctr-work"
  );
  assert.deepEqual(resolutions, ["ctr-work"]);
  const refs = Object.fromEntries(next.workspaces.map(({ id, defaultContainerRef }) => [id, defaultContainerRef]));
  assert.equal(refs[WORK_ID], "ctr-work");
  assert.equal(refs[PERSONAL_ID], "ctr-work");
  assert.equal(refs["ws-default-research"], null);
  // Existing tabs keep their own container; a default only affects new tabs.
  assert.equal(harness.createdTabOptions.length, 0);

  // Clearing needs no resolution.
  await harness.controller.setWorkspaceDefaultContainers([WORK_ID], null);
  assert.deepEqual(resolutions, ["ctr-work"]);
  assert.equal(harness.getState().workspaces.find(({ id }) => id === WORK_ID).defaultContainerRef, null);
});

test("a stale default for a selection changes no workspace", async () => {
  const harness = createHarness([tab(11, 7, 0, true)], {
    containerService: {
      async resolve() { throw new Error("unavailable"); }
    }
  });
  await assert.rejects(
    harness.controller.setWorkspaceDefaultContainers([WORK_ID, PERSONAL_ID], "ctr-stale"),
    /unavailable/
  );
  assert.ok(harness.getState().workspaces.every(({ defaultContainerRef }) => defaultContainerRef === null));
});

test("an unavailable configured default aborts a new tab before Firefox creation", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces.find(({ id }) => id === WORK_ID).defaultContainerRef = "ctr-stale";
  const harness = createHarness([tab(11, 7, 0, true)], {
    state,
    containerService: {
      async resolve() { throw new Error("unavailable"); },
      presentationForCookieStore() { return { kind: "none" }; }
    }
  });
  await assert.rejects(
    harness.controller.createWorkspaceTab(7, WORK_ID, null),
    /unavailable/
  );
  assert.equal(harness.createdTabOptions.length, 0);
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [11]);
});

test("copying into a container keeps the source and creates a loose adjacent tab", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [
      {
        workspaceId: WORK_ID,
        tabIds: ["tab-11", "tab-12"],
        pinnedTabIds: [],
        groups: [{
          id: "group-copy-source",
          title: "Source",
          color: "blue",
          collapsed: false,
          tabIds: ["tab-11", "tab-12"]
        }]
      },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const containerService = {
    async resolve(refId) {
      assert.equal(refId, "ctr-personal");
      return "firefox-container-2";
    },
    presentationForCookieStore() { return { kind: "none" }; }
  };
  const harness = createHarness([
    tab(11, 7, 0, true, { groupId: 42, url: "https://example.com/" }),
    tab(12, 7, 1, false, { groupId: 42, url: "https://example.net/" }),
    tab(13, 7, 2, false, { hidden: true, url: "https://example.org/" })
  ], {
    initialRuntime,
    initialGroups: [{ id: 42, windowId: 7, title: "Source", color: "blue", collapsed: false }],
    logicalGroupValues: [[11, "group-copy-source"], [12, "group-copy-source"]],
    containerService
  });

  await harness.controller.copyTabToContainer(
    7,
    11,
    { kind: "container", refId: "ctr-personal" }
  );

  assert.ok(harness.getTabs().some(({ id }) => id === 11));
  const copied = harness.getTabs().find(({ id }) => id === 14);
  assert.deepEqual(
    {
      cookieStoreId: copied.cookieStoreId,
      pinned: copied.pinned,
      groupId: copied.groupId,
      splitViewId: copied.splitViewId
    },
    {
      cookieStoreId: "firefox-container-2",
      pinned: false,
      groupId: -1,
      splitViewId: -1
    }
  );
  assert.deepEqual(harness.copiedTabOptions, [{ cookieStoreId: "firefox-container-2" }]);
  const layout = harness.getRuntime().windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === WORK_ID
  );
  assert.deepEqual(layout.tabIds, ["tab-11", "tab-14", "tab-12"]);
  assert.equal(layout.groups[0].tabIds.includes("tab-14"), false);
  assert.deepEqual(
    layout.tree.find(({ tabId }) => tabId === "tab-14"),
    { tabId: "tab-14", parentTabId: null, collapsed: false }
  );
});

test("settings creates an inactive companion when it is the only visible tab", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces.find(({ id }) => id === WORK_ID).defaultContainerRef = "ctr-work";
  const harness = createHarness([tab(11, 7, 0, true)], {
    state,
    containerService: {
      async resolve() { throw new Error("Settings must not resolve workspace containers."); }
    }
  });

  const companionCreated = await harness.controller.ensureSettingsCompanion(7, 11);

  assert.equal(companionCreated, true);
  assert.deepEqual(
    harness.getTabs().map(({ id, active, hidden }) => ({ id, active, hidden })),
    [
      { id: 11, active: true, hidden: false },
      { id: 12, active: false, hidden: false }
    ]
  );
  assert.deepEqual(harness.getRuntime().tabs, [
    { id: "tab-11", workspaceId: WORK_ID },
    { id: "tab-12", workspaceId: WORK_ID }
  ]);
  assert.deepEqual(harness.createdTabOptions, [{}]);
});

test("settings does not create a companion when another visible tab exists", async () => {
  const harness = createHarness([tab(11, 7, 0, true), tab(12, 7, 1, false)]);

  assert.equal(await harness.controller.ensureSettingsCompanion(7, 11), false);
  assert.equal(harness.getTabs().length, 2);
  assert.equal(harness.calls.some(([name]) => name === "create"), false);
});

test("hidden workspace tabs do not count as a settings close companion", async () => {
  const initialRuntime = {
    schemaVersion: 3,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: PERSONAL_ID }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11"],
            pinnedTabIds: [],
            groups: []
          },
          {
            workspaceId: PERSONAL_ID,
            tabIds: ["tab-12"],
            pinnedTabIds: [],
            groups: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { hidden: true })
  ], { initialRuntime });

  assert.equal(await harness.controller.ensureSettingsCompanion(7, 11), true);
  assert.equal(harness.getTabs().length, 3);
  assert.equal(harness.getTabs().at(-1).hidden, false);
});

test("opening settings activates an existing settings tab's workspace and window", async () => {
  const initialRuntime = {
    schemaVersion: 3,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-21", workspaceId: WORK_ID },
      { id: "tab-22", workspaceId: PERSONAL_ID }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11"],
            pinnedTabIds: [],
            groups: []
          }
        ],
        pendingOperation: null
      },
      {
        id: "window-8",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [
          { workspaceId: WORK_ID, tabId: "tab-21" },
          { workspaceId: PERSONAL_ID, tabId: "tab-22" }
        ],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-21"],
            pinnedTabIds: [],
            groups: []
          },
          {
            workspaceId: PERSONAL_ID,
            tabIds: ["tab-22"],
            pinnedTabIds: [],
            groups: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(21, 8, 0, true),
    tab(22, 8, 1, false, { hidden: true, lastAccessed: 20 })
  ], { initialRuntime, settingsTabIds: [22] });

  assert.equal(await harness.controller.openSettings(7), true);

  assert.equal(
    harness.getRuntime().windows.find(({ id }) => id === "window-8").activeWorkspaceId,
    PERSONAL_ID
  );
  assert.deepEqual(
    harness.getTabs().filter(({ windowId }) => windowId === 8).map(({ id, active, hidden }) => ({
      id,
      active,
      hidden
    })),
    [
      { id: 21, active: false, hidden: true },
      { id: 22, active: true, hidden: false }
    ]
  );
  assert.ok(harness.calls.some((call) => call[0] === "activate" && call[1] === 22));
  assert.ok(harness.calls.some((call) => call[0] === "focus-window" && call[1] === 8));
  assert.equal(harness.calls.some((call) => call[0] === "open-settings"), false);
});

test("opening settings focuses the initiating window before creating a settings tab", async () => {
  const harness = createHarness([tab(11, 7, 0, true)]);

  assert.equal(await harness.controller.openSettings(7), false);
  assert.deepEqual(harness.calls, [
    ["settings-tabs"],
    ["focus-window", 7],
    ["open-settings"]
  ]);
});

test("workspace cycles restore the most recently active tab in each workspace", async () => {
  const harness = createHarness([tab(11, 7, 0, true), tab(12, 7, 1, false)]);

  await harness.controller.getView(7);
  harness.setActiveTab(12);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  await harness.controller.activateWorkspace(7, WORK_ID);

  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.deepEqual(harness.getRuntime().windows[0].selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-12" },
    { workspaceId: PERSONAL_ID, tabId: "tab-13" }
  ]);
});

test("stale remembered tabs are removed and fallback uses first eligible tab order", async () => {
  const initialRuntime = {
    schemaVersion: 3,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: PERSONAL_ID },
      { id: "tab-13", workspaceId: PERSONAL_ID },
      { id: "tab-99", workspaceId: PERSONAL_ID }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [
          { workspaceId: WORK_ID, tabId: "tab-11" },
          { workspaceId: PERSONAL_ID, tabId: "tab-99" }
        ],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11"],
            pinnedTabIds: [],
            groups: []
          },
          {
            workspaceId: PERSONAL_ID,
            tabIds: ["tab-12", "tab-13", "tab-99"],
            pinnedTabIds: [],
            groups: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(13, 7, 2, false, { hidden: true }),
      tab(12, 7, 1, false, { hidden: true })
    ],
    { initialRuntime }
  );

  await harness.controller.activateWorkspace(7, PERSONAL_ID);

  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.deepEqual(harness.getRuntime().windows[0].selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-11" },
    { workspaceId: PERSONAL_ID, tabId: "tab-12" }
  ]);
});

test("remembered selections remain independent across Firefox windows", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(21, 8, 0, true),
    tab(22, 8, 1, false)
  ]);

  await harness.controller.getView(7);
  await harness.controller.getView(8);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  await harness.controller.activateWorkspace(8, PERSONAL_ID);
  await harness.controller.activateWorkspace(7, WORK_ID);
  await harness.controller.activateWorkspace(8, WORK_ID);

  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 21).active, true);
  const windows = harness.getRuntime().windows;
  assert.deepEqual(windows.find(({ id }) => id === "window-7").selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-11" },
    { workspaceId: PERSONAL_ID, tabId: "tab-23" }
  ]);
  assert.deepEqual(windows.find(({ id }) => id === "window-8").selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-21" },
    { workspaceId: PERSONAL_ID, tabId: "tab-24" }
  ]);
});

test("a leading divider does not become the default active workspace", async () => {
  const state = createDefaultWorkspaceState();
  state.rail.unshift({ kind: "divider", id: "divider-leading", size: null });
  const harness = createHarness([tab(11, 7, 0, true)], { state });

  const view = await harness.controller.getView(7);
  assert.equal(view.activeWorkspaceId, WORK_ID);
  assert.equal(view.state.rail[0].kind, "divider");
});

test("a logical pin is unpinned before hiding and restored when its workspace returns", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { pinned: true }),
    tab(12, 7, 1, false)
  ]);

  await harness.controller.getView(7);
  const result = await harness.controller.activateWorkspace(7, PERSONAL_ID);

  assert.equal(result.hiddenTabCount, 2);
  assert.equal(result.visibleExceptionCount, 0);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).hidden, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).pinned, false);

  await harness.controller.activateWorkspace(7, WORK_ID);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).pinned, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).hidden, false);
});

test("workspace tab summaries are window-scoped and reflect partial discard state", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { discarded: true }),
    tab(21, 8, 0, true)
  ]);

  await harness.controller.getView(8);
  const view = await harness.controller.getView(7);

  assert.deepEqual(view.workspaceTabs[0], {
    workspaceId: WORK_ID,
    tabCount: 2,
    discardedTabCount: 1,
    loadState: "partial"
  });
});

test("loading a workspace wakes only its own unloaded tabs in that window", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { discarded: true }),
    tab(21, 8, 0, true),
    tab(22, 8, 1, false, { discarded: true })
  ]);

  await harness.controller.getView(7);
  await harness.controller.getView(8);
  const outcome = await harness.controller.loadWorkspaceTabs(7, WORK_ID);

  assert.equal(outcome.workspaceId, WORK_ID);
  // The loaded tab is left alone, and the other window keeps its own asleep.
  assert.equal(outcome.requestedCount, 1);
  assert.equal(outcome.startedCount, 1);
  assert.equal(outcome.failedCount, 0);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "reload-tabs").flatMap(([, ids]) => ids),
    [12]
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 22).discarded, true);
});

test("a workspace with nothing asleep asks Firefox for nothing", async () => {
  const harness = createHarness([tab(11, 7, 0, true), tab(12, 7, 1, false)]);
  await harness.controller.getView(7);
  const outcome = await harness.controller.loadWorkspaceTabs(7, WORK_ID);
  assert.equal(outcome.requestedCount, 0);
  assert.equal(outcome.startedCount, 0);
  assert.equal(harness.calls.some(([name]) => name === "reload-tabs"), false);
});

test("a refused reload is reported rather than counted as loading", async () => {
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { discarded: true }), tab(13, 7, 2, false, { discarded: true })],
    { reloadFailures: new Set([13]) }
  );
  await harness.controller.getView(7);
  const outcome = await harness.controller.loadWorkspaceTabs(7, WORK_ID);
  assert.equal(outcome.requestedCount, 2);
  assert.equal(outcome.startedCount, 1);
  assert.equal(outcome.failedCount, 1);
});

test("unload switches every window where the target is active before discarding it", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(21, 8, 0, true)
  ]);

  await harness.controller.getView(7);
  await harness.controller.getView(8);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.outcome.switchedWindowCount, 1);
  assert.equal(result.outcome.pendingWindowCount, 0);
  assert.equal(result.outcome.newlyDiscardedCount, 3);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "discard-batch").flatMap(([, ids]) => ids),
    [11, 12, 21]
  );
  assert.equal(harness.getRuntime().windows.find(({ id }) => id === "window-8").activeWorkspaceId, PERSONAL_ID);
});

test("unload repairs an actually active target when logical active state has drifted", async () => {
  const initialRuntime = {
    schemaVersion: 3,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: PERSONAL_ID }
    ],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: PERSONAL_ID,
        selectedTabs: [],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11"],
            pinnedTabIds: [],
            groups: []
          },
          {
            workspaceId: PERSONAL_ID,
            tabIds: ["tab-12"],
            pinnedTabIds: [],
            groups: []
          }
        ],
        pendingOperation: null
      }
    ]
  };
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false)],
    { initialRuntime }
  );

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.outcome.switchedWindowCount, 1);
  assert.equal(result.outcome.newlyDiscardedCount, 1);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "discard-batch"),
    [["discard-batch", [11]]]
  );
});

test("active unload wraps through rail order and skips divider and space entries", async () => {
  const state = createDefaultWorkspaceState();
  state.rail = [
    { kind: "workspace", workspaceId: WORK_ID },
    { kind: "divider", id: "divider-one", size: null },
    { kind: "workspace", workspaceId: "ws-default-research" },
    { kind: "space", id: "space-one" },
    { kind: "workspace", workspaceId: PERSONAL_ID }
  ];
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    activeWorkspaceId: PERSONAL_ID,
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, false, { hidden: true }),
    tab(12, 7, 1, true)
  ], { state, initialRuntime });

  const result = await harness.controller.unloadWorkspace(7, PERSONAL_ID);
  assert.equal(result.view.activeWorkspaceId, WORK_ID);
  assert.equal(result.outcome.switchedWindowCount, 1);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, true);
});

test("active unload wakes the unloaded successor's remembered tab", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { hidden: true, discarded: true })
  ], { initialRuntime });

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).discarded, true);
});

test("active unload never discards while a successor activation remains pending", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { hidden: true })
  ], { initialRuntime, activateFailures: new Set([12]) });

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.outcome.switchedWindowCount, 0);
  assert.equal(result.outcome.pendingWindowCount, 1);
  assert.equal(result.outcome.newlyDiscardedCount, 0);
  assert.equal(harness.calls.some(([name]) => name === "discard-batch"), false);
});

test("sole-workspace unload retains each window's active safety tab", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces = [state.workspaces[0]];
  state.rail = [{ kind: "workspace", workspaceId: WORK_ID }];
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(21, 8, 0, true),
    tab(22, 8, 1, false)
  ], { state });
  await harness.controller.getView(7);
  await harness.controller.getView(8);

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.outcome.safetyTabCount, 2);
  assert.equal(result.outcome.newlyDiscardedCount, 2);
  assert.equal(result.outcome.remainingLoadedCount, 2);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "discard-batch").flatMap(([, ids]) => ids),
    [12, 22]
  );
});

test("unload discards the inactive workspace across windows without changing runtime", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(21, 8, 0, true),
    tab(22, 8, 1, false)
  ]);

  await harness.controller.getView(7);
  await harness.controller.getView(8);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  await harness.controller.activateWorkspace(8, PERSONAL_ID);
  const runtimeBefore = harness.getRuntime();

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);

  assert.deepEqual(result.outcome, {
    workspaceId: WORK_ID,
    requestedTabCount: 4,
    unpinnedCount: 0,
    remainingPinnedCount: 0,
    ungroupedCount: 0,
    remainingGroupedCount: 0,
    newlyHiddenCount: 0,
    remainingVisibleCount: 0,
    alreadyDiscardedCount: 0,
    newlyDiscardedCount: 4,
    remainingLoadedCount: 0,
    failedDiscardCount: 0,
    switchedWindowCount: 0,
    pendingWindowCount: 0,
    safetyTabCount: 0
  });
  assert.deepEqual(result.view.workspaceTabs[0], {
    workspaceId: WORK_ID,
    tabCount: 2,
    discardedTabCount: 2,
    loadState: "unloaded"
  });
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "discard-batch").flatMap(([, ids]) => ids),
    [11, 12, 21, 22]
  );
});

test("unload reports already discarded tabs and observed partial failures", async () => {
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(12, 7, 1, false, { discarded: true }),
      tab(13, 7, 2, false)
    ],
    { discardFailures: new Set([13]) }
  );

  await harness.controller.getView(7);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  const result = await harness.controller.unloadWorkspace(7, WORK_ID);

  assert.deepEqual(result.outcome, {
    workspaceId: WORK_ID,
    requestedTabCount: 3,
    unpinnedCount: 0,
    remainingPinnedCount: 0,
    ungroupedCount: 0,
    remainingGroupedCount: 0,
    newlyHiddenCount: 0,
    remainingVisibleCount: 0,
    alreadyDiscardedCount: 1,
    newlyDiscardedCount: 1,
    remainingLoadedCount: 1,
    failedDiscardCount: 1,
    switchedWindowCount: 0,
    pendingWindowCount: 0,
    safetyTabCount: 0
  });
  assert.deepEqual(result.view.workspaceTabs[0], {
    workspaceId: WORK_ID,
    tabCount: 3,
    discardedTabCount: 2,
    loadState: "partial"
  });
});

test("unload dematerializes drifted pins and groups while preserving logical layout", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, WORK_ID], [14, PERSONAL_ID]],
    activeWorkspaceId: PERSONAL_ID,
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-14" }
    ],
    layouts: [
      {
        workspaceId: WORK_ID,
        tabIds: ["tab-11", "tab-12", "tab-13"],
        pinnedTabIds: ["tab-11"],
        groups: [
          {
            id: "group-unload",
            title: "Unload",
            color: "orange",
            collapsed: false,
            tabIds: ["tab-12", "tab-13"]
          }
        ]
      },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-14"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [
      tab(11, 7, 0, false, { pinned: true }),
      tab(12, 7, 1, false, { groupId: 42 }),
      tab(13, 7, 2, false, { groupId: 42 }),
      tab(14, 7, 3, true)
    ],
    {
      initialRuntime,
      initialGroups: [
        { id: 42, windowId: 7, title: "Unload", color: "orange", collapsed: false }
      ],
      logicalGroupValues: [[12, "group-unload"], [13, "group-unload"]]
    }
  );
  const logicalLayoutBefore = structuredClone(
    harness.getRuntime().windows[0].workspaceLayouts[0]
  );

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);

  assert.equal(result.outcome.unpinnedCount, 1);
  assert.equal(result.outcome.ungroupedCount, 2);
  assert.equal(result.outcome.newlyHiddenCount, 3);
  assert.equal(result.outcome.newlyDiscardedCount, 3);
  assert.deepEqual(harness.getRuntime().windows[0].workspaceLayouts[0], logicalLayoutBefore);
});

test("workspace switching dematerializes and restores native pins and groups", async () => {
  const harness = createHarness(
    [
      tab(11, 7, 0, true, { pinned: true }),
      tab(12, 7, 1, false, { groupId: 42 }),
      tab(13, 7, 2, false, { groupId: 42 })
    ],
    {
      initialGroups: [
        { id: 42, windowId: 7, title: "Focus", color: "purple", collapsed: true }
      ],
      logicalGroupValues: [[12, "group-focus"], [13, "group-focus"]]
    }
  );

  await harness.controller.getView(7);
  const workLayout = harness.getRuntime().windows[0].workspaceLayouts[0];
  assert.deepEqual(workLayout.pinnedTabIds, ["tab-11"]);
  assert.deepEqual(workLayout.groups, [
    {
      id: "group-focus",
      title: "Focus",
      color: "purple",
      collapsed: true,
      tabIds: ["tab-12", "tab-13"]
    }
  ]);

  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  assert.ok(harness.getTabs().slice(0, 3).every((entry) => entry.hidden === true));
  assert.ok(harness.getTabs().slice(0, 3).every((entry) => entry.pinned === false));
  assert.ok(harness.getTabs().slice(0, 3).every((entry) => entry.groupId === -1));
  assert.equal(harness.getGroups().length, 0);

  await harness.controller.activateWorkspace(7, WORK_ID);
  const restored = harness.getTabs();
  assert.equal(restored.find((entry) => entry.id === 11).pinned, true);
  const restoredGroupId = restored.find((entry) => entry.id === 12).groupId;
  assert.notEqual(restoredGroupId, -1);
  assert.equal(restored.find((entry) => entry.id === 13).groupId, restoredGroupId);
  assert.deepEqual(
    harness.getGroups().find((group) => group.id === restoredGroupId),
    {
      id: restoredGroupId,
      windowId: 7,
      title: "Focus",
      color: "purple",
      collapsed: true
    }
  );
});

test("active native grouping and pinning mirror Firefox final exclusivity", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { pinned: true }),
    tab(12, 7, 1, false)
  ]);
  await harness.controller.getView(7);

  harness.setNativeGroup([11, 12], { title: "Pair", color: "blue" });
  await harness.controller.getView(7);
  let layout = harness.getRuntime().windows[0].workspaceLayouts[0];
  assert.deepEqual(layout.pinnedTabIds, []);
  assert.deepEqual(layout.groups[0].tabIds, ["tab-11", "tab-12"]);

  harness.setNativePinned(11, true);
  await harness.controller.getView(7);
  layout = harness.getRuntime().windows[0].workspaceLayouts[0];
  assert.deepEqual(layout.pinnedTabIds, ["tab-11"]);
  assert.deepEqual(layout.groups[0].tabIds, ["tab-12"]);
});

test("new tabs inherit a trustworthy opener workspace", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
    { initialRuntime }
  );
  await harness.controller.getView(7);
  harness.addTab(tab(13, 7, 2, false, { hidden: true, openerTabId: 12 }));

  await harness.controller.reconcileWindow(7);

  assert.equal(
    harness.getRuntime().tabs.find((entry) => entry.id === "tab-13").workspaceId,
    PERSONAL_ID
  );
  assert.equal(
    harness.getRuntime().windows[0].workspaceLayouts
      .find(({ workspaceId }) => workspaceId === PERSONAL_ID)
      .tree.find(({ tabId }) => tabId === "tab-13").parentTabId,
    "tab-12"
  );
  assert.equal(harness.getTabs().find((entry) => entry.id === 13).hidden, true);
});

test("sidebar tab intents pin, nest, collapse, and reject stale source placement", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12", "tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { hidden: true }),
    tab(13, 7, 2, false, { hidden: true })
  ], { initialRuntime });
  let view = await harness.controller.activateWorkspace(7, PERSONAL_ID);
  const row = view.activeTabs.find(({ logicalId }) => logicalId === "tab-13");
  const source = {
    tabId: row.logicalId,
    workspaceId: row.workspaceId,
    pinned: row.pinned,
    groupId: row.groupId,
    parentTabId: row.parentTabId
  };
  let result = await harness.controller.relocateTabs(7, [source], {
    workspaceId: PERSONAL_ID,
    zone: "pinned",
    relation: "end",
    anchorTabId: null,
    groupId: null,
    parentTabId: null
  });
  assert.equal(result.view.activeTabs.find(({ logicalId }) => logicalId === "tab-13").pinned, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).pinned, true);

  const pinnedRow = result.view.activeTabs.find(({ logicalId }) => logicalId === "tab-13");
  result = await harness.controller.relocateTabs(7, [{
    tabId: pinnedRow.logicalId,
    workspaceId: pinnedRow.workspaceId,
    pinned: pinnedRow.pinned,
    groupId: pinnedRow.groupId,
    parentTabId: pinnedRow.parentTabId
  }], {
    workspaceId: PERSONAL_ID,
    zone: "ungrouped",
    relation: "inside",
    anchorTabId: "tab-12",
    groupId: null,
    parentTabId: "tab-12"
  });
  const nested = result.view.activeTabs.find(({ logicalId }) => logicalId === "tab-13");
  assert.equal(nested.pinned, false);
  assert.equal(nested.parentTabId, "tab-12");
  view = await harness.controller.setTreeCollapsed(7, "tab-12", true);
  assert.equal(view.activeTabs.find(({ logicalId }) => logicalId === "tab-12").collapsed, true);
  assert.equal(view.activeTabs.find(({ logicalId }) => logicalId === "tab-13").hiddenByCollapsedAncestor, true);

  const runtimeBefore = harness.getRuntime();
  await assert.rejects(
    harness.controller.relocateTabs(7, [{ ...source, pinned: true }], {
      workspaceId: WORK_ID,
      zone: "ungrouped",
      relation: "end",
      anchorTabId: null,
      groupId: null,
      parentTabId: null
    }),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("sidebar actions create a native group with the Terminus defaults", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  await harness.controller.getView(7);

  const view = await harness.controller.createTabGroup(7, ["tab-11", "tab-12"]);

  assert.equal(view.activeGroups.length, 1);
  assert.equal(view.activeGroups[0].title, "", "a new group starts unnamed");
  // The runtime contract accepts an empty title, so an unnamed group is a
  // valid group rather than a value the next parse would reject.
  assert.equal(typeof view.activeGroups[0].title, "string");
  assert.equal(view.activeGroups[0].color, "grey");
  assert.deepEqual(view.activeGroups[0].tabIds, ["tab-11", "tab-12"]);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "group"),
    [["group", [11, 12], 100]]
  );
});

test("deleting a group ungroups its tabs without closing or reordering them", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  let view = await harness.controller.getView(7);
  view = await harness.controller.createTabGroup(7, ["tab-11", "tab-12"]);

  view = await harness.controller.deleteGroup(7, view.activeGroups[0].id);

  assert.deepEqual(view.activeGroups, []);
  assert.deepEqual(view.activeTabs.map(({ logicalId }) => logicalId), ["tab-11", "tab-12"]);
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [11, 12]);
  assert.ok(harness.getTabs().every(({ groupId }) => groupId === -1));
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "ungroup").at(-1),
    ["ungroup", [11, 12]]
  );
});

test("renaming a group persists its trimmed logical and native title", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  let view = await harness.controller.getView(7);
  view = await harness.controller.createTabGroup(7, ["tab-11", "tab-12"]);
  const logicalGroupId = view.activeGroups[0].id;

  view = await harness.controller.renameGroup(7, logicalGroupId, "  Research queue  ");

  assert.equal(view.activeGroups[0].title, "Research queue");
  assert.equal(
    harness.getRuntime().windows[0].workspaceLayouts[0].groups[0].title,
    "Research queue"
  );
  assert.equal(harness.getGroups()[0].title, "Research queue");
});

test("renaming a group rejects invalid titles without changing runtime", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  let view = await harness.controller.getView(7);
  view = await harness.controller.createTabGroup(7, ["tab-11", "tab-12"]);
  const logicalGroupId = view.activeGroups[0].id;
  const runtimeBefore = harness.getRuntime();

  for (const title of ["x".repeat(256), "bad\nname"]) {
    await assert.rejects(
      harness.controller.renameGroup(7, logicalGroupId, title),
      (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
    );
  }
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("sidebar actions unload an individual tab and keep Firefox selection valid", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  await harness.controller.getView(7);

  const view = await harness.controller.unloadTabs(7, ["tab-11"]);

  assert.equal(harness.getTabs().find(({ id }) => id === 11).discarded, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.equal(view.activeTabs.find(({ logicalId }) => logicalId === "tab-11").discarded, true);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "discard"),
    [["discard", 11]]
  );
});

test("sidebar Undo restores a relocated tree slice after semantic revalidation", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  const view = await harness.controller.getView(7);
  const row = view.activeTabs.find(({ logicalId }) => logicalId === "tab-12");
  const transaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TABS_RELOCATE,
    "Move tab"
  );
  await harness.controller.relocateTabs(7, [{
    tabId: row.logicalId,
    workspaceId: row.workspaceId,
    pinned: row.pinned,
    groupId: row.groupId,
    parentTabId: row.parentTabId
  }], {
    workspaceId: WORK_ID,
    zone: "ungrouped",
    relation: "inside",
    anchorTabId: "tab-11",
    groupId: null,
    parentTabId: "tab-11"
  }, transaction);
  assert.equal(
    harness.getRuntime().windows[0].workspaceLayouts[0].tree
      .find(({ tabId }) => tabId === "tab-12").parentTabId,
    "tab-11"
  );

  const undoEntry = transaction.entry();
  const restored = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(restored.outcome.status, "applied");
  assert.equal(
    harness.getRuntime().windows[0].workspaceLayouts[0].tree
      .find(({ tabId }) => tabId === "tab-12").parentTabId,
    null
  );
  const redone = await harness.controller.restoreSidebarUndo(
    7,
    reciprocalEntry(undoEntry, restored, SIDEBAR_UNDO_ACTIONS.REDO)
  );
  assert.equal(redone.outcome.status, "applied");
  assert.equal(
    harness.getRuntime().windows[0].workspaceLayouts[0].tree
      .find(({ tabId }) => tabId === "tab-12").parentTabId,
    "tab-11"
  );
});

test("sidebar Undo reloads only the tab observed newly discarded", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  await harness.controller.getView(7);
  const transaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD,
    "Unload tab"
  );
  await harness.controller.unloadTabs(7, ["tab-12"], transaction);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, true);

  const undoEntry = transaction.entry();
  const restored = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(restored.outcome.status, "applied");
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, false);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "reload-tabs").at(-1),
    ["reload-tabs", [12]]
  );
  const redone = await harness.controller.restoreSidebarUndo(
    7,
    reciprocalEntry(undoEntry, restored, SIDEBAR_UNDO_ACTIONS.REDO)
  );
  assert.equal(redone.outcome.status, "applied");
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, true);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "discard-batch").at(-1),
    ["discard-batch", [12]]
  );
});

// Inventory carries no page addresses, so a close slot can only reopen real
// pages if it reads them for exactly the tabs that close removes.
test("a close slot journals the pages of its own target tabs and nothing else", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { url: "https://active.example/" }),
    tab(12, 7, 1, false, { url: "https://closed.example/" }),
    tab(13, 7, 2, false, { url: "https://other.example/" })
  ], {
    settingsService: { async getOrInitialize() { return createDefaultSettingsState(); } },
    snapshotService: { async createFromInventory() {} }
  });
  await harness.controller.getView(7);
  assert.equal(
    harness.calls.some(([operation]) => operation === "tab-pages"),
    false,
    "building a view reads no page addresses"
  );

  const unloadTransaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD,
    "Unload tab"
  );
  await harness.controller.unloadTabs(7, ["tab-13"], unloadTransaction);
  assert.equal(
    harness.calls.some(([operation]) => operation === "tab-pages"),
    false,
    "an action that never reopens a tab reads no page addresses"
  );

  const preflight = await harness.controller.prepareCloseTabs(7, tabCloseTarget("tab-12", 12));
  const transaction = captureUndoTransaction(SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE, "Close tab");
  await harness.controller.closeTabs(7, preflight.token, transaction);

  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "tab-pages"),
    [["tab-pages", [12]]],
    "only the prepared target tab's page is read"
  );
  const entry = transaction.entry();
  assert.deepEqual(
    entry.before.browserTabs.map(({ logicalTabId, url }) => [logicalTabId, url]),
    [
      ["tab-11", "about:blank"],
      ["tab-12", "https://closed.example/"],
      ["tab-13", "about:blank"]
    ],
    "the closed tab carries its own page and every other tab stays address-free"
  );

  const restored = await harness.controller.restoreSidebarUndo(7, entry);
  assert.equal(harness.createdTabOptions.at(-1).url, "https://closed.example/");
  const redoEntry = reciprocalEntry(entry, restored, SIDEBAR_UNDO_ACTIONS.REDO);
  const redone = await harness.controller.restoreSidebarUndo(7, redoEntry);
  const undoAgain = reciprocalEntry(redoEntry, redone, SIDEBAR_UNDO_ACTIONS.UNDO);
  assert.equal(
    undoAgain.before.browserTabs.find(({ logicalTabId }) => logicalTabId === "tab-12").url,
    "https://closed.example/",
    "redoing a close journals the page again for the next Undo"
  );
  await harness.controller.restoreSidebarUndo(7, undoAgain);
  assert.equal(harness.createdTabOptions.at(-1).url, "https://closed.example/");
});

test("sidebar Undo recreates only the leaf observed closed and keeps focus unchanged", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { url: "https://active.example/" }),
    tab(12, 7, 1, false, { url: "https://closed.example/" })
  ]);
  await harness.controller.getView(7);
  const preflight = await harness.controller.prepareCloseTabs(
    7,
    tabCloseTarget("tab-12", 12)
  );
  const transaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE,
    "Close tab"
  );
  await harness.controller.closeTabs(7, preflight.token, transaction);
  assert.equal(harness.getTabs().some(({ id }) => id === 12), false);

  const undoEntry = transaction.entry();
  const restored = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(restored.outcome.restoredCount, 1);
  assert.equal(harness.getTabs().length, 2);
  assert.equal(harness.getTabs().find(({ active }) => active).id, 11);
  assert.equal(harness.createdTabOptions.at(-1).active, false);
  assert.equal(harness.createdTabOptions.at(-1).url, "https://closed.example/");
  const redoEntry = reciprocalEntry(undoEntry, restored, SIDEBAR_UNDO_ACTIONS.REDO);
  const redone = await harness.controller.restoreSidebarUndo(7, redoEntry);
  assert.equal(redone.outcome.restoredCount, 1);
  assert.equal(harness.getTabs().length, 1);

  const undoneAgain = await harness.controller.restoreSidebarUndo(
    7,
    reciprocalEntry(redoEntry, redone, SIDEBAR_UNDO_ACTIONS.UNDO)
  );
  assert.equal(undoneAgain.outcome.restoredCount, 1);
  assert.equal(harness.getTabs().length, 2);
});

async function nestTab(harness, childId, parentId) {
  const view = await harness.controller.getView(7);
  const row = view.activeTabs.find(({ logicalId }) => logicalId === childId);
  await harness.controller.relocateTabs(7, [{
    tabId: row.logicalId,
    workspaceId: row.workspaceId,
    pinned: row.pinned,
    groupId: row.groupId,
    parentTabId: row.parentTabId
  }], {
    workspaceId: WORK_ID,
    zone: "ungrouped",
    relation: "inside",
    anchorTabId: parentId,
    groupId: null,
    parentTabId: parentId
  });
}

function workTree(harness) {
  const layout = harness.getRuntime().windows[0].workspaceLayouts
    .find(({ workspaceId }) => workspaceId === WORK_ID);
  return Object.fromEntries(layout.tree.map((node) => [node.tabId, node]));
}

const TAB_MUTATION_CALLS = new Set([
  "create",
  "pin",
  "move",
  "group",
  "ungroup",
  "hide",
  "discard",
  "discard-batch",
  "remove-tabs",
  "separate-split"
]);

test("Flatten branch un-nests every descendant without a Firefox tab mutation", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false),
    tab(14, 7, 3, false)
  ]);
  await harness.controller.getView(7);
  await nestTab(harness, "tab-13", "tab-12");
  await nestTab(harness, "tab-14", "tab-13");
  await harness.controller.setTreeCollapsed(7, "tab-12", true);
  const orderBefore = harness.getRuntime().windows[0].workspaceLayouts
    .find(({ workspaceId }) => workspaceId === WORK_ID).tabIds;
  assert.equal(workTree(harness)["tab-14"].parentTabId, "tab-13");
  const callsBefore = harness.calls.length;

  const view = await harness.controller.flattenTreeBranch(7, [{ logicalTabId: "tab-12", firefoxTabId: 12 }]);

  const tree = workTree(harness);
  for (const tabId of ["tab-12", "tab-13", "tab-14"]) {
    assert.equal(tree[tabId].parentTabId, null, tabId);
    assert.equal(tree[tabId].collapsed, false, tabId);
  }
  assert.deepEqual(
    harness.getRuntime().windows[0].workspaceLayouts
      .find(({ workspaceId }) => workspaceId === WORK_ID).tabIds,
    orderBefore
  );
  assert.equal(view.activeTabs.find(({ logicalId }) => logicalId === "tab-14").parentTabId, null);
  assert.deepEqual(
    harness.calls.slice(callsBefore).filter(([operation]) => TAB_MUTATION_CALLS.has(operation)),
    []
  );
  assert.equal(harness.getTabs().length, 4);
});

test("Flatten branch keeps a nested root under its own parent", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false),
    tab(14, 7, 3, false)
  ]);
  await harness.controller.getView(7);
  await nestTab(harness, "tab-12", "tab-11");
  await nestTab(harness, "tab-13", "tab-12");
  await nestTab(harness, "tab-14", "tab-13");

  await harness.controller.flattenTreeBranch(7, [{ logicalTabId: "tab-12", firefoxTabId: 12 }]);

  const tree = workTree(harness);
  assert.equal(tree["tab-12"].parentTabId, "tab-11");
  assert.equal(tree["tab-13"].parentTabId, "tab-11");
  assert.equal(tree["tab-14"].parentTabId, "tab-11");
});

test("Flatten branch rejects a stale, childless, unknown, or inactive-workspace target unchanged", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false)
  ]);
  await harness.controller.getView(7);
  await nestTab(harness, "tab-13", "tab-12");
  const treeBefore = workTree(harness);

  for (const [logicalTabId, firefoxTabId] of [
    ["tab-12", 99],
    ["tab-11", 11],
    ["tab-missing", 12]
  ]) {
    await assert.rejects(
      harness.controller.flattenTreeBranch(7, [{ logicalTabId, firefoxTabId }]),
      (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
    );
    assert.deepEqual(workTree(harness), treeBefore);
  }

  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  await assert.rejects(
    harness.controller.flattenTreeBranch(7, [{ logicalTabId: "tab-12", firefoxTabId: 12 }]),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(workTree(harness), treeBefore);
});

test("sidebar Undo restores a flattened branch, Redo reapplies it, and a later change makes it stale", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false)
  ]);
  await harness.controller.getView(7);
  await nestTab(harness, "tab-13", "tab-12");
  const transaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN,
    "Flatten branch"
  );
  await harness.controller.flattenTreeBranch(7, [{ logicalTabId: "tab-12", firefoxTabId: 12 }], transaction);
  assert.equal(workTree(harness)["tab-13"].parentTabId, null);

  const undoEntry = transaction.entry();
  const restored = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(restored.outcome.status, "applied");
  assert.equal(workTree(harness)["tab-13"].parentTabId, "tab-12");
  const redone = await harness.controller.restoreSidebarUndo(
    7,
    reciprocalEntry(undoEntry, restored, SIDEBAR_UNDO_ACTIONS.REDO)
  );
  assert.equal(redone.outcome.status, "applied");
  assert.equal(workTree(harness)["tab-13"].parentTabId, null);

  const staleTransaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN,
    "Flatten branch"
  );
  await nestTab(harness, "tab-13", "tab-12");
  await harness.controller.flattenTreeBranch(7, [{ logicalTabId: "tab-12", firefoxTabId: 12 }], staleTransaction);
  await nestTab(harness, "tab-13", "tab-11");
  const stale = await harness.controller.restoreSidebarUndo(7, staleTransaction.entry());
  assert.notEqual(stale.outcome.status, "applied");
  assert.equal(workTree(harness)["tab-13"].parentTabId, "tab-11");
});

test("every non-closing sidebar operation preserves the exact favicon through Undo and Redo", async (t) => {
  const groupSetup = async (harness) => harness.controller.createTabGroup(
    7,
    ["tab-12", "tab-13"]
  );
  const treeSetup = async (harness) => {
    await nestTab(harness, "tab-13", "tab-12");
    return harness.controller.getView(7);
  };
  const scenarios = [
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.TABS_RELOCATE,
      temporarilyUnrendered: true,
      async act(harness, view, transaction) {
        const row = view.activeTabs.find(({ logicalId }) => logicalId === "tab-12");
        return harness.controller.relocateTabs(7, [{
          tabId: row.logicalId,
          workspaceId: row.workspaceId,
          pinned: row.pinned,
          groupId: row.groupId,
          parentTabId: row.parentTabId
        }], {
          workspaceId: PERSONAL_ID,
          zone: "ungrouped",
          relation: "end",
          anchorTabId: null,
          groupId: null,
          parentTabId: null
        }, transaction);
      }
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_CREATE,
      act: (harness, _view, transaction) => harness.controller.createTabGroup(
        7,
        ["tab-12", "tab-13"],
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RELOCATE,
      setup: groupSetup,
      temporarilyUnrendered: true,
      act(harness, view, transaction) {
        const group = view.activeGroups[0];
        return harness.controller.relocateGroup(7, {
          groupId: group.id,
          workspaceId: WORK_ID,
          tabIds: group.tabIds
        }, {
          workspaceId: PERSONAL_ID,
          relation: "end",
          anchorTabId: null
        }, transaction);
      }
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
      setup: groupSetup,
      act: (harness, view, transaction) => harness.controller.renameGroup(
        7,
        view.activeGroups[0].id,
        "Renamed group",
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.GROUP_DELETE,
      setup: groupSetup,
      act: (harness, view, transaction) => harness.controller.deleteGroup(
        7,
        view.activeGroups[0].id,
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN,
      setup: treeSetup,
      act: (harness, _view, transaction) => harness.controller.flattenTreeBranch(
        7,
        [{ logicalTabId: "tab-12", firefoxTabId: 12 }],
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_CREATE,
      act: (harness, _view, transaction) => harness.controller.createWorkspace(7, {
        name: "Media",
        icon: "gamepad",
        color: "#112233"
      }, transaction)
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
      act: (harness, _view, transaction) => harness.controller.updateWorkspace(
        7,
        WORK_ID,
        { name: "Office" },
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RELOCATE,
      act: (harness, _view, transaction) => harness.controller.placeRailEntry(
        7,
        { kind: "workspace", id: WORK_ID },
        { kind: "workspace", id: PERSONAL_ID },
        "after",
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
      act: (harness, _view, transaction) => harness.controller.removeWorkspace(
        7,
        WORK_ID,
        transaction
      )
    },
    {
      operation: SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD,
      act: (harness, _view, transaction) => harness.controller.unloadTabs(
        7,
        ["tab-12"],
        transaction
      )
    }
  ];

  assert.deepEqual(
    new Set(scenarios.map(({ operation }) => operation)),
    new Set(
      Object.values(SIDEBAR_UNDO_OPERATION_KINDS)
        .filter((operation) =>
          operation !== SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE &&
          operation !== SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE
        )
    ),
    "close and container moves replace Firefox handles, so their favicons are reacquired instead"
  );

  for (const scenario of scenarios) {
    await t.test(scenario.operation, async () => {
      const harness = createHarness([
        tab(11, 7, 0, true),
        tab(12, 7, 1, false),
        tab(13, 7, 2, false)
      ]);
      let view = await harness.controller.getView(7);
      if (scenario.setup) view = await scenario.setup(harness, view);
      const favicons = createFaviconRenderHarness();
      try {
        favicons.render(view);
        await favicons.settle();
        const original = favicons.slot("tab-12", 12)?.children[0];
        assert.ok(original, "the tracked tab starts with a decoded favicon");
        const initialRequestCount = favicons.requests.length;

        const transaction = captureUndoTransaction(scenario.operation, scenario.operation);
        const actionResult = await scenario.act(harness, view, transaction);
        const actionView = actionResult?.view ?? (
          Array.isArray(actionResult?.activeTabs)
            ? actionResult
            : await harness.controller.getView(7)
        );
        favicons.render(actionView);
        if (scenario.temporarilyUnrendered) {
          assert.equal(
            favicons.slot("tab-12", 12),
            null,
            "a cross-workspace move removes only the current row projection"
          );
        } else {
          assert.equal(
            favicons.slot("tab-12", 12)?.children[0],
            original,
            "the forward action reattaches the original decoded node"
          );
        }

        const undoEntry = transaction.entry();
        assert.equal(undoEntry.operation, scenario.operation);
        const undone = await harness.controller.restoreSidebarUndo(7, undoEntry);
        assert.equal(undone.outcome.status, "applied");
        favicons.render(undone.view);
        assert.equal(
          favicons.slot("tab-12", 12)?.children[0],
          original,
          "Undo keeps the same composite-identity favicon"
        );

        const redoEntry = reciprocalEntry(undoEntry, undone, SIDEBAR_UNDO_ACTIONS.REDO);
        assert.equal(redoEntry.operation, scenario.operation);
        const redone = await harness.controller.restoreSidebarUndo(7, redoEntry);
        assert.equal(redone.outcome.status, "applied");
        favicons.render(redone.view);
        if (scenario.temporarilyUnrendered) {
          assert.equal(favicons.slot("tab-12", 12), null);
          const secondUndoEntry = reciprocalEntry(
            redoEntry,
            redone,
            SIDEBAR_UNDO_ACTIONS.UNDO
          );
          assert.equal(secondUndoEntry.operation, scenario.operation);
          const undoneAgain = await harness.controller.restoreSidebarUndo(7, secondUndoEntry);
          assert.equal(undoneAgain.outcome.status, "applied");
          favicons.render(undoneAgain.view);
          assert.equal(
            favicons.slot("tab-12", 12)?.children[0],
            original,
            "Undo after Redo reattaches the retained off-projection favicon"
          );
        } else {
          assert.equal(
            favicons.slot("tab-12", 12)?.children[0],
            original,
            "Redo keeps the same composite-identity favicon"
          );
        }

        for (const renderedView of [actionView, undone.view, redone.view]) {
          assert.ok(renderedView.liveTabIdentities.some(({ logicalTabId, firefoxTabId }) =>
            logicalTabId === "tab-12" && firefoxTabId === 12
          ));
        }
        assert.equal(
          favicons.requests.length,
          initialRequestCount,
          "unchanged live identities never perform another cache lookup"
        );
        assert.deepEqual(
          favicons.revokedUrls,
          [],
          "unchanged live identities are not revoked during action reversal"
        );
      } finally {
        favicons.destroy();
      }
    });
  }
});

test("tab-close Undo and Redo reacquire each recreated Firefox identity without borrowing the old image", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { url: "https://active.example/" }),
    tab(12, 7, 1, false, { url: "https://closed.example/" })
  ]);
  const favicons = createFaviconRenderHarness();
  try {
    const initialView = await harness.controller.getView(7);
    favicons.render(initialView);
    await favicons.settle();
    const closedImage = favicons.slot("tab-12", 12)?.children[0];
    assert.ok(closedImage);

    const preflight = await harness.controller.prepareCloseTabs(
      7,
      tabCloseTarget("tab-12", 12)
    );
    const transaction = captureUndoTransaction(
      SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE,
      "Close tab"
    );
    const closed = await harness.controller.closeTabs(7, preflight.token, transaction);
    favicons.render(closed.view);
    assert.ok(favicons.revokedUrls.includes(closedImage.source));

    const undoEntry = transaction.entry();
    assert.equal(undoEntry.operation, SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE);
    const undone = await harness.controller.restoreSidebarUndo(7, undoEntry);
    favicons.render(undone.view);
    await favicons.settle();
    const firstRestoredTab = harness.getTabs().find((entry) => entry.id !== 11);
    assert.equal(firstRestoredTab.id, 13, "the browser double cannot reuse the closed handle");
    const firstRestoredImage = favicons.slot("tab-12", firstRestoredTab.id)?.children[0];
    assert.ok(firstRestoredImage);
    assert.notEqual(firstRestoredImage, closedImage);
    assert.notEqual(firstRestoredImage.source, closedImage.source);

    const redoEntry = reciprocalEntry(undoEntry, undone, SIDEBAR_UNDO_ACTIONS.REDO);
    const redone = await harness.controller.restoreSidebarUndo(7, redoEntry);
    favicons.render(redone.view);
    assert.ok(favicons.revokedUrls.includes(firstRestoredImage.source));

    const secondUndoEntry = reciprocalEntry(redoEntry, redone, SIDEBAR_UNDO_ACTIONS.UNDO);
    const undoneAgain = await harness.controller.restoreSidebarUndo(7, secondUndoEntry);
    favicons.render(undoneAgain.view);
    await favicons.settle();
    const secondRestoredTab = harness.getTabs().find((entry) => entry.id !== 11);
    assert.equal(secondRestoredTab.id, 14);
    const secondRestoredImage = favicons.slot("tab-12", secondRestoredTab.id)?.children[0];
    assert.ok(secondRestoredImage);
    assert.notEqual(secondRestoredImage, firstRestoredImage);
    assert.notEqual(secondRestoredImage.source, firstRestoredImage.source);

    assert.deepEqual(
      favicons.requests.slice(1).map(({ tabs }) => tabs),
      [
        [{ logicalId: "tab-12", firefoxTabId: 13 }],
        [{ logicalId: "tab-12", firefoxTabId: 14 }]
      ],
      "each restoration performs one exact-reference cache lookup"
    );
    assert.equal(
      favicons.requests.slice(1).flatMap(({ tabs }) => tabs)
        .some(({ firefoxTabId }) => firefoxTabId === 12),
      false,
      "the old Firefox handle is never looked up after close"
    );
    assert.equal(new Set(favicons.revokedUrls).size, favicons.revokedUrls.length);
  } finally {
    favicons.destroy();
  }
});

test("partial close Undo renders only the eligible recreated identity and preserves the safety favicon", async (t) => {
  const scenarios = [
    { name: "exact recreated favicon cache hit", cacheRestoredIcon: true },
    { name: "exact recreated favicon cache miss", cacheRestoredIcon: false }
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const resolveCalls = [];
      const containerService = {
        async refresh() {},
        async resolve(refId) {
          resolveCalls.push(refId);
          throw new Error("Synthetic unavailable container");
        },
        presentationForCookieStore(cookieStoreId) {
          return cookieStoreId === "firefox-container-missing"
            ? {
                kind: "container",
                refId: "ctr-missing",
                descriptor: {
                  name: "Missing",
                  color: "blue",
                  icon: "fingerprint",
                  colorCode: "#37adff"
                },
                status: "unavailable"
              }
            : { kind: "none" };
        }
      };
      const initialRuntime = {
        schemaVersion: 5,
        tabs: [11, 12, 13].map((id) => ({ id: `tab-${id}`, workspaceId: WORK_ID })),
        windows: [{
          id: "window-7",
          activeWorkspaceId: WORK_ID,
          selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-12" }],
          workspaceLayouts: [{
            workspaceId: WORK_ID,
            tabIds: ["tab-11", "tab-12", "tab-13"],
            pinnedTabIds: [],
            groups: [],
            tree: [
              { tabId: "tab-11", parentTabId: null, collapsed: false },
              { tabId: "tab-12", parentTabId: null, collapsed: false },
              { tabId: "tab-13", parentTabId: "tab-12", collapsed: false }
            ],
            splitViews: []
          }],
          pendingOperation: null
        }]
      };
      const harness = createHarness([
        tab(11, 7, 0, false, { url: "https://safety.example/" }),
        tab(12, 7, 1, true, { url: "https://restored.example/" }),
        tab(13, 7, 2, false, {
          url: "https://container.example/",
          cookieStoreId: "firefox-container-missing"
        })
      ], {
        initialRuntime,
        containerService,
        settingsService: {
          async getOrInitialize() { return createDefaultSettingsState(); }
        },
        snapshotService: {
          async createFromInventory() {}
        }
      });
      const faviconKey = (logicalId, firefoxTabId) => `${logicalId}\u0000${firefoxTabId}`;
      const cached = new Set([
        faviconKey("tab-11", 11),
        faviconKey("tab-12", 12),
        faviconKey("tab-13", 13)
      ]);
      if (scenario.cacheRestoredIcon) cached.add(faviconKey("tab-12", 14));
      const favicons = createFaviconRenderHarness({
        resolveIcon({ logicalId, firefoxTabId }) {
          return cached.has(faviconKey(logicalId, firefoxTabId))
            ? Uint8Array.of(firefoxTabId)
            : null;
        }
      });

      try {
        const initialView = await harness.controller.getView(7);
        favicons.render(initialView);
        await favicons.settle();
        const safetyImage = favicons.slot("tab-11", 11)?.children[0];
        const eligibleOldImage = favicons.slot("tab-12", 12)?.children[0];
        const unavailableOldImage = favicons.slot("tab-13", 13)?.children[0];
        assert.ok(safetyImage);
        assert.ok(eligibleOldImage);
        assert.ok(unavailableOldImage);

        const preflight = await harness.controller.prepareCloseTabs(
          7,
          tabCloseTarget("tab-12", 12, "branch")
        );
        assert.equal(preflight.tabCount, 2);
        const transaction = captureUndoTransaction(
          SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE,
          "Close branch"
        );
        const closed = await harness.controller.closeTabs(7, preflight.token, transaction);
        favicons.render(closed.view);
        assert.equal(favicons.slot("tab-11", 11)?.children[0], safetyImage);
        assert.ok(favicons.revokedUrls.includes(eligibleOldImage.source));
        assert.ok(favicons.revokedUrls.includes(unavailableOldImage.source));
        assert.equal(favicons.revokedUrls.includes(safetyImage.source), false);

        const undone = await harness.controller.restoreSidebarUndo(7, transaction.entry());
        assert.deepEqual(undone.outcome, {
          status: "partial",
          requestedCount: 2,
          restoredCount: 1,
          skippedCount: 1,
          failedCount: 0,
          approximatedCount: 0,
          retainedSafetyCount: 0,
          reasons: [{ reason: "container-unavailable", count: 1 }]
        });
        assert.deepEqual(resolveCalls, ["ctr-missing"]);
        assert.deepEqual(harness.getTabs().map(({ id }) => id), [11, 14]);
        assert.equal(
          undone.view.liveTabIdentities.some(({ logicalTabId, firefoxTabId }) =>
            logicalTabId === "tab-12" && firefoxTabId === 14
          ),
          true
        );
        assert.equal(
          undone.view.liveTabIdentities.some(({ logicalTabId }) => logicalTabId === "tab-13"),
          false
        );

        favicons.render(undone.view);
        await favicons.settle();
        assert.equal(
          favicons.slot("tab-11", 11)?.children[0],
          safetyImage,
          "Undo retains the unaffected active successor's decoded favicon"
        );
        assert.equal(favicons.slot("tab-13", 13), null);
        assert.deepEqual(
          favicons.requests.slice(1).flatMap(({ tabs }) => tabs),
          [{ logicalId: "tab-12", firefoxTabId: 14 }],
          "the controller's final view triggers only the exact recreated-identity lookup"
        );
        const restoredSlot = favicons.slot("tab-12", 14);
        assert.ok(restoredSlot);
        const restoredImage = restoredSlot.children[0];
        if (scenario.cacheRestoredIcon) {
          assert.ok(restoredImage);
          assert.equal(
            [safetyImage, eligibleOldImage, unavailableOldImage].includes(restoredImage),
            false,
            "the new Firefox handle never borrows an existing decoded image"
          );
          assert.notEqual(restoredImage.source, eligibleOldImage.source);
        } else {
          assert.equal(restoredImage, undefined);
          assert.equal(restoredSlot.classList.has("tab-favicon--loaded"), false);
        }
        assert.equal(
          favicons.requests.slice(1).flatMap(({ tabs }) => tabs)
            .some(({ firefoxTabId }) => firefoxTabId === 12 || firefoxTabId === 13),
          false,
          "closed Firefox handles are never queried again"
        );
        assert.equal(new Set(favicons.revokedUrls).size, favicons.revokedUrls.length);
      } finally {
        favicons.destroy();
      }
    });
  }
});

test("individual unload wakes the next unloaded tab below the active row", async () => {
  const harness = createHarness([
    tab(11, 7, 0, false, { discarded: true }),
    tab(12, 7, 1, true),
    tab(13, 7, 2, false, { discarded: true })
  ]);
  await harness.controller.getView(7);

  const view = await harness.controller.unloadTabs(7, ["tab-12"]);

  assert.equal(harness.getTabs().find(({ id }) => id === 11).discarded, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).discarded, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).active, true);
  assert.equal(view.activeTabs.find(({ logicalId }) => logicalId === "tab-13").active, true);
});

test("individual unload selects the first remaining loaded tab from the top of its workspace", async () => {
  const harness = createHarness([
    tab(11, 7, 0, false),
    tab(12, 7, 1, false),
    tab(13, 7, 2, true),
    tab(14, 7, 3, false, { discarded: true })
  ]);
  await harness.controller.getView(7);

  const view = await harness.controller.unloadTabs(7, ["tab-13"]);

  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).discarded, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 14).discarded, true);
  assert.equal(view.activeTabs.find(({ logicalId }) => logicalId === "tab-11").active, true);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "activate").at(-1),
    ["activate", 11]
  );
});

test("individual unload excludes every requested tab when choosing a loaded successor", async () => {
  const harness = createHarness([
    tab(11, 7, 0, false),
    tab(12, 7, 1, false),
    tab(13, 7, 2, true)
  ]);
  await harness.controller.getView(7);

  await harness.controller.unloadTabs(7, ["tab-13", "tab-11"]);

  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).discarded, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).discarded, true);
});

test("individual unload switches to the next rail workspace after the last row", async () => {
  const harness = createHarness([
    tab(11, 7, 0, false, { discarded: true }),
    tab(12, 7, 1, true)
  ]);
  await harness.controller.getView(7);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  await harness.controller.activateWorkspace(7, WORK_ID);

  const view = await harness.controller.unloadTabs(7, ["tab-12"]);

  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, true);
  assert.equal(
    harness.getTabs().find(({ id }) => id === 13).active,
    true
  );
});

test("invalid active-tab destinations reject before creating a source replacement", async () => {
  const harness = createHarness([tab(11, 7, 0, true)]);
  const view = await harness.controller.getView(7);
  const row = view.activeTabs[0];
  const callsBefore = harness.calls.length;
  await assert.rejects(
    harness.controller.relocateTabs(7, [{
      tabId: row.logicalId,
      workspaceId: row.workspaceId,
      pinned: row.pinned,
      groupId: row.groupId,
      parentTabId: row.parentTabId
    }], {
      workspaceId: PERSONAL_ID,
      zone: "ungrouped",
      relation: "after",
      anchorTabId: "tab-missing",
      groupId: null,
      parentTabId: null
    }),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(harness.calls.slice(callsBefore).some(([name]) => name === "create"), false);
  assert.equal(harness.getRuntime().tabs.length, 1);
});

test("moving an active pinned tab keeps its logical pin without switching workspaces", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      {
        workspaceId: WORK_ID,
        tabIds: ["tab-11", "tab-12"],
        pinnedTabIds: ["tab-11"],
        groups: []
      },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [
      tab(11, 7, 0, true, { pinned: true }),
      tab(12, 7, 1, false),
      tab(13, 7, 2, false, { hidden: true })
    ],
    { initialRuntime }
  );

  const result = await harness.controller.moveTabToWorkspace(11, PERSONAL_ID);

  assert.equal(result.view.activeWorkspaceId, WORK_ID);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).active, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).hidden, true);
  const personalLayout = harness.getRuntime().windows[0].workspaceLayouts.find(
    (entry) => entry.workspaceId === PERSONAL_ID
  );
  assert.deepEqual(personalLayout.pinnedTabIds, ["tab-11"]);

  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).pinned, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).active, true);
});

test("sidebar whole-group placement preserves identity and presentation", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, WORK_ID], [14, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-14" }
    ],
    layouts: [
      {
        workspaceId: WORK_ID,
        tabIds: ["tab-11", "tab-12", "tab-13"],
        pinnedTabIds: [],
        groups: [
          {
            id: "group-focus",
            title: "Focus",
            color: "green",
            collapsed: true,
            tabIds: ["tab-11", "tab-12"]
          }
        ]
      },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-14"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [
      tab(11, 7, 0, true, { groupId: 42, cookieStoreId: "firefox-container-1" }),
      tab(12, 7, 1, false, { groupId: 42, cookieStoreId: "firefox-container-2" }),
      tab(13, 7, 2, false),
      tab(14, 7, 3, false, { hidden: true })
    ],
    {
      initialRuntime,
      initialGroups: [
        { id: 42, windowId: 7, title: "Focus", color: "green", collapsed: true }
      ],
      logicalGroupValues: [[11, "group-focus"], [12, "group-focus"]]
    }
  );

  await harness.controller.getView(7);
  const expanded = await harness.controller.setGroupCollapsed(7, "group-focus", false);
  assert.equal(expanded.activeGroups[0].collapsed, false);
  assert.equal(harness.getGroups()[0].collapsed, false);
  const result = await harness.controller.relocateGroup(
    7,
    {
      groupId: "group-focus",
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"]
    },
    { workspaceId: PERSONAL_ID, relation: "end", anchorTabId: null }
  );

  assert.equal(result.view.activeWorkspaceId, WORK_ID);
  assert.equal(harness.getTabs().find((entry) => entry.id === 13).active, true);
  assert.ok(harness.getTabs().filter((entry) => [11, 12].includes(entry.id)).every((entry) => entry.hidden));
  const group = harness.getRuntime().windows[0].workspaceLayouts
    .find((entry) => entry.workspaceId === PERSONAL_ID)
    .groups[0];
  assert.deepEqual(group, {
    id: "group-focus",
    title: "Focus",
    color: "green",
    collapsed: false,
    tabIds: ["tab-11", "tab-12"]
  });
  assert.deepEqual(
    harness.getTabs().filter(({ id }) => [11, 12].includes(id)).map(({ id, cookieStoreId }) => ({
      id,
      cookieStoreId
    })),
    [
      { id: 11, cookieStoreId: "firefox-container-1" },
      { id: 12, cookieStoreId: "firefox-container-2" }
    ]
  );
  assert.equal(harness.calls.some(([name]) => name === "create"), false);

  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  const restoredGroupId = harness.getTabs().find((entry) => entry.id === 11).groupId;
  assert.notEqual(restoredGroupId, -1);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).groupId, restoredGroupId);
});

test("native highlighted selection moves atomically and preserves complete groups and pins", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [
      [11, WORK_ID], [12, WORK_ID], [13, WORK_ID], [14, WORK_ID],
      [15, WORK_ID], [16, WORK_ID], [17, PERSONAL_ID]
    ],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-17" }
    ],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12", "tab-13", "tab-14", "tab-15", "tab-16"],
      pinnedTabIds: ["tab-11"],
      groups: [{
        id: "group-complete",
        title: "Complete",
        color: "purple",
        collapsed: true,
        tabIds: ["tab-12", "tab-13"]
      }, {
        id: "group-partial",
        title: "Partial",
        color: "orange",
        collapsed: false,
        tabIds: ["tab-14", "tab-15"]
      }]
    }, {
      workspaceId: PERSONAL_ID,
      tabIds: ["tab-17"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { pinned: true }),
    tab(12, 7, 1, false, { highlighted: true, groupId: 42 }),
    tab(13, 7, 2, false, { highlighted: true, groupId: 42 }),
    tab(14, 7, 3, false, { highlighted: true, groupId: 43 }),
    tab(15, 7, 4, false, { groupId: 43 }),
    tab(16, 7, 5, false, { highlighted: true }),
    tab(17, 7, 6, false, { hidden: true })
  ], {
    initialRuntime,
    initialGroups: [
      { id: 42, windowId: 7, title: "Complete", color: "purple", collapsed: true },
      { id: 43, windowId: 7, title: "Partial", color: "orange", collapsed: false }
    ],
    logicalGroupValues: [
      [12, "group-complete"], [13, "group-complete"],
      [14, "group-partial"], [15, "group-partial"]
    ]
  });

  const result = await harness.controller.relocateNativeSelection(7, [
    { logicalTabId: "tab-16", firefoxTabId: 16 },
    { logicalTabId: "tab-13", firefoxTabId: 13 },
    { logicalTabId: "tab-11", firefoxTabId: 11 },
    { logicalTabId: "tab-14", firefoxTabId: 14 },
    { logicalTabId: "tab-12", firefoxTabId: 12 }
  ], PERSONAL_ID);

  assert.equal(result.view.activeWorkspaceId, WORK_ID);
  assert.equal(result.outcome.requestedCount, 5);
  assert.equal(harness.getTabs().find(({ id }) => id === 15).active, true);
  assert.ok(
    harness.getTabs()
      .filter(({ id }) => [11, 12, 13, 14, 16].includes(id))
      .every(({ hidden }) => hidden)
  );
  const runtime = harness.getRuntime();
  const work = runtime.windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === WORK_ID
  );
  const personal = runtime.windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === PERSONAL_ID
  );
  assert.deepEqual(work.tabIds, ["tab-15"]);
  assert.deepEqual(work.groups, [{
    id: "group-partial",
    title: "Partial",
    color: "orange",
    collapsed: false,
    tabIds: ["tab-15"]
  }]);
  assert.deepEqual(personal.tabIds, [
    "tab-11", "tab-17", "tab-12", "tab-13", "tab-14", "tab-16"
  ]);
  assert.deepEqual(personal.pinnedTabIds, ["tab-11"]);
  assert.deepEqual(personal.groups, [{
    id: "group-complete",
    title: "Complete",
    color: "purple",
    collapsed: true,
    tabIds: ["tab-12", "tab-13"]
  }]);
});

test("native selection rejects stale highlighted sets and mismatched handles without mutation", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ], { initialRuntime });
  await harness.controller.getView(7);
  const before = harness.getRuntime();

  await assert.rejects(
    harness.controller.relocateNativeSelection(7, [
      { logicalTabId: "tab-11", firefoxTabId: 11 },
      { logicalTabId: "tab-12", firefoxTabId: 12 }
    ], PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(harness.getRuntime(), before);

  await assert.rejects(
    harness.controller.relocateNativeSelection(7, [
      { logicalTabId: "tab-12", firefoxTabId: 11 }
    ], PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(harness.getRuntime(), before);
});

test("native selection retains one pending intent after a hide failure and converges on retry", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }, {
      workspaceId: PERSONAL_ID,
      tabIds: ["tab-13"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false, { hidden: true })
  ], { initialRuntime, hideFailure: true });

  const partial = await harness.controller.relocateNativeSelection(7, [
    { logicalTabId: "tab-11", firefoxTabId: 11 }
  ], PERSONAL_ID);

  assert.equal(partial.outcome.status, "partial");
  assert.equal(harness.getRuntime().tabs.find(({ id }) => id === "tab-11").workspaceId, PERSONAL_ID);
  assert.deepEqual(harness.getRuntime().windows[0].pendingOperation?.kind, "relocate-tabs");
  assert.equal(harness.getTabs().find(({ id }) => id === 11).hidden, false);

  harness.setHideFailure(false);
  await harness.controller.getView(7);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).hidden, true);
});

test("pending activation state resumes to convergence after interruption", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    activeWorkspaceId: PERSONAL_ID,
    selectedTabs: [{ workspaceId: PERSONAL_ID, tabId: "tab-12" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: ["tab-12"], groups: [] }
    ],
    pendingOperation: { id: "operation-interrupted", kind: "activate-workspace" }
  });
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
    { initialRuntime }
  );

  const view = await harness.controller.getView(7);

  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).active, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).pinned, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).hidden, true);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
});

test("a tab lost during a pending operation produces a bounded missing-target notice", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[20, WORK_ID], [12, PERSONAL_ID]],
    activeWorkspaceId: PERSONAL_ID,
    selectedTabs: [{ workspaceId: PERSONAL_ID, tabId: "tab-12" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-20"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ],
    pendingOperation: { id: "operation-missing", kind: "activate-workspace" }
  });
  const harness = createHarness([tab(20, 7, 0, true)], { initialRuntime });

  const view = await harness.controller.getView(7);

  assert.equal(view.notice.retryable, false);
  assert.deepEqual(view.notice.reasons, [
    { reason: "missing-tab", count: 1, retryable: false }
  ]);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
});

test("reconciliation adopts the next live workspace tab instead of creating a replacement", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[12, PERSONAL_ID]],
    layouts: [
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([tab(12, 7, 0, true)], { initialRuntime });

  const view = await harness.controller.getView(7);

  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().length, 1);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).active, true);
  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
});

test("mixed-workspace native groups split without changing workspace ownership", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [tab(11, 7, 0, true, { groupId: 42 }), tab(12, 7, 1, false, { groupId: 42 })],
    {
      initialRuntime,
      initialGroups: [
        { id: 42, windowId: 7, title: "Mixed", color: "orange", collapsed: false }
      ]
    }
  );

  await harness.controller.getView(7);

  const runtime = harness.getRuntime();
  assert.equal(runtime.tabs.find((entry) => entry.id === "tab-11").workspaceId, WORK_ID);
  assert.equal(runtime.tabs.find((entry) => entry.id === "tab-12").workspaceId, PERSONAL_ID);
  assert.equal(runtime.windows[0].workspaceLayouts[0].groups[0].title, "Mixed");
  assert.equal(runtime.windows[0].workspaceLayouts[1].groups[0].title, "Mixed");
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).hidden, true);
  assert.equal(harness.getNotice(7).reasons[0].reason, "mixed-workspace-group");
});

test("a whole native group detached to another normal window keeps its logical identity", async () => {
  const initialRuntime = {
    schemaVersion: 3,
    tabs: [11, 12, 13, 21].map((id) => ({ id: `tab-${id}`, workspaceId: WORK_ID })),
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-11", "tab-12", "tab-13"],
            pinnedTabIds: [],
            groups: [
              {
                id: "group-detached",
                title: "Detached",
                color: "purple",
                collapsed: true,
                tabIds: ["tab-12", "tab-13"]
              }
            ]
          }
        ],
        pendingOperation: null
      },
      {
        id: "window-8",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-21" }],
        workspaceLayouts: [
          { workspaceId: WORK_ID, tabIds: ["tab-21"], pinnedTabIds: [], groups: [] }
        ],
        pendingOperation: null
      }
    ]
  };
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(21, 8, 0, true),
      tab(12, 8, 1, false, { groupId: 52 }),
      tab(13, 8, 2, false, { groupId: 52 })
    ],
    {
      initialRuntime,
      initialGroups: [
        { id: 52, windowId: 8, title: "Detached", color: "purple", collapsed: true }
      ],
      logicalGroupValues: [[12, "group-detached"], [13, "group-detached"]]
    }
  );

  await harness.controller.getView(8);

  const runtime = harness.getRuntime();
  assert.deepEqual(runtime.windows[0].workspaceLayouts[0].groups, []);
  assert.deepEqual(runtime.windows[1].workspaceLayouts[0].groups, [
    {
      id: "group-detached",
      title: "Detached",
      color: "purple",
      collapsed: true,
      tabIds: ["tab-12", "tab-13"]
    }
  ]);
});

test("a detached active tab makes its workspace active in a newly observed window", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 8, 0, true)],
    { initialRuntime }
  );

  const view = await harness.controller.getView(8);

  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().length, 2);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).hidden, false);
  const destination = harness.getRuntime().windows.find((entry) => entry.id === "window-8");
  assert.deepEqual(destination.selectedTabs, [
    { workspaceId: PERSONAL_ID, tabId: "tab-12" }
  ]);
});

function savedLayout(workspaceId, tabIds, parents = {}) {
  return {
    workspaceId,
    tabIds,
    pinnedTabIds: [],
    groups: [],
    tree: tabIds.map((tabId) => ({ tabId, parentTabId: parents[tabId] ?? null, collapsed: false })),
    splitViews: []
  };
}

// One window as Firefox last saved it: Work holds tab-11, Personal is active
// and holds tab-21 with tab-22 nested under it.
function savedSessionRuntime() {
  return {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-21", workspaceId: PERSONAL_ID },
      { id: "tab-22", workspaceId: PERSONAL_ID }
    ],
    windows: [{
      id: "window-saved",
      activeWorkspaceId: PERSONAL_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-11" },
        { workspaceId: PERSONAL_ID, tabId: "tab-22" }
      ],
      workspaceLayouts: [
        savedLayout(WORK_ID, ["tab-11"]),
        savedLayout(PERSONAL_ID, ["tab-21", "tab-22"], { "tab-22": "tab-21" })
      ],
      pendingOperation: null
    }]
  };
}

// Firefox restores a saved window into an open one by giving the window its
// saved values, reusing the selected tab for the saved selected tab, and
// creating the other saved tabs.
function restoreSavedWindow(harness, windowId, reusedTabId) {
  harness.closeTabs([reusedTabId]);
  harness.setSavedWindowIdentity(windowId, "window-saved");
  harness.setSavedTabIdentity(11, "tab-11");
  harness.setSavedTabIdentity(21, "tab-21");
  harness.setSavedTabIdentity(reusedTabId, "tab-22");
  harness.addTab(tab(11, windowId, 0, false, { hidden: true }));
  harness.addTab(tab(21, windowId, 1, false));
  harness.addTab(tab(reusedTabId, windowId, 2, true));
}

function assertSavedSessionKept(runtime) {
  assert.deepEqual(runtime.windows.map(({ id }) => id), ["window-saved"]);
  const [windowRuntime] = runtime.windows;
  assert.equal(windowRuntime.activeWorkspaceId, PERSONAL_ID);
  assert.deepEqual(
    Object.fromEntries(runtime.tabs.map(({ id, workspaceId }) => [id, workspaceId])),
    { "tab-11": WORK_ID, "tab-21": PERSONAL_ID, "tab-22": PERSONAL_ID }
  );
  const personal = windowRuntime.workspaceLayouts.find(({ workspaceId }) => workspaceId === PERSONAL_ID);
  assert.deepEqual(personal.tabIds, ["tab-21", "tab-22"]);
  assert.equal(
    personal.tree.find(({ tabId }) => tabId === "tab-22").parentTabId,
    "tab-21",
    "the restored tree keeps its nesting"
  );
  assert.deepEqual(
    windowRuntime.selectedTabs.find(({ workspaceId }) => workspaceId === WORK_ID),
    { workspaceId: WORK_ID, tabId: "tab-11" }
  );
}

test("a window Firefox restores after startup keeps its saved workspaces instead of the first", async () => {
  // Firefox wakes Terminus once the first window paints, while that window
  // still shows one blank tab and its saved session is not restored yet.
  const harness = createHarness([tab(1, 7, 0, true)], {
    initialRuntime: savedSessionRuntime(),
    retainClosedWindows: true
  });

  await harness.controller.reconcileWindow(7);
  const beforeRestore = harness.getRuntime();
  assert.deepEqual(beforeRestore.windows.map(({ id }) => id), ["window-7", "window-saved"]);
  assert.equal(
    beforeRestore.tabs.find(({ id }) => id === "tab-22").workspaceId,
    PERSONAL_ID,
    "the saved window's tabs keep their workspaces while it is not open"
  );

  restoreSavedWindow(harness, 7, 1);
  await harness.controller.reconcileWindow(7);

  assertSavedSessionKept(harness.getRuntime());
  const tabs = harness.getTabs();
  assert.equal(tabs.find(({ id }) => id === 11).hidden, true, "Work stays hidden");
  assert.equal(tabs.find(({ id }) => id === 21).hidden, false);
});

test("a restore that lands while tab identities are read starts the inventory again", async () => {
  let harness = null;
  let restored = false;
  harness = createHarness([tab(1, 7, 0, true)], {
    initialRuntime: savedSessionRuntime(),
    retainClosedWindows: true,
    beforeTabIdentityRead(tabId) {
      if (tabId === 1 && !restored) {
        restored = true;
        restoreSavedWindow(harness, 7, 1);
      }
    }
  });

  await harness.controller.reconcileWindow(7);

  assert.equal(restored, true);
  assertSavedSessionKept(harness.getRuntime());
});

test("closing a window keeps its workspaces for when Firefox reopens it", async () => {
  const harness = createHarness(
    [
      tab(1, 7, 0, true),
      tab(11, 8, 0, false, { hidden: true }),
      tab(21, 8, 1, false),
      tab(22, 8, 2, true)
    ],
    {
      initialRuntime: savedSessionRuntime(),
      retainClosedWindows: true,
      logicalWindowValues: [[8, "window-saved"]],
      logicalTabValues: [[11, "tab-11"], [21, "tab-21"], [22, "tab-22"]]
    }
  );
  await harness.controller.reconcileWindow(7);

  harness.closeTabs([11, 21, 22]);
  await harness.controller.reconcileWindow(7);
  assert.deepEqual(harness.getRuntime().windows.map(({ id }) => id), ["window-7", "window-saved"]);

  // Reopening a closed window gives it new Firefox IDs and its saved values.
  harness.setSavedWindowIdentity(9, "window-saved");
  harness.setSavedTabIdentity(31, "tab-11");
  harness.setSavedTabIdentity(32, "tab-21");
  harness.setSavedTabIdentity(33, "tab-22");
  harness.addTab(tab(31, 9, 0, false, { hidden: true }));
  harness.addTab(tab(32, 9, 1, false));
  harness.addTab(tab(33, 9, 2, true));
  await harness.controller.reconcileWindow(9);

  const runtime = harness.getRuntime();
  assert.deepEqual(runtime.windows.map(({ id }) => id), ["window-7", "window-saved"]);
  const reopened = runtime.windows[1];
  assert.equal(reopened.activeWorkspaceId, PERSONAL_ID);
  assert.equal(
    reopened.workspaceLayouts
      .find(({ workspaceId }) => workspaceId === PERSONAL_ID)
      .tree.find(({ tabId }) => tabId === "tab-22").parentTabId,
    "tab-21"
  );
  assert.equal(runtime.tabs.find(({ id }) => id === "tab-11").workspaceId, WORK_ID);
});

test("a tab reopened from a closed window joins the open window and leaves the closed record", async () => {
  const harness = createHarness(
    [tab(1, 7, 0, true), tab(21, 8, 0, false), tab(22, 8, 1, true)],
    {
      initialRuntime: {
        ...savedSessionRuntime(),
        tabs: [
          { id: "tab-21", workspaceId: PERSONAL_ID },
          { id: "tab-22", workspaceId: PERSONAL_ID }
        ],
        windows: [{
          ...savedSessionRuntime().windows[0],
          selectedTabs: [{ workspaceId: PERSONAL_ID, tabId: "tab-22" }],
          workspaceLayouts: [
            savedLayout(PERSONAL_ID, ["tab-21", "tab-22"], { "tab-22": "tab-21" })
          ]
        }]
      },
      retainClosedWindows: true,
      logicalWindowValues: [[8, "window-saved"]],
      logicalTabValues: [[21, "tab-21"], [22, "tab-22"]]
    }
  );
  await harness.controller.reconcileWindow(7);
  harness.closeTabs([21, 22]);
  await harness.controller.reconcileWindow(7);

  harness.setSavedTabIdentity(40, "tab-22");
  harness.addTab(tab(40, 7, 1, false));
  await harness.controller.reconcileWindow(7);

  let runtime = harness.getRuntime();
  const open = runtime.windows.find(({ id }) => id === "window-7");
  const closed = runtime.windows.find(({ id }) => id === "window-saved");
  assert.ok(
    open.workspaceLayouts.some(({ tabIds }) => tabIds.includes("tab-22")),
    "the reopened tab is placed in the open window"
  );
  assert.deepEqual(closed.workspaceLayouts.flatMap(({ tabIds }) => tabIds), ["tab-21"]);
  assert.deepEqual(closed.selectedTabs, [], "the closed record forgets a tab it no longer holds");

  harness.setSavedTabIdentity(41, "tab-21");
  harness.addTab(tab(41, 7, 2, false));
  await harness.controller.reconcileWindow(7);
  runtime = harness.getRuntime();
  assert.deepEqual(runtime.windows.map(({ id }) => id), ["window-7"], "an emptied closed record is dropped");
});

test("closed windows beyond the retention cap are dropped oldest first with their tabs", async () => {
  const count = MAX_RETAINED_CLOSED_WINDOWS + 1;
  const closedIds = Array.from({ length: count }, (_, index) => `window-closed-${index}`);
  const harness = createHarness([tab(1, 7, 0, true)], {
    initialRuntime: {
      schemaVersion: 5,
      tabs: closedIds.map((_, index) => ({ id: `tab-closed-${index}`, workspaceId: WORK_ID })),
      windows: closedIds.map((id, index) => ({
        id,
        activeWorkspaceId: WORK_ID,
        selectedTabs: [],
        workspaceLayouts: [savedLayout(WORK_ID, [`tab-closed-${index}`])],
        pendingOperation: null
      }))
    },
    retainClosedWindows: true
  });

  await harness.controller.reconcileWindow(7);

  const runtime = harness.getRuntime();
  assert.deepEqual(
    runtime.windows.map(({ id }) => id),
    ["window-7", ...closedIds.slice(0, MAX_RETAINED_CLOSED_WINDOWS)]
  );
  assert.equal(runtime.tabs.some(({ id }) => id === `tab-closed-${count - 1}`), false);
  assert.equal(runtime.tabs.some(({ id }) => id === "tab-closed-0"), true);
});

test("without closed-window retention, as for private windows, a closed window is forgotten", async () => {
  const harness = createHarness(
    [tab(1, 7, 0, true), tab(21, 8, 0, true)],
    { logicalTabValues: [[21, "tab-21"]] }
  );
  await harness.controller.reconcileWindow(7);
  harness.closeTabs([21]);
  await harness.controller.reconcileWindow(7);

  const runtime = harness.getRuntime();
  assert.deepEqual(runtime.windows.map(({ id }) => id), ["window-7"]);
  assert.equal(runtime.tabs.some(({ id }) => id === "tab-21"), false);
});

test("duplicate live tab identities are repaired without duplicate ownership", async () => {
  const initialRuntime = {
    schemaVersion: 3,
    tabs: [{ id: "tab-duplicate", workspaceId: WORK_ID }],
    windows: [
      {
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-duplicate" }],
        workspaceLayouts: [
          { workspaceId: WORK_ID, tabIds: ["tab-duplicate"], pinnedTabIds: [], groups: [] }
        ],
        pendingOperation: null
      }
    ]
  };
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false)],
    {
      initialRuntime,
      logicalTabValues: [[11, "tab-duplicate"], [12, "tab-duplicate"]]
    }
  );

  await harness.controller.getView(7);

  assert.deepEqual(
    harness.getRuntime().tabs.map((entry) => entry.id),
    ["tab-duplicate", "tab-replacement-12"]
  );
});

test("a browser mutation failure retains pending intent and retries to convergence", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
    { initialRuntime, hideFailure: true }
  );

  const partial = await harness.controller.activateWorkspace(7, PERSONAL_ID);
  assert.notEqual(harness.getRuntime().windows[0].pendingOperation, null);
  assert.equal(partial.notice.severity, "error");
  assert.ok(partial.notice.reasons.some((entry) => entry.reason === "browser-failure"));

  harness.setHideFailure(false);
  await harness.controller.getView(7);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).hidden, true);
});

test("a failed pending-state save does not begin browser materialization", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
    { initialRuntime }
  );
  harness.failNextRuntimeSave();

  await assert.rejects(() => harness.controller.activateWorkspace(7, PERSONAL_ID));

  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, WORK_ID);
  assert.equal(harness.getTabs().find((entry) => entry.id === 11).active, true);
  assert.equal(harness.getTabs().find((entry) => entry.id === 12).hidden, true);
  assert.equal(
    harness.calls.some(([kind]) => ["show", "activate", "hide", "pin", "group"].includes(kind)),
    false
  );
});

test("workspace removal preserves live tabs under the next cyclic rail workspace", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ]);
  await harness.controller.getView(7);

  const view = await harness.controller.removeWorkspace(7, WORK_ID);

  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(view.state.workspaces.some(({ id }) => id === WORK_ID), false);
  assert.equal(harness.getState().rail.some(
    ({ kind, workspaceId }) => kind === "workspace" && workspaceId === WORK_ID
  ), false);
  assert.deepEqual(
    harness.getRuntime().tabs.map(({ workspaceId }) => workspaceId),
    [PERSONAL_ID, PERSONAL_ID]
  );
  assert.deepEqual(
    harness.getRuntime().windows[0].workspaceLayouts.map(({ workspaceId }) => workspaceId),
    [PERSONAL_ID]
  );
  assert.equal(harness.getTabs().length, 2);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
});

test("workspace removal stops before mutation when its safety snapshot fails", async () => {
  const safetyCalls = [];
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false)],
    {
      settingsService: {
        async getOrInitialize() { return { marker: "settings" }; }
      },
      snapshotService: {
        async createFromInventory(inventory, settings, options) {
          safetyCalls.push({ inventory, settings, options });
          throw new Error("Synthetic safety snapshot failure");
        }
      }
    }
  );
  await harness.controller.getView(7);

  await assert.rejects(
    () => harness.controller.removeWorkspace(7, WORK_ID),
    /Synthetic safety snapshot failure/
  );
  assert.equal(safetyCalls.length, 1);
  assert.equal(safetyCalls[0].options.kind, "safety");
  assert.equal(safetyCalls[0].options.reason, "workspace-removal");
  assert.equal(harness.getState().workspaces.some(({ id }) => id === WORK_ID), true);
  assert.deepEqual(
    harness.getRuntime().tabs.map(({ workspaceId }) => workspaceId),
    [WORK_ID, WORK_ID]
  );
});

test("restore all defaults snapshots first, restores the exact defaults, and preserves every live tab", async () => {
  const resetEvents = [];
  const safetyCalls = [];
  const settings = createResetSettingsService(resetEvents);
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(12, 7, 1, false, { hidden: true })
    ],
    {
      state: customizedResetState(),
      initialRuntime: customizedResetRuntime(),
      resetEvents,
      settingsService: settings.service,
      snapshotService: {
        async createFromInventory(inventory, currentSettings, options) {
          resetEvents.push("snapshot");
          safetyCalls.push({ inventory, currentSettings, options });
          return { created: true };
        }
      }
    }
  );
  const originalTabIds = harness.getTabs().map(({ id }) => id);

  const result = await harness.controller.resetSettingsWithSafety(7);

  assert.deepEqual(resetEvents.slice(0, 4), [
    "snapshot",
    "runtime-reset",
    "state-reset",
    "settings-reset"
  ]);
  assert.equal(safetyCalls.length, 1);
  assert.equal(safetyCalls[0].options.kind, "safety");
  assert.equal(safetyCalls[0].options.reason, "restore-all-settings");
  assert.equal(safetyCalls[0].inventory.state.workspaces.length, 4);
  assert.equal(
    safetyCalls[0].inventory.runtime.tabs.find(({ id }) => id === "tab-12").workspaceId,
    "ws-custom-project"
  );
  const expectedSettings = createDefaultSettingsState();
  expectedSettings.privacy.keepPrivateTabsBetweenSessions = true;
  expectedSettings.privacy.automaticSnapshotsEnabled = true;
  assert.deepEqual(result, expectedSettings);
  assert.deepEqual(result.privacy, {
    keepPrivateTabsBetweenSessions: true,
    automaticSnapshotsEnabled: true
  });
  assert.deepEqual(settings.getSettings(), expectedSettings);
  assert.deepEqual(harness.getState(), createDefaultWorkspaceState());
  assert.deepEqual(harness.getTabs().map(({ id }) => id), originalTabIds);
  assert.equal(harness.calls.some(([operation]) => operation === "create"), false);
  assert.ok(harness.getTabs().every(({ hidden }) => hidden === false));
  assert.ok(harness.getRuntime().tabs.every(({ workspaceId }) => workspaceId === WORK_ID));
  assert.ok(
    harness.getRuntime().windows.every(({ activeWorkspaceId }) => activeWorkspaceId === WORK_ID)
  );
});

test("restore all defaults preserves and reveals tabs across every normal window", async () => {
  const resetEvents = [];
  const settings = createResetSettingsService(resetEvents);
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(12, 7, 1, false, { hidden: true }),
      tab(21, 8, 0, true),
      tab(22, 8, 1, false, { hidden: true })
    ],
    {
      state: customizedResetState(),
      initialRuntime: {
        schemaVersion: 5,
        tabs: [
          { id: "tab-11", workspaceId: "ws-custom-project" },
          { id: "tab-12", workspaceId: WORK_ID },
          { id: "tab-21", workspaceId: PERSONAL_ID },
          { id: "tab-22", workspaceId: "ws-custom-project" }
        ],
        windows: [
          {
            id: "window-7",
            activeWorkspaceId: "ws-custom-project",
            selectedTabs: [
              { workspaceId: WORK_ID, tabId: "tab-12" },
              { workspaceId: "ws-custom-project", tabId: "tab-11" }
            ],
            workspaceLayouts: [
              {
                workspaceId: WORK_ID,
                tabIds: ["tab-12"],
                pinnedTabIds: [],
                groups: [],
                tree: [{ tabId: "tab-12", parentTabId: null, collapsed: false }],
                splitViews: []
              },
              {
                workspaceId: "ws-custom-project",
                tabIds: ["tab-11"],
                pinnedTabIds: [],
                groups: [],
                tree: [{ tabId: "tab-11", parentTabId: null, collapsed: false }],
                splitViews: []
              }
            ],
            pendingOperation: null
          },
          {
            id: "window-8",
            activeWorkspaceId: PERSONAL_ID,
            selectedTabs: [
              { workspaceId: PERSONAL_ID, tabId: "tab-21" },
              { workspaceId: "ws-custom-project", tabId: "tab-22" }
            ],
            workspaceLayouts: [
              {
                workspaceId: PERSONAL_ID,
                tabIds: ["tab-21"],
                pinnedTabIds: [],
                groups: [],
                tree: [{ tabId: "tab-21", parentTabId: null, collapsed: false }],
                splitViews: []
              },
              {
                workspaceId: "ws-custom-project",
                tabIds: ["tab-22"],
                pinnedTabIds: [],
                groups: [],
                tree: [{ tabId: "tab-22", parentTabId: null, collapsed: false }],
                splitViews: []
              }
            ],
            pendingOperation: null
          }
        ]
      },
      resetEvents,
      settingsService: settings.service,
      snapshotService: {
        async createFromInventory() {
          resetEvents.push("snapshot");
          return { created: true };
        }
      }
    }
  );
  const originalTabs = harness.getTabs().map(({ id, windowId }) => ({ id, windowId }));

  await harness.controller.resetSettingsWithSafety(7);

  assert.deepEqual(
    harness.getTabs().map(({ id, windowId }) => ({ id, windowId })),
    originalTabs
  );
  assert.ok(harness.getTabs().every(({ hidden }) => hidden === false));
  assert.ok(harness.getRuntime().tabs.every(({ workspaceId }) => workspaceId === WORK_ID));
  assert.deepEqual(
    harness.getRuntime().windows.map(({ id, activeWorkspaceId }) => ({ id, activeWorkspaceId })),
    [
      { id: "window-7", activeWorkspaceId: WORK_ID },
      { id: "window-8", activeWorkspaceId: WORK_ID }
    ]
  );
  assert.equal(harness.calls.some(([operation]) => operation === "create"), false);
});

test("restore all defaults stops before mutation when its safety snapshot fails", async () => {
  const resetEvents = [];
  const settings = createResetSettingsService(resetEvents);
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(12, 7, 1, false, { hidden: true })
    ],
    {
      state: customizedResetState(),
      initialRuntime: customizedResetRuntime(),
      resetEvents,
      settingsService: settings.service,
      snapshotService: {
        async createFromInventory() {
          resetEvents.push("snapshot");
          throw new Error("Synthetic reset safety failure");
        }
      }
    }
  );
  const previousState = harness.getState();
  const previousRuntime = harness.getRuntime();
  const previousTabs = harness.getTabs();
  const previousSettings = settings.getSettings();

  await assert.rejects(
    () => harness.controller.resetSettingsWithSafety(7),
    /Synthetic reset safety failure/
  );

  assert.deepEqual(resetEvents, ["snapshot"]);
  assert.deepEqual(harness.getState(), previousState);
  assert.deepEqual(harness.getRuntime(), previousRuntime);
  assert.deepEqual(harness.getTabs(), previousTabs);
  assert.deepEqual(settings.getSettings(), previousSettings);
});

test("restore all defaults rolls definitions, runtime, and settings back after a later failure", async () => {
  const resetEvents = [];
  const settings = createResetSettingsService(resetEvents, { failReset: true });
  const harness = createHarness(
    [
      tab(11, 7, 0, true),
      tab(12, 7, 1, false, { hidden: true })
    ],
    {
      state: customizedResetState(),
      initialRuntime: customizedResetRuntime(),
      resetEvents,
      settingsService: settings.service,
      snapshotService: {
        async createFromInventory() {
          resetEvents.push("snapshot");
          return { created: true };
        }
      }
    }
  );
  const previousState = harness.getState();
  const previousRuntime = harness.getRuntime();
  const previousTabs = harness.getTabs();
  const previousSettings = settings.getSettings();

  await assert.rejects(
    () => harness.controller.resetSettingsWithSafety(7),
    /Synthetic settings reset failure/
  );

  assert.deepEqual(resetEvents, [
    "snapshot",
    "runtime-reset",
    "state-reset",
    "settings-reset",
    "state-restore",
    "settings-restore"
  ]);
  assert.deepEqual(harness.getState(), previousState);
  assert.deepEqual(harness.getRuntime(), previousRuntime);
  assert.deepEqual(
    harness.getTabs().map(({ id, windowId, hidden, pinned, groupId, active }) => ({
      id,
      windowId,
      hidden,
      pinned,
      groupId,
      active
    })),
    previousTabs.map(({ id, windowId, hidden, pinned, groupId, active }) => ({
      id,
      windowId,
      hidden,
      pinned,
      groupId,
      active
    }))
  );
  assert.deepEqual(settings.getSettings(), previousSettings);
});

test("workspace removal refuses the sole remaining workspace", async () => {
  const defaults = createDefaultWorkspaceState();
  const state = parseWorkspaceState({
    ...defaults,
    workspaces: defaults.workspaces.filter(({ id }) => id === WORK_ID),
    rail: defaults.rail.filter(
      ({ kind, workspaceId }) => kind === "workspace" && workspaceId === WORK_ID
    )
  });
  const harness = createHarness([tab(11, 7, 0, true)], { state });

  await assert.rejects(
    () => harness.controller.removeWorkspace(7, WORK_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(harness.getTabs().length, 1);
  assert.equal(harness.getState().workspaces.length, 1);
});

test("a closed requested window becomes a stable invalid request", async () => {
  const harness = createHarness([tab(11, 7, 0, true)]);

  await assert.rejects(
    () => harness.controller.getView(99),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("view loading does not mistake an unrelated identity failure for a closed tab", async () => {
  const harness = createHarness([tab(11, 7, 0, true)], {
    transientIdentityFailures: new Map([[11, 1]])
  });

  await assert.rejects(
    () => harness.controller.getView(7),
    /Synthetic transient tab identity failure/
  );
});

test("a tab closed during identity lookup is removed without a stale row or load failure", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([tab(11, 7, 0, true)], {
    initialRuntime,
    closeDuringIdentityTabIds: new Set([11])
  });

  const view = await harness.controller.getView(7);

  assert.equal(view.activeTabs.length, 1);
  assert.notEqual(view.activeTabs[0].logicalId, "tab-11");
  assert.equal(harness.getRuntime().tabs.some(({ id }) => id === "tab-11"), false);
  assert.equal(harness.getTabs().some(({ id }) => id === 11), false);
});

test("a native split pair is exposed but neither pane can move to another workspace", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 })
  ]);

  const initial = await harness.controller.getView(7);
  assert.deepEqual(initial.activeSplitViews, [
    { id: "split-generated-1", tabIds: ["tab-11", "tab-12"] }
  ]);
  assert.deepEqual(
    initial.activeTabs.map(({ splitViewId, splitPosition }) => ({
      splitViewId,
      splitPosition
    })),
    [
      { splitViewId: "split-generated-1", splitPosition: "start" },
      { splitViewId: "split-generated-1", splitPosition: "end" }
    ]
  );

  await assert.rejects(
    () => harness.controller.moveTabToWorkspace(11, PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  const runtime = harness.getRuntime();
  const source = runtime.windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === WORK_ID
  );
  assert.deepEqual(source.tabIds, ["tab-11", "tab-12"]);
  assert.deepEqual(source.splitViews, [
    { id: "split-generated-1", tabIds: ["tab-11", "tab-12"] }
  ]);
  assert.ok(
    runtime.tabs
      .filter(({ id }) => ["tab-11", "tab-12"].includes(id))
      .every(({ workspaceId }) => workspaceId === WORK_ID)
  );
});

test("sidebar and native highlighted moves reject split panes without changing ownership", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { highlighted: true, splitViewId: 42 })
  ]);
  const view = await harness.controller.getView(7);
  const source = view.activeTabs[0];

  await assert.rejects(
    () => harness.controller.relocateTabs(7, [{
      tabId: source.logicalId,
      workspaceId: source.workspaceId,
      pinned: source.pinned,
      groupId: source.groupId,
      parentTabId: source.parentTabId
    }], {
      workspaceId: PERSONAL_ID,
      zone: "ungrouped",
      relation: "end",
      anchorTabId: null,
      groupId: null,
      parentTabId: null
    }),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  await assert.rejects(
    () => harness.controller.relocateNativeSelection(7, [
      { logicalTabId: "tab-11", firefoxTabId: 11 },
      { logicalTabId: "tab-12", firefoxTabId: 12 }
    ], PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );

  assert.ok(harness.getRuntime().tabs.every(({ workspaceId }) => workspaceId === WORK_ID));
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
});

test("removing a workspace is blocked while it owns a native split", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 })
  ]);
  await harness.controller.getView(7);

  await assert.rejects(
    () => harness.controller.removeWorkspace(7, WORK_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );

  assert.ok(harness.getState().workspaces.some(({ id }) => id === WORK_ID));
  assert.ok(harness.getRuntime().tabs.every(({ workspaceId }) => workspaceId === WORK_ID));
});

test("leaving a native split workspace ends the split before hiding its ordinary tabs", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11", "tab-12"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 }),
    tab(13, 7, 2, false, { hidden: true })
  ], { initialRuntime });

  await harness.controller.getView(7);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);

  assert.ok(harness.getTabs().filter(({ id }) => id === 11 || id === 12).every(
    (tab) => tab.hidden === true && tab.splitViewId === -1
  ));
  assert.ok(harness.calls.some(([name]) => name === "separate-split"));
  assert.deepEqual(
    harness.getRuntime().windows[0].workspaceLayouts
      .find(({ workspaceId }) => workspaceId === WORK_ID).splitViews,
    []
  );

  const restored = await harness.controller.activateWorkspace(7, WORK_ID);
  assert.deepEqual(restored.activeSplitViews, []);
  assert.ok(harness.getTabs().filter(({ id }) => id === 11 || id === 12).every(
    (tab) => tab.hidden === false && tab.splitViewId === -1
  ));

  const moved = await harness.controller.relocateNativeSelection(7, [
    { logicalTabId: "tab-11", firefoxTabId: 11 }
  ], PERSONAL_ID);
  assert.equal(moved.outcome.requestedCount, 1);
  assert.equal(
    harness.getRuntime().tabs.find(({ id }) => id === "tab-11").workspaceId,
    PERSONAL_ID
  );
  assert.equal(
    harness.getRuntime().tabs.find(({ id }) => id === "tab-12").workspaceId,
    WORK_ID
  );
});

test("a failed split separation aborts a workspace switch before any tabs are hidden", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11", "tab-12"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 }),
    tab(13, 7, 2, false, { hidden: true })
  ], { initialRuntime });
  await harness.controller.getView(7);
  harness.calls.length = 0;
  harness.setSeparateSplitFailure(true);

  await assert.rejects(
    () => harness.controller.activateWorkspace(7, PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );

  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, WORK_ID);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
  assert.ok(harness.getTabs().filter(({ id }) => id === 11 || id === 12).every(
    (tab) => tab.hidden === false && tab.splitViewId === 42
  ));
  assert.equal(harness.calls.some(([name]) => name === "hide"), false);
});

test("a failed split switch to an empty workspace keeps its safety tab owned and hidden", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 })
  ]);
  await harness.controller.getView(7);
  harness.setSeparateSplitFailure(true);

  await assert.rejects(
    () => harness.controller.activateWorkspace(7, PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );

  const safetyTab = harness.getTabs().find(({ id }) => id === 13);
  assert.equal(safetyTab.hidden, true);
  assert.equal(
    harness.getRuntime().tabs.find(({ id }) => id === "tab-13").workspaceId,
    PERSONAL_ID
  );
  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, WORK_ID);
  assert.ok(harness.getTabs().filter(({ id }) => id === 11 || id === 12).every(
    (tab) => tab.hidden === false && tab.splitViewId === 42
  ));
});

test("a stranded native split makes its owning workspace active for ghost recovery", async () => {
  const initialRuntime = runtimeForWindow({
    activeWorkspaceId: PERSONAL_ID,
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11", "tab-12"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, false, { hidden: true, splitViewId: 42 }),
    tab(12, 7, 1, false, { hidden: true, splitViewId: 42 }),
    tab(13, 7, 2, true)
  ], { initialRuntime });

  const recovered = await harness.controller.getView(7);

  assert.equal(recovered.activeWorkspaceId, WORK_ID);
  assert.deepEqual(recovered.activeSplitViews, [
    { id: "split-generated-1", tabIds: ["tab-11", "tab-12"] }
  ]);
  assert.ok(harness.getTabs().filter(({ id }) => id === 11 || id === 12).every(
    (tab) => tab.hidden === false && tab.splitViewId === 42
  ));
  assert.equal(harness.getTabs().find(({ id }) => id === 13).hidden, true);
});

test("the transient Firefox Split View chooser is never persisted or materialized across workspaces", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, false, { splitViewId: 42 }),
    tab(12, 7, 1, true, {
      splitViewId: 42,
      splitViewChooser: true,
      title: "about:opentabs"
    }),
    tab(13, 7, 2, false, { hidden: true })
  ], { initialRuntime });

  const view = await harness.controller.getView(7);
  assert.deepEqual(view.activeTabs.map(({ firefoxId }) => firefoxId), [11]);
  assert.deepEqual(harness.getRuntime().tabs, [
    { id: "tab-11", workspaceId: WORK_ID },
    { id: "tab-13", workspaceId: PERSONAL_ID }
  ]);
  assert.equal(
    harness.calls.some(([name]) =>
      ["show", "activate", "pin", "move", "group", "ungroup", "hide", "succession"]
        .includes(name)
    ),
    false
  );

  await assert.rejects(
    () => harness.controller.activateWorkspace(7, PERSONAL_ID),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, WORK_ID);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
});

test("native split panes found in different workspaces are co-located with the active pane", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 })
  ], { initialRuntime });

  const view = await harness.controller.getView(7);
  assert.equal(view.activeWorkspaceId, WORK_ID);
  assert.deepEqual(view.activeSplitViews, [
    { id: "split-generated-1", tabIds: ["tab-11", "tab-12"] }
  ]);
  assert.ok(
    harness.getRuntime().tabs.every(({ workspaceId }) => workspaceId === WORK_ID)
  );
});

test("split panes become ordinary independently unloadable tabs after leaving their workspace", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 })
  ]);
  await harness.controller.getView(7);
  await harness.controller.activateWorkspace(7, PERSONAL_ID);

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.outcome.newlyDiscardedCount, 2);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "discard-batch").slice(-2),
    [["discard-batch", [11]], ["discard-batch", [12]]]
  );
  assert.deepEqual(
    harness.getRuntime().windows[0].workspaceLayouts
      .find(({ workspaceId }) => workspaceId === WORK_ID).splitViews,
    []
  );
});

test("sole-workspace unload protects both panes when one split pane is active", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces = [state.workspaces[0]];
  state.rail = [{ kind: "workspace", workspaceId: WORK_ID }];
  const harness = createHarness([
    tab(11, 7, 0, true, { splitViewId: 42 }),
    tab(12, 7, 1, false, { splitViewId: 42 })
  ], { state });
  await harness.controller.getView(7);

  const result = await harness.controller.unloadWorkspace(7, WORK_ID);
  assert.equal(result.outcome.safetyTabCount, 2);
  assert.equal(result.outcome.newlyDiscardedCount, 0);
  assert.equal(result.outcome.remainingLoadedCount, 2);
  assert.equal(harness.calls.some(([name]) => name === "discard-batch"), false);
});

test("individual close targets only the clicked tab even when Firefox highlights multiple rows", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false, { highlighted: true })
  ]);
  await harness.controller.getView(7);

  const preflight = await harness.controller.prepareCloseTabs(7, tabCloseTarget("tab-12", 12));
  const result = await harness.controller.closeTabs(7, preflight.token);

  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "remove-tabs"),
    [["remove-tabs", [12]]]
  );
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [11]);
  assert.equal(result.outcome.status, "applied");
  assert.equal(result.outcome.closedCount, 1);
  assert.equal(result.outcome.replacementCount, 0);
});

test("branch close derives the root and every transitive descendant from fresh layout", async () => {
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [11, 12, 13, 14].map((id) => ({ id: `tab-${id}`, workspaceId: WORK_ID })),
    windows: [{
      id: "window-7",
      activeWorkspaceId: WORK_ID,
      selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-14" }],
      workspaceLayouts: [{
        workspaceId: WORK_ID,
        tabIds: ["tab-11", "tab-12", "tab-13", "tab-14"],
        pinnedTabIds: [],
        groups: [],
        tree: [
          { tabId: "tab-11", parentTabId: null, collapsed: true },
          { tabId: "tab-12", parentTabId: "tab-11", collapsed: false },
          { tabId: "tab-13", parentTabId: "tab-12", collapsed: false },
          { tabId: "tab-14", parentTabId: null, collapsed: false }
        ],
        splitViews: []
      }],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(11, 7, 0, false),
    tab(12, 7, 1, false, { highlighted: true }),
    tab(13, 7, 2, false),
    tab(14, 7, 3, true)
  ], {
    initialRuntime,
    settingsService: { async getOrInitialize() { return createDefaultSettingsState(); } },
    snapshotService: { async createFromInventory() {} }
  });

  const preflight = await harness.controller.prepareCloseTabs(
    7,
    tabCloseTarget("tab-11", 11, "branch")
  );
  assert.equal(preflight.tabCount, 3);
  const result = await harness.controller.closeTabs(7, preflight.token);

  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "remove-tabs"),
    [["remove-tabs", [11, 12, 13]]]
  );
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [14]);
  assert.equal(result.outcome.closedCount, 3);
});

test("group close targets current members while delete group remains non-closing", async () => {
  const harness = createHarness([
    tab(11, 7, 0, false),
    tab(12, 7, 1, false),
    tab(13, 7, 2, true)
  ], {
    settingsService: { async getOrInitialize() { return createDefaultSettingsState(); } },
    snapshotService: { async createFromInventory() {} }
  });
  let view = await harness.controller.getView(7);
  view = await harness.controller.createTabGroup(7, ["tab-11", "tab-12"]);
  const logicalGroupId = view.activeGroups[0].id;

  const preflight = await harness.controller.prepareCloseTabs(7, {
    kind: "group",
    logicalGroupId
  });
  assert.equal(preflight.tabCount, 2);
  const result = await harness.controller.closeTabs(7, preflight.token);

  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "remove-tabs"),
    [["remove-tabs", [11, 12]]]
  );
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [13]);
  assert.equal(result.outcome.closedCount, 2);
});

test("close-all preflight covers every normal window and keeps each Firefox window alive", async () => {
  const safety = [];
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(21, 8, 0, true)
  ], {
    initialRuntime: {
      schemaVersion: 5,
      tabs: [
        { id: "tab-11", workspaceId: WORK_ID },
        { id: "tab-21", workspaceId: WORK_ID }
      ],
      windows: [
        {
          id: "window-7",
          activeWorkspaceId: WORK_ID,
          selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
          workspaceLayouts: [{
            workspaceId: WORK_ID,
            tabIds: ["tab-11"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-11", parentTabId: null, collapsed: false }],
            splitViews: []
          }],
          pendingOperation: null
        },
        {
          id: "window-8",
          activeWorkspaceId: WORK_ID,
          selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-21" }],
          workspaceLayouts: [{
            workspaceId: WORK_ID,
            tabIds: ["tab-21"],
            pinnedTabIds: [],
            groups: [],
            tree: [{ tabId: "tab-21", parentTabId: null, collapsed: false }],
            splitViews: []
          }],
          pendingOperation: null
        }
      ]
    },
    settingsService: {
      async getOrInitialize() { return createDefaultSettingsState(); }
    },
    snapshotService: {
      async createFromInventory(inventory, settings, options) {
        safety.push({ inventory, settings, options });
      }
    }
  });

  const preflight = await harness.controller.prepareCloseTabs(7, workspaceCloseTarget());
  assert.equal(preflight.scope, "normal");
  assert.equal(preflight.tabCount, 2);
  const result = await harness.controller.closeTabs(7, preflight.token);

  assert.equal(safety.length, 1);
  assert.equal(safety[0].options.kind, "safety");
  assert.equal(safety[0].options.reason, "workspace-tab-close");
  assert.deepEqual(
    [...safety[0].inventory.contexts.values()].flatMap(({ tabs }) => tabs.map(({ id }) => id)),
    [11, 21]
  );
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "remove-tabs"),
    [["remove-tabs", [11, 21]]]
  );
  assert.equal(result.outcome.status, "applied");
  assert.equal(result.outcome.closedCount, 2);
  assert.equal(result.outcome.replacementCount, 2);
  assert.equal(result.preflight, undefined);
  assert.equal(harness.getState().workspaces.some(({ id }) => id === WORK_ID), true);
  assert.equal(harness.getTabs().length, 2);
  assert.deepEqual(new Set(harness.getTabs().map(({ windowId }) => windowId)), new Set([7, 8]));
  assert.ok(harness.getTabs().every(({ active }) => active));
});

test("close-all rejects stale membership with a fresh one-use warning and no close", async () => {
  let safetyCalls = 0;
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ], {
    settingsService: {
      async getOrInitialize() { return createDefaultSettingsState(); }
    },
    snapshotService: {
      async createFromInventory() { safetyCalls += 1; }
    }
  });
  const preflight = await harness.controller.prepareCloseTabs(7, workspaceCloseTarget());
  harness.closeTabs([12]);

  const stale = await harness.controller.closeTabs(7, preflight.token);

  assert.equal(stale.outcome.status, "skipped");
  assert.equal(stale.outcome.reasons[0].reason, "stale-request");
  assert.equal(stale.preflight.tabCount, 1);
  assert.notEqual(stale.preflight.token, preflight.token);
  assert.equal(safetyCalls, 0);
  assert.equal(harness.calls.some(([operation]) => operation === "remove-tabs"), false);
  await assert.rejects(
    () => harness.controller.closeTabs(7, preflight.token),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("close-all stops before Firefox mutation when its safety snapshot fails", async () => {
  const harness = createHarness([tab(11, 7, 0, true), tab(12, 7, 1, false)], {
    settingsService: {
      async getOrInitialize() { return createDefaultSettingsState(); }
    },
    snapshotService: {
      async createFromInventory() {
        throw new Error("Synthetic close safety failure");
      }
    }
  });
  const preflight = await harness.controller.prepareCloseTabs(7, workspaceCloseTarget());

  await assert.rejects(
    () => harness.controller.closeTabs(7, preflight.token),
    /Synthetic close safety failure/
  );
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [11, 12]);
  assert.equal(harness.calls.some(([operation]) => operation === "remove-tabs"), false);
});

test("close-all reports Firefox partial refusal from final inventory", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ], {
    removeTabRefusals: new Set([12]),
    settingsService: {
      async getOrInitialize() { return createDefaultSettingsState(); }
    },
    snapshotService: {
      async createFromInventory() {}
    }
  });
  const preflight = await harness.controller.prepareCloseTabs(7, workspaceCloseTarget());

  const result = await harness.controller.closeTabs(7, preflight.token);

  assert.equal(result.outcome.status, "partial");
  assert.equal(result.outcome.closedCount, 1);
  assert.equal(result.outcome.remainingCount, 1);
  assert.deepEqual(result.outcome.reasons, [
    { reason: "browser-failure", count: 1, retryable: true }
  ]);
  assert.ok(harness.getTabs().some(({ id }) => id === 12));
  assert.ok(harness.getTabs().every(({ windowId }) => windowId === 7));
});

test("private close-all does not create persistence when private recovery is disabled", async () => {
  const settings = createDefaultSettingsState();
  settings.privacy.keepPrivateTabsBetweenSessions = false;
  const harness = createHarness([tab(11, 7, 0, true)], {
    scope: "private",
    settingsService: {
      async getOrInitialize() { return settings; }
    },
    snapshotService: {
      async captureRecoveryFromInventory() {
        assert.fail("Disabled private recovery must not be created by close-all.");
      }
    }
  });

  const preflight = await harness.controller.prepareCloseTabs(7, workspaceCloseTarget());
  const result = await harness.controller.closeTabs(7, preflight.token);

  assert.equal(preflight.scope, "private");
  assert.equal(result.outcome.scope, "private");
  assert.equal(result.outcome.closedCount, 1);
  assert.equal(result.outcome.replacementCount, 1);
});

test("closing an active workspace follows the cyclic successor into a discarded tab", async () => {
  const state = createDefaultWorkspaceState();
  state.rail = [
    { kind: "workspace", workspaceId: WORK_ID },
    { kind: "workspace", workspaceId: "ws-default-research" },
    { kind: "workspace", workspaceId: PERSONAL_ID }
  ];
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11", "tab-12"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false, { hidden: true, discarded: true })
  ], { state, initialRuntime });

  await harness.controller.getView(7);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === "succession").at(-1),
    ["succession", [11, 12], 13]
  );
  assert.equal(harness.closeTabs([11, 12]), false);
  const createCount = harness.calls.filter(([name]) => name === "create").length;

  const view = await harness.controller.getView(7);
  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).discarded, false);
  assert.equal(
    harness.calls.filter(([name]) => name === "create").length,
    createCount
  );
});

test("the current-window search index carries only reduced locations and follows rail then logical layout order", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, PERSONAL_ID], [12, WORK_ID], [13, WORK_ID]],
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-12" }],
    layouts: [
      {
        workspaceId: WORK_ID,
        tabIds: ["tab-12", "tab-13"],
        pinnedTabIds: ["tab-13"],
        groups: [{
          id: "group-search",
          title: "Planning",
          color: "blue",
          collapsed: true,
          tabIds: ["tab-12"]
        }]
      },
      {
        workspaceId: PERSONAL_ID,
        tabIds: ["tab-11"],
        pinnedTabIds: [],
        groups: []
      }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 2, false, {
      hidden: true,
      discarded: true,
      title: "Personal result",
      url: "https://user:pass@secret.example:8443/personal?token=abc#frag"
    }),
    tab(12, 7, 0, true, {
      title: "Project root",
      url: "https://secret.example/root/Caf%C3%A9?session=1",
      groupId: 42
    }),
    tab(13, 7, 1, false, {
      title: "Release result",
      url: "https://secret.example/release",
      pinned: true
    })
  ], {
    initialRuntime,
    initialGroups: [{
      id: 42,
      windowId: 7,
      title: "Planning",
      color: "blue",
      collapsed: true
    }],
    logicalGroupValues: [[12, "group-search"]]
  });

  const index = await harness.controller.getSearchIndex(7);
  assert.deepEqual(index.tabs.map(({ logicalTabId }) => logicalTabId), [
    "tab-13",
    "tab-12",
    "tab-11"
  ]);
  assert.equal(index.tabs.some((entry) => Object.hasOwn(entry, "url")), false);
  assert.deepEqual(index.tabs[1], {
    logicalTabId: "tab-12",
    firefoxTabId: 12,
    workspaceId: WORK_ID,
    title: "Project root",
    discarded: false,
    pinned: false,
    groupTitle: "Planning",
    ancestorTitles: [],
    location: "secret.example/root/Café"
  });
  assert.equal(
    index.tabs.find(({ logicalTabId }) => logicalTabId === "tab-11").location,
    "secret.example/personal"
  );
  assert.doesNotMatch(JSON.stringify(index), /token|session|frag|user:pass|8443/);
});

test("a fresh-default search index survives the background, message, and sidebar parsers", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces[1].color = "#AbCdEf";
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Work notes" }),
    tab(12, 7, 1, false, { hidden: true, title: "Personal notes" })
  ], {
    state,
    initialRuntime: runtimeForWindow({
      assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
      layouts: [
        { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
        { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
      ]
    })
  });

  const view = await harness.controller.getView(7);
  assert.equal(view.state.workspaces[0].color, "#FFFFFF");
  const wire = JSON.parse(JSON.stringify(await harness.controller.getSearchIndex(7)));
  assert.deepEqual(wire.workspaces.slice(0, 2).map(({ color }) => color), ["#ffffff", "#abcdef"]);
  const sidebarIndex = parseWorkspaceSearchIndex(wire, view.state.workspaces);
  assert.deepEqual(sidebarIndex.tabs.map(({ logicalTabId }) => logicalTabId), ["tab-11", "tab-12"]);

  const renamed = structuredClone(view.state.workspaces);
  renamed[0].name = "Renamed";
  assert.throws(() => parseWorkspaceSearchIndex(wire, renamed), /does not match the current workspace/);
});

test("the window search index includes grouped, nested, split, hidden, and discarded tabs in every workspace", async () => {
  const researchId = "ws-default-research";
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [
      [11, WORK_ID],
      [12, WORK_ID],
      [21, PERSONAL_ID],
      [22, PERSONAL_ID],
      [23, PERSONAL_ID],
      [24, PERSONAL_ID],
      [31, researchId]
    ].map(([id, workspaceId]) => ({ id: `tab-${id}`, workspaceId })),
    windows: [{
      id: "window-7",
      activeWorkspaceId: PERSONAL_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-11" },
        { workspaceId: PERSONAL_ID, tabId: "tab-21" },
        { workspaceId: researchId, tabId: "tab-31" }
      ],
      workspaceLayouts: [
        {
          workspaceId: WORK_ID,
          tabIds: ["tab-11", "tab-12"],
          pinnedTabIds: [],
          groups: [{
            id: "group-work-search",
            title: "Work queue",
            color: "blue",
            collapsed: true,
            tabIds: ["tab-11", "tab-12"]
          }],
          tree: [
            { tabId: "tab-11", parentTabId: null, collapsed: true },
            { tabId: "tab-12", parentTabId: "tab-11", collapsed: false }
          ],
          splitViews: []
        },
        {
          workspaceId: PERSONAL_ID,
          tabIds: ["tab-21", "tab-22", "tab-23", "tab-24"],
          pinnedTabIds: [],
          groups: [{
            id: "group-personal-search",
            title: "Personal queue",
            color: "purple",
            collapsed: true,
            tabIds: ["tab-23", "tab-24"]
          }],
          tree: [
            { tabId: "tab-21", parentTabId: null, collapsed: false },
            { tabId: "tab-22", parentTabId: null, collapsed: false },
            { tabId: "tab-23", parentTabId: null, collapsed: true },
            { tabId: "tab-24", parentTabId: "tab-23", collapsed: false }
          ],
          splitViews: [{ id: "split-personal-search", tabIds: ["tab-21", "tab-22"] }]
        }
      ],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(11, 7, 0, false, { hidden: true, title: "Work root", groupId: 42 }),
    tab(12, 7, 1, false, {
      hidden: true,
      discarded: true,
      title: "Hidden work child",
      groupId: 42
    }),
    tab(21, 7, 2, true, { title: "Split start", splitViewId: 77 }),
    tab(22, 7, 3, false, { title: "Split end", splitViewId: 77 }),
    tab(23, 7, 4, false, { title: "Personal root", groupId: 43 }),
    tab(24, 7, 5, false, {
      discarded: true,
      title: "Discarded personal child",
      groupId: 43
    }),
    tab(31, 7, 6, false, {
      hidden: true,
      discarded: true,
      title: "Research fallback"
    })
  ], {
    initialRuntime,
    initialGroups: [
      { id: 42, windowId: 7, title: "Work queue", color: "blue", collapsed: true },
      { id: 43, windowId: 7, title: "Personal queue", color: "purple", collapsed: true }
    ],
    logicalGroupValues: [
      [11, "group-work-search"],
      [12, "group-work-search"],
      [23, "group-personal-search"],
      [24, "group-personal-search"]
    ]
  });

  const index = await harness.controller.getSearchIndex(7);
  assert.deepEqual(index.tabs.map(({ logicalTabId }) => logicalTabId), [
    "tab-11",
    "tab-12",
    "tab-21",
    "tab-22",
    "tab-23",
    "tab-24",
    "tab-31"
  ]);
  assert.deepEqual(
    index.tabs.find(({ logicalTabId }) => logicalTabId === "tab-12"),
    {
      logicalTabId: "tab-12",
      firefoxTabId: 12,
      workspaceId: WORK_ID,
      title: "Hidden work child",
      discarded: true,
      pinned: false,
      groupTitle: "Work queue",
      ancestorTitles: ["Work root"],
      location: null
    }
  );
  assert.deepEqual(
    index.tabs.find(({ logicalTabId }) => logicalTabId === "tab-24"),
    {
      logicalTabId: "tab-24",
      firefoxTabId: 24,
      workspaceId: PERSONAL_ID,
      title: "Discarded personal child",
      discarded: true,
      pinned: false,
      groupTitle: "Personal queue",
      ancestorTitles: ["Personal root"],
      location: null
    }
  );
  assert.equal(index.tabs.some((entry) => Object.hasOwn(entry, "url")), false);
});

test("same-workspace search wakes the exact hidden discarded child without changing group or tree collapse", async () => {
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [11, 12].map((id) => ({ id: `tab-${id}`, workspaceId: WORK_ID })),
    windows: [{
      id: "window-7",
      activeWorkspaceId: WORK_ID,
      selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
      workspaceLayouts: [{
        workspaceId: WORK_ID,
        tabIds: ["tab-11", "tab-12"],
        pinnedTabIds: [],
        groups: [{
          id: "group-search-child",
          title: "Collapsed queue",
          color: "blue",
          collapsed: true,
          tabIds: ["tab-11", "tab-12"]
        }],
        tree: [
          { tabId: "tab-11", parentTabId: null, collapsed: true },
          { tabId: "tab-12", parentTabId: "tab-11", collapsed: false }
        ],
        splitViews: []
      }],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Parent", groupId: 42 }),
    tab(12, 7, 1, false, {
      hidden: true,
      discarded: true,
      title: "Exact hidden child",
      groupId: 42
    })
  ], {
    initialRuntime,
    initialGroups: [{
      id: 42,
      windowId: 7,
      title: "Collapsed queue",
      color: "blue",
      collapsed: true
    }],
    logicalGroupValues: [
      [11, "group-search-child"],
      [12, "group-search-child"]
    ]
  });

  const view = await harness.controller.activateSearchResult(
    7,
    WORK_ID,
    "tab-12",
    12
  );
  const layout = harness.getRuntime().windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === WORK_ID
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, false);
  assert.deepEqual(layout.groups[0], {
    id: "group-search-child",
    title: "Collapsed queue",
    color: "blue",
    collapsed: true,
    tabIds: ["tab-11", "tab-12"]
  });
  assert.deepEqual(layout.tree, [
    { tabId: "tab-11", parentTabId: null, collapsed: true },
    { tabId: "tab-12", parentTabId: "tab-11", collapsed: false }
  ]);
  assert.equal(view.activeGroups[0].collapsed, true);
  assert.equal(
    view.activeTabs.find(({ logicalId }) => logicalId === "tab-12").hiddenByCollapsedAncestor,
    true
  );
});

test("same-workspace search activates the exact second split pane without dissolving the split", async () => {
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [21, 22].map((id) => ({ id: `tab-${id}`, workspaceId: PERSONAL_ID })),
    windows: [{
      id: "window-7",
      activeWorkspaceId: PERSONAL_ID,
      selectedTabs: [{ workspaceId: PERSONAL_ID, tabId: "tab-21" }],
      workspaceLayouts: [{
        workspaceId: PERSONAL_ID,
        tabIds: ["tab-21", "tab-22"],
        pinnedTabIds: [],
        groups: [],
        tree: [
          { tabId: "tab-21", parentTabId: null, collapsed: false },
          { tabId: "tab-22", parentTabId: null, collapsed: false }
        ],
        splitViews: [{ id: "split-search", tabIds: ["tab-21", "tab-22"] }]
      }],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(21, 7, 0, true, { title: "Split start", splitViewId: 77 }),
    tab(22, 7, 1, false, { title: "Exact split end", splitViewId: 77 })
  ], { initialRuntime });

  const view = await harness.controller.activateSearchResult(
    7,
    PERSONAL_ID,
    "tab-22",
    22
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 22).active, true);
  assert.deepEqual(view.activeSplitViews, [
    { id: "split-search", tabIds: ["tab-21", "tab-22"] }
  ]);
});

test("search activation selects the exact unloaded target without waking the remembered tab", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID], [13, PERSONAL_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      {
        workspaceId: PERSONAL_ID,
        tabIds: ["tab-12", "tab-13"],
        pinnedTabIds: [],
        groups: []
      }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Work" }),
    tab(12, 7, 1, false, { hidden: true, discarded: true, title: "Exact result" }),
    tab(13, 7, 2, false, { hidden: true, discarded: true, title: "Remembered" })
  ], { initialRuntime });

  const view = await harness.controller.activateSearchResult(
    7,
    PERSONAL_ID,
    "tab-12",
    12
  );
  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).discarded, true);
  assert.ok(harness.calls.some(([kind, ids]) => kind === "show" && ids.includes(12)));
  assert.ok(harness.calls.some(([kind, tabId]) => kind === "activate" && tabId === 12));
  const intentSaveIndex = harness.events.findIndex(
    ([kind, savedRuntime]) =>
      kind === "runtime-save" &&
      savedRuntime.windows[0].activeWorkspaceId === PERSONAL_ID &&
      savedRuntime.windows[0].pendingOperation !== null &&
      savedRuntime.windows[0].selectedTabs.some(
        ({ workspaceId, tabId }) => workspaceId === PERSONAL_ID && tabId === "tab-12"
      )
  );
  const showIndex = harness.events.findIndex(
    ([kind, tabIds]) => kind === "show" && tabIds.includes(12)
  );
  const activateIndex = harness.events.findIndex(
    ([kind, tabId]) => kind === "activate" && tabId === 12
  );
  assert.ok(showIndex >= 0 && showIndex < activateIndex);
  assert.ok(activateIndex < intentSaveIndex);
});

test("search activation proceeds while Firefox keeps a window from converging", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID], [13, PERSONAL_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11", "tab-12"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-13"], pinnedTabIds: [], groups: [] }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Work" }),
    tab(12, 7, 1, false, { title: "Work sibling" }),
    tab(13, 7, 2, false, { title: "Personal result" })
  ], { initialRuntime, hideFailure: true });

  await harness.controller.getView(7);
  assert.notEqual(harness.getRuntime().windows[0].pendingOperation, null);

  const sameWorkspace = await harness.controller.activateSearchResult(7, WORK_ID, "tab-12", 12);
  assert.equal(sameWorkspace.activeWorkspaceId, WORK_ID);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, true);

  const otherWorkspace = await harness.controller.activateSearchResult(
    7,
    PERSONAL_ID,
    "tab-13",
    13
  );
  assert.equal(otherWorkspace.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).active, true);
});

test("search activation rejects a stale composite identity before activating a tab", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Current" }),
    tab(12, 7, 1, false, { title: "Other" })
  ]);
  await harness.controller.getView(7);
  const activationCount = harness.calls.filter(([kind]) => kind === "activate").length;
  const showCount = harness.calls.filter(([kind]) => kind === "show").length;
  const runtimeBefore = harness.getRuntime();
  await assert.rejects(
    harness.controller.activateSearchResult(7, WORK_ID, "tab-12", 11),
    /request/i
  );
  assert.equal(
    harness.calls.filter(([kind]) => kind === "activate").length,
    activationCount
  );
  assert.equal(harness.calls.filter(([kind]) => kind === "show").length, showCount);
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("same-workspace search revalidates the exact target before showing it", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Current" }),
    tab(12, 7, 1, false, {
      hidden: true,
      discarded: true,
      title: "Stale result"
    })
  ], {
    initialRuntime,
    replaceTabIdentityOnRead: { tabId: 12, readCount: 3 }
  });
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(
    harness.controller.activateSearchResult(7, WORK_ID, "tab-12", 12),
    /request/i
  );

  assert.equal(harness.calls.some(([kind]) => kind === "show"), false);
  assert.equal(harness.calls.some(([kind]) => kind === "activate"), false);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).hidden, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).discarded, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("same-workspace search rolls back when post-activate exact verification turns stale", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Current" }),
    tab(12, 7, 1, false, { hidden: true, title: "Stale after activation" })
  ], {
    initialRuntime,
    replaceTabIdentityOnRead: { tabId: 12, readCount: 4 }
  });
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(
    harness.controller.activateSearchResult(7, WORK_ID, "tab-12", 12),
    /request/i
  );

  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === "activate").map(([, tabId]) => tabId),
    [12, 11]
  );
  assert.equal(
    harness.calls.some(([kind, tabIds]) => kind === "hide" && tabIds.includes(12)),
    true
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).active, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 12).hidden, true);
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("cross-workspace search revalidates before dissolving an outgoing native split", async () => {
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: WORK_ID },
      { id: "tab-13", workspaceId: PERSONAL_ID }
    ],
    windows: [{
      id: "window-7",
      activeWorkspaceId: WORK_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-11" },
        { workspaceId: PERSONAL_ID, tabId: "tab-13" }
      ],
      workspaceLayouts: [
        {
          workspaceId: WORK_ID,
          tabIds: ["tab-11", "tab-12"],
          pinnedTabIds: [],
          groups: [],
          tree: [
            { tabId: "tab-11", parentTabId: null, collapsed: false },
            { tabId: "tab-12", parentTabId: null, collapsed: false }
          ],
          splitViews: [{ id: "split-search-race", tabIds: ["tab-11", "tab-12"] }]
        },
        {
          workspaceId: PERSONAL_ID,
          tabIds: ["tab-13"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-13", parentTabId: null, collapsed: false }],
          splitViews: []
        }
      ],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Split start", splitViewId: 77 }),
    tab(12, 7, 1, false, { title: "Split end", splitViewId: 77 }),
    tab(13, 7, 2, false, {
      hidden: true,
      discarded: true,
      title: "Stale result"
    })
  ], {
    initialRuntime,
    replaceTabIdentityOnRead: { tabId: 13, readCount: 3 }
  });
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(
    harness.controller.activateSearchResult(7, PERSONAL_ID, "tab-13", 13),
    /request/i
  );

  const browserMutations = new Set([
    "separate-split",
    "move",
    "show",
    "activate",
    "hide",
    "pin",
    "group",
    "ungroup",
    "succession"
  ]);
  assert.equal(harness.calls.some(([kind]) => browserMutations.has(kind)), false);
  assert.deepEqual(
    harness.getTabs().filter(({ id }) => id === 11 || id === 12).map(({ splitViewId }) => splitViewId),
    [77, 77]
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 13).hidden, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("cross-workspace search rolls back when post-activate exact verification turns stale", async () => {
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: WORK_ID },
      { id: "tab-13", workspaceId: PERSONAL_ID }
    ],
    windows: [{
      id: "window-7",
      activeWorkspaceId: WORK_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-11" },
        { workspaceId: PERSONAL_ID, tabId: "tab-13" }
      ],
      workspaceLayouts: [
        {
          workspaceId: WORK_ID,
          tabIds: ["tab-11", "tab-12"],
          pinnedTabIds: [],
          groups: [],
          tree: [
            { tabId: "tab-11", parentTabId: null, collapsed: false },
            { tabId: "tab-12", parentTabId: null, collapsed: false }
          ],
          splitViews: [{ id: "split-search-rollback", tabIds: ["tab-11", "tab-12"] }]
        },
        {
          workspaceId: PERSONAL_ID,
          tabIds: ["tab-13"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-13", parentTabId: null, collapsed: false }],
          splitViews: []
        }
      ],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Split start", splitViewId: 77 }),
    tab(12, 7, 1, false, { title: "Split end", splitViewId: 77 }),
    tab(13, 7, 2, false, { hidden: true, title: "Stale after activation" })
  ], {
    initialRuntime,
    replaceTabIdentityOnRead: { tabId: 13, readCount: 4 }
  });
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(
    harness.controller.activateSearchResult(7, PERSONAL_ID, "tab-13", 13),
    /request/i
  );

  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === "activate").map(([, tabId]) => tabId),
    [13, 11]
  );
  assert.equal(harness.calls.some(([kind]) => kind === "separate-split"), false);
  assert.equal(harness.calls.some(([kind]) => kind === "move"), false);
  assert.equal(harness.calls.some(([kind, tabIds]) => kind === "hide" && tabIds.includes(13)), true);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).active, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).hidden, true);
  assert.deepEqual(
    harness.getTabs().filter(({ id }) => id === 11 || id === 12).map(({ splitViewId }) => splitViewId),
    [77, 77]
  );
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
});

test("cross-workspace search commits the exact target before it disappears during split separation", async () => {
  const initialRuntime = {
    schemaVersion: 5,
    tabs: [
      { id: "tab-11", workspaceId: WORK_ID },
      { id: "tab-12", workspaceId: WORK_ID },
      { id: "tab-13", workspaceId: PERSONAL_ID },
      { id: "tab-14", workspaceId: PERSONAL_ID }
    ],
    windows: [{
      id: "window-7",
      activeWorkspaceId: WORK_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-11" },
        { workspaceId: PERSONAL_ID, tabId: "tab-14" }
      ],
      workspaceLayouts: [
        {
          workspaceId: WORK_ID,
          tabIds: ["tab-11", "tab-12"],
          pinnedTabIds: [],
          groups: [],
          tree: [
            { tabId: "tab-11", parentTabId: null, collapsed: false },
            { tabId: "tab-12", parentTabId: null, collapsed: false }
          ],
          splitViews: [{ id: "split-search-commit", tabIds: ["tab-11", "tab-12"] }]
        },
        {
          workspaceId: PERSONAL_ID,
          tabIds: ["tab-13", "tab-14"],
          pinnedTabIds: [],
          groups: [],
          tree: [
            { tabId: "tab-13", parentTabId: null, collapsed: false },
            { tabId: "tab-14", parentTabId: null, collapsed: false }
          ],
          splitViews: []
        }
      ],
      pendingOperation: null
    }]
  };
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Split start", splitViewId: 77 }),
    tab(12, 7, 1, false, { title: "Split end", splitViewId: 77 }),
    tab(13, 7, 2, false, {
      hidden: true,
      discarded: true,
      title: "Exact result"
    }),
    tab(14, 7, 3, false, {
      hidden: true,
      discarded: true,
      title: "Lifecycle fallback"
    })
  ], {
    initialRuntime,
    removeTabDuringSplitSeparation: 13
  });

  const view = await harness.controller.activateSearchResult(
    7,
    PERSONAL_ID,
    "tab-13",
    13
  );

  const showIndex = harness.calls.findIndex(
    ([kind, tabIds]) => kind === "show" && tabIds.includes(13)
  );
  const activateIndex = harness.calls.findIndex(
    ([kind, tabId]) => kind === "activate" && tabId === 13
  );
  const separationIndex = harness.calls.findIndex(([kind]) => kind === "separate-split");
  assert.ok(showIndex >= 0 && showIndex < activateIndex);
  assert.ok(activateIndex < separationIndex);
  assert.equal(harness.getTabs().some(({ id }) => id === 13), false);
  assert.deepEqual(
    harness.getTabs().filter(({ id }) => id === 11 || id === 12).map(({ splitViewId }) => splitViewId),
    [-1, -1]
  );
  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(view.activeTabs.some(({ logicalId, active }) => logicalId === "tab-14" && active), true);
  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
});

test("search activation treats target disappearance after its verified commit as lifecycle recovery", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID], [13, PERSONAL_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-13" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      {
        workspaceId: PERSONAL_ID,
        tabIds: ["tab-12", "tab-13"],
        pinnedTabIds: [],
        groups: []
      }
    ]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Work" }),
    tab(12, 7, 1, false, { hidden: true, discarded: true, title: "Stale result" }),
    tab(13, 7, 2, false, { hidden: true, discarded: true, title: "Remembered" })
  ], {
    initialRuntime,
    removeRequiredTabAfterPending: 12
  });

  const view = await harness.controller.activateSearchResult(
    7,
    PERSONAL_ID,
    "tab-12",
    12
  );

  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === "activate").map(([, tabId]) => tabId),
    [12, 13]
  );
  assert.equal(harness.getTabs().some(({ id }) => id === 12), false);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, false);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).active, true);
  assert.equal(harness.getTabs().find(({ id }) => id === 13).discarded, false);
  assert.equal(view.activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getRuntime().windows[0].activeWorkspaceId, PERSONAL_ID);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
  assert.deepEqual(harness.getRuntime().windows[0].selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-11" },
    { workspaceId: PERSONAL_ID, tabId: "tab-13" }
  ]);
});

test("same-workspace search activation rejects a non-active final result", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Current" }),
    tab(12, 7, 1, false, { title: "Requested" })
  ], {
    initialRuntime,
    activateNoops: new Set([12])
  });

  await assert.rejects(
    harness.controller.activateSearchResult(7, WORK_ID, "tab-12", 12),
    /request/i
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.ok(harness.calls.some(([kind, tabId]) => kind === "activate" && tabId === 12));
});

test("same-workspace search rolls back when the target disappears before commit", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Remembered" }),
    tab(12, 7, 1, false, { title: "Requested" })
  ], {
    initialRuntime,
    removeTabsAfterActivate: new Set([12])
  });

  await assert.rejects(
    harness.controller.activateSearchResult(7, WORK_ID, "tab-12", 12),
    /request/i
  );
  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === "activate").map(([, tabId]) => tabId),
    [12, 11]
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
});

test("same-workspace search treats post-commit disappearance as lifecycle recovery", async () => {
  const initialRuntime = runtimeForWindow({
    assignments: [[11, WORK_ID], [12, WORK_ID]],
    activeWorkspaceId: WORK_ID,
    selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-11" }],
    layouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-11", "tab-12"],
      pinnedTabIds: [],
      groups: []
    }]
  });
  const harness = createHarness([
    tab(11, 7, 0, true, { title: "Remembered fallback" }),
    tab(12, 7, 1, false, {
      hidden: true,
      discarded: true,
      title: "Committed result"
    })
  ], {
    initialRuntime,
    removeTabAfterVerifiedActivation: 12
  });

  const view = await harness.controller.activateSearchResult(
    7,
    WORK_ID,
    "tab-12",
    12
  );

  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === "activate").map(([, tabId]) => tabId),
    [12, 11]
  );
  assert.equal(harness.getTabs().some(({ id }) => id === 12), false);
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(view.activeWorkspaceId, WORK_ID);
  assert.equal(view.activeTabs.some(({ logicalId, active }) => logicalId === "tab-11" && active), true);
  assert.deepEqual(harness.getRuntime().windows[0].selectedTabs, [
    { workspaceId: WORK_ID, tabId: "tab-11" }
  ]);
});

test("settings backup restore reads current settings inside the serialized operation", async () => {
  let current = createDefaultSettingsState();
  let releaseFirst;
  const firstApplied = new Promise((resolve) => { releaseFirst = resolve; });
  const seen = [];
  const harness = createHarness([tab(11, 7, 0, true)], {
    settingsService: { async getOrInitialize() { return structuredClone(current); } },
    snapshotService: { async createFromInventory() {} },
    restoreService: {
      async restoreSettingsBackup({ currentSettings }) {
        seen.push(currentSettings.sidebar.workspaceSize);
        if (seen.length === 1) {
          await firstApplied;
          current = { ...current, sidebar: { ...current.sidebar, workspaceSize: "large" } };
        }
        return { status: "complete" };
      }
    }
  });

  const first = harness.controller.restoreSettingsBackup(7, {}, ["sidebar"]);
  const second = harness.controller.restoreSettingsBackup(7, {}, ["sidebar"]);
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(seen, ["medium", "large"]);
});

function twoWorkspaceSwitchRuntime() {
  return runtimeForWindow({
    assignments: [[11, WORK_ID], [12, PERSONAL_ID]],
    selectedTabs: [
      { workspaceId: WORK_ID, tabId: "tab-11" },
      { workspaceId: PERSONAL_ID, tabId: "tab-12" }
    ],
    layouts: [
      { workspaceId: WORK_ID, tabIds: ["tab-11"], pinnedTabIds: [], groups: [] },
      { workspaceId: PERSONAL_ID, tabIds: ["tab-12"], pinnedTabIds: [], groups: [] }
    ]
  });
}

test("an incomplete switch names its failed check and clears itself once Firefox converges", async () => {
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
    { initialRuntime: twoWorkspaceSwitchRuntime(), successionNoop: true }
  );

  const partial = await harness.controller.activateWorkspace(7, PERSONAL_ID);
  assert.notEqual(harness.getRuntime().windows[0].pendingOperation, null);
  assert.equal(partial.notice.operation, "activate-workspace");
  assert.deepEqual(partial.notice.reasons, [
    { reason: "incomplete-convergence", count: 1, retryable: true }
  ]);
  assert.equal(partial.notice.convergenceCheck, "successor-chain");

  harness.setSuccessionNoop(false);
  const settled = await harness.controller.getView(7);
  assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
  assert.equal(settled.notice, null);
  assert.equal(harness.getNotice(7), undefined);
});

test("convergence keeps notices for other operations and non-retryable reasons", async () => {
  for (const notice of [
    {
      schemaVersion: 2,
      id: "notice-other-operation",
      operation: "move-group",
      severity: "warning",
      retryable: true,
      reasons: [{ reason: "incomplete-convergence", count: 1, retryable: true }],
      convergenceCheck: null
    },
    {
      schemaVersion: 2,
      id: "notice-missing-tab",
      operation: "activate-workspace",
      severity: "warning",
      retryable: false,
      reasons: [{ reason: "missing-tab", count: 1, retryable: false }],
      convergenceCheck: null
    }
  ]) {
    const harness = createHarness(
      [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
      { initialRuntime: twoWorkspaceSwitchRuntime(), successionNoop: true }
    );
    await harness.controller.activateWorkspace(7, PERSONAL_ID);
    await harness.setNotice(7, notice);

    harness.setSuccessionNoop(false);
    await harness.controller.getView(7);
    assert.equal(harness.getRuntime().windows[0].pendingOperation, null);
    assert.equal(harness.getNotice(7).id, notice.id);
  }
});

test("a schema-1 notice already stored in Firefox still reads and clears after convergence", async () => {
  const harness = createHarness(
    [tab(11, 7, 0, true), tab(12, 7, 1, false, { hidden: true })],
    { initialRuntime: twoWorkspaceSwitchRuntime(), successionNoop: true }
  );
  await harness.controller.activateWorkspace(7, PERSONAL_ID);
  await harness.setNotice(7, {
    schemaVersion: 1,
    id: "notice-legacy",
    operation: "activate-workspace",
    severity: "warning",
    retryable: true,
    reasons: [{ reason: "incomplete-convergence", count: 1, retryable: true }]
  });

  harness.setSuccessionNoop(false);
  await harness.controller.getView(7);
  assert.equal(harness.getNotice(7), undefined);
});

const isInvalidRequest = (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST;

// One window whose Work layout holds `ids` in order; `parents` maps a nested
// tab's Firefox ID to its parent's.
function treeHarness(ids, parents = {}, { active = ids.at(-1), collapsed = [], ...options } = {}) {
  return createHarness(ids.map((id, index) => tab(id, 7, index, id === active)), {
    initialRuntime: {
      schemaVersion: 5,
      tabs: ids.map((id) => ({ id: `tab-${id}`, workspaceId: WORK_ID })),
      windows: [{
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [],
        workspaceLayouts: [{
          workspaceId: WORK_ID,
          tabIds: ids.map((id) => `tab-${id}`),
          pinnedTabIds: [],
          groups: [],
          tree: ids.map((id) => ({
            tabId: `tab-${id}`,
            parentTabId: parents[id] ? `tab-${parents[id]}` : null,
            collapsed: collapsed.includes(id)
          })),
          splitViews: []
        }],
        pendingOperation: null
      }]
    },
    ...options
  });
}

function workRows(harness) {
  const layout = harness.getRuntime().windows[0].workspaceLayouts
    .find(({ workspaceId }) => workspaceId === WORK_ID);
  const parentById = new Map(layout.tree.map((node) => [node.tabId, node.parentTabId]));
  const pinned = new Set(layout.pinnedTabIds);
  return layout.tabIds.map((tabId) => {
    const parent = parentById.get(tabId);
    return `${pinned.has(tabId) ? "*" : ""}${tabId.slice(4)}${parent ? `<${parent.slice(4)}` : ""}`;
  });
}

function tabIdentity(id) {
  return { logicalTabId: `tab-${id}`, firefoxTabId: id };
}

async function sidebarTreeMove(harness, selectedIds, clickedId, direction) {
  const view = await harness.controller.getView(7);
  const row = (id) => view.activeTabs.find(({ logicalId }) => logicalId === `tab-${id}`);
  const closure = withTreeDescendants(view.activeTabs, selectedIds.map(row));
  const destination = tabMoveDestination(view, closure, row(clickedId), direction);
  assert.ok(destination, `a ${direction} move is offered`);
  return harness.controller.relocateTabs(7, closure.map(tabSourceDescriptor), destination);
}

test("sidebar tree moves keep reported cases whole through the controller", async () => {
  const ids = [11, 12, 13, 14, 15, 16];
  const parents = { 12: 11, 13: 11, 15: 14 };

  // Move down on an expanded root used to anchor to its own child and fail.
  let harness = treeHarness(ids, parents);
  await sidebarTreeMove(harness, [14], 14, "down");
  assert.deepEqual(workRows(harness), ["11", "12<11", "13<11", "16", "14", "15<14"]);

  // Move up below an expanded tree used to nest the moved root inside it.
  harness = treeHarness(ids, parents);
  await sidebarTreeMove(harness, [14], 14, "up");
  assert.deepEqual(workRows(harness), ["14", "15<14", "11", "12<11", "13<11", "16"]);

  // A collapsed root used to leave its hidden children behind.
  harness = treeHarness(ids, parents, { collapsed: [14] });
  await sidebarTreeMove(harness, [14], 14, "down");
  assert.deepEqual(workRows(harness), ["11", "12<11", "13<11", "16", "14", "15<14"]);

  // Ctrl-selected roots keep their order and their shapes.
  harness = treeHarness(ids, parents, { collapsed: [11] });
  await sidebarTreeMove(harness, [11, 14], 11, "down");
  assert.deepEqual(workRows(harness), ["16", "11", "12<11", "13<11", "14", "15<14"]);
});

test("tree moves reject a stale set missing nested tabs, while pinning may leave them", async () => {
  const harness = treeHarness([11, 12, 13, 14], { 12: 11, 13: 12 });
  const view = await harness.controller.getView(7);
  const root = view.activeTabs.find(({ logicalId }) => logicalId === "tab-11");
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(
    harness.controller.relocateTabs(7, [tabSourceDescriptor(root)], {
      workspaceId: WORK_ID,
      zone: "ungrouped",
      relation: "after",
      anchorTabId: "tab-14",
      groupId: null,
      parentTabId: null
    }),
    isInvalidRequest
  );
  assert.deepEqual(harness.getRuntime(), runtimeBefore);

  await harness.controller.relocateTabs(
    7,
    [tabSourceDescriptor(root)],
    destinationForZone(WORK_ID, "pinned")
  );
  assert.deepEqual(workRows(harness), ["*11", "12", "13<12", "14"]);
});

test("group moves step over whole trees and refuse anchors that would split one", async () => {
  const harness = treeHarness([11, 12, 13, 14, 15], { 12: 11, 13: 11 });
  await harness.controller.getView(7);
  const view = await harness.controller.createTabGroup(7, ["tab-14", "tab-15"]);
  const group = view.activeGroups[0];
  const source = { groupId: group.id, workspaceId: WORK_ID, tabIds: [...group.tabIds] };
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(
    harness.controller.relocateGroup(7, source, {
      workspaceId: WORK_ID,
      relation: "after",
      anchorTabId: "tab-12"
    }),
    isInvalidRequest
  );
  assert.deepEqual(harness.getRuntime(), runtimeBefore);

  await harness.controller.relocateGroup(7, source, groupMoveDestination(view, group, "up"));
  assert.deepEqual(workRows(harness), ["14", "15", "11", "12<11", "13<11"]);
});

test("Create new group requires whole trees and groups them in tree order", async () => {
  const harness = treeHarness([11, 12, 13, 14], { 13: 12, 14: 13 }, { active: 11 });
  await harness.controller.getView(7);
  const runtimeBefore = harness.getRuntime();

  await assert.rejects(harness.controller.createTabGroup(7, ["tab-12"]), isInvalidRequest);
  assert.deepEqual(harness.getRuntime(), runtimeBefore);
  assert.equal(harness.calls.some(([operation]) => operation === "group"), false);

  const view = await harness.controller.createTabGroup(7, ["tab-14", "tab-12", "tab-13"]);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "group"),
    [["group", [12, 13, 14], 100]]
  );
  assert.deepEqual(view.activeGroups[0].tabIds, ["tab-12", "tab-13", "tab-14"]);
  assert.deepEqual(workRows(harness), ["11", "12", "13<12", "14<13"]);
});

test("flattening several selected branches is order-independent and all-or-nothing", async () => {
  const ids = [11, 12, 13, 14, 15, 16];
  const parents = { 12: 11, 13: 12, 15: 14 };
  const childFirst = treeHarness(ids, parents);
  const parentFirst = treeHarness(ids, parents);
  await childFirst.controller.flattenTreeBranch(7, [tabIdentity(12), tabIdentity(11), tabIdentity(14)]);
  await parentFirst.controller.flattenTreeBranch(7, [tabIdentity(11), tabIdentity(12), tabIdentity(14)]);
  assert.deepEqual(workRows(childFirst), ["11", "12", "13", "14", "15", "16"]);
  assert.deepEqual(workRows(parentFirst), workRows(childFirst));

  const harness = treeHarness(ids, parents);
  await harness.controller.getView(7);
  const runtimeBefore = harness.getRuntime();
  for (const targets of [
    [tabIdentity(16)],
    [tabIdentity(16), tabIdentity(13)],
    [tabIdentity(14), { logicalTabId: "tab-11", firefoxTabId: 99 }],
    [tabIdentity(14), tabIdentity(14)],
    []
  ]) {
    await assert.rejects(harness.controller.flattenTreeBranch(7, targets), isInvalidRequest);
    assert.deepEqual(harness.getRuntime(), runtimeBefore);
  }
});

test("selection close unites every selected branch, hidden tabs included, behind one preflight", async () => {
  const safety = [];
  const options = {
    active: 12,
    collapsed: [11],
    settingsService: { async getOrInitialize() { return createDefaultSettingsState(); } },
    snapshotService: {
      async createFromInventory(_inventory, _settings, details) { safety.push(details); }
    }
  };
  const ids = [11, 12, 13, 14, 15, 16];
  const parents = { 12: 11, 13: 12, 15: 14 };
  const target = { kind: "tabs", tabs: [11, 12, 14].map(tabIdentity) };

  let harness = treeHarness(ids, parents, options);
  const preflight = await harness.controller.prepareCloseTabs(7, target);
  assert.equal(preflight.tabCount, 5, "nested selections count once");
  assert.equal(preflight.targetLabel, "Selected tabs");
  const result = await harness.controller.closeTabs(7, preflight.token);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation === "remove-tabs"),
    [["remove-tabs", [11, 12, 13, 14, 15]]]
  );
  assert.deepEqual(harness.getTabs().map(({ id }) => id), [16]);
  assert.equal(harness.getTabs()[0].active, true, "the surviving tab became the successor");
  assert.equal(result.outcome.status, "applied");
  assert.equal(result.outcome.closedCount, 5);
  assert.deepEqual(safety.map(({ reason }) => reason), ["workspace-tab-close"]);

  harness = treeHarness(ids, parents, options);
  const stalePreflight = await harness.controller.prepareCloseTabs(7, target);
  harness.closeTabs([15]);
  const stale = await harness.controller.closeTabs(7, stalePreflight.token);
  assert.equal(stale.outcome.status, "skipped");
  assert.equal(stale.preflight.tabCount, 4);
  assert.equal(harness.calls.some(([operation]) => operation === "remove-tabs"), false);
  assert.equal(harness.getTabs().length, 5);

  await assert.rejects(
    harness.controller.prepareCloseTabs(7, {
      kind: "tabs",
      tabs: [tabIdentity(11), { logicalTabId: "tab-missing", firefoxTabId: 99 }]
    }),
    isInvalidRequest
  );
});

const MOVE_CONTAINERS = Object.freeze({
  "ctr-work": {
    cookieStoreId: "firefox-container-1",
    descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" }
  },
  "ctr-home": {
    cookieStoreId: "firefox-container-2",
    descriptor: { name: "Home", color: "green", icon: "tree", colorCode: "#51cd00" }
  }
});

function containerMoveService() {
  return {
    async refresh() { return {}; },
    async resolve(refId) {
      if (!MOVE_CONTAINERS[refId]) {
        throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
      }
      return MOVE_CONTAINERS[refId].cookieStoreId;
    },
    presentationForCookieStore(cookieStoreId) {
      const entry = Object.entries(MOVE_CONTAINERS)
        .find(([, value]) => value.cookieStoreId === cookieStoreId);
      return entry
        ? { kind: "container", refId: entry[0], descriptor: { ...entry[1].descriptor }, status: "available" }
        : { kind: "none" };
    }
  };
}

function containerMoveRequest(ids, refId) {
  return {
    tabs: ids.map(tabIdentity),
    assignment: refId === null ? { kind: "none" } : { kind: "container", refId }
  };
}

function viewRow(view, logicalId) {
  return view.activeTabs.find((row) => row.logicalId === logicalId);
}

test("Move to container replaces tabs in place and keeps identity, tree, group, pin, and selection", async () => {
  const harness = createHarness([
    tab(11, 7, 0, false, { pinned: true }),
    tab(12, 7, 1, true),
    tab(13, 7, 2, false, { discarded: true }),
    tab(14, 7, 3, false, { groupId: 42 }),
    tab(15, 7, 4, false, { groupId: 42 }),
    tab(16, 7, 5, false, { cookieStoreId: "firefox-container-1" })
  ], {
    initialRuntime: {
      schemaVersion: 5,
      tabs: [11, 12, 13, 14, 15, 16].map((id) => ({ id: `tab-${id}`, workspaceId: WORK_ID })),
      windows: [{
        id: "window-7",
        activeWorkspaceId: WORK_ID,
        selectedTabs: [{ workspaceId: WORK_ID, tabId: "tab-12" }],
        workspaceLayouts: [{
          workspaceId: WORK_ID,
          tabIds: [11, 12, 13, 14, 15, 16].map((id) => `tab-${id}`),
          pinnedTabIds: ["tab-11"],
          groups: [{
            id: "group-move",
            title: "Grouped",
            color: "blue",
            collapsed: false,
            tabIds: ["tab-14", "tab-15"]
          }],
          tree: [11, 12, 13, 14, 15, 16].map((id) => ({
            tabId: `tab-${id}`,
            parentTabId: id === 13 ? "tab-12" : null,
            collapsed: false
          })),
          splitViews: []
        }],
        pendingOperation: null
      }]
    },
    initialGroups: [{ id: 42, windowId: 7, title: "Grouped", color: "blue", collapsed: false }],
    logicalGroupValues: [[14, "group-move"], [15, "group-move"]],
    containerService: containerMoveService()
  });
  await harness.controller.getView(7);
  const runtimeBefore = harness.getRuntime();

  const result = await harness.controller.moveTabsToContainer(
    7,
    containerMoveRequest([11, 12, 13, 14, 16], "ctr-work")
  );

  assert.deepEqual(result.outcome, {
    status: "partial",
    requestedCount: 5,
    movedCount: 4,
    skippedCount: 1,
    failedCount: 0,
    reasons: [{ reason: "already-in-container", count: 1 }]
  });
  assert.deepEqual(
    harness.replacementOptions.map(({ tabId, cookieStoreId }) => [tabId, cookieStoreId]),
    [[11, "firefox-container-1"], [12, "firefox-container-1"], [13, "firefox-container-1"], [14, "firefox-container-1"]]
  );
  const layout = harness.getRuntime().windows[0].workspaceLayouts[0];
  const layoutBefore = runtimeBefore.windows[0].workspaceLayouts[0];
  assert.deepEqual(layout.tabIds, layoutBefore.tabIds);
  assert.deepEqual(layout.pinnedTabIds, ["tab-11"]);
  assert.deepEqual(layout.groups, layoutBefore.groups);
  assert.deepEqual(workRows(harness), ["*11", "12", "13<12", "14", "15", "16"]);
  assert.deepEqual(harness.getRuntime().windows[0].selectedTabs, [{ workspaceId: WORK_ID, tabId: "tab-12" }]);

  const firefoxTabs = new Map(harness.getTabs().map((entry) => [entry.id, entry]));
  for (const originalId of [11, 12, 13, 14]) {
    assert.equal(firefoxTabs.has(originalId), false, `original ${originalId} closed`);
  }
  const replaced = (logicalId) => firefoxTabs.get(viewRow(result.view, logicalId).firefoxId);
  assert.equal(replaced("tab-11").pinned, true);
  assert.equal(replaced("tab-12").active, true);
  assert.equal(replaced("tab-13").discarded, true);
  assert.equal(replaced("tab-14").groupId, replaced("tab-15").groupId);
  assert.notEqual(replaced("tab-14").groupId, -1);
  for (const logicalId of ["tab-11", "tab-12", "tab-13", "tab-14"]) {
    assert.equal(replaced(logicalId).cookieStoreId, "firefox-container-1");
    assert.equal(viewRow(result.view, logicalId).container.refId, "ctr-work");
  }
  assert.equal(replaced("tab-16").id, 16, "a tab already in the container is untouched");
});

test("Move to container skips protected tabs and never leaves a replacement or loses an original", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false),
    tab(13, 7, 2, false),
    tab(14, 7, 3, false, { splitViewId: 5 }),
    tab(15, 7, 4, false, { splitViewId: 5 }),
    tab(16, 7, 5, false)
  ], {
    containerService: containerMoveService(),
    unsupportedReplacementTabIds: new Set([12]),
    removeTabRefusals: new Set([13]),
    replacementFailures: new Set([16])
  });
  await harness.controller.getView(7);
  const runtimeBefore = harness.getRuntime();

  const result = await harness.controller.moveTabsToContainer(
    7,
    containerMoveRequest([12, 13, 14, 16], "ctr-work")
  );

  assert.deepEqual(result.outcome, {
    status: "failed",
    requestedCount: 4,
    movedCount: 0,
    skippedCount: 3,
    failedCount: 1,
    reasons: [
      { reason: "split-locked", count: 1 },
      { reason: "unsupported-url", count: 1 },
      { reason: "close-refused", count: 1 },
      { reason: "browser-failure", count: 1 }
    ]
  });
  const finalTabs = harness.getTabs();
  assert.deepEqual(
    finalTabs.filter(({ id }) => id <= 16).map(({ id }) => id).sort((left, right) => left - right),
    [11, 12, 13, 14, 15, 16],
    "every original tab is still open"
  );
  assert.equal(finalTabs.find(({ id }) => id === 13).cookieStoreId, undefined);
  assert.equal(finalTabs.find(({ active }) => active).id, 11);

  // The page that asked to stay open keeps its own tab, so its copy in the
  // target container is left beside it instead of being closed.
  const copies = finalTabs.filter(({ id }) => id > 16);
  assert.equal(copies.length, 1, "only the refused close leaves a copy");
  assert.equal(copies[0].cookieStoreId, "firefox-container-1");
  assert.equal(copies[0].index, finalTabs.find(({ id }) => id === 13).index + 1);

  const runtime = harness.getRuntime();
  const layout = runtime.windows[0].workspaceLayouts
    .find(({ workspaceId }) => workspaceId === WORK_ID);
  const before = runtimeBefore.windows[0].workspaceLayouts
    .find(({ workspaceId }) => workspaceId === WORK_ID);
  assert.deepEqual(
    layout.tabIds.filter((tabId) => before.tabIds.includes(tabId)),
    before.tabIds,
    "the originals keep their places"
  );
  const loose = layout.tabIds.filter((tabId) => !before.tabIds.includes(tabId));
  assert.equal(loose.length, 1, "the copy joins the workspace as one loose tab");
  assert.equal(
    runtime.tabs.find(({ id }) => id === loose[0]).workspaceId,
    WORK_ID
  );
  assert.deepEqual(
    layout.tree.find(({ tabId }) => tabId === loose[0]),
    { tabId: loose[0], parentTabId: null, collapsed: false }
  );
});

test("Move to container rejects stale, private, or unavailable requests before any Firefox change", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ], { containerService: containerMoveService() });
  await harness.controller.getView(7);
  const noReplacement = () => assert.equal(
    harness.calls.some(([operation]) => operation === "replace-in-container"),
    false
  );

  for (const request of [
    { tabs: [{ logicalTabId: "tab-12", firefoxTabId: 99 }], assignment: { kind: "none" } },
    { tabs: [{ logicalTabId: "tab-missing", firefoxTabId: 12 }], assignment: { kind: "none" } },
    { tabs: [tabIdentity(12)], assignment: { kind: "container" } },
    { tabs: [], assignment: { kind: "none" } }
  ]) {
    await assert.rejects(harness.controller.moveTabsToContainer(7, request), isInvalidRequest);
  }
  await assert.rejects(
    harness.controller.moveTabsToContainer(7, containerMoveRequest([12], "ctr-missing")),
    (error) => error.code === CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE
  );
  noReplacement();

  await harness.controller.relocateTabs(7, [{
    tabId: "tab-12", workspaceId: WORK_ID, pinned: false, groupId: null, parentTabId: null
  }], {
    workspaceId: PERSONAL_ID, zone: "ungrouped", relation: "end", anchorTabId: null, groupId: null, parentTabId: null
  });
  await assert.rejects(
    harness.controller.moveTabsToContainer(7, containerMoveRequest([12], "ctr-work")),
    isInvalidRequest,
    "a tab outside the active workspace is stale"
  );
  noReplacement();

  const privateHarness = createHarness([tab(11, 7, 0, true)], { scope: "private" });
  await privateHarness.controller.getView(7);
  await assert.rejects(
    privateHarness.controller.moveTabsToContainer(7, containerMoveRequest([11], null)),
    (error) => error.code === CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE
  );
});

test("sidebar Undo returns moved tabs to their containers, Redo moves them again, and repeats are stale", async () => {
  const harness = treeHarness([11, 12, 13], { 13: 12 }, {
    active: 11,
    containerService: containerMoveService()
  });
  await harness.controller.getView(7);
  const transaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE,
    "Move to container"
  );
  await harness.controller.moveTabsToContainer(
    7,
    containerMoveRequest([12, 13], "ctr-work"),
    transaction
  );
  const containerOf = async (logicalId) =>
    viewRow(await harness.controller.getView(7), logicalId).container;
  assert.equal((await containerOf("tab-12")).refId, "ctr-work");

  const undoEntry = transaction.entry();
  assert.deepEqual(undoEntry.affectedKeys.filter((key) => key.startsWith("tab:")), ["tab:tab-12", "tab:tab-13"]);
  const undone = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(undone.outcome.status, "applied");
  assert.equal(undone.outcome.restoredCount, 2);
  assert.equal((await containerOf("tab-12")).kind, "none");
  assert.equal((await containerOf("tab-13")).kind, "none");
  assert.deepEqual(workRows(harness), ["11", "12", "13<12"]);

  const repeated = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(repeated.outcome.status, "skipped");
  assert.deepEqual(repeated.outcome.reasons, [{ reason: "stale-state", count: 2 }]);
  assert.deepEqual(repeated.reversals, []);

  const redone = await harness.controller.restoreSidebarUndo(
    7,
    reciprocalEntry(undoEntry, undone, SIDEBAR_UNDO_ACTIONS.REDO)
  );
  assert.equal(redone.outcome.status, "applied");
  assert.equal((await containerOf("tab-12")).refId, "ctr-work");
  assert.equal((await containerOf("tab-13")).refId, "ctr-work");
  assert.deepEqual(workRows(harness), ["11", "12", "13<12"]);
});

test("container-move Undo skips closed tabs and unavailable containers and reverses only the applied subset", async () => {
  const containerService = containerMoveService();
  const harness = treeHarness([11, 12, 13, 14], {}, { active: 11, containerService });
  await harness.controller.getView(7);
  const transaction = captureUndoTransaction(
    SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE,
    "Move to container"
  );
  await harness.controller.moveTabsToContainer(7, containerMoveRequest([12, 13, 14], "ctr-work"), transaction);
  const undoEntry = transaction.entry();
  const closedId = viewRow(await harness.controller.getView(7), "tab-14").firefoxId;
  harness.closeTabs([closedId]);

  const undone = await harness.controller.restoreSidebarUndo(7, undoEntry);
  assert.equal(undone.outcome.status, "partial");
  assert.equal(undone.outcome.restoredCount, 2);
  assert.deepEqual(undone.outcome.reasons, [{ reason: "stale-state", count: 1 }]);
  const redoEntry = reciprocalEntry(undoEntry, undone, SIDEBAR_UNDO_ACTIONS.REDO);
  assert.deepEqual(
    redoEntry.affectedKeys.filter((key) => key.startsWith("tab:")),
    ["tab:tab-12", "tab:tab-13"],
    "the reciprocal covers only the tabs Undo actually moved"
  );

  const resolve = containerService.resolve;
  containerService.resolve = async () => {
    throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
  };
  const callsBefore = harness.calls.length;
  const unavailable = await harness.controller.restoreSidebarUndo(7, redoEntry);
  assert.equal(unavailable.outcome.status, "skipped");
  assert.deepEqual(unavailable.outcome.reasons, [{ reason: "container-unavailable", count: 2 }]);
  assert.equal(
    harness.calls.slice(callsBefore).some(([operation]) => operation === "replace-in-container"),
    false
  );
  containerService.resolve = resolve;
});

test("a container move reacquires the replacement's favicon without borrowing the closed handle", async () => {
  const harness = createHarness([
    tab(11, 7, 0, true),
    tab(12, 7, 1, false)
  ], { containerService: containerMoveService() });
  const favicons = createFaviconRenderHarness();
  try {
    favicons.render(await harness.controller.getView(7));
    await favicons.settle();
    const originalImage = favicons.slot("tab-12", 12)?.children[0];
    assert.ok(originalImage);

    const result = await harness.controller.moveTabsToContainer(
      7,
      containerMoveRequest([12], "ctr-home")
    );
    const replacementId = viewRow(result.view, "tab-12").firefoxId;
    assert.notEqual(replacementId, 12);
    favicons.render(result.view);
    await favicons.settle();
    const replacementImage = favicons.slot("tab-12", replacementId)?.children[0];
    assert.ok(replacementImage);
    assert.notEqual(replacementImage, originalImage);
    assert.ok(favicons.revokedUrls.includes(originalImage.source));
    assert.equal(
      favicons.requests.slice(1).flatMap(({ tabs }) => tabs)
        .some(({ firefoxTabId }) => firefoxTabId === 12),
      false
    );
  } finally {
    favicons.destroy();
  }
});

const BOOKMARK_SOURCE = parseBookmarkSource({
  kind: "file",
  name: "export.html",
  root: {
    type: "folder",
    id: "r",
    title: "Bookmarks",
    role: "root",
    dateAdded: null,
    children: [
      {
        type: "folder",
        id: "docs",
        title: "Docs",
        role: null,
        dateAdded: null,
        children: [
          { type: "bookmark", id: "guide", title: "Guide", url: "https://docs.invalid/guide", dateAdded: null },
          { type: "bookmark", id: "legacy", title: "Legacy", url: "https://docs.invalid/legacy", dateAdded: null }
        ]
      },
      { type: "bookmark", id: "loose", title: "Loose", url: "https://work.invalid/loose", dateAdded: null },
      { type: "bookmark", id: "script", title: "Bookmarklet", url: "javascript:void(0)", dateAdded: null }
    ]
  }
});

function bookmarkMapping(ticked = ["guide", "legacy", "loose", "script"]) {
  return mapBookmarkImport(BOOKMARK_SOURCE, ticked);
}

test("bookmark import fills one inactive workspace with unloaded hidden tabs grouped by folder", async () => {
  const harness = createHarness([tab(11, 7, 0, true), tab(12, 7, 1, false)]);
  await harness.controller.getView(7);
  const progress = [];

  const outcome = await harness.controller.importBookmarkWorkspace(
    7,
    bookmarkMapping(),
    10,
    (update) => progress.push(update)
  );

  const state = harness.getState();
  const imported = state.workspaces.at(-1);
  assert.equal(imported.name, "Imported bookmarks");
  assert.equal(imported.icon, "book-bookmark");
  assert.equal(imported.color, NEW_WORKSPACE_FIELDS.color);
  assert.deepEqual(state.rail.at(-1), { kind: "workspace", workspaceId: imported.id });
  assert.deepEqual(outcome, {
    workspaceId: imported.id,
    workspaceName: "Imported bookmarks",
    requested: 3,
    created: 3,
    unsupported: 1,
    duplicate: 0,
    failed: 0
  });
  assert.deepEqual(progress, [{ created: 3, total: 3 }]);

  assert.deepEqual(harness.createdTabOptions, [
    { url: "https://docs.invalid/guide", active: false, discarded: true, title: "Guide" },
    { url: "https://docs.invalid/legacy", active: false, discarded: true, title: "Legacy" },
    { url: "https://work.invalid/loose", active: false, discarded: true, title: "Loose" }
  ]);

  const runtime = harness.getRuntime();
  const importedTabIds = runtime.tabs
    .filter(({ workspaceId }) => workspaceId === imported.id)
    .map(({ id }) => id);
  assert.deepEqual(importedTabIds, ["tab-13", "tab-14", "tab-15"]);
  const layout = runtime.windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === imported.id
  );
  assert.deepEqual(layout.tabIds, ["tab-13", "tab-14", "tab-15"]);
  assert.deepEqual(layout.pinnedTabIds, []);
  assert.deepEqual(layout.groups, [
    {
      id: "group-generated-1",
      title: "Docs",
      color: "grey",
      collapsed: false,
      tabIds: ["tab-13", "tab-14"]
    }
  ]);
  assert.deepEqual(layout.tree.map(({ parentTabId }) => parentTabId), [null, null, null]);

  const created = harness.getTabs().filter(({ id }) => id >= 13);
  assert.equal(created.length, 3);
  assert.equal(created.every(({ hidden, discarded }) => hidden && discarded), true);
  assert.equal(
    runtime.windows[0].activeWorkspaceId,
    WORK_ID,
    "importing never switches the window to the new workspace"
  );
  assert.equal(harness.getTabs().find(({ id }) => id === 11).active, true);
  assert.equal(
    harness.calls.some(([operation]) => operation === "create-group"),
    false,
    "an inactive workspace keeps its groups logical"
  );
});

test("bookmark import creates tabs in batches, saving, hiding, and reporting each one", async () => {
  const harness = createHarness([tab(11, 7, 0, true)]);
  await harness.controller.getView(7);
  const progress = [];
  const savesBefore = harness.events.filter(([kind]) => kind === "runtime-save").length;

  await harness.controller.importBookmarkWorkspace(7, bookmarkMapping(), 2, (update) => {
    progress.push({ ...update, hides: harness.calls.filter(([kind]) => kind === "hide").length });
  });

  assert.deepEqual(progress, [
    { created: 2, total: 3, hides: 1 },
    { created: 3, total: 3, hides: 2 }
  ]);
  assert.deepEqual(
    harness.calls.filter(([kind, ids]) => kind === "hide" && ids.length > 0).map(([, ids]) => ids),
    [[12, 13], [14]],
    "each batch hides exactly the tabs it created"
  );
  assert.ok(
    harness.events.filter(([kind]) => kind === "runtime-save").length - savesBefore >= 2,
    "each batch persists before the next one starts"
  );
});

test("bookmark import counts a refused tab without losing the tabs Firefox did create", async () => {
  const harness = createHarness([tab(11, 7, 0, true)], {
    createTabFailureUrls: new Set(["https://docs.invalid/legacy"])
  });
  await harness.controller.getView(7);

  const outcome = await harness.controller.importBookmarkWorkspace(7, bookmarkMapping(), 10, null);

  const imported = harness.getState().workspaces.at(-1).id;
  assert.deepEqual(outcome, {
    workspaceId: imported,
    workspaceName: "Imported bookmarks",
    requested: 3,
    created: 2,
    unsupported: 1,
    duplicate: 0,
    failed: 1
  });
  const layout = harness.getRuntime().windows[0].workspaceLayouts.find(
    ({ workspaceId }) => workspaceId === imported
  );
  assert.deepEqual(layout.tabIds, ["tab-12", "tab-13"]);
  assert.deepEqual(layout.groups, [
    {
      id: "group-generated-1",
      title: "Docs",
      color: "grey",
      collapsed: false,
      tabIds: ["tab-12"]
    }
  ]);
});

test("bookmark import refuses a private window, an empty pick, and a full rail before any change", async () => {
  const privateHarness = createHarness([tab(11, 7, 0, true)], { scope: "private" });
  await privateHarness.controller.getView(7);
  await assert.rejects(
    privateHarness.controller.importBookmarkWorkspace(7, bookmarkMapping(), 10, null),
    (error) => error.code === "PRIVATE_WINDOW"
  );
  assert.equal(privateHarness.createdTabOptions.length, 0);

  const harness = createHarness([tab(11, 7, 0, true)]);
  await harness.controller.getView(7);
  await assert.rejects(
    harness.controller.importBookmarkWorkspace(7, bookmarkMapping(["script"]), 10, null),
    (error) => error.code === "NOTHING_TO_IMPORT"
  );
  await assert.rejects(
    harness.controller.importBookmarkWorkspace(7, bookmarkMapping(), 0, null),
    (error) => error.code === "INVALID_REQUEST"
  );
  assert.equal(harness.getState().workspaces.length, 3);
  assert.equal(harness.createdTabOptions.length, 0);

  const fullState = parseWorkspaceState({
    ...createDefaultWorkspaceState(),
    workspaces: Array.from({ length: 100 }, (_, index) => ({
      id: `ws-full-${index}`,
      name: `W${index}`,
      icon: "house",
      color: "#FFFFFF",
      defaultContainerRef: null
    })),
    rail: Array.from({ length: 100 }, (_, index) => ({
      kind: "workspace",
      workspaceId: `ws-full-${index}`
    }))
  });
  const fullHarness = createHarness([tab(11, 7, 0, true)], {
    state: fullState,
    initialRuntime: runtimeForWindow({
      assignments: [[11, "ws-full-0"]],
      layouts: [{ workspaceId: "ws-full-0", tabIds: ["tab-11"], pinnedTabIds: [], groups: [] }],
      activeWorkspaceId: "ws-full-0"
    })
  });
  await fullHarness.controller.getView(7);
  await assert.rejects(
    fullHarness.controller.importBookmarkWorkspace(7, bookmarkMapping(), 10, null),
    (error) => error.code === "WORKSPACE_LIMIT"
  );
  assert.equal(fullHarness.getState().workspaces.length, 100);
  assert.equal(fullHarness.createdTabOptions.length, 0);
});

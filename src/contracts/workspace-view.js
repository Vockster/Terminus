import { parseWorkspaceState } from "./workspace-state.js";
import { parseWorkspaceNotice } from "./workspace-operation.js";
import {
  CONTAINER_STATUSES,
  parseContainerDescriptor,
  parseContainerRefId
} from "./containers.js";

export const WORKSPACE_LOAD_STATES = Object.freeze({
  EMPTY: "empty",
  LOADED: "loaded",
  PARTIAL: "partial",
  UNLOADED: "unloaded"
});

const LOAD_STATE_VALUES = new Set(Object.values(WORKSPACE_LOAD_STATES));
const GROUP_COLOR_VALUES = new Set([
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"
]);
const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;
// Terminus' own pages carry a flag rather than an address, so the sidebar can
// draw the extension's packaged icon without a URL entering a render message.
export const INTERNAL_PAGES = Object.freeze({ SETTINGS: "settings" });
const INTERNAL_PAGE_VALUES = new Set(Object.values(INTERNAL_PAGES));
const LOGICAL_GROUP_ID_PATTERN = /^group-[a-z0-9][a-z0-9-]{0,127}$/;
const LOGICAL_SPLIT_VIEW_ID_PATTERN = /^split-[a-z0-9][a-z0-9-]{0,127}$/;
const SPLIT_POSITIONS = new Set(["start", "end"]);
const MAX_TAB_TITLE_LENGTH = 4096;

function invalidView(reason) {
  return new TypeError(`Invalid workspace view. ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function expectedLoadState(tabCount, discardedTabCount) {
  if (tabCount === 0) {
    return WORKSPACE_LOAD_STATES.EMPTY;
  }
  if (discardedTabCount === 0) {
    return WORKSPACE_LOAD_STATES.LOADED;
  }
  if (discardedTabCount === tabCount) {
    return WORKSPACE_LOAD_STATES.UNLOADED;
  }
  return WORKSPACE_LOAD_STATES.PARTIAL;
}

function parseContainerPresentation(value, label) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw invalidView(`${label} has an invalid container marker.`);
  }
  if (value.kind === "none" && hasExactKeys(value, ["kind"])) {
    return { kind: "none" };
  }
  if (
    value.kind !== "container" ||
    !hasExactKeys(value, ["kind", "refId", "descriptor", "status"]) ||
    !Object.values(CONTAINER_STATUSES).includes(value.status)
  ) {
    throw invalidView(`${label} has an invalid container marker.`);
  }
  const refId = parseContainerRefId(value.refId, invalidView);
  const descriptor = value.descriptor === null
    ? null
    : parseContainerDescriptor(value.descriptor, invalidView);
  if (value.status === CONTAINER_STATUSES.AVAILABLE && descriptor === null) {
    throw invalidView(`${label} has an unavailable container descriptor.`);
  }
  return { kind: "container", refId, descriptor, status: value.status };
}

function parseWorkspaceTabs(value, workspaceIds) {
  if (!Array.isArray(value) || value.length !== workspaceIds.size) {
    throw invalidView("Workspace tab summaries are incomplete.");
  }

  const seenWorkspaceIds = new Set();
  const summaries = value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["workspaceId", "tabCount", "discardedTabCount", "loadState"])
    ) {
      throw invalidView(`Workspace tab summary ${index} has an invalid shape.`);
    }
    if (
      typeof entry.workspaceId !== "string" ||
      !workspaceIds.has(entry.workspaceId) ||
      seenWorkspaceIds.has(entry.workspaceId)
    ) {
      throw invalidView(`Workspace tab summary ${index} has an invalid workspace ID.`);
    }
    if (
      !isCount(entry.tabCount) ||
      !isCount(entry.discardedTabCount) ||
      entry.discardedTabCount > entry.tabCount
    ) {
      throw invalidView(`Workspace tab summary ${index} has invalid counts.`);
    }
    if (
      !LOAD_STATE_VALUES.has(entry.loadState) ||
      entry.loadState !== expectedLoadState(entry.tabCount, entry.discardedTabCount)
    ) {
      throw invalidView(`Workspace tab summary ${index} has an invalid load state.`);
    }
    seenWorkspaceIds.add(entry.workspaceId);
    return { ...entry };
  });

  return summaries;
}

function parseLiveTabIdentities(value) {
  if (!Array.isArray(value)) {
    throw invalidView("The live tab identities must be an array.");
  }
  const logicalIds = new Set();
  const firefoxIds = new Set();
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["logicalTabId", "firefoxTabId"]) ||
      typeof entry.logicalTabId !== "string" ||
      !LOGICAL_TAB_ID_PATTERN.test(entry.logicalTabId) ||
      logicalIds.has(entry.logicalTabId) ||
      !Number.isInteger(entry.firefoxTabId) ||
      entry.firefoxTabId < 0 ||
      firefoxIds.has(entry.firefoxTabId)
    ) {
      throw invalidView(`Live tab identity ${index} is invalid.`);
    }
    logicalIds.add(entry.logicalTabId);
    firefoxIds.add(entry.firefoxTabId);
    return {
      logicalTabId: entry.logicalTabId,
      firefoxTabId: entry.firefoxTabId
    };
  });
}

function parseVisibleExceptions(value, expectedTotal) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["active", "pinned", "sharing", "closing"])
  ) {
    throw invalidView("The protected-tab breakdown has an invalid shape.");
  }
  const parsed = {
    active: value.active,
    pinned: value.pinned,
    sharing: value.sharing,
    closing: value.closing
  };
  if (Object.values(parsed).some((count) => !isCount(count))) {
    throw invalidView("The protected-tab breakdown has invalid counts.");
  }
  if (Object.values(parsed).reduce((sum, count) => sum + count, 0) !== expectedTotal) {
    throw invalidView("The protected-tab breakdown is inconsistent.");
  }
  return parsed;
}

function parseActiveTabRows(value, activeWorkspaceId) {
  if (!Array.isArray(value)) {
    throw invalidView("The active tab rows must be an array.");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const label = `Active tab row ${index}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "logicalId", "firefoxId", "workspaceId", "title", "active",
        "discarded", "audible", "muted", "pinned", "groupId", "parentTabId", "depth",
        "collapsed", "hiddenByCollapsedAncestor", "splitViewId", "splitPosition", "container",
        "internalPage"
      ])
    ) {
      throw invalidView(`${label} has an invalid shape.`);
    }
    if (
      typeof entry.logicalId !== "string" ||
      !LOGICAL_TAB_ID_PATTERN.test(entry.logicalId) ||
      seen.has(entry.logicalId) ||
      !Number.isInteger(entry.firefoxId) ||
      entry.firefoxId < 0 ||
      entry.workspaceId !== activeWorkspaceId ||
      typeof entry.title !== "string" ||
      entry.title.length > MAX_TAB_TITLE_LENGTH
    ) {
      throw invalidView(`${label} has invalid identity or presentation data.`);
    }
    for (const key of [
      "active", "discarded", "audible", "muted", "pinned", "collapsed",
      "hiddenByCollapsedAncestor"
    ]) {
      if (typeof entry[key] !== "boolean") {
        throw invalidView(`${label} has an invalid ${key} state.`);
      }
    }
    if (entry.internalPage !== null && !INTERNAL_PAGE_VALUES.has(entry.internalPage)) {
      throw invalidView(`${label} has an unknown internal page.`);
    }
    if (
      (entry.groupId !== null &&
        (typeof entry.groupId !== "string" || !LOGICAL_GROUP_ID_PATTERN.test(entry.groupId))) ||
      (entry.splitViewId !== null &&
        (typeof entry.splitViewId !== "string" ||
          !LOGICAL_SPLIT_VIEW_ID_PATTERN.test(entry.splitViewId))) ||
      (entry.splitViewId === null) !== (entry.splitPosition === null) ||
      (entry.splitPosition !== null && !SPLIT_POSITIONS.has(entry.splitPosition)) ||
      (entry.parentTabId !== null &&
        (typeof entry.parentTabId !== "string" || !seen.has(entry.parentTabId))) ||
      !Number.isInteger(entry.depth) ||
      entry.depth < 0 ||
      entry.depth > 32 ||
      (entry.parentTabId === null) !== (entry.depth === 0) ||
      (entry.pinned &&
        (entry.parentTabId !== null ||
          entry.collapsed ||
          entry.groupId !== null ||
          entry.splitViewId !== null))
    ) {
      throw invalidView(`${label} has invalid layout data.`);
    }
    seen.add(entry.logicalId);
    return { ...entry, container: parseContainerPresentation(entry.container, label) };
  });
}

function parseActiveSplitViews(value, rows) {
  if (!Array.isArray(value)) {
    throw invalidView("The active split views must be an array.");
  }
  const rowById = new Map(rows.map((row) => [row.logicalId, row]));
  const rowIndexById = new Map(rows.map((row, index) => [row.logicalId, index]));
  const seenSplitViews = new Set();
  const splitTabs = new Set();
  return value.map((entry, index) => {
    const label = `Active split view ${index}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["id", "tabIds"]) ||
      typeof entry.id !== "string" ||
      !LOGICAL_SPLIT_VIEW_ID_PATTERN.test(entry.id) ||
      seenSplitViews.has(entry.id) ||
      !Array.isArray(entry.tabIds) ||
      entry.tabIds.length !== 2
    ) {
      throw invalidView(`${label} has an invalid shape.`);
    }
    const members = entry.tabIds.map((tabId, memberIndex) => {
      const row = rowById.get(tabId);
      if (
        !row ||
        splitTabs.has(tabId) ||
        row.splitViewId !== entry.id ||
        row.splitPosition !== (memberIndex === 0 ? "start" : "end")
      ) {
        throw invalidView(`${label} contains an invalid member.`);
      }
      splitTabs.add(tabId);
      return tabId;
    });
    if (
      rowIndexById.get(members[1]) !== rowIndexById.get(members[0]) + 1 ||
      rowById.get(members[0]).groupId !== rowById.get(members[1]).groupId
    ) {
      throw invalidView(`${label} must retain adjacent panes in one group partition.`);
    }
    seenSplitViews.add(entry.id);
    return { id: entry.id, tabIds: members };
  });
}

function parseActiveGroups(value, rows) {
  if (!Array.isArray(value)) {
    throw invalidView("The active groups must be an array.");
  }
  const rowById = new Map(rows.map((row) => [row.logicalId, row]));
  const seenGroups = new Set();
  const groupedTabs = new Set();
  return value.map((entry, index) => {
    const label = `Active group ${index}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["id", "title", "color", "collapsed", "tabIds"]) ||
      typeof entry.id !== "string" ||
      !LOGICAL_GROUP_ID_PATTERN.test(entry.id) ||
      seenGroups.has(entry.id) ||
      typeof entry.title !== "string" ||
      entry.title.length > 255 ||
      !GROUP_COLOR_VALUES.has(entry.color) ||
      typeof entry.collapsed !== "boolean" ||
      !Array.isArray(entry.tabIds) ||
      entry.tabIds.length === 0
    ) {
      throw invalidView(`${label} has an invalid shape.`);
    }
    const tabIds = entry.tabIds.map((tabId) => {
      if (
        typeof tabId !== "string" ||
        groupedTabs.has(tabId) ||
        rowById.get(tabId)?.groupId !== entry.id
      ) {
        throw invalidView(`${label} contains an invalid member.`);
      }
      groupedTabs.add(tabId);
      return tabId;
    });
    seenGroups.add(entry.id);
    return { id: entry.id, title: entry.title, color: entry.color, collapsed: entry.collapsed, tabIds };
  });
}

export function parseWorkspaceView(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "state",
      "activeWorkspaceId",
      "workspaceTabs",
      "hiddenTabCount",
      "visibleExceptionCount",
      "visibleExceptions",
      "liveTabIdentities",
      "activeTabs",
      "activeGroups",
      "activeSplitViews",
      "notice"
    ])
  ) {
    throw invalidView("The document has an invalid shape.");
  }

  const state = parseWorkspaceState(value.state);
  const workspaceIds = new Set(state.workspaces.map(({ id }) => id));
  if (typeof value.activeWorkspaceId !== "string" || !workspaceIds.has(value.activeWorkspaceId)) {
    throw invalidView("The active workspace is invalid.");
  }
  if (!isCount(value.hiddenTabCount) || !isCount(value.visibleExceptionCount)) {
    throw invalidView("Visibility counts are invalid.");
  }

  const activeTabs = parseActiveTabRows(value.activeTabs, value.activeWorkspaceId);
  const liveTabIdentities = parseLiveTabIdentities(value.liveTabIdentities);
  const liveByLogicalId = new Map(
    liveTabIdentities.map((identity) => [identity.logicalTabId, identity.firefoxTabId])
  );
  if (
    activeTabs.some(
      (row) => liveByLogicalId.get(row.logicalId) !== row.firefoxId
    )
  ) {
    throw invalidView("An active tab is missing from the live tab identities.");
  }
  const activeGroups = parseActiveGroups(value.activeGroups, activeTabs);
  const activeSplitViews = parseActiveSplitViews(value.activeSplitViews, activeTabs);
  if (activeTabs.some((row) => row.groupId !== null && !activeGroups.some((g) => g.id === row.groupId))) {
    throw invalidView("An active tab references an unknown group.");
  }
  if (
    activeTabs.some(
      (row) =>
        row.splitViewId !== null &&
        !activeSplitViews.some((splitView) => splitView.id === row.splitViewId)
    )
  ) {
    throw invalidView("An active tab references an unknown split view.");
  }

  return {
    state,
    activeWorkspaceId: value.activeWorkspaceId,
    workspaceTabs: parseWorkspaceTabs(value.workspaceTabs, workspaceIds),
    hiddenTabCount: value.hiddenTabCount,
    visibleExceptionCount: value.visibleExceptionCount,
    visibleExceptions: parseVisibleExceptions(
      value.visibleExceptions,
      value.visibleExceptionCount
    ),
    liveTabIdentities,
    activeTabs,
    activeGroups,
    activeSplitViews,
    notice: parseWorkspaceNotice(value.notice)
  };
}

export function parseWorkspaceLoadOutcome(value, workspaceIds) {
  const knownWorkspaceIds = new Set(workspaceIds);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["workspaceId", "requestedCount", "startedCount", "failedCount", "view"])
  ) {
    throw invalidView("The workspace load outcome has an invalid shape.");
  }
  if (typeof value.workspaceId !== "string" || !knownWorkspaceIds.has(value.workspaceId)) {
    throw invalidView("The workspace load outcome names an unknown workspace.");
  }
  for (const key of ["requestedCount", "startedCount", "failedCount"]) {
    if (!isCount(value[key])) {
      throw invalidView(`The workspace load outcome has an invalid ${key}.`);
    }
  }
  if (value.startedCount + value.failedCount !== value.requestedCount) {
    throw invalidView("The workspace load outcome counts do not add up.");
  }
  return {
    workspaceId: value.workspaceId,
    requestedCount: value.requestedCount,
    startedCount: value.startedCount,
    failedCount: value.failedCount,
    view: parseWorkspaceView(value.view)
  };
}

export function parseWorkspaceUnloadOutcome(value, workspaceIds) {
  const knownWorkspaceIds = new Set(workspaceIds);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "workspaceId",
      "requestedTabCount",
      "unpinnedCount",
      "remainingPinnedCount",
      "ungroupedCount",
      "remainingGroupedCount",
      "newlyHiddenCount",
      "remainingVisibleCount",
      "alreadyDiscardedCount",
      "newlyDiscardedCount",
      "remainingLoadedCount",
      "failedDiscardCount",
      "switchedWindowCount",
      "pendingWindowCount",
      "safetyTabCount"
    ])
  ) {
    throw new TypeError("Invalid workspace unload outcome.");
  }
  if (typeof value.workspaceId !== "string" || !knownWorkspaceIds.has(value.workspaceId)) {
    throw new TypeError("Invalid workspace unload outcome workspace.");
  }

  const countKeys = [
    "requestedTabCount",
    "unpinnedCount",
    "remainingPinnedCount",
    "ungroupedCount",
    "remainingGroupedCount",
    "newlyHiddenCount",
    "remainingVisibleCount",
    "alreadyDiscardedCount",
    "newlyDiscardedCount",
    "remainingLoadedCount",
    "failedDiscardCount",
    "switchedWindowCount",
    "pendingWindowCount",
    "safetyTabCount"
  ];
  if (countKeys.some((key) => !isCount(value[key]))) {
    throw new TypeError("Invalid workspace unload outcome counts.");
  }
  if (
    value.requestedTabCount !==
      value.alreadyDiscardedCount +
        value.newlyDiscardedCount +
        value.remainingLoadedCount ||
    value.failedDiscardCount > value.requestedTabCount - value.alreadyDiscardedCount
  ) {
    throw new TypeError("Inconsistent workspace unload outcome counts.");
  }
  if (
    value.unpinnedCount + value.remainingPinnedCount > value.requestedTabCount ||
    value.ungroupedCount + value.remainingGroupedCount > value.requestedTabCount ||
    value.newlyHiddenCount + value.remainingVisibleCount > value.requestedTabCount
  ) {
    throw new TypeError("Inconsistent workspace unload materialization counts.");
  }

  return { ...value };
}

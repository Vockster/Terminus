import {
  MAX_RAIL_ENTRIES,
  MAX_WORKSPACES,
  parseWorkspaceState,
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WorkspaceStateError
} from "../contracts/workspace-state.js";
import {
  MAX_GROUP_TITLE_LENGTH,
  WORKSPACE_PENDING_OPERATION_KINDS,
  createEmptyWorkspaceRuntime
} from "../contracts/workspace-runtime.js";
import {
  WORKSPACE_NOTICE_SEVERITIES,
  WORKSPACE_OPERATION_REASONS,
  WORKSPACE_OPERATION_STATUSES,
  parseWorkspaceOperationOutcome
} from "../contracts/workspace-operation.js";
import {
  TAB_CLOSE_TARGET_KINDS,
  parseTabCloseOutcome,
  parseTabClosePreflight,
  parseTabCloseTarget
} from "../contracts/tab-close.js";
import {
  WORKSPACE_LOAD_STATES,
  parseWorkspaceLoadOutcome,
  parseWorkspaceUnloadOutcome,
  parseWorkspaceView
} from "../contracts/workspace-view.js";
import { parseWorkspaceSearchIndex } from "../contracts/workspace-search.js";
import {
  descendantClosure,
  expandLogicalSplitTabIds,
  deleteLogicalGroup,
  ensureWorkspaceLayout,
  findWorkspaceLayoutForTab,
  flattenLogicalTreeBranch,
  isDescendantClosed,
  mergeLogicalWorkspace,
  orderedMaterializedTabIds,
  placeTabInLayout,
  removeTabFromLayouts,
  relocateLogicalGroup,
  relocateLogicalSelection,
  relocateLogicalTabs,
  setLogicalGroupCollapsed,
  setLogicalGroupTitle,
  setLogicalTreeCollapsed
} from "./workspace-layout-policy.js";
import { WorkspaceReconciler } from "./workspace-reconciler.js";
import { validateWorkspaceAssociationMap } from "./workspace-import-policy.js";
import { SNAPSHOT_KINDS } from "../contracts/snapshots.js";
import { NEW_WORKSPACE_FIELDS, createResetWorkspaceState } from "./workspace-defaults.js";
import { createDefaultSettingsState, parseSettingsState } from "../contracts/settings-state.js";
import {
  CONTAINER_ERROR_CODES,
  ContainerError,
  parseContainerAssignment
} from "../contracts/containers.js";
import {
  SIDEBAR_UNDO_ACTIONS,
  SIDEBAR_UNDO_OPERATION_KINDS,
  SIDEBAR_UNDO_OUTCOME_STATUSES,
  SIDEBAR_UNDO_REASON_CODES,
  parseSidebarUndoEntry,
  parseSidebarUndoOutcome,
  parseSidebarUndoSnapshot
} from "../contracts/sidebar-undo.js";
import {
  TAB_CONTAINER_MOVE_REASONS,
  containerMoveStatus,
  isFailedContainerMoveReason,
  parseTabContainerMoveOutcome,
  parseTabContainerMoveRequest
} from "../contracts/tab-container-move.js";
import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_WORKSPACE,
  BookmarkImportError,
  parseBookmarkImportOutcome
} from "../contracts/bookmark-import.js";
import {
  BOOKMARK_IMPORT_ENTRY_KINDS,
  bookmarkImportTabDescriptors
} from "./bookmark-import-mapping.js";
import { fingerprintUndoSnapshot } from "./sidebar-undo-service.js";
import { planRemovalIntoFirstWorkspace } from "../contracts/workspace-rail-batch.js";
import { recoverClosedSidebarTabs } from "./sidebar-tab-recovery.js";
import { replaceTabInContainer, tabUsesCookieStore } from "./tab-container-replacement.js";

const FIREFOX_SPLIT_VIEW_ID_NONE = -1;
const MAX_TAB_BATCH_SIZE = 4_096;

function invalidRequest() {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST,
    WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST]
  );
}

function validWindowId(windowId) {
  return Number.isInteger(windowId) && windowId >= 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireRequestedContext(inventory) {
  if (!inventory.requestedContext) {
    throw invalidRequest();
  }
  return inventory.requestedContext;
}

function requireMutableRequestedContext(inventory) {
  const context = requireRequestedContext(inventory);
  if (context.splitViewChooserTabId !== null) {
    throw invalidRequest();
  }
  return context;
}

function requireNoSplitViewChooser(inventory) {
  if (
    [...inventory.contexts.values()].some(
      (context) => context.splitViewChooserTabId !== null
    )
  ) {
    throw invalidRequest();
  }
}

function compareTabs(left, right) {
  const leftIndex = Number.isInteger(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isInteger(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || left.id - right.id;
}

function selectionsEqual(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (selection, index) =>
        selection.workspaceId === right[index].workspaceId &&
        selection.tabId === right[index].tabId
    )
  );
}

function rememberSelectedTab(runtime, windowRuntime, workspaceId, tabId, workspaceOrder) {
  let changed = false;
  for (const entry of runtime.windows) {
    const nextSelections = entry.selectedTabs.filter(
      (selection) =>
        selection.tabId !== tabId &&
        (entry.id !== windowRuntime.id || selection.workspaceId !== workspaceId)
    );
    if (entry.id === windowRuntime.id) {
      nextSelections.push({ workspaceId, tabId });
      nextSelections.sort(
        (left, right) => workspaceOrder.get(left.workspaceId) - workspaceOrder.get(right.workspaceId)
      );
    }
    if (!selectionsEqual(entry.selectedTabs, nextSelections)) {
      entry.selectedTabs = nextSelections;
      changed = true;
    }
  }
  return changed;
}

function removeSelectionsForTabs(runtime, tabIds) {
  for (const windowRuntime of runtime.windows) {
    windowRuntime.selectedTabs = windowRuntime.selectedTabs.filter(
      (selection) => !tabIds.has(selection.tabId)
    );
  }
}

function tabHasNativeSplit(tab) {
  return (
    Number.isInteger(tab?.splitViewId) &&
    tab.splitViewId !== FIREFOX_SPLIT_VIEW_ID_NONE
  );
}

function layoutContainsSplitTab(layout, tabId) {
  return (layout?.splitViews ?? []).some((splitView) =>
    splitView.tabIds.includes(tabId)
  );
}

function tabIsSplitLocked(context, tabId) {
  const tab = context.tabs.find((entry) => entry.logicalId === tabId);
  return (
    tabHasNativeSplit(tab) ||
    context.windowRuntime.workspaceLayouts.some((layout) =>
      layoutContainsSplitTab(layout, tabId)
    )
  );
}

function destinationWouldSplitLockedPair(context, destination) {
  if (destination.anchorTabId === null && destination.parentTabId === null) {
    return false;
  }
  const layout = context.windowRuntime.workspaceLayouts.find(
    (entry) => entry.workspaceId === destination.workspaceId
  );
  const splitView = (layout?.splitViews ?? []).find((entry) =>
    entry.tabIds.includes(destination.anchorTabId) ||
    entry.tabIds.includes(destination.parentTabId)
  );
  if (!splitView) {
    return false;
  }
  const anchorIndex = splitView.tabIds.indexOf(destination.anchorTabId);
  return (
    destination.parentTabId !== null ||
    destination.relation === "inside" ||
    (anchorIndex === 0 && destination.relation === "after") ||
    (anchorIndex === 1 && destination.relation === "before")
  );
}

function tabsForWorkspace(inventory, workspaceId) {
  return [...inventory.contexts.values()].flatMap((context) =>
    context.tabs
      .filter(({ logicalId }) => context.assignmentByTabId.get(logicalId) === workspaceId)
      .map((tab) => ({ ...tab }))
  );
}

function closeTargetKey(tab) {
  return `${tab.windowId}:${tab.id}:${tab.logicalId}`;
}

function orderedCloseTargets(tabs) {
  return [...tabs].sort(
    (left, right) => left.windowId - right.windowId || compareTabs(left, right)
  );
}

function sameCloseTargets(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((tab, index) => closeTargetKey(tab) === closeTargetKey(right[index]));
}

function closeFingerprint(target, tabs) {
  const semanticValue = JSON.stringify([
    target,
    ...tabs.map((tab) => [tab.windowId, tab.id, tab.logicalId])
  ]);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < semanticValue.length; index += 1) {
    hash ^= BigInt(semanticValue.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `close-set-${hash.toString(16).padStart(16, "0")}`;
}

function boundedCloseLabel(value, fallback) {
  const label = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  return label.slice(0, 256);
}

function deriveCloseTarget(inventory, target, { allowMissing = false, fallbackLabel = null } = {}) {
  const parsedTarget = parseTabCloseTarget(target);
  const context = requireRequestedContext(inventory);
  let targetLabel;
  let targetTabs;

  if (parsedTarget.kind === TAB_CLOSE_TARGET_KINDS.WORKSPACE) {
    const workspace = inventory.state.workspaces.find(({ id }) => id === parsedTarget.workspaceId);
    if (!workspace && !allowMissing) {
      throw invalidRequest();
    }
    targetLabel = boundedCloseLabel(workspace?.name ?? fallbackLabel, "Workspace");
    targetTabs = workspace ? tabsForWorkspace(inventory, parsedTarget.workspaceId) : [];
  } else if (parsedTarget.kind === TAB_CLOSE_TARGET_KINDS.GROUP) {
    const layout = context.windowRuntime.workspaceLayouts.find((entry) =>
      entry.groups.some((group) => group.id === parsedTarget.logicalGroupId)
    );
    const group = layout?.groups.find((entry) => entry.id === parsedTarget.logicalGroupId);
    if (!group && !allowMissing) {
      throw invalidRequest();
    }
    targetLabel = boundedCloseLabel(group?.title ?? fallbackLabel, "Unnamed group");
    const tabByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab]));
    targetTabs = (group?.tabIds ?? []).flatMap((logicalId) => {
      const tab = tabByLogicalId.get(logicalId);
      return tab ? [{ ...tab }] : [];
    });
  } else {
    const identities = parsedTarget.kind === TAB_CLOSE_TARGET_KINDS.TABS
      ? parsedTarget.tabs
      : [parsedTarget];
    const roots = identities.flatMap(({ logicalTabId, firefoxTabId }) => {
      const root = context.tabs.find(
        (tab) => tab.logicalId === logicalTabId && tab.id === firefoxTabId
      );
      if (!root && !allowMissing) {
        throw invalidRequest();
      }
      return root ? [root] : [];
    });
    targetLabel = parsedTarget.kind === TAB_CLOSE_TARGET_KINDS.TABS
      ? "Selected tabs"
      : boundedCloseLabel(roots[0]?.title ?? fallbackLabel, "Tab");
    if (parsedTarget.kind === TAB_CLOSE_TARGET_KINDS.TAB) {
      targetTabs = roots.map((root) => ({ ...root }));
    } else {
      const tabByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab]));
      const branchIds = new Set();
      for (const root of roots) {
        const placement = findWorkspaceLayoutForTab(context.windowRuntime, root.logicalId);
        if (!placement) {
          throw invalidRequest();
        }
        for (const logicalId of descendantClosure(placement.layout, [root.logicalId])) {
          branchIds.add(logicalId);
        }
      }
      targetTabs = [...branchIds].flatMap((logicalId) => {
        const tab = tabByLogicalId.get(logicalId);
        return tab ? [{ ...tab }] : [];
      });
    }
  }

  const orderedTabs = orderedCloseTargets(targetTabs);
  return {
    target: parsedTarget,
    targetLabel,
    targetTabs: orderedTabs,
    fingerprint: closeFingerprint(parsedTarget, orderedTabs)
  };
}

function buildCloseOutcome({
  target,
  targetLabel,
  scope,
  targetTabs,
  finalInventory,
  replacementCount,
  stale = false
}) {
  if (stale) {
    return parseTabCloseOutcome({
      target,
      targetLabel,
      scope,
      status: WORKSPACE_OPERATION_STATUSES.SKIPPED,
      requestedCount: targetTabs.length,
      closedCount: 0,
      remainingCount: targetTabs.length,
      replacementCount: 0,
      reasons: [{
        reason: WORKSPACE_OPERATION_REASONS.STALE_REQUEST,
        count: targetTabs.length,
        retryable: true
      }]
    });
  }
  const finalKeys = new Set(
    [...finalInventory.contexts.values()].flatMap((context) =>
      context.tabs.map(closeTargetKey)
    )
  );
  const remainingCount = targetTabs.filter((tab) => finalKeys.has(closeTargetKey(tab))).length;
  const closedCount = targetTabs.length - remainingCount;
  return parseTabCloseOutcome({
    target,
    targetLabel,
    scope,
    status: remainingCount === 0
      ? WORKSPACE_OPERATION_STATUSES.APPLIED
      : closedCount > 0
        ? WORKSPACE_OPERATION_STATUSES.PARTIAL
        : WORKSPACE_OPERATION_STATUSES.FAILED,
    requestedCount: targetTabs.length,
    closedCount,
    remainingCount,
    replacementCount,
    reasons: remainingCount === 0
      ? []
      : [{
          reason: WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE,
          count: remainingCount,
          retryable: true
        }]
  });
}

function sidebarUndoRequestedCount(entry) {
  const tabCount = entry.affectedKeys.filter((key) => key.startsWith("tab:")).length;
  const workspaceCount = entry.affectedKeys.filter((key) => key.startsWith("workspace:")).length;
  return Math.max(tabCount, workspaceCount, 1);
}

function buildSidebarUndoOutcome({
  requestedCount,
  restoredCount = 0,
  skippedCount = 0,
  failedCount = 0,
  approximatedCount = 0,
  retainedSafetyCount = 0,
  reasons = []
}) {
  let status = SIDEBAR_UNDO_OUTCOME_STATUSES.APPLIED;
  if (restoredCount === 0 && failedCount > 0 && skippedCount === 0) {
    status = SIDEBAR_UNDO_OUTCOME_STATUSES.FAILED;
  } else if (restoredCount === 0 && skippedCount > 0 && failedCount === 0) {
    status = SIDEBAR_UNDO_OUTCOME_STATUSES.SKIPPED;
  } else if (restoredCount < requestedCount) {
    status = SIDEBAR_UNDO_OUTCOME_STATUSES.PARTIAL;
  }
  return parseSidebarUndoOutcome({
    status,
    requestedCount,
    restoredCount,
    skippedCount,
    failedCount,
    approximatedCount,
    retainedSafetyCount,
    reasons
  });
}

function withSidebarUndoReversal(result, entry, before, after) {
  return {
    ...result,
    reversals: [{ scope: entry.scope, before, after }]
  };
}

function remapWindowTabId(windowRuntime, oldId, newId) {
  if (oldId === newId) return;
  for (const selection of windowRuntime.selectedTabs) {
    if (selection.tabId === oldId) selection.tabId = newId;
  }
  for (const layout of windowRuntime.workspaceLayouts) {
    layout.tabIds = layout.tabIds.map((id) => id === oldId ? newId : id);
    layout.pinnedTabIds = layout.pinnedTabIds.map((id) => id === oldId ? newId : id);
    for (const group of layout.groups) {
      group.tabIds = group.tabIds.map((id) => id === oldId ? newId : id);
    }
    for (const node of layout.tree) {
      if (node.tabId === oldId) node.tabId = newId;
      if (node.parentTabId === oldId) node.parentTabId = newId;
    }
    for (const splitView of layout.splitViews ?? []) {
      splitView.tabIds = splitView.tabIds.map((id) => id === oldId ? newId : id);
    }
  }
}

function selectSettingsTab(tabs, sourceWindowId) {
  return [...tabs]
    .filter(
      (tab) =>
        Number.isInteger(tab?.id) &&
        tab.id >= 0 &&
        validWindowId(tab.windowId)
    )
    .sort((left, right) =>
      Number(right.windowId === sourceWindowId) - Number(left.windowId === sourceWindowId) ||
      Number(right.active === true) - Number(left.active === true) ||
      (Number(right.lastAccessed) || 0) - (Number(left.lastAccessed) || 0) ||
      left.id - right.id
    )[0] ?? null;
}

function buildUnloadOutcome({
  workspaceId,
  workspaceIds,
  targetTabs,
  finalInventory,
  attemptedTabs,
  discardResults,
  switchedWindowCount,
  pendingWindowCount,
  safetyTabCount
}) {
  const finalTabs = [...finalInventory.contexts.values()].flatMap((context) => context.tabs);
  const finalTabById = new Map(finalTabs.map((tab) => [tab.id, tab]));
  const unpinnedCount = targetTabs.filter(
    (tab) => tab.pinned === true && finalTabById.get(tab.id)?.pinned !== true
  ).length;
  const remainingPinnedCount = targetTabs.filter(
    (tab) => finalTabById.get(tab.id)?.pinned === true
  ).length;
  const ungroupedCount = targetTabs.filter(
    (tab) =>
      Number.isInteger(tab.groupId) &&
      tab.groupId !== -1 &&
      finalTabById.get(tab.id)?.groupId === -1
  ).length;
  const remainingGroupedCount = targetTabs.filter(
    (tab) =>
      Number.isInteger(finalTabById.get(tab.id)?.groupId) &&
      finalTabById.get(tab.id).groupId !== -1
  ).length;
  const newlyHiddenCount = targetTabs.filter(
    (tab) => tab.hidden !== true && finalTabById.get(tab.id)?.hidden === true
  ).length;
  const remainingVisibleCount = targetTabs.filter(
    (tab) => finalTabById.get(tab.id)?.hidden !== true
  ).length;
  const alreadyDiscardedCount = targetTabs.filter(
    (tab) => tab.discarded === true && finalTabById.get(tab.id)?.discarded === true
  ).length;
  const newlyDiscardedCount = attemptedTabs.filter(
    (tab) => finalTabById.get(tab.id)?.discarded === true
  ).length;
  const remainingLoadedCount =
    targetTabs.length - alreadyDiscardedCount - newlyDiscardedCount;
  const failedDiscardCount = discardResults
    .filter(({ status }) => status === "rejected")
    .reduce((count, result) => count + (result.attemptedCount ?? 1), 0);
  return parseWorkspaceUnloadOutcome(
    {
      workspaceId,
      requestedTabCount: targetTabs.length,
      unpinnedCount,
      remainingPinnedCount,
      ungroupedCount,
      remainingGroupedCount,
      newlyHiddenCount,
      remainingVisibleCount,
      alreadyDiscardedCount,
      newlyDiscardedCount,
      remainingLoadedCount,
      failedDiscardCount,
      switchedWindowCount,
      pendingWindowCount,
      safetyTabCount
    },
    workspaceIds
  );
}

function buildWorkspaceView(context, containerService = null) {
  const workspaceByFirefoxTabId = new Map(
    context.tabs.map((tab) => [tab.id, context.assignmentByTabId.get(tab.logicalId)])
  );
  const workspaceTabs = context.state.workspaces.map(({ id: workspaceId }) => {
    const tabs = context.tabs.filter(
      (tab) => workspaceByFirefoxTabId.get(tab.id) === workspaceId
    );
    const discardedTabCount = tabs.filter((tab) => tab.discarded === true).length;
    let loadState = WORKSPACE_LOAD_STATES.LOADED;
    if (tabs.length === 0) {
      loadState = WORKSPACE_LOAD_STATES.EMPTY;
    } else if (discardedTabCount === tabs.length) {
      loadState = WORKSPACE_LOAD_STATES.UNLOADED;
    } else if (discardedTabCount > 0) {
      loadState = WORKSPACE_LOAD_STATES.PARTIAL;
    }
    return {
      workspaceId,
      tabCount: tabs.length,
      discardedTabCount,
      loadState
    };
  });
  const outgoingTabs = context.tabs.filter(
    (tab) => workspaceByFirefoxTabId.get(tab.id) !== context.windowRuntime.activeWorkspaceId
  );
  const visibleExceptions = { active: 0, pinned: 0, sharing: 0, closing: 0 };
  for (const tab of outgoingTabs.filter((entry) => entry.hidden !== true)) {
    if (tab.active === true) {
      visibleExceptions.active += 1;
    } else if (tab.pinned === true) {
      visibleExceptions.pinned += 1;
    } else if (
      tab.sharingState &&
      (tab.sharingState.camera || tab.sharingState.microphone || tab.sharingState.screen)
    ) {
      visibleExceptions.sharing += 1;
    } else {
      visibleExceptions.closing += 1;
    }
  }

  const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
  const activeLayout = context.windowRuntime.workspaceLayouts.find(
    (layout) => layout.workspaceId === activeWorkspaceId
  ) ?? { tabIds: [], pinnedTabIds: [], groups: [], tree: [], splitViews: [] };
  const tabByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab]));
  const pinSet = new Set(activeLayout.pinnedTabIds);
  const groupByTabId = new Map();
  for (const group of activeLayout.groups) {
    for (const tabId of group.tabIds) {
      groupByTabId.set(tabId, group.id);
    }
  }
  const nodeByTabId = new Map((activeLayout.tree ?? []).map((node) => [node.tabId, node]));
  const splitByTabId = new Map();
  for (const splitView of activeLayout.splitViews ?? []) {
    splitView.tabIds.forEach((tabId, index) => {
      splitByTabId.set(tabId, {
        id: splitView.id,
        position: index === 0 ? "start" : "end"
      });
    });
  }
  const depthByTabId = new Map();
  const activeTabs = activeLayout.tabIds.flatMap((logicalId) => {
    const tab = tabByLogicalId.get(logicalId);
    if (!tab || context.assignmentByTabId.get(logicalId) !== activeWorkspaceId) {
      return [];
    }
    const node = nodeByTabId.get(logicalId) ?? {
      tabId: logicalId,
      parentTabId: null,
      collapsed: false
    };
    const parentDepth = node.parentTabId === null ? -1 : depthByTabId.get(node.parentTabId) ?? -1;
    const depth = parentDepth + 1;
    depthByTabId.set(logicalId, depth);
    let ancestorId = node.parentTabId;
    let hiddenByCollapsedAncestor = false;
    while (ancestorId !== null) {
      const ancestor = nodeByTabId.get(ancestorId);
      if (!ancestor) {
        break;
      }
      if (ancestor.collapsed) {
        hiddenByCollapsedAncestor = true;
        break;
      }
      ancestorId = ancestor.parentTabId;
    }
    return [{
      logicalId,
      firefoxId: tab.id,
      workspaceId: activeWorkspaceId,
      title: typeof tab.title === "string" ? tab.title : "Untitled tab",
      active: tab.active === true,
      discarded: tab.discarded === true,
      audible: tab.audible === true,
      muted: tab.mutedInfo?.muted === true,
      pinned: pinSet.has(logicalId),
      groupId: groupByTabId.get(logicalId) ?? null,
      splitViewId: splitByTabId.get(logicalId)?.id ?? null,
      splitPosition: splitByTabId.get(logicalId)?.position ?? null,
      parentTabId: node.parentTabId,
      depth,
      collapsed: node.collapsed,
      hiddenByCollapsedAncestor,
      internalPage: tab.internalPage ?? null,
      container:
        containerService?.presentationForCookieStore(tab.cookieStoreId) ?? { kind: "none" }
    }];
  });

  return parseWorkspaceView({
    state: context.state,
    activeWorkspaceId: context.windowRuntime.activeWorkspaceId,
    workspaceTabs,
    hiddenTabCount: outgoingTabs.filter((tab) => tab.hidden === true).length,
    visibleExceptionCount: outgoingTabs.filter((tab) => tab.hidden !== true).length,
    visibleExceptions,
    liveTabIdentities: [...context.tabs]
      .sort(compareTabs)
      .map((tab) => ({
        logicalTabId: tab.logicalId,
        firefoxTabId: tab.id
      })),
    activeTabs,
    activeGroups: activeLayout.groups.map((group) => ({
      id: group.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      tabIds: [...group.tabIds]
    })),
    activeSplitViews: (activeLayout.splitViews ?? []).map((splitView) => ({
      id: splitView.id,
      tabIds: [...splitView.tabIds]
    })),
    notice: context.notice ?? null
  });
}

function buildWorkspaceSearchIndex(context, containerService = null, tabLocations = []) {
  const tabByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab]));
  const locationByFirefoxId = new Map(
    tabLocations.map(({ id, location }) => [id, location])
  );
  const emitted = new Set();
  const rows = [];
  const railWorkspaceIds = context.state.rail
    .filter((entry) => entry.kind === "workspace")
    .map((entry) => entry.workspaceId);
  const railWorkspaceIdSet = new Set(railWorkspaceIds);
  const workspaceIds = [
    ...railWorkspaceIds,
    ...context.state.workspaces
      .map(({ id }) => id)
      .filter((id) => !railWorkspaceIdSet.has(id))
  ];

  for (const workspaceId of workspaceIds) {
    const layout = context.windowRuntime.workspaceLayouts.find(
      (entry) => entry.workspaceId === workspaceId
    );
    const liveWorkspaceTabs = context.tabs
      .filter((tab) => context.assignmentByTabId.get(tab.logicalId) === workspaceId)
      .sort(compareTabs);
    const candidateIds = [
      ...(layout ? orderedMaterializedTabIds(layout) : []),
      ...liveWorkspaceTabs.map((tab) => tab.logicalId)
    ];
    const groupByTabId = new Map();
    for (const group of layout?.groups ?? []) {
      for (const logicalTabId of group.tabIds) {
        groupByTabId.set(logicalTabId, group);
      }
    }
    const nodeByTabId = new Map(
      (layout?.tree ?? []).map((node) => [node.tabId, node])
    );
    const pinned = new Set(layout?.pinnedTabIds ?? []);

    for (const logicalTabId of candidateIds) {
      const tab = tabByLogicalId.get(logicalTabId);
      if (
        !tab ||
        emitted.has(logicalTabId) ||
        context.assignmentByTabId.get(logicalTabId) !== workspaceId
      ) {
        continue;
      }
      const ancestorTitles = [];
      const visited = new Set([logicalTabId]);
      let ancestorId = nodeByTabId.get(logicalTabId)?.parentTabId ?? null;
      while (ancestorId !== null && ancestorTitles.length < 32 && !visited.has(ancestorId)) {
        visited.add(ancestorId);
        const ancestor = tabByLogicalId.get(ancestorId);
        if (
          !ancestor ||
          context.assignmentByTabId.get(ancestorId) !== workspaceId
        ) break;
        ancestorTitles.unshift(
          typeof ancestor.title === "string" ? ancestor.title : "Untitled tab"
        );
        ancestorId = nodeByTabId.get(ancestorId)?.parentTabId ?? null;
      }
      const group = groupByTabId.get(logicalTabId);
      rows.push({
        logicalTabId,
        firefoxTabId: tab.id,
        workspaceId,
        title: typeof tab.title === "string" ? tab.title : "Untitled tab",
        discarded: tab.discarded === true,
        pinned: pinned.has(logicalTabId) || (layout === undefined && tab.pinned === true),
        groupTitle: group ? group.title : null,
        ancestorTitles,
        location: locationByFirefoxId.get(tab.id) ?? null
      });
      emitted.add(logicalTabId);
    }
  }

  const workspaces = context.state.workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    icon: workspace.icon,
    color: workspace.color,
    container: containerService
      ? containerService.presentationForRef(workspace.defaultContainerRef)
      : workspace.defaultContainerRef === null
        ? { kind: "none" }
        : {
          kind: "container",
          refId: workspace.defaultContainerRef,
          descriptor: null,
          status: "unavailable"
        }
  }));
  return parseWorkspaceSearchIndex(
    { workspaces, tabs: rows },
    context.state.workspaces
  );
}

function buildMoveOutcome(kind, requestedCount, finalContext) {
  const appliedCount = requestedCount;
  const pending = finalContext.windowRuntime.pendingOperation !== null;
  const tabs = finalContext.tabs;
  return parseWorkspaceOperationOutcome({
    operation: kind,
    status: pending
      ? WORKSPACE_OPERATION_STATUSES.PARTIAL
      : WORKSPACE_OPERATION_STATUSES.APPLIED,
    requestedCount,
    appliedCount,
    skipped: [],
    failedCount: 0,
    observed: {
      tabCount: tabs.length,
      hiddenCount: tabs.filter((tab) => tab.hidden === true).length,
      visibleCount: tabs.filter((tab) => tab.hidden !== true).length,
      pinnedCount: tabs.filter((tab) => tab.pinned === true).length,
      groupedTabCount: tabs.filter(
        (tab) => Number.isInteger(tab.groupId) && tab.groupId !== -1
      ).length
    }
  });
}

export class WorkspaceController {
  #browser;
  #runtimeService;
  #stateService;
  #settingsService;
  #snapshotService;
  #restoreService;
  #settingsTransferService;
  #containerService;
  #reconciler;
  #operationExecutor;
  #createUuid;
  #closePreflights = new Map();
  #operationTail = Promise.resolve();

  constructor({
    browserAdapter,
    runtimeService,
    stateService,
    settingsService = null,
    snapshotService = null,
    restoreService = null,
    settingsTransferService = null,
    containerService = null,
    operationExecutor = null,
    createUuid,
    retainClosedWindows = false
  }) {
    this.#browser = browserAdapter;
    this.#runtimeService = runtimeService;
    this.#stateService = stateService;
    this.#settingsService = settingsService;
    this.#snapshotService = snapshotService;
    this.#restoreService = restoreService;
    this.#settingsTransferService = settingsTransferService;
    this.#containerService = containerService;
    this.#operationExecutor = operationExecutor;
    this.#createUuid = createUuid ?? (() => globalThis.crypto.randomUUID());
    this.#reconciler = new WorkspaceReconciler({
      browserAdapter,
      runtimeService,
      stateService,
      settingsService,
      createTabForWorkspace: (windowId, state, workspaceId) =>
        this.#createBrowserTabForWorkspace(windowId, state, workspaceId),
      createUuid,
      retainClosedWindows
    });
  }

  getView(windowId) {
    return this.#enqueue(() => this.#getView(windowId));
  }

  getSearchIndex(windowId) {
    return this.#enqueue(() => this.#getSearchIndex(windowId));
  }

  activateWorkspace(windowId, workspaceId) {
    return this.#enqueue(() => this.#activateWorkspace(windowId, workspaceId));
  }

  activateTab(windowId, logicalTabId, firefoxTabId) {
    return this.#enqueue(() => this.#activateTab(windowId, logicalTabId, firefoxTabId));
  }

  activateSearchResult(windowId, workspaceId, logicalTabId, firefoxTabId) {
    return this.#enqueue(() => this.#activateSearchResult(
      windowId,
      workspaceId,
      logicalTabId,
      firefoxTabId
    ));
  }

  createWorkspaceTab(windowId, workspaceId, assignment = null) {
    return this.#enqueue(() => this.#createWorkspaceTab(windowId, workspaceId, assignment));
  }

  copyTabToContainer(windowId, tabId, assignment) {
    return this.#enqueue(() => this.#copyTabToContainer(windowId, tabId, assignment));
  }

  moveTabsToContainer(windowId, request, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#moveTabsToContainer(windowId, request)
    ));
  }

  relocateTabs(windowId, sources, destination, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#relocateTabs(windowId, sources, destination)
    ));
  }

  createTabGroup(windowId, logicalTabIds, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#createTabGroup(windowId, logicalTabIds)
    ));
  }

  unloadTabs(windowId, logicalTabIds, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#unloadTabs(windowId, logicalTabIds)
    ));
  }

  prepareCloseTabs(windowId, target) {
    return this.#enqueue(() => this.#prepareCloseTabs(windowId, target));
  }

  closeTabs(windowId, token, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#closeTabs(windowId, token),
      // Undo reopens closed tabs, so this prepared target set is the only
      // place a tab's page address is read and journaled.
      {
        pageTabIds: () =>
          (this.#closePreflights.get(token)?.targetTabs ?? []).map(({ id }) => id)
      }
    ));
  }

  setSnapshotService(snapshotService) {
    this.#snapshotService = snapshotService;
  }

  relocateNativeSelection(windowId, tabs, destinationWorkspaceId, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#relocateNativeSelection(windowId, tabs, destinationWorkspaceId)
    ));
  }

  relocateGroup(windowId, source, destination, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#relocateGroup(windowId, source, destination)
    ));
  }

  renameGroup(windowId, logicalGroupId, title, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#renameGroup(windowId, logicalGroupId, title)
    ));
  }

  deleteGroup(windowId, logicalGroupId, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#deleteGroup(windowId, logicalGroupId)
    ));
  }

  setTreeCollapsed(windowId, logicalTabId, collapsed) {
    return this.#enqueue(() => this.#setTreeCollapsed(windowId, logicalTabId, collapsed));
  }

  flattenTreeBranch(windowId, tabs, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#flattenTreeBranch(windowId, tabs)
    ));
  }

  setGroupCollapsed(windowId, logicalGroupId, collapsed) {
    return this.#enqueue(() => this.#setGroupCollapsed(windowId, logicalGroupId, collapsed));
  }

  unloadWorkspace(windowId, workspaceId, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#unloadWorkspace(windowId, workspaceId)
    ));
  }

  // Waking a workspace's unloaded tabs in one window. Firefox decides when each
  // tab finishes loading, so this reports what it was asked to start.
  loadWorkspaceTabs(windowId, workspaceId) {
    return this.#enqueue(() => this.#loadWorkspaceTabs(windowId, workspaceId));
  }

  removeWorkspace(windowId, workspaceId, undoTransaction = null) {
    if (!this.#snapshotService || !this.#settingsService) {
      return this.#enqueue(() => this.#withSidebarUndo(
        windowId,
        undoTransaction,
        () => this.#removeWorkspace(windowId, workspaceId, null)
      ));
    }
    return this.#settingsService
      .getOrInitialize()
      .then((settings) => this.#enqueue(() => this.#withSidebarUndo(
        windowId,
        undoTransaction,
        () => this.#removeWorkspace(windowId, workspaceId, settings)
      )));
  }

  createWorkspace(windowId, workspace, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#stateService.createWorkspace(workspace)
    ));
  }

  // Bookmark import is a Settings action: it holds the serialized queue like a
  // snapshot restore, but creates no sidebar Undo entry.
  importBookmarkWorkspace(windowId, mapping, batchSize, onProgress = null) {
    return this.#enqueue(() =>
      this.#importBookmarkWorkspace(windowId, mapping, batchSize, onProgress)
    );
  }

  updateWorkspace(windowId, workspaceId, changes, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#stateService.updateWorkspace(workspaceId, changes)
    ));
  }

  placeRailEntry(windowId, entry, target, position, undoTransaction = null) {
    return this.#enqueue(() => this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#stateService.placeRailEntry(entry, target, position)
    ));
  }

  prepareWorkspaceRemoval(workspaceId, executorLease = null) {
    return this.#runWithLease(executorLease, async () => {
      if (typeof workspaceId !== "string") {
        throw invalidRequest();
      }
      const state = await this.#stateService.getOrInitialize();
      const workspaceIds = state.workspaces.map(({ id }) => id);
      if (workspaceIds.length < 2 || !workspaceIds.includes(workspaceId)) {
        throw invalidRequest();
      }
      const railWorkspaceIds = state.rail
        .filter(({ kind }) => kind === "workspace")
        .map(({ workspaceId: id }) => id);
      const sourceIndex = railWorkspaceIds.indexOf(workspaceId);
      if (sourceIndex < 0) {
        throw invalidRequest();
      }
      const destinationWorkspaceId =
        railWorkspaceIds[(sourceIndex + 1) % railWorkspaceIds.length];
      const windowIds = await this.#browser.listNormalWindowIds();
      let runtime;
      if (windowIds.length > 0) {
        const inventory = await this.#reconciler.reconcile(windowIds[0], { converge: false });
        requireNoSplitViewChooser(inventory);
        if (
          [...inventory.contexts.values()].some((context) =>
            context.tabs.some(
              (tab) =>
                context.assignmentByTabId.get(tab.logicalId) === workspaceId &&
                tabHasNativeSplit(tab)
            )
          )
        ) {
          throw invalidRequest();
        }
        runtime = inventory.runtime;
      } else {
        runtime = await this.#runtimeService.getOrInitialize(workspaceIds);
      }
      const previousRuntime = structuredClone(runtime);
      const affectedWindows = runtime.windows.filter(
        (entry) =>
          entry.activeWorkspaceId === workspaceId ||
          entry.workspaceLayouts.some(({ workspaceId: id }) => id === workspaceId) ||
          entry.selectedTabs.some(({ workspaceId: id }) => id === workspaceId)
      );
      if (!mergeLogicalWorkspace(runtime, workspaceId, destinationWorkspaceId)) {
        throw invalidRequest();
      }
      for (const windowRuntime of affectedWindows) {
        this.#reconciler.markPending(
          windowRuntime,
          WORKSPACE_PENDING_OPERATION_KINDS.REMOVE_WORKSPACE
        );
      }
      await this.#runtimeService.save(runtime, workspaceIds);
      return { runtime: previousRuntime, workspaceIds };
    });
  }

  prepareWorkspaceStateReplacement(rawNextState, options = undefined, executorLease = null) {
    return this.#runWithLease(executorLease, async () => {
      const nextState = parseWorkspaceState(rawNextState);
      const currentState = await this.#stateService.getOrInitialize();
      const currentWorkspaceIds = currentState.workspaces.map(({ id }) => id);
      const targetWorkspaceIds = nextState.workspaces.map(({ id }) => id);
      const targetSet = new Set(targetWorkspaceIds);
      const destinationWorkspaceId = nextState.rail.find(
        ({ kind }) => kind === "workspace"
      )?.workspaceId;
      if (!destinationWorkspaceId) {
        throw invalidRequest();
      }
      const removedWorkspaceIds = currentWorkspaceIds.filter((id) => !targetSet.has(id));
      const explicitWorkspaceIdMap = options?.workspaceIdMap ?? null;
      if (
        options !== undefined &&
        (
          options === null ||
          typeof options !== "object" ||
          Array.isArray(options) ||
          Object.keys(options).length !== 1 ||
          !(explicitWorkspaceIdMap instanceof Map)
        )
      ) {
        throw invalidRequest();
      }
      const associationMap = explicitWorkspaceIdMap === null
        ? new Map(removedWorkspaceIds.map((id) => [id, destinationWorkspaceId]))
        : validateWorkspaceAssociationMap({
          sourceWorkspaceIds: removedWorkspaceIds,
          targetWorkspaceIds,
          workspaceIdMap: explicitWorkspaceIdMap
        });
      const windowIds = await this.#browser.listNormalWindowIds();
      let runtime;
      let contexts = [];
      if (windowIds.length > 0) {
        const inventory = await this.#reconciler.reconcile(windowIds[0], { converge: false });
        requireNoSplitViewChooser(inventory);
        runtime = inventory.runtime;
        contexts = [...inventory.contexts.values()];
      } else {
        runtime = await this.#runtimeService.getOrInitialize(currentWorkspaceIds);
      }
      if (
        contexts.some((context) => context.tabs.some(
          (tab) =>
            removedWorkspaceIds.includes(context.assignmentByTabId.get(tab.logicalId)) &&
            tabHasNativeSplit(tab)
        ))
      ) {
        throw invalidRequest();
      }
      const previousRuntime = structuredClone(runtime);
      for (const windowRuntime of runtime.windows) {
        for (const workspaceId of targetWorkspaceIds) {
          ensureWorkspaceLayout(windowRuntime, workspaceId);
        }
      }
      for (const sourceWorkspaceId of removedWorkspaceIds) {
        if (!mergeLogicalWorkspace(
          runtime,
          sourceWorkspaceId,
          associationMap.get(sourceWorkspaceId)
        )) {
          throw invalidRequest();
        }
      }
      for (const windowRuntime of runtime.windows) {
        if (removedWorkspaceIds.length > 0) {
          this.#reconciler.markPending(
            windowRuntime,
            WORKSPACE_PENDING_OPERATION_KINDS.REMOVE_WORKSPACE
          );
        }
      }
      await this.#runtimeService.save(runtime, targetWorkspaceIds);
      return { runtime: previousRuntime, workspaceIds: currentWorkspaceIds };
    });
  }

  restorePreparedWorkspaceState(token, executorLease = null) {
    return this.#runWithLease(executorLease, async () => {
      if (!token || !Array.isArray(token.workspaceIds) || !token.runtime) {
        throw invalidRequest();
      }
      await this.#runtimeService.save(token.runtime, token.workspaceIds);
      return true;
    });
  }

  createSnapshot(options = {}, settingsOverride = null, executorLease = null) {
    const settingsPromise = settingsOverride
      ? Promise.resolve(settingsOverride)
      : this.#settingsService?.getOrInitialize();
    if (!this.#snapshotService || !settingsPromise) {
      return Promise.reject(invalidRequest());
    }
    return settingsPromise.then((settings) =>
      this.#runWithLease(executorLease, async () => {
        const inventory = await this.#snapshotInventory(options.windowId);
        return this.#snapshotService.createFromInventory(inventory, settings, options);
      })
    );
  }

  // A workspace showing a native Split View cannot be removed until the user
  // ends that split, so an import that would replace it must say which.
  listSplitViewWorkspaceIds(windowId = null, executorLease = null) {
    return this.#runWithLease(executorLease, async () => {
      const inventory = await this.#snapshotInventory(windowId);
      const workspaceIds = new Set();
      for (const context of inventory.contexts.values()) {
        for (const tab of context.tabs) {
          if (!tabHasNativeSplit(tab)) continue;
          const workspaceId = context.assignmentByTabId.get(tab.logicalId);
          if (workspaceId) workspaceIds.add(workspaceId);
        }
      }
      return [...workspaceIds];
    });
  }

  captureInventory(windowId = null) {
    return this.#enqueue(() => this.#snapshotInventory(windowId));
  }

  captureSidebarUndoSnapshot(windowId = null, executorLease = null) {
    return this.#runWithLease(
      executorLease,
      () => this.#captureSidebarUndoSnapshot(windowId)
    );
  }

  performScopedRestore(windowId, operation) {
    if (typeof operation !== "function") {
      return Promise.reject(invalidRequest());
    }
    return this.#enqueue(async () => {
      const inventory = await this.#snapshotInventory(windowId);
      return operation({
        inventory,
        convergeWindow: (targetWindowId) => this.#reconciler.reconcile(targetWindowId),
        refreshInventory: () => this.#snapshotInventory(windowId)
      });
    });
  }

  restoreSidebarUndo(windowId, entry) {
    return this.#enqueue(() => this.#restoreSidebarUndo(windowId, entry));
  }

  restoreSidebarUndoWithLease(windowId, entry, executorLease) {
    return this.#runWithLease(
      executorLease,
      () => this.#restoreSidebarUndo(windowId, entry)
    );
  }

  restoreSidebarUndoCompanion(entry, executorLease) {
    return this.#runWithLease(
      executorLease,
      () => this.#restoreSidebarUndoCompanion(entry)
    );
  }

  getViewWithLease(windowId, executorLease) {
    return this.#runWithLease(executorLease, () => this.#getView(windowId));
  }

  async removeWorkspaceWithLease(
    windowId,
    workspaceId,
    undoTransaction,
    executorLease
  ) {
    if (!this.#ownsLease(executorLease)) throw invalidRequest();
    const settings = this.#snapshotService && this.#settingsService
      ? await this.#settingsService.getOrInitialize()
      : null;
    return this.#withSidebarUndo(
      windowId,
      undoTransaction,
      () => this.#removeWorkspace(windowId, workspaceId, settings)
    );
  }

  // A selection removed together loses its dividers and spaces, then parks its
  // workspaces in one block before the first survivor, so removing them in the
  // returned order hands every workspace's tabs to that survivor. A single
  // workspace keeps its ordinary successor, the next one on the rail.
  prepareWorkspaceBatchRemoval(workspaceIds, decorations, executorLease = null) {
    return this.#runWithLease(executorLease, async () => {
      if (
        !Array.isArray(workspaceIds) ||
        workspaceIds.length === 0 ||
        workspaceIds.length > MAX_WORKSPACES ||
        workspaceIds.some((id) => typeof id !== "string") ||
        !Array.isArray(decorations) ||
        decorations.length > MAX_RAIL_ENTRIES
      ) {
        throw invalidRequest();
      }
      const state = await this.#stateService.getOrInitialize();
      const plan = planRemovalIntoFirstWorkspace(state.rail, workspaceIds);
      if (!plan.ok) {
        throw invalidRequest();
      }
      if (decorations.length > 0) {
        await this.#stateService.removeRailEntries(decorations);
      }
      if (plan.order.length > 1) {
        await this.#stateService.placeRailEntries(
          plan.parkLocators,
          { kind: "workspace", id: plan.destinationWorkspaceId },
          "before"
        );
      }
      return [...plan.order];
    });
  }

  resetSettingsWithSafety(windowId, rawTargetWorkspaceState = null) {
    if (!this.#snapshotService || !this.#settingsService) {
      return this.#settingsService?.reset() ?? Promise.reject(invalidRequest());
    }
    return this.#settingsService.getOrInitialize().then((settings) =>
      this.#enqueue(async () => {
        const inventory = await this.#snapshotInventory(windowId);
        await this.#snapshotService.createFromInventory(inventory, settings, {
          kind: SNAPSHOT_KINDS.SAFETY,
          reason: "restore-all-settings"
        });
        const previousState = inventory.state;
        const previousRuntime = inventory.runtime;
        const previousWorkspaceIds = previousState.workspaces.map(({ id }) => id);
        const defaultState = rawTargetWorkspaceState === null
          ? createResetWorkspaceState(previousState)
          : parseWorkspaceState(rawTargetWorkspaceState);
        const defaultWorkspaceIds = defaultState.workspaces.map(({ id }) => id);
        const defaultSettings = parseSettingsState({
          ...createDefaultSettingsState(),
          privacy: settings.privacy
        });
        try {
          await this.#runtimeService.reset(previousWorkspaceIds);
          await this.#stateService.reset(defaultState);
          const savedSettings = await this.#settingsService.reset(defaultSettings);
          await this.#reconciler.reconcile(windowId);
          return savedSettings;
        } catch (error) {
          let stateRestored = false;
          try {
            await this.#stateService.replaceForRestore(previousState);
            stateRestored = true;
          } catch {
            // Keep the empty runtime valid for the default state when state rollback fails.
            await this.#runtimeService
              .save(createEmptyWorkspaceRuntime(), defaultWorkspaceIds)
              .catch(() => undefined);
          }
          if (stateRestored) {
            await this.#runtimeService
              .save(previousRuntime, previousWorkspaceIds)
              .catch(() => undefined);
          }
          await this.#settingsService.replaceForRestore(settings).catch(() => undefined);
          await this.#reconciler.reconcile(windowId).catch(() => undefined);
          throw error;
        }
      })
    );
  }

  restoreSnapshot(windowId, record, request) {
    if (!this.#restoreService || !this.#settingsService || !this.#snapshotService) {
      return Promise.reject(invalidRequest());
    }
    return this.#settingsService.getOrInitialize().then((settings) =>
      this.#enqueue(async () => {
        const inventory = await this.#snapshotInventory(windowId);
        return this.#restoreService.restoreSnapshot({
          record,
          request,
          inventory,
          createSafetySnapshot: (reason) =>
            this.#snapshotService.createFromInventory(inventory, settings, {
              kind: SNAPSHOT_KINDS.SAFETY,
              reason
            }),
          convergeWindow: (targetWindowId) => this.#reconciler.reconcile(targetWindowId),
          restoreBatchSize: settings.snapshots.restoreBatchSize
        });
      })
    );
  }

  snapshotContainerPreflight(record, request) {
    if (!this.#restoreService) {
      return Promise.reject(invalidRequest());
    }
    return this.#restoreService.containerPreflight(record, request);
  }

  setWorkspaceDefaultContainer(workspaceId, refId) {
    if (!this.#containerService) {
      return Promise.reject(invalidRequest());
    }
    return this.#enqueue(async () => {
      if (refId !== null) await this.#containerService.resolve(refId);
      return this.#stateService.updateWorkspace(workspaceId, {
        defaultContainerRef: refId
      });
    });
  }

  // One reference for a whole selection: it is resolved once, then every
  // workspace is written together, so the selection never ends up half-set.
  setWorkspaceDefaultContainers(workspaceIds, refId) {
    if (!this.#containerService) {
      return Promise.reject(invalidRequest());
    }
    return this.#enqueue(async () => {
      if (refId !== null) await this.#containerService.resolve(refId);
      return this.#stateService.setDefaultContainerRefs(workspaceIds, refId);
    });
  }

  restoreSettingsBackup(windowId, backup, sections) {
    if (!this.#restoreService || !this.#settingsService || !this.#snapshotService) {
      return Promise.reject(invalidRequest());
    }
    // Settings are read inside the serialized operation so the restore journal's
    // "before" copy is the state at mutation time, not an earlier snapshot.
    return this.#enqueue(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      const inventory = await this.#snapshotInventory(windowId);
      return this.#restoreService.restoreSettingsBackup({
        backup,
        sections,
        inventory,
        currentSettings: settings,
        createSafetySnapshot: (reason) =>
          this.#snapshotService.createFromInventory(inventory, settings, {
            kind: SNAPSHOT_KINDS.SAFETY,
            reason
          }),
        convergeWindows: () => this.#convergeAllWindows()
      });
    });
  }

  recoverSettingsTransfer() {
    if (!this.#settingsTransferService || !this.#settingsService) {
      return Promise.resolve(false);
    }
    return this.#enqueue(() =>
      this.#settingsTransferService.recover({
        convergeWindows: () => this.#convergeAllWindows()
      })
    );
  }

  ensureSettingsCompanion(windowId, settingsTabId) {
    return this.#enqueue(() => this.#ensureSettingsCompanion(windowId, settingsTabId));
  }

  openSettings(windowId) {
    return this.#enqueue(() => this.#openSettings(windowId));
  }

  reconcileWindow(windowId, options = undefined, executorLease = null) {
    // Container lifecycle events refresh the registry through their own
    // listener before enqueueing reconciles, so event-driven passes skip the
    // repeated registry read; explicit view requests keep it.
    return this.#runWithLease(executorLease, () =>
      this.#getView(windowId, {
        refreshContainers: options?.refreshContainers !== false
      })
    );
  }

  getMoveMenuContext(tabId) {
    return this.#enqueue(() => this.#getMoveMenuContext(tabId));
  }

  moveTabToWorkspace(tabId, workspaceId) {
    return this.#enqueue(() => this.#moveTabToWorkspace(tabId, workspaceId));
  }

  moveGroupToWorkspace(tabId, workspaceId) {
    return this.#enqueue(() => this.#moveGroupToWorkspace(tabId, workspaceId));
  }

  acknowledgeNotice(windowId, noticeId) {
    return this.#enqueue(async () => {
      if (!validWindowId(windowId) || typeof noticeId !== "string") {
        throw invalidRequest();
      }
      return this.#reconciler.acknowledgeNotice(windowId, noticeId);
    });
  }

  reportOperationFailure(windowId, operation) {
    return this.#enqueue(async () => {
      if (!validWindowId(windowId)) {
        throw invalidRequest();
      }
      return this.#reconciler.storeNotice(windowId, {
        operation,
        severity: WORKSPACE_NOTICE_SEVERITIES.ERROR,
        reasons: [
          {
            reason: WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE,
            count: 1,
            retryable: true
          }
        ]
      });
    });
  }

  async #restoreSidebarUndo(windowId, rawEntry) {
    if (!validWindowId(windowId)) throw invalidRequest();
    let entry;
    try {
      entry = parseSidebarUndoEntry(rawEntry, this.#browser.scope ?? "normal");
    } catch {
      throw invalidRequest();
    }
    if (entry.originWindowId !== windowId) throw invalidRequest();
    const inventory = await this.#snapshotInventory(windowId);
    const affectedLogicalIds = new Set(
      entry.affectedKeys.filter((key) => key.startsWith("tab:")).map((key) => key.slice(4))
    );
    const redoCloseTabIds =
      entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE &&
      entry.action === SIDEBAR_UNDO_ACTIONS.REDO
        ? [...inventory.contexts.values()]
            .flatMap((context) => context.tabs)
            .filter((tab) => affectedLogicalIds.has(tab.logicalId))
            .map((tab) => tab.id)
        : [];
    const currentSnapshot = this.#sidebarUndoSnapshot(
      inventory,
      await this.#tabPages(redoCloseTabIds)
    );

    if (entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD) {
      if (entry.action === SIDEBAR_UNDO_ACTIONS.REDO) {
        return this.#reapplySidebarUnload(windowId, entry, inventory, currentSnapshot);
      }
      return this.#restoreSidebarUnload(windowId, entry, inventory, currentSnapshot);
    }
    if (entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE) {
      if (entry.action === SIDEBAR_UNDO_ACTIONS.REDO) {
        return this.#reapplySidebarClose(windowId, entry, inventory, currentSnapshot);
      }
      return this.#restoreSidebarClose(windowId, entry, inventory, currentSnapshot);
    }
    if (entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE) {
      return this.#restoreSidebarContainerMove(windowId, entry, inventory, currentSnapshot);
    }

    const requestedCount = sidebarUndoRequestedCount(entry);
    if (fingerprintUndoSnapshot(currentSnapshot, entry.affectedKeys) !== entry.expectedPostFingerprint) {
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildSidebarUndoOutcome({
          requestedCount,
          skippedCount: requestedCount,
          reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
        })
      };
    }

    if (
      entry.action === SIDEBAR_UNDO_ACTIONS.UNDO &&
      entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_CREATE
    ) {
      const beforeIds = new Set(entry.before.workspaceState.workspaces.map(({ id }) => id));
      const createdIds = entry.affectedKeys
        .filter((key) => key.startsWith("workspace:"))
        .map((key) => key.slice("workspace:".length))
        .filter((id) => !beforeIds.has(id));
      if (inventory.runtime.tabs.some(({ workspaceId }) => createdIds.includes(workspaceId))) {
        return {
          view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
          outcome: buildSidebarUndoOutcome({
            requestedCount,
            skippedCount: requestedCount,
            reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
          })
        };
      }
    }

    const nextState = structuredClone(inventory.state);
    const affectedWorkspaceIds = entry.affectedKeys
      .filter((key) => key.startsWith("workspace:"))
      .map((key) => key.slice("workspace:".length));
    if (affectedWorkspaceIds.length > 0) {
      const affected = new Set(affectedWorkspaceIds);
      nextState.workspaces = nextState.workspaces.filter(({ id }) => !affected.has(id));
      for (const descriptor of entry.before.workspaceState.workspaces) {
        if (!affected.has(descriptor.id)) continue;
        const beforeIndex = entry.before.workspaceState.workspaces.findIndex(
          ({ id }) => id === descriptor.id
        );
        nextState.workspaces.splice(
          Math.min(beforeIndex, nextState.workspaces.length),
          0,
          structuredClone(descriptor)
        );
      }
    }
    if (entry.affectedKeys.includes("rail")) {
      nextState.rail = structuredClone(entry.before.workspaceState.rail);
    }

    const nextRuntime = structuredClone(inventory.runtime);
    const beforeAssignments = new Map(entry.before.workspaceRuntime.tabs.map((tab) => [tab.id, tab]));
    for (const key of entry.affectedKeys.filter((key) => key.startsWith("assignment:"))) {
      const logicalTabId = key.slice("assignment:".length);
      nextRuntime.tabs = nextRuntime.tabs.filter(({ id }) => id !== logicalTabId);
      const beforeAssignment = beforeAssignments.get(logicalTabId);
      if (beforeAssignment) nextRuntime.tabs.push(structuredClone(beforeAssignment));
    }
    const beforeWindows = new Map(entry.before.workspaceRuntime.windows.map((item) => [item.id, item]));
    for (const key of entry.affectedKeys.filter((key) => key.startsWith("window:"))) {
      const logicalWindowId = key.slice("window:".length);
      nextRuntime.windows = nextRuntime.windows.filter(({ id }) => id !== logicalWindowId);
      const beforeWindow = beforeWindows.get(logicalWindowId);
      if (beforeWindow) nextRuntime.windows.push(structuredClone(beforeWindow));
    }

    const previousState = inventory.state;
    const workspaceIds = nextState.workspaces.map(({ id }) => id);
    if (nextRuntime.tabs.some(({ workspaceId }) => !workspaceIds.includes(workspaceId))) {
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildSidebarUndoOutcome({
          requestedCount,
          skippedCount: requestedCount,
          reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
        }),
        reversals: []
      };
    }
    try {
      await this.#stateService.replaceForRestore(nextState);
      await this.#runtimeService.save(nextRuntime, workspaceIds);
    } catch (error) {
      await this.#stateService.replaceForRestore(previousState).catch(() => undefined);
      throw error;
    }
    await this.#convergeAllWindows();
    const finalInventory = await this.#snapshotInventory(windowId);
    return withSidebarUndoReversal({
      view: this.#buildWorkspaceView(requireRequestedContext(finalInventory)),
      outcome: buildSidebarUndoOutcome({ requestedCount, restoredCount: requestedCount })
    }, entry, currentSnapshot, this.#sidebarUndoSnapshot(finalInventory));
  }

  async #restoreSidebarUndoCompanion(rawEntry) {
    let entry;
    try {
      entry = parseSidebarUndoEntry(rawEntry, this.#browser.scope ?? "normal");
    } catch {
      throw invalidRequest();
    }
    if (
      entry.operation !== SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE ||
      entry.affectedKeys.some((key) => key === "rail" || key.startsWith("workspace:"))
    ) {
      throw invalidRequest();
    }
    const currentSnapshot = await this.#captureSidebarUndoSnapshot(null);
    const requestedCount = sidebarUndoRequestedCount(entry);
    if (
      fingerprintUndoSnapshot(currentSnapshot, entry.affectedKeys) !==
      entry.expectedPostFingerprint
    ) {
      return {
        outcome: buildSidebarUndoOutcome({
          requestedCount,
          skippedCount: requestedCount,
          reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
        }),
        reversals: []
      };
    }

    const nextRuntime = structuredClone(currentSnapshot.workspaceRuntime);
    const beforeAssignments = new Map(
      entry.before.workspaceRuntime.tabs.map((tab) => [tab.id, tab])
    );
    for (const key of entry.affectedKeys.filter((key) => key.startsWith("assignment:"))) {
      const logicalTabId = key.slice("assignment:".length);
      nextRuntime.tabs = nextRuntime.tabs.filter(({ id }) => id !== logicalTabId);
      const beforeAssignment = beforeAssignments.get(logicalTabId);
      if (beforeAssignment) nextRuntime.tabs.push(structuredClone(beforeAssignment));
    }
    const beforeWindows = new Map(
      entry.before.workspaceRuntime.windows.map((item) => [item.id, item])
    );
    for (const key of entry.affectedKeys.filter((key) => key.startsWith("window:"))) {
      const logicalWindowId = key.slice("window:".length);
      nextRuntime.windows = nextRuntime.windows.filter(({ id }) => id !== logicalWindowId);
      const beforeWindow = beforeWindows.get(logicalWindowId);
      if (beforeWindow) nextRuntime.windows.push(structuredClone(beforeWindow));
    }
    const state = await this.#stateService.getOrInitialize();
    await this.#runtimeService.save(nextRuntime, state.workspaces.map(({ id }) => id));
    await this.#convergeAllWindows();
    const finalSnapshot = await this.#captureSidebarUndoSnapshot(null);
    return {
      outcome: buildSidebarUndoOutcome({ requestedCount, restoredCount: requestedCount }),
      reversals: [{ scope: entry.scope, before: currentSnapshot, after: finalSnapshot }]
    };
  }

  async #restoreSidebarUnload(windowId, entry, inventory, currentSnapshot) {
    const currentByLogicalId = new Map(
      currentSnapshot.browserTabs.map((tab) => [tab.logicalTabId, tab])
    );
    const affected = new Set(
      entry.affectedKeys.filter((key) => key.startsWith("tab:")).map((key) => key.slice(4))
    );
    const requested = entry.before.browserTabs.filter((tab) =>
      affected.has(tab.logicalTabId) && tab.discarded === false
    );
    const eligible = [];
    let skippedCount = 0;
    for (const before of requested) {
      const current = currentByLogicalId.get(before.logicalTabId);
      if (
        !current || current.firefoxTabId !== before.firefoxTabId ||
        current.url !== before.url || current.workspaceId !== before.workspaceId ||
        current.discarded !== true
      ) {
        skippedCount += 1;
      } else {
        eligible.push(current);
      }
    }
    if (eligible.length > 0) {
      try {
        await this.#browser.reloadTabs(eligible.map(({ firefoxTabId }) => firefoxTabId));
      } catch {
        // Final reconciled state below determines the safely reversible subset.
      }
    }
    const finalInventory = await this.#reconciler.reconcile(windowId);
    const finalSnapshot = this.#sidebarUndoSnapshot(finalInventory);
    const finalByLogicalId = new Map(finalSnapshot.browserTabs.map((tab) => [tab.logicalTabId, tab]));
    const restoredCount = eligible.filter(({ logicalTabId }) =>
      finalByLogicalId.get(logicalTabId)?.discarded === false
    ).length;
    const failedCount = eligible.length - restoredCount;
    const reasons = [];
    if (skippedCount > 0) reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: skippedCount });
    if (failedCount > 0) reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.BROWSER_FAILURE, count: failedCount });
    return withSidebarUndoReversal({
      view: this.#buildWorkspaceView(requireRequestedContext(finalInventory)),
      outcome: buildSidebarUndoOutcome({
        requestedCount: requested.length,
        restoredCount,
        skippedCount,
        failedCount,
        reasons
      })
    }, entry, currentSnapshot, finalSnapshot);
  }

  async #reapplySidebarUnload(windowId, entry, inventory, currentSnapshot) {
    if (fingerprintUndoSnapshot(currentSnapshot, entry.affectedKeys) !== entry.expectedPostFingerprint) {
      const requestedCount = Math.max(
        entry.affectedKeys.filter((key) => key.startsWith("tab:")).length,
        1
      );
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildSidebarUndoOutcome({
          requestedCount,
          skippedCount: requestedCount,
          reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
        }),
        reversals: []
      };
    }
    const targetByLogicalId = new Map(
      entry.before.browserTabs.map((tab) => [tab.logicalTabId, tab])
    );
    const currentByLogicalId = new Map(
      currentSnapshot.browserTabs.map((tab) => [tab.logicalTabId, tab])
    );
    const requested = entry.affectedKeys
      .filter((key) => key.startsWith("tab:"))
      .map((key) => key.slice(4))
      .filter((logicalTabId) => targetByLogicalId.get(logicalTabId)?.discarded === true);
    const eligible = [];
    let skippedCount = 0;
    for (const logicalTabId of requested) {
      const target = targetByLogicalId.get(logicalTabId);
      const current = currentByLogicalId.get(logicalTabId);
      if (
        !current || current.firefoxTabId !== target.firefoxTabId ||
        current.url !== target.url || current.workspaceId !== target.workspaceId ||
        current.discarded !== false
      ) {
        skippedCount += 1;
      } else {
        eligible.push(current);
      }
    }
    if (eligible.length > 0) {
      await this.#browser.discardTabs(eligible.map(({ firefoxTabId }) => firefoxTabId)).catch(
        () => undefined
      );
    }
    const finalInventory = await this.#reconciler.reconcile(windowId);
    const finalSnapshot = this.#sidebarUndoSnapshot(finalInventory);
    const finalByLogicalId = new Map(finalSnapshot.browserTabs.map((tab) => [tab.logicalTabId, tab]));
    const restoredCount = eligible.filter(({ logicalTabId }) =>
      finalByLogicalId.get(logicalTabId)?.discarded === true
    ).length;
    const failedCount = eligible.length - restoredCount;
    const reasons = [];
    if (skippedCount > 0) reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: skippedCount });
    if (failedCount > 0) reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.BROWSER_FAILURE, count: failedCount });
    return withSidebarUndoReversal({
      view: this.#buildWorkspaceView(requireRequestedContext(finalInventory)),
      outcome: buildSidebarUndoOutcome({
        requestedCount: requested.length,
        restoredCount,
        skippedCount,
        failedCount,
        reasons
      })
    }, entry, currentSnapshot, finalSnapshot);
  }

  async #restoreSidebarClose(windowId, entry, inventory, currentSnapshot) {
    const affectedBefore = entry.before.browserTabs.filter((tab) =>
      entry.affectedKeys.includes(`tab:${tab.logicalTabId}`)
    );
    const requestedCount = affectedBefore.filter((tab) =>
      !currentSnapshot.browserTabs.some((current) => current.logicalTabId === tab.logicalTabId)
    ).length;
    if (fingerprintUndoSnapshot(currentSnapshot, entry.affectedKeys) !== entry.expectedPostFingerprint) {
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildSidebarUndoOutcome({
          requestedCount: Math.max(requestedCount, 1),
          skippedCount: Math.max(requestedCount, 1),
          reasons: [{
            reason: SIDEBAR_UNDO_REASON_CODES.STALE,
            count: Math.max(requestedCount, 1)
          }]
        })
      };
    }
    const recovery = await recoverClosedSidebarTabs({
      entry,
      currentSnapshot,
      browserAdapter: this.#browser,
      containerService: this.#containerService
    });
    const nextRuntime = structuredClone(inventory.runtime);
    const restoredByOldId = new Map(
      recovery.restored.map((item) => [item.descriptor.logicalTabId, item])
    );
    const restoredWindowIds = new Set(
      recovery.restored.map(({ descriptor }) => descriptor.logicalWindowId)
    );
    let parentApproximationCount = 0;

    for (const logicalWindowId of restoredWindowIds) {
      const beforeWindow = entry.before.workspaceRuntime.windows.find(({ id }) => id === logicalWindowId);
      const currentWindow = nextRuntime.windows.find(({ id }) => id === logicalWindowId);
      if (!beforeWindow || !currentWindow) continue;
      const rebuilt = structuredClone(beforeWindow);
      for (const [oldId, restored] of restoredByOldId) {
        if (restored.descriptor.logicalWindowId === logicalWindowId) {
          remapWindowTabId(rebuilt, oldId, restored.logicalTabId);
        }
      }
      const beforeTabIds = new Set(
        entry.before.browserTabs
          .filter((tab) => tab.logicalWindowId === logicalWindowId)
          .map(({ logicalTabId }) => logicalTabId)
      );
      for (const descriptor of entry.before.browserTabs.filter((tab) =>
        tab.logicalWindowId === logicalWindowId &&
        !currentSnapshot.browserTabs.some((current) => current.logicalTabId === tab.logicalTabId) &&
        !restoredByOldId.has(tab.logicalTabId)
      )) {
        const childCount = rebuilt.workspaceLayouts.reduce(
          (count, layout) => count + layout.tree.filter((node) =>
            node.parentTabId === descriptor.logicalTabId && restoredByOldId.has(node.tabId)
          ).length,
          0
        );
        parentApproximationCount += childCount;
        removeTabFromLayouts({ windows: [rebuilt] }, descriptor.logicalTabId);
      }
      const currentTabs = currentSnapshot.browserTabs.filter((tab) =>
        tab.logicalWindowId === logicalWindowId && !beforeTabIds.has(tab.logicalTabId)
      );
      for (const tab of currentTabs) {
        placeTabInLayout(rebuilt, tab.workspaceId, tab.logicalTabId, { pinned: tab.pinned });
      }
      const presentIds = new Set(rebuilt.workspaceLayouts.flatMap((layout) => layout.tabIds));
      rebuilt.selectedTabs = rebuilt.selectedTabs.filter(({ tabId }) => presentIds.has(tabId));
      nextRuntime.windows = nextRuntime.windows.map((candidate) =>
        candidate.id === logicalWindowId ? rebuilt : candidate
      );
    }

    for (const restored of recovery.restored) {
      nextRuntime.tabs = nextRuntime.tabs.filter(({ id }) => id !== restored.logicalTabId);
      nextRuntime.tabs.push({
        id: restored.logicalTabId,
        workspaceId: restored.descriptor.workspaceId
      });
    }
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    await this.#runtimeService.save(nextRuntime, workspaceIds);
    await this.#convergeAllWindows();
    const finalInventory = await this.#snapshotInventory(windowId);
    const reasons = [...recovery.reasons];
    if (parentApproximationCount > 0) {
      const existing = reasons.find(({ reason }) => reason === SIDEBAR_UNDO_REASON_CODES.PARENT_MISSING);
      if (existing) existing.count += parentApproximationCount;
      else reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.PARENT_MISSING, count: parentApproximationCount });
    }
    return withSidebarUndoReversal({
      view: this.#buildWorkspaceView(requireRequestedContext(finalInventory)),
      outcome: buildSidebarUndoOutcome({
        requestedCount: recovery.requestedCount,
        restoredCount: recovery.restored.length,
        skippedCount: recovery.skipped.length,
        failedCount: recovery.failed.length,
        approximatedCount: recovery.approximatedCount + parentApproximationCount,
        retainedSafetyCount: recovery.retainedSafetyCount,
        reasons
      })
    }, entry, currentSnapshot, this.#sidebarUndoSnapshot(finalInventory));
  }

  async #reapplySidebarClose(windowId, entry, inventory, currentSnapshot) {
    const requestedIds = entry.affectedKeys
      .filter((key) => key.startsWith("tab:"))
      .map((key) => key.slice(4))
      .filter((logicalTabId) =>
        !entry.before.browserTabs.some((tab) => tab.logicalTabId === logicalTabId)
      );
    const requestedCount = Math.max(requestedIds.length, 1);
    if (requestedIds.length === 0) {
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildSidebarUndoOutcome({
          requestedCount,
          skippedCount: requestedCount,
          reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
        }),
        reversals: []
      };
    }
    if (fingerprintUndoSnapshot(currentSnapshot, entry.affectedKeys) !== entry.expectedPostFingerprint) {
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildSidebarUndoOutcome({
          requestedCount,
          skippedCount: requestedCount,
          reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: requestedCount }]
        }),
        reversals: []
      };
    }
    const requestedSet = new Set(requestedIds);
    const targetTabs = [...inventory.contexts.values()]
      .flatMap((context) => context.tabs)
      .filter((tab) => requestedSet.has(tab.logicalId));
    const skippedCount = requestedIds.length - targetTabs.length;
    if (targetTabs.length > 1) {
      await this.#captureCloseSafety(inventory);
    }
    const protectedResult = await this.#ensureCloseSuccessors(
      inventory,
      targetTabs,
      windowId
    );
    if (targetTabs.length > 0) {
      await this.#browser.removeTabs(targetTabs.map(({ id }) => id)).catch(() => undefined);
    }
    const finalInventory = await this.#reconciler.reconcile(windowId);
    const finalSnapshot = this.#sidebarUndoSnapshot(finalInventory);
    const finalIds = new Set(finalSnapshot.browserTabs.map(({ logicalTabId }) => logicalTabId));
    const restoredCount = targetTabs.filter(({ logicalId }) => !finalIds.has(logicalId)).length;
    const failedCount = targetTabs.length - restoredCount;
    const reasons = [];
    if (skippedCount > 0) reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: skippedCount });
    if (failedCount > 0) reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.BROWSER_FAILURE, count: failedCount });
    if (protectedResult.replacementCount > 0) {
      reasons.push({
        reason: SIDEBAR_UNDO_REASON_CODES.SAFETY_RETAINED,
        count: protectedResult.replacementCount
      });
    }
    return withSidebarUndoReversal({
      view: this.#buildWorkspaceView(requireRequestedContext(finalInventory)),
      outcome: buildSidebarUndoOutcome({
        requestedCount,
        restoredCount,
        skippedCount,
        failedCount,
        retainedSafetyCount: protectedResult.replacementCount,
        reasons
      })
    }, entry, currentSnapshot, finalSnapshot);
  }

  // Undo and Redo both return each affected tab to the container its entry
  // recorded, using the forward replacement primitive. The entry's recorded
  // container differs from the tab's container right after the action, and
  // Firefox can only change a container by replacement, so a tab that closed,
  // changed workspace or window, or already sits in the recorded container is
  // stale and left alone.
  async #restoreSidebarContainerMove(windowId, entry, inventory, currentSnapshot) {
    const context = requireRequestedContext(inventory);
    const affected = new Set(
      entry.affectedKeys.filter((key) => key.startsWith("tab:")).map((key) => key.slice(4))
    );
    const targets = entry.before.browserTabs.filter(({ logicalTabId }) =>
      affected.has(logicalTabId)
    );
    const currentByLogicalId = new Map(
      currentSnapshot.browserTabs.map((tab) => [tab.logicalTabId, tab])
    );
    const liveByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab]));
    const resolvedStores = new Map();
    let staleCount = 0;
    let unavailableCount = 0;
    const entries = [];
    for (const target of targets) {
      const current = currentByLogicalId.get(target.logicalTabId);
      const live = liveByLogicalId.get(target.logicalTabId);
      if (
        !current || !live ||
        current.windowId !== windowId ||
        current.workspaceId !== target.workspaceId ||
        current.containerRef === target.containerRef
      ) {
        staleCount += 1;
        continue;
      }
      let cookieStoreId = null;
      if (target.containerRef !== null) {
        if (!resolvedStores.has(target.containerRef)) {
          resolvedStores.set(
            target.containerRef,
            this.#containerService
              ? await this.#containerService.resolve(target.containerRef).catch(() => undefined)
              : undefined
          );
        }
        cookieStoreId = resolvedStores.get(target.containerRef);
        if (cookieStoreId === undefined) {
          unavailableCount += 1;
          continue;
        }
      }
      entries.push({ tab: live, cookieStoreId });
    }

    const { moved, reasonCounts } = await this.#replaceTabsInContainers(windowId, context, entries);
    const { finalInventory, finalContext, verifiedCount } =
      await this.#settleContainerReplacements(windowId, inventory, context, moved);
    for (const [reason, count] of reasonCounts) {
      if (isFailedContainerMoveReason(reason) || reason === TAB_CONTAINER_MOVE_REASONS.CLOSE_REFUSED) {
        continue;
      }
      staleCount += count;
    }
    const requestedCount = Math.max(targets.length, 1);
    const skippedCount = staleCount + unavailableCount + (targets.length === 0 ? 1 : 0);
    const failedCount = requestedCount - verifiedCount - skippedCount;
    const reasons = [];
    if (skippedCount - unavailableCount > 0) {
      reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: skippedCount - unavailableCount });
    }
    if (unavailableCount > 0) {
      reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.CONTAINER_UNAVAILABLE, count: unavailableCount });
    }
    if (failedCount > 0) {
      reasons.push({ reason: SIDEBAR_UNDO_REASON_CODES.BROWSER_FAILURE, count: failedCount });
    }
    const result = {
      view: this.#buildWorkspaceView(finalContext),
      outcome: buildSidebarUndoOutcome({
        requestedCount,
        restoredCount: verifiedCount,
        skippedCount,
        failedCount,
        reasons
      })
    };
    return verifiedCount === 0
      ? { ...result, reversals: [] }
      : withSidebarUndoReversal(result, entry, currentSnapshot, this.#sidebarUndoSnapshot(finalInventory));
  }

  // Inventory carries no tab addresses, so a close slot's recoverable pages
  // are supplied for exactly the tabs that close is about to remove.
  #sidebarUndoSnapshot(inventory, pages = []) {
    const pageByFirefoxId = new Map(pages.map((page) => [page.id, page]));
    const browserTabs = [...inventory.contexts.values()]
      .flatMap((context) => context.tabs.flatMap((tab) => {
        const workspaceId = context.assignmentByTabId.get(tab.logicalId);
        if (!workspaceId) return [];
        const container = this.#containerService?.presentationForCookieStore(tab.cookieStoreId);
        return [{
          logicalTabId: tab.logicalId,
          firefoxTabId: tab.id,
          windowId: context.windowId,
          logicalWindowId: context.windowRuntime.id,
          workspaceId,
          index: Number.isInteger(tab.index) && tab.index >= 0 ? tab.index : 0,
          url: (pageByFirefoxId.get(tab.id)?.url ?? "about:blank").slice(0, 65_536),
          title: typeof tab.title === "string" ? tab.title.slice(0, 4_096) : "",
          pinned: tab.pinned === true,
          discarded: tab.discarded === true,
          active: tab.active === true,
          hidden: tab.hidden === true,
          containerRef: container?.kind === "container" ? container.refId : null
        }];
      }))
      .sort((left, right) => left.windowId - right.windowId || left.index - right.index);
    return parseSidebarUndoSnapshot({
      workspaceState: inventory.state,
      workspaceRuntime: inventory.runtime,
      browserTabs
    });
  }

  async #tabPages(tabIds) {
    if (tabIds.length === 0 || typeof this.#browser.listTabPages !== "function") {
      return [];
    }
    try {
      return await this.#browser.listTabPages(tabIds);
    } catch {
      // Recovery falls back to about:blank rather than failing the action.
      return [];
    }
  }

  async #withSidebarUndo(windowId, transaction, operation, { pageTabIds = null } = {}) {
    if (transaction === null) {
      return operation();
    }
    if (
      !transaction ||
      typeof transaction.prepare !== "function" ||
      typeof transaction.commit !== "function" ||
      typeof transaction.abort !== "function"
    ) {
      throw invalidRequest();
    }
    const markUndoUnavailable = async () => {
      if (typeof transaction.failApplied === "function") {
        await transaction.failApplied().catch(() => undefined);
      } else {
        await transaction.abort().catch(() => undefined);
      }
    };
    const beforeInventory = await this.#snapshotInventory(windowId);
    const before = this.#sidebarUndoSnapshot(
      beforeInventory,
      await this.#tabPages(pageTabIds ? pageTabIds() : [])
    );
    await transaction.prepare(before);
    let result;
    try {
      result = await operation();
    } catch (error) {
      try {
        const after = this.#sidebarUndoSnapshot(await this.#snapshotInventory(windowId));
        await transaction.commit(after);
      } catch {
        await markUndoUnavailable();
      }
      throw error;
    }
    let after;
    try {
      after = this.#sidebarUndoSnapshot(await this.#snapshotInventory(windowId));
    } catch {
      await markUndoUnavailable();
      return result;
    }
    try {
      await transaction.commit(after);
    } catch {
      await markUndoUnavailable();
    }
    return result;
  }

  #enqueue(operation) {
    if (this.#operationExecutor) {
      return this.#operationExecutor.run(operation);
    }
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.catch(() => undefined);
    return result;
  }

  #ownsLease(executorLease) {
    return Boolean(
      this.#operationExecutor &&
      typeof this.#operationExecutor.ownsLease === "function" &&
      this.#operationExecutor.ownsLease(executorLease)
    );
  }

  #runWithLease(executorLease, operation) {
    if (executorLease !== null) {
      return this.#ownsLease(executorLease)
        ? Promise.resolve().then(operation)
        : Promise.reject(invalidRequest());
    }
    return this.#enqueue(operation);
  }

  async #convergeAllWindows() {
    for (const windowId of await this.#browser.listNormalWindowIds()) {
      await this.#reconciler.reconcile(windowId);
    }
  }

  async #snapshotInventory(requestedWindowId) {
    const windowIds = await this.#browser.listNormalWindowIds();
    const windowId = validWindowId(requestedWindowId) && windowIds.includes(requestedWindowId)
      ? requestedWindowId
      : windowIds[0];
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    return inventory;
  }

  async #captureSidebarUndoSnapshot(requestedWindowId) {
    const windowIds = await this.#browser.listNormalWindowIds();
    if (windowIds.length > 0) {
      const windowId = validWindowId(requestedWindowId) && windowIds.includes(requestedWindowId)
        ? requestedWindowId
        : windowIds[0];
      return this.#sidebarUndoSnapshot(await this.#snapshotInventory(windowId));
    }
    const state = await this.#stateService.getOrInitialize();
    const workspaceIds = state.workspaces.map(({ id }) => id);
    const runtime = await this.#runtimeService.getOrInitialize(workspaceIds);
    return parseSidebarUndoSnapshot({
      workspaceState: state,
      workspaceRuntime: runtime,
      browserTabs: []
    });
  }

  async #getView(windowId, { refreshContainers = true } = {}) {
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    if (refreshContainers) {
      await this.#containerService?.refresh({ notify: false });
    }
    const inventory = await this.#reconciler.reconcile(windowId);
    return this.#buildWorkspaceView(requireRequestedContext(inventory));
  }

  async #getSearchIndex(windowId) {
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    await this.#containerService?.refresh({ notify: false });
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    const context = requireRequestedContext(inventory);
    return buildWorkspaceSearchIndex(
      context,
      this.#containerService,
      await this.#browser.listTabSearchLocations(windowId)
    );
  }

  #buildWorkspaceView(context) {
    return buildWorkspaceView(context, this.#containerService);
  }

  async #resolvedCookieStoreId(state, workspaceId, rawAssignment) {
    const workspace = state.workspaces.find(({ id }) => id === workspaceId);
    if (!workspace) throw invalidRequest();
    const assignment = rawAssignment === null
      ? workspace.defaultContainerRef === null
        ? { kind: "none" }
        : { kind: "container", refId: workspace.defaultContainerRef }
      : parseContainerAssignment(rawAssignment, invalidRequest);
    if (assignment.kind === "none") return null;
    if (!this.#containerService) {
      throw new ContainerError(CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE);
    }
    return this.#containerService.resolve(assignment.refId);
  }

  async #createBrowserTabForWorkspace(
    windowId,
    state,
    workspaceId,
    { assignment = null, active = false, index, url } = {}
  ) {
    const cookieStoreId = this.#containerService
      ? await this.#resolvedCookieStoreId(state, workspaceId, assignment)
      : null;
    return this.#browser.createTab(windowId, { cookieStoreId, active, index, url });
  }

  async #createWorkspaceTab(windowId, workspaceId, assignment) {
    if (!validWindowId(windowId)) throw invalidRequest();
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    if (
      context.windowRuntime.activeWorkspaceId !== workspaceId ||
      !inventory.state.workspaces.some(({ id }) => id === workspaceId)
    ) {
      throw invalidRequest();
    }
    const created = await this.#createBrowserTabForWorkspace(
      windowId,
      inventory.state,
      workspaceId,
      { assignment, active: true }
    );
    const logicalId = await this.#browser.getOrCreateTabIdentity(created.id);
    inventory.runtime.tabs.push({ id: logicalId, workspaceId });
    placeTabInLayout(context.windowRuntime, workspaceId, logicalId);
    await this.#runtimeService.save(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id)
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #copyTabToContainer(windowId, tabId, rawAssignment) {
    if (!validWindowId(windowId) || !Number.isInteger(tabId) || !this.#containerService) {
      throw invalidRequest();
    }
    const assignment = parseContainerAssignment(rawAssignment, invalidRequest);
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const source = context.tabs.find((tab) => tab.id === tabId);
    if (!source) throw invalidRequest();
    const workspaceId = context.assignmentByTabId.get(source.logicalId);
    if (typeof workspaceId !== "string") throw invalidRequest();
    const cookieStoreId = assignment.kind === "none"
      ? null
      : await this.#containerService.resolve(assignment.refId);
    const created = await this.#browser.copyTab(tabId, { cookieStoreId });
    const logicalId = await this.#browser.getOrCreateTabIdentity(created.id);
    inventory.runtime.tabs.push({ id: logicalId, workspaceId });
    const layout = placeTabInLayout(context.windowRuntime, workspaceId, logicalId);
    const sourceIndex = layout.tabIds.indexOf(source.logicalId);
    const createdIndex = layout.tabIds.indexOf(logicalId);
    if (sourceIndex >= 0 && createdIndex >= 0 && createdIndex !== sourceIndex + 1) {
      layout.tabIds.splice(createdIndex, 1);
      layout.tabIds.splice(sourceIndex + 1, 0, logicalId);
      const treeIndex = layout.tree.findIndex((node) => node.tabId === logicalId);
      const [node] = layout.tree.splice(treeIndex, 1);
      layout.tree.splice(sourceIndex + 1, 0, node);
    }
    await this.#runtimeService.save(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id)
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  // Runs the replacement primitive for each { tab, cookieStoreId } in order.
  // Tabs already in their target or held by a Split View are skipped before
  // any Firefox call.
  async #replaceTabsInContainers(windowId, context, entries) {
    const moved = [];
    const reasonCounts = new Map();
    const skip = (reason) => reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    for (const { tab, cookieStoreId } of entries) {
      if (tabUsesCookieStore(tab, cookieStoreId)) {
        skip(TAB_CONTAINER_MOVE_REASONS.ALREADY_IN_CONTAINER);
      } else if (tabIsSplitLocked(context, tab.logicalId)) {
        skip(TAB_CONTAINER_MOVE_REASONS.SPLIT_LOCKED);
      } else {
        const result = await replaceTabInContainer({
          browserAdapter: this.#browser,
          windowId,
          tab,
          cookieStoreId
        });
        if (result.moved) {
          moved.push({ logicalId: tab.logicalId, cookieStoreId });
        } else {
          skip(result.reason);
        }
      }
    }
    return { moved, reasonCounts };
  }

  // Replaced tabs keep logical identities the layout already holds, so a
  // pending reconcile re-materializes their pins, groups, and order. Only a
  // logical tab that final inventory shows in its target container counts.
  async #settleContainerReplacements(windowId, inventory, context, moved) {
    if (moved.length > 0) {
      await this.#reconciler.setPending(
        inventory.runtime,
        inventory.state.workspaces.map(({ id }) => id),
        context.windowRuntime,
        WORKSPACE_PENDING_OPERATION_KINDS.RECONCILE
      );
    }
    const finalInventory = await this.#reconciler.reconcile(windowId);
    const finalContext = requireRequestedContext(finalInventory);
    const finalByLogicalId = new Map(finalContext.tabs.map((tab) => [tab.logicalId, tab]));
    const verifiedCount = moved.filter(({ logicalId, cookieStoreId }) => {
      const tab = finalByLogicalId.get(logicalId);
      return tab !== undefined && tabUsesCookieStore(tab, cookieStoreId);
    }).length;
    return { finalInventory, finalContext, verifiedCount };
  }

  async #moveTabsToContainer(windowId, rawRequest) {
    if (!validWindowId(windowId)) throw invalidRequest();
    let request;
    try {
      request = parseTabContainerMoveRequest(rawRequest);
    } catch {
      throw invalidRequest();
    }
    if ((this.#browser.scope ?? "normal") === "private") {
      throw new ContainerError(CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE);
    }
    if (!this.#containerService) throw invalidRequest();
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    const context = requireMutableRequestedContext(inventory);
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const layout = context.windowRuntime.workspaceLayouts.find(
      ({ workspaceId }) => workspaceId === activeWorkspaceId
    );
    const tabByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab]));
    const requested = new Set(request.tabs.map(({ logicalTabId }) => logicalTabId));
    const sources = (layout?.tabIds ?? [])
      .filter((logicalId) => requested.has(logicalId))
      .map((logicalId) => tabByLogicalId.get(logicalId));
    if (
      sources.length !== request.tabs.length ||
      request.tabs.some(({ logicalTabId, firefoxTabId }) =>
        tabByLogicalId.get(logicalTabId)?.id !== firefoxTabId ||
        context.assignmentByTabId.get(logicalTabId) !== activeWorkspaceId
      )
    ) {
      throw invalidRequest();
    }
    const cookieStoreId = request.assignment.kind === "none"
      ? null
      : await this.#containerService.resolve(request.assignment.refId);

    const { moved, reasonCounts } = await this.#replaceTabsInContainers(
      windowId,
      context,
      sources.map((tab) => ({ tab, cookieStoreId }))
    );
    const { finalContext, verifiedCount } = await this.#settleContainerReplacements(
      windowId,
      inventory,
      context,
      moved
    );
    if (verifiedCount < moved.length) {
      reasonCounts.set(
        TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE,
        (reasonCounts.get(TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE) ?? 0) +
          moved.length - verifiedCount
      );
    }
    const reasons = Object.values(TAB_CONTAINER_MOVE_REASONS)
      .filter((reason) => reasonCounts.has(reason))
      .map((reason) => ({ reason, count: reasonCounts.get(reason) }));
    const failedCount = reasons
      .filter(({ reason }) => isFailedContainerMoveReason(reason))
      .reduce((total, { count }) => total + count, 0);
    const counts = {
      requestedCount: sources.length,
      movedCount: verifiedCount,
      skippedCount: sources.length - verifiedCount - failedCount,
      failedCount
    };
    return {
      view: this.#buildWorkspaceView(finalContext),
      outcome: parseTabContainerMoveOutcome({
        status: containerMoveStatus(counts),
        ...counts,
        reasons
      })
    };
  }

  // Imported tabs are created unloaded in the Settings window and hidden batch
  // by batch, because the workspace they join is never activated. An extension
  // stopped mid-import can therefore strand at most one batch, which ordinary
  // reconciliation adopts into the window's active workspace.
  async #importBookmarkWorkspace(windowId, mapping, batchSize, onProgress) {
    if (!validWindowId(windowId) || !Number.isInteger(batchSize) || batchSize < 1) {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
    }
    if ((this.#browser.scope ?? "normal") === "private") {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.PRIVATE_WINDOW);
    }
    const descriptors = bookmarkImportTabDescriptors(mapping);
    if (descriptors.length === 0) {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.NOTHING_TO_IMPORT);
    }
    let inventory;
    try {
      inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    } catch (error) {
      // The normal adapter refuses a private or unrecognized window before it
      // reads anything, and that scope guard is the only TypeError here.
      if (error instanceof TypeError) {
        throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.PRIVATE_WINDOW);
      }
      throw error;
    }
    requireMutableRequestedContext(inventory);
    if (
      inventory.state.workspaces.length >= MAX_WORKSPACES ||
      inventory.state.rail.length >= MAX_RAIL_ENTRIES
    ) {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.WORKSPACE_LIMIT);
    }

    const existingIds = new Set(inventory.state.workspaces.map(({ id }) => id));
    const nextState = await this.#stateService.createWorkspace({
      name: BOOKMARK_IMPORT_WORKSPACE.name,
      icon: BOOKMARK_IMPORT_WORKSPACE.icon,
      color: NEW_WORKSPACE_FIELDS.color
    });
    const workspaceId = nextState.workspaces
      .map(({ id }) => id)
      .find((id) => !existingIds.has(id));
    if (typeof workspaceId !== "string") {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR);
    }

    inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    const context = requireMutableRequestedContext(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    // Group identities are reserved before any tab exists so a partial import
    // keeps every created tab in the group its bookmark folder named.
    const groupIdByEntry = new Map();
    for (const [index, entry] of mapping.entries.entries()) {
      if (entry.kind === BOOKMARK_IMPORT_ENTRY_KINDS.GROUP) {
        groupIdByEntry.set(index, await this.#browser.createLogicalGroupId());
      }
    }

    let created = 0;
    let failed = 0;
    for (let start = 0; start < descriptors.length; start += batchSize) {
      const batch = descriptors.slice(start, start + batchSize);
      const results = await Promise.allSettled(batch.map(async (descriptor) => {
        const tab = await this.#browser.createTab(windowId, {
          url: descriptor.url,
          active: false,
          discarded: true,
          title: descriptor.title
        });
        return { descriptor, tab, logicalId: await this.#browser.getOrCreateTabIdentity(tab.id) };
      }));
      const createdTabIds = [];
      for (const result of results) {
        if (result.status !== "fulfilled") {
          failed += 1;
          continue;
        }
        const { descriptor, tab, logicalId } = result.value;
        inventory.runtime.tabs.push({ id: logicalId, workspaceId });
        const layout = placeTabInLayout(context.windowRuntime, workspaceId, logicalId);
        const groupId = groupIdByEntry.get(descriptor.entryIndex);
        if (groupId) {
          let group = layout.groups.find((entry) => entry.id === groupId);
          if (!group) {
            group = {
              id: groupId,
              title: mapping.entries[descriptor.entryIndex].title,
              color: "grey",
              collapsed: false,
              tabIds: []
            };
            layout.groups.push(group);
          }
          group.tabIds.push(logicalId);
        }
        createdTabIds.push(tab.id);
        created += 1;
      }
      await this.#runtimeService.save(inventory.runtime, workspaceIds);
      try {
        if (createdTabIds.length > 0) await this.#browser.hideTabs(createdTabIds);
      } catch {
        // Visibility has one owner: the reconcile below, and later events,
        // converge any tab Firefox refused to hide on this pass.
      }
      onProgress?.({ created, total: descriptors.length });
    }

    await this.#reconciler.setPending(
      inventory.runtime,
      workspaceIds,
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.RECONCILE
    );
    await this.#reconciler.reconcile(windowId);
    return parseBookmarkImportOutcome({
      workspaceId,
      workspaceName: BOOKMARK_IMPORT_WORKSPACE.name,
      requested: descriptors.length,
      created,
      unsupported: mapping.counts.unsupported,
      duplicate: mapping.counts.duplicate,
      failed
    });
  }

  async #ensureSettingsCompanion(windowId, settingsTabId) {
    if (!validWindowId(windowId) || !Number.isInteger(settingsTabId) || settingsTabId < 0) {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(windowId);
    const context = requireMutableRequestedContext(inventory);
    const settingsTab = context.tabs.find(({ id }) => id === settingsTabId);
    if (!settingsTab || settingsTab.active !== true || settingsTab.hidden === true) {
      throw invalidRequest();
    }
    if (context.tabs.some((tab) => tab.id !== settingsTabId && tab.hidden !== true)) {
      return false;
    }

    const createdTab = await this.#browser.createTab(windowId);
    const logicalId = await this.#browser.getOrCreateTabIdentity(createdTab.id);
    inventory.runtime.tabs.push({
      id: logicalId,
      workspaceId: context.windowRuntime.activeWorkspaceId
    });
    placeTabInLayout(
      context.windowRuntime,
      context.windowRuntime.activeWorkspaceId,
      logicalId
    );
    await this.#runtimeService.save(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id)
    );
    return true;
  }

  async #openSettings(windowId) {
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    const settingsTab = selectSettingsTab(await this.#browser.listSettingsTabs(), windowId);
    if (!settingsTab) {
      await this.#browser.focusWindow(windowId);
      await this.#browser.openSettingsPage(windowId);
      return false;
    }

    const inventory = await this.#reconciler.reconcile(settingsTab.windowId);
    const context = requireRequestedContext(inventory);
    const tab = context.tabs.find(({ id }) => id === settingsTab.id);
    const workspaceId = tab
      ? context.assignmentByTabId.get(tab.logicalId)
      : undefined;
    if (!tab || typeof workspaceId !== "string") {
      throw invalidRequest();
    }

    await this.#activateWorkspace(settingsTab.windowId, workspaceId);
    await this.#activateTab(settingsTab.windowId, tab.logicalId, settingsTab.id);
    await this.#browser.focusWindow(settingsTab.windowId);
    return true;
  }

  async #activateWorkspace(windowId, workspaceId, preferredTab = null) {
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(
      windowId,
      preferredTab === null ? undefined : { converge: false }
    );
    let context = requireMutableRequestedContext(inventory);
    const workspaceIds = inventory.state.workspaces.map((workspace) => workspace.id);
    const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));
    if (!workspaceOrder.has(workspaceId)) {
      throw invalidRequest();
    }
    if (context.windowRuntime.activeWorkspaceId === workspaceId) {
      if (preferredTab !== null) {
        return this.#activateTab(
          windowId,
          preferredTab.logicalTabId,
          preferredTab.firefoxTabId,
          { convergeBefore: false }
        );
      }
      return this.#buildWorkspaceView(context);
    }

    let createdTargetTab = false;
    let targetTabs = context.tabs
      .filter(({ logicalId }) => context.assignmentByTabId.get(logicalId) === workspaceId)
      .sort(compareTabs);
    if (targetTabs.length === 0) {
      if (preferredTab !== null) throw invalidRequest();
      const createdTab = await this.#createBrowserTabForWorkspace(
        windowId,
        inventory.state,
        workspaceId
      );
      const logicalId = await this.#browser.getOrCreateTabIdentity(createdTab.id);
      inventory.runtime.tabs.push({ id: logicalId, workspaceId });
      placeTabInLayout(context.windowRuntime, workspaceId, logicalId);
      targetTabs = [{ ...createdTab, logicalId }];
      createdTargetTab = true;
    }

    const targetLayout = context.windowRuntime.workspaceLayouts.find(
      (entry) => entry.workspaceId === workspaceId
    );
    const targetByLogicalId = new Map(targetTabs.map((tab) => [tab.logicalId, tab]));
    const rememberedTabId = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === workspaceId
    )?.tabId;
    const orderedTargetId = targetLayout
      ? orderedMaterializedTabIds(targetLayout).find((id) => targetByLogicalId.has(id))
      : undefined;
    const preferredTarget = preferredTab === null
      ? null
      : targetTabs.find(
        (tab) =>
          tab.logicalId === preferredTab.logicalTabId &&
          tab.id === preferredTab.firefoxTabId
      );
    if (preferredTab !== null && !preferredTarget) {
      throw invalidRequest();
    }
    const selectedTab = preferredTarget ??
      targetByLogicalId.get(rememberedTabId) ??
      targetByLogicalId.get(orderedTargetId) ??
      targetTabs[0];
    const priorWindowIntent = preferredTarget
      ? {
          activeWorkspaceId: context.windowRuntime.activeWorkspaceId,
          selectedTabs: structuredClone(context.windowRuntime.selectedTabs),
          pendingOperation: structuredClone(context.windowRuntime.pendingOperation)
        }
      : null;
    const priorActiveTab = preferredTarget
      ? context.tabs.find(
          (tab) =>
            tab.active === true &&
            context.assignmentByTabId.get(tab.logicalId) ===
              context.windowRuntime.activeWorkspaceId
        ) ?? null
      : null;

    if (createdTargetTab) {
      await this.#runtimeService.save(inventory.runtime, workspaceIds);
    }
    let preferredTargetActivationStarted = false;
    let preferredTargetActivationCommitted = false;
    try {
      if (preferredTarget) {
        await this.#requireExactWindowTab(
          windowId,
          preferredTarget.logicalId,
          preferredTarget.id
        );
        // Native split separation cannot be reversed through the Firefox API.
        // Complete the final exact-target check before changing that structure.
        await this.#requireExactWindowTab(
          windowId,
          preferredTarget.logicalId,
          preferredTarget.id
        );
        preferredTargetActivationStarted = true;
        await this.#browser.showTabs([preferredTarget.id]);
        await this.#browser.activateTab(preferredTarget.id);
        await this.#requireExactWindowTab(
          windowId,
          preferredTarget.logicalId,
          preferredTarget.id,
          { mustBeActive: true }
        );
        preferredTargetActivationCommitted = true;
        // Exact activation is now committed. If the tab disappears during the
        // later split separation, ordinary reconciliation owns that lifecycle
        // event instead of reclassifying this request as an untouched stale hit.
      }
      await this.#endNativeSplitsBeforeLeaving(
        context,
        context.windowRuntime.activeWorkspaceId,
        targetTabs
      );
    } catch (error) {
      if (
        preferredTarget &&
        preferredTargetActivationStarted &&
        !preferredTargetActivationCommitted
      ) {
        await this.#restorePrecommitExactActivation(
          windowId,
          priorActiveTab,
          preferredTarget
        );
      } else if (!preferredTarget || preferredTargetActivationCommitted) {
        await this.#reconciler.reconcile(windowId).catch(() => undefined);
      }
      throw error;
    }

    context.windowRuntime.activeWorkspaceId = workspaceId;
    rememberSelectedTab(
      inventory.runtime,
      context.windowRuntime,
      workspaceId,
      selectedTab.logicalId,
      workspaceOrder
    );
    try {
      await this.#reconciler.setPending(
        inventory.runtime,
        workspaceIds,
        context.windowRuntime,
        WORKSPACE_PENDING_OPERATION_KINDS.ACTIVATE
      );

      inventory = await this.#reconciler.reconcile(windowId);
    } catch (error) {
      if (priorWindowIntent) {
        await this.#restoreWindowIntent(windowId, priorWindowIntent).catch(() => undefined);
        throw invalidRequest();
      }
      throw error;
    }
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #restoreWindowIntent(windowId, priorIntent) {
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    const context = requireRequestedContext(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    const liveLogicalIds = new Set(context.tabs.map(({ logicalId }) => logicalId));
    context.windowRuntime.activeWorkspaceId = priorIntent.activeWorkspaceId;
    context.windowRuntime.selectedTabs = priorIntent.selectedTabs.filter(
      ({ workspaceId, tabId }) =>
        liveLogicalIds.has(tabId) &&
        context.assignmentByTabId.get(tabId) === workspaceId
    );
    context.windowRuntime.pendingOperation = priorIntent.pendingOperation;
    await this.#runtimeService.save(inventory.runtime, workspaceIds);
  }

  async #restorePrecommitExactActivation(windowId, priorActiveTab, targetTab) {
    if (priorActiveTab) {
      try {
        await this.#requireExactWindowTab(
          windowId,
          priorActiveTab.logicalId,
          priorActiveTab.id
        );
        await this.#browser.showTabs([priorActiveTab.id]);
        await this.#browser.activateTab(priorActiveTab.id);
      } catch {
        // Best effort: the original active tab can disappear during rollback.
      }
    }
    if (targetTab.hidden !== true) return;
    try {
      const liveTarget = await this.#browser.getTab(targetTab.id);
      if (liveTarget.windowId === windowId && liveTarget.active !== true) {
        await this.#browser.hideTabs([targetTab.id]);
      }
    } catch {
      // A target that disappeared after activation has no visibility to restore.
    }
  }

  async #requireExactWindowTab(
    windowId,
    logicalTabId,
    firefoxTabId,
    { mustBeActive = false } = {}
  ) {
    try {
      const tab = await this.#browser.getTab(firefoxTabId);
      if (tab.windowId !== windowId) throw invalidRequest();
      const currentLogicalId = await this.#browser.getTabIdentity(firefoxTabId);
      if (
        currentLogicalId !== logicalTabId ||
        (mustBeActive && tab.active !== true)
      ) {
        throw invalidRequest();
      }
      return tab;
    } catch (error) {
      if (error instanceof WorkspaceStateError) throw error;
      throw invalidRequest();
    }
  }

  async #activateTab(
    windowId,
    logicalTabId,
    firefoxTabId,
    { convergeBefore = true } = {}
  ) {
    if (
      !validWindowId(windowId) ||
      typeof logicalTabId !== "string" ||
      !Number.isInteger(firefoxTabId) ||
      firefoxTabId < 0
    ) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(
      windowId,
      convergeBefore ? undefined : { converge: false }
    );
    let context = requireMutableRequestedContext(inventory);
    const tab = context.tabs.find(
      (entry) => entry.logicalId === logicalTabId && entry.id === firefoxTabId
    );
    if (
      !tab ||
      context.assignmentByTabId.get(logicalTabId) !==
        context.windowRuntime.activeWorkspaceId
    ) {
      throw invalidRequest();
    }
    const exactSearchActivation = convergeBefore === false;
    const priorActiveTab = exactSearchActivation
      ? context.tabs.find((entry) => entry.active === true) ?? null
      : null;
    let exactActivationStarted = false;
    let exactActivationCommitted = false;
    try {
      await this.#requireExactWindowTab(windowId, logicalTabId, firefoxTabId);
      // Showing a discarded hidden tab is observable browser state. Finish the
      // final exact-target check before revealing it.
      await this.#requireExactWindowTab(windowId, logicalTabId, firefoxTabId);
      exactActivationStarted = exactSearchActivation;
      await this.#browser.showTabs([firefoxTabId]);
      await this.#browser.activateTab(firefoxTabId);
      if (exactSearchActivation) {
        await this.#requireExactWindowTab(
          windowId,
          logicalTabId,
          firefoxTabId,
          { mustBeActive: true }
        );
        exactActivationCommitted = true;
      }
    } catch {
      if (exactActivationStarted && !exactActivationCommitted) {
        await this.#restorePrecommitExactActivation(windowId, priorActiveTab, tab);
      }
      throw invalidRequest();
    }
    if (exactActivationCommitted) {
      // Once exact activation is observed, later disappearance is a browser
      // lifecycle event. Let ordinary reconciliation select a live fallback.
      inventory = await this.#reconciler.reconcile(windowId);
      context = requireRequestedContext(inventory);
      return this.#buildWorkspaceView(context);
    }
    inventory = await this.#reconciler.reconcile(
      windowId,
      convergeBefore ? undefined : { converge: false }
    );
    context = requireRequestedContext(inventory);
    const activated = context.tabs.find(
      (entry) =>
        entry.logicalId === logicalTabId &&
        entry.id === firefoxTabId &&
        entry.active === true
    );
    if (!activated) throw invalidRequest();
    await this.#requireExactWindowTab(
      windowId,
      logicalTabId,
      firefoxTabId,
      { mustBeActive: true }
    );
    return this.#buildWorkspaceView(context);
  }

  async #activateSearchResult(windowId, workspaceId, logicalTabId, firefoxTabId) {
    if (
      !validWindowId(windowId) ||
      typeof workspaceId !== "string" ||
      typeof logicalTabId !== "string" ||
      !Number.isInteger(firefoxTabId) ||
      firefoxTabId < 0
    ) {
      throw invalidRequest();
    }
    // A recorded pending operation is recoverable intent, not a lock: this
    // controller is serialized, and every sidebar view load already retries
    // convergence. One that remains means Firefox refused part of a layout, so
    // refusing here would block search activation indefinitely. The exact
    // activation below still converges afterwards and restores the prior intent
    // if its pre-commit checks fail.
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    const context = requireRequestedContext(inventory);
    const exactTab = context.tabs.find(
      (tab) => tab.logicalId === logicalTabId && tab.id === firefoxTabId
    );
    if (!exactTab || context.assignmentByTabId.get(logicalTabId) !== workspaceId) {
      throw invalidRequest();
    }
    await this.#requireExactWindowTab(windowId, logicalTabId, firefoxTabId);
    if (context.windowRuntime.activeWorkspaceId === workspaceId) {
      return this.#activateTab(
        windowId,
        logicalTabId,
        firefoxTabId,
        { convergeBefore: false }
      );
    }
    return this.#activateWorkspace(windowId, workspaceId, {
      logicalTabId,
      firefoxTabId
    });
  }

  async #relocateTabs(windowId, sources, destination) {
    const validSource = (source) =>
      isRecord(source) &&
      hasExactKeys(source, ["tabId", "workspaceId", "pinned", "groupId", "parentTabId"]) &&
      typeof source.tabId === "string" &&
      typeof source.workspaceId === "string" &&
      typeof source.pinned === "boolean" &&
      (source.groupId === null || typeof source.groupId === "string") &&
      (source.parentTabId === null || typeof source.parentTabId === "string");
    const validDestination =
      isRecord(destination) &&
      hasExactKeys(destination, [
        "workspaceId",
        "zone",
        "relation",
        "anchorTabId",
        "groupId",
        "parentTabId"
      ]) &&
      typeof destination.workspaceId === "string" &&
      ["pinned", "ungrouped", "group"].includes(destination.zone) &&
      ["before", "after", "end", "inside"].includes(destination.relation) &&
      (destination.anchorTabId === null || typeof destination.anchorTabId === "string") &&
      (destination.groupId === null || typeof destination.groupId === "string") &&
      (destination.parentTabId === null || typeof destination.parentTabId === "string");
    if (
      !validWindowId(windowId) ||
      !Array.isArray(sources) ||
      sources.length === 0 ||
      sources.some((source) => !validSource(source)) ||
      new Set(sources.map(({ tabId }) => tabId)).size !== sources.length ||
      !validDestination
    ) {
      throw invalidRequest();
    }

    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));
    if (!workspaceIds.includes(destination.workspaceId)) {
      throw invalidRequest();
    }
    if (destinationWouldSplitLockedPair(context, destination)) {
      throw invalidRequest();
    }
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const sourceLayout = context.windowRuntime.workspaceLayouts.find(
      (layout) => layout.workspaceId === activeWorkspaceId
    );
    if (!sourceLayout || sources.some(({ workspaceId }) => workspaceId !== activeWorkspaceId)) {
      throw invalidRequest();
    }
    const pinSet = new Set(sourceLayout.pinnedTabIds);
    const groupByTabId = new Map();
    for (const group of sourceLayout.groups) {
      for (const tabId of group.tabIds) {
        groupByTabId.set(tabId, group.id);
      }
    }
    const nodeByTabId = new Map(sourceLayout.tree.map((node) => [node.tabId, node]));
    if (
      sources.some(
        (source) =>
          !sourceLayout.tabIds.includes(source.tabId) ||
          pinSet.has(source.tabId) !== source.pinned ||
          (groupByTabId.get(source.tabId) ?? null) !== source.groupId ||
          (nodeByTabId.get(source.tabId)?.parentTabId ?? null) !== source.parentTabId
      )
    ) {
      throw invalidRequest();
    }

    if (sources.some(({ tabId }) => tabIsSplitLocked(context, tabId))) {
      throw invalidRequest();
    }
    const movingIds = new Set(sources.map(({ tabId }) => tabId));
    // Sidebar moves carry whole trees. A set missing a descendant came from a
    // stale view; only pinning may still leave children behind.
    if (destination.zone !== "pinned" && !isDescendantClosed(sourceLayout, [...movingIds])) {
      throw invalidRequest();
    }
    const previewRuntime = structuredClone(inventory.runtime);
    const previewWindowRuntime = previewRuntime.windows.find(
      ({ id }) => id === context.windowRuntime.id
    );
    if (!relocateLogicalTabs({
      runtime: previewRuntime,
      windowRuntime: previewWindowRuntime,
      tabIds: [...movingIds],
      destination
    })) {
      throw invalidRequest();
    }
    const activeMember = context.tabs.find(
      (tab) => movingIds.has(tab.logicalId) && tab.active === true
    );
    let replacement = null;
    if (activeMember && destination.workspaceId !== activeWorkspaceId) {
      replacement = await this.#resolveSourceReplacement(
        inventory,
        context,
        activeWorkspaceId,
        movingIds
      );
    }
    const move = relocateLogicalTabs({
      runtime: inventory.runtime,
      windowRuntime: context.windowRuntime,
      tabIds: [...movingIds],
      destination
    });
    if (!move) {
      throw invalidRequest();
    }

    removeSelectionsForTabs(inventory.runtime, movingIds);
    if (replacement) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        activeWorkspaceId,
        replacement.logicalId,
        workspaceOrder
      );
    }
    const destinationSelection = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === destination.workspaceId
    );
    if (activeMember || !destinationSelection) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        destination.workspaceId,
        activeMember?.logicalId ?? move.tabIds[0],
        workspaceOrder
      );
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      workspaceIds,
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.RELOCATE_TABS
    );
    if (replacement) {
      try {
        await this.#browser.activateTab(replacement.id);
      } catch {
        // The pending operation will retry the logical selection during reconciliation.
      }
    }
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return {
      view: this.#buildWorkspaceView(context),
      outcome: buildMoveOutcome(
        WORKSPACE_PENDING_OPERATION_KINDS.RELOCATE_TABS,
        movingIds.size,
        context
      )
    };
  }

  async #createTabGroup(windowId, logicalTabIds) {
    if (
      !validWindowId(windowId) ||
      !Array.isArray(logicalTabIds) ||
      logicalTabIds.length === 0 ||
      logicalTabIds.some((tabId) => typeof tabId !== "string") ||
      new Set(logicalTabIds).size !== logicalTabIds.length
    ) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const requested = new Set(logicalTabIds);
    const activeLayout = context.windowRuntime.workspaceLayouts.find(
      ({ workspaceId }) => workspaceId === context.windowRuntime.activeWorkspaceId
    );
    const layoutOrder = new Map((activeLayout?.tabIds ?? []).map((tabId, index) => [tabId, index]));
    const tabs = context.tabs
      .filter((tab) => requested.has(tab.logicalId))
      .sort((left, right) =>
        (layoutOrder.get(left.logicalId) ?? Number.MAX_SAFE_INTEGER) -
          (layoutOrder.get(right.logicalId) ?? Number.MAX_SAFE_INTEGER) ||
        compareTabs(left, right)
      );
    // A group keeps selected trees whole, so the request must already include
    // every nested tab; Firefox then groups them in tree order.
    if (
      tabs.length !== requested.size ||
      !activeLayout ||
      !isDescendantClosed(activeLayout, logicalTabIds) ||
      tabs.some((tab) =>
        context.assignmentByTabId.get(tab.logicalId) !== context.windowRuntime.activeWorkspaceId ||
        tabIsSplitLocked(context, tab.logicalId)
      )
    ) {
      throw invalidRequest();
    }
    const nativeGroupId = await this.#browser.createTabGroup(
      tabs.map(({ id }) => id),
      windowId
    );
    if (!Number.isInteger(nativeGroupId) || nativeGroupId < 0) {
      throw invalidRequest();
    }
    await this.#browser.updateTabGroup(nativeGroupId, {
      title: "",
      color: "grey",
      collapsed: false
    });
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #unloadTabs(windowId, logicalTabIds) {
    if (
      !validWindowId(windowId) ||
      !Array.isArray(logicalTabIds) ||
      logicalTabIds.length === 0 ||
      logicalTabIds.some((tabId) => typeof tabId !== "string") ||
      new Set(logicalTabIds).size !== logicalTabIds.length
    ) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    let context = requireMutableRequestedContext(inventory);
    const requested = new Set(logicalTabIds);
    const tabs = context.tabs.filter((tab) => requested.has(tab.logicalId));
    if (
      tabs.length !== requested.size ||
      tabs.some((tab) =>
        context.assignmentByTabId.get(tab.logicalId) !== context.windowRuntime.activeWorkspaceId
      )
    ) {
      throw invalidRequest();
    }
    const loadedTabs = tabs.filter(({ discarded }) => discarded !== true);
    const activeTab = loadedTabs.find(({ active }) => active === true);
    if (activeTab) {
      const workspaceId = context.windowRuntime.activeWorkspaceId;
      const layout = context.windowRuntime.workspaceLayouts.find(
        (entry) => entry.workspaceId === workspaceId
      );
      const liveByLogicalId = new Map(
        context.tabs.map((tab) => [tab.logicalId, tab])
      );
      const orderedIds = layout
        ? orderedMaterializedTabIds(layout)
        : context.tabs
            .filter((tab) => context.assignmentByTabId.get(tab.logicalId) === workspaceId)
            .sort(compareTabs)
            .map((tab) => tab.logicalId);
      const loadedReplacementId = orderedIds.find((logicalId) => {
        const candidate = liveByLogicalId.get(logicalId);
        return candidate && !requested.has(logicalId) && candidate.discarded !== true;
      });
      const activeIndex = orderedIds.indexOf(activeTab.logicalId);
      const ladderReplacementId = loadedReplacementId === undefined && activeIndex >= 0
        ? orderedIds
            .slice(activeIndex + 1)
            .find((logicalId) => liveByLogicalId.has(logicalId) && !requested.has(logicalId))
        : undefined;
      const replacement = liveByLogicalId.get(loadedReplacementId ?? ladderReplacementId);

      if (replacement) {
        rememberSelectedTab(
          inventory.runtime,
          context.windowRuntime,
          workspaceId,
          replacement.logicalId,
          new Map(inventory.state.workspaces.map(({ id }, index) => [id, index]))
        );
        await this.#runtimeService.save(
          inventory.runtime,
          inventory.state.workspaces.map(({ id }) => id)
        );
        await this.#browser.activateTab(replacement.id);
      } else {
        const railWorkspaceIds = inventory.state.rail
          .filter((entry) => entry.kind === "workspace")
          .map((entry) => entry.workspaceId);
        const workspaceIndex = railWorkspaceIds.indexOf(workspaceId);
        if (workspaceIndex >= 0 && railWorkspaceIds.length > 1) {
          const successorWorkspaceId = railWorkspaceIds[
            (workspaceIndex + 1) % railWorkspaceIds.length
          ];
          await this.#activateWorkspace(windowId, successorWorkspaceId);
        } else {
          const fallback = await this.#resolveSourceReplacement(
            inventory,
            context,
            workspaceId,
            requested
          );
          rememberSelectedTab(
            inventory.runtime,
            context.windowRuntime,
            workspaceId,
            fallback.logicalId,
            new Map(inventory.state.workspaces.map(({ id }, index) => [id, index]))
          );
          await this.#runtimeService.save(
            inventory.runtime,
            inventory.state.workspaces.map(({ id }) => id)
          );
          await this.#browser.activateTab(fallback.id);
        }
      }
    }
    const results = await Promise.allSettled(
      loadedTabs.map(({ id }) => this.#browser.discardTab(id))
    );
    if (results.some(({ status }) => status === "rejected")) {
      throw invalidRequest();
    }
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  #storeClosePreflight(inventory, windowId, target, options = {}) {
    const details = deriveCloseTarget(inventory, target, options);
    const token = `close-${this.#createUuid()}`.toLowerCase();
    this.#closePreflights.clear();
    this.#closePreflights.set(token, {
      windowId,
      scope: this.#browser.scope ?? "normal",
      target: details.target,
      targetLabel: details.targetLabel,
      fingerprint: details.fingerprint,
      targetTabs: details.targetTabs.map((tab) => ({ ...tab }))
    });
    return parseTabClosePreflight({
      token,
      target: details.target,
      targetLabel: details.targetLabel,
      scope: this.#browser.scope ?? "normal",
      tabCount: details.targetTabs.length,
      fingerprint: details.fingerprint
    });
  }

  async #prepareCloseTabs(windowId, target) {
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    let parsedTarget;
    try {
      parsedTarget = parseTabCloseTarget(target);
    } catch {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    return this.#storeClosePreflight(inventory, windowId, parsedTarget);
  }

  async #captureCloseSafety(inventory) {
    const settings = await this.#settingsService?.getOrInitialize();
    if ((this.#browser.scope ?? "normal") === "private") {
      if (
        settings?.privacy.keepPrivateTabsBetweenSessions === true &&
        typeof this.#snapshotService?.captureRecoveryFromInventory === "function"
      ) {
        await this.#snapshotService.captureRecoveryFromInventory(inventory);
      }
      return;
    }
    if (!settings || typeof this.#snapshotService?.createFromInventory !== "function") {
      throw new Error("Workspace close safety storage is unavailable.");
    }
    await this.#snapshotService.createFromInventory(inventory, settings, {
      kind: SNAPSHOT_KINDS.SAFETY,
      reason: "workspace-tab-close"
    });
  }

  async #ensureCloseSuccessors(inventory, targetTabs, requestedWindowId) {
    const targetIds = new Set(targetTabs.map(({ id }) => id));
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));
    const railWorkspaceIds = inventory.state.rail
      .filter(({ kind }) => kind === "workspace")
      .map(({ workspaceId }) => workspaceId);
    const targetWorkspaceId = targetTabs.length > 0
      ? [...inventory.contexts.values()]
          .map((context) => context.assignmentByTabId.get(targetTabs[0].logicalId))
          .find(Boolean)
      : null;
    const activations = [];
    let runtimeChanged = false;
    let replacementCount = 0;

    for (const context of inventory.contexts.values()) {
      const windowTargets = context.tabs.filter(({ id }) => targetIds.has(id));
      if (windowTargets.length === 0) {
        continue;
      }
      const active = context.tabs.find((tab) => tab.active === true);
      const surviving = context.tabs
        .filter(({ id }) => !targetIds.has(id))
        .sort((left, right) =>
          Number(left.hidden === true) - Number(right.hidden === true) ||
          Number(left.discarded === true) - Number(right.discarded === true) ||
          compareTabs(left, right)
        );
      if (active && !targetIds.has(active.id)) {
        continue;
      }

      let successor = surviving[0] ?? null;
      let successorWorkspaceId = successor
        ? context.assignmentByTabId.get(successor.logicalId)
        : null;
      if (!successor) {
        const targetIndex = railWorkspaceIds.indexOf(targetWorkspaceId);
        successorWorkspaceId = railWorkspaceIds.length > 1 && targetIndex >= 0
          ? railWorkspaceIds[(targetIndex + 1) % railWorkspaceIds.length]
          : targetWorkspaceId ?? context.windowRuntime.activeWorkspaceId;
        const created = await this.#createBrowserTabForWorkspace(
          context.windowId,
          inventory.state,
          successorWorkspaceId,
          { active: false }
        );
        const logicalId = await this.#browser.getOrCreateTabIdentity(created.id);
        inventory.runtime.tabs.push({ id: logicalId, workspaceId: successorWorkspaceId });
        placeTabInLayout(
          context.windowRuntime,
          successorWorkspaceId,
          logicalId
        );
        successor = { ...created, logicalId };
        replacementCount += 1;
        runtimeChanged = true;
      }
      if (!successorWorkspaceId) {
        throw invalidRequest();
      }
      context.windowRuntime.activeWorkspaceId = successorWorkspaceId;
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        successorWorkspaceId,
        successor.logicalId,
        workspaceOrder
      );
      this.#reconciler.markPending(
        context.windowRuntime,
        WORKSPACE_PENDING_OPERATION_KINDS.RECONCILE
      );
      runtimeChanged = true;
      activations.push(successor);
    }

    if (runtimeChanged) {
      await this.#runtimeService.save(inventory.runtime, workspaceIds);
    }
    for (const successor of activations) {
      if (successor.hidden === true) {
        await this.#browser.showTabs([successor.id]);
      }
      await this.#browser.activateTab(successor.id);
    }
    if (runtimeChanged) {
      inventory = await this.#reconciler.reconcile(requestedWindowId);
    }
    return { inventory, replacementCount };
  }

  async #removeConfirmedTabs(
    inventory,
    windowId,
    target,
    targetLabel,
    targetTabs,
    replacementCount
  ) {
    if (targetTabs.length > 0) {
      try {
        await this.#browser.removeTabs(targetTabs.map(({ id }) => id));
      } catch {
        // Firefox may reject after a page-owned unload prompt or after closing only a subset.
      }
    }
    const finalInventory = await this.#reconciler.reconcile(windowId);
    const context = requireRequestedContext(finalInventory);
    return {
      view: this.#buildWorkspaceView(context),
      outcome: buildCloseOutcome({
        target,
        targetLabel,
        scope: this.#browser.scope ?? "normal",
        targetTabs,
        finalInventory,
        replacementCount
      })
    };
  }

  async #closeTabs(windowId, token) {
    if (!validWindowId(windowId) || typeof token !== "string") {
      throw invalidRequest();
    }
    const prepared = this.#closePreflights.get(token);
    this.#closePreflights.delete(token);
    if (
      !prepared ||
      prepared.windowId !== windowId ||
      prepared.scope !== (this.#browser.scope ?? "normal")
    ) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    const current = deriveCloseTarget(inventory, prepared.target, {
      allowMissing: true,
      fallbackLabel: prepared.targetLabel
    });
    if (
      current.fingerprint !== prepared.fingerprint ||
      !sameCloseTargets(prepared.targetTabs, current.targetTabs)
    ) {
      return {
        view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
        outcome: buildCloseOutcome({
          target: prepared.target,
          targetLabel: prepared.targetLabel,
          scope: this.#browser.scope ?? "normal",
          targetTabs: prepared.targetTabs,
          finalInventory: inventory,
          replacementCount: 0,
          stale: true
        }),
        preflight: this.#storeClosePreflight(
          inventory,
          windowId,
          prepared.target,
          { allowMissing: true, fallbackLabel: current.targetLabel }
        )
      };
    }
    if (prepared.targetTabs.length === 0) {
      return this.#removeConfirmedTabs(
        inventory,
        windowId,
        prepared.target,
        prepared.targetLabel,
        prepared.targetTabs,
        0
      );
    }
    if (prepared.targetTabs.length > 1) {
      await this.#captureCloseSafety(inventory);
    }
    const protectedResult = await this.#ensureCloseSuccessors(
      inventory,
      current.targetTabs,
      windowId
    );
    inventory = protectedResult.inventory;
    return this.#removeConfirmedTabs(
      inventory,
      windowId,
      prepared.target,
      current.targetLabel,
      current.targetTabs,
      protectedResult.replacementCount
    );
  }

  async #relocateNativeSelection(windowId, tabs, destinationWorkspaceId) {
    const validTab = (tab) =>
      isRecord(tab) &&
      hasExactKeys(tab, ["logicalTabId", "firefoxTabId"]) &&
      typeof tab.logicalTabId === "string" &&
      Number.isInteger(tab.firefoxTabId) &&
      tab.firefoxTabId >= 0;
    if (
      !validWindowId(windowId) ||
      !Array.isArray(tabs) ||
      tabs.length === 0 ||
      tabs.some((tab) => !validTab(tab)) ||
      new Set(tabs.map(({ logicalTabId }) => logicalTabId)).size !== tabs.length ||
      new Set(tabs.map(({ firefoxTabId }) => firefoxTabId)).size !== tabs.length ||
      typeof destinationWorkspaceId !== "string"
    ) {
      throw invalidRequest();
    }

    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    if (
      !workspaceIds.includes(destinationWorkspaceId) ||
      destinationWorkspaceId === activeWorkspaceId
    ) {
      throw invalidRequest();
    }
    const sourceLayout = context.windowRuntime.workspaceLayouts.find(
      (layout) => layout.workspaceId === activeWorkspaceId
    );
    if (!sourceLayout) {
      throw invalidRequest();
    }

    const suppliedFirefoxIds = new Set(tabs.map(({ firefoxTabId }) => firefoxTabId));
    const highlightedTabs = context.tabs.filter(({ highlighted }) => highlighted === true);
    if (
      highlightedTabs.length !== tabs.length ||
      highlightedTabs.some(({ id }) => !suppliedFirefoxIds.has(id))
    ) {
      throw invalidRequest();
    }
    const liveByFirefoxId = new Map(context.tabs.map((tab) => [tab.id, tab]));
    if (
      tabs.some(({ logicalTabId, firefoxTabId }) => {
        const live = liveByFirefoxId.get(firefoxTabId);
        return (
          !live ||
          live.logicalId !== logicalTabId ||
          context.assignmentByTabId.get(logicalTabId) !== activeWorkspaceId ||
          !sourceLayout.tabIds.includes(logicalTabId)
        );
      })
    ) {
      throw invalidRequest();
    }

    if (tabs.some(({ logicalTabId }) => tabIsSplitLocked(context, logicalTabId))) {
      throw invalidRequest();
    }
    const movingIds = new Set(tabs.map(({ logicalTabId }) => logicalTabId));
    const previewRuntime = structuredClone(inventory.runtime);
    const previewWindowRuntime = previewRuntime.windows.find(
      ({ id }) => id === context.windowRuntime.id
    );
    if (!relocateLogicalSelection({
      runtime: previewRuntime,
      windowRuntime: previewWindowRuntime,
      tabIds: [...movingIds],
      sourceWorkspaceId: activeWorkspaceId,
      destinationWorkspaceId
    })) {
      throw invalidRequest();
    }

    const activeMember = context.tabs.find(
      (tab) => movingIds.has(tab.logicalId) && tab.active === true
    );
    let replacement = null;
    if (activeMember) {
      replacement = await this.#resolveSourceReplacement(
        inventory,
        context,
        activeWorkspaceId,
        movingIds
      );
    }
    const move = relocateLogicalSelection({
      runtime: inventory.runtime,
      windowRuntime: context.windowRuntime,
      tabIds: [...movingIds],
      sourceWorkspaceId: activeWorkspaceId,
      destinationWorkspaceId
    });
    if (!move) {
      throw invalidRequest();
    }

    removeSelectionsForTabs(inventory.runtime, movingIds);
    if (replacement) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        activeWorkspaceId,
        replacement.logicalId,
        workspaceOrder
      );
    }
    const destinationSelection = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === destinationWorkspaceId
    );
    if (activeMember || !destinationSelection) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        destinationWorkspaceId,
        activeMember?.logicalId ?? move.tabIds[0],
        workspaceOrder
      );
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      workspaceIds,
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.RELOCATE_TABS
    );
    if (replacement) {
      try {
        await this.#browser.activateTab(replacement.id);
      } catch {
        // The pending operation will retry the logical selection during reconciliation.
      }
    }
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return {
      view: this.#buildWorkspaceView(context),
      outcome: buildMoveOutcome(
        WORKSPACE_PENDING_OPERATION_KINDS.RELOCATE_TABS,
        movingIds.size,
        context
      )
    };
  }

  async #setTreeCollapsed(windowId, logicalTabId, collapsed) {
    if (!validWindowId(windowId) || typeof logicalTabId !== "string" || typeof collapsed !== "boolean") {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireRequestedContext(inventory);
    const layout = context.windowRuntime.workspaceLayouts.find(
      (entry) => entry.workspaceId === context.windowRuntime.activeWorkspaceId
    );
    if (!layout || !setLogicalTreeCollapsed(layout, logicalTabId, collapsed)) {
      throw invalidRequest();
    }
    await this.#runtimeService.save(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id)
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  // Tree nesting is extension-owned layout, so flattening needs no Firefox
  // tab call. Every exact logical/Firefox pair must still be live in the
  // window's active workspace; a stale target changes nothing. Each target
  // that still has nested tabs is flattened, so the order of targets never
  // changes the result: an ancestor's flatten also covers its descendants.
  async #flattenTreeBranch(windowId, targets) {
    const validTarget = (target) =>
      isRecord(target) &&
      hasExactKeys(target, ["logicalTabId", "firefoxTabId"]) &&
      typeof target.logicalTabId === "string" &&
      Number.isInteger(target.firefoxTabId) &&
      target.firefoxTabId >= 0;
    if (
      !validWindowId(windowId) ||
      !Array.isArray(targets) ||
      targets.length === 0 ||
      targets.length > MAX_TAB_BATCH_SIZE ||
      targets.some((target) => !validTarget(target)) ||
      new Set(targets.map(({ logicalTabId }) => logicalTabId)).size !== targets.length
    ) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    let context = requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const layout = context.windowRuntime.workspaceLayouts.find(
      ({ workspaceId }) => workspaceId === activeWorkspaceId
    );
    if (
      !layout ||
      targets.some(({ logicalTabId, firefoxTabId }) =>
        context.tabs.find(({ logicalId }) => logicalId === logicalTabId)?.id !== firefoxTabId ||
        context.assignmentByTabId.get(logicalTabId) !== activeWorkspaceId
      )
    ) {
      throw invalidRequest();
    }
    const flattenedCount = targets.filter(({ logicalTabId }) =>
      flattenLogicalTreeBranch(layout, logicalTabId) !== null
    ).length;
    if (flattenedCount === 0) {
      throw invalidRequest();
    }
    await this.#runtimeService.save(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id)
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #relocateGroup(windowId, source, destination) {
    if (
      !validWindowId(windowId) ||
      !isRecord(source) ||
      !hasExactKeys(source, ["groupId", "workspaceId", "tabIds"]) ||
      typeof source.groupId !== "string" ||
      typeof source.workspaceId !== "string" ||
      !Array.isArray(source.tabIds) ||
      source.tabIds.length === 0 ||
      source.tabIds.some((tabId) => typeof tabId !== "string") ||
      new Set(source.tabIds).size !== source.tabIds.length ||
      !isRecord(destination) ||
      !hasExactKeys(destination, ["workspaceId", "relation", "anchorTabId"]) ||
      typeof destination.workspaceId !== "string" ||
      !["before", "after", "end"].includes(destination.relation) ||
      (destination.anchorTabId !== null && typeof destination.anchorTabId !== "string")
    ) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const sourceLayout = context.windowRuntime.workspaceLayouts.find(
      (layout) => layout.workspaceId === activeWorkspaceId
    );
    const group = sourceLayout?.groups.find(({ id }) => id === source.groupId);
    if (
      source.workspaceId !== activeWorkspaceId ||
      !workspaceIds.includes(destination.workspaceId) ||
      destinationWouldSplitLockedPair(context, {
        ...destination,
        parentTabId: null
      }) ||
      !group ||
      group.tabIds.length !== source.tabIds.length ||
      group.tabIds.some((tabId, index) => tabId !== source.tabIds[index])
    ) {
      throw invalidRequest();
    }
    const memberIds = new Set(source.tabIds);
    if (source.tabIds.some((tabId) => tabIsSplitLocked(context, tabId))) {
      throw invalidRequest();
    }
    const previewRuntime = structuredClone(inventory.runtime);
    const previewWindowRuntime = previewRuntime.windows.find(
      ({ id }) => id === context.windowRuntime.id
    );
    if (!relocateLogicalGroup({
      runtime: previewRuntime,
      windowRuntime: previewWindowRuntime,
      groupId: source.groupId,
      sourceWorkspaceId: source.workspaceId,
      memberTabIds: source.tabIds,
      destination
    })) {
      throw invalidRequest();
    }
    const activeMember = context.tabs.find(
      (tab) => memberIds.has(tab.logicalId) && tab.active === true
    );
    let replacement = null;
    if (activeMember && destination.workspaceId !== activeWorkspaceId) {
      replacement = await this.#resolveSourceReplacement(
        inventory,
        context,
        activeWorkspaceId,
        memberIds
      );
    }
    const move = relocateLogicalGroup({
      runtime: inventory.runtime,
      windowRuntime: context.windowRuntime,
      groupId: source.groupId,
      sourceWorkspaceId: source.workspaceId,
      memberTabIds: source.tabIds,
      destination
    });
    if (!move) {
      throw invalidRequest();
    }
    removeSelectionsForTabs(inventory.runtime, memberIds);
    if (replacement) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        activeWorkspaceId,
        replacement.logicalId,
        workspaceOrder
      );
    }
    const destinationSelection = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === destination.workspaceId
    );
    if (activeMember || !destinationSelection) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        destination.workspaceId,
        activeMember?.logicalId ?? source.tabIds[0],
        workspaceOrder
      );
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      workspaceIds,
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.MOVE_GROUP
    );
    if (replacement) {
      try {
        await this.#browser.activateTab(replacement.id);
      } catch {
        // The pending operation will retry the logical selection during reconciliation.
      }
    }
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return {
      view: this.#buildWorkspaceView(context),
      outcome: buildMoveOutcome(
        WORKSPACE_PENDING_OPERATION_KINDS.MOVE_GROUP,
        source.tabIds.length,
        context
      )
    };
  }

  async #setGroupCollapsed(windowId, logicalGroupId, collapsed) {
    if (!validWindowId(windowId) || typeof logicalGroupId !== "string" || typeof collapsed !== "boolean") {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const activeLayout = context.windowRuntime.workspaceLayouts.find(
      (entry) => entry.workspaceId === context.windowRuntime.activeWorkspaceId
    );
    if (
      !activeLayout?.groups.some(({ id }) => id === logicalGroupId) ||
      !setLogicalGroupCollapsed(context.windowRuntime, logicalGroupId, collapsed)
    ) {
      throw invalidRequest();
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id),
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.UPDATE_GROUP
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #renameGroup(windowId, logicalGroupId, requestedTitle) {
    if (
      !validWindowId(windowId) ||
      typeof logicalGroupId !== "string" ||
      typeof requestedTitle !== "string" ||
      requestedTitle.length > MAX_GROUP_TITLE_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(requestedTitle)
    ) {
      throw invalidRequest();
    }
    const title = requestedTitle.trim();
    let inventory = await this.#reconciler.reconcile(windowId);
    let context = requireMutableRequestedContext(inventory);
    const activeLayout = context.windowRuntime.workspaceLayouts.find(
      (entry) => entry.workspaceId === context.windowRuntime.activeWorkspaceId
    );
    const group = activeLayout?.groups.find(({ id }) => id === logicalGroupId);
    if (!group) {
      throw invalidRequest();
    }
    if (group.title === title) {
      return this.#buildWorkspaceView(context);
    }
    if (!setLogicalGroupTitle(context.windowRuntime, logicalGroupId, title)) {
      throw invalidRequest();
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id),
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.UPDATE_GROUP
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #deleteGroup(windowId, logicalGroupId) {
    if (!validWindowId(windowId) || typeof logicalGroupId !== "string") {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    let context = requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    const layout = context.windowRuntime.workspaceLayouts.find(
      ({ workspaceId }) => workspaceId === context.windowRuntime.activeWorkspaceId
    );
    const group = layout?.groups.find(({ id }) => id === logicalGroupId);
    if (
      !group ||
      group.tabIds.some((tabId) =>
        layout.splitViews.some((splitView) => splitView.tabIds.includes(tabId))
      ) ||
      !deleteLogicalGroup(
        context.windowRuntime,
        context.windowRuntime.activeWorkspaceId,
        logicalGroupId
      )
    ) {
      throw invalidRequest();
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      inventory.state.workspaces.map(({ id }) => id),
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.UPDATE_GROUP
    );
    inventory = await this.#reconciler.reconcile(windowId);
    context = requireRequestedContext(inventory);
    return this.#buildWorkspaceView(context);
  }

  async #getMoveMenuContext(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw invalidRequest();
    }
    let tab;
    try {
      tab = await this.#browser.getTab(tabId);
    } catch {
      throw invalidRequest();
    }
    if (!validWindowId(tab?.windowId)) {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(tab.windowId);
    const context = requireMutableRequestedContext(inventory);
    const logicalTab = context.tabs.find((entry) => entry.id === tabId);
    if (!logicalTab) {
      throw invalidRequest();
    }
    const workspaceId = context.assignmentByTabId.get(logicalTab.logicalId);
    const placement = findWorkspaceLayoutForTab(context.windowRuntime, logicalTab.logicalId);
    const groupSplitLocked = placement?.group?.tabIds.some((tabId) =>
      tabIsSplitLocked(context, tabId)
    ) ?? false;
    return {
      state: inventory.state,
      windowId: tab.windowId,
      workspaceId,
      logicalGroupId: placement?.group?.id ?? null,
      splitLocked: tabIsSplitLocked(context, logicalTab.logicalId),
      groupSplitLocked
    };
  }

  async #moveTabToWorkspace(tabId, destinationWorkspaceId) {
    const preparation = await this.#prepareMove(tabId, destinationWorkspaceId);
    const { inventory, context, logicalTab, workspaceIds, workspaceOrder } = preparation;
    const sourcePlacement = findWorkspaceLayoutForTab(context.windowRuntime, logicalTab.logicalId);
    if (
      !sourcePlacement ||
      sourcePlacement.layout.workspaceId === destinationWorkspaceId ||
      tabIsSplitLocked(context, logicalTab.logicalId)
    ) {
      throw invalidRequest();
    }
    const sourceWorkspaceId = sourcePlacement.layout.workspaceId;
    const movingIds = new Set([logicalTab.logicalId]);
    const activeMember = context.tabs.find(
      (tab) => movingIds.has(tab.logicalId) && tab.active === true
    );
    const wasActive = Boolean(activeMember);
    let replacement = null;
    if (wasActive && context.windowRuntime.activeWorkspaceId !== destinationWorkspaceId) {
      replacement = await this.#resolveSourceReplacement(
        inventory,
        context,
        sourceWorkspaceId,
        movingIds
      );
    }

    const move = relocateLogicalTabs({
      runtime: inventory.runtime,
      windowRuntime: context.windowRuntime,
      tabIds: [...movingIds],
      destination: {
        workspaceId: destinationWorkspaceId,
        zone: sourcePlacement.pinned ? "pinned" : "ungrouped",
        relation: "end",
        anchorTabId: null,
        groupId: null,
        parentTabId: null
      }
    });
    if (!move) {
      throw invalidRequest();
    }
    removeSelectionsForTabs(inventory.runtime, movingIds);
    if (replacement) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        sourceWorkspaceId,
        replacement.logicalId,
        workspaceOrder
      );
    }
    const existingDestinationSelection = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === destinationWorkspaceId
    );
    if (wasActive || !existingDestinationSelection) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        destinationWorkspaceId,
        activeMember?.logicalId ?? logicalTab.logicalId,
        workspaceOrder
      );
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      workspaceIds,
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.MOVE_TAB
    );
    if (replacement) {
      try {
        await this.#browser.activateTab(replacement.id);
      } catch {
        // Pending logical state remains authoritative; reconciliation retries selection.
      }
    }
    const finalInventory = await this.#reconciler.reconcile(context.windowId);
    const finalContext = requireRequestedContext(finalInventory);
    return {
      view: this.#buildWorkspaceView(finalContext),
      outcome: buildMoveOutcome(
        WORKSPACE_PENDING_OPERATION_KINDS.MOVE_TAB,
        movingIds.size,
        finalContext
      )
    };
  }

  async #moveGroupToWorkspace(tabId, destinationWorkspaceId) {
    const preparation = await this.#prepareMove(tabId, destinationWorkspaceId);
    const { inventory, context, logicalTab, workspaceIds, workspaceOrder } = preparation;
    const sourcePlacement = findWorkspaceLayoutForTab(context.windowRuntime, logicalTab.logicalId);
    if (!sourcePlacement?.group || sourcePlacement.layout.workspaceId === destinationWorkspaceId) {
      throw invalidRequest();
    }
    if (sourcePlacement.group.tabIds.some((tabId) => tabIsSplitLocked(context, tabId))) {
      throw invalidRequest();
    }
    const sourceWorkspaceId = sourcePlacement.layout.workspaceId;
    const memberIds = new Set(sourcePlacement.group.tabIds);
    const activeMember = context.tabs.find(
      (tab) => memberIds.has(tab.logicalId) && tab.active === true
    );
    let replacement = null;
    if (activeMember && context.windowRuntime.activeWorkspaceId !== destinationWorkspaceId) {
      replacement = await this.#resolveSourceReplacement(
        inventory,
        context,
        sourceWorkspaceId,
        memberIds
      );
    }

    const move = relocateLogicalGroup({
      runtime: inventory.runtime,
      windowRuntime: context.windowRuntime,
      groupId: sourcePlacement.group.id,
      sourceWorkspaceId,
      memberTabIds: sourcePlacement.group.tabIds,
      destination: {
        workspaceId: destinationWorkspaceId,
        relation: "end",
        anchorTabId: null
      }
    });
    if (!move) {
      throw invalidRequest();
    }
    removeSelectionsForTabs(inventory.runtime, memberIds);
    if (replacement) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        sourceWorkspaceId,
        replacement.logicalId,
        workspaceOrder
      );
    }
    const existingDestinationSelection = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === destinationWorkspaceId
    );
    if (activeMember || !existingDestinationSelection) {
      rememberSelectedTab(
        inventory.runtime,
        context.windowRuntime,
        destinationWorkspaceId,
        logicalTab.logicalId,
        workspaceOrder
      );
    }
    await this.#reconciler.setPending(
      inventory.runtime,
      workspaceIds,
      context.windowRuntime,
      WORKSPACE_PENDING_OPERATION_KINDS.MOVE_GROUP
    );
    if (replacement) {
      try {
        await this.#browser.activateTab(replacement.id);
      } catch {
        // Pending logical state remains authoritative; reconciliation retries selection.
      }
    }
    const finalInventory = await this.#reconciler.reconcile(context.windowId);
    const finalContext = requireRequestedContext(finalInventory);
    return {
      view: this.#buildWorkspaceView(finalContext),
      outcome: buildMoveOutcome(
        WORKSPACE_PENDING_OPERATION_KINDS.MOVE_GROUP,
        memberIds.size,
        finalContext
      )
    };
  }

  async #prepareMove(tabId, destinationWorkspaceId) {
    if (
      !Number.isInteger(tabId) ||
      tabId < 0 ||
      typeof destinationWorkspaceId !== "string"
    ) {
      throw invalidRequest();
    }
    let firefoxTab;
    try {
      firefoxTab = await this.#browser.getTab(tabId);
    } catch {
      throw invalidRequest();
    }
    if (!validWindowId(firefoxTab?.windowId)) {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(firefoxTab.windowId);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    if (!workspaceIds.includes(destinationWorkspaceId)) {
      throw invalidRequest();
    }
    const context = requireMutableRequestedContext(inventory);
    const logicalTab = context.tabs.find((tab) => tab.id === tabId);
    if (!logicalTab) {
      throw invalidRequest();
    }
    return {
      inventory,
      context,
      logicalTab,
      workspaceIds,
      workspaceOrder: new Map(workspaceIds.map((id, index) => [id, index]))
    };
  }

  async #resolveSourceReplacement(inventory, context, workspaceId, excludedTabIds) {
    const candidates = context.tabs
      .filter(
        (tab) =>
          !excludedTabIds.has(tab.logicalId) &&
          context.assignmentByTabId.get(tab.logicalId) === workspaceId
      )
      .sort(compareTabs);
    if (candidates.length > 0) {
      const rememberedId = context.windowRuntime.selectedTabs.find(
        (selection) => selection.workspaceId === workspaceId
      )?.tabId;
      return candidates.find((tab) => tab.logicalId === rememberedId) ?? candidates[0];
    }
    const createdTab = await this.#createBrowserTabForWorkspace(
      context.windowId,
      inventory.state,
      workspaceId
    );
    const logicalId = await this.#browser.getOrCreateTabIdentity(createdTab.id);
    inventory.runtime.tabs.push({ id: logicalId, workspaceId });
    placeTabInLayout(context.windowRuntime, workspaceId, logicalId);
    return { ...createdTab, logicalId };
  }

  async #endNativeSplitsBeforeLeaving(context, workspaceId, separatorTabs) {
    const membersByNativeSplitId = new Map();
    for (const tab of context.tabs) {
      if (
        context.assignmentByTabId.get(tab.logicalId) !== workspaceId ||
        !tabHasNativeSplit(tab)
      ) {
        continue;
      }
      const members = membersByNativeSplitId.get(tab.splitViewId) ?? [];
      members.push(tab);
      membersByNativeSplitId.set(tab.splitViewId, members);
    }
    if (membersByNativeSplitId.size === 0) {
      return;
    }

    const separator = separatorTabs.find((tab) => !tabHasNativeSplit(tab));
    if (!separator) {
      throw invalidRequest();
    }
    const sourceLayout = context.windowRuntime.workspaceLayouts.find(
      (layout) => layout.workspaceId === workspaceId
    );
    for (const members of membersByNativeSplitId.values()) {
      if (members.length !== 2) {
        throw invalidRequest();
      }
      const orderedMembers = [...members].sort(compareTabs);
      try {
        await this.#browser.separateSplitView(
          orderedMembers.map((tab) => tab.id),
          [separator.id],
          { index: -1, windowId: context.windowId }
        );
      } catch {
        throw invalidRequest();
      }
      for (const member of members) {
        member.splitViewId = FIREFOX_SPLIT_VIEW_ID_NONE;
      }
      if (sourceLayout) {
        const memberIds = new Set(members.map((tab) => tab.logicalId));
        sourceLayout.splitViews = (sourceLayout.splitViews ?? []).filter(
          (splitView) => !splitView.tabIds.some((tabId) => memberIds.has(tabId))
        );
      }
    }
  }

  async #unloadWorkspace(windowId, workspaceId) {
    if (!validWindowId(windowId)) {
      throw invalidRequest();
    }
    let inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    if (!workspaceIds.includes(workspaceId)) {
      throw invalidRequest();
    }
    const targetTabs = tabsForWorkspace(inventory, workspaceId);
    const activeContexts = [...inventory.contexts.values()].filter(
      (context) =>
        context.windowRuntime.activeWorkspaceId === workspaceId ||
        context.tabs.some(
          (tab) =>
            tab.active === true &&
            context.assignmentByTabId.get(tab.logicalId) === workspaceId
        )
    );
    let switchedWindowCount = 0;
    let pendingWindowCount = 0;
    let safetyTabCount = 0;
    let safetyFirefoxIds = new Set();

    if (workspaceIds.length === 1) {
      safetyFirefoxIds = new Set(
        [...inventory.contexts.values()].flatMap((context) => {
          const active = context.tabs.find((tab) => tab.active === true);
          if (!active) {
            return [];
          }
          const protectedLogicalIds = expandLogicalSplitTabIds(
            context.windowRuntime,
            [active.logicalId]
          );
          const tabByLogicalId = new Map(
            context.tabs.map((tab) => [tab.logicalId, tab])
          );
          return protectedLogicalIds
            .map((logicalId) => tabByLogicalId.get(logicalId)?.id)
            .filter(Number.isInteger);
        })
      );
      safetyTabCount = safetyFirefoxIds.size;
    } else if (activeContexts.length > 0) {
      const railWorkspaceIds = inventory.state.rail
        .filter((entry) => entry.kind === "workspace")
        .map((entry) => entry.workspaceId);
      const targetIndex = railWorkspaceIds.indexOf(workspaceId);
      const successorWorkspaceId = railWorkspaceIds[(targetIndex + 1) % railWorkspaceIds.length];
      const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));

      for (const context of activeContexts) {
        let createdSuccessorTab = false;
        let successorTabs = context.tabs
          .filter(
            ({ logicalId }) =>
              context.assignmentByTabId.get(logicalId) === successorWorkspaceId
          )
          .sort(compareTabs);
        if (successorTabs.length === 0) {
          const createdTab = await this.#createBrowserTabForWorkspace(
            context.windowId,
            inventory.state,
            successorWorkspaceId
          );
          const logicalId = await this.#browser.getOrCreateTabIdentity(createdTab.id);
          inventory.runtime.tabs.push({ id: logicalId, workspaceId: successorWorkspaceId });
          placeTabInLayout(
            context.windowRuntime,
            successorWorkspaceId,
            logicalId
          );
          successorTabs = [{ ...createdTab, logicalId }];
          createdSuccessorTab = true;
        }
        const layout = context.windowRuntime.workspaceLayouts.find(
          (entry) => entry.workspaceId === successorWorkspaceId
        );
        const successorById = new Map(successorTabs.map((tab) => [tab.logicalId, tab]));
        const rememberedId = context.windowRuntime.selectedTabs.find(
          (entry) => entry.workspaceId === successorWorkspaceId
        )?.tabId;
        const orderedId = layout
          ? orderedMaterializedTabIds(layout).find((id) => successorById.has(id))
          : undefined;
        const selected =
          successorById.get(rememberedId) ??
          successorById.get(orderedId) ??
          successorTabs[0];
        if (createdSuccessorTab) {
          await this.#runtimeService.save(inventory.runtime, workspaceIds);
        }
        try {
          await this.#endNativeSplitsBeforeLeaving(
            context,
            workspaceId,
            successorTabs
          );
        } catch (error) {
          await this.#reconciler.reconcile(context.windowId).catch(() => undefined);
          throw error;
        }
        context.windowRuntime.activeWorkspaceId = successorWorkspaceId;
        rememberSelectedTab(
          inventory.runtime,
          context.windowRuntime,
          successorWorkspaceId,
          selected.logicalId,
          workspaceOrder
        );
        this.#reconciler.markPending(
          context.windowRuntime,
          WORKSPACE_PENDING_OPERATION_KINDS.UNLOAD
        );
      }
      await this.#runtimeService.save(inventory.runtime, workspaceIds);
      inventory = await this.#reconciler.reconcile(windowId);
      requireRequestedContext(inventory);
      const stillActive = [...inventory.contexts.values()].filter((context) =>
        context.windowRuntime.activeWorkspaceId === workspaceId ||
        context.tabs.some(
          (tab) =>
            tab.active === true &&
            context.assignmentByTabId.get(tab.logicalId) === workspaceId
        )
      );
      switchedWindowCount = activeContexts.length - stillActive.length;
      pendingWindowCount = activeContexts.filter((prior) =>
        inventory.contexts.get(prior.windowId)?.windowRuntime.pendingOperation !== null
      ).length;
      if (stillActive.length > 0 || pendingWindowCount > 0) {
        return {
          view: this.#buildWorkspaceView(requireRequestedContext(inventory)),
          outcome: buildUnloadOutcome({
            workspaceId,
            workspaceIds,
            targetTabs,
            finalInventory: inventory,
            attemptedTabs: [],
            discardResults: [],
            switchedWindowCount,
            pendingWindowCount,
            safetyTabCount: 0
          })
        };
      }
    } else {
      inventory = await this.#reconciler.reconcile(windowId);
      requireRequestedContext(inventory);
    }

    const tabsToDiscard = targetTabs.filter(
      ({ id, discarded }) => discarded !== true && !safetyFirefoxIds.has(id)
    );
    const eligibleByLogicalId = new Map(
      tabsToDiscard.map((tab) => [tab.logicalId, tab])
    );
    const targetByLogicalId = new Map(
      targetTabs.map((tab) => [tab.logicalId, tab])
    );
    const claimedLogicalIds = new Set();
    const discardUnits = [];
    for (const context of inventory.contexts.values()) {
      const layout = context.windowRuntime.workspaceLayouts.find(
        (entry) => entry.workspaceId === workspaceId
      );
      for (const splitView of layout?.splitViews ?? []) {
        const members = splitView.tabIds
          .map((logicalId) => targetByLogicalId.get(logicalId))
          .filter(Boolean);
        if (
          members.length !== 2 ||
          !members.some((tab) => eligibleByLogicalId.has(tab.logicalId)) ||
          members.some((tab) => safetyFirefoxIds.has(tab.id))
        ) {
          continue;
        }
        members.forEach((tab) => {
          claimedLogicalIds.add(tab.logicalId);
        });
        discardUnits.push({
          firefoxIds: members.map((tab) => tab.id),
          attemptedCount: members.filter((tab) =>
            eligibleByLogicalId.has(tab.logicalId)
          ).length
        });
      }
    }
    for (const tab of tabsToDiscard) {
      if (!claimedLogicalIds.has(tab.logicalId)) {
        discardUnits.push({ firefoxIds: [tab.id], attemptedCount: 1 });
      }
    }
    const discardResults = await Promise.all(
      discardUnits.map(async (unit) => {
        try {
          if (typeof this.#browser.discardTabs === "function") {
            await this.#browser.discardTabs(unit.firefoxIds);
          } else {
            await Promise.all(unit.firefoxIds.map((tabId) => this.#browser.discardTab(tabId)));
          }
          return { status: "fulfilled", attemptedCount: unit.attemptedCount };
        } catch (reason) {
          return { status: "rejected", reason, attemptedCount: unit.attemptedCount };
        }
      })
    );
    inventory = await this.#reconciler.reconcile(windowId);
    requireRequestedContext(inventory);
    const outcome = buildUnloadOutcome({
      workspaceId,
      workspaceIds,
      targetTabs,
      finalInventory: inventory,
      attemptedTabs: tabsToDiscard,
      discardResults,
      switchedWindowCount,
      pendingWindowCount,
      safetyTabCount
    });

    return {
      view: this.#buildWorkspaceView(inventory.requestedContext),
      outcome
    };
  }

  async #loadWorkspaceTabs(windowId, workspaceId) {
    if (!validWindowId(windowId) || typeof workspaceId !== "string") {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    const context = requireRequestedContext(inventory);
    if (!inventory.state.workspaces.some(({ id }) => id === workspaceId)) {
      throw invalidRequest();
    }
    // This window only: the menu belongs to one sidebar, and another window's
    // copy of the workspace keeps its own tabs asleep.
    const targets = context.tabs.filter(
      (tab) =>
        context.assignmentByTabId.get(tab.logicalId) === workspaceId &&
        tab.discarded === true
    );
    let failedCount = 0;
    if (targets.length > 0) {
      const results = await this.#browser.reloadTabs(targets.map(({ id }) => id));
      failedCount = Array.isArray(results)
        ? results.filter(({ status }) => status === "rejected").length
        : 0;
    }
    const finalInventory = await this.#reconciler.reconcile(windowId);
    return parseWorkspaceLoadOutcome({
      workspaceId,
      requestedCount: targets.length,
      startedCount: targets.length - failedCount,
      failedCount,
      view: this.#buildWorkspaceView(requireRequestedContext(finalInventory))
    }, inventory.state.workspaces.map(({ id }) => id));
  }

  async #removeWorkspace(windowId, workspaceId, settings) {
    if (!validWindowId(windowId) || typeof workspaceId !== "string") {
      throw invalidRequest();
    }
    const inventory = await this.#reconciler.reconcile(windowId, { converge: false });
    requireRequestedContext(inventory);
    requireNoSplitViewChooser(inventory);
    const workspaceIds = inventory.state.workspaces.map(({ id }) => id);
    if (workspaceIds.length < 2 || !workspaceIds.includes(workspaceId)) {
      throw invalidRequest();
    }
    const railWorkspaceIds = inventory.state.rail
      .filter(({ kind }) => kind === "workspace")
      .map(({ workspaceId: id }) => id);
    const sourceIndex = railWorkspaceIds.indexOf(workspaceId);
    if (sourceIndex < 0) {
      throw invalidRequest();
    }
    const destinationWorkspaceId = railWorkspaceIds[(sourceIndex + 1) % railWorkspaceIds.length];
    if (
      [...inventory.contexts.values()].some((context) =>
        context.tabs.some(
          (tab) =>
            context.assignmentByTabId.get(tab.logicalId) === workspaceId &&
            tabHasNativeSplit(tab)
        )
      )
    ) {
      throw invalidRequest();
    }
    if (this.#snapshotService && settings) {
      await this.#snapshotService.createFromInventory(inventory, settings, {
        kind: SNAPSHOT_KINDS.SAFETY,
        reason: "workspace-removal"
      });
    }
    const affectedWindows = inventory.runtime.windows.filter(
      (entry) =>
        entry.activeWorkspaceId === workspaceId ||
        entry.workspaceLayouts.some(({ workspaceId: id }) => id === workspaceId) ||
        entry.selectedTabs.some(({ workspaceId: id }) => id === workspaceId)
    );
    if (!mergeLogicalWorkspace(inventory.runtime, workspaceId, destinationWorkspaceId)) {
      throw invalidRequest();
    }
    for (const windowRuntime of affectedWindows) {
      this.#reconciler.markPending(
        windowRuntime,
        WORKSPACE_PENDING_OPERATION_KINDS.REMOVE_WORKSPACE
      );
    }
    await this.#runtimeService.save(inventory.runtime, workspaceIds);
    await this.#stateService.removeWorkspace(workspaceId);
    const finalInventory = await this.#reconciler.reconcile(windowId);
    return this.#buildWorkspaceView(requireRequestedContext(finalInventory));
  }
}

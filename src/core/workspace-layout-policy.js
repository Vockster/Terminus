import {
  MAX_GROUP_TITLE_LENGTH,
  MAX_TAB_TREE_DEPTH
} from "../contracts/workspace-runtime.js";

const FIREFOX_TAB_GROUP_ID_NONE = -1;
const FIREFOX_SPLIT_VIEW_ID_NONE = -1;

function compareTabs(left, right) {
  const leftIndex = Number.isInteger(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isInteger(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || left.id - right.id;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function groupsEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return (
        entry.id === candidate.id &&
        entry.title === candidate.title &&
        entry.color === candidate.color &&
        entry.collapsed === candidate.collapsed &&
        arraysEqual(entry.tabIds, candidate.tabIds)
      );
    })
  );
}

function treesEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return (
        entry.tabId === candidate.tabId &&
        entry.parentTabId === candidate.parentTabId &&
        entry.collapsed === candidate.collapsed
      );
    })
  );
}

function splitViewsEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return entry.id === candidate.id && arraysEqual(entry.tabIds, candidate.tabIds);
    })
  );
}

function rootTreeNode(tabId) {
  return { tabId, parentTabId: null, collapsed: false };
}

function groupIdByTab(layout) {
  const result = new Map();
  for (const group of layout.groups) {
    for (const tabId of group.tabIds) {
      result.set(tabId, group.id);
    }
  }
  return result;
}

export function repairWorkspaceTree(layout) {
  const previous = Array.isArray(layout.tree) ? layout.tree : [];
  const previousByTabId = new Map(previous.map((node) => [node.tabId, node]));
  const pinned = new Set(layout.pinnedTabIds);
  const groupByTabId = groupIdByTab(layout);
  const accepted = new Set();
  const depthByTabId = new Map();
  const tree = layout.tabIds.map((tabId) => {
    const oldNode = previousByTabId.get(tabId);
    let parentTabId = oldNode?.parentTabId ?? null;
    let depth = 0;
    if (
      pinned.has(tabId) ||
      !accepted.has(parentTabId) ||
      pinned.has(parentTabId) ||
      groupByTabId.get(tabId) !== groupByTabId.get(parentTabId)
    ) {
      parentTabId = null;
    } else {
      depth = depthByTabId.get(parentTabId) + 1;
      if (depth > MAX_TAB_TREE_DEPTH) {
        parentTabId = null;
        depth = 0;
      }
    }
    accepted.add(tabId);
    depthByTabId.set(tabId, depth);
    return {
      tabId,
      parentTabId,
      collapsed: pinned.has(tabId) ? false : oldNode?.collapsed === true
    };
  });
  const changed = !treesEqual(previous, tree);
  layout.tree = tree;
  return changed;
}

function childTabIdsByParent(layout) {
  const children = new Map();
  for (const node of layout.tree ?? []) {
    if (node.parentTabId === null) continue;
    const siblings = children.get(node.parentTabId) ?? [];
    siblings.push(node.tabId);
    children.set(node.parentTabId, siblings);
  }
  return children;
}

// The requested tabs plus every tab nested under them at any depth, in layout
// order. Whole-tree actions (close, move, group) operate on this set.
export function descendantClosure(layout, tabIds) {
  const children = childTabIdsByParent(layout);
  const included = new Set();
  const pending = [...tabIds];
  while (pending.length > 0) {
    const tabId = pending.pop();
    if (included.has(tabId)) continue;
    included.add(tabId);
    pending.push(...(children.get(tabId) ?? []));
  }
  return layout.tabIds.filter((tabId) => included.has(tabId));
}

export function isDescendantClosed(layout, tabIds) {
  const requested = new Set(tabIds);
  return (layout.tree ?? []).every((node) =>
    node.parentTabId === null || !requested.has(node.parentTabId) || requested.has(node.tabId)
  );
}

function splitPairKey(tabIds) {
  return [...tabIds].sort().join("\n");
}

// A split view absent from the previous observation nests its second pane
// under its first. The edge is kept only when tree repair would change
// nothing else, so an invalid nesting leaves the tree exactly as it was.
function nestNewSplitViews(layout, previousSplitViews) {
  const previousPairs = new Set(previousSplitViews.map(({ tabIds }) => splitPairKey(tabIds)));
  for (const splitView of layout.splitViews) {
    if (splitView.tabIds.length !== 2 || previousPairs.has(splitPairKey(splitView.tabIds))) {
      continue;
    }
    const [parentTabId, childTabId] = splitView.tabIds;
    const child = layout.tree.find((node) => node.tabId === childTabId);
    if (!child || child.parentTabId === parentTabId) {
      continue;
    }
    const expected = layout.tree.map((node) =>
      node.tabId === childTabId ? { ...node, parentTabId } : node
    );
    const candidate = { ...layout, tree: expected };
    repairWorkspaceTree(candidate);
    if (treesEqual(candidate.tree, expected)) {
      layout.tree = candidate.tree;
    }
  }
}

function promoteTreeChildren(layout, tabId) {
  const removed = layout.tree?.find((node) => node.tabId === tabId);
  const parentTabId = removed?.parentTabId ?? null;
  for (const node of layout.tree ?? []) {
    if (node.parentTabId === tabId) {
      node.parentTabId = parentTabId;
    }
  }
}

export function ensureWorkspaceLayout(windowRuntime, workspaceId) {
  let layout = windowRuntime.workspaceLayouts.find((entry) => entry.workspaceId === workspaceId);
  if (!layout) {
    layout = {
      workspaceId,
      tabIds: [],
      pinnedTabIds: [],
      groups: [],
      tree: [],
      splitViews: []
    };
    windowRuntime.workspaceLayouts.push(layout);
  } else if (!Array.isArray(layout.tree)) {
    layout.tree = layout.tabIds.map(rootTreeNode);
  }
  if (!Array.isArray(layout.splitViews)) {
    layout.splitViews = [];
  }
  return layout;
}

export function findWorkspaceLayoutForTab(windowRuntime, tabId) {
  const layout = windowRuntime.workspaceLayouts.find((entry) => entry.tabIds.includes(tabId));
  if (!layout) {
    return null;
  }
  return {
    layout,
    group: layout.groups.find((entry) => entry.tabIds.includes(tabId)) ?? null,
    splitView: (layout.splitViews ?? []).find((entry) => entry.tabIds.includes(tabId)) ?? null,
    pinned: layout.pinnedTabIds.includes(tabId)
  };
}

export function expandLogicalSplitTabIds(windowRuntime, tabIds) {
  const requested = new Set(tabIds);
  for (const layout of windowRuntime.workspaceLayouts) {
    for (const splitView of layout.splitViews ?? []) {
      if (splitView.tabIds.some((tabId) => requested.has(tabId))) {
        splitView.tabIds.forEach((tabId) => {
          requested.add(tabId);
        });
      }
    }
  }
  const ordered = [];
  for (const layout of windowRuntime.workspaceLayouts) {
    for (const tabId of layout.tabIds) {
      if (requested.has(tabId)) {
        ordered.push(tabId);
      }
    }
  }
  return ordered;
}

export function removeTabFromLayouts(runtime, tabId) {
  let removed = false;
  for (const windowRuntime of runtime.windows) {
    for (const layout of windowRuntime.workspaceLayouts) {
      if (layout.tabIds.includes(tabId)) {
        promoteTreeChildren(layout, tabId);
        layout.tabIds = layout.tabIds.filter((id) => id !== tabId);
        layout.tree = (layout.tree ?? []).filter((node) => node.tabId !== tabId);
        removed = true;
      }
      layout.pinnedTabIds = layout.pinnedTabIds.filter((id) => id !== tabId);
      layout.groups = layout.groups
        .map((group) => ({
          ...group,
          tabIds: group.tabIds.filter((id) => id !== tabId)
        }))
        .filter((group) => group.tabIds.length > 0);
      layout.splitViews = (layout.splitViews ?? []).filter(
        (splitView) => !splitView.tabIds.includes(tabId)
      );
      repairWorkspaceTree(layout);
    }
  }
  return removed;
}

export function placeTabInLayout(windowRuntime, workspaceId, tabId, { pinned = false } = {}) {
  const layout = ensureWorkspaceLayout(windowRuntime, workspaceId);
  if (layout.tabIds.includes(tabId)) {
    return layout;
  }
  if (pinned) {
    const pinSet = new Set(layout.pinnedTabIds);
    let insertionIndex = 0;
    for (let index = 0; index < layout.tabIds.length; index += 1) {
      if (pinSet.has(layout.tabIds[index])) {
        insertionIndex = index + 1;
      }
    }
    layout.tabIds.splice(insertionIndex, 0, tabId);
    layout.pinnedTabIds.push(tabId);
    layout.tree.splice(insertionIndex, 0, rootTreeNode(tabId));
  } else {
    layout.tabIds.push(tabId);
    layout.tree.push(rootTreeNode(tabId));
  }
  return layout;
}

export function preserveRelocatedWholeGroups({
  runtime,
  groups,
  liveOwnerByTabId,
  assignmentByTabId
}) {
  let changed = false;
  for (const group of groups) {
    const liveMemberIds = group.tabIds.filter((tabId) => liveOwnerByTabId.has(tabId));
    if (liveMemberIds.length === 0) {
      continue;
    }
    const targetWindowId = liveOwnerByTabId.get(liveMemberIds[0]);
    const targetWorkspaceId = assignmentByTabId.get(liveMemberIds[0]);
    const movedTogether = liveMemberIds.every(
      (tabId) =>
        liveOwnerByTabId.get(tabId) === targetWindowId &&
        assignmentByTabId.get(tabId) === targetWorkspaceId
    );
    if (!movedTogether) {
      continue;
    }
    const targetWindow = runtime.windows.find((entry) => entry.id === targetWindowId);
    if (!targetWindow) {
      continue;
    }
    const targetLayout = ensureWorkspaceLayout(targetWindow, targetWorkspaceId);
    const memberSet = new Set(liveMemberIds);
    targetLayout.pinnedTabIds = targetLayout.pinnedTabIds.filter(
      (tabId) => !memberSet.has(tabId)
    );
    for (const windowRuntime of runtime.windows) {
      for (const layout of windowRuntime.workspaceLayouts) {
        layout.groups = layout.groups.filter(
          (candidate) =>
            candidate.id !== group.id &&
            !candidate.tabIds.some((tabId) => memberSet.has(tabId))
        );
      }
    }
    targetLayout.groups.push({ ...group, tabIds: liveMemberIds });
    targetLayout.groups.sort(
      (left, right) =>
        targetLayout.tabIds.indexOf(left.tabIds[0]) -
        targetLayout.tabIds.indexOf(right.tabIds[0])
    );
    repairWorkspaceTree(targetLayout);
    changed = true;
  }
  return changed;
}

export function preserveRelocatedWholeSplitViews({
  runtime,
  splitViews,
  liveOwnerByTabId,
  assignmentByTabId
}) {
  let changed = false;
  for (const splitView of splitViews) {
    if (
      splitView.tabIds.length !== 2 ||
      splitView.tabIds.some((tabId) => !liveOwnerByTabId.has(tabId))
    ) {
      continue;
    }
    const [firstTabId] = splitView.tabIds;
    const targetWindowId = liveOwnerByTabId.get(firstTabId);
    const targetWorkspaceId = assignmentByTabId.get(firstTabId);
    if (
      splitView.tabIds.some(
        (tabId) =>
          liveOwnerByTabId.get(tabId) !== targetWindowId ||
          assignmentByTabId.get(tabId) !== targetWorkspaceId
      )
    ) {
      continue;
    }
    const targetWindow = runtime.windows.find((entry) => entry.id === targetWindowId);
    if (!targetWindow) {
      continue;
    }
    for (const windowRuntime of runtime.windows) {
      for (const layout of windowRuntime.workspaceLayouts) {
        layout.splitViews = (layout.splitViews ?? []).filter(
          (candidate) =>
            candidate.id !== splitView.id &&
            !candidate.tabIds.some((tabId) => splitView.tabIds.includes(tabId))
        );
      }
    }
    const targetLayout = ensureWorkspaceLayout(targetWindow, targetWorkspaceId);
    const orderedMembers = targetLayout.tabIds.filter((tabId) => splitView.tabIds.includes(tabId));
    if (orderedMembers.length === 2) {
      targetLayout.splitViews.push({ id: splitView.id, tabIds: orderedMembers });
      targetLayout.splitViews.sort(
        (left, right) =>
          targetLayout.tabIds.indexOf(left.tabIds[0]) -
          targetLayout.tabIds.indexOf(right.tabIds[0])
      );
      changed = true;
    }
  }
  return changed;
}

export function captureWorkspaceLayout({
  windowRuntime,
  workspaceId,
  tabs,
  nativeGroups,
  createGroupId,
  reservedGroupIds = new Set(),
  createSplitViewId,
  reservedSplitViewIds = new Set()
}) {
  const layout = ensureWorkspaceLayout(windowRuntime, workspaceId);
  const previous = {
    tabIds: layout.tabIds,
    pinnedTabIds: layout.pinnedTabIds,
    groups: layout.groups,
    tree: layout.tree ?? [],
    splitViews: layout.splitViews ?? []
  };
  const orderedTabs = [...tabs].sort(compareTabs);
  const tabIds = orderedTabs.map((tab) => tab.logicalId);
  const tabByLogicalId = new Map(orderedTabs.map((tab) => [tab.logicalId, tab]));
  const groupTabs = new Map();
  for (const tab of orderedTabs) {
    if (Number.isInteger(tab.groupId) && tab.groupId !== FIREFOX_TAB_GROUP_ID_NONE) {
      const members = groupTabs.get(tab.groupId) ?? [];
      members.push(tab);
      groupTabs.set(tab.groupId, members);
    }
  }

  const availableExistingGroups = new Map(layout.groups.map((group) => [group.id, group]));
  const usedGroupIds = new Set(reservedGroupIds);
  const sessionGroupByTabId = new Map();
  const groups = [...groupTabs.entries()]
    .sort((left, right) => compareTabs(left[1][0], right[1][0]))
    .map(([nativeGroupId, members]) => {
      const memberIds = members.map((tab) => tab.logicalId);
      const sessionCandidates = [...new Set(
        members.map((tab) => tab.logicalGroupId).filter(Boolean)
      )].sort();
      let id = sessionCandidates.find((candidate) => !usedGroupIds.has(candidate));
      if (!id) {
        const memberIdSet = new Set(memberIds);
        id = [...availableExistingGroups.values()]
          .filter((group) => !usedGroupIds.has(group.id))
          .map((group) => ({
            id: group.id,
            overlap: group.tabIds.filter((tabId) => memberIdSet.has(tabId)).length
          }))
          .filter((candidate) => candidate.overlap > 0)
          .sort((left, right) => right.overlap - left.overlap || left.id.localeCompare(right.id))[0]?.id;
      }
      while (!id || usedGroupIds.has(id)) {
        id = createGroupId();
      }
      usedGroupIds.add(id);
      for (const member of members) {
        sessionGroupByTabId.set(member.id, id);
      }
      const nativeGroup = nativeGroups.get(nativeGroupId) ?? {};
      return {
        id,
        title: typeof nativeGroup.title === "string" ? nativeGroup.title : "",
        color: typeof nativeGroup.color === "string" ? nativeGroup.color : "grey",
        collapsed: nativeGroup.collapsed === true,
        tabIds: memberIds
      };
    });
  const groupedTabIds = new Set(groups.flatMap((group) => group.tabIds));
  const pinnedTabIds = orderedTabs
    .filter((tab) => tab.pinned === true && !groupedTabIds.has(tab.logicalId))
    .map((tab) => tab.logicalId);

  const pinnedTabIdSet = new Set(pinnedTabIds);
  const groupByTabId = new Map();
  for (const group of groups) {
    for (const tabId of group.tabIds) {
      groupByTabId.set(tabId, group.id);
    }
  }
  const splitTabs = new Map();
  for (const tab of orderedTabs) {
    if (
      Number.isInteger(tab.splitViewId) &&
      tab.splitViewId !== FIREFOX_SPLIT_VIEW_ID_NONE
    ) {
      const members = splitTabs.get(tab.splitViewId) ?? [];
      members.push(tab.logicalId);
      splitTabs.set(tab.splitViewId, members);
    }
  }
  const usedSplitViewIds = new Set(reservedSplitViewIds);
  const availableExistingSplits = new Map(
    previous.splitViews.map((splitView) => [splitView.id, splitView])
  );
  const splitViews = [...splitTabs.values()]
    .filter((memberIds) => {
      if (memberIds.length !== 2) {
        return false;
      }
      const [firstTabId, secondTabId] = memberIds;
      return (
        tabIds.indexOf(secondTabId) === tabIds.indexOf(firstTabId) + 1 &&
        !pinnedTabIdSet.has(firstTabId) &&
        !pinnedTabIdSet.has(secondTabId) &&
        groupByTabId.get(firstTabId) === groupByTabId.get(secondTabId)
      );
    })
    .map((memberIds) => {
      let id = [...availableExistingSplits.values()]
        .filter((splitView) => !usedSplitViewIds.has(splitView.id))
        .map((splitView) => ({
          id: splitView.id,
          overlap: splitView.tabIds.filter((tabId) => memberIds.includes(tabId)).length
        }))
        .filter((candidate) => candidate.overlap > 0)
        .sort((left, right) => right.overlap - left.overlap || left.id.localeCompare(right.id))[0]?.id;
      while (!id || usedSplitViewIds.has(id)) {
        id = createSplitViewId();
      }
      usedSplitViewIds.add(id);
      return { id, tabIds: memberIds };
    });
  splitViews.sort(
    (left, right) => tabIds.indexOf(left.tabIds[0]) - tabIds.indexOf(right.tabIds[0])
  );

  layout.tabIds = tabIds;
  layout.pinnedTabIds = pinnedTabIds;
  layout.groups = groups;
  layout.splitViews = splitViews;
  layout.tree = previous.tree;
  repairWorkspaceTree(layout);
  nestNewSplitViews(layout, previous.splitViews);

  return {
    layout,
    sessionGroupByTabId,
    ungroupedFirefoxTabIds: orderedTabs
      .filter((tab) => !groupedTabIds.has(tab.logicalId) && tab.logicalGroupId)
      .map((tab) => tab.id),
    changed:
      !arraysEqual(previous.tabIds, tabIds) ||
      !arraysEqual(previous.pinnedTabIds, pinnedTabIds) ||
      !groupsEqual(previous.groups, groups) ||
      !splitViewsEqual(previous.splitViews, splitViews) ||
      !treesEqual(previous.tree, layout.tree),
    tabByLogicalId
  };
}

export function setLogicalGroupPartition({
  windowRuntime,
  workspaceId,
  memberTabIds,
  group,
  createGroupId,
  reservedGroupIds = new Set()
}) {
  const layout = ensureWorkspaceLayout(windowRuntime, workspaceId);
  const memberSet = new Set(memberTabIds);
  const existing = layout.groups.find((entry) =>
    entry.tabIds.some((tabId) => memberSet.has(tabId))
  );
  let id = existing?.id ?? group.id;
  if (!existing) {
    while (!id || reservedGroupIds.has(id)) {
      id = createGroupId();
    }
  }
  layout.pinnedTabIds = layout.pinnedTabIds.filter((tabId) => !memberSet.has(tabId));
  layout.groups = layout.groups.filter(
    (entry) => entry.id !== id && !entry.tabIds.some((tabId) => memberSet.has(tabId))
  );
  const logicalGroup = {
    id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    tabIds: [...memberTabIds]
  };
  layout.groups.push(logicalGroup);
  layout.groups.sort(
    (left, right) =>
      layout.tabIds.indexOf(left.tabIds[0]) - layout.tabIds.indexOf(right.tabIds[0])
  );
  repairWorkspaceTree(layout);
  return logicalGroup;
}

export function orderedMaterializedTabIds(layout) {
  const pinSet = new Set(layout.pinnedTabIds);
  const groupByTabId = new Map();
  for (const group of layout.groups) {
    for (const tabId of group.tabIds) {
      groupByTabId.set(tabId, group);
    }
  }
  const result = [...layout.pinnedTabIds];
  const emittedGroups = new Set();
  for (const tabId of layout.tabIds) {
    if (pinSet.has(tabId)) {
      continue;
    }
    const group = groupByTabId.get(tabId);
    if (!group) {
      result.push(tabId);
    } else if (!emittedGroups.has(group.id)) {
      result.push(...group.tabIds);
      emittedGroups.add(group.id);
    }
  }
  return result;
}

export function moveLogicalTab(runtime, windowRuntime, tabId, destinationWorkspaceId) {
  const source = findWorkspaceLayoutForTab(windowRuntime, tabId);
  const assignment = runtime.tabs.find((entry) => entry.id === tabId);
  if (!source || !assignment || assignment.workspaceId === destinationWorkspaceId) {
    return null;
  }
  const sourceWorkspaceId = assignment.workspaceId;
  const preservePinned = source.pinned;
  const memberTabIds = source.splitView ? [...source.splitView.tabIds] : [tabId];
  const memberSet = new Set(memberTabIds);
  const movingSplitView = source.splitView
    ? { ...source.splitView, tabIds: [...source.splitView.tabIds] }
    : null;
  for (const memberTabId of memberTabIds) {
    removeTabFromLayouts(runtime, memberTabId);
    runtime.tabs.find((entry) => entry.id === memberTabId).workspaceId = destinationWorkspaceId;
    placeTabInLayout(windowRuntime, destinationWorkspaceId, memberTabId, {
      pinned: preservePinned && !movingSplitView
    });
  }
  if (movingSplitView) {
    const destination = ensureWorkspaceLayout(windowRuntime, destinationWorkspaceId);
    destination.splitViews = destination.splitViews.filter(
      (entry) => !entry.tabIds.some((memberTabId) => memberSet.has(memberTabId))
    );
    destination.splitViews.push(movingSplitView);
  }
  return {
    sourceWorkspaceId,
    destinationWorkspaceId,
    logicalTabId: tabId,
    sourceGroupId: source.group?.id ?? null,
    pinned: preservePinned
  };
}

export function moveLogicalGroup(runtime, windowRuntime, groupId, destinationWorkspaceId) {
  let sourceLayout;
  let group;
  for (const layout of windowRuntime.workspaceLayouts) {
    const candidate = layout.groups.find((entry) => entry.id === groupId);
    if (candidate) {
      sourceLayout = layout;
      group = candidate;
      break;
    }
  }
  if (!group || sourceLayout.workspaceId === destinationWorkspaceId) {
    return null;
  }
  const memberSet = new Set(group.tabIds);
  const movingTree = (sourceLayout.tree ?? [])
    .filter((node) => memberSet.has(node.tabId))
    .map((node) => ({ ...node }));
  const movingSplitViews = (sourceLayout.splitViews ?? [])
    .filter((splitView) => splitView.tabIds.every((tabId) => memberSet.has(tabId)))
    .map((splitView) => ({ ...splitView, tabIds: [...splitView.tabIds] }));
  sourceLayout.tabIds = sourceLayout.tabIds.filter((tabId) => !memberSet.has(tabId));
  sourceLayout.pinnedTabIds = sourceLayout.pinnedTabIds.filter((tabId) => !memberSet.has(tabId));
  sourceLayout.groups = sourceLayout.groups.filter((entry) => entry.id !== groupId);
  sourceLayout.splitViews = (sourceLayout.splitViews ?? []).filter(
    (splitView) => !splitView.tabIds.some((tabId) => memberSet.has(tabId))
  );
  sourceLayout.tree = (sourceLayout.tree ?? []).filter((node) => !memberSet.has(node.tabId));
  repairWorkspaceTree(sourceLayout);
  for (const assignment of runtime.tabs) {
    if (memberSet.has(assignment.id)) {
      assignment.workspaceId = destinationWorkspaceId;
    }
  }
  const destination = ensureWorkspaceLayout(windowRuntime, destinationWorkspaceId);
  destination.tabIds.push(...group.tabIds);
  destination.groups.push({ ...group, tabIds: [...group.tabIds] });
  destination.splitViews.push(...movingSplitViews);
  destination.tree.push(...movingTree);
  repairWorkspaceTree(destination);
  return {
    sourceWorkspaceId: sourceLayout.workspaceId,
    destinationWorkspaceId,
    logicalGroupId: groupId,
    memberTabIds: [...group.tabIds]
  };
}

export function mergeLogicalWorkspace(runtime, sourceWorkspaceId, destinationWorkspaceId) {
  if (
    typeof sourceWorkspaceId !== "string" ||
    typeof destinationWorkspaceId !== "string" ||
    sourceWorkspaceId === destinationWorkspaceId
  ) {
    return false;
  }

  for (const assignment of runtime.tabs) {
    if (assignment.workspaceId === sourceWorkspaceId) {
      assignment.workspaceId = destinationWorkspaceId;
    }
  }

  for (const windowRuntime of runtime.windows) {
    const sourceLayout = windowRuntime.workspaceLayouts.find(
      ({ workspaceId }) => workspaceId === sourceWorkspaceId
    );
    const sourceSelection = windowRuntime.selectedTabs.find(
      ({ workspaceId }) => workspaceId === sourceWorkspaceId
    );
    const sourceWasActive = windowRuntime.activeWorkspaceId === sourceWorkspaceId;
    if (sourceLayout) {
      const destinationLayout = ensureWorkspaceLayout(windowRuntime, destinationWorkspaceId);
      destinationLayout.tabIds.push(...sourceLayout.tabIds);
      destinationLayout.pinnedTabIds.push(...sourceLayout.pinnedTabIds);
      destinationLayout.groups.push(
        ...sourceLayout.groups.map((group) => ({ ...group, tabIds: [...group.tabIds] }))
      );
      destinationLayout.tree.push(...sourceLayout.tree.map((node) => ({ ...node })));
      destinationLayout.splitViews.push(
        ...(sourceLayout.splitViews ?? []).map((splitView) => ({
          ...splitView,
          tabIds: [...splitView.tabIds]
        }))
      );
      repairWorkspaceTree(destinationLayout);
      windowRuntime.workspaceLayouts = windowRuntime.workspaceLayouts.filter(
        ({ workspaceId }) => workspaceId !== sourceWorkspaceId
      );
    }

    windowRuntime.selectedTabs = windowRuntime.selectedTabs.filter(
      ({ workspaceId }) => workspaceId !== sourceWorkspaceId
    );
    if (sourceWasActive) {
      windowRuntime.activeWorkspaceId = destinationWorkspaceId;
      windowRuntime.selectedTabs = windowRuntime.selectedTabs.filter(
        ({ workspaceId }) => workspaceId !== destinationWorkspaceId
      );
      const destinationLayout = windowRuntime.workspaceLayouts.find(
        ({ workspaceId }) => workspaceId === destinationWorkspaceId
      );
      const selectedTabId = sourceSelection?.tabId ?? sourceLayout?.tabIds[0] ?? destinationLayout?.tabIds[0];
      if (selectedTabId) {
        windowRuntime.selectedTabs.push({
          workspaceId: destinationWorkspaceId,
          tabId: selectedTabId
        });
      }
    }
  }
  return true;
}

function removeTabsFromLayout(layout, tabIds) {
  const removing = new Set(tabIds);
  const movingNodes = (layout.tree ?? [])
    .filter((node) => removing.has(node.tabId))
    .map((node) => ({ ...node }));
  const movingSplitViews = (layout.splitViews ?? [])
    .filter((splitView) => splitView.tabIds.every((tabId) => removing.has(tabId)))
    .map((splitView) => ({ ...splitView, tabIds: [...splitView.tabIds] }));
  for (const tabId of tabIds) {
    promoteTreeChildren(layout, tabId);
  }
  layout.tabIds = layout.tabIds.filter((tabId) => !removing.has(tabId));
  layout.pinnedTabIds = layout.pinnedTabIds.filter((tabId) => !removing.has(tabId));
  layout.groups = layout.groups
    .map((group) => ({
      ...group,
      tabIds: group.tabIds.filter((tabId) => !removing.has(tabId))
    }))
    .filter((group) => group.tabIds.length > 0);
  layout.tree = (layout.tree ?? []).filter((node) => !removing.has(node.tabId));
  layout.splitViews = (layout.splitViews ?? []).filter(
    (splitView) => !splitView.tabIds.some((tabId) => removing.has(tabId))
  );
  repairWorkspaceTree(layout);
  return { movingNodes, movingSplitViews };
}

function insertionIndexFor(layout, destination) {
  if (destination.anchorTabId !== null) {
    const anchorIndex = layout.tabIds.indexOf(destination.anchorTabId);
    if (anchorIndex < 0) {
      return -1;
    }
    if (destination.relation === "inside") {
      const nodeById = new Map((layout.tree ?? []).map((node) => [node.tabId, node]));
      let insertionIndex = anchorIndex + 1;
      while (insertionIndex < layout.tabIds.length) {
        let ancestorId = nodeById.get(layout.tabIds[insertionIndex])?.parentTabId ?? null;
        let belongsToBranch = false;
        while (ancestorId !== null) {
          if (ancestorId === destination.anchorTabId) {
            belongsToBranch = true;
            break;
          }
          ancestorId = nodeById.get(ancestorId)?.parentTabId ?? null;
        }
        if (!belongsToBranch) {
          break;
        }
        insertionIndex += 1;
      }
      return insertionIndex;
    }
    return anchorIndex + (destination.relation === "after" ? 1 : 0);
  }
  if (destination.zone === "pinned") {
    return layout.pinnedTabIds.length;
  }
  if (destination.zone === "group") {
    const group = layout.groups.find((entry) => entry.id === destination.groupId);
    if (!group) {
      return -1;
    }
    const finalMember = group.tabIds.at(-1);
    return layout.tabIds.indexOf(finalMember) + 1;
  }
  return layout.tabIds.length;
}

function treeTargetDescendsFromSelection(layout, targetTabId, movingSet) {
  if (targetTabId === null) {
    return false;
  }
  const nodeById = new Map((layout.tree ?? []).map((node) => [node.tabId, node]));
  let candidate = targetTabId;
  while (candidate !== null) {
    if (movingSet.has(candidate)) {
      return true;
    }
    candidate = nodeById.get(candidate)?.parentTabId ?? null;
  }
  return false;
}

// An ungrouped insertion may sit directly outside a native group: before its
// first tab or after its last one, ignoring tabs that are moving. The moved
// tabs land outside the group, which stays contiguous.
function anchorsOutsideGroupBoundary(layout, destination, movingSet) {
  if (destination.parentTabId !== null || !["before", "after"].includes(destination.relation)) {
    return false;
  }
  const group = layout.groups.find((entry) => entry.tabIds.includes(destination.anchorTabId));
  const memberSet = new Set(group?.tabIds ?? []);
  const staying = layout.tabIds.filter((tabId) => memberSet.has(tabId) && !movingSet.has(tabId));
  return (destination.relation === "before" ? staying[0] : staying.at(-1)) ===
    destination.anchorTabId;
}

function validateTreeParent(layout, tabId, parentTabId) {
  if (parentTabId === null) {
    return true;
  }
  const nodeById = new Map((layout.tree ?? []).map((node) => [node.tabId, node]));
  const childGroup = groupIdByTab(layout).get(tabId);
  const parentGroup = groupIdByTab(layout).get(parentTabId);
  if (
    tabId === parentTabId ||
    !nodeById.has(parentTabId) ||
    layout.pinnedTabIds.includes(tabId) ||
    layout.pinnedTabIds.includes(parentTabId) ||
    childGroup !== parentGroup
  ) {
    return false;
  }
  let candidate = parentTabId;
  let depth = 1;
  while (candidate !== null) {
    if (candidate === tabId || depth > MAX_TAB_TREE_DEPTH) {
      return false;
    }
    candidate = nodeById.get(candidate)?.parentTabId ?? null;
    depth += 1;
  }
  return true;
}

export function setLogicalTreeParent(layout, tabId, parentTabId) {
  repairWorkspaceTree(layout);
  const node = layout.tree.find((entry) => entry.tabId === tabId);
  if (!node || !validateTreeParent(layout, tabId, parentTabId)) {
    return false;
  }
  node.parentTabId = parentTabId;
  repairWorkspaceTree(layout);
  return layout.tree.find((entry) => entry.tabId === tabId)?.parentTabId === parentTabId;
}

export function setLogicalTreeCollapsed(layout, tabId, collapsed) {
  repairWorkspaceTree(layout);
  const node = layout.tree.find((entry) => entry.tabId === tabId);
  if (!node || layout.pinnedTabIds.includes(tabId) || typeof collapsed !== "boolean") {
    return false;
  }
  node.collapsed = collapsed;
  return true;
}

// Un-nests one branch without touching tab order, pins, groups, or Split
// Views: every descendant of tabId moves up to tabId's own level, and tabId
// keeps its parent. The result is always a valid tree because descendants
// share the root's native group (as does the root's parent), depth only
// decreases, and layout order already places that parent before them.
export function flattenLogicalTreeBranch(layout, tabId) {
  repairWorkspaceTree(layout);
  const root = layout.tree.find((entry) => entry.tabId === tabId);
  if (!root || layout.pinnedTabIds.includes(tabId)) {
    return null;
  }
  const branch = new Set([tabId]);
  const flattenedTabIds = [];
  for (const node of layout.tree) {
    if (node.tabId !== tabId && branch.has(node.parentTabId)) {
      branch.add(node.tabId);
      flattenedTabIds.push(node.tabId);
    }
  }
  if (flattenedTabIds.length === 0) {
    return null;
  }
  root.collapsed = false;
  for (const node of layout.tree) {
    if (node.tabId !== tabId && branch.has(node.tabId)) {
      node.parentTabId = root.parentTabId;
      node.collapsed = false;
    }
  }
  repairWorkspaceTree(layout);
  return { rootTabId: tabId, flattenedTabIds };
}

export function setLogicalGroupCollapsed(windowRuntime, groupId, collapsed) {
  if (typeof collapsed !== "boolean") {
    return false;
  }
  for (const layout of windowRuntime.workspaceLayouts) {
    const group = layout.groups.find((entry) => entry.id === groupId);
    if (group) {
      group.collapsed = collapsed;
      return true;
    }
  }
  return false;
}

export function setLogicalGroupTitle(windowRuntime, groupId, title) {
  if (
    typeof title !== "string" ||
    title.length > MAX_GROUP_TITLE_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(title)
  ) {
    return false;
  }
  for (const layout of windowRuntime.workspaceLayouts) {
    const group = layout.groups.find((entry) => entry.id === groupId);
    if (group) {
      group.title = title;
      return true;
    }
  }
  return false;
}

export function deleteLogicalGroup(windowRuntime, workspaceId, groupId) {
  if (typeof workspaceId !== "string" || typeof groupId !== "string") {
    return null;
  }
  const layout = windowRuntime.workspaceLayouts.find(
    (entry) => entry.workspaceId === workspaceId
  );
  const group = layout?.groups.find((entry) => entry.id === groupId);
  if (!layout || !group) {
    return null;
  }
  layout.groups = layout.groups.filter((entry) => entry.id !== groupId);
  repairWorkspaceTree(layout);
  return {
    workspaceId,
    logicalGroupId: groupId,
    memberTabIds: [...group.tabIds]
  };
}

export function relocateLogicalTabs({ runtime, windowRuntime, tabIds, destination }) {
  if (!Array.isArray(tabIds) || tabIds.length === 0 || new Set(tabIds).size !== tabIds.length) {
    return null;
  }
  if (
    !destination ||
    !["pinned", "ungrouped", "group"].includes(destination.zone) ||
    !["before", "after", "end", "inside"].includes(destination.relation) ||
    typeof destination.workspaceId !== "string" ||
    !Object.prototype.hasOwnProperty.call(destination, "anchorTabId") ||
    !Object.prototype.hasOwnProperty.call(destination, "groupId") ||
    !Object.prototype.hasOwnProperty.call(destination, "parentTabId")
  ) {
    return null;
  }
  const placements = tabIds.map((tabId) => findWorkspaceLayoutForTab(windowRuntime, tabId));
  const sourceLayout = placements[0]?.layout;
  if (!sourceLayout || placements.some((placement) => placement?.layout !== sourceLayout)) {
    return null;
  }
  const sourceIndex = new Map(sourceLayout.tabIds.map((tabId, index) => [tabId, index]));
  const orderedIds = [...tabIds].sort((left, right) => sourceIndex.get(left) - sourceIndex.get(right));
  const movingSet = new Set(orderedIds);
  const movingSplitViews = (sourceLayout.splitViews ?? []).filter((splitView) =>
    splitView.tabIds.some((tabId) => movingSet.has(tabId))
  );
  if (
    movingSplitViews.some(
      (splitView) => !splitView.tabIds.every((tabId) => movingSet.has(tabId))
    ) ||
    (movingSplitViews.length > 0 && destination.zone === "pinned")
  ) {
    return null;
  }
  if (
    destination.anchorTabId !== null &&
    movingSet.has(destination.anchorTabId)
  ) {
    return null;
  }
  const assignments = new Map(runtime.tabs.map((entry) => [entry.id, entry]));
  if (orderedIds.some((tabId) => !assignments.has(tabId))) {
    return null;
  }

  const existingTarget = windowRuntime.workspaceLayouts.find(
    (layout) => layout.workspaceId === destination.workspaceId
  );
  if (
    (destination.anchorTabId !== null &&
      (!existingTarget?.tabIds.includes(destination.anchorTabId) ||
        movingSet.has(destination.anchorTabId))) ||
    (destination.parentTabId !== null &&
      (!existingTarget?.tabIds.includes(destination.parentTabId) ||
        movingSet.has(destination.parentTabId))) ||
    (destination.zone === "group" &&
      !existingTarget?.groups.some((group) => group.id === destination.groupId)) ||
    (destination.zone !== "group" && destination.groupId !== null) ||
    (destination.zone === "pinned" && destination.parentTabId !== null) ||
    (destination.relation === "inside" &&
      (destination.anchorTabId === null ||
        destination.parentTabId !== destination.anchorTabId)) ||
    (destination.relation !== "inside" && destination.parentTabId !== null &&
      destination.anchorTabId === null)
  ) {
    return null;
  }
  if (existingTarget) {
    const existingPinSet = new Set(existingTarget.pinnedTabIds);
    const existingGroupMap = groupIdByTab(existingTarget);
    if (
      (destination.anchorTabId !== null &&
        ((destination.zone === "pinned") !== existingPinSet.has(destination.anchorTabId) ||
          (destination.zone === "group" &&
            existingGroupMap.get(destination.anchorTabId) !== destination.groupId) ||
          (destination.zone === "ungrouped" &&
            existingGroupMap.has(destination.anchorTabId) &&
            !anchorsOutsideGroupBoundary(existingTarget, destination, movingSet)))) ||
      (destination.parentTabId !== null &&
        (existingPinSet.has(destination.parentTabId) ||
          existingGroupMap.get(destination.parentTabId) !==
            (destination.zone === "group" ? destination.groupId : undefined)))
    ) {
      return null;
    }
    if (
      existingTarget === sourceLayout &&
      (treeTargetDescendsFromSelection(sourceLayout, destination.anchorTabId, movingSet) ||
        treeTargetDescendsFromSelection(sourceLayout, destination.parentTabId, movingSet))
    ) {
      return null;
    }
  }

  const movingSplitIds = new Set(movingSplitViews.map((splitView) => splitView.id));
  if ((existingTarget?.splitViews ?? []).some((splitView) => movingSplitIds.has(splitView.id))) {
    return null;
  }

  const originalNodes = new Map(
    (sourceLayout.tree ?? [])
      .filter((node) => movingSet.has(node.tabId))
      .map((node) => [node.tabId, { ...node }])
  );
  removeTabsFromLayout(sourceLayout, orderedIds);
  for (const tabId of orderedIds) {
    assignments.get(tabId).workspaceId = destination.workspaceId;
  }
  const targetLayout = ensureWorkspaceLayout(windowRuntime, destination.workspaceId);
  const targetGroup = destination.zone === "group"
    ? targetLayout.groups.find((group) => group.id === destination.groupId)
    : null;
  const insertionIndex = insertionIndexFor(targetLayout, destination);
  targetLayout.tabIds.splice(insertionIndex, 0, ...orderedIds);
  if (destination.zone === "pinned") {
    const pinInsertion = destination.anchorTabId === null
      ? targetLayout.pinnedTabIds.length
      : targetLayout.pinnedTabIds.indexOf(destination.anchorTabId) +
        (destination.relation === "after" ? 1 : 0);
    targetLayout.pinnedTabIds.splice(pinInsertion, 0, ...orderedIds);
  }
  if (targetGroup) {
    let groupInsertion = targetGroup.tabIds.length;
    if (destination.anchorTabId !== null) {
      groupInsertion = targetGroup.tabIds.filter(
        (tabId) => targetLayout.tabIds.indexOf(tabId) < insertionIndex
      ).length;
    }
    targetGroup.tabIds.splice(groupInsertion, 0, ...orderedIds);
  }

  const insertedNodes = orderedIds.map((tabId) => {
    const previous = originalNodes.get(tabId) ?? rootTreeNode(tabId);
    const retainedParent = movingSet.has(previous.parentTabId) ? previous.parentTabId : null;
    return {
      tabId,
      parentTabId:
        destination.zone === "pinned"
          ? null
          : retainedParent ?? destination.parentTabId,
      collapsed: destination.zone === "pinned" ? false : previous.collapsed
    };
  });
  targetLayout.tree.splice(insertionIndex, 0, ...insertedNodes);
  targetLayout.splitViews.push(
    ...movingSplitViews.map((splitView) => ({
      ...splitView,
      tabIds: [...splitView.tabIds]
    }))
  );
  targetLayout.splitViews.sort(
    (left, right) =>
      targetLayout.tabIds.indexOf(left.tabIds[0]) -
      targetLayout.tabIds.indexOf(right.tabIds[0])
  );
  repairWorkspaceTree(targetLayout);
  return {
    sourceWorkspaceId: sourceLayout.workspaceId,
    destinationWorkspaceId: destination.workspaceId,
    tabIds: orderedIds
  };
}

export function relocateLogicalSelection({
  runtime,
  windowRuntime,
  tabIds,
  sourceWorkspaceId,
  destinationWorkspaceId
}) {
  if (
    !runtime ||
    !windowRuntime ||
    !Array.isArray(tabIds) ||
    tabIds.length === 0 ||
    tabIds.some((tabId) => typeof tabId !== "string") ||
    new Set(tabIds).size !== tabIds.length ||
    typeof sourceWorkspaceId !== "string" ||
    typeof destinationWorkspaceId !== "string" ||
    sourceWorkspaceId === destinationWorkspaceId
  ) {
    return null;
  }

  const sourceLayout = windowRuntime.workspaceLayouts.find(
    (layout) => layout.workspaceId === sourceWorkspaceId
  );
  const targetLayout = windowRuntime.workspaceLayouts.find(
    (layout) => layout.workspaceId === destinationWorkspaceId
  );
  const movingSet = new Set(tabIds);
  const orderedIds = sourceLayout?.tabIds.filter((tabId) => movingSet.has(tabId)) ?? [];
  const assignments = new Map(runtime.tabs.map((entry) => [entry.id, entry]));
  const completeSplitViews = (sourceLayout?.splitViews ?? []).filter((splitView) =>
    splitView.tabIds.some((tabId) => movingSet.has(tabId))
  );
  if (
    !sourceLayout ||
    orderedIds.length !== tabIds.length ||
    orderedIds.some(
      (tabId) => assignments.get(tabId)?.workspaceId !== sourceWorkspaceId
    ) ||
    targetLayout?.tabIds.some((tabId) => movingSet.has(tabId)) ||
    completeSplitViews.some(
      (splitView) => !splitView.tabIds.every((tabId) => movingSet.has(tabId))
    ) ||
    (targetLayout?.splitViews ?? []).some((candidate) =>
      completeSplitViews.some((splitView) => splitView.id === candidate.id)
    )
  ) {
    return null;
  }

  const sourcePinSet = new Set(sourceLayout.pinnedTabIds);
  const sourceGroupByTab = groupIdByTab(sourceLayout);
  if (
    sourceLayout.pinnedTabIds.some(
      (tabId) => !sourceLayout.tabIds.includes(tabId) || sourceGroupByTab.has(tabId)
    ) ||
    sourceLayout.groups.some(
      (group) =>
        group.tabIds.length === 0 ||
        group.tabIds.some(
          (tabId) => !sourceLayout.tabIds.includes(tabId) || sourcePinSet.has(tabId)
        )
    )
  ) {
    return null;
  }

  const completeGroups = sourceLayout.groups
    .filter((group) => group.tabIds.every((tabId) => movingSet.has(tabId)))
    .sort(
      (left, right) =>
        sourceLayout.tabIds.indexOf(left.tabIds[0]) -
        sourceLayout.tabIds.indexOf(right.tabIds[0])
    );
  const movingGroupIds = new Set(completeGroups.map(({ id }) => id));
  if (targetLayout?.groups.some(({ id }) => movingGroupIds.has(id))) {
    return null;
  }

  const sourceNext = structuredClone(sourceLayout);
  const targetNext = targetLayout
    ? structuredClone(targetLayout)
    : {
        workspaceId: destinationWorkspaceId,
        tabIds: [],
        pinnedTabIds: [],
        groups: [],
        tree: [],
        splitViews: []
      };
  sourceNext.splitViews ??= [];
  targetNext.splitViews ??= [];
  repairWorkspaceTree(sourceNext);
  repairWorkspaceTree(targetNext);
  const sourceNodeByTab = new Map(
    sourceNext.tree.map((node) => [node.tabId, { ...node }])
  );
  const movingPinnedIds = sourceLayout.pinnedTabIds.filter((tabId) => movingSet.has(tabId));
  const movingPinnedSet = new Set(movingPinnedIds);
  const movingNormalIds = orderedIds.filter((tabId) => !movingPinnedSet.has(tabId));
  const movedCompleteGroupByTab = new Map();
  for (const group of completeGroups) {
    for (const tabId of group.tabIds) {
      movedCompleteGroupByTab.set(tabId, group.id);
    }
  }
  const destinationPartition = (tabId) => {
    if (movingPinnedSet.has(tabId)) {
      return "pinned";
    }
    const groupId = movedCompleteGroupByTab.get(tabId);
    return groupId ? `group:${groupId}` : "ungrouped";
  };

  removeTabsFromLayout(sourceNext, orderedIds);

  let pinInsertionIndex = 0;
  const targetPinSet = new Set(targetNext.pinnedTabIds);
  for (let index = 0; index < targetNext.tabIds.length; index += 1) {
    if (targetPinSet.has(targetNext.tabIds[index])) {
      pinInsertionIndex = index + 1;
    }
  }
  targetNext.tabIds.splice(pinInsertionIndex, 0, ...movingPinnedIds);
  targetNext.pinnedTabIds.push(...movingPinnedIds);
  targetNext.tree.splice(
    pinInsertionIndex,
    0,
    ...movingPinnedIds.map(rootTreeNode)
  );

  const normalNodes = movingNormalIds.map((tabId) => {
    const previous = sourceNodeByTab.get(tabId) ?? rootTreeNode(tabId);
    const parentTabId =
      movingSet.has(previous.parentTabId) &&
      destinationPartition(previous.parentTabId) === destinationPartition(tabId)
        ? previous.parentTabId
        : null;
    return { tabId, parentTabId, collapsed: previous.collapsed };
  });
  targetNext.tabIds.push(...movingNormalIds);
  targetNext.tree.push(...normalNodes);
  targetNext.groups.push(
    ...completeGroups.map((group) => ({ ...group, tabIds: [...group.tabIds] }))
  );
  targetNext.splitViews.push(
    ...completeSplitViews.map((splitView) => ({
      ...splitView,
      tabIds: [...splitView.tabIds]
    }))
  );
  targetNext.splitViews.sort(
    (left, right) =>
      targetNext.tabIds.indexOf(left.tabIds[0]) -
      targetNext.tabIds.indexOf(right.tabIds[0])
  );
  targetNext.groups.sort(
    (left, right) =>
      targetNext.tabIds.indexOf(left.tabIds[0]) -
      targetNext.tabIds.indexOf(right.tabIds[0])
  );
  repairWorkspaceTree(targetNext);

  Object.assign(sourceLayout, sourceNext);
  if (targetLayout) {
    Object.assign(targetLayout, targetNext);
  } else {
    windowRuntime.workspaceLayouts.push(targetNext);
  }
  for (const tabId of orderedIds) {
    assignments.get(tabId).workspaceId = destinationWorkspaceId;
  }

  return {
    sourceWorkspaceId,
    destinationWorkspaceId,
    tabIds: orderedIds,
    pinnedTabIds: movingPinnedIds,
    completeGroupIds: completeGroups.map(({ id }) => id)
  };
}

// A group never lands inside a tab tree: not before a nested tab, and not
// after a tab whose own branch or an enclosing branch continues below it.
// Anchors inside another group resolve to that group's edge first.
function groupAnchorSplitsBranch(layout, destination, memberSet) {
  const tabIds = layout.tabIds.filter((tabId) => !memberSet.has(tabId));
  const anchorGroup = layout.groups.find((group) =>
    group.tabIds.includes(destination.anchorTabId)
  );
  const anchorTabId = !anchorGroup
    ? destination.anchorTabId
    : destination.relation === "before"
      ? anchorGroup.tabIds[0]
      : anchorGroup.tabIds.at(-1);
  const parentById = new Map((layout.tree ?? []).map((node) => [node.tabId, node.parentTabId]));
  const ancestry = (tabId) => {
    const chain = new Set();
    for (let id = tabId; id !== null && id !== undefined && !chain.has(id); id = parentById.get(id) ?? null) {
      chain.add(id);
    }
    return chain;
  };
  if (destination.relation === "before") {
    return (parentById.get(anchorTabId) ?? null) !== null;
  }
  const nextTabId = tabIds[tabIds.indexOf(anchorTabId) + 1];
  if (nextTabId === undefined) {
    return false;
  }
  const enclosing = ancestry(anchorTabId);
  const nextAncestors = ancestry(parentById.get(nextTabId) ?? null);
  return [...nextAncestors].some((tabId) => enclosing.has(tabId));
}

export function relocateLogicalGroup({
  runtime,
  windowRuntime,
  groupId,
  sourceWorkspaceId,
  memberTabIds,
  destination
}) {
  if (
    typeof groupId !== "string" ||
    typeof sourceWorkspaceId !== "string" ||
    !Array.isArray(memberTabIds) ||
    memberTabIds.length === 0 ||
    new Set(memberTabIds).size !== memberTabIds.length ||
    !destination ||
    typeof destination.workspaceId !== "string" ||
    !["before", "after", "end"].includes(destination.relation) ||
    !Object.prototype.hasOwnProperty.call(destination, "anchorTabId") ||
    (destination.anchorTabId !== null && typeof destination.anchorTabId !== "string")
  ) {
    return null;
  }
  const sourceLayout = windowRuntime.workspaceLayouts.find(
    (layout) => layout.workspaceId === sourceWorkspaceId
  );
  const sourceGroup = sourceLayout?.groups.find((group) => group.id === groupId);
  if (!sourceGroup || !arraysEqual(sourceGroup.tabIds, memberTabIds)) {
    return null;
  }
  const memberSet = new Set(memberTabIds);
  const existingTarget = windowRuntime.workspaceLayouts.find(
    (layout) => layout.workspaceId === destination.workspaceId
  );
  if (
    destination.anchorTabId !== null &&
    (!existingTarget?.tabIds.includes(destination.anchorTabId) ||
      existingTarget.pinnedTabIds.includes(destination.anchorTabId) ||
      memberSet.has(destination.anchorTabId) ||
      groupAnchorSplitsBranch(existingTarget, destination, memberSet))
  ) {
    return null;
  }
  const assignments = new Map(runtime.tabs.map((entry) => [entry.id, entry]));
  if (
    memberTabIds.some(
      (tabId) => assignments.get(tabId)?.workspaceId !== sourceWorkspaceId
    )
  ) {
    return null;
  }

  const movingTree = sourceLayout.tree
    .filter((node) => memberSet.has(node.tabId))
    .map((node) => ({ ...node }));
  const movingSplitViews = (sourceLayout.splitViews ?? [])
    .filter((splitView) => splitView.tabIds.every((tabId) => memberSet.has(tabId)))
    .map((splitView) => ({ ...splitView, tabIds: [...splitView.tabIds] }));
  const group = {
    ...sourceGroup,
    tabIds: [...sourceGroup.tabIds]
  };
  sourceLayout.tabIds = sourceLayout.tabIds.filter((tabId) => !memberSet.has(tabId));
  sourceLayout.pinnedTabIds = sourceLayout.pinnedTabIds.filter((tabId) => !memberSet.has(tabId));
  sourceLayout.groups = sourceLayout.groups.filter((entry) => entry.id !== groupId);
  sourceLayout.tree = sourceLayout.tree.filter((node) => !memberSet.has(node.tabId));
  sourceLayout.splitViews = (sourceLayout.splitViews ?? []).filter(
    (splitView) => !splitView.tabIds.some((tabId) => memberSet.has(tabId))
  );
  repairWorkspaceTree(sourceLayout);

  const targetLayout = ensureWorkspaceLayout(windowRuntime, destination.workspaceId);
  let insertionIndex = targetLayout.tabIds.length;
  if (destination.anchorTabId !== null) {
    const anchorGroup = targetLayout.groups.find((entry) =>
      entry.tabIds.includes(destination.anchorTabId)
    );
    const anchorTabId = destination.relation === "before"
      ? anchorGroup?.tabIds[0] ?? destination.anchorTabId
      : anchorGroup?.tabIds.at(-1) ?? destination.anchorTabId;
    insertionIndex = targetLayout.tabIds.indexOf(anchorTabId) +
      (destination.relation === "after" ? 1 : 0);
  }
  targetLayout.tabIds.splice(insertionIndex, 0, ...memberTabIds);
  targetLayout.tree.splice(insertionIndex, 0, ...movingTree);
  targetLayout.groups.push(group);
  targetLayout.splitViews.push(...movingSplitViews);
  targetLayout.groups.sort(
    (left, right) =>
      targetLayout.tabIds.indexOf(left.tabIds[0]) -
      targetLayout.tabIds.indexOf(right.tabIds[0])
  );
  for (const tabId of memberTabIds) {
    assignments.get(tabId).workspaceId = destination.workspaceId;
  }
  repairWorkspaceTree(targetLayout);
  return {
    sourceWorkspaceId,
    destinationWorkspaceId: destination.workspaceId,
    logicalGroupId: groupId,
    memberTabIds: [...memberTabIds]
  };
}

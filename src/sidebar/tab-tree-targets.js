function childrenByParent(activeTabs) {
  const children = new Map();
  for (const tab of activeTabs) {
    if (tab.parentTabId === null) continue;
    const siblings = children.get(tab.parentTabId) ?? [];
    siblings.push(tab.logicalId);
    children.set(tab.parentTabId, siblings);
  }
  return children;
}

// Unloading a tab also unloads every tab nested under it, including tabs
// hidden inside a collapsed branch. Its parent is never added, and the result
// keeps the tab pane's order.
export function withTreeDescendants(activeTabs, rows) {
  const children = childrenByParent(activeTabs);
  const selected = new Set();
  const pending = rows.map(({ logicalId }) => logicalId);
  while (pending.length > 0) {
    const logicalId = pending.pop();
    if (selected.has(logicalId)) continue;
    selected.add(logicalId);
    pending.push(...(children.get(logicalId) ?? []));
  }
  return activeTabs.filter(({ logicalId }) => selected.has(logicalId));
}

import { groupDestinationForRow } from "./sidebar-interactions.js";

function subtreeIds(children, rootId) {
  const ids = new Set();
  const pending = [rootId];
  while (pending.length > 0) {
    const logicalId = pending.pop();
    if (ids.has(logicalId)) continue;
    ids.add(logicalId);
    pending.push(...(children.get(logicalId) ?? []));
  }
  return ids;
}

// The ancestor of `tab` (or `tab` itself) whose parent is `parentTabId`, or
// null when `tab` is not nested under that parent at all.
function ancestorAtLevel(tabById, tab, parentTabId) {
  const seen = new Set();
  for (let node = tab; node && !seen.has(node.logicalId); node = tabById.get(node.parentTabId)) {
    if (node.parentTabId === parentTabId) return node;
    seen.add(node.logicalId);
    if (node.parentTabId === null) return null;
  }
  return null;
}

function topAncestor(tabById, tab) {
  return ancestorAtLevel(tabById, tab, null) ?? tab;
}

// Split View panes move as one pair, so an anchor on a pane widens to the
// pair's outer edge in the direction of the insertion.
function splitEdge(activeTabs, tab, relation) {
  if (tab.splitViewId === null) return tab;
  const panes = activeTabs.filter(({ splitViewId }) => splitViewId === tab.splitViewId);
  return relation === "before" ? panes[0] ?? tab : panes.at(-1) ?? tab;
}

// Mirrors the controller's rule that no placement may separate a Split View
// pair, so a menu never offers a move that would be refused.
export function destinationSplitsPair(tabById, destination) {
  const anchor = tabById.get(destination.anchorTabId);
  const parent = tabById.get(destination.parentTabId);
  if ((anchor?.splitViewId ?? null) === null && (parent?.splitViewId ?? null) === null) {
    return false;
  }
  return (
    (destination.parentTabId ?? null) !== null ||
    destination.relation === "inside" ||
    (anchor?.splitPosition === "start" && destination.relation === "after") ||
    (anchor?.splitPosition === "end" && destination.relation === "before")
  );
}

function lastStayingTab(activeTabs, ids, moving) {
  return activeTabs.findLast(({ logicalId }) => ids.has(logicalId) && !moving.has(logicalId)) ?? null;
}

// Move up/down for a descendant-closed moving set. The unit holding the
// clicked tab picks one destination for every moving unit: the nearest
// sibling unit, then just outside its parent, then just outside its group.
// Null means the move is not offered.
export function tabMoveDestination(view, movingRows, clickedTab, direction) {
  const tabs = view.activeTabs;
  const tabById = new Map(tabs.map((tab) => [tab.logicalId, tab]));
  const moving = new Set(movingRows.map(({ logicalId }) => logicalId));
  if (!moving.has(clickedTab.logicalId) || !["up", "down"].includes(direction)) {
    return null;
  }
  let root = tabById.get(clickedTab.logicalId);
  while (root.parentTabId !== null && moving.has(root.parentTabId) && tabById.has(root.parentTabId)) {
    root = tabById.get(root.parentTabId);
  }
  const children = childrenByParent(tabs);
  const unitIds = subtreeIds(children, root.logicalId);
  const up = direction === "up";
  const relation = up ? "before" : "after";
  const place = (anchor, overrides) => {
    const edge = splitEdge(tabs, anchor, relation);
    const destination = {
      workspaceId: root.workspaceId,
      zone: root.pinned ? "pinned" : root.groupId === null ? "ungrouped" : "group",
      relation,
      anchorTabId: edge.logicalId,
      groupId: root.groupId,
      parentTabId: root.parentTabId,
      ...overrides
    };
    return destinationSplitsPair(tabById, destination) ? null : destination;
  };

  const rootIndex = tabs.indexOf(root);
  const unitEnd = tabs.findLastIndex(({ logicalId }) => unitIds.has(logicalId));
  for (
    let index = up ? rootIndex - 1 : unitEnd + 1;
    index >= 0 && index < tabs.length;
    index += up ? -1 : 1
  ) {
    const row = tabs[index];
    if (moving.has(row.logicalId)) continue;
    if (root.pinned !== row.pinned) break;
    if (root.pinned) return place(row, {});
    if (root.groupId === null && root.parentTabId === null && row.groupId !== null) {
      const members = tabs.filter(
        (tab) => tab.groupId === row.groupId && !moving.has(tab.logicalId)
      );
      return place(up ? members[0] : members.at(-1), {});
    }
    if (row.groupId !== root.groupId) break;
    const sibling = ancestorAtLevel(tabById, row, root.parentTabId);
    if (!sibling) break;
    return place(
      up ? sibling : lastStayingTab(tabs, subtreeIds(children, sibling.logicalId), moving),
      {}
    );
  }

  if (root.pinned) return null;
  const parent = tabById.get(root.parentTabId);
  if (parent) {
    return place(
      up ? parent : lastStayingTab(tabs, subtreeIds(children, parent.logicalId), moving),
      { parentTabId: parent.parentTabId }
    );
  }
  if (root.groupId !== null) {
    const members = tabs.filter(
      (tab) => tab.groupId === root.groupId && !moving.has(tab.logicalId)
    );
    if (members.length === 0) return null;
    return place(up ? members[0] : members.at(-1), {
      zone: "ungrouped",
      groupId: null,
      parentTabId: null
    });
  }
  return null;
}

// Group up/down steps over whole top-level units: another group or an
// ungrouped tab tree. Pinned tabs are never a neighbor.
export function groupMoveDestination(view, group, direction) {
  const tabs = view.activeTabs;
  const tabById = new Map(tabs.map((tab) => [tab.logicalId, tab]));
  const members = new Set(group.tabIds);
  const up = direction === "up";
  const relation = up ? "before" : "after";
  const first = tabs.findIndex(({ logicalId }) => members.has(logicalId));
  const last = tabs.findLastIndex(({ logicalId }) => members.has(logicalId));
  if (first < 0 || !["up", "down"].includes(direction)) return null;
  for (let index = up ? first - 1 : last + 1; index >= 0 && index < tabs.length; index += up ? -1 : 1) {
    const row = tabs[index];
    if (members.has(row.logicalId)) continue;
    if (row.pinned) return null;
    let anchor;
    if (row.groupId !== null) {
      const neighbor = tabs.filter((tab) => tab.groupId === row.groupId);
      anchor = up ? neighbor[0] : neighbor.at(-1);
    } else {
      const root = topAncestor(tabById, row);
      const branch = subtreeIds(childrenByParent(tabs), root.logicalId);
      anchor = up ? root : tabs.findLast(({ logicalId }) => branch.has(logicalId));
    }
    return groupDestinationForRow(splitEdge(tabs, anchor, relation), relation);
  }
  return null;
}

// A group dropped on a nested ungrouped row lands beside that row's whole
// top-level tree instead of splitting it.
export function snapGroupDropToBranch(view, tab, relation) {
  if (!["before", "after"].includes(relation)) return null;
  let anchor = tab;
  if (!tab.pinned && tab.groupId === null) {
    const tabById = new Map(view.activeTabs.map((row) => [row.logicalId, row]));
    const root = topAncestor(tabById, tab);
    const branch = subtreeIds(childrenByParent(view.activeTabs), root.logicalId);
    anchor = relation === "before"
      ? root
      : view.activeTabs.findLast(({ logicalId }) => branch.has(logicalId)) ?? tab;
  }
  return groupDestinationForRow(splitEdge(view.activeTabs, anchor, relation), relation);
}

// Enough shape per nested tab to draw a real branch: the connector tying it to
// its parent, and which ancestor columns still have a sibling below them and so
// keep their trunk running. A single repeating stripe cannot express this - it
// draws a trunk beside every ancestor, including branches that already ended.
//
// Only drawn rows count as siblings, so a tab inside a collapsed branch never
// leaves a trunk hanging. Siblings must also share a group: members render
// inside their own group section, and a line across that boundary would point
// at a row that is not there.
export function treeBranchShape(activeTabs) {
  const visible = activeTabs.filter(
    (tab) => tab.pinned !== true && tab.hiddenByCollapsedAncestor !== true
  );
  const tabById = new Map(visible.map((tab) => [tab.logicalId, tab]));
  const lastChild = new Map();
  const siblingBelow = new Set();
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const tab = visible[index];
    const siblingKey = `${tab.groupId ?? ""}\u0000${tab.parentTabId ?? ""}`;
    lastChild.set(tab.logicalId, !siblingBelow.has(siblingKey));
    siblingBelow.add(siblingKey);
  }

  const shapes = new Map();
  for (const tab of visible) {
    if (tab.parentTabId === null) {
      continue;
    }
    const trunks = [];
    // Walk parent-first up to but excluding the root, so trunks[0] is the
    // outermost column and the tab's own connector follows the last trunk.
    let ancestor = tabById.get(tab.parentTabId);
    while (ancestor && ancestor.parentTabId !== null) {
      trunks.unshift(lastChild.get(ancestor.logicalId) === false);
      ancestor = tabById.get(ancestor.parentTabId);
    }
    shapes.set(tab.logicalId, Object.freeze({
      depth: trunks.length + 1,
      lastChild: lastChild.get(tab.logicalId) === true,
      trunks: Object.freeze(trunks)
    }));
  }
  return shapes;
}

// For each tab with nested tabs: how many tabs sit under it at every level,
// hidden ones included, and whether any of them is loaded. A collapsed branch
// shows this as its count badge.
export function treeDescendantSummary(activeTabs) {
  const children = childrenByParent(activeTabs);
  const tabById = new Map(activeTabs.map((tab) => [tab.logicalId, tab]));
  const summaries = new Map();
  function summarize(logicalId) {
    if (summaries.has(logicalId)) {
      return summaries.get(logicalId);
    }
    let count = 0;
    let anyLoaded = false;
    for (const childId of children.get(logicalId) ?? []) {
      const child = tabById.get(childId);
      const nested = summarize(childId);
      count += 1 + nested.count;
      anyLoaded = anyLoaded || child.discarded === false || nested.anyLoaded;
    }
    const summary = Object.freeze({ count, anyLoaded });
    summaries.set(logicalId, summary);
    return summary;
  }
  for (const tab of activeTabs) {
    summarize(tab.logicalId);
  }
  return new Map([...summaries].filter(([, { count }]) => count > 0));
}

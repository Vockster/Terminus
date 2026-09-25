import {
  destinationForTabRow,
  destinationForZone,
  groupDestinationForRow,
  groupDestinationForWorkspace
} from "./sidebar-interactions.js";
import { destinationSplitsPair, snapGroupDropToBranch } from "./tab-tree-targets.js";

// Share of a tab row on each edge that means "between"; the middle nests.
const TAB_EDGE_BAND = 0.35;

// Resolves a drag position over the tab list to one placement. Every point
// maps to a slot: the gaps between rows, the space above the first row and
// below the last belong to the nearest gap, so nothing silently falls through
// to a zone default. A gap may offer several tree levels; Full Labels picks
// one from the pointer's horizontal position, Icons Only (no indent) from the
// upper or lower half of the gap.
//
// `entries` are the visible rows in list order, measured in one coordinate
// space with the pointer: { kind: "tab", tab } or { kind: "group", group },
// plus top, bottom, left, and contentStart (where this row's depth begins).
// `drag` is { kind: "tabs", tabIds } or { kind: "group", groupId }.
//
// The result is null for an invalid spot, or { destination, indicator } with
// indicator { entryIndex, edge: "before" | "after" | "inside", indent }; indent
// is the line's inline offset from the entry's left edge, or null for full width.
export function resolveTabDrop({ entries, view, pointer, drag, iconsOnly, indentStep }) {
  const workspaceId = view.activeWorkspaceId;
  if (entries.length === 0) {
    return {
      destination: drag.kind === "tabs"
        ? destinationForZone(workspaceId, "ungrouped")
        : groupDestinationForWorkspace(workspaceId),
      indicator: null
    };
  }
  const hit = hitTest(entries, pointer.y);
  const entry = entries[hit.index];
  if (isBlocked(entry, drag)) {
    return null;
  }
  const context = { entries, view, drag, workspaceId, pointer, iconsOnly, indentStep };
  return drag.kind === "tabs"
    ? resolveTabsDrop(context, hit)
    : resolveGroupDrop(context, hit);
}

// The entry under or nearest to `y`: each gap is split at its midpoint.
// `part` is "row" with a 0-1 `ratio`, or "above"/"below" for gap space, and
// `end` marks space past the last row.
function hitTest(entries, y) {
  const last = entries.length - 1;
  let index = 0;
  while (index < last && y >= (entries[index].bottom + entries[index + 1].top) / 2) {
    index += 1;
  }
  const { top, bottom } = entries[index];
  if (y < top) return { index, part: "above" };
  if (y > bottom) return { index, part: "below", end: index === last };
  return { index, part: "row", ratio: bottom > top ? (y - top) / (bottom - top) : 0.5 };
}

// A dragged row (or one nested under it) is never a target; a dragged group
// also cannot land among pinned tabs or its own members.
function isBlocked(entry, drag) {
  if (drag.kind === "tabs") {
    return entry.kind === "tab" && drag.tabIds.has(entry.tab.logicalId);
  }
  if (entry.kind === "group") return entry.group.id === drag.groupId;
  return entry.tab.pinned || entry.tab.groupId === drag.groupId;
}

function tabZone(tab) {
  return tab.pinned ? "pinned" : tab.groupId === null ? "ungrouped" : "group";
}

function edgeFor(hit, before, after) {
  if (hit.part === "above") return "before";
  if (hit.part === "below") return "after";
  if (hit.ratio < before) return "before";
  if (hit.ratio > after || before === after) return "after";
  return "inside";
}

function resolveTabsDrop(context, hit) {
  const { entries } = context;
  const entry = entries[hit.index];
  let edge;
  if (entry.kind === "group") {
    edge = edgeFor(hit, TAB_EDGE_BAND, 1 - TAB_EDGE_BAND);
  } else if (entry.tab.splitViewId !== null && hit.part === "row") {
    // A Split View pair is never separated or nested into.
    edge = entry.tab.splitPosition === "start" ? "before" : "after";
  } else if (entry.tab.pinned) {
    edge = edgeFor(hit, 0.5, 0.5);
  } else {
    edge = edgeFor(hit, TAB_EDGE_BAND, 1 - TAB_EDGE_BAND);
  }

  if (edge === "inside") {
    const destination = entry.kind === "group"
      ? destinationForZone(context.workspaceId, "group", entry.group.id)
      : destinationForTabRow(entry.tab, "inside");
    return destination
      ? { destination, indicator: { entryIndex: hit.index, edge: "inside", indent: null } }
      : null;
  }

  const upperIndex = edge === "after" ? hit.index : previousStaying(context, hit.index);
  const lowerIndex = edge === "before" ? hit.index : nextStaying(context, hit.index);
  const options = gapOptions(context, upperIndex, lowerIndex);
  if (options.length === 0) return null;
  let option;
  if (options.length === 1) {
    option = options[0];
  } else if (hit.end || context.iconsOnly || options.byHalf) {
    option = edge === "after" && !hit.end ? options[0] : options.at(-1);
  } else {
    const reach = context.pointer.x + context.indentStep / 2;
    option = options.find(({ startX }) => startX <= reach) ?? options.at(-1);
  }
  const markIndex = upperIndex ?? lowerIndex;
  const markEntry = entries[markIndex];
  return {
    destination: option.destination,
    indicator: {
      entryIndex: markIndex,
      edge: upperIndex === null ? "before" : "after",
      indent: option.startX === null ? null : Math.max(0, option.startX - markEntry.left)
    }
  };
}

function previousStaying(context, index) {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (!isBlocked(context.entries[candidate], context.drag)) return candidate;
  }
  return null;
}

function nextStaying(context, index) {
  for (let candidate = index + 1; candidate < context.entries.length; candidate += 1) {
    if (!isBlocked(context.entries[candidate], context.drag)) return candidate;
  }
  return null;
}

function stayingMembers(context, group) {
  return group.tabIds.filter((tabId) => !context.drag.tabIds.has(tabId));
}

function groupHeaderEntry(context, groupId) {
  return context.entries.find((entry) => entry.kind === "group" && entry.group.id === groupId);
}

// Placements for the gap between the upper and lower staying entries, deepest
// level first. Each option carries the x where its level starts.
function gapOptions(context, upperIndex, lowerIndex) {
  const { entries, workspaceId } = context;
  const upper = upperIndex === null ? null : entries[upperIndex];
  const lower = lowerIndex === null ? null : entries[lowerIndex];
  const options = [];
  const add = (destination, startX) => {
    if (destination && !splitsPair(context, destination)) options.push({ destination, startX });
  };

  if (upper === null) {
    if (lower !== null) add(...beforeEntry(context, lower));
    return options;
  }

  if (upper.kind === "group") {
    const group = upper.group;
    if (lower?.kind === "tab" && lower.tab.groupId === group.id) {
      add({
        workspaceId,
        zone: "group",
        relation: "before",
        anchorTabId: lower.tab.logicalId,
        groupId: group.id,
        parentTabId: null
      }, lower.contentStart);
    } else {
      addOutsideGroup(context, group, add, upper.contentStart);
    }
    return options;
  }

  const tab = upper.tab;
  if (tab.pinned) {
    add({
      workspaceId,
      zone: "pinned",
      relation: "after",
      anchorTabId: tab.logicalId,
      groupId: null,
      parentTabId: null
    }, null);
    if (lower === null) {
      add(destinationForZone(workspaceId, "ungrouped"), null);
    } else if (!(lower.kind === "tab" && lower.tab.pinned)) {
      add(...beforeEntry(context, lower));
    }
    // Pinned and normal tabs differ in kind, not depth.
    options.byHalf = true;
    return options;
  }

  if (lower?.kind === "tab" && lower.tab.parentTabId === tab.logicalId) {
    add({
      workspaceId,
      zone: tabZone(tab),
      relation: "before",
      anchorTabId: lower.tab.logicalId,
      groupId: tab.groupId,
      parentTabId: tab.logicalId
    }, lower.contentStart);
    return options;
  }

  // Tree levels: siblings of the upper tab or of any ancestor, limited so the
  // lower row keeps reaching its own parent.
  const tabById = new Map(context.view.activeTabs.map((row) => [row.logicalId, row]));
  const ancestors = [];
  for (let id = tab.parentTabId; id !== null && tabById.has(id); id = tabById.get(id).parentTabId) {
    ancestors.push(id);
  }
  const path = [tab.logicalId, ...ancestors];
  const lowerParent = lower?.kind === "tab" && !lower.tab.pinned ? lower.tab.parentTabId : null;
  const floor = lowerParent === null ? -1 : path.indexOf(lowerParent);
  const levels = floor >= 0 ? path.slice(1, floor + 1) : [...ancestors, null];
  for (const parentTabId of levels) {
    const depth = parentTabId === null ? 0 : tabById.get(parentTabId).depth + 1;
    add({
      workspaceId,
      zone: tabZone(tab),
      relation: "after",
      anchorTabId: tab.logicalId,
      groupId: tab.groupId,
      parentTabId
    }, upper.contentStart - (tab.depth - depth) * context.indentStep);
  }
  const leavesGroup = tab.groupId !== null &&
    floor < 0 &&
    !(lower?.kind === "tab" && lower.tab.groupId === tab.groupId);
  if (leavesGroup) {
    const group = context.view.activeGroups.find(({ id }) => id === tab.groupId);
    const header = groupHeaderEntry(context, tab.groupId);
    if (group) addOutsideGroup(context, group, add, header?.contentStart ?? null);
  }
  return options;
}

// The only placement directly above an entry that has nothing staying above it.
function beforeEntry(context, entry) {
  const { workspaceId } = context;
  if (entry.kind === "group") {
    const members = stayingMembers(context, entry.group);
    return [members.length === 0
      ? null
      : {
          workspaceId,
          zone: "ungrouped",
          relation: "before",
          anchorTabId: members[0],
          groupId: null,
          parentTabId: null
        }, entry.contentStart];
  }
  const tab = entry.tab;
  return [{
    workspaceId,
    zone: tabZone(tab),
    relation: "before",
    anchorTabId: tab.logicalId,
    groupId: tab.groupId,
    parentTabId: tab.pinned ? null : tab.parentTabId
  }, tab.pinned ? null : entry.contentStart];
}

function addOutsideGroup(context, group, add, startX) {
  const members = stayingMembers(context, group);
  if (members.length === 0) return;
  add({
    workspaceId: context.workspaceId,
    zone: "ungrouped",
    relation: "after",
    anchorTabId: members.at(-1),
    groupId: null,
    parentTabId: null
  }, startX);
}

function splitsPair(context, destination) {
  const tabById = new Map(context.view.activeTabs.map((row) => [row.logicalId, row]));
  return destinationSplitsPair(tabById, destination);
}

function resolveGroupDrop(context, hit) {
  const { entries, view, workspaceId } = context;
  const entry = entries[hit.index];
  if (hit.end) {
    return {
      destination: groupDestinationForWorkspace(workspaceId),
      indicator: { entryIndex: hit.index, edge: "after", indent: null }
    };
  }
  const relation = edgeFor(hit, 0.5, 0.5) === "before" ? "before" : "after";
  let destination;
  if (entry.kind === "group") {
    const anchor = relation === "before" ? entry.group.tabIds[0] : entry.group.tabIds.at(-1);
    destination = anchor === undefined ? null : groupDestinationForRow(
      { workspaceId, logicalId: anchor },
      relation
    );
  } else {
    destination = snapGroupDropToBranch(view, entry.tab, relation);
  }
  return destination
    ? { destination, indicator: { entryIndex: hit.index, edge: relation, indent: null } }
    : null;
}

const TAB_ZONES = new Set(["pinned", "ungrouped", "group"]);

export function getViewportMenuPosition(
  anchorBounds,
  menuBounds,
  viewport,
  { padding = 4, gap = 2 } = {}
) {
  const maximumLeft = Math.max(padding, viewport.width - menuBounds.width - padding);
  const left = Math.min(
    maximumLeft,
    Math.max(padding, anchorBounds.right - menuBounds.width)
  );
  const below = anchorBounds.bottom + gap;
  const above = anchorBounds.top - menuBounds.height - gap;
  const maximumTop = Math.max(padding, viewport.height - menuBounds.height - padding);
  const top = below + menuBounds.height <= viewport.height - padding
    ? below
    : above >= padding
      ? above
      : Math.min(maximumTop, Math.max(padding, below));
  return { left, top };
}

export function createTabSelection() {
  let workspaceId = null;
  let selected = new Set();
  let anchorId = null;

  return {
    reset(nextWorkspaceId) {
      if (workspaceId !== nextWorkspaceId) {
        workspaceId = nextWorkspaceId;
        selected = new Set();
        anchorId = null;
      }
      return new Set(selected);
    },
    update(tabId, visibleIds, { toggle = false, range = false } = {}) {
      if (!visibleIds.includes(tabId)) {
        return new Set(selected);
      }
      if (range && anchorId && visibleIds.includes(anchorId)) {
        const start = visibleIds.indexOf(anchorId);
        const end = visibleIds.indexOf(tabId);
        selected = new Set(visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1));
      } else if (toggle) {
        if (selected.has(tabId)) {
          selected.delete(tabId);
        } else {
          selected.add(tabId);
        }
        anchorId = tabId;
      } else {
        selected = new Set([tabId]);
        anchorId = tabId;
      }
      return new Set(selected);
    },
    ordered(visibleRows, originId) {
      const chosen = selected.has(originId) ? selected : new Set([originId]);
      return visibleRows.filter(({ logicalId }) => chosen.has(logicalId));
    },
    has(tabId) {
      return selected.has(tabId);
    },
    forget(tabId) {
      selected.delete(tabId);
      if (anchorId === tabId) {
        anchorId = null;
      }
      return new Set(selected);
    },
    values() {
      return new Set(selected);
    }
  };
}

export function tabSourceDescriptor(tab) {
  return {
    tabId: tab.logicalId,
    workspaceId: tab.workspaceId,
    pinned: tab.pinned,
    groupId: tab.groupId,
    parentTabId: tab.parentTabId
  };
}

export function groupMembers(group, tabs) {
  const tabById = new Map(tabs.map((tab) => [tab.logicalId, tab]));
  return group.tabIds.map((tabId) => tabById.get(tabId)).filter(Boolean);
}

// "unloaded" only when no member is loaded; a group with any loaded member is
// "partial" or "loaded", matching the workspace count-badge semantics.
export function groupLoadState(members) {
  const loaded = members.filter((tab) => tab.discarded !== true).length;
  if (loaded === 0) return "unloaded";
  return loaded === members.length ? "loaded" : "partial";
}

export function shouldToggleTreeFromFavicon({
  targetIsFavicon,
  iconsOnly,
  hasChildren,
  pinned,
  modified
}) {
  return targetIsFavicon && !iconsOnly && hasChildren && !pinned && !modified;
}

export function groupSourceDescriptor(group, workspaceId) {
  return {
    groupId: group.id,
    workspaceId,
    tabIds: [...group.tabIds]
  };
}

export function destinationForTabRow(tab, relation) {
  if (!["before", "after", "inside"].includes(relation)) {
    return null;
  }
  const zone = tab.pinned ? "pinned" : tab.groupId === null ? "ungrouped" : "group";
  if (!TAB_ZONES.has(zone) || (relation === "inside" && tab.pinned)) {
    return null;
  }
  return {
    workspaceId: tab.workspaceId,
    zone,
    relation,
    anchorTabId: tab.logicalId,
    groupId: tab.groupId,
    parentTabId: relation === "inside" ? tab.logicalId : tab.parentTabId
  };
}

export function destinationForWorkspace(workspaceId, sources) {
  const pinned = sources.length > 0 && sources.every((source) => source.pinned === true);
  return {
    workspaceId,
    zone: pinned ? "pinned" : "ungrouped",
    relation: "end",
    anchorTabId: null,
    groupId: null,
    parentTabId: null
  };
}

export function destinationForZone(workspaceId, zone, groupId = null) {
  if (!TAB_ZONES.has(zone) || (zone === "group") !== (typeof groupId === "string")) {
    return null;
  }
  return {
    workspaceId,
    zone,
    relation: "end",
    anchorTabId: null,
    groupId,
    parentTabId: null
  };
}

export function groupDestinationForRow(tab, relation) {
  if (!["before", "after"].includes(relation)) {
    return null;
  }
  return {
    workspaceId: tab.workspaceId,
    relation,
    anchorTabId: tab.logicalId
  };
}

export function groupDestinationForWorkspace(workspaceId) {
  return { workspaceId, relation: "end", anchorTabId: null };
}

// The rail + learns which workspace it created by the one ID the returned
// definitions have that the view showed before the request.
export function createdWorkspace(previousWorkspaces, nextState) {
  const previousIds = new Set(previousWorkspaces.map(({ id }) => id));
  const added = nextState.workspaces.filter(({ id }) => !previousIds.has(id));
  return added.length === 1 ? added[0] : null;
}

// The rail + is set off by a divider unless the rail already ends with one.
export function addWorkspaceNeedsDivider(rail) {
  return rail.at(-1)?.kind !== "divider";
}

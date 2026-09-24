import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WorkspaceStateError
} from "./workspace-state.js";

export const WORKSPACE_RUNTIME_LEGACY_SCHEMA_VERSION = 1;
export const WORKSPACE_RUNTIME_V2_SCHEMA_VERSION = 2;
export const WORKSPACE_RUNTIME_V3_SCHEMA_VERSION = 3;
export const WORKSPACE_RUNTIME_V4_SCHEMA_VERSION = 4;
export const WORKSPACE_RUNTIME_SCHEMA_VERSION = 5;
export const WORKSPACE_RUNTIME_STORAGE_KEY = "workspaceRuntime";
export const WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY = "workspaceRuntimeMigration";

export const WORKSPACE_GROUP_COLORS = Object.freeze([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange"
]);

export const MAX_TAB_TREE_DEPTH = 32;
export const MAX_GROUP_TITLE_LENGTH = 255;

export const WORKSPACE_PENDING_OPERATION_KINDS = Object.freeze({
  ACTIVATE: "activate-workspace",
  MOVE_TAB: "move-tab",
  MOVE_GROUP: "move-group",
  RELOCATE_TABS: "relocate-tabs",
  UPDATE_GROUP: "update-group",
  REMOVE_WORKSPACE: "remove-workspace",
  RECONCILE: "reconcile-layout",
  UNLOAD: "unload-workspace"
});

const GROUP_COLOR_VALUES = new Set(WORKSPACE_GROUP_COLORS);
const OPERATION_KIND_VALUES = new Set(Object.values(WORKSPACE_PENDING_OPERATION_KINDS));
const LOGICAL_ID_PATTERN = /^(tab|window|group|split|operation)-[a-z0-9][a-z0-9-]{0,127}$/;
function invalidRuntime(reason) {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.INVALID_STATE,
    `${WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.INVALID_STATE]} ${reason}`
  );
}

function unsupportedVersion() {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
    WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]
  );
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

function parseLogicalId(value, kind, label) {
  if (
    typeof value !== "string" ||
    !LOGICAL_ID_PATTERN.test(value) ||
    !value.startsWith(`${kind}-`)
  ) {
    throw invalidRuntime(`${label} has an invalid logical ID.`);
  }
  return value;
}

function parseWorkspaceReference(value, workspaceIds, label) {
  if (typeof value !== "string" || !workspaceIds.has(value)) {
    throw invalidRuntime(`${label} references an unknown workspace.`);
  }
  return value;
}

function parseSelectedTabs(value, windowIndex, workspaceIds, assignmentByTabId) {
  if (!Array.isArray(value)) {
    throw invalidRuntime(`Runtime window ${windowIndex} selections must be an array.`);
  }

  const selectedWorkspaceIds = new Set();
  return value.map((entry, selectionIndex) => {
    const label = `Runtime window ${windowIndex} selection ${selectionIndex}`;
    if (!isRecord(entry) || !hasExactKeys(entry, ["workspaceId", "tabId"])) {
      throw invalidRuntime(`${label} has an invalid shape.`);
    }
    const workspaceId = parseWorkspaceReference(entry.workspaceId, workspaceIds, label);
    const tabId = parseLogicalId(entry.tabId, "tab", label);
    if (selectedWorkspaceIds.has(workspaceId)) {
      throw invalidRuntime("A window can remember only one tab per workspace.");
    }
    if (assignmentByTabId.get(tabId) !== workspaceId) {
      throw invalidRuntime("A remembered tab must match its workspace assignment.");
    }
    selectedWorkspaceIds.add(workspaceId);
    return { workspaceId, tabId };
  });
}

function parseTabIdArray(value, label, assignmentByTabId, workspaceId) {
  if (!Array.isArray(value)) {
    throw invalidRuntime(`${label} must be an array.`);
  }
  const seen = new Set();
  return value.map((tabId, index) => {
    const parsed = parseLogicalId(tabId, "tab", `${label} entry ${index}`);
    if (seen.has(parsed)) {
      throw invalidRuntime(`${label} cannot contain duplicate tabs.`);
    }
    if (assignmentByTabId.get(parsed) !== workspaceId) {
      throw invalidRuntime(`${label} contains a tab outside its workspace.`);
    }
    seen.add(parsed);
    return parsed;
  });
}

function parseGroup(
  value,
  label,
  assignmentByTabId,
  workspaceId,
  layoutTabIdSet,
  groupedTabIds,
  groupIds
) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "title", "color", "collapsed", "tabIds"])
  ) {
    throw invalidRuntime(`${label} has an invalid shape.`);
  }
  const id = parseLogicalId(value.id, "group", label);
  if (groupIds.has(id)) {
    throw invalidRuntime("Logical group IDs must be unique.");
  }
  if (typeof value.title !== "string" || value.title.length > MAX_GROUP_TITLE_LENGTH) {
    throw invalidRuntime(`${label} has an invalid title.`);
  }
  if (!GROUP_COLOR_VALUES.has(value.color)) {
    throw invalidRuntime(`${label} has an invalid color.`);
  }
  if (typeof value.collapsed !== "boolean") {
    throw invalidRuntime(`${label} has an invalid collapsed state.`);
  }
  const tabIds = parseTabIdArray(
    value.tabIds,
    `${label} members`,
    assignmentByTabId,
    workspaceId
  );
  if (tabIds.length === 0) {
    throw invalidRuntime("Logical groups cannot be empty.");
  }
  for (const tabId of tabIds) {
    if (!layoutTabIdSet.has(tabId)) {
      throw invalidRuntime("A group member must appear in its workspace layout.");
    }
    if (groupedTabIds.has(tabId)) {
      throw invalidRuntime("A tab can belong to only one logical group.");
    }
    groupedTabIds.add(tabId);
  }
  groupIds.add(id);
  return {
    id,
    title: value.title,
    color: value.color,
    collapsed: value.collapsed,
    tabIds
  };
}

function parseTree(value, label, tabIds, pinnedTabIds, groups) {
  if (!Array.isArray(value) || value.length !== tabIds.length) {
    throw invalidRuntime(`${label} must contain one node per layout tab.`);
  }
  const pinned = new Set(pinnedTabIds);
  const groupByTabId = new Map();
  for (const group of groups) {
    for (const tabId of group.tabIds) {
      groupByTabId.set(tabId, group.id);
    }
  }
  const seen = new Set();
  const depthByTabId = new Map();
  return value.map((entry, index) => {
    const nodeLabel = `${label} node ${index}`;
    if (!isRecord(entry) || !hasExactKeys(entry, ["tabId", "parentTabId", "collapsed"])) {
      throw invalidRuntime(`${nodeLabel} has an invalid shape.`);
    }
    const tabId = parseLogicalId(entry.tabId, "tab", nodeLabel);
    if (tabId !== tabIds[index] || seen.has(tabId)) {
      throw invalidRuntime(`${label} must match layout tab order exactly.`);
    }
    if (typeof entry.collapsed !== "boolean") {
      throw invalidRuntime(`${nodeLabel} has an invalid collapsed state.`);
    }
    let parentTabId = null;
    let depth = 0;
    if (entry.parentTabId !== null) {
      parentTabId = parseLogicalId(entry.parentTabId, "tab", nodeLabel);
      if (!seen.has(parentTabId)) {
        throw invalidRuntime(`${nodeLabel} parent must precede its child.`);
      }
      if (pinned.has(tabId) || pinned.has(parentTabId)) {
        throw invalidRuntime("Pinned tabs cannot participate in a tab tree.");
      }
      if (groupByTabId.get(tabId) !== groupByTabId.get(parentTabId)) {
        throw invalidRuntime("A tab tree cannot cross a native-group boundary.");
      }
      depth = depthByTabId.get(parentTabId) + 1;
      if (depth > MAX_TAB_TREE_DEPTH) {
        throw invalidRuntime(`A tab tree cannot exceed depth ${MAX_TAB_TREE_DEPTH}.`);
      }
    }
    if (pinned.has(tabId) && entry.collapsed) {
      throw invalidRuntime("Pinned tabs cannot retain collapsed tree state.");
    }
    seen.add(tabId);
    depthByTabId.set(tabId, depth);
    return { tabId, parentTabId, collapsed: entry.collapsed };
  });
}

function parseSplitViews(
  value,
  label,
  tabIds,
  pinnedTabIds,
  groups,
  splitViewIds,
  splitTabIds
) {
  if (!Array.isArray(value)) {
    throw invalidRuntime(`${label} must be an array.`);
  }
  const tabIndexById = new Map(tabIds.map((tabId, index) => [tabId, index]));
  const pinned = new Set(pinnedTabIds);
  const groupByTabId = new Map();
  for (const group of groups) {
    for (const tabId of group.tabIds) {
      groupByTabId.set(tabId, group.id);
    }
  }
  return value.map((entry, index) => {
    const splitLabel = `${label} split view ${index}`;
    if (!isRecord(entry) || !hasExactKeys(entry, ["id", "tabIds"])) {
      throw invalidRuntime(`${splitLabel} has an invalid shape.`);
    }
    const id = parseLogicalId(entry.id, "split", splitLabel);
    if (splitViewIds.has(id)) {
      throw invalidRuntime("Logical split-view IDs must be unique.");
    }
    if (!Array.isArray(entry.tabIds) || entry.tabIds.length !== 2) {
      throw invalidRuntime("A split view must contain exactly two tabs.");
    }
    const members = entry.tabIds.map((tabId, memberIndex) =>
      parseLogicalId(tabId, "tab", `${splitLabel} member ${memberIndex}`)
    );
    if (members[0] === members[1]) {
      throw invalidRuntime("A split view cannot contain the same tab twice.");
    }
    for (const tabId of members) {
      if (!tabIndexById.has(tabId)) {
        throw invalidRuntime("A split-view member must appear in its workspace layout.");
      }
      if (pinned.has(tabId)) {
        throw invalidRuntime("Pinned tabs cannot participate in a split view.");
      }
      if (splitTabIds.has(tabId)) {
        throw invalidRuntime("A tab can belong to only one split view.");
      }
    }
    if (tabIndexById.get(members[1]) !== tabIndexById.get(members[0]) + 1) {
      throw invalidRuntime("Split-view tabs must be adjacent and retain their pane order.");
    }
    if (groupByTabId.get(members[0]) !== groupByTabId.get(members[1])) {
      throw invalidRuntime("A split view cannot cross a native-group boundary.");
    }
    splitViewIds.add(id);
    members.forEach((tabId) => {
      splitTabIds.add(tabId);
    });
    return { id, tabIds: members };
  });
}

function parseWorkspaceLayouts(
  value,
  windowIndex,
  workspaceIds,
  assignmentByTabId,
  placedTabIds,
  groupIds,
  splitViewIds,
  includeTree,
  includeSplitViews
) {
  if (!Array.isArray(value)) {
    throw invalidRuntime(`Runtime window ${windowIndex} layouts must be an array.`);
  }
  const layoutWorkspaceIds = new Set();
  return value.map((entry, layoutIndex) => {
    const label = `Runtime window ${windowIndex} layout ${layoutIndex}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(
        entry,
        includeSplitViews
          ? ["workspaceId", "tabIds", "pinnedTabIds", "groups", "tree", "splitViews"]
          : includeTree
            ? ["workspaceId", "tabIds", "pinnedTabIds", "groups", "tree"]
          : ["workspaceId", "tabIds", "pinnedTabIds", "groups"]
      )
    ) {
      throw invalidRuntime(`${label} has an invalid shape.`);
    }
    const workspaceId = parseWorkspaceReference(entry.workspaceId, workspaceIds, label);
    if (layoutWorkspaceIds.has(workspaceId)) {
      throw invalidRuntime("A window can contain only one layout per workspace.");
    }
    layoutWorkspaceIds.add(workspaceId);

    const tabIds = parseTabIdArray(
      entry.tabIds,
      `${label} tabs`,
      assignmentByTabId,
      workspaceId
    );
    const layoutTabIdSet = new Set(tabIds);
    for (const tabId of tabIds) {
      if (placedTabIds.has(tabId)) {
        throw invalidRuntime("A tab can appear in only one window layout.");
      }
      placedTabIds.add(tabId);
    }

    const pinnedTabIds = parseTabIdArray(
      entry.pinnedTabIds,
      `${label} pins`,
      assignmentByTabId,
      workspaceId
    );
    for (const tabId of pinnedTabIds) {
      if (!layoutTabIdSet.has(tabId)) {
        throw invalidRuntime("A pinned tab must appear in its workspace layout.");
      }
    }

    if (!Array.isArray(entry.groups)) {
      throw invalidRuntime(`${label} groups must be an array.`);
    }
    const groupedTabIds = new Set();
    const groups = entry.groups.map((group, groupIndex) =>
      parseGroup(
        group,
        `${label} group ${groupIndex}`,
        assignmentByTabId,
        workspaceId,
        layoutTabIdSet,
        groupedTabIds,
        groupIds
      )
    );
    for (const tabId of pinnedTabIds) {
      if (groupedTabIds.has(tabId)) {
        throw invalidRuntime("A tab cannot be both logically pinned and grouped.");
      }
    }

    const layout = { workspaceId, tabIds, pinnedTabIds, groups };
    if (includeTree) {
      layout.tree = parseTree(entry.tree, `${label} tree`, tabIds, pinnedTabIds, groups);
    }
    if (includeSplitViews) {
      layout.splitViews = parseSplitViews(
        entry.splitViews,
        label,
        tabIds,
        pinnedTabIds,
        groups,
        splitViewIds,
        new Set()
      );
    }
    return layout;
  });
}

function parsePendingOperation(value, windowIndex) {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, ["id", "kind"])) {
    throw invalidRuntime(`Runtime window ${windowIndex} pending operation has an invalid shape.`);
  }
  const id = parseLogicalId(value.id, "operation", `Runtime window ${windowIndex} operation`);
  if (!OPERATION_KIND_VALUES.has(value.kind)) {
    throw invalidRuntime(`Runtime window ${windowIndex} pending operation has an invalid kind.`);
  }
  return { id, kind: value.kind };
}

function parseRuntime(value, knownWorkspaceIds, expectedVersion) {
  const workspaceIds = new Set(knownWorkspaceIds);
  if (workspaceIds.size === 0) {
    throw invalidRuntime("Runtime validation requires at least one workspace.");
  }
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "tabs", "windows"])) {
    throw invalidRuntime("The runtime document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidRuntime("The runtime schema version is invalid.");
  }
  if (value.schemaVersion > WORKSPACE_RUNTIME_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== expectedVersion) {
    throw invalidRuntime(`Expected runtime schema version ${expectedVersion}.`);
  }
  if (!Array.isArray(value.tabs) || !Array.isArray(value.windows)) {
    throw invalidRuntime("Runtime tab and window records must be arrays.");
  }

  const tabIds = new Set();
  const tabs = value.tabs.map((entry, index) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["id", "workspaceId"])) {
      throw invalidRuntime(`Runtime tab ${index} has an invalid shape.`);
    }
    const id = parseLogicalId(entry.id, "tab", `Runtime tab ${index}`);
    if (tabIds.has(id)) {
      throw invalidRuntime("Runtime tab IDs must be unique.");
    }
    tabIds.add(id);
    return {
      id,
      workspaceId: parseWorkspaceReference(entry.workspaceId, workspaceIds, `Runtime tab ${index}`)
    };
  });
  const assignmentByTabId = new Map(tabs.map((entry) => [entry.id, entry.workspaceId]));

  const windowIds = new Set();
  const rememberedTabIds = new Set();
  const placedTabIds = new Set();
  const groupIds = new Set();
  const splitViewIds = new Set();
  const operationIds = new Set();
  const windows = value.windows.map((entry, index) => {
    const expectedKeys =
      expectedVersion === WORKSPACE_RUNTIME_LEGACY_SCHEMA_VERSION
        ? ["id", "activeWorkspaceId"]
        : expectedVersion === WORKSPACE_RUNTIME_V2_SCHEMA_VERSION
          ? ["id", "activeWorkspaceId", "selectedTabs"]
          : [
              "id",
              "activeWorkspaceId",
              "selectedTabs",
              "workspaceLayouts",
              "pendingOperation"
            ];
    if (!isRecord(entry) || !hasExactKeys(entry, expectedKeys)) {
      throw invalidRuntime(`Runtime window ${index} has an invalid shape.`);
    }
    const id = parseLogicalId(entry.id, "window", `Runtime window ${index}`);
    if (windowIds.has(id)) {
      throw invalidRuntime("Runtime window IDs must be unique.");
    }
    windowIds.add(id);
    const parsed = {
      id,
      activeWorkspaceId: parseWorkspaceReference(
        entry.activeWorkspaceId,
        workspaceIds,
        `Runtime window ${index}`
      )
    };
    if (expectedVersion >= WORKSPACE_RUNTIME_V2_SCHEMA_VERSION) {
      parsed.selectedTabs = parseSelectedTabs(
        entry.selectedTabs,
        index,
        workspaceIds,
        assignmentByTabId
      );
      for (const selection of parsed.selectedTabs) {
        if (rememberedTabIds.has(selection.tabId)) {
          throw invalidRuntime("A tab cannot be remembered by multiple windows.");
        }
        rememberedTabIds.add(selection.tabId);
      }
    }
    if (expectedVersion >= WORKSPACE_RUNTIME_V3_SCHEMA_VERSION) {
      parsed.workspaceLayouts = parseWorkspaceLayouts(
        entry.workspaceLayouts,
        index,
        workspaceIds,
        assignmentByTabId,
        placedTabIds,
        groupIds,
        splitViewIds,
        expectedVersion >= WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
        expectedVersion >= WORKSPACE_RUNTIME_SCHEMA_VERSION
      );
      parsed.pendingOperation = parsePendingOperation(entry.pendingOperation, index);
      if (parsed.pendingOperation) {
        if (operationIds.has(parsed.pendingOperation.id)) {
          throw invalidRuntime("Pending operation IDs must be unique.");
        }
        operationIds.add(parsed.pendingOperation.id);
      }
    }
    return parsed;
  });

  return { schemaVersion: expectedVersion, tabs, windows };
}

export function createEmptyWorkspaceRuntime() {
  return {
    schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
    tabs: [],
    windows: []
  };
}

export function parseWorkspaceRuntimeV1(value, knownWorkspaceIds) {
  return parseRuntime(value, knownWorkspaceIds, WORKSPACE_RUNTIME_LEGACY_SCHEMA_VERSION);
}

export function parseWorkspaceRuntimeV2(value, knownWorkspaceIds) {
  return parseRuntime(value, knownWorkspaceIds, WORKSPACE_RUNTIME_V2_SCHEMA_VERSION);
}

export function parseWorkspaceRuntimeV3(value, knownWorkspaceIds) {
  return parseRuntime(value, knownWorkspaceIds, WORKSPACE_RUNTIME_V3_SCHEMA_VERSION);
}

export function parseWorkspaceRuntimeV4(value, knownWorkspaceIds) {
  return parseRuntime(value, knownWorkspaceIds, WORKSPACE_RUNTIME_V4_SCHEMA_VERSION);
}

export function parseWorkspaceRuntime(value, knownWorkspaceIds) {
  return parseRuntime(value, knownWorkspaceIds, WORKSPACE_RUNTIME_SCHEMA_VERSION);
}

export function migrateWorkspaceRuntimeV1ToV2(value, knownWorkspaceIds) {
  const source = parseWorkspaceRuntimeV1(value, knownWorkspaceIds);
  return parseWorkspaceRuntimeV2(
    {
      schemaVersion: WORKSPACE_RUNTIME_V2_SCHEMA_VERSION,
      tabs: source.tabs,
      windows: source.windows.map((entry) => ({ ...entry, selectedTabs: [] }))
    },
    knownWorkspaceIds
  );
}

export function migrateWorkspaceRuntimeV2ToV3(value, knownWorkspaceIds) {
  const source = parseWorkspaceRuntimeV2(value, knownWorkspaceIds);
  return parseWorkspaceRuntimeV3(
    {
      schemaVersion: WORKSPACE_RUNTIME_V3_SCHEMA_VERSION,
      tabs: source.tabs,
      windows: source.windows.map((entry) => ({
        ...entry,
        workspaceLayouts: [],
        pendingOperation: null
      }))
    },
    knownWorkspaceIds
  );
}

export function migrateWorkspaceRuntimeV3ToV4(value, knownWorkspaceIds) {
  const source = parseWorkspaceRuntimeV3(value, knownWorkspaceIds);
  return parseWorkspaceRuntimeV4(
    {
      schemaVersion: WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
      tabs: source.tabs,
      windows: source.windows.map((entry) => ({
        ...entry,
        workspaceLayouts: entry.workspaceLayouts.map((layout) => ({
          ...layout,
          tree: layout.tabIds.map((tabId) => ({
            tabId,
            parentTabId: null,
            collapsed: false
          }))
        }))
      }))
    },
    knownWorkspaceIds
  );
}

export function migrateWorkspaceRuntimeV4ToV5(value, knownWorkspaceIds) {
  const source = parseWorkspaceRuntimeV4(value, knownWorkspaceIds);
  return parseWorkspaceRuntime(
    {
      schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
      tabs: source.tabs,
      windows: source.windows.map((entry) => ({
        ...entry,
        workspaceLayouts: entry.workspaceLayouts.map((layout) => ({
          ...layout,
          splitViews: []
        }))
      }))
    },
    knownWorkspaceIds
  );
}

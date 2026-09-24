import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WorkspaceStateError
} from "./workspace-state.js";

export const WORKSPACE_MESSAGE_TYPES = Object.freeze({
  GET_STATE: "workspaceState.get",
  GET_VIEW: "workspaceView.get",
  GET_SEARCH_INDEX: "workspace.tabs.searchIndex",
  ACTIVATE: "workspace.activate",
  ACTIVATE_TAB: "workspace.tab.activate",
  ACTIVATE_SEARCH_RESULT: "workspace.tab.activateSearchResult",
  RELOCATE_TABS: "workspace.tabs.relocate",
  CREATE_GROUP: "workspace.tabs.createGroup",
  UNLOAD_TABS: "workspace.tabs.unload",
  PREPARE_CLOSE_TABS: "workspace.tabs.close.prepare",
  CLOSE_TABS: "workspace.tabs.close.execute",
  MOVE_TABS_TO_CONTAINER: "workspace.tabs.moveToContainer",
  RELOCATE_NATIVE_SELECTION: "workspace.tabs.relocateNativeSelection",
  RELOCATE_GROUP: "workspace.group.relocate",
  RENAME_GROUP: "workspace.group.rename",
  DELETE_GROUP: "workspace.group.delete",
  SET_TREE_COLLAPSED: "workspace.tree.setCollapsed",
  FLATTEN_TREE_BRANCH: "workspace.tree.flattenBranch",
  SET_GROUP_COLLAPSED: "workspace.group.setCollapsed",
  UNLOAD: "workspace.unload",
  LOAD_TABS: "workspace.tabs.load",
  ACKNOWLEDGE_NOTICE: "workspace.notice.acknowledge",
  VIEW_CHANGED: "workspaceView.changed",
  TAB_REMOVED: "workspaceView.tabRemoved",
  CREATE: "workspace.create",
  UPDATE: "workspace.update",
  REMOVE: "workspace.remove",
  REMOVE_MANY: "workspace.removeMany",
  MOVE_RAIL_ENTRY: "workspace.rail.move",
  PLACE_RAIL_ENTRY: "workspace.rail.place",
  ADD_DIVIDER: "workspace.divider.add",
  RESIZE_DIVIDER: "workspace.divider.resize",
  REMOVE_DIVIDER: "workspace.divider.remove",
  ADD_SPACE: "workspace.space.add",
  REMOVE_SPACE: "workspace.space.remove",
  UPDATE_MANY: "workspace.updateMany",
  PLACE_RAIL_ENTRIES: "workspace.rail.placeMany",
  INSERT_RAIL_ENTRIES: "workspace.rail.insertMany",
  REMOVE_RAIL_ENTRIES: "workspace.rail.removeMany",
  DUPLICATE_WORKSPACES: "workspace.duplicateMany",
  ENSURE_SETTINGS_COMPANION: "workspace.settings.ensureCompanion",
  OPEN_SETTINGS: "workspace.settings.open"
});

export function workspaceStateSuccess(state) {
  return { ok: true, state };
}

export function workspaceViewSuccess(view) {
  return { ok: true, view };
}

export function workspaceSearchIndexSuccess(index) {
  return { ok: true, index };
}

export function workspaceLoadSuccess(result) {
  return { ok: true, result };
}

export function workspaceUnloadSuccess(result) {
  return { ok: true, view: result.view, outcome: result.outcome };
}

export function workspaceOperationSuccess(result) {
  return { ok: true, view: result.view, outcome: result.outcome };
}

export function workspaceClosePreflightSuccess(preflight) {
  return { ok: true, preflight };
}

export function workspaceCloseSuccess(result) {
  return {
    ok: true,
    view: result.view,
    outcome: result.outcome,
    preflight: result.preflight ?? null
  };
}

export function workspaceSettingsCompanionSuccess(companionCreated) {
  return { ok: true, companionCreated };
}

export function workspaceSettingsOpenedSuccess(settingsTabReused) {
  return { ok: true, settingsTabReused };
}

export function workspaceNoticeAcknowledgedSuccess(acknowledged) {
  return { ok: true, acknowledged };
}

export function workspaceStateFailure(error) {
  const code =
    error instanceof WorkspaceStateError && WORKSPACE_STATE_ERROR_MESSAGES[error.code]
      ? error.code
      : WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR;

  return {
    ok: false,
    error: {
      code,
      message: WORKSPACE_STATE_ERROR_MESSAGES[code]
    }
  };
}

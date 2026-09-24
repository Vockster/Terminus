import {
  WORKSPACE_MESSAGE_TYPES,
  workspaceClosePreflightSuccess,
  workspaceCloseSuccess,
  workspaceLoadSuccess,
  workspaceOperationSuccess,
  workspaceNoticeAcknowledgedSuccess,
  workspaceSettingsCompanionSuccess,
  workspaceSettingsOpenedSuccess,
  workspaceSearchIndexSuccess,
  workspaceStateFailure,
  workspaceStateSuccess,
  workspaceUnloadSuccess,
  workspaceViewSuccess
} from "../contracts/workspace-messages.js";
import {
  WORKSPACE_STATE_ERROR_CODES,
  WorkspaceStateError
} from "../contracts/workspace-state.js";
import { MAX_GROUP_TITLE_LENGTH } from "../contracts/workspace-runtime.js";
import { SIDEBAR_UNDO_OPERATION_KINDS } from "../contracts/sidebar-undo.js";
import { ContainerError } from "../contracts/containers.js";
import { containerFailure } from "../contracts/container-messages.js";
import { parseTabContainerMoveRequest } from "../contracts/tab-container-move.js";

const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_TAB_BATCH_SIZE = 4_096;
const UNDOABLE_RESULT = Symbol("sidebarUndoableResult");
const UNAVAILABLE_UNDO = Object.freeze({
  available: false,
  undoId: null,
  operation: null,
  label: null,
  action: null
});

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

function invalidRequest() {
  return Promise.resolve(
    workspaceStateFailure(new WorkspaceStateError(WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST))
  );
}

function validTabIdentities(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return false;
  }
  const logicalIds = new Set();
  const firefoxIds = new Set();
  for (const tab of tabs) {
    if (
      !isRecord(tab) ||
      !hasExactKeys(tab, ["logicalTabId", "firefoxTabId"]) ||
      typeof tab.logicalTabId !== "string" ||
      !LOGICAL_TAB_ID_PATTERN.test(tab.logicalTabId) ||
      !Number.isInteger(tab.firefoxTabId) ||
      tab.firefoxTabId < 0 ||
      logicalIds.has(tab.logicalTabId) ||
      firefoxIds.has(tab.firefoxTabId)
    ) {
      return false;
    }
    logicalIds.add(tab.logicalTabId);
    firefoxIds.add(tab.firefoxTabId);
  }
  return true;
}

export function createWorkspaceMessageHandler(
  workspaceStateService,
  workspaceController,
  { sidebarActionCoordinator = null } = {}
) {
  return function handleWorkspaceMessage(message, sender) {
    if (!isRecord(message)) {
      return undefined;
    }

    const runUndoable = (windowId, operation, label, run) => {
      if (!sidebarActionCoordinator?.isSidebarSender(sender)) {
        return run(null);
      }
      return sidebarActionCoordinator
        .createTransaction({ sender, windowId, operation, label })
        .then(async (transaction) => ({
          [UNDOABLE_RESULT]: true,
          value: await run(transaction),
          undoUnavailable: transaction.finalization?.unavailable === true
        }));
    };
    const undoableSuccess = (success) => (result) => {
      if (result?.[UNDOABLE_RESULT] !== true) return success(result);
      return {
        ...success(result.value),
        undoUnavailable: result.undoUnavailable
      };
    };

    if (message.type === WORKSPACE_MESSAGE_TYPES.GET_STATE) {
      if (!hasExactKeys(message, ["type"])) {
        return invalidRequest();
      }
      return workspaceStateService.getOrInitialize().then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.CREATE) {
      const sidebarRequest = sidebarActionCoordinator?.isSidebarSender(sender) === true;
      if (!hasExactKeys(message, sidebarRequest
        ? ["type", "windowId", "workspace"]
        : ["type", "workspace"])) {
        return invalidRequest();
      }
      const operation = sidebarRequest
        ? runUndoable(
            message.windowId,
            SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_CREATE,
            "Create workspace",
            (transaction) => workspaceController.createWorkspace(
              message.windowId,
              message.workspace,
              transaction
            )
          )
        : workspaceStateService.createWorkspace(message.workspace);
      return operation.then(undoableSuccess(workspaceStateSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.UPDATE) {
      const sidebarRequest = sidebarActionCoordinator?.isSidebarSender(sender) === true;
      if (
        !hasExactKeys(message, sidebarRequest
          ? ["type", "windowId", "workspaceId", "changes"]
          : ["type", "workspaceId", "changes"]) ||
        !isRecord(message.changes) ||
        Object.prototype.hasOwnProperty.call(message.changes, "defaultContainerRef")
      ) {
        return invalidRequest();
      }
      const operation = sidebarRequest
        ? runUndoable(
            message.windowId,
            SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME,
            "Rename workspace",
            (transaction) => workspaceController.updateWorkspace(
              message.windowId,
              message.workspaceId,
              message.changes,
              transaction
            )
          )
        : workspaceStateService.updateWorkspace(message.workspaceId, message.changes);
      return operation.then(undoableSuccess(workspaceStateSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.LOAD_TABS) {
      if (!hasExactKeys(message, ["type", "windowId", "workspaceId"])) {
        return invalidRequest();
      }
      return workspaceController
        .loadWorkspaceTabs(message.windowId, message.workspaceId)
        .then(workspaceLoadSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.REMOVE) {
      if (!hasExactKeys(message, ["type", "windowId", "workspaceId"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
        "Remove workspace",
        (transaction) => workspaceController.removeWorkspace(
          message.windowId,
          message.workspaceId,
          transaction
        )
      )
        .then(undoableSuccess(workspaceViewSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.REMOVE_MANY) {
      if (
        !hasExactKeys(message, ["type", "windowId", "workspaceIds", "decorations"]) ||
        !Array.isArray(message.workspaceIds) ||
        !Array.isArray(message.decorations)
      ) {
        return invalidRequest();
      }
      const remove = (transaction) => workspaceController.removeWorkspaces(
        message.windowId,
        message.workspaceIds,
        message.decorations,
        transaction
      );
      const count = message.workspaceIds.length;
      const operation = sidebarActionCoordinator?.isSettingsSender(sender) === true
        ? sidebarActionCoordinator
          .createSettingsRemovalTransaction({
            sender,
            windowId: message.windowId,
            label: count === 1 ? "Remove workspace" : `Remove ${count} workspaces`
          })
          .then(async (transaction) => {
            await remove(transaction);
            const { summary } = await sidebarActionCoordinator.getSummary({
              sender,
              windowId: message.windowId
            });
            return summary;
          })
        : remove(null).then(() => null);
      return operation.then(
        async (undo) => ({
          ok: true,
          state: await workspaceStateService.getOrInitialize(),
          undo: undo ?? UNAVAILABLE_UNDO
        }),
        workspaceStateFailure
      );
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.MOVE_RAIL_ENTRY) {
      if (!hasExactKeys(message, ["type", "entry", "direction"])) {
        return invalidRequest();
      }
      return workspaceStateService.moveRailEntry(message.entry, message.direction).then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRY) {
      const sidebarRequest = sidebarActionCoordinator?.isSidebarSender(sender) === true;
      if (!hasExactKeys(message, sidebarRequest
        ? ["type", "windowId", "entry", "target", "position"]
        : ["type", "entry", "target", "position"])) {
        return invalidRequest();
      }
      const operation = sidebarRequest
        ? runUndoable(
            message.windowId,
            SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RELOCATE,
            "Move workspace",
            (transaction) => workspaceController.placeRailEntry(
              message.windowId,
              message.entry,
              message.target,
              message.position,
              transaction
            )
          )
        : workspaceStateService.placeRailEntry(message.entry, message.target, message.position);
      return operation
        .then(undoableSuccess(workspaceStateSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.UPDATE_MANY) {
      if (!hasExactKeys(message, ["type", "workspaceIds", "changes"])) {
        return invalidRequest();
      }
      return workspaceStateService
        .updateWorkspaces(message.workspaceIds, message.changes)
        .then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRIES) {
      if (!hasExactKeys(message, ["type", "entries", "target", "position"])) {
        return invalidRequest();
      }
      return workspaceStateService
        .placeRailEntries(message.entries, message.target, message.position)
        .then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.INSERT_RAIL_ENTRIES) {
      if (!hasExactKeys(message, ["type", "insertions"])) {
        return invalidRequest();
      }
      return workspaceStateService
        .insertRailEntries(message.insertions)
        .then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.REMOVE_RAIL_ENTRIES) {
      if (!hasExactKeys(message, ["type", "entries"])) {
        return invalidRequest();
      }
      return workspaceStateService
        .removeRailEntries(message.entries)
        .then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.DUPLICATE_WORKSPACES) {
      if (!hasExactKeys(message, ["type", "workspaceIds", "target", "position"])) {
        return invalidRequest();
      }
      return workspaceStateService
        .duplicateWorkspaces(message.workspaceIds, message.target, message.position)
        .then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.ADD_DIVIDER) {
      if (!hasExactKeys(message, ["type"])) {
        return invalidRequest();
      }
      return workspaceStateService.addDivider().then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.RESIZE_DIVIDER) {
      if (!hasExactKeys(message, ["type", "dividerId", "size"])) {
        return invalidRequest();
      }
      return workspaceStateService
        .resizeDivider(message.dividerId, message.size)
        .then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.REMOVE_DIVIDER) {
      if (!hasExactKeys(message, ["type", "dividerId"])) {
        return invalidRequest();
      }
      return workspaceStateService.removeDivider(message.dividerId).then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.ADD_SPACE) {
      if (!hasExactKeys(message, ["type"])) {
        return invalidRequest();
      }
      return workspaceStateService.addSpace().then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.REMOVE_SPACE) {
      if (!hasExactKeys(message, ["type", "spaceId"])) {
        return invalidRequest();
      }
      return workspaceStateService.removeSpace(message.spaceId).then(workspaceStateSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.ENSURE_SETTINGS_COMPANION && workspaceController) {
      if (
        !hasExactKeys(message, ["type"]) ||
        !Number.isInteger(sender?.tab?.id) ||
        !Number.isInteger(sender?.tab?.windowId)
      ) {
        return invalidRequest();
      }
      return workspaceController
        .ensureSettingsCompanion(sender.tab.windowId, sender.tab.id)
        .then(workspaceSettingsCompanionSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.OPEN_SETTINGS && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId"])) {
        return invalidRequest();
      }
      return workspaceController
        .openSettings(message.windowId)
        .then(workspaceSettingsOpenedSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.GET_VIEW && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId"])) {
        return invalidRequest();
      }
      return workspaceController.getView(message.windowId).then(workspaceViewSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.GET_SEARCH_INDEX && workspaceController) {
      if (
        !hasExactKeys(message, ["type", "windowId"]) ||
        sidebarActionCoordinator?.isSidebarSender(sender) !== true
      ) {
        return invalidRequest();
      }
      return sidebarActionCoordinator
        .verifySidebarRequest({ sender, windowId: message.windowId })
        .then(() => workspaceController.getSearchIndex(message.windowId))
        .then(workspaceSearchIndexSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.ACTIVATE && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "workspaceId"])) {
        return invalidRequest();
      }
      return workspaceController.activateWorkspace(message.windowId, message.workspaceId).then(workspaceViewSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.ACTIVATE_TAB && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "logicalTabId", "firefoxTabId"])) {
        return invalidRequest();
      }
      return workspaceController
        .activateTab(message.windowId, message.logicalTabId, message.firefoxTabId)
        .then(workspaceViewSuccess, workspaceStateFailure);
    }
    if (
      message.type === WORKSPACE_MESSAGE_TYPES.ACTIVATE_SEARCH_RESULT &&
      workspaceController
    ) {
      if (
        !hasExactKeys(message, [
          "type",
          "windowId",
          "workspaceId",
          "logicalTabId",
          "firefoxTabId"
        ]) ||
        sidebarActionCoordinator?.isSidebarSender(sender) !== true
      ) {
        return invalidRequest();
      }
      return sidebarActionCoordinator
        .verifySidebarRequest({ sender, windowId: message.windowId })
        .then(() => workspaceController.activateSearchResult(
          message.windowId,
          message.workspaceId,
          message.logicalTabId,
          message.firefoxTabId
        ))
        .then(workspaceViewSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.RELOCATE_TABS && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "sources", "destination"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TABS_RELOCATE,
        message.sources.length === 1 ? "Move tab" : "Move tabs",
        (transaction) => workspaceController.relocateTabs(
          message.windowId,
          message.sources,
          message.destination,
          transaction
        )
      )
        .then(undoableSuccess(workspaceOperationSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.CREATE_GROUP && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "logicalTabIds"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.GROUP_CREATE,
        "Create group",
        (transaction) => workspaceController.createTabGroup(
          message.windowId,
          message.logicalTabIds,
          transaction
        )
      )
        .then(undoableSuccess(workspaceViewSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.UNLOAD_TABS && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "logicalTabIds"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD,
        message.logicalTabIds.length === 1 ? "Unload tab" : "Unload tabs",
        (transaction) => workspaceController.unloadTabs(
          message.windowId,
          message.logicalTabIds,
          transaction
        )
      )
        .then(undoableSuccess(workspaceViewSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.PREPARE_CLOSE_TABS && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "target"])) {
        return invalidRequest();
      }
      return workspaceController
        .prepareCloseTabs(message.windowId, message.target)
        .then(workspaceClosePreflightSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.CLOSE_TABS && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "token"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE,
        "Close tabs",
        (transaction) => workspaceController.closeTabs(
          message.windowId,
          message.token,
          transaction
        )
      )
        .then(undoableSuccess(workspaceCloseSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.MOVE_TABS_TO_CONTAINER && workspaceController) {
      if (
        !hasExactKeys(message, ["type", "windowId", "tabs", "assignment"]) ||
        sidebarActionCoordinator?.isSidebarSender(sender) !== true
      ) {
        return invalidRequest();
      }
      try {
        parseTabContainerMoveRequest({ tabs: message.tabs, assignment: message.assignment });
      } catch {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE,
        "Move to container",
        (transaction) => workspaceController.moveTabsToContainer(
          message.windowId,
          { tabs: message.tabs, assignment: message.assignment },
          transaction
        )
      ).then(
        undoableSuccess(workspaceOperationSuccess),
        (error) => error instanceof ContainerError ? containerFailure(error) : workspaceStateFailure(error)
      );
    }
    if (
      message.type === WORKSPACE_MESSAGE_TYPES.RELOCATE_NATIVE_SELECTION &&
      workspaceController
    ) {
      if (
        !hasExactKeys(message, ["type", "windowId", "tabs", "destinationWorkspaceId"]) ||
        !Number.isInteger(message.windowId) ||
        message.windowId < 0 ||
        !validTabIdentities(message.tabs) ||
        typeof message.destinationWorkspaceId !== "string"
      ) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TABS_RELOCATE,
        message.tabs.length === 1 ? "Move tab" : "Move tabs",
        (transaction) => workspaceController.relocateNativeSelection(
          message.windowId,
          message.tabs,
          message.destinationWorkspaceId,
          transaction
        )
      )
        .then(undoableSuccess(workspaceOperationSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.RELOCATE_GROUP && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "source", "destination"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RELOCATE,
        "Move group",
        (transaction) => workspaceController.relocateGroup(
          message.windowId,
          message.source,
          message.destination,
          transaction
        )
      )
        .then(undoableSuccess(workspaceOperationSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.RENAME_GROUP && workspaceController) {
      if (
        !hasExactKeys(message, ["type", "windowId", "logicalGroupId", "title"]) ||
        typeof message.title !== "string" ||
        message.title.length > MAX_GROUP_TITLE_LENGTH
      ) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.GROUP_RENAME,
        "Rename group",
        (transaction) => workspaceController.renameGroup(
          message.windowId,
          message.logicalGroupId,
          message.title,
          transaction
        )
      )
        .then(undoableSuccess(workspaceViewSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.DELETE_GROUP && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "logicalGroupId"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.GROUP_DELETE,
        "Delete group",
        (transaction) => workspaceController.deleteGroup(
          message.windowId,
          message.logicalGroupId,
          transaction
        )
      )
        .then(undoableSuccess(workspaceViewSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH && workspaceController) {
      if (
        !hasExactKeys(message, ["type", "windowId", "tabs"]) ||
        !validTabIdentities(message.tabs) ||
        message.tabs.length > MAX_TAB_BATCH_SIZE
      ) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TREE_FLATTEN,
        message.tabs.length === 1 ? "Flatten branch" : "Flatten branches",
        (transaction) => workspaceController.flattenTreeBranch(
          message.windowId,
          message.tabs,
          transaction
        )
      )
        .then(undoableSuccess(workspaceViewSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.SET_TREE_COLLAPSED && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "logicalTabId", "collapsed"])) {
        return invalidRequest();
      }
      return workspaceController
        .setTreeCollapsed(message.windowId, message.logicalTabId, message.collapsed)
        .then(workspaceViewSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.SET_GROUP_COLLAPSED && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "logicalGroupId", "collapsed"])) {
        return invalidRequest();
      }
      return workspaceController
        .setGroupCollapsed(message.windowId, message.logicalGroupId, message.collapsed)
        .then(workspaceViewSuccess, workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.UNLOAD && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "workspaceId"])) {
        return invalidRequest();
      }
      return runUndoable(
        message.windowId,
        SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD,
        "Unload workspace",
        (transaction) => workspaceController.unloadWorkspace(
          message.windowId,
          message.workspaceId,
          transaction
        )
      ).then(undoableSuccess(workspaceUnloadSuccess), workspaceStateFailure);
    }
    if (message.type === WORKSPACE_MESSAGE_TYPES.ACKNOWLEDGE_NOTICE && workspaceController) {
      if (!hasExactKeys(message, ["type", "windowId", "noticeId"])) {
        return invalidRequest();
      }
      return workspaceController
        .acknowledgeNotice(message.windowId, message.noticeId)
        .then(workspaceNoticeAcknowledgedSuccess, workspaceStateFailure);
    }
    return undefined;
  };
}

import {
  SIDEBAR_UNDO_MESSAGE_TYPES,
  parseSidebarUndoOutcome,
  parseSidebarUndoSummary
} from "../contracts/sidebar-undo.js";
import {
  WORKSPACE_STATE_ERROR_CODES,
  WorkspaceStateError
} from "../contracts/workspace-state.js";
import { workspaceStateFailure } from "../contracts/workspace-messages.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function failure() {
  return workspaceStateFailure(new WorkspaceStateError(WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST));
}

export function createSidebarUndoMessageHandler(coordinator) {
  return function handleSidebarUndoMessage(message, sender) {
    if (!isRecord(message)) return undefined;
    if (message.type === SIDEBAR_UNDO_MESSAGE_TYPES.GET) {
      if (!exactKeys(message, ["type", "windowId"])) return failure();
      return coordinator.getSummary({ sender, windowId: message.windowId }).then(
        ({ scope, summary }) => ({ ok: true, scope, summary: parseSidebarUndoSummary(summary) }),
        failure
      );
    }
    if (message.type === SIDEBAR_UNDO_MESSAGE_TYPES.EXECUTE) {
      if (!exactKeys(message, ["type", "windowId", "undoId"])) return failure();
      return coordinator.execute({
          sender,
          windowId: message.windowId,
          undoId: message.undoId
        }).then((result) => ({
          ok: true,
          view: result.view,
          outcome: parseSidebarUndoOutcome(result.outcome),
          summary: parseSidebarUndoSummary(result.summary ?? nullSummary)
        }), failure);
    }
    return undefined;
  };
}

const nullSummary = Object.freeze({
  available: false,
  undoId: null,
  operation: null,
  label: null,
  action: null
});

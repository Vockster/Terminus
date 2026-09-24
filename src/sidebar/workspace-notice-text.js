import {
  WORKSPACE_CONVERGENCE_CHECKS,
  WORKSPACE_OPERATION_REASONS
} from "../contracts/workspace-operation.js";

export function workspaceNoticeText(notice) {
  const operationLabels = {
    "activate-workspace": "Workspace switch",
    "move-tab": "Tab move",
    "move-group": "Group move",
    "relocate-tabs": "Tab placement",
    "update-group": "Group update",
    "reconcile-layout": "Workspace repair",
    "unload-workspace": "Workspace unload",
    "remove-workspace": "Workspace removal"
  };
  const reasonLabels = {
    [WORKSPACE_OPERATION_REASONS.ACTIVE]: "active tabs are still protected",
    [WORKSPACE_OPERATION_REASONS.PINNED]: "pinned tabs could not be dematerialized",
    [WORKSPACE_OPERATION_REASONS.SHARING]: "sharing tabs are still protected",
    [WORKSPACE_OPERATION_REASONS.CLOSING]: "closing tabs are still protected",
    [WORKSPACE_OPERATION_REASONS.MISSING]: "tabs disappeared during the operation",
    [WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE]: "Firefox rejected part of the operation",
    [WORKSPACE_OPERATION_REASONS.MIXED_GROUP]: "a mixed-workspace group was safely split",
    [WORKSPACE_OPERATION_REASONS.INCOMPLETE]: "the browser state has not converged yet",
    [WORKSPACE_OPERATION_REASONS.STALE_REQUEST]: "the requested item is no longer available"
  };
  const checkLabels = {
    [WORKSPACE_CONVERGENCE_CHECKS.NO_ACTIVE_WORKSPACE_TABS]: "no tabs in the active workspace",
    [WORKSPACE_CONVERGENCE_CHECKS.ACTIVE_VISIBILITY]: "tab visibility",
    [WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_VISIBLE]: "other workspaces' tabs still visible",
    [WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_PINNED]: "other workspaces' tabs still pinned",
    [WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_SPLIT]: "other workspaces' tabs still in Split View",
    [WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_GROUPED]: "other workspaces' tabs still grouped",
    [WORKSPACE_CONVERGENCE_CHECKS.MISSING_LAYOUT]: "missing workspace layout",
    [WORKSPACE_CONVERGENCE_CHECKS.TAB_ORDER]: "tab order",
    [WORKSPACE_CONVERGENCE_CHECKS.PIN_STATE]: "pinned tabs",
    [WORKSPACE_CONVERGENCE_CHECKS.GROUP_MEMBERSHIP]: "tab group membership",
    [WORKSPACE_CONVERGENCE_CHECKS.GROUP_METADATA]: "tab group name, color, or collapse",
    [WORKSPACE_CONVERGENCE_CHECKS.NO_ACTIVE_TAB]: "no selected tab",
    [WORKSPACE_CONVERGENCE_CHECKS.SUCCESSOR_CHAIN]: "close order"
  };
  const details = notice.reasons
    .map((entry) => {
      const label = `${entry.count} ${reasonLabels[entry.reason]}`;
      const check = checkLabels[notice.convergenceCheck];
      return entry.reason === WORKSPACE_OPERATION_REASONS.INCOMPLETE && check
        ? `${label} (${check})`
        : label;
    })
    .join("; ");
  return `${operationLabels[notice.operation]}: ${details}.`;
}

import { WORKSPACE_SCOPES } from "./workspace-scope.js";
import {
  WORKSPACE_OPERATION_REASONS,
  WORKSPACE_OPERATION_STATUSES
} from "./workspace-operation.js";

export const TAB_CLOSE_TARGET_KINDS = Object.freeze({
  TAB: "tab",
  BRANCH: "branch",
  TABS: "tabs",
  GROUP: "group",
  WORKSPACE: "workspace"
});
export const MIN_SELECTED_CLOSE_TABS = 2;
export const MAX_SELECTED_CLOSE_TABS = 4_096;

const TARGET_KIND_VALUES = new Set(Object.values(TAB_CLOSE_TARGET_KINDS));
const STATUS_VALUES = new Set(Object.values(WORKSPACE_OPERATION_STATUSES));
const SCOPE_VALUES = new Set(Object.values(WORKSPACE_SCOPES));
const REASON_VALUES = new Set([
  WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE,
  WORKSPACE_OPERATION_REASONS.STALE_REQUEST
]);
const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;
const LOGICAL_GROUP_ID_PATTERN = /^group-[a-z0-9][a-z0-9-]{0,127}$/;
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const CLOSE_TOKEN_PATTERN = /^close-[a-z0-9][a-z0-9-]{0,127}$/;
const CLOSE_FINGERPRINT_PATTERN = /^close-set-[0-9a-f]{16}$/;
const MAX_COUNT = 1_000_000;
const MAX_TARGET_LABEL_LENGTH = 256;

function invalidClose(reason) {
  return new TypeError(`Invalid tab close data. ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
    throw invalidClose(`${label} is invalid.`);
  }
  return value;
}

function parseTargetLabel(value) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_TARGET_LABEL_LENGTH
  ) {
    throw invalidClose("The target label is invalid.");
  }
  return value;
}

function parseReasons(value) {
  if (!Array.isArray(value) || value.length > 2) {
    throw invalidClose("The reason list is invalid.");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["reason", "count", "retryable"]) ||
      !REASON_VALUES.has(entry.reason) ||
      seen.has(entry.reason) ||
      typeof entry.retryable !== "boolean"
    ) {
      throw invalidClose(`Reason ${index} is invalid.`);
    }
    seen.add(entry.reason);
    return {
      reason: entry.reason,
      count: parseCount(entry.count, `Reason ${index} count`),
      retryable: entry.retryable
    };
  });
}

function parseTabIdentity(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["logicalTabId", "firefoxTabId"]) ||
    typeof value.logicalTabId !== "string" ||
    !LOGICAL_TAB_ID_PATTERN.test(value.logicalTabId) ||
    !Number.isInteger(value.firefoxTabId) ||
    value.firefoxTabId < 0
  ) {
    throw invalidClose("The tab target is invalid.");
  }
  return { logicalTabId: value.logicalTabId, firefoxTabId: value.firefoxTabId };
}

export function parseTabCloseTarget(value) {
  if (!isRecord(value) || !TARGET_KIND_VALUES.has(value.kind)) {
    throw invalidClose("The target is invalid.");
  }
  if (value.kind === TAB_CLOSE_TARGET_KINDS.TAB || value.kind === TAB_CLOSE_TARGET_KINDS.BRANCH) {
    const { kind, ...identity } = value;
    return { kind, ...parseTabIdentity(identity) };
  }
  if (value.kind === TAB_CLOSE_TARGET_KINDS.TABS) {
    if (
      !hasExactKeys(value, ["kind", "tabs"]) ||
      !Array.isArray(value.tabs) ||
      value.tabs.length < MIN_SELECTED_CLOSE_TABS ||
      value.tabs.length > MAX_SELECTED_CLOSE_TABS
    ) {
      throw invalidClose("The selected tabs target is invalid.");
    }
    const tabs = value.tabs.map(parseTabIdentity);
    if (
      new Set(tabs.map(({ logicalTabId }) => logicalTabId)).size !== tabs.length ||
      new Set(tabs.map(({ firefoxTabId }) => firefoxTabId)).size !== tabs.length
    ) {
      throw invalidClose("Selected tabs must be unique.");
    }
    return { kind: value.kind, tabs };
  }
  if (value.kind === TAB_CLOSE_TARGET_KINDS.GROUP) {
    if (
      !hasExactKeys(value, ["kind", "logicalGroupId"]) ||
      typeof value.logicalGroupId !== "string" ||
      !LOGICAL_GROUP_ID_PATTERN.test(value.logicalGroupId)
    ) {
      throw invalidClose("The group target is invalid.");
    }
    return { kind: value.kind, logicalGroupId: value.logicalGroupId };
  }
  if (
    !hasExactKeys(value, ["kind", "workspaceId"]) ||
    typeof value.workspaceId !== "string" ||
    !WORKSPACE_ID_PATTERN.test(value.workspaceId)
  ) {
    throw invalidClose("The workspace target is invalid.");
  }
  return { kind: value.kind, workspaceId: value.workspaceId };
}

export function parseTabClosePreflight(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["token", "target", "targetLabel", "scope", "tabCount", "fingerprint"]) ||
    typeof value.token !== "string" ||
    !CLOSE_TOKEN_PATTERN.test(value.token) ||
    !SCOPE_VALUES.has(value.scope) ||
    typeof value.fingerprint !== "string" ||
    !CLOSE_FINGERPRINT_PATTERN.test(value.fingerprint)
  ) {
    throw invalidClose("The preflight has an invalid shape.");
  }
  return {
    token: value.token,
    target: parseTabCloseTarget(value.target),
    targetLabel: parseTargetLabel(value.targetLabel),
    scope: value.scope,
    tabCount: parseCount(value.tabCount, "Preflight tab count"),
    fingerprint: value.fingerprint
  };
}

export function parseTabCloseOutcome(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "target", "targetLabel", "scope", "status", "requestedCount", "closedCount",
      "remainingCount", "replacementCount", "reasons"
    ]) ||
    !SCOPE_VALUES.has(value.scope) ||
    !STATUS_VALUES.has(value.status)
  ) {
    throw invalidClose("The outcome has an invalid shape.");
  }
  const requestedCount = parseCount(value.requestedCount, "Requested count");
  const closedCount = parseCount(value.closedCount, "Closed count");
  const remainingCount = parseCount(value.remainingCount, "Remaining count");
  const replacementCount = parseCount(value.replacementCount, "Replacement count");
  const reasons = parseReasons(value.reasons);
  if (closedCount + remainingCount !== requestedCount) {
    throw invalidClose("The outcome counts are inconsistent.");
  }
  if (
    (value.status === WORKSPACE_OPERATION_STATUSES.APPLIED && remainingCount !== 0) ||
    (value.status === WORKSPACE_OPERATION_STATUSES.PARTIAL && (closedCount === 0 || remainingCount === 0)) ||
    (value.status === WORKSPACE_OPERATION_STATUSES.SKIPPED &&
      (closedCount !== 0 || !reasons.some(({ reason }) => reason === WORKSPACE_OPERATION_REASONS.STALE_REQUEST)))
  ) {
    throw invalidClose("The outcome status is inconsistent.");
  }
  return {
    target: parseTabCloseTarget(value.target),
    targetLabel: parseTargetLabel(value.targetLabel),
    scope: value.scope,
    status: value.status,
    requestedCount,
    closedCount,
    remainingCount,
    replacementCount,
    reasons
  };
}

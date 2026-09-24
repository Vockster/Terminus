import { WORKSPACE_PENDING_OPERATION_KINDS } from "./workspace-runtime.js";

export const WORKSPACE_OPERATION_STATUSES = Object.freeze({
  APPLIED: "applied",
  PARTIAL: "partial",
  SKIPPED: "skipped",
  FAILED: "failed"
});

export const WORKSPACE_NOTICE_SEVERITIES = Object.freeze({
  WARNING: "warning",
  ERROR: "error"
});

export const WORKSPACE_OPERATION_REASONS = Object.freeze({
  ACTIVE: "protected-active",
  PINNED: "protected-pinned",
  SHARING: "protected-sharing",
  CLOSING: "protected-closing",
  MISSING: "missing-tab",
  BROWSER_FAILURE: "browser-failure",
  MIXED_GROUP: "mixed-workspace-group",
  INCOMPLETE: "incomplete-convergence",
  STALE_REQUEST: "stale-request"
});

export const WORKSPACE_NOTICE_SCHEMA_VERSION = 2;

// The first fresh-inventory check that kept a window from converging, in the
// order the reconciler evaluates them. It names a check, never page data.
export const WORKSPACE_CONVERGENCE_CHECKS = Object.freeze({
  NO_ACTIVE_WORKSPACE_TABS: "no-active-workspace-tabs",
  ACTIVE_VISIBILITY: "active-visibility",
  INACTIVE_TAB_VISIBLE: "inactive-tab-visible",
  INACTIVE_TAB_PINNED: "inactive-tab-pinned",
  INACTIVE_TAB_SPLIT: "inactive-tab-split",
  INACTIVE_TAB_GROUPED: "inactive-tab-grouped",
  MISSING_LAYOUT: "missing-layout",
  TAB_ORDER: "tab-order",
  PIN_STATE: "pin-state",
  GROUP_MEMBERSHIP: "group-membership",
  GROUP_METADATA: "group-metadata",
  NO_ACTIVE_TAB: "no-active-tab",
  SUCCESSOR_CHAIN: "successor-chain"
});

const OPERATION_VALUES = new Set(Object.values(WORKSPACE_PENDING_OPERATION_KINDS));
const STATUS_VALUES = new Set(Object.values(WORKSPACE_OPERATION_STATUSES));
const SEVERITY_VALUES = new Set(Object.values(WORKSPACE_NOTICE_SEVERITIES));
const REASON_VALUES = new Set(Object.values(WORKSPACE_OPERATION_REASONS));
const CONVERGENCE_CHECK_VALUES = new Set(Object.values(WORKSPACE_CONVERGENCE_CHECKS));
const NOTICE_ID_PATTERN = /^notice-[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_REASON_ENTRIES = 16;
const MAX_COUNT = 1_000_000;

function invalidOperation(reason) {
  return new TypeError(`Invalid workspace operation data. ${reason}`);
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

function parseCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
    throw invalidOperation(`${label} is invalid.`);
  }
  return value;
}

function parseOperation(value) {
  if (!OPERATION_VALUES.has(value)) {
    throw invalidOperation("The operation kind is invalid.");
  }
  return value;
}

function parseReasons(value) {
  if (!Array.isArray(value) || value.length > MAX_REASON_ENTRIES) {
    throw invalidOperation("The reason list is invalid.");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["reason", "count", "retryable"])) {
      throw invalidOperation(`Reason ${index} has an invalid shape.`);
    }
    if (!REASON_VALUES.has(entry.reason) || seen.has(entry.reason)) {
      throw invalidOperation(`Reason ${index} is invalid or duplicated.`);
    }
    if (typeof entry.retryable !== "boolean") {
      throw invalidOperation(`Reason ${index} has an invalid retryable state.`);
    }
    seen.add(entry.reason);
    return {
      reason: entry.reason,
      count: parseCount(entry.count, `Reason ${index} count`),
      retryable: entry.retryable
    };
  });
}

export function parseWorkspaceOperationOutcome(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "operation",
      "status",
      "requestedCount",
      "appliedCount",
      "skipped",
      "failedCount",
      "observed"
    ])
  ) {
    throw invalidOperation("The outcome has an invalid shape.");
  }
  if (!STATUS_VALUES.has(value.status)) {
    throw invalidOperation("The outcome status is invalid.");
  }
  if (
    !isRecord(value.observed) ||
    !hasExactKeys(value.observed, [
      "tabCount",
      "hiddenCount",
      "visibleCount",
      "pinnedCount",
      "groupedTabCount"
    ])
  ) {
    throw invalidOperation("The observed state has an invalid shape.");
  }
  const requestedCount = parseCount(value.requestedCount, "Requested count");
  const appliedCount = parseCount(value.appliedCount, "Applied count");
  const failedCount = parseCount(value.failedCount, "Failed count");
  const skipped = parseReasons(value.skipped);
  if (
    requestedCount !==
    appliedCount + failedCount + skipped.reduce((sum, entry) => sum + entry.count, 0)
  ) {
    throw invalidOperation("The outcome counts are inconsistent.");
  }
  const observed = {
    tabCount: parseCount(value.observed.tabCount, "Observed tab count"),
    hiddenCount: parseCount(value.observed.hiddenCount, "Observed hidden count"),
    visibleCount: parseCount(value.observed.visibleCount, "Observed visible count"),
    pinnedCount: parseCount(value.observed.pinnedCount, "Observed pinned count"),
    groupedTabCount: parseCount(value.observed.groupedTabCount, "Observed grouped count")
  };
  if (observed.hiddenCount + observed.visibleCount !== observed.tabCount) {
    throw invalidOperation("The observed visibility counts are inconsistent.");
  }
  return {
    operation: parseOperation(value.operation),
    status: value.status,
    requestedCount,
    appliedCount,
    skipped,
    failedCount,
    observed
  };
}

export function parseWorkspaceNotice(value) {
  if (value === null) {
    return null;
  }
  // Schema 1 notices may still sit in live Firefox session values; they read
  // as schema 2 without a recorded convergence check.
  const legacy = isRecord(value) && value.schemaVersion === 1;
  const keys = ["schemaVersion", "id", "operation", "severity", "retryable", "reasons"];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, legacy ? keys : [...keys, "convergenceCheck"]) ||
    (!legacy && value.schemaVersion !== WORKSPACE_NOTICE_SCHEMA_VERSION) ||
    typeof value.id !== "string" ||
    !NOTICE_ID_PATTERN.test(value.id) ||
    !SEVERITY_VALUES.has(value.severity) ||
    typeof value.retryable !== "boolean"
  ) {
    throw invalidOperation("The notice has an invalid shape.");
  }
  const reasons = parseReasons(value.reasons);
  if (reasons.length === 0 || value.retryable !== reasons.some((entry) => entry.retryable)) {
    throw invalidOperation("The notice retryable state is inconsistent.");
  }
  const convergenceCheck = legacy ? null : value.convergenceCheck;
  if (convergenceCheck !== null && !CONVERGENCE_CHECK_VALUES.has(convergenceCheck)) {
    throw invalidOperation("The notice convergence check is invalid.");
  }
  return {
    schemaVersion: WORKSPACE_NOTICE_SCHEMA_VERSION,
    id: value.id,
    operation: parseOperation(value.operation),
    severity: value.severity,
    retryable: value.retryable,
    reasons,
    convergenceCheck
  };
}

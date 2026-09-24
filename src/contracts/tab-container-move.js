import { parseContainerAssignment } from "./containers.js";
import { WORKSPACE_OPERATION_STATUSES } from "./workspace-operation.js";

export const MAX_TAB_CONTAINER_MOVE_TABS = 4_096;

export const TAB_CONTAINER_MOVE_REASONS = Object.freeze({
  ALREADY_IN_CONTAINER: "already-in-container",
  SPLIT_LOCKED: "split-locked",
  UNSUPPORTED_URL: "unsupported-url",
  CLOSE_REFUSED: "close-refused",
  CONTAINER_UNAVAILABLE: "container-unavailable",
  STALE_REQUEST: "stale-request",
  BROWSER_FAILURE: "browser-failure"
});

// Every reason except a browser failure leaves the tab where it was on
// purpose, so it counts as skipped rather than failed.
const FAILED_REASONS = new Set([TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE]);
const REASON_VALUES = new Set(Object.values(TAB_CONTAINER_MOVE_REASONS));
const STATUS_VALUES = new Set(Object.values(WORKSPACE_OPERATION_STATUSES));
const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_COUNT = MAX_TAB_CONTAINER_MOVE_TABS;

function invalidMove(reason) {
  return new TypeError(`Invalid container move data. ${reason}`);
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
    throw invalidMove(`${label} is invalid.`);
  }
  return value;
}

export function isFailedContainerMoveReason(reason) {
  return FAILED_REASONS.has(reason);
}

export function parseTabContainerMoveRequest(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["tabs", "assignment"]) ||
    !Array.isArray(value.tabs) ||
    value.tabs.length === 0 ||
    value.tabs.length > MAX_TAB_CONTAINER_MOVE_TABS
  ) {
    throw invalidMove("The request has an invalid shape.");
  }
  const tabs = value.tabs.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["logicalTabId", "firefoxTabId"]) ||
      typeof entry.logicalTabId !== "string" ||
      !LOGICAL_TAB_ID_PATTERN.test(entry.logicalTabId) ||
      !Number.isInteger(entry.firefoxTabId) ||
      entry.firefoxTabId < 0
    ) {
      throw invalidMove(`Tab ${index} is invalid.`);
    }
    return { logicalTabId: entry.logicalTabId, firefoxTabId: entry.firefoxTabId };
  });
  if (
    new Set(tabs.map(({ logicalTabId }) => logicalTabId)).size !== tabs.length ||
    new Set(tabs.map(({ firefoxTabId }) => firefoxTabId)).size !== tabs.length
  ) {
    throw invalidMove("Tabs must be unique.");
  }
  return {
    tabs,
    assignment: parseContainerAssignment(value.assignment, invalidMove)
  };
}

export function containerMoveStatus({ requestedCount, movedCount, failedCount }) {
  if (movedCount === requestedCount) return WORKSPACE_OPERATION_STATUSES.APPLIED;
  if (movedCount > 0) return WORKSPACE_OPERATION_STATUSES.PARTIAL;
  return failedCount > 0
    ? WORKSPACE_OPERATION_STATUSES.FAILED
    : WORKSPACE_OPERATION_STATUSES.SKIPPED;
}

// Outcomes carry counts and reasons only: no URL, title, or native ID.
export function parseTabContainerMoveOutcome(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "status", "requestedCount", "movedCount", "skippedCount", "failedCount", "reasons"
    ]) ||
    !STATUS_VALUES.has(value.status) ||
    !Array.isArray(value.reasons) ||
    value.reasons.length > REASON_VALUES.size
  ) {
    throw invalidMove("The outcome has an invalid shape.");
  }
  const outcome = {
    status: value.status,
    requestedCount: parseCount(value.requestedCount, "Requested count"),
    movedCount: parseCount(value.movedCount, "Moved count"),
    skippedCount: parseCount(value.skippedCount, "Skipped count"),
    failedCount: parseCount(value.failedCount, "Failed count"),
    reasons: []
  };
  const seen = new Set();
  let skippedReasons = 0;
  let failedReasons = 0;
  for (const [index, entry] of value.reasons.entries()) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["reason", "count"]) ||
      !REASON_VALUES.has(entry.reason) ||
      seen.has(entry.reason)
    ) {
      throw invalidMove(`Reason ${index} is invalid.`);
    }
    const count = parseCount(entry.count, `Reason ${index} count`);
    if (count === 0) {
      throw invalidMove(`Reason ${index} count is invalid.`);
    }
    seen.add(entry.reason);
    if (isFailedContainerMoveReason(entry.reason)) failedReasons += count;
    else skippedReasons += count;
    outcome.reasons.push({ reason: entry.reason, count });
  }
  if (
    outcome.movedCount + outcome.skippedCount + outcome.failedCount !== outcome.requestedCount ||
    skippedReasons !== outcome.skippedCount ||
    failedReasons !== outcome.failedCount ||
    containerMoveStatus(outcome) !== outcome.status
  ) {
    throw invalidMove("The outcome counts are inconsistent.");
  }
  return outcome;
}

import { parseWorkspaceRuntime } from "./workspace-runtime.js";
import { parseWorkspaceState } from "./workspace-state.js";
import { WORKSPACE_SCOPES } from "./workspace-scope.js";

export const SIDEBAR_UNDO_SCHEMA_VERSION = 1;
export const SIDEBAR_UNDO_STORAGE_KEYS = Object.freeze({
  [WORKSPACE_SCOPES.NORMAL]: "terminus.sidebarUndo.normal",
  [WORKSPACE_SCOPES.PRIVATE]: "terminus.sidebarUndo.private"
});
export const SIDEBAR_UNDO_STATES = Object.freeze({
  PREPARED: "prepared",
  READY: "ready",
  CONSUMING: "consuming"
});
export const SIDEBAR_UNDO_ACTIONS = Object.freeze({
  UNDO: "undo",
  REDO: "redo"
});
export const SIDEBAR_UNDO_OPERATION_KINDS = Object.freeze({
  TABS_RELOCATE: "tabs-relocate",
  GROUP_CREATE: "group-create",
  GROUP_RELOCATE: "group-relocate",
  GROUP_RENAME: "group-rename",
  GROUP_DELETE: "group-delete",
  TREE_FLATTEN: "tree-flatten",
  WORKSPACE_CREATE: "workspace-create",
  WORKSPACE_RENAME: "workspace-rename",
  WORKSPACE_RELOCATE: "workspace-relocate",
  WORKSPACE_REMOVE: "workspace-remove",
  TABS_UNLOAD: "tabs-unload",
  TABS_CLOSE: "tabs-close",
  TABS_CONTAINER_MOVE: "tabs-container-move"
});
export const SIDEBAR_UNDO_MESSAGE_TYPES = Object.freeze({
  GET: "sidebarUndo.get",
  EXECUTE: "sidebarUndo.execute",
  CHANGED: "sidebarUndo.changed"
});
export const SIDEBAR_UNDO_OUTCOME_STATUSES = Object.freeze({
  APPLIED: "applied",
  PARTIAL: "partial",
  SKIPPED: "skipped",
  FAILED: "failed"
});
export const SIDEBAR_UNDO_REASON_CODES = Object.freeze({
  STALE: "stale-state",
  MISSING_TAB: "missing-tab",
  BROWSER_FAILURE: "browser-failure",
  CONTAINER_UNAVAILABLE: "container-unavailable",
  PROTECTED_URL: "protected-url-approximated",
  PARENT_MISSING: "parent-missing-approximated",
  IDENTITY_CONFLICT: "identity-conflict-approximated",
  SAFETY_RETAINED: "safety-successor-retained",
  STORAGE_UNAVAILABLE: "storage-unavailable"
});

const SCOPE_VALUES = new Set(Object.values(WORKSPACE_SCOPES));
const STATE_VALUES = new Set(Object.values(SIDEBAR_UNDO_STATES));
const ACTION_VALUES = new Set(Object.values(SIDEBAR_UNDO_ACTIONS));
const OPERATION_VALUES = new Set(Object.values(SIDEBAR_UNDO_OPERATION_KINDS));
const OUTCOME_STATUS_VALUES = new Set(Object.values(SIDEBAR_UNDO_OUTCOME_STATUSES));
const REASON_VALUES = new Set(Object.values(SIDEBAR_UNDO_REASON_CODES));
const UNDO_ID_PATTERN = /^undo-[a-z0-9][a-z0-9-]{0,127}$/;
const FINGERPRINT_PATTERN = /^(?:pending|undo-post-[0-9a-f]{16})$/;
const SEMANTIC_KEY_PATTERN = /^(?:rail|workspace|window|assignment|tab):?[a-z0-9-]{0,128}$/;
const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;
const CONTAINER_REF_PATTERN = /^ctr-[a-z0-9][a-z0-9-]{0,123}$/;
const MAX_LABEL_LENGTH = 160;
const MAX_URL_LENGTH = 65_536;
const MAX_TITLE_LENGTH = 4_096;
const MAX_ENTRIES = 256;
const MAX_AFFECTED_KEYS = 4_096;
const MAX_COUNT = 1_000_000;

function invalidUndo(reason) {
  return new TypeError(`Invalid sidebar Undo data. ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
    throw invalidUndo(`${label} is invalid.`);
  }
  return value;
}

function parseBrowserTab(value, index) {
  if (!isRecord(value) || !exactKeys(value, [
    "logicalTabId", "firefoxTabId", "windowId", "logicalWindowId", "workspaceId", "index", "url", "title",
    "pinned", "discarded", "active", "hidden", "containerRef"
  ])) {
    throw invalidUndo(`Browser tab ${index} has an invalid shape.`);
  }
  if (
    typeof value.logicalTabId !== "string" ||
    !LOGICAL_TAB_ID_PATTERN.test(value.logicalTabId) ||
    !Number.isInteger(value.firefoxTabId) || value.firefoxTabId < 0 ||
    !Number.isInteger(value.windowId) || value.windowId < 0 ||
    typeof value.logicalWindowId !== "string" || !/^window-[a-z0-9][a-z0-9-]{0,127}$/.test(value.logicalWindowId) ||
    typeof value.workspaceId !== "string" || value.workspaceId.length === 0 ||
    !Number.isInteger(value.index) || value.index < 0 ||
    typeof value.url !== "string" || value.url.length > MAX_URL_LENGTH ||
    typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH ||
    typeof value.pinned !== "boolean" || typeof value.discarded !== "boolean" ||
    typeof value.active !== "boolean" || typeof value.hidden !== "boolean" ||
    (value.containerRef !== null &&
      (typeof value.containerRef !== "string" || !CONTAINER_REF_PATTERN.test(value.containerRef)))
  ) {
    throw invalidUndo(`Browser tab ${index} is invalid.`);
  }
  return { ...value };
}

export function parseSidebarUndoSnapshot(value) {
  if (!isRecord(value) || !exactKeys(value, ["workspaceState", "workspaceRuntime", "browserTabs"])) {
    throw invalidUndo("The captured snapshot has an invalid shape.");
  }
  const workspaceState = parseWorkspaceState(value.workspaceState);
  const workspaceIds = workspaceState.workspaces.map(({ id }) => id);
  const workspaceRuntime = parseWorkspaceRuntime(value.workspaceRuntime, workspaceIds);
  if (!Array.isArray(value.browserTabs) || value.browserTabs.length > MAX_COUNT) {
    throw invalidUndo("The captured browser tabs are invalid.");
  }
  const browserTabs = value.browserTabs.map(parseBrowserTab);
  if (new Set(browserTabs.map(({ logicalTabId }) => logicalTabId)).size !== browserTabs.length) {
    throw invalidUndo("Captured logical tab identities must be unique.");
  }
  return { workspaceState, workspaceRuntime, browserTabs };
}

function parseAffectedKeys(value) {
  if (!Array.isArray(value) || value.length > MAX_AFFECTED_KEYS) {
    throw invalidUndo("The affected key list is invalid.");
  }
  const keys = value.map((key) => {
    if (typeof key !== "string" || !SEMANTIC_KEY_PATTERN.test(key)) {
      throw invalidUndo("An affected semantic key is invalid.");
    }
    return key;
  });
  if (new Set(keys).size !== keys.length) {
    throw invalidUndo("Affected semantic keys must be unique.");
  }
  return keys;
}

export function parseSidebarUndoEntry(value, expectedScope = null) {
  if (!isRecord(value) || !exactKeys(value, [
    "schemaVersion", "undoId", "scope", "originWindowId", "operation", "label", "action", "state",
    "affectedKeys", "before", "expectedPostFingerprint"
  ])) {
    throw invalidUndo("The entry has an invalid shape.");
  }
  if (
    value.schemaVersion !== SIDEBAR_UNDO_SCHEMA_VERSION ||
    typeof value.undoId !== "string" || !UNDO_ID_PATTERN.test(value.undoId) ||
    !SCOPE_VALUES.has(value.scope) ||
    (expectedScope !== null && value.scope !== expectedScope) ||
    !Number.isInteger(value.originWindowId) || value.originWindowId < 0 ||
    !OPERATION_VALUES.has(value.operation) ||
    typeof value.label !== "string" || value.label.trim().length === 0 ||
    value.label.length > MAX_LABEL_LENGTH ||
    !ACTION_VALUES.has(value.action) ||
    !STATE_VALUES.has(value.state) ||
    typeof value.expectedPostFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.expectedPostFingerprint) ||
    ((value.state === SIDEBAR_UNDO_STATES.PREPARED) !==
      (value.expectedPostFingerprint === "pending"))
  ) {
    throw invalidUndo("The entry is invalid.");
  }
  return {
    schemaVersion: value.schemaVersion,
    undoId: value.undoId,
    scope: value.scope,
    originWindowId: value.originWindowId,
    operation: value.operation,
    label: value.label,
    action: value.action,
    state: value.state,
    affectedKeys: parseAffectedKeys(value.affectedKeys),
    before: parseSidebarUndoSnapshot(value.before),
    expectedPostFingerprint: value.expectedPostFingerprint
  };
}

export function createEmptySidebarUndoDocument(sequence = 0) {
  return { schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION, sequence, entries: [] };
}

export function parseSidebarUndoDocument(value, scope) {
  if (
    !SCOPE_VALUES.has(scope) ||
    !isRecord(value) ||
    !exactKeys(value, ["schemaVersion", "sequence", "entries"]) ||
    value.schemaVersion !== SIDEBAR_UNDO_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
    !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES
  ) {
    throw invalidUndo("The session document is invalid.");
  }
  const entries = value.entries.map((entry) => parseSidebarUndoEntry(entry, scope));
  if (new Set(entries.map(({ originWindowId }) => originWindowId)).size !== entries.length) {
    throw invalidUndo("Only one entry per Firefox window is allowed.");
  }
  return { schemaVersion: value.schemaVersion, sequence: value.sequence, entries };
}

export function sidebarUndoSummary(entry = null) {
  if (entry === null) {
    return { available: false, undoId: null, operation: null, label: null, action: null };
  }
  const parsed = parseSidebarUndoEntry(entry);
  if (parsed.state !== SIDEBAR_UNDO_STATES.READY) {
    return { available: false, undoId: null, operation: null, label: null, action: null };
  }
  return {
    available: true,
    undoId: parsed.undoId,
    operation: parsed.operation,
    label: parsed.label,
    action: parsed.action
  };
}

export function parseSidebarUndoSummary(value) {
  if (!isRecord(value) || !exactKeys(value, ["available", "undoId", "operation", "label", "action"])) {
    throw invalidUndo("The summary has an invalid shape.");
  }
  if (typeof value.available !== "boolean") {
    throw invalidUndo("The summary availability is invalid.");
  }
  if (!value.available) {
    if (value.undoId !== null || value.operation !== null || value.label !== null || value.action !== null) {
      throw invalidUndo("An unavailable summary cannot expose entry data.");
    }
    return { ...value };
  }
  if (
    typeof value.undoId !== "string" || !UNDO_ID_PATTERN.test(value.undoId) ||
    !OPERATION_VALUES.has(value.operation) ||
    !ACTION_VALUES.has(value.action) ||
    typeof value.label !== "string" || value.label.trim().length === 0 ||
    value.label.length > MAX_LABEL_LENGTH
  ) {
    throw invalidUndo("The available summary is invalid.");
  }
  return { ...value };
}

export function parseSidebarUndoOutcome(value) {
  if (!isRecord(value) || !exactKeys(value, [
    "status", "requestedCount", "restoredCount", "skippedCount", "failedCount",
    "approximatedCount", "retainedSafetyCount", "reasons"
  ]) || !OUTCOME_STATUS_VALUES.has(value.status) || !Array.isArray(value.reasons)) {
    throw invalidUndo("The inverse outcome has an invalid shape.");
  }
  const outcome = {
    status: value.status,
    requestedCount: parseCount(value.requestedCount, "Requested count"),
    restoredCount: parseCount(value.restoredCount, "Restored count"),
    skippedCount: parseCount(value.skippedCount, "Skipped count"),
    failedCount: parseCount(value.failedCount, "Failed count"),
    approximatedCount: parseCount(value.approximatedCount, "Approximated count"),
    retainedSafetyCount: parseCount(value.retainedSafetyCount, "Retained safety count"),
    reasons: value.reasons.map((entry, index) => {
      if (!isRecord(entry) || !exactKeys(entry, ["reason", "count"]) || !REASON_VALUES.has(entry.reason)) {
        throw invalidUndo(`Outcome reason ${index} is invalid.`);
      }
      return { reason: entry.reason, count: parseCount(entry.count, `Outcome reason ${index} count`) };
    })
  };
  if (outcome.restoredCount + outcome.skippedCount + outcome.failedCount !== outcome.requestedCount) {
    throw invalidUndo("The inverse outcome totals are inconsistent.");
  }
  return outcome;
}

export function sidebarUndoChanged(windowId, scope, summary) {
  if (!Number.isInteger(windowId) || windowId < 0 || !SCOPE_VALUES.has(scope)) {
    throw invalidUndo("The change destination is invalid.");
  }
  return {
    type: SIDEBAR_UNDO_MESSAGE_TYPES.CHANGED,
    windowId,
    scope,
    summary: parseSidebarUndoSummary(summary)
  };
}

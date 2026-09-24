import { parseSettingsState } from "./settings-state.js";
import { parseWorkspaceRuntime } from "./workspace-runtime.js";
import { parseWorkspaceState } from "./workspace-state.js";

export const SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY = "configurationSyncApplyJournal";
export const SETTINGS_TRANSFER_JOURNAL_SCHEMA_VERSION = 1;

export class SettingsTransferError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsTransferError";
  }
}

function invalidData(message) {
  return new SettingsTransferError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseDocuments(value, label) {
  if (!isRecord(value) || !hasExactKeys(value, ["settings", "workspaceState", "runtime"])) {
    throw invalidData(`${label} transfer documents have an invalid shape.`);
  }
  try {
    const workspaceState = parseWorkspaceState(value.workspaceState);
    const workspaceIds = workspaceState.workspaces.map(({ id }) => id);
    return {
      settings: parseSettingsState(value.settings),
      workspaceState,
      runtime: parseWorkspaceRuntime(value.runtime, workspaceIds)
    };
  } catch (error) {
    if (error instanceof SettingsTransferError) throw error;
    throw invalidData(error.message);
  }
}

export function parseSettingsTransferJournal(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "revisionId", "phase", "before", "after", "report"]) ||
    value.schemaVersion !== SETTINGS_TRANSFER_JOURNAL_SCHEMA_VERSION ||
    typeof value.revisionId !== "string" ||
    !/^revision-[a-z0-9-]{1,128}$/.test(value.revisionId) ||
    !["applying", "reconciling"].includes(value.phase)
  ) {
    throw invalidData("The settings transfer journal has an invalid shape.");
  }
  if (
    !isRecord(value.report) ||
    !hasExactKeys(value.report, [
      "workspaceDefinitionsChanged",
      "removedWorkspaces",
      "reassignedTabCount"
    ]) ||
    typeof value.report.workspaceDefinitionsChanged !== "boolean" ||
    !Number.isSafeInteger(value.report.reassignedTabCount) ||
    value.report.reassignedTabCount < 0 ||
    !Array.isArray(value.report.removedWorkspaces) ||
    value.report.removedWorkspaces.length > 100 ||
    value.report.removedWorkspaces.some(
      (entry) =>
        !isRecord(entry) ||
        !hasExactKeys(entry, ["sourceWorkspaceId", "destinationWorkspaceId"]) ||
        typeof entry.sourceWorkspaceId !== "string" ||
        typeof entry.destinationWorkspaceId !== "string"
    )
  ) {
    throw invalidData("The settings transfer report is invalid.");
  }
  return {
    schemaVersion: SETTINGS_TRANSFER_JOURNAL_SCHEMA_VERSION,
    revisionId: value.revisionId,
    phase: value.phase,
    before: parseDocuments(value.before, "Before"),
    after: parseDocuments(value.after, "After"),
    report: {
      workspaceDefinitionsChanged: value.report.workspaceDefinitionsChanged,
      removedWorkspaces: value.report.removedWorkspaces.map((entry) => ({ ...entry })),
      reassignedTabCount: value.report.reassignedTabCount
    }
  };
}

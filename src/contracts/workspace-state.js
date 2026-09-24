import { parseContainerRefId } from "./containers.js";

export const WORKSPACE_STATE_LEGACY_SCHEMA_VERSION = 1;
export const WORKSPACE_STATE_V2_SCHEMA_VERSION = 2;
export const WORKSPACE_STATE_V3_SCHEMA_VERSION = 3;
export const WORKSPACE_STATE_PREVIOUS_SCHEMA_VERSION = 4;
export const WORKSPACE_STATE_SCHEMA_VERSION = 5;
export const WORKSPACE_STATE_STORAGE_KEY = "workspaceState";
export const WORKSPACE_STATE_MIGRATION_STORAGE_KEY = "workspaceStateMigration";
export const MAX_WORKSPACES = 100;
export const MAX_RAIL_ENTRIES = 200;
export const WORKSPACE_DIVIDER_SIZE_LIMITS = Object.freeze({
  min: 4,
  max: 64,
  defaultValue: 16
});

export const WORKSPACE_STATE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  WORKSPACE_ACTIVE: "WORKSPACE_ACTIVE",
  INVALID_STATE: "INVALID_STATE",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const WORKSPACE_STATE_ERROR_MESSAGES = Object.freeze({
  [WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST]: "The workspace request is invalid.",
  [WORKSPACE_STATE_ERROR_CODES.WORKSPACE_ACTIVE]:
    "This workspace is active in an open window and was not unloaded.",
  [WORKSPACE_STATE_ERROR_CODES.INVALID_STATE]:
    "Stored workspace data is invalid and was not changed.",
  [WORKSPACE_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]:
    "Stored workspace data uses an unsupported schema version and was not changed.",
  [WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE]:
    "Workspace storage is unavailable. Stored data was not changed.",
  [WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR]: "Workspace data could not be loaded."
});

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SPACER_ID_PATTERN = /^spacer-[a-z0-9][a-z0-9-]*$/;
const DIVIDER_ID_PATTERN = /^(?:divider|spacer)-[a-z0-9][a-z0-9-]*$/;
const SPACE_ID_PATTERN = /^space-[a-z0-9][a-z0-9-]*$/;
const ICON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export class WorkspaceStateError extends Error {
  constructor(code, message = WORKSPACE_STATE_ERROR_MESSAGES[code], options = {}) {
    super(message, options);
    this.name = "WorkspaceStateError";
    this.code = code;
  }
}

function invalidState(reason) {
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

function parseWorkspace(value, index, includeDefaultContainer) {
  const expectedKeys = ["id", "name", "icon", "color"];
  if (includeDefaultContainer) expectedKeys.push("defaultContainerRef");
  if (!isRecord(value) || !hasExactKeys(value, expectedKeys)) {
    throw invalidState(`Workspace ${index} has an invalid shape.`);
  }
  if (typeof value.id !== "string" || !WORKSPACE_ID_PATTERN.test(value.id)) {
    throw invalidState(`Workspace ${index} has an invalid ID.`);
  }
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > 80 ||
    value.name !== value.name.trim()
  ) {
    throw invalidState(`Workspace ${index} has an invalid name.`);
  }
  if (typeof value.icon !== "string" || !ICON_ID_PATTERN.test(value.icon)) {
    throw invalidState(`Workspace ${index} has an invalid icon ID.`);
  }
  if (typeof value.color !== "string" || !COLOR_PATTERN.test(value.color)) {
    throw invalidState(`Workspace ${index} has an invalid color.`);
  }

  const parsed = {
    id: value.id,
    name: value.name,
    icon: value.icon,
    color: value.color
  };
  if (includeDefaultContainer) {
    parsed.defaultContainerRef = value.defaultContainerRef === null
      ? null
      : parseContainerRefId(value.defaultContainerRef, invalidState);
  }
  return parsed;
}

function parseWorkspaceRailEntry(value, index) {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "workspaceId"])) {
    throw invalidState(`Rail entry ${index} has an invalid shape.`);
  }
  if (value.kind !== "workspace") {
    throw invalidState(`Rail entry ${index} has an unsupported kind.`);
  }
  if (typeof value.workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(value.workspaceId)) {
    throw invalidState(`Rail entry ${index} has an invalid workspace ID.`);
  }

  return {
    kind: "workspace",
    workspaceId: value.workspaceId
  };
}

function parseSpacerRailEntry(value, index, includeSize) {
  const expectedKeys = includeSize ? ["kind", "id", "size"] : ["kind", "id"];
  if (!hasExactKeys(value, expectedKeys)) {
    throw invalidState(`Rail entry ${index} has an invalid shape.`);
  }
  if (
    typeof value.id !== "string" ||
    value.id.length > 128 ||
    !SPACER_ID_PATTERN.test(value.id)
  ) {
    throw invalidState(`Rail entry ${index} has an invalid spacer ID.`);
  }
  if (
    includeSize &&
    value.size !== null &&
    (!Number.isInteger(value.size) ||
      value.size < WORKSPACE_DIVIDER_SIZE_LIMITS.min ||
      value.size > WORKSPACE_DIVIDER_SIZE_LIMITS.max)
  ) {
    throw invalidState(`Rail entry ${index} has an invalid spacer size.`);
  }
  return includeSize
    ? { kind: "spacer", id: value.id, size: value.size }
    : { kind: "spacer", id: value.id };
}

function parseDividerRailEntry(value, index) {
  if (!hasExactKeys(value, ["kind", "id", "size"])) {
    throw invalidState(`Rail entry ${index} has an invalid shape.`);
  }
  if (
    typeof value.id !== "string" ||
    value.id.length > 128 ||
    !DIVIDER_ID_PATTERN.test(value.id)
  ) {
    throw invalidState(`Rail entry ${index} has an invalid divider ID.`);
  }
  if (
    value.size !== null &&
    (!Number.isInteger(value.size) ||
      value.size < WORKSPACE_DIVIDER_SIZE_LIMITS.min ||
      value.size > WORKSPACE_DIVIDER_SIZE_LIMITS.max)
  ) {
    throw invalidState(`Rail entry ${index} has an invalid divider size.`);
  }
  return { kind: "divider", id: value.id, size: value.size };
}

function parseSpaceRailEntry(value, index) {
  if (!hasExactKeys(value, ["kind", "id"])) {
    throw invalidState(`Rail entry ${index} has an invalid shape.`);
  }
  if (
    typeof value.id !== "string" ||
    value.id.length > 128 ||
    !SPACE_ID_PATTERN.test(value.id)
  ) {
    throw invalidState(`Rail entry ${index} has an invalid space ID.`);
  }
  return { kind: "space", id: value.id };
}

function parseRailEntry(value, index, railShape) {
  if (!isRecord(value)) {
    throw invalidState(`Rail entry ${index} has an invalid shape.`);
  }
  if (value.kind === "workspace") {
    return parseWorkspaceRailEntry(value, index);
  }
  if (railShape === "modern" && value.kind === "divider") {
    return parseDividerRailEntry(value, index);
  }
  if (railShape === "modern" && value.kind === "space") {
    return parseSpaceRailEntry(value, index);
  }
  if (["unsized-spacer", "sized-spacer"].includes(railShape) && value.kind === "spacer") {
    return parseSpacerRailEntry(value, index, railShape === "sized-spacer");
  }
  throw invalidState(`Rail entry ${index} has an unsupported kind.`);
}

function parseState(value, expectedVersion, { railShape, enforceLimits, includeDefaultContainer }) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "workspaces", "rail"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > WORKSPACE_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== expectedVersion) {
    throw invalidState(`Expected workspace schema version ${expectedVersion}.`);
  }
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0) {
    throw invalidState("At least one workspace is required.");
  }
  if (enforceLimits && value.workspaces.length > MAX_WORKSPACES) {
    throw invalidState(`No more than ${MAX_WORKSPACES} workspaces are allowed.`);
  }
  if (!Array.isArray(value.rail)) {
    throw invalidState("The rail must be an array.");
  }
  if (enforceLimits && value.rail.length > MAX_RAIL_ENTRIES) {
    throw invalidState(`No more than ${MAX_RAIL_ENTRIES} rail entries are allowed.`);
  }

  const workspaces = value.workspaces.map((workspace, index) =>
    parseWorkspace(workspace, index, includeDefaultContainer)
  );
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  if (workspaceIds.size !== workspaces.length) {
    throw invalidState("Workspace IDs must be unique.");
  }

  const rail = value.rail.map((entry, index) => parseRailEntry(entry, index, railShape));
  const railWorkspaceIds = new Set();
  const railItemIds = new Set();
  for (const entry of rail) {
    if (entry.kind !== "workspace") {
      if (railItemIds.has(entry.id)) {
        throw invalidState("Rail item IDs must be unique.");
      }
      railItemIds.add(entry.id);
      continue;
    }
    if (!workspaceIds.has(entry.workspaceId)) {
      throw invalidState("A rail entry references an unknown workspace.");
    }
    if (railWorkspaceIds.has(entry.workspaceId)) {
      throw invalidState("A workspace appears more than once in the rail.");
    }
    railWorkspaceIds.add(entry.workspaceId);
  }
  if (railWorkspaceIds.size !== workspaceIds.size) {
    throw invalidState("Every workspace must appear exactly once in the rail.");
  }

  return { schemaVersion: expectedVersion, workspaces, rail };
}

export function parseWorkspaceStateV1(value) {
  return parseState(value, WORKSPACE_STATE_LEGACY_SCHEMA_VERSION, {
    railShape: "workspace-only",
    enforceLimits: false,
    includeDefaultContainer: false
  });
}

export function parseWorkspaceStateV2(value) {
  return parseState(value, WORKSPACE_STATE_V2_SCHEMA_VERSION, {
    railShape: "unsized-spacer",
    enforceLimits: true,
    includeDefaultContainer: false
  });
}

export function parseWorkspaceStateV3(value) {
  return parseState(value, WORKSPACE_STATE_V3_SCHEMA_VERSION, {
    railShape: "sized-spacer",
    enforceLimits: true,
    includeDefaultContainer: false
  });
}

export function parseWorkspaceStateV4(value) {
  return parseState(value, WORKSPACE_STATE_PREVIOUS_SCHEMA_VERSION, {
    railShape: "modern",
    enforceLimits: true,
    includeDefaultContainer: false
  });
}

// The workspace package carries the current shape without container
// assignments, so a setup moves between profiles without moving identities.
export function parseWorkspaceStateWithoutContainers(value) {
  return parseState(value, WORKSPACE_STATE_SCHEMA_VERSION, {
    railShape: "modern",
    enforceLimits: true,
    includeDefaultContainer: false
  });
}

export function parseWorkspaceState(value) {
  return parseState(value, WORKSPACE_STATE_SCHEMA_VERSION, {
    railShape: "modern",
    enforceLimits: true,
    includeDefaultContainer: true
  });
}

export function migrateWorkspaceStateV1ToV2(value) {
  const source = parseWorkspaceStateV1(value);
  return parseWorkspaceStateV2({
    schemaVersion: WORKSPACE_STATE_V2_SCHEMA_VERSION,
    workspaces: source.workspaces,
    rail: source.rail
  });
}

export function migrateWorkspaceStateV2ToV3(value) {
  const source = parseWorkspaceStateV2(value);
  return parseWorkspaceStateV3({
    schemaVersion: WORKSPACE_STATE_V3_SCHEMA_VERSION,
    workspaces: source.workspaces,
    rail: source.rail.map((entry) =>
      entry.kind === "spacer" ? { ...entry, size: null } : entry
    )
  });
}

export function migrateWorkspaceStateV3ToV4(value) {
  const source = parseWorkspaceStateV3(value);
  return parseWorkspaceStateV4({
    schemaVersion: WORKSPACE_STATE_PREVIOUS_SCHEMA_VERSION,
    workspaces: source.workspaces,
    rail: source.rail.map((entry) =>
      entry.kind === "spacer"
        ? { kind: "divider", id: entry.id, size: entry.size }
        : entry
    )
  });
}

export function migrateWorkspaceStateV4(value) {
  const source = parseWorkspaceStateV4(value);
  return parseWorkspaceState({
    ...source,
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspaces: source.workspaces.map((workspace) => ({
      ...workspace,
      defaultContainerRef: null
    }))
  });
}

export function migrateWorkspaceStateV3(value) {
  return migrateWorkspaceStateV4(migrateWorkspaceStateV3ToV4(value));
}

export function migrateWorkspaceStateV2(value) {
  return migrateWorkspaceStateV3(migrateWorkspaceStateV2ToV3(value));
}

export function migrateWorkspaceStateV1(value) {
  return migrateWorkspaceStateV2(migrateWorkspaceStateV1ToV2(value));
}

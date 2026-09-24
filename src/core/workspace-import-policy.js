import {
  FALLBACK_WORKSPACE_ICON,
  isWorkspaceIconId
} from "../contracts/workspace-icons.js";

export const WORKSPACE_IMPORT_BEHAVIORS = Object.freeze({
  MERGE: "merge",
  REPLACE: "replace"
});

export const WORKSPACE_IMPORT_ERROR_CODES = Object.freeze({
  INVALID_MAPPING: "INVALID_MAPPING",
  UNRESOLVED_ASSOCIATION: "UNRESOLVED_ASSOCIATION"
});

export class WorkspaceImportError extends Error {
  constructor(code, { workspaceIds = [] } = {}) {
    super(code === WORKSPACE_IMPORT_ERROR_CODES.UNRESOLVED_ASSOCIATION
      ? "One or more workspace associations could not be resolved."
      : "The workspace import mapping is invalid.");
    this.name = "WorkspaceImportError";
    this.code = code;
    this.workspaceIds = Object.freeze([...workspaceIds]);
  }
}

function invalidMapping(workspaceIds = []) {
  return new WorkspaceImportError(WORKSPACE_IMPORT_ERROR_CODES.INVALID_MAPPING, { workspaceIds });
}

function requireMap(value) {
  if (!(value instanceof Map)) throw invalidMapping();
  return value;
}

function mappedWorkspaceIds(sourceWorkspaces, workspaceIdMap) {
  const destinationIds = new Set();
  const result = new Map();
  for (const source of sourceWorkspaces) {
    const destinationId = workspaceIdMap.get(source?.id);
    if (
      typeof source?.id !== "string" ||
      typeof destinationId !== "string" ||
      destinationId.length === 0 ||
      destinationIds.has(destinationId)
    ) {
      throw invalidMapping(source?.id ? [source.id] : []);
    }
    destinationIds.add(destinationId);
    result.set(source.id, destinationId);
  }
  return result;
}

function normalizedIcon({ source, existing, behavior, resolveIcon }) {
  if (Object.prototype.hasOwnProperty.call(source, "icon")) {
    if (source.icon === FALLBACK_WORKSPACE_ICON.id) return FALLBACK_WORKSPACE_ICON.id;
    const resolved = resolveIcon(source.icon, source);
    if (isWorkspaceIconId(resolved)) return resolved;
  }
  if (behavior === WORKSPACE_IMPORT_BEHAVIORS.MERGE && existing) {
    return existing.icon;
  }
  return FALLBACK_WORKSPACE_ICON.id;
}

export function normalizeImportedWorkspaces({
  sourceWorkspaces,
  currentWorkspaces = [],
  workspaceIdMap,
  behavior,
  resolveIcon = (iconId) => iconId
}) {
  if (
    !Array.isArray(sourceWorkspaces) ||
    !Array.isArray(currentWorkspaces) ||
    !Object.values(WORKSPACE_IMPORT_BEHAVIORS).includes(behavior) ||
    typeof resolveIcon !== "function"
  ) {
    throw invalidMapping();
  }
  const mapping = mappedWorkspaceIds(sourceWorkspaces, requireMap(workspaceIdMap));
  const currentById = new Map(currentWorkspaces.map((workspace) => [workspace.id, workspace]));
  return sourceWorkspaces.map((source) => {
    const id = mapping.get(source.id);
    const existing = currentById.get(id) ?? null;
    return {
      id,
      name: source.name,
      icon: normalizedIcon({ source, existing, behavior, resolveIcon }),
      color: source.color,
      defaultContainerRef: source.defaultContainerRef ?? null
    };
  });
}

export function validateWorkspaceAssociationMap({
  sourceWorkspaceIds,
  targetWorkspaceIds,
  workspaceIdMap
}) {
  if (
    !Array.isArray(sourceWorkspaceIds) ||
    !Array.isArray(targetWorkspaceIds) ||
    sourceWorkspaceIds.some((id) => typeof id !== "string" || id.length === 0) ||
    targetWorkspaceIds.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(sourceWorkspaceIds).size !== sourceWorkspaceIds.length ||
    new Set(targetWorkspaceIds).size !== targetWorkspaceIds.length
  ) {
    throw invalidMapping();
  }
  const mapping = requireMap(workspaceIdMap);
  const targetSet = new Set(targetWorkspaceIds);
  const usedTargets = new Set();
  const resolved = new Map();
  const unresolved = [];
  for (const sourceId of sourceWorkspaceIds) {
    const targetId = mapping.get(sourceId);
    if (
      typeof sourceId !== "string" ||
      typeof targetId !== "string" ||
      !targetSet.has(targetId) ||
      usedTargets.has(targetId)
    ) {
      unresolved.push(sourceId);
      continue;
    }
    usedTargets.add(targetId);
    resolved.set(sourceId, targetId);
  }
  if (unresolved.length > 0) {
    throw new WorkspaceImportError(
      WORKSPACE_IMPORT_ERROR_CODES.UNRESOLVED_ASSOCIATION,
      { workspaceIds: unresolved }
    );
  }
  return resolved;
}

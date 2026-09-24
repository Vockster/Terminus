import {
  MAX_RAIL_ENTRIES,
  MAX_WORKSPACES,
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WORKSPACE_STATE_LEGACY_SCHEMA_VERSION,
  WORKSPACE_STATE_PREVIOUS_SCHEMA_VERSION,
  WORKSPACE_STATE_SCHEMA_VERSION,
  WORKSPACE_STATE_V3_SCHEMA_VERSION,
  WORKSPACE_STATE_V2_SCHEMA_VERSION,
  WORKSPACE_DIVIDER_SIZE_LIMITS,
  WorkspaceStateError,
  migrateWorkspaceStateV1ToV2,
  migrateWorkspaceStateV2ToV3,
  migrateWorkspaceStateV3ToV4,
  migrateWorkspaceStateV4,
  parseWorkspaceState,
  parseWorkspaceStateV1,
  parseWorkspaceStateV2,
  parseWorkspaceStateV3,
  parseWorkspaceStateV4
} from "../contracts/workspace-state.js";
import {
  RAIL_BATCH_ERROR_CODES,
  planRailPlacement,
  railInsertionIndex,
  validateRailAdditions
} from "../contracts/workspace-rail-batch.js";
import { parseContainerRefId } from "../contracts/containers.js";
import { isWorkspaceIconId } from "../contracts/workspace-icons.js";
import { createDefaultWorkspaceState } from "./workspace-defaults.js";
import { StorageMigrationCoordinator } from "./storage-migration-coordinator.js";

function invalidRequest(reason) {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST,
    `${WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST]} ${reason}`
  );
}

function invalidState(reason) {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.INVALID_STATE,
    `${WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.INVALID_STATE]} ${reason}`
  );
}

function storageUnavailable(cause) {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE,
    WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE],
    { cause }
  );
}

function sameWorkspaceState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

function hasOnlyKeys(value, allowedKeys) {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => allowedKeys.includes(key));
}

function parseWorkspaceFields(value, { partial = false } = {}) {
  const allowedKeys = ["name", "icon", "color", "defaultContainerRef"];
  const validShape = partial
    ? isRecord(value) && hasOnlyKeys(value, allowedKeys)
    : isRecord(value) && hasExactKeys(value, ["name", "icon", "color"]);
  if (!validShape) {
    throw invalidRequest("The workspace fields have an invalid shape.");
  }
  const parsed = {};
  if (Object.prototype.hasOwnProperty.call(value, "name")) {
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (name.length === 0 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw invalidRequest("The workspace name must be from 1 through 80 trimmed characters.");
    }
    parsed.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(value, "icon")) {
    if (typeof value.icon !== "string" || !isWorkspaceIconId(value.icon)) {
      throw invalidRequest("The workspace icon is not in the available icon catalog.");
    }
    parsed.icon = value.icon;
  }
  if (Object.prototype.hasOwnProperty.call(value, "color")) {
    if (typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color)) {
      throw invalidRequest("The workspace color must be a six-digit hexadecimal color.");
    }
    parsed.color = value.color.toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(value, "defaultContainerRef")) {
    parsed.defaultContainerRef = value.defaultContainerRef === null
      ? null
      : parseContainerRefId(value.defaultContainerRef, invalidRequest);
  }
  return parsed;
}

function parseRailLocator(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "id"]) ||
    !["workspace", "divider", "space"].includes(value.kind) ||
    typeof value.id !== "string"
  ) {
    throw invalidRequest("The rail entry locator is invalid.");
  }
  return { kind: value.kind, id: value.id };
}

const RAIL_BATCH_REASONS = Object.freeze({
  [RAIL_BATCH_ERROR_CODES.MISSING_ENTRY]: "A selected rail entry does not exist.",
  [RAIL_BATCH_ERROR_CODES.MISSING_TARGET]: "The rail placement target does not exist.",
  [RAIL_BATCH_ERROR_CODES.TARGET_IN_SELECTION]: "The rail entries cannot be moved onto themselves.",
  [RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION]: "No rail entries were selected.",
  [RAIL_BATCH_ERROR_CODES.INVALID_POSITION]: "The rail placement is invalid.",
  [RAIL_BATCH_ERROR_CODES.NO_SURVIVING_WORKSPACE]: "At least one workspace must remain.",
  [RAIL_BATCH_ERROR_CODES.WORKSPACE_LIMIT]: "The workspace capacity has been reached.",
  [RAIL_BATCH_ERROR_CODES.RAIL_LIMIT]: "The rail capacity has been reached."
});

function railBatchFailure(code) {
  return invalidRequest(RAIL_BATCH_REASONS[code] ?? "The rail operation is invalid.");
}

function parseLocatorList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RAIL_ENTRIES) {
    throw invalidRequest("The rail entry selection is invalid.");
  }
  const locators = value.map((entry) => parseRailLocator(entry));
  const keys = new Set(locators.map(({ kind, id }) => `${kind}:${id}`));
  if (keys.size !== locators.length) {
    throw invalidRequest("The rail entry selection repeats an entry.");
  }
  return locators;
}

function parseWorkspaceIdList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WORKSPACES) {
    throw invalidRequest("The workspace selection is invalid.");
  }
  if (value.some((id) => typeof id !== "string")) {
    throw invalidRequest("A selected workspace ID is invalid.");
  }
  if (new Set(value).size !== value.length) {
    throw invalidRequest("The workspace selection repeats a workspace.");
  }
  return [...value];
}

// Bulk editing covers only the fields that mean the same thing across a
// selection. Names stay per workspace, and a shared default container goes
// through the container path, which owns reference availability.
function parseSharedWorkspaceFields(value) {
  const changes = parseWorkspaceFields(value, { partial: true });
  const keys = Object.keys(changes);
  if (keys.length === 0 || keys.some((key) => !["icon", "color"].includes(key))) {
    throw invalidRequest("A shared workspace change may set only the icon or the color.");
  }
  return changes;
}

function parseRailInsertionList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RAIL_ENTRIES) {
    throw invalidRequest("The rail insertion list is invalid.");
  }
  return value.map((insertion) => {
    if (
      !isRecord(insertion) ||
      !hasExactKeys(insertion, ["kind", "target", "position"]) ||
      !["divider", "space"].includes(insertion.kind) ||
      !["before", "after"].includes(insertion.position)
    ) {
      throw invalidRequest("A rail insertion is invalid.");
    }
    return {
      kind: insertion.kind,
      target: parseRailLocator(insertion.target),
      position: insertion.position
    };
  });
}

function railEntryMatches(candidate, entry) {
  return entry.kind === "workspace"
    ? candidate.kind === "workspace" && candidate.workspaceId === entry.id
    : candidate.kind === entry.kind && candidate.id === entry.id;
}

function defaultIdGenerator() {
  return globalThis.crypto.randomUUID();
}

export class WorkspaceStateService {
  #storage;
  #migrationCoordinator;
  #idGenerator;
  #operationTail = Promise.resolve();
  #initializationPromise = null;

  constructor(storage, {
    idGenerator = defaultIdGenerator
  } = {}) {
    this.#storage = storage;
    this.#idGenerator = idGenerator;
    this.#migrationCoordinator = new StorageMigrationCoordinator({
      storage,
      targetVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      parseTarget: parseWorkspaceState,
      migrations: [
        {
          sourceVersion: WORKSPACE_STATE_LEGACY_SCHEMA_VERSION,
          targetVersion: WORKSPACE_STATE_V2_SCHEMA_VERSION,
          parseSource: parseWorkspaceStateV1,
          parseTarget: parseWorkspaceStateV2,
          migrateSource: migrateWorkspaceStateV1ToV2
        },
        {
          sourceVersion: WORKSPACE_STATE_V2_SCHEMA_VERSION,
          targetVersion: WORKSPACE_STATE_V3_SCHEMA_VERSION,
          parseSource: parseWorkspaceStateV2,
          parseTarget: parseWorkspaceStateV3,
          migrateSource: migrateWorkspaceStateV2ToV3
        },
        {
          sourceVersion: WORKSPACE_STATE_V3_SCHEMA_VERSION,
          targetVersion: WORKSPACE_STATE_PREVIOUS_SCHEMA_VERSION,
          parseSource: parseWorkspaceStateV3,
          parseTarget: parseWorkspaceStateV4,
          migrateSource: migrateWorkspaceStateV3ToV4
        },
        {
          sourceVersion: WORKSPACE_STATE_PREVIOUS_SCHEMA_VERSION,
          targetVersion: WORKSPACE_STATE_SCHEMA_VERSION,
          parseSource: parseWorkspaceStateV4,
          parseTarget: parseWorkspaceState,
          migrateSource: migrateWorkspaceStateV4
        }
      ],
      createInvalidError: invalidState,
      createStorageError: storageUnavailable,
      isDomainError: (error) => error instanceof WorkspaceStateError
    });
  }

  getOrInitialize() {
    if (!this.#initializationPromise) {
      const operation = this.#enqueue(() => this.#loadOrInitialize());
      this.#initializationPromise = operation;
      const clearOperation = () => {
        if (this.#initializationPromise === operation) {
          this.#initializationPromise = null;
        }
      };
      operation.then(clearOperation, clearOperation);
    }
    return this.#initializationPromise.then((state) => parseWorkspaceState(state));
  }

  createWorkspace(rawWorkspace) {
    return this.#enqueue(async () => {
      const workspace = parseWorkspaceFields(rawWorkspace);
      const current = await this.#loadOrInitialize();
      if (current.workspaces.length >= MAX_WORKSPACES || current.rail.length >= MAX_RAIL_ENTRIES) {
        throw invalidRequest("The workspace or rail capacity has been reached.");
      }
      const id = this.#createUniqueId("ws", new Set(current.workspaces.map(({ id }) => id)));
      return this.#write({
        ...current,
        workspaces: [...current.workspaces, { id, ...workspace, defaultContainerRef: null }],
        rail: [...current.rail, { kind: "workspace", workspaceId: id }]
      });
    });
  }

  updateWorkspace(workspaceId, rawChanges) {
    return this.#enqueue(async () => {
      if (typeof workspaceId !== "string") {
        throw invalidRequest("The workspace ID is invalid.");
      }
      const changes = parseWorkspaceFields(rawChanges, { partial: true });
      const current = await this.#loadOrInitialize();
      const index = current.workspaces.findIndex(({ id }) => id === workspaceId);
      if (index < 0) {
        throw invalidRequest("The workspace does not exist.");
      }
      const workspaces = [...current.workspaces];
      workspaces[index] = { ...workspaces[index], ...changes };
      return this.#write({ ...current, workspaces });
    });
  }

  clearDefaultContainerRefs(rawRefIds) {
    return this.#enqueue(async () => {
      if (
        !Array.isArray(rawRefIds) ||
        rawRefIds.length === 0 ||
        rawRefIds.some((refId) => typeof refId !== "string")
      ) {
        throw invalidRequest("The container reference list is invalid.");
      }
      const refIds = new Set(
        rawRefIds.map((refId) => parseContainerRefId(refId, invalidRequest))
      );
      const current = await this.#loadOrInitialize();
      let changed = false;
      const workspaces = current.workspaces.map((workspace) => {
        if (!refIds.has(workspace.defaultContainerRef)) {
          return workspace;
        }
        changed = true;
        return { ...workspace, defaultContainerRef: null };
      });
      return changed
        ? this.#write({ ...current, workspaces })
        : parseWorkspaceState(current);
    });
  }

  replaceWorkspaceIcon(fromIconId, toIconId) {
    return this.#enqueue(async () => {
      if (
        typeof fromIconId !== "string" ||
        typeof toIconId !== "string" ||
        fromIconId === toIconId ||
        !isWorkspaceIconId(fromIconId) ||
        !isWorkspaceIconId(toIconId)
      ) {
        throw invalidRequest("The workspace icon replacement is invalid.");
      }
      const current = await this.#loadOrInitialize();
      let replacedCount = 0;
      const workspaces = current.workspaces.map((workspace) => {
        if (workspace.icon !== fromIconId) {
          return workspace;
        }
        replacedCount += 1;
        return { ...workspace, icon: toIconId };
      });
      const state = replacedCount > 0
        ? await this.#write({ ...current, workspaces })
        : parseWorkspaceState(current);
      return { state, replacedCount };
    });
  }

  removeWorkspace(workspaceId) {
    return this.#enqueue(async () => {
      if (typeof workspaceId !== "string") {
        throw invalidRequest("The workspace ID is invalid.");
      }
      const current = await this.#loadOrInitialize();
      if (!current.workspaces.some(({ id }) => id === workspaceId)) {
        throw invalidRequest("The workspace does not exist.");
      }
      if (current.workspaces.length === 1) {
        throw invalidRequest("The last workspace cannot be removed.");
      }
      return this.#write({
        ...current,
        workspaces: current.workspaces.filter(({ id }) => id !== workspaceId),
        rail: current.rail.filter(
          (entry) => !(entry.kind === "workspace" && entry.workspaceId === workspaceId)
        )
      });
    });
  }

  moveRailEntry(rawEntry, direction) {
    return this.#enqueue(async () => {
      const entry = parseRailLocator(rawEntry);
      if (!["up", "down"].includes(direction)) {
        throw invalidRequest("The rail movement direction is invalid.");
      }
      const current = await this.#loadOrInitialize();
      const index = current.rail.findIndex((candidate) => railEntryMatches(candidate, entry));
      if (index < 0) {
        throw invalidRequest("The rail entry does not exist.");
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.rail.length) {
        return parseWorkspaceState(current);
      }
      const rail = [...current.rail];
      [rail[index], rail[targetIndex]] = [rail[targetIndex], rail[index]];
      return this.#write({ ...current, rail });
    });
  }

  placeRailEntry(rawEntry, rawTarget, position) {
    return this.#enqueue(async () => {
      const entry = parseRailLocator(rawEntry);
      const target = parseRailLocator(rawTarget);
      if (!["before", "after"].includes(position)) {
        throw invalidRequest("The rail placement is invalid.");
      }
      const current = await this.#loadOrInitialize();
      const sourceIndex = current.rail.findIndex((candidate) =>
        railEntryMatches(candidate, entry)
      );
      const targetIndex = current.rail.findIndex((candidate) =>
        railEntryMatches(candidate, target)
      );
      if (sourceIndex < 0 || targetIndex < 0) {
        throw invalidRequest("The rail entry does not exist.");
      }
      if (sourceIndex === targetIndex) {
        return parseWorkspaceState(current);
      }
      if (
        (position === "before" && sourceIndex === targetIndex - 1) ||
        (position === "after" && sourceIndex === targetIndex + 1)
      ) {
        return parseWorkspaceState(current);
      }

      const rail = [...current.rail];
      const [movingEntry] = rail.splice(sourceIndex, 1);
      const remainingTargetIndex = rail.findIndex((candidate) =>
        railEntryMatches(candidate, target)
      );
      const insertionIndex = remainingTargetIndex + (position === "after" ? 1 : 0);
      rail.splice(insertionIndex, 0, movingEntry);
      return this.#write({ ...current, rail });
    });
  }

  addDivider() {
    return this.#enqueue(async () => {
      const current = await this.#loadOrInitialize();
      if (current.rail.length >= MAX_RAIL_ENTRIES) {
        throw invalidRequest("The rail capacity has been reached.");
      }
      const railItemIds = new Set(
        current.rail.filter(({ kind }) => kind !== "workspace").map(({ id }) => id)
      );
      const id = this.#createUniqueId("divider", railItemIds);
      return this.#write({
        ...current,
        rail: [
          ...current.rail,
          { kind: "divider", id, size: WORKSPACE_DIVIDER_SIZE_LIMITS.defaultValue }
        ]
      });
    });
  }

  addSpace() {
    return this.#enqueue(async () => {
      const current = await this.#loadOrInitialize();
      if (current.rail.length >= MAX_RAIL_ENTRIES) {
        throw invalidRequest("The rail capacity has been reached.");
      }
      const railItemIds = new Set(
        current.rail.filter(({ kind }) => kind !== "workspace").map(({ id }) => id)
      );
      const id = this.#createUniqueId("space", railItemIds);
      return this.#write({
        ...current,
        rail: [...current.rail, { kind: "space", id }]
      });
    });
  }

  resizeDivider(dividerId, size) {
    return this.#enqueue(async () => {
      if (
        typeof dividerId !== "string" ||
        (size !== null &&
          (!Number.isInteger(size) ||
            size < WORKSPACE_DIVIDER_SIZE_LIMITS.min ||
            size > WORKSPACE_DIVIDER_SIZE_LIMITS.max))
      ) {
        throw invalidRequest("The divider size is invalid.");
      }
      const current = await this.#loadOrInitialize();
      const index = current.rail.findIndex(
        (entry) => entry.kind === "divider" && entry.id === dividerId
      );
      if (index < 0) {
        throw invalidRequest("The divider does not exist.");
      }
      const rail = [...current.rail];
      rail[index] = { ...rail[index], size };
      return this.#write({ ...current, rail });
    });
  }

  removeDivider(dividerId) {
    return this.#enqueue(async () => {
      if (typeof dividerId !== "string") {
        throw invalidRequest("The divider ID is invalid.");
      }
      const current = await this.#loadOrInitialize();
      const rail = current.rail.filter(
        (entry) => !(entry.kind === "divider" && entry.id === dividerId)
      );
      if (rail.length === current.rail.length) {
        throw invalidRequest("The divider does not exist.");
      }
      return this.#write({ ...current, rail });
    });
  }

  removeSpace(spaceId) {
    return this.#enqueue(async () => {
      if (typeof spaceId !== "string") {
        throw invalidRequest("The space ID is invalid.");
      }
      const current = await this.#loadOrInitialize();
      const rail = current.rail.filter(
        (entry) => !(entry.kind === "space" && entry.id === spaceId)
      );
      if (rail.length === current.rail.length) {
        throw invalidRequest("The space does not exist.");
      }
      return this.#write({ ...current, rail });
    });
  }

  // Batch rail operations. Each is one enqueued read-modify-write, so a
  // selection applies whole or not at all, and the planners in
  // workspace-rail-batch.js own the arithmetic so it is testable without
  // storage. Batch workspace removal is not here: it moves tab ownership and
  // belongs to the controller, which can capture a safety snapshot first.
  updateWorkspaces(rawWorkspaceIds, rawChanges) {
    return this.#enqueue(async () => {
      const workspaceIds = parseWorkspaceIdList(rawWorkspaceIds);
      const changes = parseSharedWorkspaceFields(rawChanges);
      const current = await this.#loadOrInitialize();
      const known = new Set(current.workspaces.map(({ id }) => id));
      for (const id of workspaceIds) {
        if (!known.has(id)) {
          throw invalidRequest("A selected workspace does not exist.");
        }
      }
      const selected = new Set(workspaceIds);
      return this.#write({
        ...current,
        workspaces: current.workspaces.map((workspace) =>
          selected.has(workspace.id) ? { ...workspace, ...changes } : workspace
        )
      });
    });
  }

  // Reached only through the controller's container path, which resolves the
  // reference first; the shared-field update deliberately cannot set it.
  setDefaultContainerRefs(rawWorkspaceIds, rawRefId) {
    return this.#enqueue(async () => {
      const workspaceIds = parseWorkspaceIdList(rawWorkspaceIds);
      const refId = rawRefId === null ? null : parseContainerRefId(rawRefId, invalidRequest);
      const current = await this.#loadOrInitialize();
      const known = new Set(current.workspaces.map(({ id }) => id));
      for (const id of workspaceIds) {
        if (!known.has(id)) {
          throw invalidRequest("A selected workspace does not exist.");
        }
      }
      const selected = new Set(workspaceIds);
      return this.#write({
        ...current,
        workspaces: current.workspaces.map((workspace) =>
          selected.has(workspace.id) ? { ...workspace, defaultContainerRef: refId } : workspace
        )
      });
    });
  }

  placeRailEntries(rawEntries, rawTarget, position) {
    return this.#enqueue(async () => {
      const entries = parseLocatorList(rawEntries);
      const target = parseRailLocator(rawTarget);
      const current = await this.#loadOrInitialize();
      const plan = planRailPlacement(current.rail, entries, target, position);
      if (!plan.ok) {
        throw railBatchFailure(plan.code);
      }
      return this.#write({ ...current, rail: plan.rail });
    });
  }

  // Applied in order against the rail as it stands after each step, so
  // wrapping a selection in two dividers is one write, not two round trips.
  insertRailEntries(rawInsertions) {
    return this.#enqueue(async () => {
      const insertions = parseRailInsertionList(rawInsertions);
      const current = await this.#loadOrInitialize();
      const capacity = validateRailAdditions(current, { railEntries: insertions.length });
      if (!capacity.ok) {
        throw railBatchFailure(capacity.code);
      }
      const rail = [...current.rail];
      const usedIds = new Set(
        rail.filter(({ kind }) => kind !== "workspace").map(({ id }) => id)
      );
      for (const insertion of insertions) {
        const index = railInsertionIndex(rail, insertion.target, insertion.position);
        if (index < 0) {
          throw railBatchFailure(RAIL_BATCH_ERROR_CODES.MISSING_TARGET);
        }
        const id = this.#createUniqueId(insertion.kind, usedIds);
        usedIds.add(id);
        rail.splice(
          index,
          0,
          insertion.kind === "divider"
            ? { kind: "divider", id, size: WORKSPACE_DIVIDER_SIZE_LIMITS.defaultValue }
            : { kind: "space", id }
        );
      }
      return this.#write({ ...current, rail });
    });
  }

  removeRailEntries(rawEntries) {
    return this.#enqueue(async () => {
      const entries = parseLocatorList(rawEntries);
      if (entries.some(({ kind }) => kind === "workspace")) {
        throw invalidRequest("Only dividers and spaces can be removed this way.");
      }
      const current = await this.#loadOrInitialize();
      for (const entry of entries) {
        if (!current.rail.some((candidate) => railEntryMatches(candidate, entry))) {
          throw invalidRequest("A selected rail entry does not exist.");
        }
      }
      return this.#write({
        ...current,
        rail: current.rail.filter(
          (candidate) => !entries.some((entry) => railEntryMatches(candidate, entry))
        )
      });
    });
  }

  // Paste. Capacity is checked against the whole addition before the first
  // write, so an overflowing paste refuses instead of half-applying.
  duplicateWorkspaces(rawWorkspaceIds, rawTarget, position = "after") {
    return this.#enqueue(async () => {
      const workspaceIds = parseWorkspaceIdList(rawWorkspaceIds);
      const target = rawTarget === null || rawTarget === undefined
        ? null
        : parseRailLocator(rawTarget);
      if (target !== null && !["before", "after"].includes(position)) {
        throw railBatchFailure(RAIL_BATCH_ERROR_CODES.INVALID_POSITION);
      }
      const current = await this.#loadOrInitialize();
      const capacity = validateRailAdditions(current, {
        workspaces: workspaceIds.length,
        railEntries: workspaceIds.length
      });
      if (!capacity.ok) {
        throw railBatchFailure(capacity.code);
      }
      const sourceById = new Map(current.workspaces.map((workspace) => [workspace.id, workspace]));
      for (const id of workspaceIds) {
        if (!sourceById.has(id)) {
          throw invalidRequest("A copied workspace no longer exists.");
        }
      }
      const index = target === null
        ? current.rail.length
        : railInsertionIndex(current.rail, target, position);
      if (index < 0) {
        throw railBatchFailure(RAIL_BATCH_ERROR_CODES.MISSING_TARGET);
      }

      const existingIds = new Set(current.workspaces.map(({ id }) => id));
      const workspaces = [...current.workspaces];
      const additions = [];
      for (const sourceId of workspaceIds) {
        const source = sourceById.get(sourceId);
        const id = this.#createUniqueId("ws", existingIds);
        existingIds.add(id);
        workspaces.push({
          id,
          name: source.name,
          icon: source.icon,
          color: source.color,
          defaultContainerRef: source.defaultContainerRef
        });
        additions.push({ kind: "workspace", workspaceId: id });
      }
      const rail = [...current.rail];
      rail.splice(index, 0, ...additions);
      return this.#write({ ...current, workspaces, rail });
    });
  }

  replaceForRestore(rawState) {
    return this.#enqueue(() => this.#write(parseWorkspaceState(rawState)));
  }

  replaceForRestoreIfCurrent(rawExpectedState, rawReplacementState) {
    const expected = parseWorkspaceState(rawExpectedState);
    const replacement = parseWorkspaceState(rawReplacementState);
    return this.#enqueue(async () => {
      const current = await this.#loadOrInitialize();
      if (!sameWorkspaceState(current, expected)) {
        return { replaced: false, state: current };
      }
      return { replaced: true, state: await this.#write(replacement) };
    });
  }

  reset(rawDefaults = createDefaultWorkspaceState()) {
    return this.#enqueue(async () => {
      const defaults = await this.#write(rawDefaults);
      try {
        await this.#storage.removeMigration();
      } catch (error) {
        throw storageUnavailable(error);
      }
      return defaults;
    });
  }

  async #loadOrInitialize() {
    const storedState = await this.#migrationCoordinator.load();
    if (storedState !== undefined) {
      return storedState;
    }
    return this.#write(createDefaultWorkspaceState());
  }

  async #write(state) {
    const parsed = parseWorkspaceState(state);
    try {
      await this.#storage.write(parsed);
    } catch (error) {
      throw storageUnavailable(error);
    }
    return parseWorkspaceState(parsed);
  }

  #createUniqueId(prefix, existingIds) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = `${prefix}-${this.#idGenerator()}`.toLowerCase();
      if (/^[a-z0-9][a-z0-9-]{0,127}$/.test(id) && !existingIds.has(id)) {
        return id;
      }
    }
    throw invalidState("A unique stable ID could not be generated.");
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

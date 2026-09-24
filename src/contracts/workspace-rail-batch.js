import {
  MAX_RAIL_ENTRIES,
  MAX_WORKSPACES
} from "./workspace-state.js";

// Planning for rail operations that act on more than one entry at a time.
// Every function here is pure: it reads a rail array and returns a decision or
// a new array. The owning service applies the result inside its own serialized
// read-modify-write, so batch behavior can be tested without storage, a
// browser, or a DOM.

export const RAIL_BATCH_ERROR_CODES = Object.freeze({
  MISSING_ENTRY: "MISSING_ENTRY",
  MISSING_TARGET: "MISSING_TARGET",
  TARGET_IN_SELECTION: "TARGET_IN_SELECTION",
  EMPTY_SELECTION: "EMPTY_SELECTION",
  INVALID_POSITION: "INVALID_POSITION",
  NO_SURVIVING_WORKSPACE: "NO_SURVIVING_WORKSPACE",
  WORKSPACE_LIMIT: "WORKSPACE_LIMIT",
  RAIL_LIMIT: "RAIL_LIMIT"
});

const POSITIONS = Object.freeze(["before", "after"]);

function failure(code) {
  return Object.freeze({ ok: false, code });
}

export function railEntryMatches(candidate, locator) {
  return locator.kind === "workspace"
    ? candidate.kind === "workspace" && candidate.workspaceId === locator.id
    : candidate.kind === locator.kind && candidate.id === locator.id;
}

export function railEntryLocator(entry) {
  return entry.kind === "workspace"
    ? { kind: "workspace", id: entry.workspaceId }
    : { kind: entry.kind, id: entry.id };
}

export function railWorkspaceIds(rail) {
  return rail
    .filter(({ kind }) => kind === "workspace")
    .map(({ workspaceId }) => workspaceId);
}

// One destination for the whole removal, rather than each workspace's
// immediate neighbour. Sequential single removals would hand tabs to a
// neighbour that is itself about to be removed, so the tabs would be relayed
// through workspaces that no longer exist by the time the batch finishes.
export function resolveRemovalDestination(rail, removedWorkspaceIds) {
  const removed = new Set(removedWorkspaceIds);
  const ids = railWorkspaceIds(rail);
  if (ids.length === 0 || removed.size === 0) {
    return null;
  }

  let lastRemovedIndex = -1;
  for (const [index, id] of ids.entries()) {
    if (removed.has(id)) lastRemovedIndex = index;
  }
  if (lastRemovedIndex < 0) {
    return null;
  }

  for (let step = 1; step <= ids.length; step += 1) {
    const candidate = ids[(lastRemovedIndex + step) % ids.length];
    if (!removed.has(candidate)) return candidate;
  }
  return null;
}

export function planWorkspaceRemoval(rail, removedWorkspaceIds) {
  const requested = [...new Set(removedWorkspaceIds)];
  if (requested.length === 0) {
    return failure(RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION);
  }
  const present = new Set(railWorkspaceIds(rail));
  for (const id of requested) {
    if (!present.has(id)) return failure(RAIL_BATCH_ERROR_CODES.MISSING_ENTRY);
  }
  const destinationWorkspaceId = resolveRemovalDestination(rail, requested);
  if (destinationWorkspaceId === null) {
    return failure(RAIL_BATCH_ERROR_CODES.NO_SURVIVING_WORKSPACE);
  }
  return Object.freeze({
    ok: true,
    destinationWorkspaceId,
    removedWorkspaceIds: Object.freeze(requested)
  });
}

// Every removed workspace hands its tabs to the first workspace that survives.
//
// Removal itself always passes tabs to the removed workspace's immediate cyclic
// successor, and that rule is shared with the private-window companion, so it
// cannot be overridden per call without duplicating both paths. Instead the
// whole doomed block is parked immediately before the destination, then removed
// from the end: at each step the entry being removed sits directly before the
// destination, so the destination is its successor and receives the tabs. One
// extra rail write buys a single, predictable destination.
export function planRemovalIntoFirstWorkspace(rail, removedWorkspaceIds) {
  const requested = [...new Set(removedWorkspaceIds)];
  if (requested.length === 0) {
    return failure(RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION);
  }
  const ids = railWorkspaceIds(rail);
  const present = new Set(ids);
  for (const id of requested) {
    if (!present.has(id)) return failure(RAIL_BATCH_ERROR_CODES.MISSING_ENTRY);
  }

  const removed = new Set(requested);
  const destinationWorkspaceId = ids.find((id) => !removed.has(id)) ?? null;
  if (destinationWorkspaceId === null) {
    return failure(RAIL_BATCH_ERROR_CODES.NO_SURVIVING_WORKSPACE);
  }

  const ordered = ids.filter((id) => removed.has(id));
  return Object.freeze({
    ok: true,
    destinationWorkspaceId,
    parkLocators: Object.freeze(ordered.map((id) => Object.freeze({ kind: "workspace", id }))),
    order: Object.freeze([...ordered].reverse())
  });
}

export function railInsertionIndex(rail, targetLocator, position) {
  const targetIndex = rail.findIndex((entry) => railEntryMatches(entry, targetLocator));
  if (targetIndex < 0) return -1;
  return position === "before" ? targetIndex : targetIndex + 1;
}

// Moved entries keep the relative order they had on the rail, so a selection
// that looked like one block before the drag still looks like one after it.
export function planRailPlacement(rail, entryLocators, targetLocator, position) {
  if (!POSITIONS.includes(position)) {
    return failure(RAIL_BATCH_ERROR_CODES.INVALID_POSITION);
  }
  if (entryLocators.length === 0) {
    return failure(RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION);
  }

  const selectedIndexes = new Set();
  for (const locator of entryLocators) {
    const index = rail.findIndex((entry) => railEntryMatches(entry, locator));
    if (index < 0) return failure(RAIL_BATCH_ERROR_CODES.MISSING_ENTRY);
    selectedIndexes.add(index);
  }

  const targetIndex = rail.findIndex((entry) => railEntryMatches(entry, targetLocator));
  if (targetIndex < 0) {
    return failure(RAIL_BATCH_ERROR_CODES.MISSING_TARGET);
  }
  if (selectedIndexes.has(targetIndex)) {
    return failure(RAIL_BATCH_ERROR_CODES.TARGET_IN_SELECTION);
  }

  const moving = rail.filter((_, index) => selectedIndexes.has(index));
  const remaining = rail.filter((_, index) => !selectedIndexes.has(index));
  const insertAt = remaining.indexOf(rail[targetIndex]) + (position === "before" ? 0 : 1);

  return Object.freeze({
    ok: true,
    rail: [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
  });
}

// Capacity is checked against the whole addition before anything is written,
// so a paste that would overflow refuses instead of half-applying.
export function validateRailAdditions(state, { workspaces = 0, railEntries = 0 } = {}) {
  if (state.workspaces.length + workspaces > MAX_WORKSPACES) {
    return failure(RAIL_BATCH_ERROR_CODES.WORKSPACE_LIMIT);
  }
  if (state.rail.length + railEntries > MAX_RAIL_ENTRIES) {
    return failure(RAIL_BATCH_ERROR_CODES.RAIL_LIMIT);
  }
  return Object.freeze({ ok: true });
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RAIL_ENTRIES,
  MAX_WORKSPACES,
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_SCHEMA_VERSION,
  WORKSPACE_DIVIDER_SIZE_LIMITS,
  WorkspaceStateError,
  migrateWorkspaceStateV1,
  migrateWorkspaceStateV2,
  migrateWorkspaceStateV4,
  parseWorkspaceState,
  parseWorkspaceStateV1,
  parseWorkspaceStateV2
} from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

function expectCode(expectedCode) {
  return (error) => {
    assert.ok(error instanceof WorkspaceStateError);
    assert.equal(error.code, expectedCode);
    return true;
  };
}

function createWorkspace(index) {
  return {
    id: `ws-${index}`,
    name: `Workspace ${index}`,
    icon: "app",
    color: "#123456",
    defaultContainerRef: null
  };
}

function createSizedState(workspaceCount, dividerCount = 0) {
  const workspaces = Array.from({ length: workspaceCount }, (_, index) => createWorkspace(index));
  return {
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspaces,
    rail: [
      ...workspaces.map(({ id }) => ({ kind: "workspace", workspaceId: id })),
      ...Array.from({ length: dividerCount }, (_, index) => ({
        kind: "divider",
        id: `divider-${index}`,
        size: null
      }))
    ]
  };
}

function createLegacyDefaultState() {
  const current = createDefaultWorkspaceState();
  return {
    schemaVersion: 1,
    workspaces: current.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace),
    rail: current.rail
  };
}

test("valid current workspace state is returned as a defensive copy", () => {
  const source = createDefaultWorkspaceState();
  source.rail.splice(1, 0, { kind: "divider", id: "divider-primary", size: 28 });
  const parsed = parseWorkspaceState(source);

  assert.deepEqual(parsed, source);
  assert.notStrictEqual(parsed, source);
  assert.notStrictEqual(parsed.workspaces[0], source.workspaces[0]);
  assert.notStrictEqual(parsed.rail[0], source.rail[0]);

  parsed.workspaces[0].name = "Changed copy";
  parsed.rail[1].id = "divider-changed";
  assert.equal(source.workspaces[0].name, "Work");
  assert.equal(source.rail[1].id, "divider-primary");
});

test("strict v1 parsing and migration preserve all default workspace IDs", () => {
  const source = createLegacyDefaultState();
  const parsedV1 = parseWorkspaceStateV1(source);
  const migrated = migrateWorkspaceStateV1(source);

  assert.deepEqual(parsedV1, source);
  assert.equal(migrated.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);
  assert.deepEqual(
    migrated.workspaces.map(({ id }) => id),
    ["ws-default-work", "ws-default-personal", "ws-default-research"]
  );
  assert.deepEqual(migrated.rail, source.rail);
});

test("v2 spacer migration preserves global sizing while becoming a divider", () => {
  const current = createDefaultWorkspaceState();
  const source = {
    schemaVersion: 2,
    workspaces: current.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace),
    rail: [
      current.rail[0],
      { kind: "spacer", id: "spacer-primary" },
      ...current.rail.slice(1)
    ]
  };

  assert.deepEqual(parseWorkspaceStateV2(source), source);
  assert.deepEqual(migrateWorkspaceStateV2(source).rail[1], {
    kind: "divider",
    id: "spacer-primary",
    size: null
  });
});

test("v4 workspace defaults migrate to explicit No Container", () => {
  const current = createDefaultWorkspaceState();
  const previous = {
    ...current,
    schemaVersion: 4,
    workspaces: current.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace)
  };
  const migrated = migrateWorkspaceStateV4(previous);
  assert.equal(migrated.schemaVersion, WORKSPACE_STATE_SCHEMA_VERSION);
  assert.ok(migrated.workspaces.every(({ defaultContainerRef }) => defaultContainerRef === null));
});

test("missing, malformed, old-at-current-boundary, and future documents are rejected", () => {
  assert.throws(
    () => parseWorkspaceState(undefined),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
  assert.throws(
    () => parseWorkspaceState({ schemaVersion: 3, workspaces: [], rail: [] }),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
  assert.throws(
    () => parseWorkspaceState(createLegacyDefaultState()),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const extraProperty = { ...createDefaultWorkspaceState(), unexpected: true };
  assert.throws(
    () => parseWorkspaceState(extraProperty),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const futureState = {
    ...createDefaultWorkspaceState(),
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION + 1
  };
  assert.throws(
    () => parseWorkspaceState(futureState),
    expectCode(WORKSPACE_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION)
  );
});

test("workspace, divider, and space IDs plus rail membership must be unique and complete", () => {
  const duplicateWorkspace = createDefaultWorkspaceState();
  duplicateWorkspace.workspaces[1].id = duplicateWorkspace.workspaces[0].id;
  assert.throws(
    () => parseWorkspaceState(duplicateWorkspace),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const unknownRailReference = createDefaultWorkspaceState();
  unknownRailReference.rail[0].workspaceId = "ws-missing";
  assert.throws(
    () => parseWorkspaceState(unknownRailReference),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const missingRailEntry = createDefaultWorkspaceState();
  missingRailEntry.rail.pop();
  assert.throws(
    () => parseWorkspaceState(missingRailEntry),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );

  const duplicateRailIds = createDefaultWorkspaceState();
  duplicateRailIds.rail.push(
    { kind: "divider", id: "divider-shared", size: null },
    { kind: "space", id: "divider-shared" }
  );
  assert.throws(
    () => parseWorkspaceState(duplicateRailIds),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
});

test("divider and space IDs require their prefixes, allowed characters, and limits", () => {
  const accepted = createDefaultWorkspaceState();
  const longestId = `spacer-${"a".repeat(121)}`;
  assert.equal(longestId.length, 128);
  accepted.rail.unshift({ kind: "divider", id: longestId, size: 32 });
  assert.equal(parseWorkspaceState(accepted).rail[0].id, longestId);

  for (const id of ["separator-one", "spacer-UPPER", "spacer-", `${longestId}a`]) {
    const rejected = createDefaultWorkspaceState();
    rejected.rail.unshift({ kind: "divider", id, size: null });
    assert.throws(
      () => parseWorkspaceState(rejected),
      expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
    );
  }
  const space = createDefaultWorkspaceState();
  space.rail.push({ kind: "space", id: "space-primary" });
  assert.equal(parseWorkspaceState(space).rail.at(-1).kind, "space");
  const malformedSpace = createDefaultWorkspaceState();
  malformedSpace.rail.push({ kind: "space", id: "space-primary", size: 16 });
  assert.throws(() => parseWorkspaceState(malformedSpace), expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE));
});

test("divider size accepts global inheritance and the complete pixel range", () => {
  for (const size of [
    null,
    WORKSPACE_DIVIDER_SIZE_LIMITS.min,
    WORKSPACE_DIVIDER_SIZE_LIMITS.max
  ]) {
    const accepted = createDefaultWorkspaceState();
    accepted.rail.unshift({ kind: "divider", id: `divider-${size ?? "global"}`, size });
    assert.equal(parseWorkspaceState(accepted).rail[0].size, size);
  }

  for (const size of [3, 65, 12.5, "16", undefined]) {
    const rejected = createDefaultWorkspaceState();
    rejected.rail.unshift({ kind: "divider", id: "divider-invalid", size });
    assert.throws(
      () => parseWorkspaceState(rejected),
      expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
    );
  }
});

test("workspace limits accept 100 and reject 101", () => {
  assert.equal(parseWorkspaceState(createSizedState(MAX_WORKSPACES)).workspaces.length, 100);
  assert.throws(
    () => parseWorkspaceState(createSizedState(MAX_WORKSPACES + 1)),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
});

test("rail limits accept 200 and reject 201", () => {
  assert.equal(
    parseWorkspaceState(createSizedState(MAX_WORKSPACES, MAX_RAIL_ENTRIES - MAX_WORKSPACES)).rail
      .length,
    200
  );
  assert.throws(
    () =>
      parseWorkspaceState(
        createSizedState(MAX_WORKSPACES, MAX_RAIL_ENTRIES - MAX_WORKSPACES + 1)
      ),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
});

test("one custom non-default workspace is valid and zero workspaces are rejected", () => {
  const single = createSizedState(1);
  assert.deepEqual(parseWorkspaceState(single), single);
  assert.throws(
    () => parseWorkspaceState({ schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION, workspaces: [], rail: [] }),
    expectCode(WORKSPACE_STATE_ERROR_CODES.INVALID_STATE)
  );
});

test("rename, recolor, reorder, and deleting defaults preserve remaining stable IDs", () => {
  const state = createDefaultWorkspaceState();
  state.workspaces[0].name = "Focused work";
  state.workspaces[0].color = "#123456";
  state.workspaces.splice(1, 1);
  state.rail.splice(1, 1);
  state.workspaces.reverse();
  state.rail.reverse();

  const parsed = parseWorkspaceState(state);
  assert.deepEqual(
    parsed.workspaces.map(({ id }) => id).sort(),
    ["ws-default-research", "ws-default-work"]
  );
});

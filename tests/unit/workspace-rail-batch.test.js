import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RAIL_ENTRIES,
  MAX_WORKSPACES
} from "../../src/contracts/workspace-state.js";
import {
  RAIL_BATCH_ERROR_CODES,
  planRailPlacement,
  planRemovalIntoFirstWorkspace,
  planWorkspaceRemoval,
  railEntryLocator,
  railInsertionIndex,
  railWorkspaceIds,
  resolveRemovalDestination,
  validateRailAdditions
} from "../../src/contracts/workspace-rail-batch.js";

const workspace = (id) => ({ kind: "workspace", workspaceId: id });
const divider = (id, size = 16) => ({ kind: "divider", id: `divider-${id}`, size });
const space = (id) => ({ kind: "space", id: `space-${id}` });

const locator = (kind, id) => ({ kind, id });

test("a rail locator addresses a workspace by its workspace ID and others by their own", () => {
  assert.deepEqual(railEntryLocator(workspace("ws-a")), { kind: "workspace", id: "ws-a" });
  assert.deepEqual(railEntryLocator(divider("one")), { kind: "divider", id: "divider-one" });
  assert.deepEqual(railEntryLocator(space("one")), { kind: "space", id: "space-one" });
});

test("only workspace entries contribute to rail workspace order", () => {
  const rail = [workspace("ws-a"), divider("one"), workspace("ws-b"), space("one")];
  assert.deepEqual(railWorkspaceIds(rail), ["ws-a", "ws-b"]);
});

// The whole reason this planner exists. Removing B and C one at a time would
// send B's tabs to C, which is itself about to be removed.
test("a contiguous removal sends every tab to the first workspace that survives it", () => {
  const rail = ["ws-a", "ws-b", "ws-c", "ws-d", "ws-e"].map(workspace);
  assert.equal(resolveRemovalDestination(rail, ["ws-b", "ws-c"]), "ws-d");
});

test("a removal reaching the end of the rail wraps to the first surviving workspace", () => {
  const rail = ["ws-a", "ws-b", "ws-c"].map(workspace);
  assert.equal(resolveRemovalDestination(rail, ["ws-b", "ws-c"]), "ws-a");
});

test("a scattered removal still resolves one destination, after the last removed entry", () => {
  const rail = ["ws-a", "ws-b", "ws-c", "ws-d"].map(workspace);
  assert.equal(resolveRemovalDestination(rail, ["ws-a", "ws-c"]), "ws-d");
});

test("dividers and spaces between workspaces do not affect the destination", () => {
  const rail = [
    workspace("ws-a"),
    divider("one"),
    workspace("ws-b"),
    space("one"),
    workspace("ws-c")
  ];
  assert.equal(resolveRemovalDestination(rail, ["ws-b"]), "ws-c");
});

test("removing every workspace resolves no destination", () => {
  const rail = ["ws-a", "ws-b"].map(workspace);
  assert.equal(resolveRemovalDestination(rail, ["ws-a", "ws-b"]), null);
});

test("a removal plan reports the destination and the exact set it will remove", () => {
  const rail = ["ws-a", "ws-b", "ws-c"].map(workspace);
  const plan = planWorkspaceRemoval(rail, ["ws-a", "ws-a", "ws-b"]);
  assert.equal(plan.ok, true);
  assert.equal(plan.destinationWorkspaceId, "ws-c");
  assert.deepEqual([...plan.removedWorkspaceIds], ["ws-a", "ws-b"]);
});

test("a removal plan refuses an empty selection, an unknown workspace, and the whole rail", () => {
  const rail = ["ws-a", "ws-b"].map(workspace);
  assert.equal(planWorkspaceRemoval(rail, []).code, RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION);
  assert.equal(
    planWorkspaceRemoval(rail, ["ws-missing"]).code,
    RAIL_BATCH_ERROR_CODES.MISSING_ENTRY
  );
  assert.equal(
    planWorkspaceRemoval(rail, ["ws-a", "ws-b"]).code,
    RAIL_BATCH_ERROR_CODES.NO_SURVIVING_WORKSPACE
  );
});

test("moving a selection keeps the members in the order they had on the rail", () => {
  const rail = ["ws-a", "ws-b", "ws-c", "ws-d"].map(workspace);
  const moved = planRailPlacement(
    rail,
    // Deliberately reversed: click order must not survive into the result.
    [locator("workspace", "ws-c"), locator("workspace", "ws-a")],
    locator("workspace", "ws-d"),
    "after"
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(railWorkspaceIds(moved.rail), ["ws-b", "ws-d", "ws-a", "ws-c"]);
});

test("a selection can move before a target and can mix entry kinds", () => {
  const rail = [workspace("ws-a"), divider("one"), workspace("ws-b"), workspace("ws-c")];
  const moved = planRailPlacement(
    rail,
    [locator("workspace", "ws-b"), locator("divider", "divider-one")],
    locator("workspace", "ws-a"),
    "before"
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(
    moved.rail.map(railEntryLocator),
    [
      { kind: "divider", id: "divider-one" },
      { kind: "workspace", id: "ws-b" },
      { kind: "workspace", id: "ws-a" },
      { kind: "workspace", id: "ws-c" }
    ]
  );
});

test("a move refuses a target inside its own selection", () => {
  const rail = ["ws-a", "ws-b", "ws-c"].map(workspace);
  const refused = planRailPlacement(
    rail,
    [locator("workspace", "ws-a"), locator("workspace", "ws-b")],
    locator("workspace", "ws-b"),
    "after"
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, RAIL_BATCH_ERROR_CODES.TARGET_IN_SELECTION);
});

test("a move refuses an unknown member, an unknown target, an empty set, and a bad position", () => {
  const rail = ["ws-a", "ws-b"].map(workspace);
  const known = locator("workspace", "ws-a");
  const target = locator("workspace", "ws-b");
  assert.equal(
    planRailPlacement(rail, [locator("workspace", "ws-missing")], target, "after").code,
    RAIL_BATCH_ERROR_CODES.MISSING_ENTRY
  );
  assert.equal(
    planRailPlacement(rail, [known], locator("workspace", "ws-missing"), "after").code,
    RAIL_BATCH_ERROR_CODES.MISSING_TARGET
  );
  assert.equal(
    planRailPlacement(rail, [], target, "after").code,
    RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION
  );
  assert.equal(
    planRailPlacement(rail, [known], target, "onto").code,
    RAIL_BATCH_ERROR_CODES.INVALID_POSITION
  );
});

test("a refused move leaves the original rail untouched", () => {
  const rail = ["ws-a", "ws-b"].map(workspace);
  const before = rail.map(railEntryLocator);
  planRailPlacement(rail, [locator("workspace", "ws-a")], locator("workspace", "ws-a"), "after");
  assert.deepEqual(rail.map(railEntryLocator), before);
});

test("an insertion index lands on either side of its target and reports an unknown one", () => {
  const rail = [workspace("ws-a"), divider("one"), workspace("ws-b")];
  assert.equal(railInsertionIndex(rail, locator("divider", "divider-one"), "before"), 1);
  assert.equal(railInsertionIndex(rail, locator("divider", "divider-one"), "after"), 2);
  assert.equal(railInsertionIndex(rail, locator("workspace", "ws-missing"), "after"), -1);
});

test("additions are refused before a write when they would pass either limit", () => {
  const atWorkspaceLimit = {
    workspaces: Array.from({ length: MAX_WORKSPACES }, (_, index) => ({ id: `ws-${index}` })),
    rail: []
  };
  assert.equal(
    validateRailAdditions(atWorkspaceLimit, { workspaces: 1, railEntries: 1 }).code,
    RAIL_BATCH_ERROR_CODES.WORKSPACE_LIMIT
  );

  const atRailLimit = {
    workspaces: [],
    rail: Array.from({ length: MAX_RAIL_ENTRIES }, (_, index) => divider(String(index)))
  };
  assert.equal(
    validateRailAdditions(atRailLimit, { workspaces: 0, railEntries: 1 }).code,
    RAIL_BATCH_ERROR_CODES.RAIL_LIMIT
  );

  assert.equal(validateRailAdditions({ workspaces: [], rail: [] }).ok, true);
  assert.equal(
    validateRailAdditions(
      { workspaces: [{ id: "ws-a" }], rail: [workspace("ws-a")] },
      { workspaces: MAX_WORKSPACES - 1, railEntries: MAX_RAIL_ENTRIES - 1 }
    ).ok,
    true
  );
});

// Removal always passes tabs to the removed workspace's immediate successor,
// so "everything to the first workspace" is achieved by parking the block
// before that workspace and removing from the end. This replays exactly that
// and checks the successor really is the destination at every step.
function assertAllTabsReachDestination(rail, removedIds) {
  const plan = planRemovalIntoFirstWorkspace(rail, removedIds);
  assert.equal(plan.ok, true, "a removal plan exists");

  const parked = plan.parkLocators.map(({ id }) => id);
  assert.deepEqual([...parked].sort(), [...new Set(removedIds)].sort());
  assert.ok(!parked.includes(plan.destinationWorkspaceId), "the destination is not removed");

  let ids = railWorkspaceIds(rail).filter((id) => !parked.includes(id));
  ids.splice(ids.indexOf(plan.destinationWorkspaceId), 0, ...parked);

  for (const id of plan.order) {
    const index = ids.indexOf(id);
    assert.ok(index >= 0, `${id} is still on the rail when it is removed`);
    const successor = ids[(index + 1) % ids.length];
    assert.equal(
      successor,
      plan.destinationWorkspaceId,
      `${id} hands its tabs to ${successor}, not to the destination`
    );
    ids = ids.filter((candidate) => candidate !== id);
  }
  assert.ok(ids.includes(plan.destinationWorkspaceId), "the destination survives");
  return plan;
}

test("every removed workspace hands its tabs to the first surviving workspace", () => {
  const rail = [
    workspace("ws-a"),
    workspace("ws-b"),
    divider("one"),
    workspace("ws-c"),
    workspace("ws-d"),
    space("one"),
    workspace("ws-e")
  ];

  // Scattered, contiguous, and a run that reaches the end of the rail.
  assert.equal(
    assertAllTabsReachDestination(rail, ["ws-b", "ws-d", "ws-e"]).destinationWorkspaceId,
    "ws-a"
  );
  assertAllTabsReachDestination(rail, ["ws-c", "ws-d"]);
  assertAllTabsReachDestination(rail, ["ws-e"]);

  // When the first workspace is itself removed the next survivor takes over.
  const plan = assertAllTabsReachDestination(rail, ["ws-a", "ws-b", "ws-d"]);
  assert.equal(plan.destinationWorkspaceId, "ws-c");
});

test("a removal plan refuses an empty selection, a stranger, and the last workspace", () => {
  const rail = [workspace("ws-a"), workspace("ws-b"), divider("one")];

  assert.deepEqual(planRemovalIntoFirstWorkspace(rail, []), {
    ok: false,
    code: RAIL_BATCH_ERROR_CODES.EMPTY_SELECTION
  });
  assert.deepEqual(planRemovalIntoFirstWorkspace(rail, ["ws-missing"]), {
    ok: false,
    code: RAIL_BATCH_ERROR_CODES.MISSING_ENTRY
  });
  assert.deepEqual(planRemovalIntoFirstWorkspace(rail, ["ws-a", "ws-b"]), {
    ok: false,
    code: RAIL_BATCH_ERROR_CODES.NO_SURVIVING_WORKSPACE
  });
  // A repeated id is one removal, not two.
  assert.deepEqual(planRemovalIntoFirstWorkspace(rail, ["ws-a", "ws-a"]).order, ["ws-a"]);
});

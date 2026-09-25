import test from "node:test";
import assert from "node:assert/strict";

import { resolveTabDrop } from "../../src/sidebar/tab-drop-resolver.js";

const WORKSPACE_ID = "ws-default-work";
const ROW = 30;
const GAP = 2;
const STEP = 16;
const GROUP_INSET = 20;

function tab(logicalId, overrides = {}) {
  return {
    logicalId,
    workspaceId: WORKSPACE_ID,
    parentTabId: null,
    depth: 0,
    pinned: false,
    groupId: null,
    collapsed: false,
    splitViewId: null,
    splitPosition: null,
    ...overrides
  };
}

// Builds evenly spaced rows. Each row is a tab ID or `group:<id>`; a row's
// depth-0 content starts at 10px, indented one step per depth and by the
// group inset inside a group.
function fixture(tabs, groups, rowOrder) {
  const tabById = new Map(tabs.map((row) => [row.logicalId, row]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const entries = rowOrder.map((key, index) => {
    const top = index * (ROW + GAP);
    const base = { top, bottom: top + ROW, left: 0 };
    if (key.startsWith("group:")) {
      return { kind: "group", group: groupById.get(key.slice(6)), ...base, contentStart: 10 };
    }
    const row = tabById.get(key);
    const inset = row.groupId === null ? 0 : GROUP_INSET;
    return { kind: "tab", tab: row, ...base, contentStart: 10 + inset + row.depth * STEP };
  });
  const view = { activeWorkspaceId: WORKSPACE_ID, activeTabs: tabs, activeGroups: groups };
  return { view, entries };
}

function rowY(index, fraction) {
  return index * (ROW + GAP) + ROW * fraction;
}

function resolve(setup, { x = 200, y, dragged = ["dragged"], iconsOnly = false, group = null }) {
  return resolveTabDrop({
    entries: setup.entries,
    view: setup.view,
    pointer: { x, y },
    drag: group === null
      ? { kind: "tabs", tabIds: new Set(dragged) }
      : { kind: "group", groupId: group },
    iconsOnly,
    indentStep: STEP
  });
}

function placement(destination) {
  const { relation, anchorTabId, parentTabId, zone, groupId } = destination;
  return { relation, anchorTabId, parentTabId, zone, groupId };
}

test("the gap between two rows and its surrounding bands resolve to one insertion", () => {
  const setup = fixture([tab("a"), tab("b")], [], ["a", "b"]);
  const expected = {
    relation: "after",
    anchorTabId: "a",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  };
  for (const y of [rowY(0, 0.9), ROW + 1, rowY(1, 0.1)]) {
    const result = resolve(setup, { y });
    assert.deepEqual(placement(result.destination), expected, `y=${y}`);
    assert.equal(result.indicator.entryIndex, 0);
    assert.equal(result.indicator.edge, "after");
  }
});

test("the middle band nests and has a distinct inside indicator", () => {
  const setup = fixture([tab("a"), tab("b")], [], ["a", "b"]);
  const result = resolve(setup, { y: rowY(0, 0.5) });
  assert.deepEqual(placement(result.destination), {
    relation: "inside",
    anchorTabId: "a",
    parentTabId: "a",
    zone: "ungrouped",
    groupId: null
  });
  assert.deepEqual(result.indicator, { entryIndex: 0, edge: "inside", indent: null });
});

test("the gap below an expanded parent makes the tabs its first children", () => {
  const setup = fixture(
    [tab("p"), tab("c", { parentTabId: "p", depth: 1 })],
    [],
    ["p", "c"]
  );
  for (const y of [rowY(0, 0.9), rowY(1, 0.1)]) {
    const result = resolve(setup, { y, x: 0 });
    assert.deepEqual(placement(result.destination), {
      relation: "before",
      anchorTabId: "c",
      parentTabId: "p",
      zone: "ungrouped",
      groupId: null
    });
    assert.equal(result.indicator.indent, 10 + STEP);
  }
});

test("below a branch Full Labels picks the level from the pointer's horizontal position", () => {
  const setup = fixture(
    [tab("p"), tab("c", { parentTabId: "p", depth: 1 }), tab("y")],
    [],
    ["p", "c", "y"]
  );
  const inBranch = resolve(setup, { y: rowY(1, 0.9), x: 10 + STEP });
  assert.equal(inBranch.destination.parentTabId, "p");
  assert.equal(inBranch.indicator.indent, 10 + STEP);
  const outside = resolve(setup, { y: rowY(2, 0.1), x: 10 });
  assert.deepEqual(placement(outside.destination), {
    relation: "after",
    anchorTabId: "c",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
  assert.equal(outside.indicator.indent, 10);
});

test("below a branch Icons Only keeps the upper half inside and the lower half outside", () => {
  const setup = fixture(
    [tab("p"), tab("c", { parentTabId: "p", depth: 1 }), tab("y")],
    [],
    ["p", "c", "y"]
  );
  assert.equal(resolve(setup, { y: rowY(1, 0.9), iconsOnly: true }).destination.parentTabId, "p");
  assert.equal(resolve(setup, { y: rowY(2, 0.1), iconsOnly: true }).destination.parentTabId, null);
});

test("a sibling below limits the levels so its own parent stays reachable", () => {
  const setup = fixture(
    [
      tab("p"),
      tab("c", { parentTabId: "p", depth: 1 }),
      tab("g", { parentTabId: "c", depth: 2 }),
      tab("d", { parentTabId: "p", depth: 1 })
    ],
    [],
    ["p", "c", "g", "d"]
  );
  const farLeft = resolve(setup, { y: rowY(2, 0.9), x: 0 });
  assert.equal(farLeft.destination.parentTabId, "p");
  assert.equal(resolve(setup, { y: rowY(2, 0.9), x: 200 }).destination.parentTabId, "c");
});

test("space above the first row and below the last row still resolves", () => {
  const setup = fixture(
    [tab("p"), tab("c", { parentTabId: "p", depth: 1 })],
    [],
    ["p", "c"]
  );
  const top = resolve(setup, { y: -20 });
  assert.deepEqual(placement(top.destination), {
    relation: "before",
    anchorTabId: "p",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
  const end = resolve(setup, { y: 500, x: 200 });
  assert.deepEqual(placement(end.destination), {
    relation: "after",
    anchorTabId: "c",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
});

test("dragged rows are never targets, and a gap beside them anchors on staying rows", () => {
  const setup = fixture(
    [tab("a"), tab("x"), tab("x1", { parentTabId: "x", depth: 1 }), tab("b")],
    [],
    ["a", "x", "x1", "b"]
  );
  const dragged = ["x", "x1"];
  assert.equal(resolve(setup, { y: rowY(1, 0.5), dragged }), null);
  assert.equal(resolve(setup, { y: rowY(2, 0.5), dragged }), null);
  const result = resolve(setup, { y: rowY(3, 0.1), dragged });
  assert.deepEqual(placement(result.destination), {
    relation: "after",
    anchorTabId: "a",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
  assert.equal(result.indicator.entryIndex, 0);
});

test("a collapsed parent's lower edge places tabs after its hidden branch", () => {
  const setup = fixture([tab("p", { collapsed: true }), tab("y")], [], ["p", "y"]);
  const result = resolve(setup, { y: rowY(0, 0.9) });
  assert.deepEqual(placement(result.destination), {
    relation: "after",
    anchorTabId: "p",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
});

test("group headers and member edges reach inside, first, last, and outside slots", () => {
  const group = { id: "group-g", title: "G", collapsed: false, tabIds: ["g1", "g2"] };
  const setup = fixture(
    [tab("g1", { groupId: "group-g" }), tab("g2", { groupId: "group-g" }), tab("z")],
    [group],
    ["group:group-g", "g1", "g2", "z"]
  );
  assert.deepEqual(placement(resolve(setup, { y: rowY(0, 0.5) }).destination), {
    relation: "end",
    anchorTabId: null,
    parentTabId: null,
    zone: "group",
    groupId: "group-g"
  });
  assert.deepEqual(placement(resolve(setup, { y: rowY(0, 0.1) }).destination), {
    relation: "before",
    anchorTabId: "g1",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
  assert.deepEqual(placement(resolve(setup, { y: rowY(0, 0.9) }).destination), {
    relation: "before",
    anchorTabId: "g1",
    parentTabId: null,
    zone: "group",
    groupId: "group-g"
  });
  const inside = resolve(setup, { y: rowY(2, 0.9), x: 10 + GROUP_INSET });
  assert.deepEqual(placement(inside.destination), {
    relation: "after",
    anchorTabId: "g2",
    parentTabId: null,
    zone: "group",
    groupId: "group-g"
  });
  const outside = resolve(setup, { y: rowY(3, 0.1), x: 10 });
  assert.deepEqual(placement(outside.destination), {
    relation: "after",
    anchorTabId: "g2",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
  assert.equal(
    resolve(setup, { y: rowY(3, 0.1), iconsOnly: true }).destination.zone,
    "ungrouped"
  );
});

test("the pinned boundary pins in its upper half and unpins in its lower half", () => {
  const setup = fixture([tab("pin", { pinned: true }), tab("a")], [], ["pin", "a"]);
  assert.deepEqual(placement(resolve(setup, { y: rowY(0, 0.8) }).destination), {
    relation: "after",
    anchorTabId: "pin",
    parentTabId: null,
    zone: "pinned",
    groupId: null
  });
  assert.deepEqual(placement(resolve(setup, { y: rowY(1, 0.1) }).destination), {
    relation: "before",
    anchorTabId: "a",
    parentTabId: null,
    zone: "ungrouped",
    groupId: null
  });
  assert.notEqual(resolve(setup, { y: rowY(0, 0.5) }).destination.relation, "inside");
});

test("a split pane row takes only its outer edge and never nests", () => {
  const setup = fixture(
    [
      tab("s1", { splitViewId: "split-1", splitPosition: "start" }),
      tab("s2", { splitViewId: "split-1", splitPosition: "end" })
    ],
    [],
    ["s1", "s2"]
  );
  const onStart = resolve(setup, { y: rowY(0, 0.5) });
  assert.equal(onStart.destination.relation, "before");
  assert.equal(onStart.destination.anchorTabId, "s1");
  const onEnd = resolve(setup, { y: rowY(1, 0.5) });
  assert.equal(onEnd.destination.relation, "after");
  assert.equal(onEnd.destination.anchorTabId, "s2");
});

test("group drags snap beside whole branches and skip pinned rows", () => {
  const group = { id: "group-g", title: "G", collapsed: false, tabIds: ["g1"] };
  const setup = fixture(
    [
      tab("pin", { pinned: true }),
      tab("p"),
      tab("c", { parentTabId: "p", depth: 1 }),
      tab("g1", { groupId: "group-g" })
    ],
    [group],
    ["pin", "p", "c", "group:group-g", "g1"]
  );
  assert.equal(resolve(setup, { y: rowY(0, 0.5), group: "group-g" }), null);
  assert.equal(resolve(setup, { y: rowY(4, 0.5), group: "group-g" }), null);
  const snapped = resolve(setup, { y: rowY(2, 0.2), group: "group-other" });
  assert.deepEqual(snapped.destination, {
    workspaceId: WORKSPACE_ID,
    relation: "before",
    anchorTabId: "p"
  });
  assert.deepEqual(resolve(setup, { y: 900, group: "group-other" }).destination, {
    workspaceId: WORKSPACE_ID,
    relation: "end",
    anchorTabId: null
  });
});

test("an empty list accepts a drop at its end", () => {
  const setup = fixture([], [], []);
  assert.equal(resolve(setup, { y: 10 }).destination.relation, "end");
  assert.equal(resolve(setup, { y: 10 }).indicator, null);
});

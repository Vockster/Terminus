import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  groupMoveDestination,
  snapGroupDropToBranch,
  tabMoveDestination,
  treeBranchShape,
  treeDescendantSummary,
  withTreeDescendants
} from "../../src/sidebar/tab-tree-targets.js";
import {
  relocateLogicalGroup,
  relocateLogicalTabs
} from "../../src/core/workspace-layout-policy.js";

function branch(tabs) {
  return Object.fromEntries(
    [...treeBranchShape(tabs)].map(([logicalId, { depth, lastChild, trunks }]) =>
      [logicalId, { depth, lastChild, trunks: [...trunks] }])
  );
}

const TABS = Object.freeze([
  { logicalId: "tab-a", parentTabId: null },
  { logicalId: "tab-b", parentTabId: "tab-a" },
  { logicalId: "tab-c", parentTabId: "tab-b", hiddenByCollapsedAncestor: true },
  { logicalId: "tab-d", parentTabId: null },
  { logicalId: "tab-e", parentTabId: "tab-d" },
  { logicalId: "tab-f", parentTabId: null }
]);

function ids(rows) {
  return rows.map(({ logicalId }) => logicalId);
}

test("a tab brings every tab nested under it, including collapsed ones", () => {
  assert.deepEqual(ids(withTreeDescendants(TABS, [TABS[0]])), ["tab-a", "tab-b", "tab-c"]);
  assert.deepEqual(ids(withTreeDescendants(TABS, [TABS[5]])), ["tab-f"]);
});

test("a nested tab leaves its parent loaded", () => {
  assert.deepEqual(ids(withTreeDescendants(TABS, [TABS[1]])), ["tab-b", "tab-c"]);
});

test("a selection brings each selected tab's branch once, in pane order", () => {
  assert.deepEqual(
    ids(withTreeDescendants(TABS, [TABS[3], TABS[1]])),
    ["tab-b", "tab-c", "tab-d", "tab-e"]
  );
  assert.deepEqual(ids(withTreeDescendants(TABS, [TABS[0], TABS[1]])), ["tab-a", "tab-b", "tab-c"]);
  assert.deepEqual(withTreeDescendants(TABS, []), []);
});

// The shape is what separates a drawn tree from a set of stripes: a column
// only carries its trunk on while a sibling still waits below it.
test("a branch ends its trunk at the last child and carries it past the others", () => {
  //  a
  //  |- b
  //  |  |- c     (b has d below it, so b's column keeps its trunk under c)
  //  |  `- d
  //  `- e        (last child of a)
  const shape = branch([
    { logicalId: "tab-a", parentTabId: null, groupId: null },
    { logicalId: "tab-b", parentTabId: "tab-a", groupId: null },
    { logicalId: "tab-c", parentTabId: "tab-b", groupId: null },
    { logicalId: "tab-d", parentTabId: "tab-b", groupId: null },
    { logicalId: "tab-e", parentTabId: "tab-a", groupId: null }
  ]);

  assert.equal(Object.hasOwn(shape, "tab-a"), false);
  assert.deepEqual(shape["tab-b"], { depth: 1, lastChild: false, trunks: [] });
  assert.deepEqual(shape["tab-c"], { depth: 2, lastChild: false, trunks: [true] });
  assert.deepEqual(shape["tab-d"], { depth: 2, lastChild: true, trunks: [true] });
  assert.deepEqual(shape["tab-e"], { depth: 1, lastChild: true, trunks: [] });
});

test("a finished branch leaves its column empty instead of trailing a line", () => {
  //  a
  //  `- b        (last child, so its column is done)
  //     `- c     (b's column must be blank beside c)
  const shape = branch([
    { logicalId: "tab-a", parentTabId: null, groupId: null },
    { logicalId: "tab-b", parentTabId: "tab-a", groupId: null },
    { logicalId: "tab-c", parentTabId: "tab-b", groupId: null }
  ]);

  assert.deepEqual(shape["tab-b"], { depth: 1, lastChild: true, trunks: [] });
  assert.deepEqual(shape["tab-c"], { depth: 2, lastChild: true, trunks: [false] });
});

test("rows that are not drawn are not siblings", () => {
  // The collapsed branch hides tab-c, so tab-b is the last drawn child and its
  // connector must be an elbow rather than a tee pointing at nothing.
  const shape = branch([
    { logicalId: "tab-a", parentTabId: null, groupId: null },
    { logicalId: "tab-b", parentTabId: "tab-a", groupId: null },
    { logicalId: "tab-c", parentTabId: "tab-a", groupId: null, hiddenByCollapsedAncestor: true }
  ]);

  assert.deepEqual(shape["tab-b"], { depth: 1, lastChild: true, trunks: [] });
  assert.equal(Object.hasOwn(shape, "tab-c"), false);
});

test("pinned tabs are never drawn with a branch", () => {
  const shape = branch([
    { logicalId: "tab-a", parentTabId: null, groupId: null, pinned: true },
    { logicalId: "tab-b", parentTabId: "tab-a", groupId: null, pinned: true }
  ]);

  assert.deepEqual(shape, {});
});

// Members render inside their own group section, so a line drawn across that
// boundary would point at a row that is not next to it.
test("siblings in different groups end their own branches", () => {
  const shape = branch([
    { logicalId: "tab-a", parentTabId: null, groupId: null },
    { logicalId: "tab-b", parentTabId: "tab-a", groupId: "group-one" },
    { logicalId: "tab-c", parentTabId: "tab-a", groupId: "group-two" }
  ]);

  assert.equal(shape["tab-b"].lastChild, true);
  assert.equal(shape["tab-c"].lastChild, true);
});

test("a branch summary counts every nested level, hidden tabs included, and any loaded tab", () => {
  const tabs = [
    { logicalId: "tab-a", parentTabId: null, discarded: false },
    { logicalId: "tab-b", parentTabId: "tab-a", discarded: true },
    { logicalId: "tab-c", parentTabId: "tab-b", discarded: true, hiddenByCollapsedAncestor: true },
    { logicalId: "tab-d", parentTabId: "tab-b", discarded: false, hiddenByCollapsedAncestor: true },
    { logicalId: "tab-e", parentTabId: null, discarded: true },
    { logicalId: "tab-f", parentTabId: "tab-e", discarded: true },
    { logicalId: "tab-g", parentTabId: null, discarded: false }
  ];
  const summary = treeDescendantSummary(tabs);
  assert.deepEqual(Object.fromEntries(summary), {
    "tab-a": { count: 3, anyLoaded: true },
    "tab-b": { count: 2, anyLoaded: true },
    "tab-e": { count: 1, anyLoaded: false }
  });
  assert.equal(summary.has("tab-g"), false, "a tab with no nested tabs has no summary");
  assert.equal(summary.get("tab-e").anyLoaded, false, "a parent's own load state is not counted");
  assert.deepEqual(treeDescendantSummary([]), new Map());
});

test("Middle Mouse and the tab menu Unload action both include tree descendants", async () => {
  const pane = await readFile(new URL("../../src/sidebar/tab-pane.js", import.meta.url), "utf8");
  assert.match(pane, /return onUnloadTabs\(withTreeDescendants\(currentView\.activeTabs, sourceRows\(logicalId\)\)\);/);
  assert.match(
    pane,
    /const closure = withTreeDescendants\(currentView\.activeTabs, sources\);\s*const unload = \{ label: "Unload", action: \(\) => onUnloadTabs\(closure\) \};/
  );
  assert.equal(pane.match(/label: "Unload",/g)?.length, 1);
  assert.doesNotMatch(pane, /onUnloadTabs\(sources\)|onUnloadTabs\(sourceRows\(/);
});

// Rows as text: "a" is a root, "a1<a" nests a1 under a, "*p" is pinned, and
// "[g:x y<x]" is native group g. The same rows build the sidebar view and the
// runtime layout, so a chosen destination can be applied by the real policy.
const WORKSPACE = "ws-work";

function parseRows(rows) {
  const parsed = [];
  for (const token of rows) {
    const group = /^\[(\w+):(.*)\]$/.exec(token);
    for (const member of group ? group[2].split(" ") : [token]) {
      const pinned = member.startsWith("*");
      const [name, parent] = member.replace("*", "").split("<");
      parsed.push({
        logicalId: `tab-${name}`,
        workspaceId: WORKSPACE,
        pinned,
        groupId: group ? `group-${group[1]}` : null,
        parentTabId: parent ? `tab-${parent}` : null,
        splitViewId: null,
        splitPosition: null
      });
    }
  }
  return parsed;
}

function treeView(rows, overrides = {}) {
  const activeTabs = parseRows(rows).map((tab) => ({
    ...tab,
    ...(overrides[tab.logicalId.slice(4)] ?? {})
  }));
  const groups = new Map();
  for (const tab of activeTabs.filter(({ groupId }) => groupId !== null)) {
    groups.set(tab.groupId, [...(groups.get(tab.groupId) ?? []), tab.logicalId]);
  }
  return {
    activeWorkspaceId: WORKSPACE,
    activeTabs,
    activeGroups: [...groups].map(([id, tabIds]) => ({ id, tabIds, collapsed: false }))
  };
}

function layoutRuntime(view) {
  return {
    tabs: view.activeTabs.map(({ logicalId }) => ({ id: logicalId, workspaceId: WORKSPACE })),
    windows: [{ workspaceLayouts: [{
      workspaceId: WORKSPACE,
      tabIds: view.activeTabs.map(({ logicalId }) => logicalId),
      pinnedTabIds: view.activeTabs.filter(({ pinned }) => pinned).map(({ logicalId }) => logicalId),
      groups: view.activeGroups.map(({ id, tabIds }) => ({
        id, title: "", color: "grey", collapsed: false, tabIds
      })),
      tree: view.activeTabs.map(({ logicalId, parentTabId }) => ({
        tabId: logicalId, parentTabId, collapsed: false
      })),
      splitViews: []
    }] }]
  };
}

function rowsOf(runtime) {
  const layout = runtime.windows[0].workspaceLayouts[0];
  const parentById = new Map(layout.tree.map((node) => [node.tabId, node.parentTabId]));
  const pinned = new Set(layout.pinnedTabIds);
  const groupById = new Map(
    layout.groups.flatMap((group) => group.tabIds.map((tabId) => [tabId, group.id]))
  );
  return layout.tabIds.map((tabId) => {
    const parent = parentById.get(tabId);
    const group = groupById.get(tabId);
    return [
      pinned.has(tabId) ? "*" : "",
      group ? `${group.slice(6)}:` : "",
      tabId.slice(4),
      parent ? `<${parent.slice(4)}` : ""
    ].join("");
  });
}

function menuMove(rows, selected, clicked, direction, overrides) {
  const view = treeView(rows, overrides);
  const byName = (name) => view.activeTabs.find(({ logicalId }) => logicalId === `tab-${name}`);
  const moving = withTreeDescendants(view.activeTabs, selected.map(byName));
  return {
    view,
    moving,
    destination: tabMoveDestination(view, moving, byName(clicked), direction)
  };
}

function applyMenuMove(rows, selected, clicked, direction) {
  const { view, moving, destination } = menuMove(rows, selected, clicked, direction);
  if (!destination) return null;
  const runtime = layoutRuntime(view);
  assert.ok(relocateLogicalTabs({
    runtime,
    windowRuntime: runtime.windows[0],
    tabIds: moving.map(({ logicalId }) => logicalId),
    destination
  }), `policy accepts ${JSON.stringify(destination)}`);
  return rowsOf(runtime);
}

const PROBE = ["a", "a1<a", "a2<a", "b", "b1<b", "c"];

test("moving a tree down or up moves the whole tree past whole sibling trees", () => {
  assert.deepEqual(applyMenuMove(PROBE, ["b"], "b", "down"), ["a", "a1<a", "a2<a", "c", "b", "b1<b"]);
  assert.deepEqual(applyMenuMove(PROBE, ["b"], "b", "up"), ["b", "b1<b", "a", "a1<a", "a2<a", "c"]);
  assert.deepEqual(
    applyMenuMove(PROBE, ["a", "b"], "a", "down"),
    ["c", "a", "a1<a", "a2<a", "b", "b1<b"],
    "Ctrl-selected roots keep their order and shapes"
  );
  assert.deepEqual(
    applyMenuMove(PROBE, ["b", "c"], "b", "up"),
    ["b", "b1<b", "c", "a", "a1<a", "a2<a"],
    "a tree above is stepped over whole"
  );
  assert.deepEqual(
    applyMenuMove(PROBE, ["a", "a1", "a2", "b", "b1"], "a1", "down"),
    ["c", "a", "a1<a", "a2<a", "b", "b1<b"],
    "a Shift range across trees uses the clicked tab's whole unit"
  );
});

test("a nested tab moves among its siblings, then leaves its parent", () => {
  const rows = ["p", "r<p", "r1<r", "s<p", "s1<s", "z"];
  assert.deepEqual(applyMenuMove(rows, ["r"], "r", "down"), ["p", "s<p", "s1<s", "r<p", "r1<r", "z"]);
  assert.deepEqual(applyMenuMove(rows, ["s"], "s", "up"), ["p", "s<p", "s1<s", "r<p", "r1<r", "z"]);
  assert.deepEqual(applyMenuMove(rows, ["r"], "r", "up"), ["r", "r1<r", "p", "s<p", "s1<s", "z"]);
  assert.deepEqual(applyMenuMove(rows, ["s"], "s", "down"), ["p", "r<p", "r1<r", "s", "s1<s", "z"]);
  assert.deepEqual(
    applyMenuMove(["p", "r<p", "q<r", "s<p"], ["q"], "q", "down"),
    ["p", "r<p", "q<p", "s<p"],
    "leaving a parent downward lands after that parent's remaining branch"
  );
});

test("a partial selection inside a tree moves together to the clicked unit's destination", () => {
  const rows = ["p", "r<p", "s<p", "t<p", "z"];
  assert.deepEqual(applyMenuMove(rows, ["r", "t"], "r", "down"), ["p", "s<p", "r<p", "t<p", "z"]);
});

test("top-level tabs step over whole groups without entering them", () => {
  const rows = ["x", "x1<x", "[g:g1 g2<g1]", "y"];
  assert.deepEqual(applyMenuMove(rows, ["x"], "x", "down"), ["g:g1", "g:g2<g1", "x", "x1<x", "y"]);
  assert.deepEqual(applyMenuMove(rows, ["y"], "y", "up"), ["x", "x1<x", "y", "g:g1", "g:g2<g1"]);
});

test("a top-level group member moves within its group, then leaves it", () => {
  const rows = ["x", "[g:g1 g2 g3]", "y"];
  assert.deepEqual(applyMenuMove(rows, ["g1"], "g1", "down"), ["x", "g:g2", "g:g1", "g:g3", "y"]);
  assert.deepEqual(applyMenuMove(rows, ["g1"], "g1", "up"), ["x", "g1", "g:g2", "g:g3", "y"]);
  assert.deepEqual(applyMenuMove(rows, ["g3"], "g3", "down"), ["x", "g:g1", "g:g2", "g3", "y"]);
  assert.deepEqual(
    applyMenuMove(["*p", "[g:g1 g2]"], ["g1"], "g1", "up"),
    ["*p", "g1", "g:g2"],
    "a group right after the pins still lets its first member leave upward"
  );
  assert.equal(
    menuMove(rows, ["g1", "g2", "g3"], "g2", "up").destination,
    null,
    "moving every member is Move group, not a tab move"
  );
});

test("pinned tabs move only among pinned tabs and moves stop at every edge", () => {
  const rows = ["*p1", "*p2", "a", "b"];
  assert.deepEqual(applyMenuMove(rows, ["p2"], "p2", "up"), ["*p2", "*p1", "a", "b"]);
  assert.equal(menuMove(rows, ["p2"], "p2", "down").destination, null);
  assert.equal(menuMove(rows, ["p1"], "p1", "up").destination, null);
  assert.equal(menuMove(rows, ["a"], "a", "up").destination, null);
  assert.equal(menuMove(rows, ["b"], "b", "down").destination, null);
  assert.equal(menuMove(["a", "b"], ["a", "b"], "a", "down").destination, null);
});

test("moves never anchor between Split View panes or under a pane", () => {
  const split = {
    s: { splitViewId: "split-one", splitPosition: "start" },
    t: { splitViewId: "split-one", splitPosition: "end" }
  };
  const rows = ["a", "s", "t", "b"];
  assert.equal(menuMove(rows, ["a"], "a", "down", split).destination.anchorTabId, "tab-t");
  assert.equal(menuMove(rows, ["b"], "b", "up", split).destination.anchorTabId, "tab-s");
  assert.equal(
    menuMove(["s", "c<s", "t<s"], ["c"], "c", "down", split).destination,
    null,
    "a destination under a split pane would be refused"
  );
});

test("group moves step over whole top-level trees and other groups but never pins", () => {
  const up = treeView(["a", "a1<a", "a2<a", "[g:g1 g2]"]);
  assert.deepEqual(groupMoveDestination(up, up.activeGroups[0], "up"), {
    workspaceId: WORKSPACE, relation: "before", anchorTabId: "tab-a"
  });
  assert.equal(groupMoveDestination(up, up.activeGroups[0], "down"), null);

  const down = treeView(["[g:g1 g2]", "b", "b1<b", "b2<b"]);
  assert.deepEqual(groupMoveDestination(down, down.activeGroups[0], "down"), {
    workspaceId: WORKSPACE, relation: "after", anchorTabId: "tab-b2"
  });

  const pinned = treeView(["*p", "[g:g1 g2]", "[h:h1 h2]"]);
  assert.equal(groupMoveDestination(pinned, pinned.activeGroups[0], "up"), null);
  assert.deepEqual(groupMoveDestination(pinned, pinned.activeGroups[0], "down"), {
    workspaceId: WORKSPACE, relation: "after", anchorTabId: "tab-h2"
  });

  for (const [rows, direction, expected] of [
    [["a", "a1<a", "a2<a", "[g:g1 g2]"], "up", ["g:g1", "g:g2", "a", "a1<a", "a2<a"]],
    [["[g:g1 g2]", "b", "b1<b", "b2<b"], "down", ["b", "b1<b", "b2<b", "g:g1", "g:g2"]]
  ]) {
    const view = treeView(rows);
    const runtime = layoutRuntime(view);
    assert.ok(relocateLogicalGroup({
      runtime,
      windowRuntime: runtime.windows[0],
      groupId: "group-g",
      sourceWorkspaceId: WORKSPACE,
      memberTabIds: view.activeGroups[0].tabIds,
      destination: groupMoveDestination(view, view.activeGroups[0], direction)
    }));
    assert.deepEqual(rowsOf(runtime), expected);
  }
});

test("a group dropped on a nested row lands beside that row's whole tree", () => {
  const view = treeView(["a", "a1<a", "a11<a1", "b", "[g:g1]"]);
  const row = (name) => view.activeTabs.find(({ logicalId }) => logicalId === `tab-${name}`);
  assert.deepEqual(snapGroupDropToBranch(view, row("a11"), "before"), {
    workspaceId: WORKSPACE, relation: "before", anchorTabId: "tab-a"
  });
  assert.deepEqual(snapGroupDropToBranch(view, row("a1"), "after"), {
    workspaceId: WORKSPACE, relation: "after", anchorTabId: "tab-a11"
  });
  assert.deepEqual(snapGroupDropToBranch(view, row("b"), "after"), {
    workspaceId: WORKSPACE, relation: "after", anchorTabId: "tab-b"
  });
  assert.equal(snapGroupDropToBranch(view, row("b"), "inside"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSelection,
  createRailSelection,
  extendSelection,
  isSelected,
  orderedMembers,
  pruneSelection,
  railEntryKey,
  selectAll,
  selectOnly,
  selectedWorkspaceIds,
  selectionKinds,
  selectionSize,
  toggleSelection
} from "../../src/settings/rail-selection.js";

const workspace = (id) => ({ kind: "workspace", workspaceId: id });
const divider = (id) => ({ kind: "divider", id: `divider-${id}`, size: 16 });
const space = (id) => ({ kind: "space", id: `space-${id}` });

const rail = [
  workspace("ws-a"),
  divider("one"),
  workspace("ws-b"),
  space("one"),
  workspace("ws-c")
];

test("a key identifies a rail entry by kind and its own identifier", () => {
  assert.equal(railEntryKey(workspace("ws-a")), "workspace:ws-a");
  assert.equal(railEntryKey(divider("one")), "divider:divider-one");
  assert.equal(railEntryKey(space("one")), "space:space-one");
});

test("selecting one entry replaces the selection and becomes the anchor", () => {
  const selection = selectOnly(createRailSelection(), "workspace:ws-b");
  assert.deepEqual([...selection.keys], ["workspace:ws-b"]);
  assert.equal(selection.anchor, "workspace:ws-b");
  assert.equal(selectionSize(selection), 1);
});

test("toggling adds and removes one entry without disturbing the rest", () => {
  let selection = selectOnly(createRailSelection(), "workspace:ws-a");
  selection = toggleSelection(selection, "workspace:ws-c");
  assert.equal(selectionSize(selection), 2);
  assert.equal(isSelected(selection, "workspace:ws-c"), true);

  selection = toggleSelection(selection, "workspace:ws-a");
  assert.deepEqual([...selection.keys], ["workspace:ws-c"]);
  // The anchor follows the key the user just touched, even when that removed it,
  // so a following range extends from where they actually are.
  assert.equal(selection.anchor, "workspace:ws-a");
});

test("extending covers every entry between the anchor and the target, in rail order", () => {
  const selection = extendSelection(
    selectOnly(createRailSelection(), "workspace:ws-a"),
    "workspace:ws-b",
    rail
  );
  assert.deepEqual([...selection.keys], [
    "workspace:ws-a",
    "divider:divider-one",
    "workspace:ws-b"
  ]);
  assert.equal(selection.anchor, "workspace:ws-a");
});

test("extending backwards covers the same range and keeps the anchor", () => {
  const selection = extendSelection(
    selectOnly(createRailSelection(), "workspace:ws-c"),
    "workspace:ws-b",
    rail
  );
  assert.deepEqual([...selection.keys], [
    "workspace:ws-b",
    "space:space-one",
    "workspace:ws-c"
  ]);
  assert.equal(selection.anchor, "workspace:ws-c");
});

// Otherwise the first Shift+click on a freshly opened panel would sweep the
// rail from wherever the model happened to start.
test("extending with no anchor selects only the target", () => {
  const selection = extendSelection(createRailSelection(), "workspace:ws-b", rail);
  assert.deepEqual([...selection.keys], ["workspace:ws-b"]);
});

test("extending to an entry that is not on the rail changes nothing", () => {
  const before = selectOnly(createRailSelection(), "workspace:ws-a");
  assert.equal(extendSelection(before, "workspace:ws-missing", rail), before);
});

test("select all takes every entry and clear empties the selection", () => {
  const all = selectAll(rail);
  assert.equal(selectionSize(all), rail.length);
  assert.equal(all.anchor, "workspace:ws-c");

  const cleared = clearSelection();
  assert.equal(selectionSize(cleared), 0);
  assert.equal(cleared.anchor, null);
});

// A mutation replaces the rail. Stale keys would otherwise survive and quietly
// re-select whatever later occupies that position.
test("pruning drops keys and an anchor that the rail no longer contains", () => {
  const selection = createRailSelection(
    ["workspace:ws-a", "workspace:ws-removed"],
    "workspace:ws-removed"
  );
  const pruned = pruneSelection(selection, rail);
  assert.deepEqual([...pruned.keys], ["workspace:ws-a"]);
  assert.equal(pruned.anchor, null);
});

test("pruning a selection the rail still holds returns it unchanged", () => {
  const selection = selectOnly(createRailSelection(), "workspace:ws-a");
  assert.equal(pruneSelection(selection, rail), selection);
});

test("members always read in rail order, whatever order they were clicked in", () => {
  const selection = createRailSelection([
    "workspace:ws-c",
    "divider:divider-one",
    "workspace:ws-a"
  ]);
  assert.deepEqual(orderedMembers(selection, rail), [
    { kind: "workspace", id: "ws-a" },
    { kind: "divider", id: "divider-one" },
    { kind: "workspace", id: "ws-c" }
  ]);
});

test("a mixed selection reports its workspace members and the kinds it holds", () => {
  const selection = createRailSelection([
    "workspace:ws-c",
    "space:space-one",
    "workspace:ws-a"
  ]);
  assert.deepEqual(selectedWorkspaceIds(selection, rail), ["ws-a", "ws-c"]);
  assert.deepEqual([...selectionKinds(selection, rail)].sort(), ["space", "workspace"]);
});

test("a selection is immutable, so a panel cannot mutate it by accident", () => {
  const selection = selectOnly(createRailSelection(), "workspace:ws-a");
  assert.throws(() => selection.keys.push("workspace:ws-b"));
});

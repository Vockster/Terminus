import test from "node:test";
import assert from "node:assert/strict";

import { createFakeDocument, element } from "../helpers/fake-dom.js";

const document = createFakeDocument();
document.addEventListener = () => undefined;
globalThis.document = document;
globalThis.window ??= { addEventListener: () => undefined };
globalThis.CSS ??= { escape: (value) => String(value) };
const { createTabPane } = await import("../../src/sidebar/tab-pane.js");

function row(id, overrides = {}) {
  return {
    logicalId: `tab-${id}`,
    firefoxId: id,
    workspaceId: "ws-work",
    title: `Tab ${id}`,
    active: id === 1,
    discarded: false,
    audible: false,
    muted: false,
    pinned: false,
    groupId: null,
    parentTabId: null,
    depth: 0,
    collapsed: false,
    hiddenByCollapsedAncestor: false,
    splitViewId: null,
    splitPosition: null,
    container: { kind: "none" },
    ...overrides
  };
}

function view(activeTabs) {
  return {
    state: { workspaces: [{ id: "ws-work", name: "Work", color: "#ffffff" }] },
    activeWorkspaceId: "ws-work",
    activeTabs,
    activeGroups: []
  };
}

function createPane(options = {}) {
  const root = element(document, "div");
  document.body.append(root);
  const noop = async () => undefined;
  const pane = createTabPane({
    root,
    commandMenu: element(document, "div"),
    onActivate: noop,
    onRelocateTabs: noop,
    onRelocateGroup: noop,
    onRenameGroup: noop,
    onDeleteGroup: noop,
    onCreateGroup: noop,
    onUnloadTabs: noop,
    onFlattenBranch: noop,
    onCloseTarget: noop,
    onAcceptNativeDrop: () => false,
    onRelocateNativeSelection: () => false,
    onCancelNativeDrop: () => undefined,
    onSetTreeCollapsed: noop,
    onSetGroupCollapsed: noop,
    ...options
  });
  const rows = () => root.querySelectorAll(".tab-row");
  return { pane, rows };
}

test("re-rendering keeps unchanged rows and their favicon images attached", () => {
  const { pane, rows } = createPane();
  pane.render(view([row(1), row(2), row(3)]));
  const [first, second, third] = rows();
  const favicon = first.children.find((child) => child.className.includes("tab-favicon"));
  const image = document.createElement("img");
  favicon.append(image);

  pane.render(view([row(1), row(2, { title: "Renamed" }), row(3)]));

  const [nextFirst, nextSecond, nextThird] = rows();
  assert.equal(nextFirst, first);
  assert.equal(nextThird, third);
  assert.notEqual(nextSecond, second);
  assert.equal(nextSecond.children.find((child) => child.className === "tab-title").textContent, "Renamed");
  assert.equal(image.parentNode, favicon);
  assert.equal(image.isConnected, true);
});

// Menus measure their anchor and the viewport; the fake DOM has neither.
const RECT = Object.freeze({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 });
Object.getPrototypeOf(document.createElement("div")).getBoundingClientRect = () => RECT;
globalThis.window.innerWidth ??= 400;
globalThis.window.innerHeight ??= 800;

function menuPane(options = {}) {
  const root = element(document, "div");
  document.body.append(root);
  const commandMenu = element(document, "div");
  commandMenu.querySelector = () => null;
  const calls = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); };
  const pane = createTabPane({
    root,
    commandMenu,
    onActivate: record("activate"),
    onRelocateTabs: record("relocate"),
    onRelocateGroup: record("relocateGroup"),
    onRenameGroup: record("renameGroup"),
    onDeleteGroup: record("deleteGroup"),
    onCreateGroup: record("createGroup"),
    onUnloadTabs: record("unload"),
    onFlattenBranch: record("flatten"),
    onCloseTarget: record("close"),
    onMoveToContainer: record("moveToContainer"),
    onAcceptNativeDrop: () => false,
    onRelocateNativeSelection: () => false,
    onCancelNativeDrop: () => undefined,
    onSetTreeCollapsed: record("collapse"),
    onSetGroupCollapsed: record("collapseGroup"),
    ...options
  });
  const rowFor = (id) => root.querySelectorAll(".tab-row").find((node) => node.dataset.tabId === `tab-${id}`);
  const menu = (id) => {
    const target = rowFor(id);
    target.dispatchEvent({ type: "contextmenu", preventDefault() {}, stopPropagation() {}, target });
    return commandMenu.children.filter((node) => node.tagName === "BUTTON");
  };
  const labels = (id) => menu(id).map((button) => button.textContent);
  const choose = (id, label) => menu(id).find((button) => button.textContent === label).click();
  const toggleSelection = (id) => {
    const target = rowFor(id);
    target.dispatchEvent({ type: "keydown", key: " ", preventDefault() {}, target });
  };
  return { pane, calls, labels, choose, toggleSelection };
}

const TREE_ROWS = () => [
  row(1),
  row(2, { parentTabId: "tab-1", depth: 1 }),
  row(3, { parentTabId: "tab-2", depth: 2 }),
  row(4),
  row(5, { parentTabId: "tab-4", depth: 1 }),
  row(6)
];

function descriptor(id, parentId = null) {
  return {
    tabId: `tab-${id}`,
    workspaceId: "ws-work",
    pinned: false,
    groupId: null,
    parentTabId: parentId === null ? null : `tab-${parentId}`
  };
}

test("an unselected tab's menu acts on its own branch", async () => {
  const { pane, calls, labels, choose } = menuPane();
  pane.render(view(TREE_ROWS()));

  assert.deepEqual(labels(1), [
    "Pin", "Move tab down", "Create new group", "Unload", "Flatten branch (3 tabs)", "Close branch (3 tabs)"
  ]);
  assert.deepEqual(labels(6), ["Pin", "Move tab up", "Create new group", "Unload", "Close tab"]);

  choose(1, "Move tab down");
  choose(1, "Create new group");
  await Promise.resolve();
  assert.deepEqual(calls[0], ["relocate", [descriptor(1), descriptor(2, 1), descriptor(3, 2)], {
    workspaceId: "ws-work",
    zone: "ungrouped",
    relation: "after",
    anchorTabId: "tab-5",
    groupId: null,
    parentTabId: null
  }]);
  assert.deepEqual(calls[1][1].map(({ logicalId }) => logicalId), ["tab-1", "tab-2", "tab-3"]);
});

test("a selected tab's menu closes, flattens, and moves every selected tree", async () => {
  const { pane, calls, labels, choose, toggleSelection } = menuPane();
  pane.render(view(TREE_ROWS()));
  toggleSelection(1);
  toggleSelection(4);

  assert.deepEqual(labels(4), [
    "Pin", "Move tab down", "Create new group", "Unload", "Flatten selected (3 tabs)", "Close selected (5 tabs)"
  ]);
  assert.deepEqual(labels(6), ["Pin", "Move tab up", "Create new group", "Unload", "Close tab"],
    "a tab outside the selection acts alone");

  choose(4, "Close selected (5 tabs)");
  choose(4, "Flatten selected (3 tabs)");
  choose(4, "Move tab down");
  await Promise.resolve();
  assert.deepEqual(calls[0], ["close", {
    kind: "tabs",
    tabs: [{ logicalTabId: "tab-1", firefoxTabId: 1 }, { logicalTabId: "tab-4", firefoxTabId: 4 }]
  }]);
  assert.deepEqual(calls[1], ["flatten", [
    { logicalTabId: "tab-1", firefoxTabId: 1 },
    { logicalTabId: "tab-4", firefoxTabId: 4 }
  ]]);
  assert.deepEqual(
    calls[2][1].map(({ tabId }) => tabId),
    ["tab-1", "tab-2", "tab-3", "tab-4", "tab-5"],
    "the move carries both selected trees"
  );
  assert.equal(calls[2][2].anchorTabId, "tab-6");
});

test("Move to container follows container availability and takes the selected tabs only", async () => {
  let available = false;
  const { pane, calls, labels, choose, toggleSelection } = menuPane({
    canMoveToContainer: () => available
  });
  pane.render(view(TREE_ROWS()));
  assert.equal(labels(1).includes("Move to container…"), false);

  available = true;
  toggleSelection(1);
  toggleSelection(6);
  assert.deepEqual(labels(1), [
    "Pin", "Move tab down", "Create new group", "Move to container…", "Unload",
    "Flatten selected (2 tabs)", "Close selected (4 tabs)"
  ]);
  choose(1, "Move to container…");
  await Promise.resolve();
  assert.deepEqual(calls[0][0], "moveToContainer");
  assert.deepEqual(calls[0][1].map(({ logicalId }) => logicalId), ["tab-1", "tab-6"]);
});

test("Split View rows keep the restricted menu, and trees holding them cannot move", () => {
  const { pane, labels } = menuPane({ canMoveToContainer: () => true });
  pane.render(view([
    row(1),
    row(2, { splitViewId: "split-one", splitPosition: "start", parentTabId: "tab-1", depth: 1 }),
    row(3, { splitViewId: "split-one", splitPosition: "end", parentTabId: "tab-2", depth: 2 }),
    row(4)
  ]));
  assert.deepEqual(
    labels(2),
    ["Unload", "Flatten branch (2 tabs)", "Move to container…", "Close branch (2 tabs)"]
  );
  assert.deepEqual(
    labels(1),
    ["Pin", "Move to container…", "Unload", "Flatten branch (3 tabs)", "Close branch (3 tabs)"],
    "a tree holding a split pane offers no move or group"
  );
  assert.deepEqual(
    labels(4),
    ["Pin", "Move tab up", "Create new group", "Move to container…", "Unload", "Close tab"]
  );
});

test("a row is rebuilt when its tree position or loaded state changes", () => {
  const { pane, rows } = createPane();
  pane.render(view([row(1), row(2), row(3)]));
  const [first, second, third] = rows();

  pane.render(view([
    row(1),
    row(2, { parentTabId: "tab-1", depth: 1 }),
    row(3, { discarded: true })
  ]));

  const [nextFirst, nextSecond, nextThird] = rows();
  assert.notEqual(nextFirst, first, "a new child changes the parent's disclosure");
  assert.notEqual(nextSecond, second);
  assert.notEqual(nextThird, third);
  assert.equal(nextFirst.children[0].disabled, false);
});

test("a background render keeps an open tab menu while its structure is unchanged", () => {
  const root = element(document, "div");
  document.body.append(root);
  const commandMenu = element(document, "div");
  commandMenu.hidden = true;
  commandMenu.querySelector = () => null;
  const noop = async () => undefined;
  const pane = createTabPane({
    root,
    commandMenu,
    onActivate: noop,
    onRelocateTabs: noop,
    onRelocateGroup: noop,
    onRenameGroup: noop,
    onDeleteGroup: noop,
    onCreateGroup: noop,
    onUnloadTabs: noop,
    onFlattenBranch: noop,
    onCloseTarget: noop,
    onAcceptNativeDrop: () => false,
    onRelocateNativeSelection: () => false,
    onCancelNativeDrop: () => undefined,
    onSetTreeCollapsed: noop,
    onSetGroupCollapsed: noop
  });
  const openOn = (id) => {
    const target = root.querySelectorAll(".tab-row").find(
      (node) => node.dataset.tabId === `tab-${id}`
    );
    target.dispatchEvent({ type: "contextmenu", preventDefault() {}, stopPropagation() {}, target });
  };

  pane.render(view([row(1), row(2), row(3)]));
  openOn(2);
  assert.equal(commandMenu.hidden, false);

  // A title change elsewhere does not change what the menu's commands do.
  pane.render(view([row(1, { title: "Renamed" }), row(2), row(3)]));
  assert.equal(commandMenu.hidden, false, "background churn keeps the open menu");

  // Reordering changes the captured move destinations, so the menu closes.
  pane.render(view([row(2), row(1, { title: "Renamed" }), row(3)]));
  assert.equal(commandMenu.hidden, true, "a structural change closes the menu");

  pane.render(view([row(2), row(1, { title: "Renamed" }), row(3)]));
  openOn(3);
  assert.equal(commandMenu.hidden, false);
  pane.render(view([row(2), row(1, { title: "Renamed" })]));
  assert.equal(commandMenu.hidden, true, "a removed target closes its menu");
});

test("Icons Only tiles name their tab on hover and follow a content-mode change", () => {
  let iconsOnly = true;
  const { pane, rows } = createPane({ isIconsOnly: () => iconsOnly });
  pane.render(view([row(1), row(2, { title: "Quarterly report" })]));
  assert.deepEqual(rows().map(({ title }) => title), ["Tab 1", "Quarterly report"]);

  iconsOnly = false;
  pane.render(view([row(1), row(2, { title: "Quarterly report" })]));
  assert.deepEqual(rows().map(({ title }) => title ?? ""), ["", ""]);
});

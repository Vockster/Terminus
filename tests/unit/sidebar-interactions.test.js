import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  addWorkspaceNeedsDivider,
  createdWorkspace,
  createTabSelection,
  destinationForTabRow,
  destinationForWorkspace,
  destinationForZone,
  getViewportMenuPosition,
  groupDestinationForRow,
  groupDestinationForWorkspace,
  groupLoadState,
  groupMembers,
  groupSourceDescriptor,
  shouldToggleTreeFromFavicon,
  tabSourceDescriptor
} from "../../src/sidebar/sidebar-interactions.js";

test("the rail + finds its new workspace and sets itself off unless the rail ends with a divider", () => {
  const before = [{ id: "ws-a" }, { id: "ws-b" }];
  assert.deepEqual(
    createdWorkspace(before, { workspaces: [{ id: "ws-a" }, { id: "ws-new", name: "New workspace" }, { id: "ws-b" }] }),
    { id: "ws-new", name: "New workspace" }
  );
  assert.equal(createdWorkspace(before, { workspaces: before }), null);
  assert.equal(
    createdWorkspace(before, { workspaces: [...before, { id: "ws-c" }, { id: "ws-d" }] }),
    null,
    "an ambiguous result never opens Rename for the wrong workspace"
  );
  assert.equal(addWorkspaceNeedsDivider([{ kind: "workspace", workspaceId: "ws-a" }]), true);
  assert.equal(addWorkspaceNeedsDivider([{ kind: "space", id: "space-1" }]), true);
  assert.equal(addWorkspaceNeedsDivider([{ kind: "divider", id: "divider-1", size: null }]), false);
});

test("the rail + creates without switching, opens Rename, and ignores the rail lock", async () => {
  const sidebarMain = await readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8");
  const create = sidebarMain.slice(
    sidebarMain.indexOf("async function createWorkspaceFromRail()"),
    sidebarMain.indexOf("async function updateWorkspace(")
  );
  assert.match(create, /if \(mutationInFlight \|\| !currentView\) \{\s*return;/);
  assert.match(
    create,
    /type: WORKSPACE_MESSAGE_TYPES\.CREATE,\s*windowId: currentWindowId,\s*workspace: \{ \.\.\.NEW_WORKSPACE_FIELDS \}/
  );
  assert.match(create, /created = createdWorkspace\(previousWorkspaces, response\.state\);/);
  assert.match(create, /await refreshView\(\);\s*openWorkspaceRename\(created\.id, created\);/);
  assert.doesNotMatch(create, /ACTIVATE|activateWorkspace|workspaceReorderingLocked/);

  const item = sidebarMain.slice(
    sidebarMain.indexOf("function renderAddWorkspaceItem("),
    sidebarMain.indexOf("function showView(")
  );
  assert.match(item, /item\.className = "workspace-add-item";/);
  assert.match(item, /button\.setAttribute\("aria-label", "Add workspace"\);/);
  assert.doesNotMatch(item, /draggable|dragover|drop|workspaceReorderingLocked|unloadTarget/);
  assert.match(sidebarMain, /renderAddWorkspaceItem\(view\.state\.rail\)/);
});

test("New tab stays in the footer with no placement logic", async () => {
  const [sidebarMain, html] = await Promise.all([
    readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidebar/index.html", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(sidebarMain, /scheduleNewTabPlacement|ResizeObserver|newTabInlineSlot|newTabDockedSlot|dataset\.newTabDocked/);
  const footer = html.slice(html.indexOf('id="tab-footer"'), html.indexOf("</section>"));
  assert.match(footer, /id="new-workspace-tab"/);
  assert.equal(html.indexOf('id="new-workspace-tab"') > html.indexOf('id="tab-footer"'), true);
});

test("group members follow group order and load state is loaded, partial, or unloaded", () => {
  const tabs = [
    { logicalId: "tab-c", discarded: true },
    { logicalId: "tab-a", discarded: false },
    { logicalId: "tab-b", discarded: true },
    { logicalId: "tab-outside", discarded: false }
  ];
  const group = { id: "group-1", tabIds: ["tab-a", "tab-b", "tab-missing", "tab-c"] };
  const members = groupMembers(group, tabs);
  assert.deepEqual(members.map(({ logicalId }) => logicalId), ["tab-a", "tab-b", "tab-c"]);
  assert.equal(groupLoadState(members), "partial");
  assert.equal(groupLoadState(members.filter(({ discarded }) => discarded)), "unloaded");
  assert.equal(groupLoadState(members.filter(({ discarded }) => !discarded)), "loaded");
  assert.equal(groupLoadState([]), "unloaded");
});

test("only an unmodified Full Labels parent favicon toggles its tab tree", () => {
  const parentFavicon = {
    targetIsFavicon: true,
    iconsOnly: false,
    hasChildren: true,
    pinned: false,
    modified: false
  };

  assert.equal(shouldToggleTreeFromFavicon(parentFavicon), true);
  assert.equal(shouldToggleTreeFromFavicon({ ...parentFavicon, targetIsFavicon: false }), false);
  assert.equal(shouldToggleTreeFromFavicon({ ...parentFavicon, iconsOnly: true }), false);
  assert.equal(shouldToggleTreeFromFavicon({ ...parentFavicon, hasChildren: false }), false);
  assert.equal(shouldToggleTreeFromFavicon({ ...parentFavicon, pinned: true }), false);
  assert.equal(shouldToggleTreeFromFavicon({ ...parentFavicon, modified: true }), false);
});

const rows = ["tab-a", "tab-b", "tab-c", "tab-d"].map((logicalId, index) => ({
  logicalId,
  firefoxId: index + 1,
  workspaceId: "ws-work",
  pinned: false,
  groupId: null,
  parentTabId: null
}));

test("ephemeral selection supports replace, toggle, range, and workspace reset", () => {
  const selection = createTabSelection();
  const ids = rows.map(({ logicalId }) => logicalId);
  selection.reset("ws-work");
  assert.deepEqual([...selection.update("tab-b", ids)], ["tab-b"]);
  assert.deepEqual([...selection.update("tab-d", ids, { range: true })], ["tab-b", "tab-c", "tab-d"]);
  assert.deepEqual([...selection.update("tab-c", ids, { toggle: true })], ["tab-b", "tab-d"]);
  assert.deepEqual(selection.ordered(rows, "tab-d").map(({ logicalId }) => logicalId), ["tab-b", "tab-d"]);
  assert.deepEqual(selection.ordered(rows, "tab-a").map(({ logicalId }) => logicalId), ["tab-a"]);
  assert.deepEqual([...selection.reset("ws-personal")], []);
});

test("tab and group interaction descriptors are exact semantic intents", () => {
  const grouped = { ...rows[1], groupId: "group-one", parentTabId: "tab-a" };
  assert.deepEqual(tabSourceDescriptor(grouped), {
    tabId: "tab-b",
    workspaceId: "ws-work",
    pinned: false,
    groupId: "group-one",
    parentTabId: "tab-a"
  });
  assert.deepEqual(destinationForTabRow(grouped, "inside"), {
    workspaceId: "ws-work",
    zone: "group",
    relation: "inside",
    anchorTabId: "tab-b",
    groupId: "group-one",
    parentTabId: "tab-b"
  });
  assert.equal(destinationForTabRow({ ...grouped, pinned: true }, "inside"), null);
  assert.deepEqual(destinationForWorkspace("ws-personal", [tabSourceDescriptor(grouped)]), {
    workspaceId: "ws-personal",
    zone: "ungrouped",
    relation: "end",
    anchorTabId: null,
    groupId: null,
    parentTabId: null
  });
  assert.deepEqual(destinationForZone("ws-work", "group", "group-two"), {
    workspaceId: "ws-work",
    zone: "group",
    relation: "end",
    anchorTabId: null,
    groupId: "group-two",
    parentTabId: null
  });
  assert.equal(destinationForZone("ws-work", "group"), null);

  const group = { id: "group-one", tabIds: ["tab-a", "tab-b"] };
  assert.deepEqual(groupSourceDescriptor(group, "ws-work"), {
    groupId: "group-one",
    workspaceId: "ws-work",
    tabIds: ["tab-a", "tab-b"]
  });
  assert.deepEqual(groupDestinationForRow(grouped, "after"), {
    workspaceId: "ws-work",
    relation: "after",
    anchorTabId: "tab-b"
  });
  assert.deepEqual(groupDestinationForWorkspace("ws-personal"), {
    workspaceId: "ws-personal",
    relation: "end",
    anchorTabId: null
  });
});

test("command menus stay inside narrow viewports and move above low anchors", () => {
  assert.deepEqual(
    getViewportMenuPosition(
      { left: 112, right: 140, top: 80, bottom: 108 },
      { width: 208, height: 180 },
      { width: 146, height: 330 }
    ),
    { left: 4, top: 110 }
  );
  assert.deepEqual(
    getViewportMenuPosition(
      { left: 190, right: 220, top: 280, bottom: 310 },
      { width: 160, height: 180 },
      { width: 230, height: 330 }
    ),
    { left: 60, top: 98 }
  );
});

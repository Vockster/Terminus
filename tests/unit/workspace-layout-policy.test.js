import test from "node:test";
import assert from "node:assert/strict";

import {
  captureWorkspaceLayout,
  deleteLogicalGroup,
  descendantClosure,
  ensureWorkspaceLayout,
  expandLogicalSplitTabIds,
  flattenLogicalTreeBranch,
  isDescendantClosed,
  mergeLogicalWorkspace,
  moveLogicalGroup,
  moveLogicalTab,
  orderedMaterializedTabIds,
  relocateLogicalGroup,
  relocateLogicalSelection,
  relocateLogicalTabs,
  removeTabFromLayouts,
  setLogicalGroupTitle,
  setLogicalTreeParent
} from "../../src/core/workspace-layout-policy.js";

const WORK_ID = "ws-default-work";
const PERSONAL_ID = "ws-default-personal";

function runtimeFixture() {
  return {
    tabs: [
      { id: "tab-a", workspaceId: WORK_ID },
      { id: "tab-b", workspaceId: WORK_ID },
      { id: "tab-c", workspaceId: WORK_ID }
    ],
    windows: [
      {
        workspaceLayouts: [
          {
            workspaceId: WORK_ID,
            tabIds: ["tab-a", "tab-b", "tab-c"],
            pinnedTabIds: ["tab-a"],
            groups: [
              {
                id: "group-one",
                title: "One",
                color: "blue",
                collapsed: false,
                tabIds: ["tab-b", "tab-c"]
              }
            ]
          }
        ]
      }
    ]
  };
}

test("active native layout capture mirrors Firefox pin and group exclusivity", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const result = captureWorkspaceLayout({
    windowRuntime,
    workspaceId: WORK_ID,
    tabs: [
      { id: 3, logicalId: "tab-c", index: 2, pinned: false, groupId: 14, logicalGroupId: "group-one" },
      { id: 1, logicalId: "tab-a", index: 0, pinned: false, groupId: 14, logicalGroupId: "group-one" },
      { id: 2, logicalId: "tab-b", index: 1, pinned: true, groupId: -1, logicalGroupId: null }
    ],
    nativeGroups: new Map([[14, { title: "Native", color: "purple", collapsed: true }]]),
    createGroupId: () => "group-new"
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.layout, {
    workspaceId: WORK_ID,
    tabIds: ["tab-a", "tab-b", "tab-c"],
    pinnedTabIds: ["tab-b"],
    groups: [
      {
        id: "group-one",
        title: "Native",
        color: "purple",
        collapsed: true,
        tabIds: ["tab-a", "tab-c"]
      }
    ],
    tree: [
      { tabId: "tab-a", parentTabId: null, collapsed: false },
      { tabId: "tab-b", parentTabId: null, collapsed: false },
      { tabId: "tab-c", parentTabId: null, collapsed: false }
    ],
    splitViews: []
  });
  assert.deepEqual([...result.sessionGroupByTabId.entries()], [[1, "group-one"], [3, "group-one"]]);
});

test("materialized order keeps pins first and groups contiguous", () => {
  const layout = {
    workspaceId: WORK_ID,
    tabIds: ["tab-u", "tab-g2", "tab-p", "tab-g1"],
    pinnedTabIds: ["tab-p"],
    groups: [
      {
        id: "group-one",
        title: "",
        color: "grey",
        collapsed: false,
        tabIds: ["tab-g1", "tab-g2"]
      }
    ]
  };
  assert.deepEqual(orderedMaterializedTabIds(layout), ["tab-p", "tab-u", "tab-g1", "tab-g2"]);
});

test("tab and whole-group moves preserve pin and group intent", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  ensureWorkspaceLayout(windowRuntime, PERSONAL_ID);

  assert.deepEqual(moveLogicalTab(runtime, windowRuntime, "tab-a", PERSONAL_ID), {
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: PERSONAL_ID,
    logicalTabId: "tab-a",
    sourceGroupId: null,
    pinned: true
  });
  assert.deepEqual(windowRuntime.workspaceLayouts[1].tabIds, ["tab-a"]);
  assert.deepEqual(windowRuntime.workspaceLayouts[1].pinnedTabIds, ["tab-a"]);

  assert.deepEqual(moveLogicalGroup(runtime, windowRuntime, "group-one", PERSONAL_ID), {
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: PERSONAL_ID,
    logicalGroupId: "group-one",
    memberTabIds: ["tab-b", "tab-c"]
  });
  assert.deepEqual(windowRuntime.workspaceLayouts[1].tabIds, ["tab-a", "tab-b", "tab-c"]);
  assert.deepEqual(windowRuntime.workspaceLayouts[1].groups[0].tabIds, ["tab-b", "tab-c"]);
  assert.ok(runtime.tabs.every((entry) => entry.workspaceId === PERSONAL_ID));
});

test("workspace merge preserves layouts and moves active selection to the destination", () => {
  const runtime = {
    tabs: [
      { id: "tab-a", workspaceId: WORK_ID },
      { id: "tab-b", workspaceId: WORK_ID },
      { id: "tab-c", workspaceId: PERSONAL_ID },
      { id: "tab-d", workspaceId: WORK_ID },
      { id: "tab-e", workspaceId: PERSONAL_ID }
    ],
    windows: [{
      activeWorkspaceId: WORK_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-b" },
        { workspaceId: PERSONAL_ID, tabId: "tab-c" }
      ],
      workspaceLayouts: [
        {
          workspaceId: PERSONAL_ID,
          tabIds: ["tab-c"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-c", parentTabId: null, collapsed: false }]
        },
        {
          workspaceId: WORK_ID,
          tabIds: ["tab-a", "tab-b"],
          pinnedTabIds: ["tab-a"],
          groups: [{
            id: "group-one",
            title: "One",
            color: "blue",
            collapsed: true,
            tabIds: ["tab-b"]
          }],
          tree: [
            { tabId: "tab-a", parentTabId: null, collapsed: false },
            { tabId: "tab-b", parentTabId: null, collapsed: true }
          ]
        }
      ]
    }, {
      activeWorkspaceId: PERSONAL_ID,
      selectedTabs: [
        { workspaceId: WORK_ID, tabId: "tab-d" },
        { workspaceId: PERSONAL_ID, tabId: "tab-e" }
      ],
      workspaceLayouts: [
        {
          workspaceId: WORK_ID,
          tabIds: ["tab-d"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-d", parentTabId: null, collapsed: false }]
        },
        {
          workspaceId: PERSONAL_ID,
          tabIds: ["tab-e"],
          pinnedTabIds: [],
          groups: [],
          tree: [{ tabId: "tab-e", parentTabId: null, collapsed: false }]
        }
      ]
    }]
  };

  assert.equal(mergeLogicalWorkspace(runtime, WORK_ID, PERSONAL_ID), true);
  assert.ok(runtime.tabs.every(({ workspaceId }) => workspaceId === PERSONAL_ID));
  const windowRuntime = runtime.windows[0];
  assert.equal(windowRuntime.activeWorkspaceId, PERSONAL_ID);
  assert.deepEqual(windowRuntime.selectedTabs, [
    { workspaceId: PERSONAL_ID, tabId: "tab-b" }
  ]);
  assert.deepEqual(windowRuntime.workspaceLayouts, [{
    workspaceId: PERSONAL_ID,
    tabIds: ["tab-c", "tab-a", "tab-b"],
    pinnedTabIds: ["tab-a"],
    groups: [{
      id: "group-one",
      title: "One",
      color: "blue",
      collapsed: true,
      tabIds: ["tab-b"]
    }],
    tree: [
      { tabId: "tab-c", parentTabId: null, collapsed: false },
      { tabId: "tab-a", parentTabId: null, collapsed: false },
      { tabId: "tab-b", parentTabId: null, collapsed: true }
    ],
    splitViews: []
  }]);
  const inactiveSourceWindow = runtime.windows[1];
  assert.equal(inactiveSourceWindow.activeWorkspaceId, PERSONAL_ID);
  assert.deepEqual(inactiveSourceWindow.selectedTabs, [
    { workspaceId: PERSONAL_ID, tabId: "tab-e" }
  ]);
  assert.deepEqual(inactiveSourceWindow.workspaceLayouts, [{
    workspaceId: PERSONAL_ID,
    tabIds: ["tab-e", "tab-d"],
    pinnedTabIds: [],
    groups: [],
    tree: [
      { tabId: "tab-e", parentTabId: null, collapsed: false },
      { tabId: "tab-d", parentTabId: null, collapsed: false }
    ],
    splitViews: []
  }]);
});

test("batch relocation preserves moved branches and promotes children left behind", () => {
  const runtime = {
    tabs: ["tab-a", "tab-b", "tab-c", "tab-d"].map((id) => ({ id, workspaceId: WORK_ID })),
    windows: [{
      workspaceLayouts: [{
        workspaceId: WORK_ID,
        tabIds: ["tab-a", "tab-b", "tab-c", "tab-d"],
        pinnedTabIds: [],
        groups: [],
        tree: [
          { tabId: "tab-a", parentTabId: null, collapsed: true },
          { tabId: "tab-b", parentTabId: "tab-a", collapsed: false },
          { tabId: "tab-c", parentTabId: "tab-b", collapsed: false },
          { tabId: "tab-d", parentTabId: null, collapsed: false }
        ]
      }]
    }]
  };
  const windowRuntime = runtime.windows[0];
  assert.ok(relocateLogicalTabs({
    runtime,
    windowRuntime,
    tabIds: ["tab-a", "tab-b"],
    destination: {
      workspaceId: WORK_ID,
      zone: "ungrouped",
      relation: "inside",
      anchorTabId: "tab-d",
      groupId: null,
      parentTabId: "tab-d"
    }
  }));
  const layout = windowRuntime.workspaceLayouts[0];
  assert.deepEqual(layout.tabIds, ["tab-c", "tab-d", "tab-a", "tab-b"]);
  assert.deepEqual(layout.tree, [
    { tabId: "tab-c", parentTabId: null, collapsed: false },
    { tabId: "tab-d", parentTabId: null, collapsed: false },
    { tabId: "tab-a", parentTabId: "tab-d", collapsed: true },
    { tabId: "tab-b", parentTabId: "tab-a", collapsed: false }
  ]);
});

test("dropping multiple selected roots inside a tab nests every root in row order", () => {
  const runtime = {
    tabs: ["tab-target", "tab-a", "tab-b", "tab-child", "tab-left"].map((id) => ({
      id,
      workspaceId: WORK_ID
    })),
    windows: [{
      workspaceLayouts: [{
        workspaceId: WORK_ID,
        tabIds: ["tab-target", "tab-a", "tab-b", "tab-child", "tab-left"],
        pinnedTabIds: [],
        groups: [],
        tree: [
          { tabId: "tab-target", parentTabId: null, collapsed: false },
          { tabId: "tab-a", parentTabId: null, collapsed: true },
          { tabId: "tab-b", parentTabId: null, collapsed: false },
          { tabId: "tab-child", parentTabId: "tab-b", collapsed: false },
          { tabId: "tab-left", parentTabId: "tab-a", collapsed: false }
        ],
        splitViews: []
      }]
    }]
  };

  assert.ok(relocateLogicalTabs({
    runtime,
    windowRuntime: runtime.windows[0],
    tabIds: ["tab-b", "tab-a", "tab-child"],
    destination: {
      workspaceId: WORK_ID,
      zone: "ungrouped",
      relation: "inside",
      anchorTabId: "tab-target",
      groupId: null,
      parentTabId: "tab-target"
    }
  }));

  const layout = runtime.windows[0].workspaceLayouts[0];
  assert.deepEqual(layout.tabIds, ["tab-target", "tab-a", "tab-b", "tab-child", "tab-left"]);
  assert.deepEqual(layout.tree, [
    { tabId: "tab-target", parentTabId: null, collapsed: false },
    { tabId: "tab-a", parentTabId: "tab-target", collapsed: true },
    { tabId: "tab-b", parentTabId: "tab-target", collapsed: false },
    { tabId: "tab-child", parentTabId: "tab-b", collapsed: false },
    { tabId: "tab-left", parentTabId: null, collapsed: false }
  ]);
});

test("dropping a selected root on one of its unselected descendants is rejected atomically", () => {
  const runtime = {
    tabs: ["tab-root", "tab-child", "tab-grandchild", "tab-peer"].map((id) => ({
      id,
      workspaceId: WORK_ID
    })),
    windows: [{
      workspaceLayouts: [{
        workspaceId: WORK_ID,
        tabIds: ["tab-root", "tab-child", "tab-grandchild", "tab-peer"],
        pinnedTabIds: [],
        groups: [],
        tree: [
          { tabId: "tab-root", parentTabId: null, collapsed: false },
          { tabId: "tab-child", parentTabId: "tab-root", collapsed: false },
          { tabId: "tab-grandchild", parentTabId: "tab-child", collapsed: false },
          { tabId: "tab-peer", parentTabId: null, collapsed: false }
        ],
        splitViews: []
      }]
    }]
  };
  const before = structuredClone(runtime);

  assert.equal(relocateLogicalTabs({
    runtime,
    windowRuntime: runtime.windows[0],
    tabIds: ["tab-root"],
    destination: {
      workspaceId: WORK_ID,
      zone: "ungrouped",
      relation: "inside",
      anchorTabId: "tab-grandchild",
      groupId: null,
      parentTabId: "tab-grandchild"
    }
  }), null);
  assert.deepEqual(runtime, before);
});

test("pinning flattens a parent and removal promotes its direct children", () => {
  const runtime = {
    tabs: ["tab-a", "tab-b", "tab-c"].map((id) => ({ id, workspaceId: WORK_ID })),
    windows: [{ workspaceLayouts: [{
      workspaceId: WORK_ID,
      tabIds: ["tab-a", "tab-b", "tab-c"],
      pinnedTabIds: [],
      groups: [],
      tree: [
        { tabId: "tab-a", parentTabId: null, collapsed: true },
        { tabId: "tab-b", parentTabId: "tab-a", collapsed: false },
        { tabId: "tab-c", parentTabId: "tab-a", collapsed: false }
      ]
    }] }]
  };
  const layout = runtime.windows[0].workspaceLayouts[0];
  assert.ok(relocateLogicalTabs({
    runtime,
    windowRuntime: runtime.windows[0],
    tabIds: ["tab-a"],
    destination: {
      workspaceId: WORK_ID,
      zone: "pinned",
      relation: "end",
      anchorTabId: null,
      groupId: null,
      parentTabId: null
    }
  }));
  assert.deepEqual(layout.pinnedTabIds, ["tab-a"]);
  assert.deepEqual(layout.tree.map(({ tabId, parentTabId, collapsed }) => ({ tabId, parentTabId, collapsed })), [
    { tabId: "tab-a", parentTabId: null, collapsed: false },
    { tabId: "tab-b", parentTabId: null, collapsed: false },
    { tabId: "tab-c", parentTabId: null, collapsed: false }
  ]);
  assert.equal(setLogicalTreeParent(layout, "tab-b", "tab-c"), false);
  removeTabFromLayouts(runtime, "tab-a");
  assert.deepEqual(layout.tabIds, ["tab-b", "tab-c"]);
});

test("whole-group placement preserves metadata, member order, and internal tree edges", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  windowRuntime.workspaceLayouts[0].tree = [
    { tabId: "tab-a", parentTabId: null, collapsed: false },
    { tabId: "tab-b", parentTabId: null, collapsed: true },
    { tabId: "tab-c", parentTabId: "tab-b", collapsed: false }
  ];
  ensureWorkspaceLayout(windowRuntime, PERSONAL_ID);
  const result = relocateLogicalGroup({
    runtime,
    windowRuntime,
    groupId: "group-one",
    sourceWorkspaceId: WORK_ID,
    memberTabIds: ["tab-b", "tab-c"],
    destination: { workspaceId: PERSONAL_ID, relation: "end", anchorTabId: null }
  });
  assert.deepEqual(result.memberTabIds, ["tab-b", "tab-c"]);
  const destination = windowRuntime.workspaceLayouts[1];
  assert.deepEqual(destination.groups[0], {
    id: "group-one",
    title: "One",
    color: "blue",
    collapsed: false,
    tabIds: ["tab-b", "tab-c"]
  });
  assert.equal(destination.tree[1].parentTabId, "tab-b");
  assert.equal(runtime.tabs.find(({ id }) => id === "tab-c").workspaceId, PERSONAL_ID);
});

test("deleting a logical group preserves its tabs, ordering, and tree", () => {
  const runtime = runtimeFixture();
  const layout = runtime.windows[0].workspaceLayouts[0];
  layout.tree = [
    { tabId: "tab-a", parentTabId: null, collapsed: false },
    { tabId: "tab-b", parentTabId: null, collapsed: true },
    { tabId: "tab-c", parentTabId: "tab-b", collapsed: false }
  ];

  assert.deepEqual(deleteLogicalGroup(runtime.windows[0], WORK_ID, "group-one"), {
    workspaceId: WORK_ID,
    logicalGroupId: "group-one",
    memberTabIds: ["tab-b", "tab-c"]
  });
  assert.deepEqual(layout.groups, []);
  assert.deepEqual(layout.tabIds, ["tab-a", "tab-b", "tab-c"]);
  assert.deepEqual(layout.tree, [
    { tabId: "tab-a", parentTabId: null, collapsed: false },
    { tabId: "tab-b", parentTabId: null, collapsed: true },
    { tabId: "tab-c", parentTabId: "tab-b", collapsed: false }
  ]);
});

test("renaming a logical group changes only its bounded presentation title", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const group = windowRuntime.workspaceLayouts[0].groups[0];

  assert.equal(setLogicalGroupTitle(windowRuntime, "group-one", "Renamed"), true);
  assert.equal(group.title, "Renamed");
  assert.equal(setLogicalGroupTitle(windowRuntime, "group-one", ""), true);
  assert.equal(group.title, "");
  assert.equal(setLogicalGroupTitle(windowRuntime, "group-one", "x".repeat(256)), false);
  assert.equal(setLogicalGroupTitle(windowRuntime, "group-one", "bad\nname"), false);
  assert.equal(setLogicalGroupTitle(windowRuntime, "group-missing", "Missing"), false);
  assert.equal(group.title, "");
});

test("whole-group placement reorders locally around top-level tab anchors", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const layout = windowRuntime.workspaceLayouts[0];
  runtime.tabs.push({ id: "tab-d", workspaceId: WORK_ID });
  layout.tabIds.push("tab-d");
  layout.tree = layout.tabIds.map((tabId) => ({ tabId, parentTabId: null, collapsed: false }));
  const result = relocateLogicalGroup({
    runtime,
    windowRuntime,
    groupId: "group-one",
    sourceWorkspaceId: WORK_ID,
    memberTabIds: ["tab-b", "tab-c"],
    destination: { workspaceId: WORK_ID, relation: "after", anchorTabId: "tab-d" }
  });
  assert.ok(result);
  assert.deepEqual(layout.tabIds, ["tab-a", "tab-d", "tab-b", "tab-c"]);
  assert.deepEqual(layout.groups[0].tabIds, ["tab-b", "tab-c"]);
  assert.equal(relocateLogicalGroup({
    runtime,
    windowRuntime,
    groupId: "group-one",
    sourceWorkspaceId: WORK_ID,
    memberTabIds: ["tab-b", "tab-c"],
    destination: { workspaceId: WORK_ID, relation: "before", anchorTabId: "tab-a" }
  }), null);
});

test("mixed native selection preserves pins and complete groups while splitting partial groups", () => {
  const runtime = {
    tabs: ["pin-a", "loose-a", "full-a", "full-b", "part-a", "part-b", "loose-b", "dest-a"]
      .map((suffix) => ({
        id: `tab-${suffix}`,
        workspaceId: suffix === "dest-a" ? PERSONAL_ID : WORK_ID
      })),
    windows: [{
      workspaceLayouts: [{
        workspaceId: WORK_ID,
        tabIds: [
          "tab-pin-a",
          "tab-loose-a",
          "tab-full-a",
          "tab-full-b",
          "tab-part-a",
          "tab-part-b",
          "tab-loose-b"
        ],
        pinnedTabIds: ["tab-pin-a"],
        groups: [{
          id: "group-full",
          title: "Complete",
          color: "purple",
          collapsed: true,
          tabIds: ["tab-full-a", "tab-full-b"]
        }, {
          id: "group-partial",
          title: "Partial",
          color: "orange",
          collapsed: false,
          tabIds: ["tab-part-a", "tab-part-b"]
        }],
        tree: [
          { tabId: "tab-pin-a", parentTabId: null, collapsed: false },
          { tabId: "tab-loose-a", parentTabId: null, collapsed: true },
          { tabId: "tab-full-a", parentTabId: null, collapsed: true },
          { tabId: "tab-full-b", parentTabId: "tab-full-a", collapsed: false },
          { tabId: "tab-part-a", parentTabId: null, collapsed: true },
          { tabId: "tab-part-b", parentTabId: "tab-part-a", collapsed: false },
          { tabId: "tab-loose-b", parentTabId: "tab-loose-a", collapsed: false }
        ]
      }, {
        workspaceId: PERSONAL_ID,
        tabIds: ["tab-dest-a"],
        pinnedTabIds: [],
        groups: [],
        tree: [{ tabId: "tab-dest-a", parentTabId: null, collapsed: false }]
      }]
    }]
  };
  const windowRuntime = runtime.windows[0];

  const result = relocateLogicalSelection({
    runtime,
    windowRuntime,
    tabIds: [
      "tab-part-a",
      "tab-full-b",
      "tab-pin-a",
      "tab-loose-b",
      "tab-full-a",
      "tab-loose-a"
    ],
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: PERSONAL_ID
  });

  assert.deepEqual(result, {
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: PERSONAL_ID,
    tabIds: [
      "tab-pin-a",
      "tab-loose-a",
      "tab-full-a",
      "tab-full-b",
      "tab-part-a",
      "tab-loose-b"
    ],
    pinnedTabIds: ["tab-pin-a"],
    completeGroupIds: ["group-full"]
  });
  assert.deepEqual(windowRuntime.workspaceLayouts[0], {
    workspaceId: WORK_ID,
    tabIds: ["tab-part-b"],
    pinnedTabIds: [],
    groups: [{
      id: "group-partial",
      title: "Partial",
      color: "orange",
      collapsed: false,
      tabIds: ["tab-part-b"]
    }],
    tree: [{ tabId: "tab-part-b", parentTabId: null, collapsed: false }],
    splitViews: []
  });
  assert.deepEqual(windowRuntime.workspaceLayouts[1], {
    workspaceId: PERSONAL_ID,
    tabIds: [
      "tab-pin-a",
      "tab-dest-a",
      "tab-loose-a",
      "tab-full-a",
      "tab-full-b",
      "tab-part-a",
      "tab-loose-b"
    ],
    pinnedTabIds: ["tab-pin-a"],
    groups: [{
      id: "group-full",
      title: "Complete",
      color: "purple",
      collapsed: true,
      tabIds: ["tab-full-a", "tab-full-b"]
    }],
    tree: [
      { tabId: "tab-pin-a", parentTabId: null, collapsed: false },
      { tabId: "tab-dest-a", parentTabId: null, collapsed: false },
      { tabId: "tab-loose-a", parentTabId: null, collapsed: true },
      { tabId: "tab-full-a", parentTabId: null, collapsed: true },
      { tabId: "tab-full-b", parentTabId: "tab-full-a", collapsed: false },
      { tabId: "tab-part-a", parentTabId: null, collapsed: true },
      { tabId: "tab-loose-b", parentTabId: "tab-loose-a", collapsed: false }
    ],
    splitViews: []
  });
  assert.ok(
    runtime.tabs
      .filter(({ id }) => id !== "tab-part-b")
      .every(({ workspaceId }) => workspaceId === PERSONAL_ID)
  );
});

test("native selection relocation is mutation-free for stale or same-workspace input", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const before = structuredClone(runtime);
  assert.equal(relocateLogicalSelection({
    runtime,
    windowRuntime,
    tabIds: ["tab-missing"],
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: PERSONAL_ID
  }), null);
  assert.deepEqual(runtime, before);
  assert.equal(relocateLogicalSelection({
    runtime,
    windowRuntime,
    tabIds: ["tab-a"],
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: WORK_ID
  }), null);
  assert.deepEqual(runtime, before);
});

test("native selection keeps multiple complete groups in source order", () => {
  const sourceIds = ["tab-a", "tab-b", "tab-c", "tab-d", "tab-e"];
  const runtime = {
    tabs: [
      ...sourceIds.map((id) => ({ id, workspaceId: WORK_ID })),
      { id: "tab-target", workspaceId: PERSONAL_ID }
    ],
    windows: [{ workspaceLayouts: [{
      workspaceId: WORK_ID,
      tabIds: sourceIds,
      pinnedTabIds: [],
      groups: [{
        id: "group-one",
        title: "One",
        color: "blue",
        collapsed: false,
        tabIds: ["tab-a", "tab-b"]
      }, {
        id: "group-two",
        title: "Two",
        color: "green",
        collapsed: true,
        tabIds: ["tab-d", "tab-e"]
      }],
      tree: sourceIds.map((tabId) => ({ tabId, parentTabId: null, collapsed: false }))
    }, {
      workspaceId: PERSONAL_ID,
      tabIds: ["tab-target"],
      pinnedTabIds: [],
      groups: [],
      tree: [{ tabId: "tab-target", parentTabId: null, collapsed: false }]
    }] }]
  };

  const result = relocateLogicalSelection({
    runtime,
    windowRuntime: runtime.windows[0],
    tabIds: ["tab-e", "tab-c", "tab-a", "tab-d", "tab-b"],
    sourceWorkspaceId: WORK_ID,
    destinationWorkspaceId: PERSONAL_ID
  });

  assert.deepEqual(result.completeGroupIds, ["group-one", "group-two"]);
  assert.deepEqual(runtime.windows[0].workspaceLayouts[1].tabIds, [
    "tab-target", "tab-a", "tab-b", "tab-c", "tab-d", "tab-e"
  ]);
  assert.deepEqual(
    runtime.windows[0].workspaceLayouts[1].groups.map(({ id }) => id),
    ["group-one", "group-two"]
  );
});

test("native split capture keeps stable identity and atomic relocation keeps pane order", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const source = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  source.pinnedTabIds = [];
  source.groups = [];
  source.splitViews = [{ id: "split-stable", tabIds: ["tab-a", "tab-b"] }];

  const captured = captureWorkspaceLayout({
    windowRuntime,
    workspaceId: WORK_ID,
    tabs: [
      { id: 1, logicalId: "tab-a", index: 0, pinned: false, groupId: -1, splitViewId: 17 },
      { id: 2, logicalId: "tab-b", index: 1, pinned: false, groupId: -1, splitViewId: 17 },
      { id: 3, logicalId: "tab-c", index: 2, pinned: false, groupId: -1, splitViewId: -1 }
    ],
    nativeGroups: new Map(),
    createGroupId: () => "group-unused",
    createSplitViewId: () => "split-new"
  });
  assert.deepEqual(captured.layout.splitViews, [
    { id: "split-stable", tabIds: ["tab-a", "tab-b"] }
  ]);
  assert.deepEqual(expandLogicalSplitTabIds(windowRuntime, ["tab-b"]), ["tab-a", "tab-b"]);
  assert.equal(relocateLogicalTabs({
    runtime,
    windowRuntime,
    tabIds: ["tab-b"],
    destination: {
      workspaceId: PERSONAL_ID,
      zone: "ungrouped",
      relation: "end",
      anchorTabId: null,
      groupId: null,
      parentTabId: null
    }
  }), null);

  assert.ok(relocateLogicalTabs({
    runtime,
    windowRuntime,
    tabIds: ["tab-a", "tab-b"],
    destination: {
      workspaceId: PERSONAL_ID,
      zone: "ungrouped",
      relation: "end",
      anchorTabId: null,
      groupId: null,
      parentTabId: null
    }
  }));
  const destination = ensureWorkspaceLayout(windowRuntime, PERSONAL_ID);
  assert.deepEqual(destination.tabIds, ["tab-a", "tab-b"]);
  assert.deepEqual(destination.splitViews, [
    { id: "split-stable", tabIds: ["tab-a", "tab-b"] }
  ]);
});

test("capture removes logical split metadata after Firefox removes its native wrapper", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const source = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  source.pinnedTabIds = [];
  source.groups = [];
  source.splitViews = [{ id: "split-suspended", tabIds: ["tab-a", "tab-b"] }];

  const captured = captureWorkspaceLayout({
    windowRuntime,
    workspaceId: WORK_ID,
    tabs: [
      { id: 1, logicalId: "tab-a", index: 0, pinned: false, groupId: -1, splitViewId: -1 },
      { id: 2, logicalId: "tab-b", index: 1, pinned: false, groupId: -1, splitViewId: -1 },
      { id: 3, logicalId: "tab-c", index: 2, pinned: false, groupId: -1, splitViewId: -1 }
    ],
    nativeGroups: new Map(),
    createGroupId: () => "group-unused",
    createSplitViewId: () => "split-unused"
  });

  assert.deepEqual(captured.layout.splitViews, []);
});

function splitCaptureTabs(splitViewId) {
  return [
    { id: 1, logicalId: "tab-a", index: 0, pinned: false, groupId: -1, splitViewId: -1 },
    { id: 2, logicalId: "tab-b", index: 1, pinned: false, groupId: -1, splitViewId },
    { id: 3, logicalId: "tab-c", index: 2, pinned: false, groupId: -1, splitViewId }
  ];
}

function captureSplit(windowRuntime, splitViewId) {
  return captureWorkspaceLayout({
    windowRuntime,
    workspaceId: WORK_ID,
    tabs: splitCaptureTabs(splitViewId),
    nativeGroups: new Map(),
    createGroupId: () => "group-unused",
    createSplitViewId: () => "split-new"
  });
}

function treeEdges(layout) {
  return layout.tree.map(({ tabId, parentTabId }) => [tabId, parentTabId]);
}

test("a newly created split view nests its second pane under the first and keeps it after the split ends", () => {
  const windowRuntime = runtimeFixture().windows[0];
  const source = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  source.pinnedTabIds = [];
  source.groups = [];
  source.splitViews = [];

  const created = captureSplit(windowRuntime, 21);
  assert.equal(created.changed, true);
  assert.deepEqual(created.layout.splitViews, [{ id: "split-new", tabIds: ["tab-b", "tab-c"] }]);
  assert.deepEqual(treeEdges(created.layout), [["tab-a", null], ["tab-b", null], ["tab-c", "tab-b"]]);

  assert.equal(captureSplit(windowRuntime, 21).changed, false);

  const ended = captureSplit(windowRuntime, -1);
  assert.deepEqual(ended.layout.splitViews, []);
  assert.deepEqual(treeEdges(ended.layout), [["tab-a", null], ["tab-b", null], ["tab-c", "tab-b"]]);
});

function treeLayout({ tabIds, tree, pinnedTabIds = [], groups = [], splitViews = [] }) {
  return {
    workspaceId: WORK_ID,
    tabIds,
    pinnedTabIds,
    groups,
    splitViews,
    tree: tree.map(([tabId, parentTabId, collapsed = false]) => ({ tabId, parentTabId, collapsed }))
  };
}

test("flattening a root-level branch moves every descendant to the root's level", () => {
  const layout = treeLayout({
    tabIds: ["tab-a", "tab-b", "tab-c", "tab-d", "tab-e"],
    tree: [
      ["tab-a", null, true],
      ["tab-b", "tab-a", true],
      ["tab-c", "tab-b"],
      ["tab-d", "tab-a"],
      ["tab-e", null]
    ]
  });

  assert.deepEqual(flattenLogicalTreeBranch(layout, "tab-a"), {
    rootTabId: "tab-a",
    flattenedTabIds: ["tab-b", "tab-c", "tab-d"]
  });
  assert.deepEqual(layout.tabIds, ["tab-a", "tab-b", "tab-c", "tab-d", "tab-e"]);
  assert.deepEqual(layout.tree, [
    { tabId: "tab-a", parentTabId: null, collapsed: false },
    { tabId: "tab-b", parentTabId: null, collapsed: false },
    { tabId: "tab-c", parentTabId: null, collapsed: false },
    { tabId: "tab-d", parentTabId: null, collapsed: false },
    { tabId: "tab-e", parentTabId: null, collapsed: false }
  ]);
});

test("flattening a nested branch keeps its root under the root's parent", () => {
  const layout = treeLayout({
    tabIds: ["tab-a", "tab-b", "tab-c", "tab-d"],
    tree: [["tab-a", null], ["tab-b", "tab-a"], ["tab-c", "tab-b"], ["tab-d", "tab-c"]]
  });

  flattenLogicalTreeBranch(layout, "tab-b");

  assert.deepEqual(treeEdges(layout), [
    ["tab-a", null],
    ["tab-b", "tab-a"],
    ["tab-c", "tab-a"],
    ["tab-d", "tab-a"]
  ]);
});

test("flattening a branch inside a native group keeps it in that group", () => {
  const groups = [{ id: "group-one", title: "One", color: "blue", collapsed: false, tabIds: ["tab-b", "tab-c"] }];
  const layout = treeLayout({
    tabIds: ["tab-a", "tab-b", "tab-c"],
    groups,
    tree: [["tab-a", null], ["tab-b", null], ["tab-c", "tab-b"]]
  });

  flattenLogicalTreeBranch(layout, "tab-b");

  assert.deepEqual(treeEdges(layout), [["tab-a", null], ["tab-b", null], ["tab-c", null]]);
  assert.deepEqual(layout.groups, groups);
});

test("flattening keeps a nested Split View pair split", () => {
  const splitViews = [{ id: "split-one", tabIds: ["tab-b", "tab-c"] }];
  const layout = treeLayout({
    tabIds: ["tab-a", "tab-b", "tab-c"],
    splitViews,
    tree: [["tab-a", null], ["tab-b", "tab-a"], ["tab-c", "tab-b"]]
  });

  flattenLogicalTreeBranch(layout, "tab-a");

  assert.deepEqual(treeEdges(layout), [["tab-a", null], ["tab-b", null], ["tab-c", null]]);
  assert.deepEqual(layout.splitViews, splitViews);
});

test("flattening a pinned, childless, or unknown tab changes nothing", () => {
  const layout = treeLayout({
    tabIds: ["tab-a", "tab-b", "tab-c"],
    pinnedTabIds: ["tab-a"],
    tree: [["tab-a", null], ["tab-b", null], ["tab-c", "tab-b"]]
  });
  const before = structuredClone(layout);

  assert.equal(flattenLogicalTreeBranch(layout, "tab-a"), null);
  assert.equal(flattenLogicalTreeBranch(layout, "tab-c"), null);
  assert.equal(flattenLogicalTreeBranch(layout, "tab-z"), null);
  assert.deepEqual(layout, before);
});

test("a split view that was already recorded is not nested again", () => {
  const windowRuntime = runtimeFixture().windows[0];
  const source = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  source.pinnedTabIds = [];
  source.groups = [];
  source.splitViews = [{ id: "split-existing", tabIds: ["tab-b", "tab-c"] }];

  const captured = captureSplit(windowRuntime, 21);
  assert.deepEqual(captured.layout.splitViews, [{ id: "split-existing", tabIds: ["tab-b", "tab-c"] }]);
  assert.deepEqual(treeEdges(captured.layout), [["tab-a", null], ["tab-b", null], ["tab-c", null]]);
});

test("a split nesting that tree rules would reject leaves the tree unchanged", () => {
  const windowRuntime = { workspaceLayouts: [] };
  const layout = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  const tabIds = Array.from({ length: 34 }, (_, index) => `tab-${index}`);
  layout.tabIds = tabIds;
  layout.pinnedTabIds = [];
  layout.groups = [];
  layout.splitViews = [];
  // tab-1 through tab-32 form one chain, so tab-32 already sits at the depth limit.
  layout.tree = tabIds.map((tabId, index) => ({
    tabId,
    parentTabId: index >= 1 && index <= 32 ? tabIds[index - 1] : null,
    collapsed: false
  }));
  const before = treeEdges(layout);

  const captured = captureWorkspaceLayout({
    windowRuntime,
    workspaceId: WORK_ID,
    tabs: tabIds.map((logicalId, index) => ({
      id: index + 1,
      logicalId,
      index,
      pinned: false,
      groupId: -1,
      splitViewId: index >= 32 ? 9 : -1
    })),
    nativeGroups: new Map(),
    createGroupId: () => "group-unused",
    createSplitViewId: () => "split-deep"
  });
  assert.deepEqual(captured.layout.splitViews, [{ id: "split-deep", tabIds: ["tab-32", "tab-33"] }]);
  assert.deepEqual(treeEdges(captured.layout), before);
});

test("a split view seen again after it ended is treated as new and nests again", () => {
  const windowRuntime = runtimeFixture().windows[0];
  const source = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  source.pinnedTabIds = [];
  source.groups = [];
  source.splitViews = [];

  captureSplit(windowRuntime, 21);
  const nested = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  nested.tree = nested.tree.map((node) => node.tabId === "tab-c" ? { ...node, parentTabId: null } : node);

  const kept = captureSplit(windowRuntime, 21);
  assert.deepEqual(treeEdges(kept.layout), [["tab-a", null], ["tab-b", null], ["tab-c", null]]);

  const ended = captureSplit(windowRuntime, -1);
  assert.deepEqual(ended.layout.splitViews, []);
  assert.deepEqual(treeEdges(ended.layout), [["tab-a", null], ["tab-b", null], ["tab-c", null]]);

  const returned = captureSplit(windowRuntime, 21);
  assert.equal(returned.changed, true);
  assert.deepEqual(treeEdges(returned.layout), [["tab-a", null], ["tab-b", null], ["tab-c", "tab-b"]]);
});

test("moving a complete group carries its contained split metadata", () => {
  const runtime = runtimeFixture();
  const windowRuntime = runtime.windows[0];
  const source = ensureWorkspaceLayout(windowRuntime, WORK_ID);
  source.pinnedTabIds = [];
  source.splitViews = [{ id: "split-group", tabIds: ["tab-b", "tab-c"] }];

  assert.ok(relocateLogicalGroup({
    runtime,
    windowRuntime,
    groupId: "group-one",
    sourceWorkspaceId: WORK_ID,
    memberTabIds: ["tab-b", "tab-c"],
    destination: { workspaceId: PERSONAL_ID, relation: "end", anchorTabId: null }
  }));
  const destination = ensureWorkspaceLayout(windowRuntime, PERSONAL_ID);
  assert.deepEqual(destination.groups[0].tabIds, ["tab-b", "tab-c"]);
  assert.deepEqual(destination.splitViews, [
    { id: "split-group", tabIds: ["tab-b", "tab-c"] }
  ]);
});

// Layout written as rows: "a" is a root, "a1<a" nests a1 under a, and
// "[g:x y]" is a native group g holding rows x and y.
function treeRuntime(rows) {
  const tabIds = [];
  const tree = [];
  const groups = [];
  for (const token of rows) {
    const groupMatch = /^\[(\w+):(.*)\]$/.exec(token);
    const members = groupMatch ? groupMatch[2].split(" ") : [token];
    const groupTabIds = [];
    for (const member of members) {
      const [name, parent] = member.split("<");
      tabIds.push(`tab-${name}`);
      groupTabIds.push(`tab-${name}`);
      tree.push({ tabId: `tab-${name}`, parentTabId: parent ? `tab-${parent}` : null, collapsed: false });
    }
    if (groupMatch) {
      groups.push({ id: `group-${groupMatch[1]}`, title: "", color: "grey", collapsed: false, tabIds: groupTabIds });
    }
  }
  return {
    tabs: tabIds.map((id) => ({ id, workspaceId: WORK_ID })),
    windows: [{ workspaceLayouts: [{
      workspaceId: WORK_ID,
      tabIds,
      pinnedTabIds: [],
      groups,
      tree,
      splitViews: []
    }] }]
  };
}

function layoutRows(runtime) {
  const layout = runtime.windows[0].workspaceLayouts[0];
  const parentById = new Map(layout.tree.map((node) => [node.tabId, node.parentTabId]));
  const groupById = new Map(layout.groups.flatMap((group) => group.tabIds.map((tabId) => [tabId, group.id])));
  return layout.tabIds.map((tabId) => {
    const name = tabId.slice(4);
    const parent = parentById.get(tabId);
    const group = groupById.get(tabId);
    return `${group ? `${group.slice(6)}:` : ""}${name}${parent ? `<${parent.slice(4)}` : ""}`;
  });
}

function relocate(runtime, tabIds, destination) {
  return relocateLogicalTabs({
    runtime,
    windowRuntime: runtime.windows[0],
    tabIds: tabIds.map((name) => `tab-${name}`),
    destination: {
      workspaceId: WORK_ID,
      zone: "ungrouped",
      groupId: null,
      parentTabId: null,
      ...destination,
      anchorTabId: destination.anchorTabId === null ? null : `tab-${destination.anchorTabId}`
    }
  });
}

test("a descendant closure adds every nested tab in layout order and closure is checked per edge", () => {
  const runtime = treeRuntime(["a", "a1<a", "a2<a1", "b", "b1<b", "c"]);
  const layout = runtime.windows[0].workspaceLayouts[0];

  assert.deepEqual(descendantClosure(layout, ["tab-b", "tab-a"]), [
    "tab-a", "tab-a1", "tab-a2", "tab-b", "tab-b1"
  ]);
  assert.deepEqual(descendantClosure(layout, ["tab-a1"]), ["tab-a1", "tab-a2"]);
  assert.deepEqual(descendantClosure(layout, ["tab-missing"]), []);
  assert.equal(isDescendantClosed(layout, ["tab-a", "tab-a1", "tab-a2", "tab-c"]), true);
  assert.equal(isDescendantClosed(layout, ["tab-a", "tab-a1"]), false);
  assert.equal(isDescendantClosed(layout, ["tab-a2"]), true);
});

test("an ungrouped move may anchor just outside a native group but never inside it", () => {
  const leaveUp = treeRuntime(["x", "[g:g1 g2 g3]", "y"]);
  assert.ok(relocate(leaveUp, ["g1"], { relation: "before", anchorTabId: "g2" }));
  assert.deepEqual(layoutRows(leaveUp), ["x", "g1", "g:g2", "g:g3", "y"]);

  const leaveDown = treeRuntime(["x", "[g:g1 g2 g3]", "y"]);
  assert.ok(relocate(leaveDown, ["g3"], { relation: "after", anchorTabId: "g2" }));
  assert.deepEqual(layoutRows(leaveDown), ["x", "g:g1", "g:g2", "g3", "y"]);

  const stepPast = treeRuntime(["x", "x1<x", "[g:g1 g2]", "y"]);
  assert.ok(relocate(stepPast, ["x", "x1"], { relation: "after", anchorTabId: "g2" }));
  assert.deepEqual(layoutRows(stepPast), ["g:g1", "g:g2", "x", "x1<x", "y"]);

  const stepBack = treeRuntime(["x", "[g:g1 g2]", "y", "y1<y"]);
  assert.ok(relocate(stepBack, ["y", "y1"], { relation: "before", anchorTabId: "g1" }));
  assert.deepEqual(layoutRows(stepBack), ["x", "y", "y1<y", "g:g1", "g:g2"]);

  for (const destination of [
    { relation: "after", anchorTabId: "g1" },
    { relation: "before", anchorTabId: "g2" },
    { relation: "after", anchorTabId: "g2", parentTabId: "tab-x" },
    { relation: "inside", anchorTabId: "g1", parentTabId: "tab-g1" }
  ]) {
    const interior = treeRuntime(["x", "[g:g1 g2]", "y"]);
    const before = structuredClone(interior);
    assert.equal(relocate(interior, ["y"], destination), null, JSON.stringify(destination));
    assert.deepEqual(interior, before);
  }
});

test("moving a branch up past an expanded tree or down past its own child keeps both trees whole", () => {
  const down = treeRuntime(["a", "a1<a", "b", "b1<b", "c"]);
  assert.ok(relocate(down, ["b", "b1"], { relation: "after", anchorTabId: "c" }));
  assert.deepEqual(layoutRows(down), ["a", "a1<a", "c", "b", "b1<b"]);

  const up = treeRuntime(["a", "a1<a", "a2<a", "b", "b1<b"]);
  assert.ok(relocate(up, ["b", "b1"], { relation: "before", anchorTabId: "a" }));
  assert.deepEqual(layoutRows(up), ["b", "b1<b", "a", "a1<a", "a2<a"]);

  const leaveParent = treeRuntime(["p", "r<p", "r1<r", "s<p", "z"]);
  assert.ok(relocate(leaveParent, ["r", "r1"], { relation: "after", anchorTabId: "s" }));
  assert.deepEqual(layoutRows(leaveParent), ["p", "s<p", "r", "r1<r", "z"]);
});

test("group placement refuses anchors that would split a tab tree and accepts branch edges", () => {
  function place(rows, destination) {
    const runtime = treeRuntime(rows);
    const before = structuredClone(runtime);
    const layout = runtime.windows[0].workspaceLayouts[0];
    const group = layout.groups.find(({ id }) => id === "group-g");
    const result = relocateLogicalGroup({
      runtime,
      windowRuntime: runtime.windows[0],
      groupId: "group-g",
      sourceWorkspaceId: WORK_ID,
      memberTabIds: [...group.tabIds],
      destination: { workspaceId: WORK_ID, ...destination, anchorTabId: `tab-${destination.anchorTabId}` }
    });
    if (!result) assert.deepEqual(runtime, before);
    return result ? layoutRows(runtime) : null;
  }

  assert.equal(place(["a", "a1<a", "a2<a", "[g:g1 g2]"], { relation: "before", anchorTabId: "a2" }), null);
  assert.equal(place(["a", "a1<a", "a2<a", "[g:g1 g2]"], { relation: "after", anchorTabId: "a" }), null);
  assert.equal(place(["a", "a1<a", "a11<a1", "a2<a", "[g:g1 g2]"], { relation: "after", anchorTabId: "a11" }), null);
  assert.deepEqual(
    place(["a", "a1<a", "a2<a", "[g:g1 g2]"], { relation: "before", anchorTabId: "a" }),
    ["g:g1", "g:g2", "a", "a1<a", "a2<a"]
  );
  assert.deepEqual(
    place(["[g:g1 g2]", "a", "a1<a", "b"], { relation: "after", anchorTabId: "a1" }),
    ["a", "a1<a", "g:g1", "g:g2", "b"]
  );
  assert.deepEqual(
    place(["[g:g1 g2]", "[h:h1 h2]", "b"], { relation: "after", anchorTabId: "h1" }),
    ["h:h1", "h:h2", "g:g1", "g:g2", "b"]
  );
});

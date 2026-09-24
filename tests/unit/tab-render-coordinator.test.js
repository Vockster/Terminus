import test from "node:test";
import assert from "node:assert/strict";

import { createTabRenderCoordinator } from "../../src/sidebar/tab-render-coordinator.js";

test("one coordinator rebuilds tree/search rows before synchronizing and presenting favicons", () => {
  const calls = [];
  const coordinator = createTabRenderCoordinator({
    tabPane: { render: (view) => calls.push(["tree", view]) },
    searchRoot: { replaceChildren: (...children) => calls.push(["search", ...children]) },
    faviconPresenter: {
      synchronizeLiveTabs: (tabs) => calls.push(["live", tabs]),
      present: (view, windowId) => calls.push(["present", view.activeTabs, windowId])
    },
    getWindowId: () => 7
  });
  const liveTabIdentities = [{ logicalTabId: "tab-one", firefoxTabId: 11 }];
  const activeTabs = [{ logicalId: "tab-one", firefoxId: 11 }];
  const view = { liveTabIdentities, activeTabs };

  coordinator.renderTree(view);
  assert.deepEqual(calls, [
    ["tree", view],
    ["search"],
    ["live", liveTabIdentities],
    ["present", activeTabs, 7]
  ]);

  calls.length = 0;
  const content = { kind: "fragment" };
  coordinator.renderSearch({ content, renderedTabs: activeTabs, liveTabIdentities });
  assert.deepEqual(calls, [
    ["search", content],
    ["live", liveTabIdentities],
    ["present", activeTabs, 7]
  ]);
});

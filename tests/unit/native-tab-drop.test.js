import test from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_FIREFOX_TAB_DRAG_TYPE,
  createNativeTabDropResolver,
  isNativeFirefoxTabDrag
} from "../../src/sidebar/native-tab-drop.js";

function transfer({
  types = [NATIVE_FIREFOX_TAB_DRAG_TYPE],
  items = [{ kind: "string", type: NATIVE_FIREFOX_TAB_DRAG_TYPE }],
  files = []
} = {}) {
  return { types, items, files };
}

function eventSource() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
    size() { return listeners.size; }
  };
}

function harness({ focusedWindowId = 7, highlightedTabs = [] } = {}) {
  const onFocusChanged = eventSource();
  const calls = [];
  const windowTypes = new Map([[7, "normal"], [8, "normal"], [9, "popup"]]);
  const browserApi = {
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged,
      async getLastFocused(options) {
        calls.push(["last-focused", options]);
        return { id: focusedWindowId, type: windowTypes.get(focusedWindowId) };
      },
      async get(windowId) {
        calls.push(["window", windowId]);
        return { id: windowId, type: windowTypes.get(windowId) };
      }
    },
    tabs: {
      async query(query) {
        calls.push(["query", query]);
        return highlightedTabs.map((tab) => ({ ...tab }));
      }
    }
  };
  return {
    browserApi,
    calls,
    onFocusChanged,
    setFocusedWindowId(value) { focusedWindowId = value; },
    setHighlightedTabs(value) { highlightedTabs = value; }
  };
}

const dropContext = {
  activeWorkspaceId: "ws-default-work",
  destinationWorkspaceId: "ws-default-personal",
  activeTabs: [
    { logicalId: "tab-a", firefoxId: 11, workspaceId: "ws-default-work" },
    { logicalId: "tab-b", firefoxId: 12, workspaceId: "ws-default-work" }
  ]
};

test("native tab drag recognition requires the exact protected string-item shape", () => {
  assert.equal(isNativeFirefoxTabDrag(transfer()), true);
  assert.equal(isNativeFirefoxTabDrag(null), false);
  assert.equal(isNativeFirefoxTabDrag(transfer({ types: [] })), false);
  assert.equal(isNativeFirefoxTabDrag(transfer({
    types: [NATIVE_FIREFOX_TAB_DRAG_TYPE, "text/plain"]
  })), false);
  assert.equal(isNativeFirefoxTabDrag(transfer({ items: [] })), false);
  assert.equal(isNativeFirefoxTabDrag(transfer({
    items: [{ kind: "file", type: NATIVE_FIREFOX_TAB_DRAG_TYPE }]
  })), false);
  assert.equal(isNativeFirefoxTabDrag(transfer({ files: [{}] })), false);
});

test("same-window drop resolves every highlighted tab in native order without browsing data", async () => {
  const fixture = harness({
    highlightedTabs: [
      {
        id: 12,
        windowId: 7,
        index: 4,
        highlighted: true,
        title: "Private title",
        url: "https://private.invalid/"
      },
      { id: 11, windowId: 7, index: 1, highlighted: true }
    ]
  });
  const resolver = createNativeTabDropResolver({
    browserApi: fixture.browserApi,
    currentWindowId: 7
  });
  assert.equal(await resolver.initialize(), true);
  assert.equal(resolver.accepts(transfer(), dropContext), true);
  const intent = await resolver.resolveDrop(transfer(), dropContext);
  assert.deepEqual(intent, {
    windowId: 7,
    tabs: [
      { logicalTabId: "tab-a", firefoxTabId: 11 },
      { logicalTabId: "tab-b", firefoxTabId: 12 }
    ],
    destinationWorkspaceId: "ws-default-personal"
  });
  assert.equal(JSON.stringify(intent).includes("private"), false);
  assert.ok(fixture.calls.some(([name, query]) =>
    name === "query" && query.highlighted === true && query.windowId === 7
  ));
  resolver.dispose();
  assert.equal(fixture.onFocusChanged.size(), 0);
});

test("cross-window focus, changed focus, stale mappings, and same destination fail closed", async () => {
  const fixture = harness({
    focusedWindowId: 8,
    highlightedTabs: [{ id: 11, windowId: 7, index: 0, highlighted: true }]
  });
  const resolver = createNativeTabDropResolver({
    browserApi: fixture.browserApi,
    currentWindowId: 7
  });
  assert.equal(await resolver.initialize(), false);
  assert.equal(resolver.accepts(transfer(), dropContext), false);
  resolver.reset();

  fixture.setFocusedWindowId(7);
  fixture.onFocusChanged.emit(7);
  await Promise.resolve();
  assert.equal(resolver.accepts(transfer(), dropContext), true);
  fixture.setFocusedWindowId(8);
  assert.equal(await resolver.resolveDrop(transfer(), dropContext), null);

  resolver.reset();
  fixture.setFocusedWindowId(7);
  fixture.onFocusChanged.emit(fixture.browserApi.windows.WINDOW_ID_NONE);
  await Promise.resolve();
  assert.equal(resolver.accepts(transfer(), dropContext), true);
  resolver.reset();
  assert.equal(await resolver.resolveDrop(transfer(), dropContext), null);

  resolver.reset();
  fixture.setFocusedWindowId(7);
  fixture.onFocusChanged.emit(7);
  await Promise.resolve();
  fixture.setHighlightedTabs([{ id: 99, windowId: 7, index: 0, highlighted: true }]);
  assert.equal(resolver.accepts(transfer(), dropContext), true);
  assert.equal(await resolver.resolveDrop(transfer(), dropContext), null);

  assert.equal(resolver.accepts(transfer(), {
    ...dropContext,
    destinationWorkspaceId: dropContext.activeWorkspaceId
  }), false);
  resolver.dispose();
});

test("resolver rejects changed transfer signatures and duplicate view handles", async () => {
  const fixture = harness({
    highlightedTabs: [{ id: 11, windowId: 7, index: 0, highlighted: true }]
  });
  const resolver = createNativeTabDropResolver({
    browserApi: fixture.browserApi,
    currentWindowId: 7
  });
  await resolver.initialize();
  assert.equal(resolver.accepts(transfer(), dropContext), true);
  assert.equal(resolver.resolveDrop(transfer({ types: ["text/plain"] }), dropContext), null);
  assert.equal(resolver.accepts(transfer(), dropContext), true);
  assert.equal(await resolver.resolveDrop(transfer(), {
    ...dropContext,
    activeTabs: [
      ...dropContext.activeTabs,
      { logicalId: "tab-c", firefoxId: 11, workspaceId: "ws-default-work" }
    ]
  }), null);
  resolver.dispose();
});

test("resolver never treats a non-normal last-focused window as a tab source", async () => {
  const fixture = harness({ focusedWindowId: 9 });
  const resolver = createNativeTabDropResolver({
    browserApi: fixture.browserApi,
    currentWindowId: 7
  });
  assert.equal(await resolver.initialize(), false);
  assert.equal(resolver.accepts(transfer(), dropContext), false);
  resolver.dispose();
});

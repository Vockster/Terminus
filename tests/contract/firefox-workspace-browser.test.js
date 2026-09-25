import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_GROUP_SESSION_KEY,
  WORKSPACE_NOTICE_SESSION_KEY,
  WORKSPACE_TAB_SESSION_KEY,
  WORKSPACE_WINDOW_SESSION_KEY,
  createFirefoxWorkspaceBrowser
} from "../../src/platform/firefox/workspace-browser.js";
import { createFirefoxSnapshotBrowser } from "../../src/platform/firefox/snapshot-browser.js";

test("Firefox browser adapter owns session identity keys and forwards tab mutations", async () => {
  const calls = [];
  const tabValues = new Map([[4, "tab-existing"]]);
  const windowValues = new Map();
  const browserApi = {
    windows: {
      async getAll(options) {
        calls.push(["getAll", options]);
        return [{ id: 7 }, { id: 8 }];
      }
    },
    sessions: {
      async getTabValue(id, key) {
        calls.push(["getTabValue", id, key]);
        return tabValues.get(id);
      },
      async setTabValue(id, key, value) {
        calls.push(["setTabValue", id, key, value]);
        tabValues.set(id, value);
      },
      async getWindowValue(id, key) {
        calls.push(["getWindowValue", id, key]);
        return windowValues.get(id);
      },
      async setWindowValue(id, key, value) {
        calls.push(["setWindowValue", id, key, value]);
        windowValues.set(id, value);
      }
    },
    tabs: {
      async query(query) {
        calls.push(["query", query]);
        return [];
      },
      async create(options) {
        calls.push(["create", options]);
        return { id: 9, cookieStoreId: "firefox-default" };
      },
      async show(ids) {
        calls.push(["show", ids]);
      },
      async update(id, update) {
        calls.push(["update", id, update]);
      },
      async hide(ids) {
        calls.push(["hide", ids]);
        return ids;
      },
      async discard(id) {
        calls.push(["discard", id]);
      },
      async moveInSuccession(ids, anchorId) {
        calls.push(["moveInSuccession", ids, anchorId]);
      }
    }
  };
  const adapter = createFirefoxWorkspaceBrowser(browserApi, () => "generated");

  assert.equal(await adapter.getOrCreateTabIdentity(4), "tab-existing");
  assert.equal(await adapter.getOrCreateWindowIdentity(7), "window-generated");
  await adapter.listTabs(7);
  assert.deepEqual(await adapter.listNormalWindowIds(), [7, 8]);
  await adapter.createTab(7);
  await adapter.showTabs([4]);
  await adapter.activateTab(4);
  await adapter.hideTabs([5]);
  await adapter.discardTab(5);
  await adapter.discardTabs([5, 6]);
  await adapter.moveTabsInSuccession([4, 5], 6);
  assert.equal(adapter.createLogicalSplitViewId(), "split-generated");

  assert.deepEqual(calls, [
    ["getTabValue", 4, WORKSPACE_TAB_SESSION_KEY],
    ["getWindowValue", 7, WORKSPACE_WINDOW_SESSION_KEY],
    ["setWindowValue", 7, WORKSPACE_WINDOW_SESSION_KEY, "window-generated"],
    ["query", { windowId: 7 }],
    ["getAll", { windowTypes: ["normal"] }],
    ["create", { windowId: 7, active: false }],
    ["show", [4]],
    ["update", 4, { active: true }],
    ["hide", [5]],
    ["discard", 5],
    ["discard", [5, 6]],
    ["moveInSuccession", [4, 5], 6]
  ]);
});

test("Firefox browser adapter scope-checks restored identities and settles reloads per tab", async () => {
  const calls = [];
  const tabs = new Map([
    [4, { id: 4, windowId: 7, incognito: false }],
    [5, { id: 5, windowId: 7, incognito: false }],
    [6, { id: 6, windowId: 8, incognito: true }]
  ]);
  const adapter = createFirefoxWorkspaceBrowser({
    sessions: {
      async setTabValue(tabId, key, value) { calls.push(["set", tabId, key, value]); }
    },
    tabs: {
      async get(tabId) { return tabs.get(tabId); },
      async reload(tabId) {
        calls.push(["reload", tabId]);
        if (tabId === 5) throw new Error("reload failed");
      }
    }
  }, undefined, {
    scope: "normal",
    windowScopeRegistry: {
      matches(scope, windowId, incognito) {
        return scope === "normal" && windowId === 7 && incognito === false;
      }
    }
  });

  assert.equal(await adapter.setTabIdentity(4, "tab-restored"), "tab-restored");
  await assert.rejects(adapter.setTabIdentity(6, "tab-private"), TypeError);
  const results = await adapter.reloadTabs([4, 5]);
  assert.deepEqual(results.map(({ status }) => status), ["fulfilled", "rejected"]);
  await assert.rejects(adapter.reloadTabs([4, 4]), TypeError);
  await assert.rejects(adapter.reloadTabs([6]), TypeError);
  assert.deepEqual(calls.map(([kind, id]) => [kind, id]), [
    ["set", 4],
    ["reload", 4],
    ["reload", 5]
  ]);
});

test("Firefox copy creates a fresh adjacent loose tab and cleans up mismatches", async () => {
  const calls = [];
  let sourceUrl = "https://example.com/path";
  let returnedCookieStoreId = "firefox-container-2";
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        return { id: tabId, windowId: 7, index: 3, url: sourceUrl };
      },
      async create(properties) {
        calls.push(["create", properties]);
        return {
          id: 20,
          ...properties,
          cookieStoreId: returnedCookieStoreId,
          pinned: false,
          groupId: -1
        };
      },
      async remove(tabId) { calls.push(["remove", tabId]); }
    }
  });

  const copied = await adapter.copyTab(11, { cookieStoreId: "firefox-container-2" });
  assert.equal(copied.id, 20);
  assert.deepEqual(calls[1], ["create", {
    windowId: 7,
    index: 4,
    active: true,
    url: "https://example.com/path",
    cookieStoreId: "firefox-container-2"
  }]);

  await adapter.copyTab(11, { cookieStoreId: "firefox-container-2", index: 6 });
  assert.equal(calls.at(-1)[1].index, 6);

  returnedCookieStoreId = "firefox-container-wrong";
  await assert.rejects(
    adapter.copyTab(11, { cookieStoreId: "firefox-container-2" }),
    (error) => error.code === "CONTAINER_MISMATCH"
  );
  assert.deepEqual(calls.at(-1), ["remove", 20]);

  sourceUrl = "about:config";
  const createCount = calls.filter(([name]) => name === "create").length;
  await assert.rejects(
    adapter.copyTab(11, { cookieStoreId: null }),
    (error) => error.code === "UNSUPPORTED_URL"
  );
  assert.equal(calls.filter(([name]) => name === "create").length, createCount);
});

test("Firefox page reads are limited to an exact tab set and skip tabs that closed", async () => {
  const calls = [];
  const pages = new Map([
    [4, { id: 4, windowId: 7, url: "https://kept.example/path", title: "t".repeat(5_000), incognito: false }],
    [5, { id: 5, windowId: 7, title: "No address", incognito: false }],
    [6, { id: 6, windowId: 9, url: "https://private.invalid/", title: "Private", incognito: true }]
  ]);
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        if (!pages.has(tabId)) throw new Error("Missing tab");
        return { ...pages.get(tabId) };
      },
      async query() {
        return [...pages.values()].filter(({ incognito }) => incognito !== true);
      }
    }
  }, undefined, {
    windowScopeRegistry: {
      matches(scope, windowId, incognito) {
        return scope === "normal" && incognito === false;
      },
      async resolveMatches(scope, windowId) {
        return scope === "normal" && windowId === 7;
      }
    }
  });

  assert.deepEqual(await adapter.listTabPages([4, 4, 5, 99]), [
    { id: 4, url: "https://kept.example/path", title: "t".repeat(4_096) },
    { id: 5, url: "about:blank", title: "No address" }
  ]);
  assert.deepEqual(calls.filter(([kind]) => kind === "get").map(([, id]) => id), [4, 5, 99]);
  assert.deepEqual(await adapter.listTabPages([]), []);
  assert.deepEqual(await adapter.listTabPages(null), []);
  await assert.rejects(adapter.listTabPages([6]), TypeError, "a private tab stays out of normal reads");

  const listed = await adapter.listTabs(7);
  assert.equal(listed.length, 2);
  assert.ok(listed.every((tab) => !Object.hasOwn(tab, "url")), "inventory still carries no addresses");
});

test("Firefox tab creation requests an unloaded tab only where Firefox allows it", async () => {
  const calls = [];
  let returnedCookieStoreId = "firefox-default";
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async create(properties) {
        calls.push(["create", properties]);
        return { id: 30, ...properties, cookieStoreId: returnedCookieStoreId };
      },
      async remove(tabId) { calls.push(["remove", tabId]); }
    }
  });
  const title = "t".repeat(5_000);

  await adapter.createTab(7, { url: "https://example.com/", discarded: true, title });
  assert.deepEqual(calls.at(-1), ["create", {
    windowId: 7,
    active: false,
    url: "https://example.com/",
    discarded: true,
    title: "t".repeat(4_096)
  }]);
  for (const options of [
    { url: "https://example.com/", discarded: true, active: true, title: "Active" },
    { url: "about:blank", discarded: true, title: "Blank" },
    { discarded: true, title: "No address" },
    { url: "https://example.com/", title: "Loaded" }
  ]) {
    await adapter.createTab(7, options);
    const [, properties] = calls.at(-1);
    assert.equal(Object.hasOwn(properties, "discarded"), false, JSON.stringify(options));
    assert.equal(Object.hasOwn(properties, "title"), false, JSON.stringify(options));
  }
  await adapter.createTab(7, { url: "https://example.com/", discarded: true, title: "" });
  assert.equal(Object.hasOwn(calls.at(-1)[1], "title"), false);

  returnedCookieStoreId = "firefox-container-9";
  await assert.rejects(
    adapter.createTab(7, { url: "https://example.com/", discarded: true, cookieStoreId: "firefox-container-2" }),
    (error) => error.code === "CONTAINER_MISMATCH"
  );
  assert.deepEqual(calls.at(-1), ["remove", 30]);
});

test("Firefox container replacement reopens the source page beside it without returning the address", async () => {
  const calls = [];
  let source = {
    id: 11,
    windowId: 7,
    index: 3,
    url: "https://example.com/path",
    title: "Saved page",
    discarded: true,
    active: false,
    favIconUrl: "https://example.com/icon.png"
  };
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        return { ...source };
      },
      async create(properties) {
        calls.push(["create", properties]);
        return {
          id: 20,
          ...properties,
          cookieStoreId: properties.cookieStoreId ?? "firefox-default",
          favIconUrl: "https://example.com/icon.png"
        };
      },
      async remove(tabId) { calls.push(["remove", tabId]); }
    }
  });

  const replacement = await adapter.createContainerReplacement(11, {
    cookieStoreId: "firefox-container-2"
  });
  assert.deepEqual(calls[1], ["create", {
    windowId: 7,
    active: false,
    index: 4,
    url: "https://example.com/path",
    cookieStoreId: "firefox-container-2",
    discarded: true,
    title: "Saved page"
  }]);
  assert.equal(replacement.id, 20);
  assert.equal(Object.hasOwn(replacement, "url"), false);
  assert.equal(Object.hasOwn(replacement, "favIconUrl"), false);

  source = { ...source, discarded: false, active: true };
  await adapter.createContainerReplacement(11, { cookieStoreId: null });
  assert.equal(Object.hasOwn(calls.at(-1)[1], "discarded"), false);
  assert.equal(Object.hasOwn(calls.at(-1)[1], "cookieStoreId"), false);

  const createCount = calls.filter(([name]) => name === "create").length;
  for (const url of ["about:config", "moz-extension://terminus/page.html", undefined]) {
    source = { ...source, url };
    await assert.rejects(
      adapter.createContainerReplacement(11, { cookieStoreId: null }),
      (error) => error.code === "UNSUPPORTED_URL"
    );
  }
  assert.equal(calls.filter(([name]) => name === "create").length, createCount);
});

test("Firefox copy fails closed when the source closes or the identity disappears", async () => {
  const calls = [];
  let sourceAvailable = false;
  let identityAvailable = true;
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        if (!sourceAvailable) throw new Error("Source tab closed");
        return { id: tabId, windowId: 7, index: 3, url: "https://example.com/" };
      },
      async create(properties) {
        calls.push(["create", properties]);
        if (!identityAvailable) throw new Error("Contextual identity no longer exists");
        return { id: 20, ...properties };
      },
      async remove(tabId) { calls.push(["remove", tabId]); }
    }
  });

  await assert.rejects(
    adapter.copyTab(11, { cookieStoreId: "firefox-container-2" }),
    /Source tab closed/
  );
  assert.equal(calls.some(([name]) => name === "create"), false);
  assert.equal(calls.some(([name]) => name === "remove"), false);

  sourceAvailable = true;
  identityAvailable = false;
  await assert.rejects(
    adapter.copyTab(11, { cookieStoreId: "firefox-container-2" }),
    /Contextual identity no longer exists/
  );
  assert.equal(calls.filter(([name]) => name === "get").length, 2);
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
  assert.equal(calls.some(([name]) => name === "remove"), false);
});

test("Firefox browser adapter owns pin, move, group, and notice call shapes", async () => {
  const calls = [];
  const browserApi = {
    sessions: {
      async getTabValue(id, key) {
        calls.push(["getTabValue", id, key]);
        return key === WORKSPACE_GROUP_SESSION_KEY ? "group-existing" : undefined;
      },
      async setTabValue(id, key, value) {
        calls.push(["setTabValue", id, key, value]);
      },
      async removeTabValue(id, key) {
        calls.push(["removeTabValue", id, key]);
      },
      async getWindowValue(id, key) {
        calls.push(["getWindowValue", id, key]);
        return { kind: "move-tab" };
      },
      async setWindowValue(id, key, value) {
        calls.push(["setWindowValue", id, key, value]);
      },
      async removeWindowValue(id, key) {
        calls.push(["removeWindowValue", id, key]);
      }
    },
    tabs: {
      async get(id) {
        calls.push(["get", id]);
        return { id, splitViewId: -1 };
      },
      async update(id, properties) {
        calls.push(["update", id, properties]);
        return { id, ...properties };
      },
      async move(ids, properties) {
        calls.push(["move", ids, properties]);
        return ids.map((id, index) => ({ id, index: properties.index + index }));
      },
      async group(properties) {
        calls.push(["group", properties]);
        return 19;
      },
      async ungroup(ids) {
        calls.push(["ungroup", ids]);
      }
    },
    tabGroups: {
      async query(query) {
        calls.push(["groupQuery", query]);
        return [{ id: 19 }];
      },
      async get(id) {
        calls.push(["groupGet", id]);
        return { id };
      },
      async update(id, properties) {
        calls.push(["groupUpdate", id, properties]);
        return { id, ...properties };
      },
      async move(id, properties) {
        calls.push(["groupMove", id, properties]);
        return { id, ...properties };
      }
    }
  };
  const adapter = createFirefoxWorkspaceBrowser(browserApi, () => "replacement");

  assert.equal(await adapter.getTabLogicalGroupId(4), "group-existing");
  await adapter.setTabLogicalGroupId(4, "group-alpha");
  await adapter.clearTabLogicalGroupId(4);
  assert.deepEqual(await adapter.getWindowNotice(7), { kind: "move-tab" });
  await adapter.setWindowNotice(7, { kind: "move-group" });
  await adapter.clearWindowNotice(7);
  await adapter.getTab(4);
  await adapter.setTabPinned(4, true);
  assert.deepEqual(await adapter.moveTabs([4, 5], { index: 2, windowId: 7 }), [
    { id: 4, index: 2 },
    { id: 5, index: 3 }
  ]);
  assert.deepEqual(await adapter.separateSplitView([4, 5], 6, { index: 2, windowId: 7 }), [
    { id: 4, index: 2 },
    { id: 6, index: 3 },
    { id: 5, index: 4 }
  ]);
  assert.equal(await adapter.createTabGroup([4, 5], 7), 19);
  assert.equal(await adapter.addTabsToGroup([6], 19), 19);
  await adapter.ungroupTabs([4, 5]);
  assert.deepEqual(await adapter.listTabGroups(7), [{ id: 19 }]);
  assert.deepEqual(await adapter.getTabGroup(19), { id: 19 });
  await adapter.updateTabGroup(19, {
    title: "Focus",
    color: "blue",
    collapsed: false
  });
  await adapter.moveTabGroup(19, { index: 4, windowId: 7 });

  assert.deepEqual(calls, [
    ["getTabValue", 4, WORKSPACE_GROUP_SESSION_KEY],
    ["setTabValue", 4, WORKSPACE_GROUP_SESSION_KEY, "group-alpha"],
    ["removeTabValue", 4, WORKSPACE_GROUP_SESSION_KEY],
    ["getWindowValue", 7, WORKSPACE_NOTICE_SESSION_KEY],
    ["setWindowValue", 7, WORKSPACE_NOTICE_SESSION_KEY, { kind: "move-group" }],
    ["removeWindowValue", 7, WORKSPACE_NOTICE_SESSION_KEY],
    ["get", 4],
    ["update", 4, { pinned: true }],
    ["move", [4, 5], { index: 2, windowId: 7 }],
    ["move", [4, 6, 5], { index: 2, windowId: 7 }],
    ["get", 4],
    ["get", 5],
    ["group", { tabIds: [4, 5], createProperties: { windowId: 7 } }],
    ["group", { tabIds: [6], groupId: 19 }],
    ["ungroup", [4, 5]],
    ["groupQuery", { windowId: 7 }],
    ["groupGet", 19],
    ["groupUpdate", 19, { title: "Focus", color: "blue", collapsed: false }],
    ["groupMove", 19, { index: 4, windowId: 7 }]
  ]);
});

test("Firefox browser adapter bounds display metadata and never returns tab URLs", async () => {
  const unsafe = {
    id: 4,
    windowId: 7,
    index: 2,
    highlighted: true,
    pinned: true,
    groupId: -1,
    title: "x".repeat(5000),
    favIconUrl: "javascript:alert(1)",
    url: "https://private.invalid/path"
  };
  const safe = {
    id: 5,
    windowId: 7,
    index: 3,
    highlighted: false,
    pinned: false,
    groupId: 19,
    title: "Safe",
    favIconUrl: "https://example.invalid/favicon.ico",
    url: "https://also-private.invalid/"
  };
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async query() { return [unsafe, safe]; },
      async get() { return unsafe; }
    }
  });
  const listed = await adapter.listTabs(7);
  assert.equal(listed[0].title.length, 4096);
  assert.equal(Object.hasOwn(listed[0], "favIconUrl"), false);
  assert.equal(Object.hasOwn(listed[1], "favIconUrl"), false);
  assert.deepEqual(
    listed.map(({ id, windowId, index, highlighted, pinned, groupId }) => ({
      id,
      windowId,
      index,
      highlighted,
      pinned,
      groupId
    })),
    [unsafe, safe].map(({ id, windowId, index, highlighted, pinned, groupId }) => ({
      id,
      windowId,
      index,
      highlighted,
      pinned,
      groupId
    }))
  );
  assert.equal(Object.hasOwn(listed[0], "url"), false);
  assert.equal(Object.hasOwn(await adapter.getTab(4), "url"), false);
  assert.equal(Object.hasOwn(await adapter.getTab(4), "favIconUrl"), false);
});

test("Firefox browser adapter rejects split separation until both members report ordinary state", async () => {
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async move(ids, properties) {
        return ids.map((id, offset) => ({ id, index: properties.index + offset }));
      },
      async get(id) {
        return { id, splitViewId: 42 };
      }
    }
  });

  await assert.rejects(
    () => adapter.separateSplitView([4, 5], [6], { index: 2, windowId: 7 }),
    /did not separate/
  );
});

test("Firefox browser adapter marks its own settings page without exposing its URL", async () => {
  const settingsUrl = "moz-extension://terminus/src/settings/index.html";
  const settings = {
    id: 6, windowId: 7, index: 1, active: true, highlighted: true, pinned: false,
    groupId: -1, splitViewId: -1, title: "Terminus Settings", url: settingsUrl
  };
  const website = { ...settings, id: 7, index: 2, active: false, title: "Example", url: "https://example.com/" };
  const lookalike = {
    ...settings, id: 8, index: 3, active: false, title: "Other add-on",
    url: "moz-extension://other-addon/src/settings/index.html"
  };
  const adapter = createFirefoxWorkspaceBrowser({
    runtime: { getURL: (path) => `moz-extension://terminus/${path}` },
    tabs: {
      async query() { return [settings, website, lookalike]; },
      async get() { return settings; }
    }
  });

  const listed = await adapter.listTabs(7);
  assert.equal(listed[0].internalPage, "settings");
  assert.equal(Object.hasOwn(listed[1], "internalPage"), false);
  // Another extension's identically named page is not ours.
  assert.equal(Object.hasOwn(listed[2], "internalPage"), false);
  // The flag replaces the address; it never travels beside it.
  for (const tab of listed) {
    assert.equal(Object.hasOwn(tab, "url"), false);
    assert.equal(Object.hasOwn(tab, "favIconUrl"), false);
  }
});

test("Firefox browser adapter lists tabs unflagged when it cannot read its own address", async () => {
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async query() {
        return [{ id: 6, windowId: 7, index: 1, active: true, highlighted: true,
          pinned: false, groupId: -1, splitViewId: -1, title: "Terminus Settings",
          url: "moz-extension://terminus/src/settings/index.html" }];
      },
      async get() { return null; }
    }
  });

  const listed = await adapter.listTabs(7);
  assert.equal(Object.hasOwn(listed[0], "internalPage"), false);
  assert.equal(Object.hasOwn(listed[0], "url"), false);
});

test("Firefox browser adapter marks the transient Split View chooser without exposing its URL", async () => {
  const chooser = {
    id: 6,
    windowId: 7,
    index: 1,
    active: true,
    highlighted: true,
    pinned: false,
    groupId: -1,
    splitViewId: 23,
    title: "about:opentabs",
    url: "about:blank"
  };
  const ordinary = {
    ...chooser,
    id: 7,
    index: 2,
    active: false,
    highlighted: false,
    splitViewId: -1
  };
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      async query() { return [chooser, ordinary]; },
      async get() { return chooser; }
    }
  });

  const listed = await adapter.listTabs(7);
  assert.equal(listed[0].splitViewChooser, true);
  assert.equal(Object.hasOwn(listed[1], "splitViewChooser"), false);
  assert.equal((await adapter.getTab(6)).splitViewChooser, true);
  assert.equal(Object.hasOwn(listed[0], "url"), false);
});

test("Firefox browser adapter finds, focuses, and opens the exact settings page", async () => {
  const calls = [];
  const settingsUrl = "moz-extension://sidebars/src/settings/index.html";
  const adapter = createFirefoxWorkspaceBrowser({
    runtime: {
      getURL(path) {
        calls.push(["getURL", path]);
        return settingsUrl;
      },
      async openOptionsPage() {
        calls.push(["openOptionsPage"]);
      }
    },
    tabs: {
      async query(query) {
        calls.push(["query", query]);
        return [
          {
            id: 9,
            windowId: 8,
            title: "Terminus Settings",
            url: settingsUrl
          },
          {
            id: 10,
            windowId: 8,
            title: "Unrelated",
            url: "https://private.invalid/"
          }
        ];
      }
    },
    windows: {
      async update(windowId, changes) {
        calls.push(["windowUpdate", windowId, changes]);
      }
    }
  });

  assert.deepEqual(await adapter.listSettingsTabs(), [{
    id: 9,
    windowId: 8,
    title: "Terminus Settings"
  }]);
  await adapter.focusWindow(8);
  await adapter.openSettingsPage();
  assert.deepEqual(calls, [
    ["getURL", "src/settings/index.html"],
    ["query", { url: settingsUrl }],
    ["windowUpdate", 8, { focused: true }],
    ["openOptionsPage"]
  ]);
});

function createEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(...args) {
      for (const listener of listeners) {
        listener(...args);
      }
    },
    size() {
      return listeners.size;
    }
  };
}

test("Firefox browser adapter synchronously normalizes workspace lifecycle events", async () => {
  const tabEvents = {
    onCreated: createEvent(),
    onRemoved: createEvent(),
    onAttached: createEvent(),
    onDetached: createEvent(),
    onMoved: createEvent(),
    onActivated: createEvent(),
    onUpdated: createEvent(),
    onReplaced: createEvent()
  };
  const groupEvents = {
    onCreated: createEvent(),
    onUpdated: createEvent(),
    onMoved: createEvent(),
    onRemoved: createEvent()
  };
  const windowEvents = { onCreated: createEvent(), onRemoved: createEvent() };
  const browserApi = {
    tabs: {
      ...tabEvents,
      async get(tabId) {
        return { id: tabId, windowId: 8 };
      }
    },
    tabGroups: groupEvents,
    windows: windowEvents
  };
  const events = [];
  const adapter = createFirefoxWorkspaceBrowser(browserApi);
  const unsubscribe = adapter.subscribeWorkspaceEvents((event) => events.push(event));

  assert.equal(tabEvents.onCreated.size(), 1);
  tabEvents.onCreated.emit({ id: 4, windowId: 7, openerTabId: 3 });
  tabEvents.onMoved.emit(4, { windowId: 7 });
  tabEvents.onRemoved.emit(6, { windowId: 7, isWindowClosing: true });
  tabEvents.onUpdated.emit(4, { title: "ignored" }, { id: 4, windowId: 7 });
  tabEvents.onUpdated.emit(4, { pinned: true, title: "ignored" }, { id: 4, windowId: 7 });
  tabEvents.onUpdated.emit(4, {
    active: true,
    discarded: true,
    hidden: true,
    sharingState: { camera: true }
  }, { id: 4, windowId: 7 });
  tabEvents.onUpdated.emit(4, { splitViewId: 9 }, { id: 4, windowId: 7 });
  groupEvents.onUpdated.emit({ id: 12, windowId: 7 });
  windowEvents.onRemoved.emit(9);
  tabEvents.onReplaced.emit(5, 4);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(events, [
    { kind: "tab-created", windowIds: [7], tabId: 4, openerTabId: 3, generation: 1 },
    { kind: "tab-moved", windowIds: [7], tabId: 4 },
    { kind: "tab-removed", windowIds: [7], tabId: 6, isWindowClosing: true, generation: 2 },
    { kind: "tab-updated", windowIds: [7], tabId: 4, changed: ["title"] },
    { kind: "tab-updated", windowIds: [7], tabId: 4, changed: ["pinned", "title"] },
    {
      kind: "tab-updated",
      windowIds: [7],
      tabId: 4,
      hidden: true,
      changed: ["active", "discarded", "hidden", "sharingState"]
    },
    { kind: "tab-updated", windowIds: [7], tabId: 4, changed: ["splitViewId"] },
    { kind: "group-updated", windowIds: [7], groupId: 12 },
    { kind: "window-removed", windowIds: [9] },
    { kind: "tab-replaced", windowIds: [8], tabId: 5, replacedTabId: 4, generation: 2 }
  ]);

  unsubscribe();
  assert.equal(tabEvents.onCreated.size(), 0);
});

test("Firefox browser adapter suppresses a removed tab while a query still returns it", async () => {
  const onRemoved = createEvent();
  let rawTabs = [
    { id: 4, windowId: 7, index: 0, active: true, highlighted: true },
    { id: 5, windowId: 7, index: 1, active: false, highlighted: false }
  ];
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      onRemoved,
      async query() {
        return rawTabs;
      }
    }
  });
  const unsubscribe = adapter.subscribeWorkspaceEvents(() => undefined);

  onRemoved.emit(5, { windowId: 7, isWindowClosing: false });
  assert.deepEqual((await adapter.listTabs(7)).map(({ id }) => id), [4]);
  assert.equal(adapter.isTabTombstoned(7, 5), true);

  rawTabs = rawTabs.filter(({ id }) => id !== 5);
  assert.deepEqual((await adapter.listTabs(7)).map(({ id }) => id), [4]);
  assert.equal(adapter.isTabTombstoned(7, 5), false);

  unsubscribe();
});

function cachedIdentityBrowser() {
  const calls = [];
  const values = new Map([
    ["4|tab", "tab-alpha"],
    ["5|tab", "tab-beta"],
    ["5|group", "group-alpha"]
  ]);
  const onRemoved = createEvent();
  const keyName = (key) => key === WORKSPACE_TAB_SESSION_KEY ? "tab" : "group";
  const tabs = [
    { id: 4, windowId: 7, index: 0, incognito: false },
    { id: 5, windowId: 7, index: 1, incognito: false },
    { id: 9, windowId: 8, index: 0, incognito: true }
  ];
  const api = {
    sessions: {
      async getTabValue(id, key) {
        calls.push(["getTabValue", id, keyName(key)]);
        return values.get(`${id}|${keyName(key)}`);
      },
      async setTabValue(id, key, value) {
        calls.push(["setTabValue", id, keyName(key)]);
        values.set(`${id}|${keyName(key)}`, value);
      },
      async removeTabValue(id, key) {
        calls.push(["removeTabValue", id, keyName(key)]);
        values.delete(`${id}|${keyName(key)}`);
      }
    },
    tabs: {
      onRemoved,
      async query({ windowId }) {
        calls.push(["query", windowId]);
        return tabs.filter((tab) => tab.windowId === windowId);
      },
      async get(id) {
        calls.push(["get", id]);
        const tab = tabs.find((entry) => entry.id === id);
        if (!tab) throw new Error("Invalid tab ID");
        return { ...tab };
      },
      async hide(ids) {
        calls.push(["hide", ids]);
        return ids;
      }
    },
    windows: {
      async get(id) {
        return { id, incognito: id === 8 };
      }
    }
  };
  const registry = {
    async resolveMatches(scope, windowId) {
      return scope === (windowId === 8 ? "private" : "normal");
    },
    matches(scope, _windowId, incognito) {
      return scope === (incognito ? "private" : "normal");
    }
  };
  return { api, calls, values, onRemoved, registry };
}

test("Firefox browser adapter reads each listed tab identity from Firefox once", async () => {
  const { api, calls, registry } = cachedIdentityBrowser();
  const adapter = createFirefoxWorkspaceBrowser(api, () => "unused", {
    scope: "normal",
    windowScopeRegistry: registry
  });

  for (let pass = 0; pass < 3; pass += 1) {
    await adapter.listTabs(7);
    assert.equal(await adapter.getOrCreateTabIdentity(4), "tab-alpha");
    assert.equal(await adapter.getOrCreateTabIdentity(5), "tab-beta");
    assert.equal(await adapter.getTabLogicalGroupId(4), null);
    assert.equal(await adapter.getTabLogicalGroupId(5), "group-alpha");
    await adapter.hideTabs([4, 5]);
  }

  assert.deepEqual(calls.filter(([name]) => name === "getTabValue"), [
    ["getTabValue", 4, "tab"],
    ["getTabValue", 5, "tab"],
    ["getTabValue", 4, "group"],
    ["getTabValue", 5, "group"]
  ]);
  assert.equal(calls.some(([name]) => name === "get"), false);
  assert.equal(calls.filter(([name]) => name === "hide").length, 3);
});

test("Firefox browser adapter keeps scope checks exact for cached and unseen tabs", async () => {
  const { api, calls, registry } = cachedIdentityBrowser();
  const normal = createFirefoxWorkspaceBrowser(api, undefined, {
    scope: "normal",
    windowScopeRegistry: registry
  });
  const privateAdapter = createFirefoxWorkspaceBrowser(api, undefined, {
    scope: "private",
    windowScopeRegistry: registry
  });

  await normal.listTabs(7);
  await assert.rejects(privateAdapter.getTabIdentity(4), /outside this workspace scope/);
  await assert.rejects(privateAdapter.hideTabs([5]), /outside this workspace scope/);
  await assert.rejects(normal.getTabIdentity(9), /outside this workspace scope/);
  assert.deepEqual(calls.filter(([name]) => name === "get"), [["get", 9]]);
  await assert.rejects(normal.getTabIdentity(9), /outside this workspace scope/);
  assert.deepEqual(calls.filter(([name]) => name === "get"), [["get", 9]]);
  assert.equal(calls.some(([name]) => name === "getTabValue"), false);
  assert.equal(calls.some(([name]) => name === "hide"), false);
});

test("Firefox browser adapter writes win over slower reads and closed tabs are forgotten", async () => {
  const { api, calls, values, onRemoved, registry } = cachedIdentityBrowser();
  let releaseRead;
  const originalGet = api.sessions.getTabValue;
  api.sessions.getTabValue = async (id, key) => {
    const value = await originalGet(id, key);
    if (id === 4 && key === WORKSPACE_TAB_SESSION_KEY && !releaseRead.used) {
      releaseRead.used = true;
      await releaseRead.promise;
    }
    return value;
  };
  releaseRead = { used: false };
  releaseRead.promise = new Promise((resolve) => { releaseRead.resolve = resolve; });
  const adapter = createFirefoxWorkspaceBrowser(api, () => "fresh", {
    scope: "normal",
    windowScopeRegistry: registry
  });
  const unsubscribe = adapter.subscribeWorkspaceEvents(() => undefined);
  await adapter.listTabs(7);

  const slowRead = adapter.getTabIdentity(4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await adapter.replaceTabIdentity(4), "tab-fresh");
  releaseRead.resolve();
  assert.equal(await slowRead, "tab-alpha");
  assert.equal(await adapter.getTabIdentity(4), "tab-fresh");

  await adapter.setTabLogicalGroupId(4, "group-beta");
  assert.equal(await adapter.getTabLogicalGroupId(4), "group-beta");
  await adapter.clearTabLogicalGroupId(4);
  assert.equal(await adapter.getTabLogicalGroupId(4), null);
  assert.equal(calls.filter(([name, id, key]) => name === "getTabValue" && id === 4 && key === "group").length, 0);

  onRemoved.emit(5, { windowId: 7, isWindowClosing: false });
  values.set("5|tab", "tab-changed-elsewhere");
  const getsBefore = calls.filter(([name]) => name === "get").length;
  assert.equal(await adapter.getTabIdentity(5), "tab-changed-elsewhere");
  assert.equal(calls.filter(([name]) => name === "get").length, getsBefore + 1);
  unsubscribe();
});

test("restored snapshot identities replace any identity the workspace adapter remembered", async () => {
  const { api, registry } = cachedIdentityBrowser();
  const adapter = createFirefoxWorkspaceBrowser(api, undefined, {
    scope: "normal",
    windowScopeRegistry: registry
  });
  const snapshotAdapter = createFirefoxSnapshotBrowser(api, {
    scope: "normal",
    windowScopeRegistry: registry
  });
  await adapter.listTabs(7);
  assert.equal(await adapter.getTabIdentity(4), "tab-alpha");
  assert.equal(await adapter.getTabLogicalGroupId(4), null);

  await snapshotAdapter.setTabIdentity(4, "tab-restored");
  await snapshotAdapter.setTabGroupIdentity(4, "group-restored");

  assert.equal(await adapter.getTabIdentity(4), "tab-restored");
  assert.equal(await adapter.getTabLogicalGroupId(4), "group-restored");
});

test("a window Firefox restores a saved window into has its tabs' saved values read again", async () => {
  const { api, calls, values, registry } = cachedIdentityBrowser();
  const windowValues = new Map([[7, "window-blank"]]);
  api.sessions.getWindowValue = async (id) => windowValues.get(id);
  api.sessions.setWindowValue = async (id, _key, value) => {
    windowValues.set(id, value);
  };
  const adapter = createFirefoxWorkspaceBrowser(api, () => "own", {
    scope: "normal",
    windowScopeRegistry: registry
  });
  await adapter.listTabs(7);
  assert.equal(await adapter.getWindowIdentity(7), "window-blank");
  assert.equal(await adapter.getTabIdentity(4), "tab-alpha");

  // The adapter's own window write is not a restore and keeps cached values.
  assert.equal(await adapter.replaceWindowIdentity(7), "window-own");
  assert.equal(await adapter.getOrCreateWindowIdentity(7), "window-own");
  const readsBefore = calls.filter(([name]) => name === "getTabValue").length;
  assert.equal(await adapter.getTabIdentity(4), "tab-alpha");
  assert.equal(calls.filter(([name]) => name === "getTabValue").length, readsBefore);

  // Firefox restores a saved window into window 7, reusing tab 4 for one of
  // its saved tabs.
  windowValues.set(7, "window-saved");
  values.set("4|tab", "tab-saved");
  assert.equal(await adapter.getTabIdentity(4), "tab-alpha", "nothing has observed the restore yet");
  assert.equal(await adapter.getOrCreateWindowIdentity(7), "window-saved");
  assert.equal(await adapter.getTabIdentity(4), "tab-saved");
});

test("a window whose tabs close with it is no longer listed as open", async () => {
  const onRemoved = createEvent();
  const onActivated = createEvent();
  const onWindowRemoved = createEvent();
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: { onRemoved, onActivated },
    windows: {
      onRemoved: onWindowRemoved,
      async getAll() {
        return [{ id: 7, incognito: false }, { id: 8, incognito: false }];
      }
    }
  });
  const unsubscribe = adapter.subscribeWorkspaceEvents(() => undefined);
  assert.deepEqual(await adapter.listNormalWindowIds(), [7, 8]);

  onRemoved.emit(21, { windowId: 8, isWindowClosing: true });
  assert.deepEqual(await adapter.listNormalWindowIds(), [7], "its remaining tabs are not an inventory");
  onRemoved.emit(11, { windowId: 7, isWindowClosing: false });
  assert.deepEqual(await adapter.listNormalWindowIds(), [7], "an ordinary tab close keeps the window open");

  // A window that still activates a tab did not finish closing.
  onActivated.emit({ tabId: 22, windowId: 8 });
  assert.deepEqual(await adapter.listNormalWindowIds(), [7, 8]);
  unsubscribe();
});

test("Firefox browser adapter returns only reduced search locations for its own scope", async () => {
  const onRemoved = createEvent();
  const queries = [];
  const adapter = createFirefoxWorkspaceBrowser({
    tabs: {
      onRemoved,
      async query(filter) {
        queries.push(filter);
        return [
          { id: 4, windowId: 7, url: "https://user:secret@docs.invalid:8443/guide?token=abc#part" },
          { id: 5, windowId: 7, url: "data:text/html,private" },
          { id: 6, windowId: 7, url: "https://closed.invalid/" }
        ];
      }
    }
  }, undefined, {
    scope: "normal",
    windowScopeRegistry: {
      async resolveMatches(scope, windowId) {
        return scope === "normal" && windowId === 7;
      },
      matches: () => true
    }
  });
  const unsubscribe = adapter.subscribeWorkspaceEvents(() => undefined);
  onRemoved.emit(6, { windowId: 7, isWindowClosing: false });

  assert.deepEqual(await adapter.listTabSearchLocations(7), [
    { id: 4, location: "docs.invalid/guide" },
    { id: 5, location: null }
  ]);
  assert.deepEqual(await adapter.listTabSearchLocations(8), []);
  assert.deepEqual(queries, [{ windowId: 7 }]);
  unsubscribe();
});

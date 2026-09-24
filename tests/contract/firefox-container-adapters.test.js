import test from "node:test";
import assert from "node:assert/strict";

import { createFirefoxContainerBrowser } from "../../src/platform/firefox/container-browser.js";
import { createFirefoxContainerStorage } from "../../src/platform/firefox/container-storage.js";

function eventSource() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    emit(value) { for (const listener of listeners) listener(value); },
    size() { return listeners.size; }
  };
}

test("Firefox container browser checks required and optional permissions and normalizes identities", async () => {
  const createdProperties = [];
  const events = {
    identity: eventSource(),
    identityRemoved: eventSource(),
    permission: eventSource()
  };
  const browser = createFirefoxContainerBrowser({
    contextualIdentities: {
      async query() {
        return [{
          cookieStoreId: "firefox-container-1",
          name: "Work",
          color: "blue",
          icon: "briefcase",
          colorCode: "#37ADFF"
        }];
      },
      async getSupportedColors() {
        return [{ color: "blue", colorCode: "#37ADFF" }];
      },
      async getSupportedIcons() {
        return [{ icon: "briefcase", iconUrl: "resource://usercontext-content/briefcase.svg" }];
      },
      async create(properties) {
        return { cookieStoreId: "firefox-container-2", colorCode: "#37adff", ...properties };
      },
      onCreated: events.identity,
      onUpdated: eventSource(),
      onRemoved: events.identityRemoved
    },
    permissions: {
      async contains({ permissions }) { return permissions.length === 1; },
      onAdded: events.permission,
      onRemoved: eventSource()
    },
    tabs: {
      async get(tabId) { return { id: tabId, incognito: false }; },
      async create(properties) {
        createdProperties.push(properties);
        return { id: 7, cookieStoreId: properties.cookieStoreId ?? "firefox-default" };
      }
    }
  });

  assert.equal(await browser.capability(), "available");
  assert.deepEqual(await browser.list(), [{
    cookieStoreId: "firefox-container-1",
    name: "Work",
    color: "blue",
    icon: "briefcase",
    colorCode: "#37adff"
  }]);
  assert.deepEqual(await browser.supportedOptions(), {
    colors: [{ color: "blue", colorCode: "#37adff" }],
    icons: [{
      icon: "briefcase",
      iconUrl: "resource://usercontext-content/briefcase.svg"
    }]
  });
  await browser.create({ name: "New", color: "blue", icon: "briefcase", colorCode: null });
  await browser.createTab({ windowId: 4, index: 2, cookieStoreId: "firefox-container-1" });
  assert.deepEqual(createdProperties[0], {
    windowId: 4,
    active: true,
    index: 2,
    cookieStoreId: "firefox-container-1"
  });

  const observed = [];
  const unsubscribe = browser.subscribe((event) => { observed.push(event); });
  events.identity.emit();
  events.permission.emit();
  events.identityRemoved.emit({ cookieStoreId: "firefox-container-1" });
  assert.deepEqual(observed, [
    "identity-created",
    "permission-added",
    { kind: "identity-removed", cookieStoreId: "firefox-container-1" }
  ]);
  unsubscribe();
  assert.equal(events.identity.size(), 0);
  assert.equal(events.identityRemoved.size(), 0);
});

test("Firefox container browser rejects malformed supported option records", async () => {
  const adapter = createFirefoxContainerBrowser({
    contextualIdentities: {
      async getSupportedColors() { return ["blue"]; },
      async getSupportedIcons() {
        return [{ icon: "briefcase", iconUrl: "resource://usercontext-content/briefcase.svg" }];
      }
    },
    permissions: {
      async contains() { return true; }
    }
  });

  await assert.rejects(
    adapter.supportedOptions(),
    (error) => error.code === "UNSUPPORTED"
  );
});

test("Firefox container creation maps supported legacy color aliases", async () => {
  const created = [];
  const adapter = createFirefoxContainerBrowser({
    contextualIdentities: {
      async getSupportedColors() {
        return [{ color: "gray", colorCode: "#7f7f7f" }];
      },
      async getSupportedIcons() {
        return [{ icon: "briefcase", iconUrl: "resource://usercontext-content/briefcase.svg" }];
      },
      async create(properties) {
        created.push(properties);
        return {
          cookieStoreId: "firefox-container-legacy",
          colorCode: "#7f7f7f",
          ...properties
        };
      }
    },
    permissions: {
      async contains() { return true; }
    }
  });

  await adapter.create({
    name: "Legacy",
    color: "toolbar",
    icon: "briefcase",
    colorCode: null
  });
  assert.deepEqual(created, [{ name: "Legacy", color: "gray", icon: "briefcase" }]);
});

test("Firefox container storage owns only the local containerState key", async () => {
  const calls = [];
  const storage = createFirefoxContainerStorage({
    storage: {
      local: {
        async get(key) { calls.push(["get", key]); return { containerState: { schemaVersion: 1, bindings: [] } }; },
        async set(value) { calls.push(["set", value]); }
      }
    }
  });
  assert.deepEqual(await storage.read(), { schemaVersion: 1, bindings: [] });
  await storage.write({ schemaVersion: 1, bindings: [] });
  assert.deepEqual(calls, [
    ["get", "containerState"],
    ["set", { containerState: { schemaVersion: 1, bindings: [] } }]
  ]);
});

test("container capability distinguishes unsupported, partial, and private states", async () => {
  assert.equal(
    await createFirefoxContainerBrowser({}).capability(),
    "unsupported"
  );
  const partial = createFirefoxContainerBrowser({
    contextualIdentities: {},
    permissions: {
      async contains({ permissions }) {
        return permissions[0] === "contextualIdentities";
      }
    }
  });
  assert.equal(await partial.capability(), "partial-permission");
  assert.equal(await partial.capability({ privateContext: true }), "private-unavailable");
});

test("container tab creation verifies explicit and No Container results", async () => {
  const removed = [];
  let returnedCookieStoreId = "firefox-default";
  const adapter = createFirefoxContainerBrowser({
    contextualIdentities: {},
    permissions: {
      async contains() { return true; }
    },
    tabs: {
      async create() { return { id: 9, cookieStoreId: returnedCookieStoreId }; },
      async remove(tabId) { removed.push(tabId); }
    }
  });

  assert.equal((await adapter.createTab({ windowId: 4 })).id, 9);
  returnedCookieStoreId = "firefox-container-wrong";
  await assert.rejects(
    adapter.createTab({
      windowId: 4,
      cookieStoreId: "firefox-container-requested"
    }),
    (error) => error.code === "CONTAINER_MISMATCH"
  );
  assert.deepEqual(removed, [9]);
});

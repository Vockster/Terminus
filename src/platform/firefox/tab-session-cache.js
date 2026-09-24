// Firefox never reuses a tab ID within a browser session, a tab never changes
// between private and normal browsing, and extension session values are
// namespaced to the add-on that wrote them. Once every Terminus write goes
// through this cache, a value remembered for a tab ID is therefore exact.
// Without it, every reconcile paid several sequential Firefox round trips per
// open tab, which made the sidebar slower as the whole session grew.
//
// Session restore and closed-tab recovery attach saved values while creating
// a tab, before extensions can observe its new ID. The one exception is a
// window Firefox restores a saved window into: it keeps that window's
// selected tab and gives it a restored tab's values. That restore also
// replaces the window's own saved values, so the workspace adapter calls
// forgetValues() when it sees a window's identity change.
const cachesByBrowser = new WeakMap();

export function sharedTabSessionCache(browserApi) {
  let cache = cachesByBrowser.get(browserApi);
  if (!cache) {
    cache = createTabSessionCache(browserApi);
    cachesByBrowser.set(browserApi, cache);
  }
  return cache;
}

export function createTabSessionCache(browserApi) {
  const valuesByTabId = new Map();
  const incognitoByTabId = new Map();

  function entryFor(tabId) {
    let entry = valuesByTabId.get(tabId);
    if (!entry) {
      entry = { values: new Map(), versions: new Map() };
      valuesByTabId.set(tabId, entry);
    }
    return entry;
  }

  // Any write invalidates reads that started earlier, so a slow read can
  // never overwrite the value a later write stored.
  function advance(tabId, key) {
    const entry = entryFor(tabId);
    entry.versions.set(key, (entry.versions.get(key) ?? 0) + 1);
    entry.values.delete(key);
    return entry;
  }

  return Object.freeze({
    rememberTab(tab) {
      if (Number.isInteger(tab?.id) && typeof tab.incognito === "boolean") {
        incognitoByTabId.set(tab.id, tab.incognito);
      }
    },

    // Returns true or false when this tab's browsing mode was already observed,
    // otherwise undefined so the caller asks Firefox.
    knownIncognito(tabId) {
      return incognitoByTabId.get(tabId);
    },

    async get(tabId, key) {
      const entry = entryFor(tabId);
      if (entry.values.has(key)) {
        return entry.values.get(key);
      }
      const version = entry.versions.get(key) ?? 0;
      const value = await browserApi.sessions.getTabValue(tabId, key);
      const current = valuesByTabId.get(tabId);
      if (current === entry && (entry.versions.get(key) ?? 0) === version) {
        entry.values.set(key, value);
      }
      return value;
    },

    async set(tabId, key, value) {
      const entry = advance(tabId, key);
      const version = entry.versions.get(key);
      await browserApi.sessions.setTabValue(tabId, key, value);
      if (valuesByTabId.get(tabId) === entry && entry.versions.get(key) === version) {
        entry.values.set(key, value);
      }
    },

    async remove(tabId, key) {
      const entry = advance(tabId, key);
      const version = entry.versions.get(key);
      await browserApi.sessions.removeTabValue(tabId, key);
      if (valuesByTabId.get(tabId) === entry && entry.versions.get(key) === version) {
        entry.values.set(key, undefined);
      }
    },

    forget(tabId) {
      valuesByTabId.delete(tabId);
      incognitoByTabId.delete(tabId);
    },

    // Reads and writes still in flight see their entry replaced and store
    // nothing, so the next read comes from Firefox.
    forgetValues() {
      valuesByTabId.clear();
    }
  });
}

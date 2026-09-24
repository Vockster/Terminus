import {
  WORKSPACE_GROUP_SESSION_KEY,
  WORKSPACE_TAB_SESSION_KEY,
  WORKSPACE_WINDOW_SESSION_KEY
} from "./workspace-browser.js";
import { WORKSPACE_SCOPES, parseWorkspaceScope } from "../../contracts/workspace-scope.js";
import { sharedTabSessionCache } from "./tab-session-cache.js";

import { restorableUrl } from "../../core/restorable-url.js";

const MAX_TITLE_LENGTH = 4096;

function captureUrl(tab) {
  for (const value of [tab?.url, tab?.pendingUrl]) {
    if (typeof value === "string" && value.length > 0 && value.length <= 16384) {
      return value;
    }
  }
  return "about:blank";
}

function captureGeometry(window) {
  if (
    !Number.isInteger(window?.left) ||
    !Number.isInteger(window?.top) ||
    !Number.isInteger(window?.width) ||
    !Number.isInteger(window?.height) ||
    window.width < 100 ||
    window.height < 100
  ) {
    return null;
  }
  const state = ["normal", "minimized", "maximized", "fullscreen"].includes(window.state)
    ? window.state
    : "normal";
  return {
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
    state
  };
}

function matchesContainer(tab, cookieStoreId, expectedIncognito) {
  return tab?.cookieStoreId === (
    cookieStoreId ?? (expectedIncognito ? "firefox-private" : "firefox-default")
  );
}

function containerMismatch(message) {
  const error = new TypeError(message);
  error.containerMismatch = true;
  return error;
}

async function createdWindowTab(browserApi, window) {
  if (Array.isArray(window?.tabs)) {
    return window.tabs.find(({ id }) => Number.isInteger(id)) ?? null;
  }
  if (typeof browserApi.tabs?.query === "function" && Number.isInteger(window?.id)) {
    const tabs = await browserApi.tabs.query({ windowId: window.id });
    return tabs.find(({ id }) => Number.isInteger(id)) ?? null;
  }
  return undefined;
}

async function removeCreatedWindow(browserApi, windowId) {
  if (typeof browserApi.windows?.remove === "function" && Number.isInteger(windowId)) {
    await browserApi.windows.remove(windowId).catch(() => undefined);
  }
}

export function createFirefoxSnapshotBrowser(
  browserApi,
  { scope = WORKSPACE_SCOPES.NORMAL, windowScopeRegistry = null } = {}
) {
  const parsedScope = parseWorkspaceScope(scope);
  const expectedIncognito = parsedScope === WORKSPACE_SCOPES.PRIVATE;
  const matchesScope = (value) => expectedIncognito ? value === true : value !== true;
  // Restored identities share the workspace adapter's cache so a later
  // reconcile never serves a value remembered before this write.
  const sessionCache = sharedTabSessionCache(browserApi);

  async function requireWindowScope(windowId) {
    if (!windowScopeRegistry) {
      return null;
    }
    if (!(await windowScopeRegistry.resolveMatches(parsedScope, windowId))) {
      throw new TypeError("Snapshot restore crossed the private-browsing boundary.");
    }
    const window = await browserApi.windows.get(windowId);
    if (!matchesScope(window?.incognito)) {
      throw new TypeError("Snapshot restore crossed the private-browsing boundary.");
    }
    return window;
  }

  async function requireTabScope(tabId) {
    if (!windowScopeRegistry) {
      return null;
    }
    const tab = await browserApi.tabs.get(tabId);
    if (!matchesScope(tab?.incognito)) {
      throw new TypeError("Snapshot restore crossed the private-browsing boundary.");
    }
    return tab;
  }

  async function requireTabIdsScope(tabIds) {
    await Promise.all(tabIds.map((tabId) => requireTabScope(tabId)));
  }

  return Object.freeze({
    async captureWindows(windowIds) {
      const windows = [];
      for (const windowId of windowIds) {
        const [window, tabs] = await Promise.all([
          browserApi.windows.get(windowId),
          browserApi.tabs.query({ windowId })
        ]);
        if (!matchesScope(window?.incognito)) {
          throw new TypeError("Snapshot capture crossed the private-browsing boundary.");
        }
        windows.push({
          firefoxWindowId: windowId,
          geometry: captureGeometry(window),
          tabs: tabs
            .filter((tab) => Number.isInteger(tab?.id))
            .sort((left, right) => left.index - right.index)
            .map((tab) => ({
              firefoxTabId: tab.id,
              url: captureUrl(tab),
              title:
                typeof tab.title === "string"
                  ? tab.title.slice(0, MAX_TITLE_LENGTH)
                  : "Untitled tab",
              active: tab.active === true,
              highlighted: tab.highlighted === true,
              discarded: tab.discarded === true,
              cookieStoreId:
                typeof tab.cookieStoreId === "string" ? tab.cookieStoreId : "firefox-default"
            }))
        });
      }
      return windows;
    },

    prepareUrl(url) {
      return restorableUrl(url);
    },

    async createWindow(url, geometry, { cookieStoreId = null } = {}) {
      const target = restorableUrl(url);
      const createData = {
        url: target.url,
        ...(cookieStoreId === null ? {} : { cookieStoreId })
      };
      if (expectedIncognito) {
        createData.incognito = true;
      }
      if (geometry?.state === "normal") {
        Object.assign(createData, {
          left: geometry.left,
          top: geometry.top,
          width: geometry.width,
          height: geometry.height
        });
      } else if (geometry?.state) {
        createData.state = geometry.state;
      }
      try {
        const window = await browserApi.windows.create(createData);
        if (!matchesScope(window?.incognito)) {
          await removeCreatedWindow(browserApi, window?.id);
          throw containerMismatch("Firefox created a window outside the requested browsing scope.");
        }
        const firstTab = await createdWindowTab(browserApi, window);
        if (firstTab !== undefined && !matchesContainer(firstTab, cookieStoreId, expectedIncognito)) {
          await removeCreatedWindow(browserApi, window?.id);
          throw containerMismatch("Firefox created a window in an unexpected container.");
        }
        return { window, geometryApplied: geometry !== null, urlSupported: target.supported };
      } catch (error) {
        if (!geometry || error?.containerMismatch === true) {
          throw error;
        }
        const fallbackData = {
          url: target.url,
          ...(cookieStoreId === null ? {} : { cookieStoreId })
        };
        if (expectedIncognito) {
          fallbackData.incognito = true;
        }
        const window = await browserApi.windows.create(fallbackData);
        if (!matchesScope(window?.incognito)) {
          await removeCreatedWindow(browserApi, window?.id);
          throw containerMismatch("Firefox created a window outside the requested browsing scope.");
        }
        const firstTab = await createdWindowTab(browserApi, window);
        if (firstTab !== undefined && !matchesContainer(firstTab, cookieStoreId, expectedIncognito)) {
          await removeCreatedWindow(browserApi, window?.id);
          throw containerMismatch("Firefox created a window in an unexpected container.");
        }
        return { window, geometryApplied: false, urlSupported: target.supported };
      }
    },

    async createTab(
      windowId,
      url,
      { index = -1, active = false, cookieStoreId = null, discarded = false, title = null } = {}
    ) {
      await requireWindowScope(windowId);
      const target = restorableUrl(url);
      // Firefox rejects creating an active, pinned, or about: tab unloaded, so
      // those are created normally and reported as loaded.
      const createUnloaded = discarded === true && active !== true && !target.url.startsWith("about:");
      const tab = await browserApi.tabs.create({
        windowId,
        url: target.url,
        active,
        ...(createUnloaded
          ? {
              discarded: true,
              ...(typeof title === "string" && title.length > 0
                ? { title: title.slice(0, MAX_TITLE_LENGTH) }
                : {})
            }
          : {}),
        ...(cookieStoreId === null ? {} : { cookieStoreId }),
        ...(index >= 0 ? { index } : {})
      });
      if (!matchesContainer(tab, cookieStoreId, expectedIncognito)) {
        if (Number.isInteger(tab?.id)) {
          await browserApi.tabs.remove(tab.id).catch(() => undefined);
        }
        throw containerMismatch("Firefox created a tab in an unexpected container.");
      }
      return { tab, urlSupported: target.supported, discarded: createUnloaded };
    },

    async updateTab(tabId, changes) {
      await requireTabScope(tabId);
      return browserApi.tabs.update(tabId, changes);
    },

    async hideTabs(tabIds) {
      if (tabIds.length === 0) return [];
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.hide(tabIds);
    },

    async showTabs(tabIds) {
      if (tabIds.length === 0) return [];
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.show(tabIds);
    },

    async highlightTabs(windowId, indexes) {
      await requireWindowScope(windowId);
      return indexes.length === 0
        ? Promise.resolve(null)
        : browserApi.tabs.highlight({ windowId, tabs: indexes });
    },

    async discardTab(tabId) {
      await requireTabScope(tabId);
      return browserApi.tabs.discard(tabId);
    },

    async removeTabs(tabIds) {
      if (tabIds.length === 0) return undefined;
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.remove(tabIds);
    },

    async removeWindow(windowId) {
      await requireWindowScope(windowId);
      return browserApi.windows.remove(windowId);
    },

    getTab(tabId) {
      return requireTabScope(tabId);
    },

    async listTabs(windowId) {
      await requireWindowScope(windowId);
      return browserApi.tabs.query({ windowId });
    },

    async listNormalWindows() {
      return (await browserApi.windows.getAll({ windowTypes: ["normal"], populate: true }))
        .filter((window) => matchesScope(window.incognito));
    },

    async setTabIdentity(tabId, logicalTabId) {
      await requireTabScope(tabId);
      return sessionCache.set(tabId, WORKSPACE_TAB_SESSION_KEY, logicalTabId);
    },

    async setWindowIdentity(windowId, logicalWindowId) {
      await requireWindowScope(windowId);
      return browserApi.sessions.setWindowValue(windowId, WORKSPACE_WINDOW_SESSION_KEY, logicalWindowId);
    },

    async setTabGroupIdentity(tabId, logicalGroupId) {
      await requireTabScope(tabId);
      return sessionCache.set(tabId, WORKSPACE_GROUP_SESSION_KEY, logicalGroupId);
    },

    async createGroup(tabIds, { windowId, title, color, collapsed }) {
      if (tabIds.length === 0) {
        return null;
      }
      await requireTabIdsScope(tabIds);
      await requireWindowScope(windowId);
      const groupId = await browserApi.tabs.group({ tabIds, createProperties: { windowId } });
      await browserApi.tabGroups.update(groupId, { title, color, collapsed });
      return groupId;
    }
  });
}

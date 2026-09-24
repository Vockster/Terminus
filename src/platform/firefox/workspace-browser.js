import {
  WORKSPACE_SCOPES,
  parseWorkspaceScope,
  workspaceScopeFromIncognito
} from "../../contracts/workspace-scope.js";
import { searchableTabLocation } from "../../contracts/workspace-search.js";
import { restorableUrl } from "../../core/restorable-url.js";
import { sharedTabSessionCache } from "./tab-session-cache.js";
import {
  CONTAINER_ERROR_CODES,
  ContainerError
} from "../../contracts/containers.js";

export const WORKSPACE_TAB_SESSION_KEY = "sidebars.logicalTabId";
export const WORKSPACE_WINDOW_SESSION_KEY = "sidebars.logicalWindowId";
export const WORKSPACE_GROUP_SESSION_KEY = "sidebars.logicalGroupId";
export const WORKSPACE_NOTICE_SESSION_KEY = "sidebars.operationNotice";
export const FIREFOX_TAB_ID_NONE = -1;
export const FIREFOX_SPLIT_VIEW_ID_NONE = -1;

const LOGICAL_ID_PATTERN = /^(tab|window|group|split)-[a-z0-9][a-z0-9-]{0,127}$/;
const RELEVANT_TAB_UPDATE_KEYS = new Set([
  "active",
  "audible",
  "discarded",
  "groupId",
  "hidden",
  "mutedInfo",
  "pinned",
  "sharingState",
  "splitViewId",
  "status",
  "title",
  "url"
]);
const MAX_TAB_TITLE_LENGTH = 4096;

function supportedCopyUrl(value) {
  if (value === "about:blank") return value;
  if (typeof value !== "string" || value.length < 1 || value.length > 65536) {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
  }
  if (!["http:", "https:", "ftp:", "file:"].includes(parsed.protocol)) {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
  }
  return value;
}

function isLogicalId(value, kind) {
  return (
    typeof value === "string" &&
    LOGICAL_ID_PATTERN.test(value) &&
    value.startsWith(`${kind}-`)
  );
}

function normalizedWindowIds(...values) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0))];
}

function normalizedTabs(value) {
  if (Array.isArray(value)) {
    return value.filter((tab) => tab && Number.isInteger(tab.id));
  }
  return value && Number.isInteger(value.id) ? [value] : [];
}

function normalizedTitle(value) {
  return typeof value === "string" ? value.slice(0, MAX_TAB_TITLE_LENGTH) : "Untitled tab";
}

function isSplitViewChooser(tab) {
  if (
    tab?.active !== true ||
    !Number.isInteger(tab.splitViewId) ||
    tab.splitViewId === FIREFOX_SPLIT_VIEW_ID_NONE
  ) {
    return false;
  }
  return (
    tab.url === "about:opentabs" ||
    (tab.url === "about:blank" && tab.title === "about:opentabs")
  );
}

// Terminus' own pages have no website favicon, and the sidebar's icon pipeline
// accepts only http/https sources, so those rows would fall back to a generated
// letter tile. The page is recognised here, at the one boundary that still sees
// a tab address, and reduced to a flag; the address itself never travels on.
function terminusInternalPage(tab, settingsUrl) {
  return typeof settingsUrl === "string" && settingsUrl !== "" && tab.url === settingsUrl
    ? "settings"
    : null;
}

function normalizedTab(tab, settingsUrl = null) {
  if (!tab || !Number.isInteger(tab.id)) {
    return tab;
  }
  const result = {
    ...tab,
    title: normalizedTitle(tab.title)
  };
  if (isSplitViewChooser(tab)) {
    result.splitViewChooser = true;
  }
  const internalPage = terminusInternalPage(tab, settingsUrl);
  if (internalPage) {
    result.internalPage = internalPage;
  }
  delete result.url;
  delete result.favIconUrl;
  return result;
}

export function createFirefoxWorkspaceBrowser(
  browserApi,
  createUuid = () => globalThis.crypto.randomUUID(),
  { scope = WORKSPACE_SCOPES.NORMAL, windowScopeRegistry = null } = {}
) {
  const parsedScope = parseWorkspaceScope(scope);
  const expectedDefaultCookieStoreId = parsedScope === WORKSPACE_SCOPES.PRIVATE
    ? "firefox-private"
    : "firefox-default";
  const lifecycleByWindow = new Map();
  // Windows whose tabs Firefox is removing because the window is closing.
  // Their remaining tabs are no longer a trustworthy inventory, so they are
  // listed as closed at once rather than as open windows losing tabs.
  const closingWindowIds = new Set();
  const knownWindowIdentities = new Map();
  const sessionCache = sharedTabSessionCache(browserApi);
  const getWindowValue = (windowId, key) => browserApi.sessions.getWindowValue(windowId, key);
  const getTabValue = (tabId, key) => sessionCache.get(tabId, key);
  const setTabValue = (tabId, key, value) => sessionCache.set(tabId, key, value);
  const matchesRequestedContainer = (tab, cookieStoreId) =>
    tab?.cookieStoreId === (cookieStoreId ?? expectedDefaultCookieStoreId);

  function lifecycleFor(windowId) {
    let lifecycle = lifecycleByWindow.get(windowId);
    if (!lifecycle) {
      lifecycle = { generation: 0, removedTabIds: new Set() };
      lifecycleByWindow.set(windowId, lifecycle);
    }
    return lifecycle;
  }

  function recordRemovedTab(windowId, tabId) {
    if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) {
      return 0;
    }
    const lifecycle = lifecycleFor(windowId);
    lifecycle.generation += 1;
    lifecycle.removedTabIds.add(tabId);
    sessionCache.forget(tabId);
    return lifecycle.generation;
  }

  function recordPresentTab(windowId, tabId) {
    if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) {
      return 0;
    }
    const lifecycle = lifecycleFor(windowId);
    lifecycle.generation += 1;
    lifecycle.removedTabIds.delete(tabId);
    return lifecycle.generation;
  }

  async function requireWindowScope(windowId) {
    if (!windowScopeRegistry) {
      return;
    }
    const matches = await windowScopeRegistry.resolveMatches(parsedScope, windowId);
    if (!matches) {
      throw new TypeError("The Firefox window is outside this workspace scope.");
    }
  }

  async function requireTabScope(tabId) {
    if (!windowScopeRegistry) {
      return null;
    }
    const tab = await browserApi.tabs.get(tabId);
    sessionCache.rememberTab(tab);
    const matches = windowScopeRegistry.matches(parsedScope, tab.windowId, tab.incognito);
    if (!matches) {
      throw new TypeError("The Firefox tab is outside this workspace scope.");
    }
    return tab;
  }

  // Scope-only check. A tab's browsing mode never changes, so an observed tab
  // needs no Firefox round trip; unseen or closed tabs are still fetched.
  async function assertTabScope(tabId) {
    if (!windowScopeRegistry) {
      return;
    }
    const incognito = sessionCache.knownIncognito(tabId);
    if (incognito === undefined) {
      await requireTabScope(tabId);
      return;
    }
    if (workspaceScopeFromIncognito(incognito) !== parsedScope) {
      throw new TypeError("The Firefox tab is outside this workspace scope.");
    }
  }

  async function requireTabIdsScope(tabIds) {
    await Promise.all(tabIds.map((tabId) => assertTabScope(tabId)));
  }

  function eventWindowIds(values, incognitoHint) {
    const ids = normalizedWindowIds(...values);
    if (!windowScopeRegistry) {
      return parsedScope === WORKSPACE_SCOPES.NORMAL ? ids : [];
    }
    return ids.filter((windowId) =>
      windowScopeRegistry.matches(parsedScope, windowId, incognitoHint)
    );
  }

  function publishScoped(listener, event, incognitoHint) {
    const windowIds = eventWindowIds(event.windowIds, incognitoHint);
    if (windowIds.length === 0) {
      return;
    }
    listener(Object.freeze({ ...event, windowIds: Object.freeze(windowIds) }));
  }

  function createLogicalId(kind) {
    return `${kind}-${createUuid()}`.toLowerCase();
  }

  async function readIdentity(kind, firefoxId, key, getValue) {
    const value = await getValue(firefoxId, key);
    return isLogicalId(value, kind) ? value : null;
  }

  async function getOrCreateIdentity(kind, firefoxId, key, getValue, setValue) {
    const existing = await readIdentity(kind, firefoxId, key, getValue);
    if (existing) {
      return existing;
    }
    const logicalId = createLogicalId(kind);
    await setValue(firefoxId, key, logicalId);
    return logicalId;
  }

  // Only Firefox restoring a saved window into an open one changes that
  // window's saved identity, and the restore can give the window's selected
  // tab another tab's saved values. Remembered tab values are then re-read.
  async function readWindowIdentity(windowId) {
    const logicalId = await readIdentity("window", windowId, WORKSPACE_WINDOW_SESSION_KEY, getWindowValue);
    const known = knownWindowIdentities.get(windowId);
    if (known !== undefined && known !== logicalId) {
      sessionCache.forgetValues();
    }
    if (logicalId) {
      knownWindowIdentities.set(windowId, logicalId);
    } else {
      knownWindowIdentities.delete(windowId);
    }
    return logicalId;
  }

  async function writeWindowIdentity(windowId, logicalId) {
    await browserApi.sessions.setWindowValue(windowId, WORKSPACE_WINDOW_SESSION_KEY, logicalId);
    knownWindowIdentities.set(windowId, logicalId);
    return logicalId;
  }

  function markWindowOpen(windowId) {
    closingWindowIds.delete(windowId);
  }

  function subscribeWorkspaceEvents(listener) {
    const registrations = [];
    const register = (event, handler) => {
      if (!event?.addListener) {
        return;
      }
      event.addListener(handler);
      registrations.push([event, handler]);
    };
    const publish = (event, incognitoHint) => {
      publishScoped(listener, event, incognitoHint);
    };

    register(browserApi.tabs?.onCreated, (tab) => {
      sessionCache.rememberTab(tab);
      markWindowOpen(tab?.windowId);
      const generation = recordPresentTab(tab?.windowId, tab?.id);
      publish({
        kind: "tab-created",
        windowIds: normalizedWindowIds(tab?.windowId),
        tabId: tab?.id,
        openerTabId: tab?.openerTabId,
        generation
      }, tab?.incognito);
    });
    register(browserApi.tabs?.onRemoved, (tabId, removeInfo) => {
      if (removeInfo?.isWindowClosing === true && Number.isInteger(removeInfo.windowId)) {
        closingWindowIds.add(removeInfo.windowId);
      }
      const generation = recordRemovedTab(removeInfo?.windowId, tabId);
      publish({
        kind: "tab-removed",
        windowIds: normalizedWindowIds(removeInfo?.windowId),
        tabId,
        isWindowClosing: removeInfo?.isWindowClosing === true,
        generation
      }, removeInfo?.incognito);
    });
    register(browserApi.tabs?.onAttached, (tabId, attachInfo) => {
      markWindowOpen(attachInfo?.newWindowId);
      const generation = recordPresentTab(attachInfo?.newWindowId, tabId);
      publish({
        kind: "tab-attached",
        windowIds: normalizedWindowIds(attachInfo?.newWindowId),
        tabId,
        generation
      }, attachInfo?.incognito);
    });
    register(browserApi.tabs?.onDetached, (tabId, detachInfo) => {
      publish({
        kind: "tab-detached",
        windowIds: normalizedWindowIds(detachInfo?.oldWindowId),
        tabId
      }, detachInfo?.incognito);
    });
    register(browserApi.tabs?.onMoved, (tabId, moveInfo) => {
      publish({
        kind: "tab-moved",
        windowIds: normalizedWindowIds(moveInfo?.windowId),
        tabId
      }, moveInfo?.incognito);
    });
    register(browserApi.tabs?.onActivated, (activeInfo) => {
      // A window that still activates tabs did not finish closing.
      markWindowOpen(activeInfo?.windowId);
      publish({
        kind: "tab-activated",
        windowIds: normalizedWindowIds(activeInfo?.windowId),
        tabId: activeInfo?.tabId,
        previousTabId: activeInfo?.previousTabId
      }, activeInfo?.incognito);
    });
    register(browserApi.tabs?.onUpdated, (tabId, changeInfo, tab) => {
      if (!Object.keys(changeInfo ?? {}).some((key) => RELEVANT_TAB_UPDATE_KEYS.has(key))) {
        return;
      }
      publish({
        kind: "tab-updated",
        windowIds: normalizedWindowIds(tab?.windowId),
        tabId,
        ...(Object.hasOwn(changeInfo, "hidden") ? { hidden: changeInfo.hidden === true } : {}),
        changed: Object.freeze(
          Object.keys(changeInfo).filter((key) => RELEVANT_TAB_UPDATE_KEYS.has(key)).sort()
        )
      }, tab?.incognito);
    });
    register(browserApi.tabs?.onReplaced, (addedTabId, removedTabId) => {
      Promise.resolve(browserApi.tabs.get(addedTabId))
        .then((tab) => {
          recordPresentTab(tab?.windowId, addedTabId);
          const generation = recordRemovedTab(tab?.windowId, removedTabId);
          publish({
            kind: "tab-replaced",
            windowIds: normalizedWindowIds(tab?.windowId),
            tabId: addedTabId,
            replacedTabId: removedTabId,
            generation
          }, tab?.incognito);
        })
        .catch(() => {
          publish({
            kind: "tab-replaced",
            windowIds: [],
            tabId: addedTabId,
            replacedTabId: removedTabId
          });
        });
    });

    for (const [eventName, event] of [
      ["group-created", browserApi.tabGroups?.onCreated],
      ["group-updated", browserApi.tabGroups?.onUpdated],
      ["group-moved", browserApi.tabGroups?.onMoved],
      ["group-removed", browserApi.tabGroups?.onRemoved]
    ]) {
      register(event, (group) => {
        publish({
          kind: eventName,
          windowIds: normalizedWindowIds(group?.windowId),
          groupId: group?.id
        }, group?.incognito);
      });
    }

    register(browserApi.windows?.onCreated, (window) => {
      windowScopeRegistry?.observeWindow(window);
      publish({ kind: "window-created", windowIds: normalizedWindowIds(window?.id) }, window?.incognito);
    });
    register(browserApi.windows?.onRemoved, (windowId) => {
      publish({ kind: "window-removed", windowIds: normalizedWindowIds(windowId) });
      lifecycleByWindow.delete(windowId);
      closingWindowIds.delete(windowId);
      knownWindowIdentities.delete(windowId);
    });

    return () => {
      for (const [event, handler] of registrations) {
        event.removeListener(handler);
      }
    };
  }

  return Object.freeze({
    scope: parsedScope,

    getTabLifecycle(windowId) {
      const lifecycle = lifecycleByWindow.get(windowId);
      return Object.freeze({
        generation: lifecycle?.generation ?? 0,
        removedTabIds: Object.freeze([...(lifecycle?.removedTabIds ?? [])])
      });
    },

    isTabTombstoned(windowId, tabId) {
      return lifecycleByWindow.get(windowId)?.removedTabIds.has(tabId) === true;
    },

    createLogicalGroupId() {
      return createLogicalId("group");
    },

    createLogicalSplitViewId() {
      return createLogicalId("split");
    },

    async getTabIdentity(tabId) {
      await assertTabScope(tabId);
      return readIdentity("tab", tabId, WORKSPACE_TAB_SESSION_KEY, getTabValue);
    },

    async getOrCreateTabIdentity(tabId) {
      await assertTabScope(tabId);
      return getOrCreateIdentity(
        "tab",
        tabId,
        WORKSPACE_TAB_SESSION_KEY,
        getTabValue,
        setTabValue
      );
    },

    async replaceTabIdentity(tabId) {
      await assertTabScope(tabId);
      const logicalId = createLogicalId("tab");
      await setTabValue(tabId, WORKSPACE_TAB_SESSION_KEY, logicalId);
      return logicalId;
    },

    async setTabIdentity(tabId, logicalId) {
      if (!isLogicalId(logicalId, "tab")) {
        throw new TypeError("Invalid logical tab ID.");
      }
      await assertTabScope(tabId);
      await setTabValue(tabId, WORKSPACE_TAB_SESSION_KEY, logicalId);
      return logicalId;
    },

    async getWindowIdentity(windowId) {
      await requireWindowScope(windowId);
      return readWindowIdentity(windowId);
    },

    async getOrCreateWindowIdentity(windowId) {
      await requireWindowScope(windowId);
      return (await readWindowIdentity(windowId)) ??
        writeWindowIdentity(windowId, createLogicalId("window"));
    },

    async replaceWindowIdentity(windowId) {
      await requireWindowScope(windowId);
      return writeWindowIdentity(windowId, createLogicalId("window"));
    },

    async getTabLogicalGroupId(tabId) {
      await assertTabScope(tabId);
      const value = await getTabValue(tabId, WORKSPACE_GROUP_SESSION_KEY);
      return isLogicalId(value, "group") ? value : null;
    },

    async setTabLogicalGroupId(tabId, logicalGroupId) {
      if (!isLogicalId(logicalGroupId, "group")) {
        throw new TypeError("Invalid logical group ID.");
      }
      await assertTabScope(tabId);
      return setTabValue(tabId, WORKSPACE_GROUP_SESSION_KEY, logicalGroupId);
    },

    async clearTabLogicalGroupId(tabId) {
      await assertTabScope(tabId);
      return sessionCache.remove(tabId, WORKSPACE_GROUP_SESSION_KEY);
    },

    async getWindowNotice(windowId) {
      await requireWindowScope(windowId);
      return browserApi.sessions.getWindowValue(windowId, WORKSPACE_NOTICE_SESSION_KEY);
    },

    async setWindowNotice(windowId, notice) {
      await requireWindowScope(windowId);
      return browserApi.sessions.setWindowValue(windowId, WORKSPACE_NOTICE_SESSION_KEY, notice);
    },

    async clearWindowNotice(windowId) {
      await requireWindowScope(windowId);
      return browserApi.sessions.removeWindowValue(windowId, WORKSPACE_NOTICE_SESSION_KEY);
    },

    async listTabs(windowId) {
      if (windowScopeRegistry && !(await windowScopeRegistry.resolveMatches(parsedScope, windowId))) {
        return [];
      }
      const rawTabs = await browserApi.tabs.query({ windowId });
      for (const tab of rawTabs) sessionCache.rememberTab(tab);
      // Without runtime access the adapter cannot know its own address, so the
      // page simply goes unflagged and the row keeps its ordinary fallback.
      const settingsUrl = browserApi.runtime?.getURL?.("src/settings/index.html") ?? null;
      const lifecycle = lifecycleByWindow.get(windowId);
      if (!lifecycle) {
        return rawTabs.map((tab) => normalizedTab(tab, settingsUrl));
      }
      const rawIds = new Set(rawTabs.map(({ id }) => id));
      for (const tabId of lifecycle.removedTabIds) {
        if (!rawIds.has(tabId)) {
          lifecycle.removedTabIds.delete(tabId);
        }
      }
      return rawTabs
        .filter(({ id }) => !lifecycle.removedTabIds.has(id))
        .map((tab) => normalizedTab(tab, settingsUrl));
    },

    // The only path that returns raw tab addresses to the caller. It reads the
    // exact tabs a confirmed close is about to remove, so the session Undo
    // slot can reopen each tab at its own page instead of about:blank. A tab
    // that closed before the read simply has no recoverable page.
    async listTabPages(tabIds) {
      if (!Array.isArray(tabIds) || tabIds.length === 0) {
        return [];
      }
      const uniqueIds = [...new Set(tabIds)].filter(
        (tabId) => Number.isInteger(tabId) && tabId >= 0
      );
      const pages = [];
      for (const tabId of uniqueIds) {
        let tab;
        try {
          tab = await browserApi.tabs.get(tabId);
        } catch {
          // One tab closing must not cost the others their pages, so a
          // missing tab is skipped and recovery falls back to about:blank.
          continue;
        }
        sessionCache.rememberTab(tab);
        if (
          windowScopeRegistry &&
          !windowScopeRegistry.matches(parsedScope, tab.windowId, tab.incognito)
        ) {
          throw new TypeError("The Firefox tab is outside this workspace scope.");
        }
        pages.push({
          id: tab.id,
          url: typeof tab.url === "string" ? tab.url : "about:blank",
          title: normalizedTitle(tab.title)
        });
      }
      return pages;
    },

    // The only inventory path that reads tab URLs. It returns the reduced
    // match-only location, so raw URLs never reach workspace state or messages.
    async listTabSearchLocations(windowId) {
      if (windowScopeRegistry && !(await windowScopeRegistry.resolveMatches(parsedScope, windowId))) {
        return [];
      }
      const lifecycle = lifecycleByWindow.get(windowId);
      return (await browserApi.tabs.query({ windowId }))
        .filter((tab) => Number.isInteger(tab?.id) && !lifecycle?.removedTabIds.has(tab.id))
        .map((tab) => ({ id: tab.id, location: searchableTabLocation(tab.url) }));
    },

    async listSettingsTabs() {
      const settingsUrl = browserApi.runtime.getURL("src/settings/index.html");
      return (await browserApi.tabs.query({ url: settingsUrl }))
        .filter(
          (tab) =>
            tab?.url === settingsUrl &&
            Number.isInteger(tab.id) &&
            Number.isInteger(tab.windowId) &&
            (windowScopeRegistry
              ? windowScopeRegistry.matches(parsedScope, tab.windowId, tab.incognito)
              : parsedScope === WORKSPACE_SCOPES.NORMAL && tab.incognito !== true)
        )
        .map(normalizedTab);
    },

    async getTab(tabId) {
      return normalizedTab(
        windowScopeRegistry ? await requireTabScope(tabId) : await browserApi.tabs.get(tabId)
      );
    },

    async listNormalWindowIds() {
      const windows = await browserApi.windows.getAll({ windowTypes: ["normal"] });
      return windows
        .filter((window) => {
          windowScopeRegistry?.observeWindow(window);
          return parsedScope === WORKSPACE_SCOPES.PRIVATE
            ? window.incognito === true
            : window.incognito !== true;
        })
        .filter(({ id }) => !closingWindowIds.has(id))
        .map(({ id }) => id);
    },

    async focusWindow(windowId) {
      await requireWindowScope(windowId);
      return browserApi.windows.update(windowId, { focused: true });
    },

    async openSettingsPage(windowId) {
      await requireWindowScope(windowId);
      if (parsedScope === WORKSPACE_SCOPES.PRIVATE) {
        return browserApi.tabs.create({
          windowId,
          url: browserApi.runtime.getURL("src/settings/index.html"),
          active: true
        });
      }
      return browserApi.runtime.openOptionsPage();
    },

    async createTab(windowId, {
      cookieStoreId = null,
      active = false,
      index,
      url,
      discarded = false,
      title = null
    } = {}) {
      await requireWindowScope(windowId);
      if (parsedScope === WORKSPACE_SCOPES.PRIVATE && cookieStoreId !== null) {
        throw new Error("Firefox containers are unavailable in private windows.");
      }
      const createProperties = { windowId, active };
      if (cookieStoreId !== null) createProperties.cookieStoreId = cookieStoreId;
      if (Number.isInteger(index)) createProperties.index = index;
      if (typeof url === "string") createProperties.url = url;
      // Firefox refuses to create an active or about: tab unloaded, so those
      // are created loaded instead.
      if (
        discarded === true &&
        active !== true &&
        typeof url === "string" &&
        !url.startsWith("about:")
      ) {
        createProperties.discarded = true;
        if (typeof title === "string" && title.length > 0) {
          createProperties.title = title.slice(0, MAX_TAB_TITLE_LENGTH);
        }
      }
      const created = await browserApi.tabs.create(createProperties);
      if (!matchesRequestedContainer(created, cookieStoreId)) {
        if (Number.isInteger(created?.id)) {
          await browserApi.tabs.remove(created.id).catch(() => undefined);
        }
        throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_MISMATCH);
      }
      return created;
    },

    async copyTab(tabId, { cookieStoreId = null } = {}) {
      const source = windowScopeRegistry
        ? await requireTabScope(tabId)
        : await browserApi.tabs.get(tabId);
      const created = await browserApi.tabs.create({
        windowId: source.windowId,
        index: source.index + 1,
        active: true,
        url: supportedCopyUrl(source.url),
        ...(cookieStoreId === null ? {} : { cookieStoreId })
      });
      if (!matchesRequestedContainer(created, cookieStoreId)) {
        if (Number.isInteger(created?.id)) {
          await browserApi.tabs.remove(created.id).catch(() => undefined);
        }
        throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_MISMATCH);
      }
      return normalizedTab(created);
    },

    // Firefox cannot change an existing tab's container, so a move opens the
    // same page beside the source in the target container. The page address
    // is read and used only here, never returned. An unloaded source stays
    // unloaded with its title where Firefox allows it.
    async createContainerReplacement(tabId, { cookieStoreId = null } = {}) {
      const source = windowScopeRegistry
        ? await requireTabScope(tabId)
        : await browserApi.tabs.get(tabId);
      const target = restorableUrl(source.url);
      if (!target.supported) {
        throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
      }
      return normalizedTab(await this.createTab(source.windowId, {
        cookieStoreId,
        active: false,
        index: source.index + 1,
        url: target.url,
        discarded: source.discarded === true && source.active !== true,
        title: source.title
      }));
    },

    async showTabs(tabIds) {
      if (tabIds.length === 0) return [];
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.show(tabIds);
    },

    async activateTab(tabId) {
      await assertTabScope(tabId);
      return browserApi.tabs.update(tabId, { active: true });
    },

    async setTabPinned(tabId, pinned) {
      await assertTabScope(tabId);
      return browserApi.tabs.update(tabId, { pinned });
    },

    async moveTabs(tabIds, { index, windowId } = {}) {
      if (!Array.isArray(tabIds) || tabIds.length === 0) {
        return [];
      }
      await requireTabIdsScope(tabIds);
      const moveProperties = { index };
      if (Number.isInteger(windowId)) {
        await requireWindowScope(windowId);
        moveProperties.windowId = windowId;
      }
      return normalizedTabs(await browserApi.tabs.move(tabIds, moveProperties));
    },

    async removeTabs(tabIds) {
      if (!Array.isArray(tabIds) || tabIds.length === 0 || tabIds.some(
        (tabId) => !Number.isInteger(tabId) || tabId < 0
      )) {
        throw new TypeError("At least one valid Firefox tab ID is required.");
      }
      const uniqueIds = [...new Set(tabIds)];
      if (uniqueIds.length !== tabIds.length) {
        throw new TypeError("Firefox tab IDs must be unique.");
      }
      await requireTabIdsScope(uniqueIds);
      return browserApi.tabs.remove(uniqueIds);
    },

    async reloadTabs(tabIds) {
      if (!Array.isArray(tabIds) || tabIds.some((tabId) => !Number.isInteger(tabId) || tabId < 0)) {
        throw new TypeError("Firefox tab IDs must be valid.");
      }
      const uniqueIds = [...new Set(tabIds)];
      if (uniqueIds.length !== tabIds.length) {
        throw new TypeError("Firefox tab IDs must be unique.");
      }
      await requireTabIdsScope(uniqueIds);
      return Promise.allSettled(uniqueIds.map((tabId) => browserApi.tabs.reload(tabId)));
    },

    async separateSplitView(tabIds, separatorTabIds, { index = -1, windowId } = {}) {
      if (!Array.isArray(tabIds) || tabIds.length !== 2) {
        throw new TypeError("A split view must contain exactly two tabs.");
      }
      const separators = Array.isArray(separatorTabIds) ? separatorTabIds : [separatorTabIds];
      if (separators.length === 0 || separators.some((tabId) => !Number.isInteger(tabId))) {
        throw new TypeError("At least one separator tab is required.");
      }
      const orderedIds = [tabIds[0], ...separators, tabIds[1]];
      const moved = await this.moveTabs(
        orderedIds,
        { index, windowId }
      );
      if (moved.length !== orderedIds.length) {
        throw new Error("Firefox did not separate the split view.");
      }
      const members = await Promise.all(tabIds.map((tabId) => this.getTab(tabId)));
      if (members.some((tab) => tab.splitViewId !== FIREFOX_SPLIT_VIEW_ID_NONE)) {
        throw new Error("Firefox did not separate the split view.");
      }
      return moved;
    },

    async moveTabsInSuccession(tabIds, successorTabId = FIREFOX_TAB_ID_NONE) {
      if (!Array.isArray(tabIds) || tabIds.length === 0) {
        return [];
      }
      await requireTabIdsScope(tabIds);
      if (successorTabId !== FIREFOX_TAB_ID_NONE) {
        await requireTabScope(successorTabId);
      }
      return browserApi.tabs.moveInSuccession(tabIds, successorTabId);
    },

    async createTabGroup(tabIds, windowId) {
      if (!Array.isArray(tabIds) || tabIds.length === 0) {
        return null;
      }
      await requireTabIdsScope(tabIds);
      await requireWindowScope(windowId);
      const groupId = await browserApi.tabs.group({
        tabIds,
        createProperties: { windowId }
      });
      return Number.isInteger(groupId) && groupId >= 0 ? groupId : null;
    },

    async addTabsToGroup(tabIds, groupId) {
      if (!Array.isArray(tabIds) || tabIds.length === 0) {
        return null;
      }
      await requireTabIdsScope(tabIds);
      if (windowScopeRegistry) {
        const group = await browserApi.tabGroups.get(groupId);
        await requireWindowScope(group.windowId);
      }
      const result = await browserApi.tabs.group({ tabIds, groupId });
      return Number.isInteger(result) && result >= 0 ? result : null;
    },

    async ungroupTabs(tabIds) {
      if (tabIds.length === 0) return undefined;
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.ungroup(tabIds);
    },

    async listTabGroups(windowId) {
      await requireWindowScope(windowId);
      return browserApi.tabGroups.query({ windowId });
    },

    async getTabGroup(groupId) {
      const group = await browserApi.tabGroups.get(groupId);
      await requireWindowScope(group.windowId);
      return group;
    },

    async updateTabGroup(groupId, { title, color, collapsed }) {
      if (windowScopeRegistry) {
        const group = await browserApi.tabGroups.get(groupId);
        await requireWindowScope(group.windowId);
      }
      return browserApi.tabGroups.update(groupId, { title, color, collapsed });
    },

    async moveTabGroup(groupId, { index, windowId } = {}) {
      if (windowScopeRegistry) {
        const group = await browserApi.tabGroups.get(groupId);
        await requireWindowScope(group.windowId);
      }
      const moveProperties = { index };
      if (Number.isInteger(windowId)) {
        await requireWindowScope(windowId);
        moveProperties.windowId = windowId;
      }
      return browserApi.tabGroups.move(groupId, moveProperties);
    },

    async hideTabs(tabIds) {
      if (tabIds.length === 0) return [];
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.hide(tabIds);
    },

    async discardTab(tabId) {
      await assertTabScope(tabId);
      return browserApi.tabs.discard(tabId);
    },

    async discardTabs(tabIds) {
      if (tabIds.length === 0) return [];
      await requireTabIdsScope(tabIds);
      return browserApi.tabs.discard(tabIds);
    },

    subscribeWorkspaceEvents
  });
}

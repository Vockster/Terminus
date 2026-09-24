export const NATIVE_FIREFOX_TAB_DRAG_TYPE = "text/x-moz-text-internal";

function values(collection) {
  try {
    return collection ? Array.from(collection) : [];
  } catch {
    return [];
  }
}

function validWindowId(windowId) {
  return Number.isInteger(windowId) && windowId >= 0;
}

function compareTabs(left, right) {
  const leftIndex = Number.isInteger(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isInteger(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || left.id - right.id;
}

export function isNativeFirefoxTabDrag(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }
  const types = values(dataTransfer.types);
  const items = values(dataTransfer.items);
  const files = values(dataTransfer.files);
  return (
    types.length === 1 &&
    types[0] === NATIVE_FIREFOX_TAB_DRAG_TYPE &&
    items.length === 1 &&
    items[0]?.kind === "string" &&
    items[0]?.type === NATIVE_FIREFOX_TAB_DRAG_TYPE &&
    files.length === 0
  );
}

export function createNativeTabDropResolver({ browserApi, currentWindowId }) {
  if (
    !browserApi?.windows?.getLastFocused ||
    !browserApi?.windows?.get ||
    !browserApi?.windows?.onFocusChanged?.addListener ||
    !browserApi?.windows?.onFocusChanged?.removeListener ||
    !browserApi?.tabs?.query ||
    !validWindowId(currentWindowId)
  ) {
    throw new TypeError("Native tab drop requires Firefox tab and window APIs.");
  }

  const windowIdNone = Number.isInteger(browserApi.windows.WINDOW_ID_NONE)
    ? browserApi.windows.WINDOW_ID_NONE
    : -1;
  let lastFocusedWindowId = null;
  let candidateSourceWindowId = null;
  let focusSequence = 0;
  let subscribed = false;
  let disposed = false;

  async function readLastFocusedWindowId() {
    try {
      const focused = await browserApi.windows.getLastFocused({
        windowTypes: ["normal"]
      });
      return validWindowId(focused?.id) && focused?.type === "normal"
        ? focused.id
        : null;
    } catch {
      return null;
    }
  }

  async function refreshTrackedFocus() {
    const sequence = ++focusSequence;
    const windowId = await readLastFocusedWindowId();
    if (!disposed && sequence === focusSequence) {
      lastFocusedWindowId = windowId;
    }
    return windowId;
  }

  function onFocusChanged(windowId) {
    if (disposed || windowId === windowIdNone || !validWindowId(windowId)) {
      return;
    }
    const sequence = ++focusSequence;
    Promise.resolve(browserApi.windows.get(windowId))
      .then((window) => {
        if (!disposed && sequence === focusSequence && window?.type === "normal") {
          lastFocusedWindowId = windowId;
        }
      })
      .catch(() => undefined);
  }

  function reset() {
    candidateSourceWindowId = null;
  }

  return Object.freeze({
    async initialize() {
      if (disposed) {
        return false;
      }
      if (!subscribed) {
        browserApi.windows.onFocusChanged.addListener(onFocusChanged);
        subscribed = true;
      }
      return (await refreshTrackedFocus()) === currentWindowId;
    },

    accepts(dataTransfer, { activeWorkspaceId, destinationWorkspaceId }) {
      if (
        disposed ||
        !isNativeFirefoxTabDrag(dataTransfer) ||
        typeof activeWorkspaceId !== "string" ||
        typeof destinationWorkspaceId !== "string" ||
        destinationWorkspaceId === activeWorkspaceId
      ) {
        return false;
      }
      if (candidateSourceWindowId === null) {
        candidateSourceWindowId = lastFocusedWindowId;
      }
      return candidateSourceWindowId === currentWindowId;
    },

    resolveDrop(dataTransfer, { activeWorkspaceId, destinationWorkspaceId, activeTabs }) {
      const transferAccepted = isNativeFirefoxTabDrag(dataTransfer);
      const sourceWindowId = candidateSourceWindowId;
      reset();
      if (
        disposed ||
        !transferAccepted ||
        sourceWindowId !== currentWindowId ||
        typeof activeWorkspaceId !== "string" ||
        typeof destinationWorkspaceId !== "string" ||
        destinationWorkspaceId === activeWorkspaceId ||
        !Array.isArray(activeTabs)
      ) {
        return null;
      }

      const rowByFirefoxId = new Map();
      for (const row of activeTabs) {
        if (
          !Number.isInteger(row?.firefoxId) ||
          row.firefoxId < 0 ||
          typeof row.logicalId !== "string" ||
          row.workspaceId !== activeWorkspaceId ||
          rowByFirefoxId.has(row.firefoxId)
        ) {
          return Promise.resolve(null);
        }
        rowByFirefoxId.set(row.firefoxId, {
          logicalTabId: row.logicalId,
          firefoxTabId: row.firefoxId
        });
      }

      return (async () => {
        let focusedBeforeQuery;
        let highlighted;
        try {
          [focusedBeforeQuery, highlighted] = await Promise.all([
            readLastFocusedWindowId(),
            browserApi.tabs.query({
              highlighted: true,
              windowId: currentWindowId
            })
          ]);
        } catch {
          return null;
        }
        if (focusedBeforeQuery !== sourceWindowId) {
          return null;
        }
        const focusedAfterQuery = await readLastFocusedWindowId();
        if (focusedAfterQuery !== sourceWindowId || !Array.isArray(highlighted)) {
          return null;
        }
        const ordered = [...highlighted].sort(compareTabs);
        const firefoxIds = new Set();
        const tabs = [];
        for (const tab of ordered) {
          const pair = rowByFirefoxId.get(tab?.id);
          if (
            !pair ||
            tab.windowId !== currentWindowId ||
            tab.highlighted !== true ||
            firefoxIds.has(tab.id)
          ) {
            return null;
          }
          firefoxIds.add(tab.id);
          tabs.push(pair);
        }
        return tabs.length > 0
          ? { windowId: currentWindowId, tabs, destinationWorkspaceId }
          : null;
      })();
    },

    reset,

    dispose() {
      if (subscribed) {
        browserApi.windows.onFocusChanged.removeListener(onFocusChanged);
        subscribed = false;
      }
      disposed = true;
      lastFocusedWindowId = null;
      reset();
    }
  });
}

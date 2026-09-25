export const TAB_SEARCH_SCOPES = Object.freeze({
  WORKSPACE: "workspace",
  WINDOW: "window"
});

export const DEFAULT_TAB_SEARCH_SCOPE = TAB_SEARCH_SCOPES.WINDOW;

const MATCH_TIERS = Object.freeze({
  STRONG_TITLE: 0,
  PARTIAL_TITLE: 1,
  LOCATION: 2
});
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const PLACEHOLDERS = Object.freeze({
  [TAB_SEARCH_SCOPES.WINDOW]: "Search all tabs…",
  [TAB_SEARCH_SCOPES.WORKSPACE]: "Search this workspace…"
});

export function normalizedTabSearchQuery(query) {
  return typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
}

function titleMatchTier(title, needle) {
  const haystack = title.toLocaleLowerCase();
  let index = haystack.indexOf(needle);
  if (index < 0) return null;
  while (index >= 0) {
    if (index === 0 || !WORD_CHARACTER.test(haystack[index - 1])) {
      return MATCH_TIERS.STRONG_TITLE;
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return MATCH_TIERS.PARTIAL_TITLE;
}

function matchTier(tab, needle) {
  const titleTier = titleMatchTier(tab.title, needle);
  if (titleTier !== null) return titleTier;
  return typeof tab.location === "string" &&
    tab.location.toLocaleLowerCase().includes(needle)
    ? MATCH_TIERS.LOCATION
    : null;
}

function identityKey(logicalTabId, firefoxTabId) {
  return `${logicalTabId}\u0000${firefoxTabId}`;
}

// Title matches rank above address-only matches. A match at the start of the
// title or of a word ranks above one inside a word. Ties keep index order,
// which is rail order and then each workspace's own tab order.
export function filterTabSearchResults(
  index,
  {
    query,
    scope = DEFAULT_TAB_SEARCH_SCOPE,
    activeWorkspaceId,
    liveTabIdentities = null,
    removedFirefoxTabIds = null
  }
) {
  const needle = normalizedTabSearchQuery(query);
  if (needle.length === 0 || !Array.isArray(index?.tabs)) return [];
  if (!Object.values(TAB_SEARCH_SCOPES).includes(scope)) {
    throw new TypeError("Invalid tab search scope.");
  }
  const live = Array.isArray(liveTabIdentities)
    ? new Set(liveTabIdentities.map(({ logicalTabId, firefoxTabId }) =>
      identityKey(logicalTabId, firefoxTabId)
    ))
    : null;
  const emitted = new Set();
  const ranked = [];
  for (const tab of index.tabs) {
    if (
      (scope === TAB_SEARCH_SCOPES.WORKSPACE && tab.workspaceId !== activeWorkspaceId) ||
      (live && !live.has(identityKey(tab.logicalTabId, tab.firefoxTabId))) ||
      removedFirefoxTabIds?.has(tab.firefoxTabId) ||
      emitted.has(tab.logicalTabId)
    ) {
      continue;
    }
    const tier = matchTier(tab, needle);
    if (tier === null) continue;
    emitted.add(tab.logicalTabId);
    ranked.push({ tab, tier, order: ranked.length });
  }
  return ranked
    .sort((left, right) => left.tier - right.tier || left.order - right.order)
    .map(({ tab }) => tab);
}

export function tabSearchBreadcrumb(tab, workspaceName) {
  const context = [
    workspaceName,
    tab.groupTitle,
    ...tab.ancestorTitles
  ].filter((entry) => typeof entry === "string" && entry.length > 0);
  return context.join(" › ");
}

function tabSearchResultLabel(tab, breadcrumb, state) {
  return `${tab.title}, ${breadcrumb}${state ? `, ${state.toLowerCase()}` : ""}`;
}

/**
 * The sidebar's single search owner. It keeps the transient open state, query,
 * scope, and last verified index for one sidebar document, and never stores
 * any of them.
 *
 * Index freshness: every view change marks the index stale. At most one index
 * request runs at a time; one that finishes after further changes is still
 * shown, filtered by the newest view's live tab identities, and another request
 * follows immediately. Results therefore never blank during event bursts and
 * never offer a tab the newest view no longer holds.
 */
export function createTabSearchController({
  document,
  elements,
  loadIndex,
  parseIndex,
  createWorkspaceIndicator,
  createFavicon,
  presentResults,
  showTree,
  activateResult,
  focusActivatedTab
}) {
  const {
    pane,
    region,
    toggle,
    controls,
    input,
    clear,
    scope,
    results,
    tree,
    scroll,
    footer
  } = elements;
  let enabled = false;
  let open = false;
  let position = "top";
  let view = null;
  let index = null;
  let indexStale = true;
  let indexFailed = false;
  let loading = false;
  let viewGeneration = 0;
  let activating = false;
  let renderedTabs = new Map();
  const removedFirefoxTabIds = new Set();

  function query() {
    return normalizedTabSearchQuery(input.value);
  }

  function currentScope() {
    return Object.values(TAB_SEARCH_SCOPES).includes(scope.value)
      ? scope.value
      : DEFAULT_TAB_SEARCH_SCOPE;
  }

  function searchAtBottom() {
    return position === "bottom";
  }

  function focus(element) {
    element?.focus({ preventScroll: true });
  }

  function focusInsideSearch() {
    const active = document.activeElement;
    return Boolean(active) && (region.contains(active) || results.contains(active));
  }

  function resultButtons() {
    return [...results.querySelectorAll(".tab-search-result")];
  }

  function statusElement(message) {
    const status = document.createElement("p");
    status.className = "tab-search-empty";
    status.textContent = message;
    return status;
  }

  function presentStatus(message, busy) {
    renderedTabs = new Map();
    results.setAttribute("aria-busy", String(busy));
    presentResults({
      content: statusElement(message),
      renderedTabs: [],
      liveTabIdentities: view.liveTabIdentities
    });
  }

  function resultRow(tab, workspace) {
    const button = document.createElement("button");
    button.className = "tab-search-result";
    button.type = "button";
    button.draggable = false;
    button.dataset.tabId = tab.logicalTabId;
    button.dataset.firefoxTabId = String(tab.firefoxTabId);
    button.dataset.workspaceId = tab.workspaceId;
    const breadcrumb = tabSearchBreadcrumb(tab, workspace.name);
    const state = [tab.pinned ? "Pinned" : null, tab.discarded ? "Unloaded" : null]
      .filter(Boolean)
      .join(" · ");
    button.setAttribute("aria-label", tabSearchResultLabel(tab, breadcrumb, state));
    const title = document.createElement("span");
    title.className = "tab-search-result-title";
    title.textContent = tab.title;
    const context = document.createElement("span");
    context.className = "tab-search-result-context";
    context.textContent = breadcrumb;
    const stateLabel = document.createElement("span");
    stateLabel.className = "tab-search-result-state";
    stateLabel.textContent = state;
    stateLabel.setAttribute("aria-hidden", "true");
    button.append(
      createWorkspaceIndicator(workspace),
      createFavicon(tab),
      title,
      stateLabel,
      context
    );
    return button;
  }

  function captureFocus() {
    const active = document.activeElement;
    const result = active?.closest?.(".tab-search-result");
    if (result && results.contains(result)) {
      return {
        kind: "result",
        logicalTabId: result.dataset.tabId,
        firefoxTabId: result.dataset.firefoxTabId
      };
    }
    if ([input, clear, scope, toggle].includes(active)) {
      return { kind: "control", element: active };
    }
    return null;
  }

  function restoreFocus(snapshot) {
    if (!snapshot || !enabled) return;
    if (snapshot.kind === "control") {
      if (snapshot.element === toggle || open) {
        focus(snapshot.element.hidden ? input : snapshot.element);
      }
      return;
    }
    if (!open) return;
    const result = resultButtons().find((button) =>
      button.dataset.tabId === snapshot.logicalTabId &&
      button.dataset.firefoxTabId === snapshot.firefoxTabId
    );
    focus(result ?? input);
  }

  function syncChrome() {
    region.hidden = !enabled;
    controls.hidden = !(enabled && open);
    region.dataset.open = String(enabled && open);
    pane.dataset.tabSearchOpen = String(enabled && open);
    pane.dataset.tabSearchPosition = position;
    toggle.setAttribute("aria-expanded", String(enabled && open));
    clear.hidden = input.value.length === 0;
    input.placeholder = PLACEHOLDERS[currentScope()];
    const nextElement = searchAtBottom() ? footer : scroll;
    if (region.nextElementSibling !== nextElement) {
      pane.insertBefore(region, nextElement);
    }
  }

  function render() {
    syncChrome();
    const showingResults = enabled && open && query().length > 0;
    tree.hidden = showingResults;
    results.hidden = !showingResults;
    // Icons Only hides the tab list and footer behind the overlay only while
    // results replace them.
    pane.dataset.tabSearchResults = String(showingResults);
    if (!showingResults || !view) {
      renderedTabs = new Map();
      results.setAttribute("aria-busy", "false");
      showTree(view);
      return;
    }
    if (indexStale) void load();
    if (!index) {
      presentStatus(
        indexFailed ? "Tab search is unavailable." : "Searching…",
        !indexFailed
      );
      return;
    }

    const workspaceById = new Map(
      index.workspaces.map((workspace) => [workspace.id, workspace])
    );
    const matches = filterTabSearchResults(index, {
      query: input.value,
      scope: currentScope(),
      activeWorkspaceId: view.activeWorkspaceId,
      liveTabIdentities: view.liveTabIdentities,
      removedFirefoxTabIds
    }).filter((tab) => workspaceById.has(tab.workspaceId));
    if (matches.length === 0) {
      presentStatus("No matching tabs.", loading);
      return;
    }
    const fragment = document.createDocumentFragment();
    const summary = document.createElement("p");
    summary.className = "visually-hidden tab-search-summary";
    summary.textContent = `${matches.length} ${matches.length === 1 ? "result" : "results"}`;
    fragment.append(summary);
    renderedTabs = new Map();
    const presented = [];
    for (const tab of matches) {
      fragment.append(resultRow(tab, workspaceById.get(tab.workspaceId)));
      renderedTabs.set(identityKey(tab.logicalTabId, tab.firefoxTabId), tab);
      presented.push({ logicalId: tab.logicalTabId, firefoxId: tab.firefoxTabId });
    }
    results.setAttribute("aria-busy", String(loading));
    presentResults({
      content: fragment,
      renderedTabs: presented,
      liveTabIdentities: view.liveTabIdentities
    });
  }

  function rerender() {
    const snapshot = captureFocus();
    render();
    restoreFocus(snapshot);
  }

  async function load() {
    if (loading || !indexStale || !view || activating) return;
    loading = true;
    indexStale = false;
    const requestedGeneration = viewGeneration;
    try {
      const raw = await loadIndex();
      index = parseIndex(raw, view.state.workspaces);
      indexFailed = false;
      if (requestedGeneration !== viewGeneration) indexStale = true;
    } catch {
      // A newer view explains a mismatch; retry against it. Otherwise keep the
      // last verified index and wait for the next view change or input.
      if (requestedGeneration !== viewGeneration) {
        indexStale = true;
      } else {
        indexFailed = true;
      }
    } finally {
      loading = false;
    }
    if (open && enabled) rerender();
  }

  function resetTransientState() {
    input.value = "";
    scope.value = DEFAULT_TAB_SEARCH_SCOPE;
  }

  function openSearch() {
    if (!enabled) return false;
    if (!open) {
      open = true;
      if (indexFailed) {
        indexFailed = false;
        indexStale = true;
      }
      render();
      if (indexStale) void load();
    }
    focus(input);
    return true;
  }

  function closeSearch({ restoreFocus: shouldRestoreFocus = true } = {}) {
    const hadFocus = focusInsideSearch();
    const wasOpen = open;
    open = false;
    resetTransientState();
    render();
    if (wasOpen && enabled && shouldRestoreFocus && hadFocus) focus(toggle);
    return wasOpen;
  }

  async function activate(tab) {
    if (!tab || activating || !view) return false;
    activating = true;
    let applied;
    try {
      applied = await activateResult(tab);
    } catch {
      applied = false;
    } finally {
      activating = false;
    }
    if (applied === true) {
      closeSearch({ restoreFocus: false });
      if (!focusActivatedTab?.(tab)) focus(toggle);
      return true;
    }
    if (applied === false) {
      indexStale = true;
      indexFailed = false;
      if (open) rerender();
    }
    return false;
  }

  function tabForButton(button) {
    return renderedTabs.get(
      identityKey(button?.dataset.tabId, Number(button?.dataset.firefoxTabId))
    ) ?? null;
  }

  function retryAfterFailure() {
    if (!indexFailed) return;
    indexFailed = false;
    indexStale = true;
  }

  toggle.addEventListener("click", () => {
    if (open) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  input.addEventListener("input", () => {
    retryAfterFailure();
    render();
  });

  clear.addEventListener("click", () => {
    input.value = "";
    render();
    focus(input);
  });

  scope.addEventListener("change", () => {
    if (!Object.values(TAB_SEARCH_SCOPES).includes(scope.value)) {
      scope.value = DEFAULT_TAB_SEARCH_SCOPE;
    }
    retryAfterFailure();
    render();
  });

  region.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.target !== input || event.isComposing) return;
    const buttons = resultButtons();
    if (event.key === "Enter") {
      if (results.hidden || buttons.length === 0) return;
      event.preventDefault();
      void activate(tabForButton(buttons[0]));
      return;
    }
    const entryKey = searchAtBottom() ? "ArrowUp" : "ArrowDown";
    if (event.key === entryKey && !results.hidden && buttons.length > 0) {
      event.preventDefault();
      focus(searchAtBottom() ? buttons.at(-1) : buttons[0]);
    }
  });

  // Escape closes search from anywhere in the pane, including after a click on
  // the pane's empty space left focus on the document body. Menus and dialogs
  // keep their own Escape.
  document.addEventListener("keydown", (event) => {
    if (!open || event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target;
    const onPage = target === document.body || pane.contains(target);
    if (!onPage || target.closest?.(".command-menu, .workspace-dialog")) return;
    event.preventDefault();
    closeSearch();
  });

  results.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".tab-search-result");
    if (!button || !results.contains(button)) return;
    void activate(tabForButton(button));
  });

  results.addEventListener("keydown", (event) => {
    const button = event.target?.closest?.(".tab-search-result");
    if (!button) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = resultButtons();
    const index = buttons.indexOf(button);
    if (
      (!searchAtBottom() && event.key === "ArrowUp" && index === 0) ||
      (searchAtBottom() && event.key === "ArrowDown" && index === buttons.length - 1)
    ) {
      event.preventDefault();
      focus(input);
      return;
    }
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : Math.min(buttons.length - 1, index + 1);
    if (buttons[targetIndex]) {
      event.preventDefault();
      focus(buttons[targetIndex]);
    }
  });

  return Object.freeze({
    captureFocus,

    configure({ enabled: nextEnabled, position: nextPosition }) {
      const snapshot = captureFocus();
      enabled = nextEnabled === true;
      position = nextPosition === "bottom" ? "bottom" : "top";
      if (!enabled && open) {
        open = false;
        resetTransientState();
      }
      render();
      restoreFocus(snapshot);
    },

    setView(nextView, focusSnapshot = captureFocus()) {
      view = nextView;
      viewGeneration += 1;
      indexStale = true;
      indexFailed = false;
      if (view) {
        const live = new Set(view.liveTabIdentities.map(({ firefoxTabId }) => firefoxTabId));
        for (const firefoxTabId of removedFirefoxTabIds) {
          if (!live.has(firefoxTabId)) removedFirefoxTabIds.delete(firefoxTabId);
        }
      }
      render();
      if (open && enabled && !activating) void load();
      restoreFocus(focusSnapshot);
    },

    handleTabRemoved(firefoxTabId) {
      if (!Number.isInteger(firefoxTabId)) return;
      removedFirefoxTabIds.add(firefoxTabId);
      if (open && query().length > 0) rerender();
    },

    open: openSearch,
    close: closeSearch,

    isOpen() {
      return enabled && open;
    },

    activate
  });
}

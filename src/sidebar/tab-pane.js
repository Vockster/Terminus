import {
  createTabSelection,
  destinationForTabRow,
  destinationForWorkspace,
  destinationForZone,
  getViewportMenuPosition,
  groupDestinationForWorkspace,
  groupLoadState,
  groupMembers,
  groupSourceDescriptor,
  shouldToggleTreeFromFavicon,
  tabSourceDescriptor
} from "./sidebar-interactions.js";
import {
  groupMoveDestination,
  snapGroupDropToBranch,
  tabMoveDestination,
  treeBranchShape,
  treeDescendantSummary,
  withTreeDescendants
} from "./tab-tree-targets.js";
import { faviconFallback } from "./favicon-presenter.js";
import { countBadgeText } from "../ui/count-badge.js";
import { groupColorToken } from "../ui/group-colors.js";

const GROUP_LOAD_STATE_LABELS = Object.freeze({
  loaded: "loaded",
  partial: "partly loaded",
  unloaded: "unloaded"
});

const PRIVATE_DRAG_TYPE = "application/x-sidebars-drag-session";
const INTERNAL_PAGE_ICONS = Object.freeze({
  settings: "../assets/icons/app.svg"
});

function element(tagName, className) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  return node;
}

function visibleRows(view) {
  const collapsedGroups = new Set(
    view.activeGroups.filter(({ collapsed }) => collapsed).map(({ id }) => id)
  );
  return view.activeTabs.filter(
    (tab) => !tab.hiddenByCollapsedAncestor && !collapsedGroups.has(tab.groupId)
  );
}

// One transparent count element serves both modes. Full Labels gives it the
// load/status cell; Icons Only gives it a bounded position on the tile.
function countBadge(count, loadState) {
  const badge = element("span", "count-badge tab-count-badge");
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = countBadgeText(count);
  badge.dataset.loadState = loadState;
  return badge;
}

// One cell per ancestor column, then the connector that points at this tab:
// a tee while siblings follow, an elbow at the end of a branch.
function treeBranch(shape) {
  const branch = element("span", "tree-branch");
  branch.setAttribute("aria-hidden", "true");
  for (const continues of shape.trunks) {
    const cell = element("span", "tree-branch-cell");
    cell.dataset.shape = continues ? "trunk" : "none";
    branch.append(cell);
  }
  const connector = element("span", "tree-branch-cell");
  connector.dataset.shape = shape.lastChild ? "elbow" : "tee";
  branch.append(connector);
  return branch;
}

function hiddenBranchLabel({ count, anyLoaded }) {
  return `${count} nested ${count === 1 ? "tab" : "tabs"} hidden, ${anyLoaded ? "some loaded" : "all unloaded"}`;
}

function rowStatusLabel(tab) {
  const labels = [];
  if (tab.splitPosition === "start") labels.push("split view, first pane");
  if (tab.splitPosition === "end") labels.push("split view, second pane");
  labels.push(tab.discarded ? "unloaded" : "loaded");
  if (tab.audible) labels.push("playing audio");
  if (tab.muted) labels.push("muted");
  if (tab.container.kind === "container") {
    labels.push(
      tab.container.status === "available"
        ? `Firefox container ${tab.container.descriptor.name}`
        : `Firefox container ${tab.container.descriptor?.name ?? "unavailable"}, unavailable`
    );
  } else {
    labels.push("No Container");
  }
  return labels.join(", ");
}

export function createTabPane({
  root,
  scrollRoot = root,
  commandMenu,
  onActivate,
  onRelocateTabs,
  onRelocateGroup,
  onRenameGroup,
  onDeleteGroup,
  onCreateGroup,
  onUnloadTabs,
  onFlattenBranch,
  onCloseTarget,
  onMoveToContainer = () => undefined,
  canMoveToContainer = () => false,
  onAcceptNativeDrop,
  onRelocateNativeSelection,
  onCancelNativeDrop,
  onSetTreeCollapsed,
  onSetGroupCollapsed,
  getGlobalCommands = () => [],
  isIconsOnly = () => false
}) {
  const selection = createTabSelection();
  let currentView = null;
  let dragSession = null;
  let pendingFocusId = null;
  // Rebuilding every row for one changed tab dominated large sessions and
  // detached every favicon image. A row is reused only when every input it
  // renders or its handlers close over is unchanged.
  let rowsByTabId = new Map();
  let nextRowsByTabId = new Map();
  // Group sections reuse the same way, keyed by the group and its rendered
  // members, so background churn elsewhere never detaches a group subtree.
  let groupsById = new Map();
  let nextGroupsById = new Map();
  // The pinned and main zones persist across renders; their children are
  // reconciled in place so unchanged rows never leave the DOM.
  let pinnedZone = null;
  let mainZone = null;
  let currentWorkspaceColor = "currentColor";
  // An open menu records what it was opened for. A render keeps it only while
  // every input its commands captured is provably unchanged; anything else,
  // including a menu without a context, closes as before.
  let openMenuContext = null;
  // Drop markers are tracked instead of swept with document-wide selector
  // queries on every dragover event.
  const dropMarkedElements = new Set();

  function closeMenu() {
    openMenuContext = null;
    commandMenu.hidden = true;
    commandMenu.replaceChildren();
  }

  function normalizeCommand(command) {
    if (command?.kind === "separator") {
      return { kind: "separator" };
    }
    if (Array.isArray(command)) {
      return { label: command[0], action: command[1], variant: "default", disabled: false };
    }
    return {
      label: command.label,
      action: command.action,
      variant: command.variant ?? "default",
      disabled: command.disabled === true
    };
  }

  function runCommand(rawCommand) {
    const command = normalizeCommand(rawCommand);
    if (command.kind === "separator") {
      const separator = element("div", "command-menu-separator");
      separator.setAttribute("role", "separator");
      commandMenu.append(separator);
      return;
    }
    const button = element("button", "command-menu-item");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = command.label;
    button.disabled = command.disabled;
    button.dataset.variant = command.variant;
    button.addEventListener("click", () => {
      closeMenu();
      void command.action();
    });
    commandMenu.append(button);
  }

  function serializeCommandList(commands) {
    return JSON.stringify(commands.map((command) => {
      const normalized = normalizeCommand(command);
      return normalized.kind === "separator"
        ? "|"
        : [normalized.label, normalized.variant, normalized.disabled];
    }));
  }

  // Everything the menu commands captured that could change their meaning:
  // order, nesting, pinning, grouping, and split membership feed the move and
  // closure computations, while titles and load state do not.
  function structuralMenuSignature() {
    return JSON.stringify(currentView.activeTabs.map((tab) => [
      tab.logicalId,
      tab.pinned,
      tab.groupId,
      tab.parentTabId,
      tab.collapsed,
      tab.splitViewId,
      tab.splitPosition,
      tab.hiddenByCollapsedAncestor,
      tab.workspaceId
    ]));
  }

  function menuKeyForTab(tab) {
    return JSON.stringify([
      "tab",
      tab.logicalId,
      sourceRows(tab.logicalId).map(({ logicalId }) => logicalId),
      canMoveToContainer(),
      structuralMenuSignature()
    ]);
  }

  function menuKeyForGroup(group) {
    return JSON.stringify(["group", group.id, group, structuralMenuSignature()]);
  }

  function reconcileMenu() {
    if (commandMenu.hidden) {
      openMenuContext = null;
      return;
    }
    if (openMenuContext === null) {
      closeMenu();
      return;
    }
    if (openMenuContext.globalsKey !== serializeCommandList(getGlobalCommands())) {
      closeMenu();
      return;
    }
    if (openMenuContext.kind === "external") {
      // The rail owner revalidates its own menus after it renders.
      return;
    }
    if (openMenuContext.kind === "tab") {
      const tab = currentView.activeTabs.find(
        ({ logicalId }) => logicalId === openMenuContext.id
      );
      if (!tab || menuKeyForTab(tab) !== openMenuContext.key) {
        closeMenu();
      }
      return;
    }
    const group = currentView.activeGroups.find(({ id }) => id === openMenuContext.id);
    if (!group || menuKeyForGroup(group) !== openMenuContext.key) {
      closeMenu();
    }
  }

  function openMenu(anchor, commands, context = null) {
    closeMenu();
    openMenuContext = context === null
      ? null
      : { ...context, globalsKey: serializeCommandList(getGlobalCommands()) };
    const globalCommands = getGlobalCommands();
    const combined = globalCommands.length > 0 && commands.length > 0
      ? [...globalCommands, { kind: "separator" }, ...commands]
      : [...globalCommands, ...commands];
    for (const command of combined) {
      runCommand(command);
    }
    if (commandMenu.childElementCount === 0) {
      return;
    }
    commandMenu.hidden = false;
    commandMenu.style.insetInlineStart = "4px";
    commandMenu.style.insetBlockStart = "4px";
    const position = getViewportMenuPosition(
      anchor.getBoundingClientRect(),
      commandMenu.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }
    );
    commandMenu.style.insetInlineStart = `${position.left}px`;
    commandMenu.style.insetBlockStart = `${position.top}px`;
    commandMenu.querySelector("button:not(:disabled)")?.focus();
  }

  function openMenuAtPoint(clientX, clientY, commands = []) {
    openMenu({
      getBoundingClientRect: () => ({
        left: clientX,
        right: clientX,
        top: clientY,
        bottom: clientY,
        width: 0,
        height: 0
      })
    }, commands);
  }

  function sourceRows(originId) {
    const rows = visibleRows(currentView);
    return selection.ordered(rows, originId);
  }

  function isSelected(tab) {
    return selection.has(tab.logicalId);
  }

  // Selection is local UI state. Updating only aria-selected keeps the current
  // row and favicon image nodes connected while Shift/Ctrl/Command selection
  // changes, instead of requiring the presenter to reattach every image.
  function syncSelectionState() {
    for (const row of root.querySelectorAll(".tab-row")) {
      row.setAttribute("aria-selected", String(selection.has(row.dataset.tabId)));
    }
  }

  function moveFocus(current, key) {
    const targets = [...root.querySelectorAll(".tab-row, .tab-group-header")];
    const currentIndex = targets.indexOf(current);
    const nextIndex = key === "Home"
      ? 0
      : key === "End"
        ? targets.length - 1
        : Math.max(0, Math.min(targets.length - 1, currentIndex + (key === "ArrowUp" ? -1 : 1)));
    const next = targets[nextIndex];
    if (next) {
      current.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  }

  async function relocateRows(rows, destination, focusId = rows[0]?.logicalId) {
    if (!destination || rows.length === 0) {
      return;
    }
    pendingFocusId = focusId;
    await onRelocateTabs(rows.map(tabSourceDescriptor), destination);
  }

  function tabIdentity(tab) {
    return { logicalTabId: tab.logicalId, firefoxTabId: tab.firefoxId };
  }

  // Close takes each source tab with every tab nested under it.
  function closeCommand(sources, closure) {
    const tab = sources[0];
    let label = "Close tab";
    let target = { kind: "tab", ...tabIdentity(tab) };
    if (sources.length > 1) {
      label = `Close selected (${closure.length} tabs)`;
      target = { kind: "tabs", tabs: sources.map(tabIdentity) };
    } else if (closure.length > 1) {
      label = `Close branch (${closure.length} tabs)`;
      target = { kind: "branch", ...tabIdentity(tab) };
    }
    return { label, action: () => onCloseTarget(target), variant: "danger" };
  }

  function flattenCommands(sources) {
    const activeTabs = currentView.activeTabs;
    const parents = sources.filter((source) =>
      activeTabs.some(({ parentTabId }) => parentTabId === source.logicalId)
    );
    if (parents.length === 0) {
      return [];
    }
    const nested = new Set();
    for (const parent of parents) {
      for (const { logicalId } of withTreeDescendants(activeTabs, [parent])) {
        if (logicalId !== parent.logicalId) nested.add(logicalId);
      }
    }
    const label = sources.length > 1
      ? `Flatten selected (${nested.size} tabs)`
      : `Flatten branch (${nested.size + 1} tabs)`;
    return [{
      label,
      action: () => onFlattenBranch(parents.map(tabIdentity)),
      variant: "danger"
    }];
  }

  // A menu acts on the selection only when the clicked tab is part of it.
  // Moves, grouping, unload, and close carry every tab nested under the
  // sources; pinning moves exactly the sources.
  function tabCommands(tab) {
    const sources = sourceRows(tab.logicalId);
    const closure = withTreeDescendants(currentView.activeTabs, sources);
    const unload = { label: "Unload", action: () => onUnloadTabs(closure) };
    const flatten = flattenCommands(sources);
    const containerMove = canMoveToContainer()
      ? [{ label: "Move to container…", action: () => onMoveToContainer(sources) }]
      : [];
    const close = closeCommand(sources, closure);
    if (sources.some(({ splitViewId }) => splitViewId !== null)) {
      return [unload, ...flatten, ...containerMove, close];
    }
    const commands = [tab.pinned
      ? {
          label: "Unpin",
          action: () => relocateRows(
            closure,
            destinationForZone(tab.workspaceId, "ungrouped"),
            tab.logicalId
          )
        }
      : {
          label: "Pin",
          action: () => relocateRows(
            sources,
            destinationForZone(tab.workspaceId, "pinned"),
            tab.logicalId
          )
        }];
    if (!closure.some(({ splitViewId }) => splitViewId !== null)) {
      for (const [label, direction] of [["Move tab up", "up"], ["Move tab down", "down"]]) {
        const destination = tabMoveDestination(currentView, closure, tab, direction);
        if (destination) {
          commands.push({
            label,
            action: () => relocateRows(closure, destination, tab.logicalId)
          });
        }
      }
      commands.push({ label: "Create new group", action: () => onCreateGroup(closure) });
    }
    commands.push(...containerMove, unload, ...flatten, close);
    return commands;
  }

  function tabMenuContext(tab) {
    return { kind: "tab", id: tab.logicalId, key: menuKeyForTab(tab) };
  }

  function groupMenuContext(group) {
    return { kind: "group", id: group.id, key: menuKeyForGroup(group) };
  }

  function handleTabContext(anchor, tab) {
    openMenu(anchor, tabCommands(tab), tabMenuContext(tab));
  }

  function groupCommands(group) {
    const splitLocked = group.tabIds.some((tabId) =>
      currentView.activeTabs.find((tab) => tab.logicalId === tabId)?.splitViewId !== null
    );
    const up = groupMoveDestination(currentView, group, "up");
    const down = groupMoveDestination(currentView, group, "down");
    const source = groupSourceDescriptor(group, currentView.activeWorkspaceId);
    const members = groupMembers(group, currentView.activeTabs);
    return [
      {
        label: "Move group up",
        action: () => onRelocateGroup(source, up),
        disabled: splitLocked || !up
      },
      {
        label: "Move group down",
        action: () => onRelocateGroup(source, down),
        disabled: splitLocked || !down
      },
      {
        label: "Unload group",
        action: () => onUnloadTabs(members)
      },
      {
        label: "Rename group",
        action: () => onRenameGroup(group)
      },
      {
        label: "Delete group",
        action: () => onDeleteGroup(group.id),
        variant: "danger",
        disabled: splitLocked
      },
      {
        label: `Close group (${group.tabIds.length} tabs)`,
        action: () => onCloseTarget({ kind: "group", logicalGroupId: group.id }),
        variant: "danger"
      }
    ];
  }

  function markDrop(target, className) {
    target.classList.add(className);
    dropMarkedElements.add(target);
  }

  function clearDropMarkers() {
    for (const target of dropMarkedElements) {
      target.classList.remove("drop-before", "drop-after", "drop-inside", "drop-workspace");
    }
    dropMarkedElements.clear();
  }

  // The scroll container's viewport bounds are stable for the duration of one
  // drag, so they are read once per drag session instead of per pointer event.
  let autoScrollBoundsSession = null;
  let autoScrollBounds = null;

  function autoScroll(event) {
    if (autoScrollBoundsSession !== dragSession || autoScrollBounds === null) {
      autoScrollBounds = scrollRoot.getBoundingClientRect();
      autoScrollBoundsSession = dragSession;
    }
    const bounds = autoScrollBounds;
    if (event.clientY < bounds.top + 28) {
      scrollRoot.scrollBy({ top: -20, behavior: "auto" });
    } else if (event.clientY > bounds.bottom - 28) {
      scrollRoot.scrollBy({ top: 20, behavior: "auto" });
    }
  }

  // A drag carries whole trees. Only a drop that pins moves exactly the
  // dragged selection, matching Pin.
  function startTabDrag(event, tab) {
    const selected = sourceRows(tab.logicalId);
    const rows = withTreeDescendants(currentView.activeTabs, selected);
    if (rows.some(({ splitViewId }) => splitViewId !== null)) {
      event.preventDefault();
      dragSession = null;
      return;
    }
    dragSession = {
      kind: "tabs",
      sources: rows.map(tabSourceDescriptor),
      rows,
      selected,
      tabIds: new Set(rows.map(({ logicalId }) => logicalId))
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PRIVATE_DRAG_TYPE, crypto.randomUUID());
  }

  function dropTabs(destination) {
    const session = dragSession;
    return relocateRows(
      destination?.zone === "pinned" ? session.selected : session.rows,
      destination
    );
  }

  function startGroupDrag(event, group) {
    dragSession = {
      kind: "group",
      source: groupSourceDescriptor(group, currentView.activeWorkspaceId)
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PRIVATE_DRAG_TYPE, crypto.randomUUID());
  }

  function bindRowDrop(row, tab) {
    row.addEventListener("dragover", (event) => {
      if (!dragSession) return;
      if (dragSession.kind === "group" && tab.pinned) return;
      if (dragSession.kind === "tabs" && dragSession.tabIds.has(tab.logicalId)) return;
      event.preventDefault();
      autoScroll(event);
      clearDropMarkers();
      const rowBounds = row.getBoundingClientRect();
      const ratio = (event.clientY - rowBounds.top) / rowBounds.height;
      let relation = dragSession.kind === "group"
        ? ratio < 0.5 ? "before" : "after"
        : ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
      if (tab.splitViewId !== null) {
        relation = tab.splitPosition === "start" ? "before" : "after";
      }
      if (relation === "inside" && tab.pinned) {
        markDrop(row, ratio < 0.5 ? "drop-before" : "drop-after");
      } else {
        markDrop(row, `drop-${relation}`);
      }
      row.dataset.dropRelation = relation === "inside" && tab.pinned
        ? ratio < 0.5 ? "before" : "after"
        : relation;
    });
    row.addEventListener("drop", (event) => {
      if (!dragSession) return;
      event.preventDefault();
      const relation = row.dataset.dropRelation;
      clearDropMarkers();
      if (dragSession.kind === "tabs") {
        if (!dragSession.tabIds.has(tab.logicalId)) {
          void dropTabs(destinationForTabRow(tab, relation));
        }
      } else {
        void onRelocateGroup(dragSession.source, snapGroupDropToBranch(currentView, tab, relation));
      }
      dragSession = null;
    });
  }

  function rowKeyFor(tab, childCount, descendants, branchShape) {
    return JSON.stringify([
      tab,
      childCount,
      descendants ?? null,
      branchShape ?? null,
      currentWorkspaceColor
    ]);
  }

  function renderTab(
    tab,
    childCount,
    descendants = null,
    branchShape = null
  ) {
    const workspaceColor = currentWorkspaceColor;
    const rowKey = rowKeyFor(tab, childCount, descendants, branchShape);
    const reusable = rowsByTabId.get(tab.logicalId);
    if (reusable?.key === rowKey && !nextRowsByTabId.has(tab.logicalId)) {
      reusable.row.setAttribute("aria-selected", String(isSelected(tab)));
      nextRowsByTabId.set(tab.logicalId, reusable);
      return reusable.row;
    }
    const hiddenBranch = !tab.pinned && tab.collapsed && descendants?.count > 0
      ? descendants
      : null;
    const row = element("div", tab.splitViewId === null ? "tab-row" : "tab-row tab-row--split");
    row.dataset.tabId = tab.logicalId;
    row.dataset.firefoxTabId = String(tab.firefoxId);
    row.dataset.groupId = tab.groupId ?? "";
    row.dataset.splitViewId = tab.splitViewId ?? "";
    row.dataset.splitPosition = tab.splitPosition ?? "";
    row.dataset.unloadTarget = "tab";
    row.dataset.hasCount = String(hiddenBranch !== null);
    row.draggable = tab.splitViewId === null;
    row.tabIndex = tab.active ? 0 : -1;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(tab.depth + 1));
    row.setAttribute("aria-selected", String(isSelected(tab)));
    row.setAttribute("aria-current", tab.active ? "page" : "false");
    row.setAttribute(
      "aria-label",
      [tab.title, rowStatusLabel(tab), hiddenBranch ? hiddenBranchLabel(hiddenBranch) : ""]
        .filter(Boolean)
        .join(", ")
    );
    const branch = tab.pinned ? null : branchShape;
    // The drawn branch owns the indent, so depth follows its column count
    // rather than the semantic level, which aria-level still carries.
    row.style.setProperty("--tree-depth", String(branch?.depth ?? 0));
    if (branch) {
      row.dataset.nested = "true";
      row.append(treeBranch(branch));
    }

    const disclosure = element("button", "tab-disclosure");
    disclosure.type = "button";
    disclosure.disabled = childCount === 0 || tab.pinned;
    disclosure.setAttribute("aria-label", tab.collapsed ? "Expand tab branch" : "Collapse tab branch");
    disclosure.setAttribute("aria-expanded", String(!tab.collapsed));
    disclosure.textContent = childCount === 0 || tab.pinned ? "" : tab.collapsed ? "▸" : "▾";
    disclosure.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingFocusId = tab.logicalId;
      void onSetTreeCollapsed(tab.logicalId, !tab.collapsed);
    });

    const favicon = element("span", "tab-favicon tab-favicon--fallback");
    favicon.setAttribute("aria-hidden", "true");
    const internalIcon = INTERNAL_PAGE_ICONS[tab.internalPage];
    if (internalIcon) {
      // Terminus' own pages have no website icon and never reach the favicon
      // cache, so the packaged extension mark stands in for one instead of a
      // letter tile built from the title.
      favicon.classList.add("tab-favicon--internal");
      const image = element("img", "tab-favicon-image");
      image.src = internalIcon;
      image.alt = "";
      image.draggable = false;
      favicon.append(image);
    } else {
      const fallback = faviconFallback(tab.title, tab.logicalId);
      favicon.style.setProperty("--favicon-fallback-color", fallback.color);
      favicon.textContent = fallback.initial;
    }
    const splitIndicator = element("span", "tab-split-indicator");
    splitIndicator.setAttribute("aria-hidden", "true");
    const title = element("span", "tab-title");
    title.textContent = tab.title;
    let stateIndicator = null;
    if (tab.container.kind === "container") {
      stateIndicator = element("span", "tab-container-marker");
      const label = tab.container.descriptor?.name ?? "Unavailable container";
      stateIndicator.dataset.status = tab.container.status;
      stateIndicator.dataset.loadState = tab.discarded ? "unloaded" : "loaded";
      stateIndicator.style.setProperty(
        "--tab-container-color",
        tab.container.descriptor?.colorCode ?? workspaceColor
      );
      stateIndicator.title = tab.container.status === "available"
        ? `Firefox container: ${label}`
        : `Firefox container unavailable: ${label}`;
      stateIndicator.setAttribute("aria-label", stateIndicator.title);
    } else if (!hiddenBranch) {
      stateIndicator = element("span", "tab-load-state");
      stateIndicator.dataset.loadState = tab.discarded ? "unloaded" : "loaded";
      stateIndicator.title = tab.discarded ? "Unloaded tab" : "Loaded tab";
      stateIndicator.setAttribute("aria-hidden", "true");
    }
    const audioStatus = element("span", "tab-audio-state");
    audioStatus.setAttribute("aria-hidden", "true");
    audioStatus.textContent = tab.muted ? "⌁" : tab.audible ? "♪" : "";
    const menuButton = element("button", "tab-menu-button");
    menuButton.type = "button";
    menuButton.setAttribute("aria-label", `Actions for ${tab.title}`);
    menuButton.textContent = "⋯";
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(menuButton, tabCommands(tab), tabMenuContext(tab));
    });
    let statusOwner = stateIndicator;
    if (hiddenBranch) {
      const count = countBadge(
        hiddenBranch.count,
        hiddenBranch.anyLoaded ? "loaded" : "unloaded"
      );
      if (stateIndicator) {
        statusOwner = element("span", "tab-status-owner");
        statusOwner.append(stateIndicator, count);
      } else {
        statusOwner = count;
      }
    }
    row.append(
      disclosure,
      favicon,
      splitIndicator,
      title,
      audioStatus,
      ...(statusOwner ? [statusOwner] : []),
      menuButton
    );

    row.addEventListener("click", async (event) => {
      if (event.target.closest("button")) return;
      if (shouldToggleTreeFromFavicon({
        targetIsFavicon: Boolean(event.target.closest(".tab-favicon")),
        iconsOnly: isIconsOnly(),
        hasChildren: childCount > 0,
        pinned: tab.pinned,
        modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      })) {
        pendingFocusId = tab.logicalId;
        await onSetTreeCollapsed(tab.logicalId, !tab.collapsed);
        return;
      }
      selection.update(tab.logicalId, visibleRows(currentView).map(({ logicalId }) => logicalId), {
        toggle: event.ctrlKey || event.metaKey,
        range: event.shiftKey
      });
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        pendingFocusId = tab.logicalId;
        if (isIconsOnly() && childCount > 0 && tab.active) {
          await onSetTreeCollapsed(tab.logicalId, !tab.collapsed);
        } else {
          const activated = await onActivate(tab.logicalId, tab.firefoxId);
          if (activated !== false && isIconsOnly() && childCount > 0 && tab.collapsed) {
            pendingFocusId = tab.logicalId;
            await onSetTreeCollapsed(tab.logicalId, false);
          }
        }
      } else {
        pendingFocusId = tab.logicalId;
        syncSelectionState();
        row.focus({ preventScroll: true });
        pendingFocusId = null;
      }
    });
    row.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        moveFocus(row, event.key);
      } else if (event.key === "Enter") {
        event.preventDefault();
        pendingFocusId = tab.logicalId;
        void onActivate(tab.logicalId, tab.firefoxId);
      } else if (event.key === " ") {
        event.preventDefault();
        selection.update(tab.logicalId, visibleRows(currentView).map(({ logicalId }) => logicalId), {
          toggle: true
        });
        syncSelectionState();
      } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        handleTabContext(row, tab);
      }
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleTabContext(row, tab);
    });
    if (tab.splitViewId === null) {
      row.addEventListener("dragstart", (event) => startTabDrag(event, tab));
    }
    row.addEventListener("dragend", () => {
      dragSession = null;
      clearDropMarkers();
    });
    bindRowDrop(row, tab);
    nextRowsByTabId.set(tab.logicalId, { key: rowKey, row });
    return row;
  }

  function renderGroup(
    group,
    tabById,
    childCounts,
    descendantSummaries,
    branchShapes
  ) {
    const splitLocked = group.tabIds.some((tabId) => tabById.get(tabId)?.splitViewId !== null);
    const loadState = groupLoadState(groupMembers(group, currentView.activeTabs));
    const memberInputs = group.collapsed
      ? []
      : group.tabIds
        .map((tabId) => tabById.get(tabId))
        .filter((tab) => tab && !tab.hiddenByCollapsedAncestor)
        .map((tab) => [
          tab,
          childCounts.get(tab.logicalId) ?? 0,
          descendantSummaries.get(tab.logicalId),
          branchShapes.get(tab.logicalId) ?? null
        ]);
    const groupKey = JSON.stringify([
      group,
      splitLocked,
      loadState,
      memberInputs.map(([tab, childCount, descendants, branchShape]) =>
        rowKeyFor(tab, childCount, descendants, branchShape))
    ]);
    const reusableGroup = groupsById.get(group.id);
    if (
      reusableGroup?.key === groupKey &&
      !nextGroupsById.has(group.id) &&
      reusableGroup.memberRows.every(({ logicalId }) => !nextRowsByTabId.has(logicalId))
    ) {
      for (const { logicalId, entry } of reusableGroup.memberRows) {
        entry.row.setAttribute("aria-selected", String(selection.has(logicalId)));
        nextRowsByTabId.set(logicalId, entry);
      }
      nextGroupsById.set(group.id, reusableGroup);
      return reusableGroup.section;
    }
    const section = element("section", "tab-group");
    section.dataset.groupId = group.id;
    section.dataset.groupColor = group.color;
    section.style.setProperty("--group-color", groupColorToken(group.color));
    const header = element("div", "tab-group-header");
    header.dataset.groupId = group.id;
    header.dataset.unloadTarget = "group";
    header.dataset.loadState = loadState;
    header.dataset.hasCount = String(group.collapsed);
    header.draggable = !splitLocked;
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", String(!group.collapsed));
    header.setAttribute(
      "aria-label",
      `${group.title || "Unnamed group"}, ${group.tabIds.length} tabs, ${GROUP_LOAD_STATE_LABELS[loadState]}`
    );
    const disclosure = element("span", "group-disclosure");
    disclosure.setAttribute("aria-hidden", "true");
    disclosure.textContent = group.collapsed ? "▸" : "▾";
    const icon = element("span", "group-icon");
    icon.dataset.loadState = loadState === "unloaded" ? "unloaded" : "loaded";
    icon.setAttribute("aria-hidden", "true");
    const label = element("span", "group-title");
    label.textContent = group.title;
    const actions = element("button", "group-menu-button");
    actions.type = "button";
    actions.setAttribute("aria-label", `Actions for ${group.title || "unnamed group"}`);
    actions.textContent = "⋯";
    actions.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(actions, groupCommands(group), groupMenuContext(group));
    });
    header.append(disclosure, icon, label);
    if (group.collapsed) {
      header.append(countBadge(
        group.tabIds.length,
        loadState === "unloaded" ? "unloaded" : "loaded"
      ));
    }
    header.append(actions);
    const toggle = () => {
      pendingFocusId = `group:${group.id}`;
      void onSetGroupCollapsed(group.id, !group.collapsed);
    };
    header.addEventListener("click", (event) => {
      if (!event.target.closest("button")) toggle();
    });
    header.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        moveFocus(header, event.key);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        openMenu(header, groupCommands(group), groupMenuContext(group));
      }
    });
    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(header, groupCommands(group), groupMenuContext(group));
    });
    if (!splitLocked) {
      header.addEventListener("dragstart", (event) => startGroupDrag(event, group));
    }
    header.addEventListener("dragover", (event) => {
      if (dragSession?.kind !== "tabs") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      autoScroll(event);
      clearDropMarkers();
      markDrop(header, "drop-inside");
    });
    header.addEventListener("drop", (event) => {
      if (dragSession?.kind !== "tabs") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void dropTabs(destinationForZone(currentView.activeWorkspaceId, "group", group.id));
      dragSession = null;
      clearDropMarkers();
    });
    header.addEventListener("dragend", () => {
      dragSession = null;
      clearDropMarkers();
    });
    section.append(header);
    const memberRows = [];
    for (const [tab, childCount, descendants, branchShape] of memberInputs) {
      section.append(renderTab(tab, childCount, descendants, branchShape));
      memberRows.push({
        logicalId: tab.logicalId,
        entry: nextRowsByTabId.get(tab.logicalId)
      });
    }
    nextGroupsById.set(group.id, { key: groupKey, section, memberRows });
    return section;
  }

  function bindZoneDrop(zone, zoneName, groupId = null) {
    zone.addEventListener("dragover", (event) => {
      if (dragSession?.kind !== "tabs" || event.target !== zone) return;
      event.preventDefault();
      clearDropMarkers();
      markDrop(zone, "drop-inside");
    });
    zone.addEventListener("drop", (event) => {
      if (dragSession?.kind !== "tabs" || event.target !== zone) return;
      event.preventDefault();
      void dropTabs(destinationForZone(currentView.activeWorkspaceId, zoneName, groupId));
      dragSession = null;
      clearDropMarkers();
    });
  }

  function ensureZones() {
    if (pinnedZone !== null) {
      return;
    }
    pinnedZone = element("section", "tab-zone tab-zone--pinned");
    pinnedZone.setAttribute("aria-label", "Pinned tabs");
    const pinnedLabel = element("h2", "tab-zone-title");
    pinnedLabel.textContent = "Pinned tabs";
    pinnedZone.append(pinnedLabel);
    bindZoneDrop(pinnedZone, "pinned");
    mainZone = element("section", "tab-zone tab-zone--main");
    mainZone.setAttribute("aria-label", "Workspace tabs");
    bindZoneDrop(mainZone, "ungrouped");
    root.replaceChildren(pinnedZone, mainZone);
  }

  // Standard keyed child reconciliation: a node already at its position costs
  // nothing, so unchanged rows stay attached and only real changes touch the
  // DOM. `firstManagedIndex` protects the pinned zone's persistent heading.
  function reconcileChildren(parent, desired, firstManagedIndex = 0) {
    let index = firstManagedIndex;
    for (const node of desired) {
      const current = parent.children[index];
      if (current !== node) {
        parent.insertBefore(node, current ?? null);
      }
      index += 1;
    }
    while (parent.children.length > index) {
      parent.removeChild(parent.children[parent.children.length - 1]);
    }
  }

  function render(view) {
    currentView = view;
    currentWorkspaceColor = view.state.workspaces.find(
      ({ id }) => id === view.activeWorkspaceId
    )?.color ?? "currentColor";
    ensureZones();
    clearDropMarkers();
    root.dataset.empty = String(view.activeTabs.length === 0 && view.activeGroups.length === 0);
    selection.reset(view.activeWorkspaceId);
    const tabById = new Map(view.activeTabs.map((tab) => [tab.logicalId, tab]));
    const groupById = new Map(view.activeGroups.map((group) => [group.id, group]));
    const childCounts = new Map();
    for (const tab of view.activeTabs) {
      if (tab.parentTabId !== null) {
        childCounts.set(tab.parentTabId, (childCounts.get(tab.parentTabId) ?? 0) + 1);
      }
    }
    const descendantSummaries = treeDescendantSummary(view.activeTabs);
    const branchShapes = treeBranchShape(view.activeTabs);
    nextRowsByTabId = new Map();
    nextGroupsById = new Map();
    const pinnedRows = [];
    for (const tab of view.activeTabs.filter(({ pinned: isPinned }) => isPinned)) {
      pinnedRows.push(renderTab(tab, 0, null, null));
    }
    const mainChildren = [];
    const emittedGroups = new Set();
    for (const tab of view.activeTabs.filter(({ pinned: isPinned }) => !isPinned)) {
      if (tab.groupId !== null) {
        if (!emittedGroups.has(tab.groupId)) {
          const group = groupById.get(tab.groupId);
          if (group) {
            mainChildren.push(renderGroup(
              group,
              tabById,
              childCounts,
              descendantSummaries,
              branchShapes
            ));
          }
          emittedGroups.add(tab.groupId);
        }
      } else if (!tab.hiddenByCollapsedAncestor) {
        mainChildren.push(renderTab(
          tab,
          childCounts.get(tab.logicalId) ?? 0,
          descendantSummaries.get(tab.logicalId),
          branchShapes.get(tab.logicalId) ?? null
        ));
      }
    }
    reconcileChildren(pinnedZone, pinnedRows, 1);
    reconcileChildren(mainZone, mainChildren);
    rowsByTabId = nextRowsByTabId;
    groupsById = nextGroupsById;
    root.setAttribute("aria-busy", "false");
    reconcileMenu();
    if (pendingFocusId) {
      const selector = pendingFocusId.startsWith("group:")
        ? `[data-group-id="${CSS.escape(pendingFocusId.slice(6))}"] > .tab-group-header`
        : `[data-tab-id="${CSS.escape(pendingFocusId)}"]`;
      root.querySelector(selector)?.focus({ preventScroll: true });
      pendingFocusId = null;
    }
  }

  function bindWorkspaceDrop(button, workspaceId) {
    button.addEventListener("dragover", (event) => {
      const acceptsNative =
        !dragSession && onAcceptNativeDrop(event.dataTransfer, workspaceId);
      if (!dragSession && !acceptsNative) return;
      event.preventDefault();
      const rail = button.closest(".workspace-rail");
      const bounds = rail?.getBoundingClientRect();
      if (rail && bounds) {
        if (event.clientY < bounds.top + 32) rail.scrollBy({ top: -24, behavior: "auto" });
        if (event.clientY > bounds.bottom - 32) rail.scrollBy({ top: 24, behavior: "auto" });
      }
      clearDropMarkers();
      markDrop(button, "drop-workspace");
    });
    button.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && button.contains(event.relatedTarget)) {
        return;
      }
      button.classList.remove("drop-workspace");
      if (!dragSession) {
        onCancelNativeDrop();
      }
    });
    button.addEventListener("drop", (event) => {
      if (!dragSession) {
        if (!onRelocateNativeSelection(event.dataTransfer, workspaceId)) {
          return;
        }
        event.preventDefault();
        clearDropMarkers();
        return;
      }
      event.preventDefault();
      if (dragSession.kind === "tabs") {
        void dropTabs(destinationForWorkspace(workspaceId, dragSession.sources));
      } else {
        void onRelocateGroup(
          dragSession.source,
          groupDestinationForWorkspace(workspaceId)
        );
      }
      dragSession = null;
      clearDropMarkers();
    });
  }

  function unloadTarget(target) {
    if (!currentView || !target || typeof target.dataset !== "object") return false;
    const logicalId = target.dataset.tabId;
    if (!logicalId || !currentView.activeTabs.some((tab) => tab.logicalId === logicalId)) {
      return false;
    }
    return onUnloadTabs(withTreeDescendants(currentView.activeTabs, sourceRows(logicalId)));
  }

  function unloadGroupTarget(target) {
    if (!currentView || !target || typeof target.dataset !== "object") return false;
    const group = currentView.activeGroups.find(({ id }) => id === target.dataset.groupId);
    if (!group) return false;
    const members = groupMembers(group, currentView.activeTabs);
    return members.length === 0 ? false : onUnloadTabs(members);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!commandMenu.hidden && !commandMenu.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !commandMenu.hidden) {
      closeMenu();
      root.querySelector(`[data-tab-id="${CSS.escape(pendingFocusId ?? "")}"]`)?.focus();
    }
  });
  window.addEventListener("resize", closeMenu);
  document.addEventListener("dragend", onCancelNativeDrop);
  document.addEventListener("drop", onCancelNativeDrop);
  document.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) {
      onCancelNativeDrop();
    }
  });

  return {
    render,
    bindWorkspaceDrop,
    unloadTarget,
    unloadGroupTarget,
    isDragging: () => dragSession !== null,
    openMenu,
    openMenuAtPoint,
    closeMenu,
    externalMenuContext: () =>
      openMenuContext?.kind === "external" && !commandMenu.hidden
        ? { id: openMenuContext.id, key: openMenuContext.key }
        : null
  };
}

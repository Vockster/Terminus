import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WORKSPACE_STATE_STORAGE_KEY
} from "../contracts/workspace-state.js";
import { CUSTOM_ICON_MESSAGE_TYPES } from "../contracts/custom-icons.js";
import { createCustomIconClient } from "../ui/custom-icon-client.js";
import { CustomIconUrlCache } from "../ui/custom-icon-urls.js";
import { presentWorkspaceIcon } from "../ui/workspace-icon-presentation.js";
import { SETTINGS_MESSAGE_TYPES } from "../contracts/settings-messages.js";
import {
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_ERROR_MESSAGES,
  SETTINGS_STATE_STORAGE_KEY,
  parseSettingsState
} from "../contracts/settings-state.js";
import { WORKSPACE_MESSAGE_TYPES } from "../contracts/workspace-messages.js";
import { parseWorkspaceSearchIndex } from "../contracts/workspace-search.js";
import {
  SIDEBAR_UNDO_ACTIONS,
  SIDEBAR_UNDO_MESSAGE_TYPES,
  parseSidebarUndoOutcome,
  parseSidebarUndoSummary
} from "../contracts/sidebar-undo.js";
import { parseWorkspaceOperationOutcome } from "../contracts/workspace-operation.js";
import { workspaceNoticeText } from "./workspace-notice-text.js";
import {
  parseTabCloseOutcome,
  parseTabClosePreflight
} from "../contracts/tab-close.js";
import { parseTabContainerMoveOutcome } from "../contracts/tab-container-move.js";
import {
  containerMoveAssignment,
  createContainerMoveDialog
} from "./container-move-dialog.js";
import {
  parseWorkspaceLoadOutcome,
  parseWorkspaceUnloadOutcome,
  parseWorkspaceView
} from "../contracts/workspace-view.js";
import { applySidebarSettings } from "../ui/sidebar-settings.js";
import { applySidebarAppearance } from "../ui/sidebar-appearance.js";
import { NEW_WORKSPACE_FIELDS } from "../core/workspace-defaults.js";
import { createFirefoxThemeSource } from "../platform/firefox/theme-source.js";
import { createNativeTabDropResolver } from "./native-tab-drop.js";
import { addWorkspaceNeedsDivider, createdWorkspace } from "./sidebar-interactions.js";
import { createTabPane } from "./tab-pane.js";
import { createTabRenderCoordinator } from "./tab-render-coordinator.js";
import { createTabSearchController } from "./tab-search.js";
import { FaviconPresenter, faviconFallback } from "./favicon-presenter.js";
import {
  countBadgeText
} from "../ui/count-badge.js";
import {
  createMiddleClickUnloadController,
  createUnloadTargetRouter
} from "./middle-click-unload.js";
import { FAVICON_MESSAGE_TYPES } from "../contracts/favicon-messages.js";
import { CONTAINER_MESSAGE_TYPES } from "../contracts/container-messages.js";
import {
  CONTAINER_ERROR_CODES,
  CONTAINER_ERROR_MESSAGES,
  uniqueAvailableContainerEntries
} from "../contracts/containers.js";

const workspaceList = document.querySelector("#workspace-list");
const workspaceNavigation = document.querySelector(".workspace-navigation");
const tabList = document.querySelector("#tab-list");
const tabScroll = document.querySelector("#tab-scroll");
const tabPaneElement = document.querySelector(".tab-pane");
const tabSearchRegion = document.querySelector("#tab-search");
const tabSearchToggle = document.querySelector("#tab-search-toggle");
const tabSearchResults = document.querySelector("#tab-search-results");
const tabFooter = document.querySelector("#tab-footer");
const workspaceStatus = document.querySelector("#workspace-status");
const settingsButton = document.querySelector("#open-settings");
const commandMenu = document.querySelector("#sidebar-command-menu");
const newTabButton = document.querySelector("#new-workspace-tab");
const undoSidebarButton = document.querySelector("#undo-sidebar-action");
const undoSidebarLabel = undoSidebarButton.querySelector(".undo-sidebar-label");
const renameWorkspaceDialog = document.querySelector("#rename-workspace-dialog");
const renameWorkspaceForm = document.querySelector("#rename-workspace-form");
const renameWorkspaceInput = document.querySelector("#rename-workspace-input");
const cancelWorkspaceRenameButton = document.querySelector("#cancel-workspace-rename");
const renameGroupDialog = document.querySelector("#rename-group-dialog");
const renameGroupForm = document.querySelector("#rename-group-form");
const renameGroupInput = document.querySelector("#rename-group-input");
const cancelGroupRenameButton = document.querySelector("#cancel-group-rename");
const loadTabsDialog = document.querySelector("#load-tabs-dialog");
const loadTabsForm = document.querySelector("#load-tabs-form");
const loadTabsDetails = document.querySelector("#load-tabs-details");
const skipManyTabLoadWarning = document.querySelector("#skip-many-tab-load-warning");
const cancelTabLoadButton = document.querySelector("#cancel-tab-load");
const closeTabsDialog = document.querySelector("#close-tabs-dialog");
const closeTabsForm = document.querySelector("#close-tabs-form");
const closeTabsTitle = document.querySelector("#close-tabs-title");
const closeTabsDetails = document.querySelector("#close-tabs-details");
const skipMultipleTabCloseWarning = document.querySelector("#skip-multiple-tab-close-warning");
const confirmTabClosureButton = document.querySelector("#confirm-tab-closure");
const cancelTabClosureButton = document.querySelector("#cancel-tab-closure");
let currentWindowId;
let currentWindowIncognito = null;
let faviconLookupsEnabled = true;
let shownRefreshSignature = null;
let currentView;
// Rail entries reuse their rendered nodes exactly like tab rows: an entry
// whose rendered inputs are unchanged keeps its element, listeners, and icon.
let railNodesByKey = new Map();
let mutationInFlight = false;
let refreshQueued = false;
let refreshRunning = false;
let requestSequence = 0;
let settingsRequestSequence = 0;
let appearanceRequestSequence = 0;
let containerRequestSequence = 0;
let customIconRequestSequence = 0;
let undoRequestSequence = 0;
let switchMotionSequence = 0;
let currentSettings;
let currentContainers = {
  capability: "permission-required",
  containers: [],
  supportedColors: [],
  supportedIcons: []
};
let themeSource;
let nativeTabDropResolver;
let workspaceDragSession = null;
let renameWorkspaceId = null;
let renameGroupId = null;
let closePreflight = null;
let currentUndoScope = null;
let currentUndoSummary = parseSidebarUndoSummary({
  available: false,
  undoId: null,
  operation: null,
  label: null,
  action: null
});
const colorSchemeQuery = matchMedia("(prefers-color-scheme: dark)");
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const tabPane = createTabPane({
  root: tabList,
  scrollRoot: tabScroll,
  commandMenu,
  onActivate: activateTab,
  onRelocateTabs: relocateTabs,
  onRelocateGroup: relocateGroup,
  onDropTabs: (sources, destination) => enqueueDrop(() => relocateTabs(sources, destination)),
  onDropGroup: (source, destination) => enqueueDrop(() => relocateGroup(source, destination)),
  onRenameGroup: openGroupRename,
  onDeleteGroup: deleteTabGroup,
  onCreateGroup: createTabGroup,
  onUnloadTabs: unloadTabs,
  onFlattenBranch: flattenTreeBranch,
  onCloseTarget: prepareTabClosure,
  onMoveToContainer: (sources) => containerMoveDialog.open(sources, currentContainers.containers),
  canMoveToContainer: () =>
    currentWindowIncognito === false && currentContainers.capability === "available",
  onAcceptNativeDrop: acceptNativeTabDrop,
  onRelocateNativeSelection: relocateNativeSelection,
  onCancelNativeDrop: cancelNativeTabDrop,
  onSetTreeCollapsed: setTreeCollapsed,
  onSetGroupCollapsed: setGroupCollapsed,
  getGlobalCommands: undoMenuCommands,
  isIconsOnly: () => currentSettings?.appearance?.contentMode === "icons"
});
const containerMoveDialog = createContainerMoveDialog({
  document,
  dialog: document.querySelector("#move-container-dialog"),
  form: document.querySelector("#move-container-form"),
  list: document.querySelector("#move-container-choices"),
  submitButton: document.querySelector("#confirm-container-move"),
  cancelButton: document.querySelector("#cancel-container-move"),
  onMove: moveTabsToContainer,
  onClose: (sources) => {
    if (sources.length > 0) {
      tabList.querySelector(
        `[data-tab-id="${CSS.escape(sources[0].logicalId)}"]`
      )?.focus({ preventScroll: true });
    }
  }
});
const faviconPresenter = new FaviconPresenter({
  root: tabScroll,
  lookupEnabled: () => faviconLookupsEnabled,
  onDiagnostic: (reason) => console.debug("[Terminus favicon]", reason)
});
const tabRenderCoordinator = createTabRenderCoordinator({
  tabPane,
  searchRoot: tabSearchResults,
  faviconPresenter,
  getWindowId: () => currentWindowId
});
const customIconUrls = new CustomIconUrlCache();
const customIconClient = createCustomIconClient();
const tabSearch = createTabSearchController({
  document,
  elements: {
    pane: tabPaneElement,
    region: tabSearchRegion,
    toggle: tabSearchToggle,
    controls: document.querySelector("#tab-search-controls"),
    input: document.querySelector("#tab-search-input"),
    clear: document.querySelector("#tab-search-clear"),
    scope: document.querySelector("#tab-search-scope"),
    results: tabSearchResults,
    tree: tabList,
    scroll: tabScroll,
    footer: tabFooter
  },
  loadIndex: loadTabSearchIndex,
  parseIndex: parseWorkspaceSearchIndex,
  createWorkspaceIndicator: searchWorkspaceIndicator,
  createFavicon: searchResultFavicon,
  presentResults: (search) => tabRenderCoordinator.renderSearch(search),
  showTree: (view) => tabRenderCoordinator.showTree(view),
  activateResult: activateSearchResult,
  focusActivatedTab
});

function pluralTabs(count) {
  return count === 1 ? "tab" : "tabs";
}

function unavailableUndoSummary() {
  return parseSidebarUndoSummary({
    available: false,
    undoId: null,
    operation: null,
    label: null,
    action: null
  });
}

function renderUndoControl() {
  const available = currentUndoSummary.available === true;
  undoSidebarButton.hidden = !available;
  undoSidebarButton.disabled = mutationInFlight || !available;
  if (!available) {
    undoSidebarLabel.textContent = "";
    undoSidebarButton.removeAttribute("aria-label");
    undoSidebarButton.removeAttribute("title");
    undoSidebarButton.removeAttribute("data-action");
    return;
  }
  const label = currentUndoSummary.action === SIDEBAR_UNDO_ACTIONS.REDO ? "Redo" : "Undo";
  undoSidebarLabel.textContent = label;
  undoSidebarButton.setAttribute("aria-label", label);
  undoSidebarButton.title = label;
  undoSidebarButton.dataset.action = currentUndoSummary.action;
}

function undoMenuCommands() {
  if (!currentUndoSummary.available) {
    return [{
      label: "Nothing to undo",
      action: () => undefined,
      disabled: true
    }];
  }
  return [{
    label: currentUndoSummary.action === SIDEBAR_UNDO_ACTIONS.REDO ? "Redo" : "Undo",
    action: executeSidebarUndo
  }];
}

function showUndoOutcome(outcome, action) {
  const actionLabel = action === SIDEBAR_UNDO_ACTIONS.REDO ? "Redo" : "Undo";
  if (outcome.status === "applied") {
    const approximation = outcome.approximatedCount > 0
      ? ` ${outcome.approximatedCount} ${pluralTabs(outcome.approximatedCount)} required a safe approximation.`
      : "";
    const retained = outcome.retainedSafetyCount > 0
      ? ` ${outcome.retainedSafetyCount} Firefox safety ${pluralTabs(outcome.retainedSafetyCount)} remained open.`
      : "";
    showStatus(`${actionLabel} completed.${approximation}${retained}`, "quiet");
    return;
  }
  if (outcome.status === "partial") {
    showStatus(
      `${actionLabel} changed ${outcome.restoredCount} of ${outcome.requestedCount} items; ${outcome.skippedCount + outcome.failedCount} could not be changed safely.`,
      "warning"
    );
    return;
  }
  if (outcome.status === "skipped") {
    showStatus("Nothing was changed because the sidebar state changed after that action.", "warning");
    return;
  }
  showStatus(`Firefox could not complete the ${actionLabel} action.`, "error");
}

async function loadUndoSummary() {
  if (!Number.isInteger(currentWindowId)) return false;
  const sequence = ++undoRequestSequence;
  try {
    const response = await browser.runtime.sendMessage({
      type: SIDEBAR_UNDO_MESSAGE_TYPES.GET,
      windowId: currentWindowId
    });
    if (sequence !== undoRequestSequence) return false;
    if (
      !response || response.ok !== true ||
      !["normal", "private"].includes(response.scope)
    ) {
      throw new TypeError("Invalid sidebar Undo summary response.");
    }
    currentUndoScope = response.scope;
    currentUndoSummary = parseSidebarUndoSummary(response.summary);
    renderUndoControl();
    return true;
  } catch {
    if (sequence !== undoRequestSequence) return false;
    currentUndoScope = null;
    currentUndoSummary = unavailableUndoSummary();
    renderUndoControl();
    return false;
  }
}

async function executeSidebarUndo() {
  if (!currentUndoSummary.available || mutationInFlight) return false;
  const undoSequence = ++undoRequestSequence;
  const undoId = currentUndoSummary.undoId;
  const action = currentUndoSummary.action;
  currentUndoSummary = unavailableUndoSummary();
  renderUndoControl();
  const applied = await runMutation(
    {
      type: SIDEBAR_UNDO_MESSAGE_TYPES.EXECUTE,
      windowId: currentWindowId,
      undoId
    },
    `${action === SIDEBAR_UNDO_ACTIONS.REDO ? "Redoing" : "Undoing"} the last sidebar action...`,
    (response) => {
      if (undoSequence === undoRequestSequence) {
        currentUndoSummary = parseSidebarUndoSummary(response.summary);
        renderUndoControl();
      }
      showView(response.view);
      showUndoOutcome(parseSidebarUndoOutcome(response.outcome), action);
      queueMicrotask(() => newTabButton.focus({ preventScroll: true }));
    }
  );
  if (!applied) {
    await loadUndoSummary();
  }
  return applied;
}

// Built-in icons are masks painted in the workspace color; custom images are
// drawn as they are. The draggable button keeps its drag, not the image's.
function workspaceIconElement(workspace) {
  const presentation = presentWorkspaceIcon(workspace.icon, customIconUrls);
  if (presentation.kind === "image") {
    const image = document.createElement("img");
    image.className = "workspace-icon workspace-icon--image";
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.src = presentation.url;
    return image;
  }
  const icon = document.createElement("span");
  icon.className = "workspace-icon";
  icon.style.setProperty("--workspace-mask", `url("${presentation.path}")`);
  icon.style.setProperty("--workspace-icon-optical-scale", String(presentation.opticalScale));
  return icon;
}

function searchWorkspaceIndicator(workspace) {
  const indicator = document.createElement("span");
  indicator.className = "tab-search-result-workspace";
  indicator.style.setProperty("--workspace-color", workspace.color);
  indicator.title = workspace.name;
  indicator.setAttribute("aria-hidden", "true");
  const defaultContainer = workspace.container ?? (
    workspace.defaultContainerRef === null
      ? { kind: "none" }
      : currentContainers.containers.find(
        ({ refId }) => refId === workspace.defaultContainerRef
      ) ?? null
  );
  if (defaultContainer?.kind === "container" && defaultContainer.status === "available") {
    const containerColor = defaultContainer.descriptor?.colorCode;
    indicator.dataset.containerStatus = "available";
    if (typeof containerColor === "string") {
      indicator.style.setProperty("--workspace-container-color", containerColor);
    }
    const glowMode = currentSettings?.appearance?.workspaceGlowMode;
    if (glowMode === "workspace" || (glowMode === "container" && containerColor)) {
      indicator.dataset.glow = "true";
      indicator.style.setProperty(
        "--workspace-glow-color",
        glowMode === "container" ? containerColor : workspace.color
      );
    }
  }
  indicator.append(workspaceIconElement(workspace));
  return indicator;
}

function searchResultFavicon(tab) {
  const favicon = document.createElement("span");
  favicon.className = "tab-favicon tab-favicon--fallback";
  favicon.setAttribute("aria-hidden", "true");
  const fallback = faviconFallback(tab.title, tab.logicalTabId);
  favicon.style.setProperty("--favicon-fallback-color", fallback.color);
  favicon.textContent = fallback.initial;
  return favicon;
}

async function loadTabSearchIndex() {
  const response = await browser.runtime.sendMessage({
    type: WORKSPACE_MESSAGE_TYPES.GET_SEARCH_INDEX,
    windowId: currentWindowId
  });
  if (!response || response.ok !== true) throw new TypeError("Invalid search response.");
  return response.index;
}

function focusActivatedTab(tab) {
  const row = [...tabList.querySelectorAll(".tab-row")].find(
    (element) => element.dataset.tabId === tab.logicalTabId && !element.hidden
  );
  if (!row || row.getClientRects().length === 0) return false;
  row.focus({ preventScroll: false });
  return document.activeElement === row;
}

function applyTabSearchSettings() {
  tabSearch.configure({
    enabled: currentSettings?.sidebar?.showTabSearch !== false,
    position: currentSettings?.sidebar?.tabSearchPosition
  });
}

// A failed load keeps the images already shown; custom IDs without one draw House.
async function loadCustomIcons() {
  const sequence = ++customIconRequestSequence;
  try {
    const icons = (await customIconClient.list()).icons;
    if (sequence !== customIconRequestSequence) return false;
    customIconUrls.replace(icons);
    return true;
  } catch {
    return false;
  }
}

function loadStateLabel(summary) {
  if (summary.loadState === "empty") {
    return "empty";
  }
  if (summary.loadState === "unloaded") {
    return "fully unloaded";
  }
  if (summary.loadState === "partial") {
    return `${summary.discardedTabCount} unloaded`;
  }
  return "loaded";
}

function showStatus(text, variant = "quiet") {
  workspaceStatus.className = "workspace-status";
  workspaceStatus.setAttribute("role", variant === "error" ? "alert" : "status");
  if (variant === "quiet") {
    workspaceStatus.classList.add("visually-hidden");
  } else {
    workspaceStatus.classList.add(`workspace-status--${variant}`);
  }
  workspaceStatus.textContent = text;
}

function clearSwitchMotion(sequence) {
  if (sequence !== switchMotionSequence) {
    return;
  }
  workspaceList.classList.remove(
    "workspace-rail--switching",
    "workspace-rail--switch-arrived"
  );
  for (const entry of workspaceList.querySelectorAll(
    ".workspace-entry--switch-source, .workspace-entry--switch-target, .workspace-entry--switch-arrived"
  )) {
    entry.classList.remove(
      "workspace-entry--switch-source",
      "workspace-entry--switch-target",
      "workspace-entry--switch-arrived"
    );
  }
}

function beginSwitchMotion(workspaceId) {
  const sequence = ++switchMotionSequence;
  clearSwitchMotion(sequence);
  workspaceList.classList.add("workspace-rail--switching");
  workspaceList.querySelector('[aria-pressed="true"]')?.classList.add(
    "workspace-entry--switch-source"
  );
  workspaceList.querySelector(`[data-workspace-id="${CSS.escape(workspaceId)}"]`)?.classList.add(
    "workspace-entry--switch-target"
  );
  return sequence;
}

function finishSwitchMotion(workspaceId, sequence) {
  if (sequence !== switchMotionSequence) {
    return;
  }
  workspaceList.classList.remove("workspace-rail--switching");
  workspaceList.classList.add("workspace-rail--switch-arrived");
  const incoming = workspaceList.querySelector(
    `[data-workspace-id="${CSS.escape(workspaceId)}"]`
  );
  incoming?.classList.add("workspace-entry--switch-arrived");
  incoming?.focus({ preventScroll: true });
  if (reducedMotionQuery.matches) {
    clearSwitchMotion(sequence);
    return;
  }
  const iconBox = incoming?.querySelector(".workspace-icon-box");
  if (!iconBox) {
    clearSwitchMotion(sequence);
    return;
  }
  iconBox.addEventListener("animationend", () => clearSwitchMotion(sequence), { once: true });
}

function visibleExceptionText(view) {
  const labels = [
    ["active", "active"],
    ["pinned", "pinned"],
    ["sharing", "sharing"],
    ["closing", "closing"]
  ];
  return labels
    .filter(([key]) => view.visibleExceptions[key] > 0)
    .map(([key, label]) => `${view.visibleExceptions[key]} ${label}`)
    .join(", ");
}

function acknowledgeNotice(noticeId) {
  void browser.runtime.sendMessage({
    type: WORKSPACE_MESSAGE_TYPES.ACKNOWLEDGE_NOTICE,
    windowId: currentWindowId,
    noticeId
  }).catch(() => undefined);
}

function requestWorkspaceUnload(workspaceId) {
  void unloadWorkspace(workspaceId);
}

// Waking a whole workspace can pull a lot of pages at once, so a large one
// asks first. The answer is the same suppressible warning every other
// destructive-ish action uses.
const MANY_TAB_LOAD_THRESHOLD = 10;
let loadWorkspaceId = null;

function unloadedTabCount(workspaceId) {
  return currentView?.workspaceTabs.find(
    ({ workspaceId: id }) => id === workspaceId
  )?.discardedTabCount ?? 0;
}

function requestWorkspaceLoad(workspaceId) {
  const workspace = workspaceById(workspaceId);
  const count = unloadedTabCount(workspaceId);
  if (!workspace || count === 0) {
    showStatus(
      workspace ? `${workspace.name} has no unloaded tabs in this window.` : "",
      "quiet"
    );
    return;
  }
  if (
    count <= MANY_TAB_LOAD_THRESHOLD ||
    currentSettings?.sidebar.warnBeforeLoadingManyTabs === false
  ) {
    void loadWorkspaceTabs(workspaceId);
    return;
  }
  loadWorkspaceId = workspaceId;
  skipManyTabLoadWarning.checked = false;
  loadTabsDetails.textContent =
    `${workspace.name} has ${count} unloaded tabs in this window. Loading them all reopens every page at once.`;
  loadTabsDialog.showModal();
}

function workspaceReorderingLocked() {
  return currentSettings?.sidebar.workspaceReorderingLocked === true;
}

function workspaceRailEntries() {
  return currentView?.state.rail.filter(({ kind }) => kind === "workspace") ?? [];
}

function workspaceById(workspaceId) {
  return currentView?.state.workspaces.find(({ id }) => id === workspaceId);
}

function cyclicWorkspaceSuccessor(workspaceId) {
  const entries = workspaceRailEntries();
  const index = entries.findIndex(({ workspaceId: id }) => id === workspaceId);
  return index < 0 || entries.length < 2
    ? null
    : workspaceById(entries[(index + 1) % entries.length].workspaceId);
}

function clearWorkspaceDragPresentation() {
  for (const item of workspaceList.querySelectorAll(".workspace-item")) {
    item.classList.remove("is-dragging");
    item.removeAttribute("data-drop-position");
  }
}

function cancelWorkspaceDrag() {
  workspaceDragSession = null;
  clearWorkspaceDragPresentation();
}

function openWorkspaceRename(workspaceId, workspace = workspaceById(workspaceId)) {
  if (!workspace) {
    return;
  }
  renameWorkspaceId = workspaceId;
  renameWorkspaceInput.value = workspace.name;
  renameWorkspaceDialog.showModal();
  renameWorkspaceInput.select();
}

function openGroupRename(group) {
  if (!group || typeof group.id !== "string" || typeof group.title !== "string") {
    return;
  }
  renameGroupId = group.id;
  renameGroupInput.value = group.title;
  renameGroupDialog.showModal();
  renameGroupInput.select();
}

function workspaceCommands(workspace) {
  const commands = [
    ["Rename workspace", () => openWorkspaceRename(workspace.id)],
    ["Load all tabs", () => requestWorkspaceLoad(workspace.id)],
    ["Unload workspace", () => requestWorkspaceUnload(workspace.id)]
  ];
  const entries = workspaceRailEntries();
  const index = entries.findIndex(({ workspaceId }) => workspaceId === workspace.id);
  if (!workspaceReorderingLocked() && index > 0) {
    commands.push([
      "Move workspace up",
      () => placeWorkspace(
        workspace.id,
        entries[index - 1].workspaceId,
        "before"
      )
    ]);
  }
  if (!workspaceReorderingLocked() && index >= 0 && index < entries.length - 1) {
    commands.push([
      "Move workspace down",
      () => placeWorkspace(
        workspace.id,
        entries[index + 1].workspaceId,
        "after"
      )
    ]);
  }
  if (currentView.state.workspaces.length > 1) {
    commands.push({
      label: "Remove workspace",
      action: () => void removeWorkspace(workspace.id),
      variant: "danger"
    });
  }
  commands.push({
    label: "Close all tabs",
    action: () => prepareTabClosure({ kind: "workspace", workspaceId: workspace.id }),
    variant: "danger"
  });
  return commands;
}

function renderWorkspace(workspace, activeWorkspaceId, summary) {
  const item = document.createElement("li");
  item.className = "workspace-item";

  const button = document.createElement("button");
  button.className = "workspace-entry";
  button.type = "button";
  const tabDescription = `${summary.tabCount} ${pluralTabs(summary.tabCount)}, ${loadStateLabel(summary)}`;
  button.style.setProperty("--workspace-color", workspace.color);
  button.dataset.workspaceId = workspace.id;
  button.dataset.unloadTarget = "workspace";
  button.dataset.loadState = summary.loadState;
  const defaultContainer = workspace.defaultContainerRef === null
    ? null
    : currentContainers.containers.find(({ refId }) => refId === workspace.defaultContainerRef);
  if (defaultContainer?.status === "available") {
    button.style.setProperty(
      "--workspace-container-color",
      defaultContainer.descriptor.colorCode
    );
  }
  const containerDescription = workspace.defaultContainerRef === null
    ? "No Container default"
    : defaultContainer?.status === "available"
      ? `default container ${defaultContainer.descriptor.name}`
      : `default container ${defaultContainer?.descriptor?.name ?? "unavailable"}, unavailable`;
  const accessibleLabel = `${workspace.name}, ${tabDescription}, ${containerDescription}`;
  button.setAttribute("aria-label", accessibleLabel);
  // The visible range can abbreviate, so hover and assistive text both retain
  // the exact count and load/container state.
  button.title = accessibleLabel;
  if (workspace.defaultContainerRef !== null) {
    button.dataset.containerStatus = defaultContainer?.status ?? "unavailable";
  }
  button.setAttribute("aria-pressed", String(workspace.id === activeWorkspaceId));
  button.draggable = !workspaceReorderingLocked();
  button.addEventListener("click", () => {
    void activateWorkspace(workspace.id);
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    tabPane.openMenu(button, workspaceCommands(workspace), { kind: "external", id: workspace.id, key: workspaceMenuKey(workspace.id) });
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      tabPane.openMenu(button, workspaceCommands(workspace), { kind: "external", id: workspace.id, key: workspaceMenuKey(workspace.id) });
    }
  });
  button.addEventListener("dragstart", (event) => {
    if (workspaceReorderingLocked()) {
      event.preventDefault();
      return;
    }
    workspaceDragSession = { workspaceId: workspace.id };
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-sidebars-workspace", workspace.id);
  });
  button.addEventListener("dragend", cancelWorkspaceDrag);
  tabPane.bindWorkspaceDrop(button, workspace.id);

  item.addEventListener("dragover", (event) => {
    if (!workspaceDragSession || workspaceDragSession.workspaceId === workspace.id) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    for (const candidate of workspaceList.querySelectorAll("[data-drop-position]")) {
      candidate.removeAttribute("data-drop-position");
    }
    const bounds = item.getBoundingClientRect();
    item.dataset.dropPosition = event.clientY < bounds.top + bounds.height / 2
      ? "before"
      : "after";
  });
  item.addEventListener("dragleave", (event) => {
    if (!item.contains(event.relatedTarget)) {
      item.removeAttribute("data-drop-position");
    }
  });
  item.addEventListener("drop", (event) => {
    if (!workspaceDragSession || workspaceDragSession.workspaceId === workspace.id) {
      return;
    }
    event.preventDefault();
    const sourceWorkspaceId = workspaceDragSession.workspaceId;
    const position = item.dataset.dropPosition;
    cancelWorkspaceDrag();
    if (position === "before" || position === "after") {
      void placeWorkspace(sourceWorkspaceId, workspace.id, position);
    }
  });

  const iconBox = document.createElement("span");
  iconBox.className = "workspace-icon-box";
  iconBox.setAttribute("aria-hidden", "true");

  const count = document.createElement("span");
  count.className = "count-badge workspace-tab-count";
  count.dataset.loadState = summary.loadState;
  count.textContent = countBadgeText(summary.tabCount);
  count.setAttribute("aria-hidden", "true");
  iconBox.append(workspaceIconElement(workspace), count);

  const unavailableContainer = document.createElement("span");
  unavailableContainer.className = "workspace-container-unavailable";
  unavailableContainer.textContent = "!";
  unavailableContainer.setAttribute("aria-hidden", "true");
  unavailableContainer.hidden = button.dataset.containerStatus !== "unavailable";

  const label = document.createElement("span");
  label.className = "visually-hidden";
  label.textContent = workspace.name;

  button.append(iconBox, unavailableContainer, label);
  const menuButton = document.createElement("button");
  menuButton.className = "workspace-menu-button";
  menuButton.type = "button";
  menuButton.textContent = "…";
  menuButton.setAttribute("aria-label", `Workspace actions for ${workspace.name}`);
  menuButton.addEventListener("click", () => {
    tabPane.openMenu(menuButton, workspaceCommands(workspace), { kind: "external", id: workspace.id, key: workspaceMenuKey(workspace.id) });
  });
  item.append(button, menuButton);
  return item;
}

function renderDivider(entry) {
  const item = document.createElement("li");
  item.className = "workspace-divider";
  item.setAttribute("aria-hidden", "true");
  if (entry.size !== null) {
    item.style.setProperty("--workspace-divider-size", `${entry.size}px`);
  }
  return item;
}

function renderSpace() {
  const item = document.createElement("li");
  item.className = "workspace-space";
  item.setAttribute("aria-hidden", "true");
  return item;
}

function workspaceEntryKey(workspace, activeWorkspaceId, summary) {
  const defaultContainer = workspace.defaultContainerRef === null
    ? null
    : currentContainers.containers.find(
      ({ refId }) => refId === workspace.defaultContainerRef
    );
  const presentation = presentWorkspaceIcon(workspace.icon, customIconUrls);
  return JSON.stringify([
    workspace,
    workspace.id === activeWorkspaceId,
    summary,
    defaultContainer?.status ?? null,
    defaultContainer?.descriptor?.colorCode ?? null,
    defaultContainer?.descriptor?.name ?? null,
    presentation.kind === "image" ? presentation.url : presentation.path,
    presentation.opticalScale ?? null,
    workspaceReorderingLocked()
  ]);
}

// Only what an open workspace menu's commands captured: identity, rail order,
// reorder lock, and removability. Tab counts and load state churn in the
// background without changing what the menu does.
function workspaceMenuKey(workspaceId) {
  const workspace = currentView?.state.workspaces.find(({ id }) => id === workspaceId);
  if (!workspace) {
    return null;
  }
  return JSON.stringify([
    workspace.id,
    workspace.name,
    workspaceRailEntries().map(({ workspaceId: id }) => id),
    workspaceReorderingLocked(),
    currentView.state.workspaces.length
  ]);
}

function reconcileRailChildren(desired) {
  let index = 0;
  for (const node of desired) {
    const current = workspaceList.children[index];
    if (current !== node) {
      workspaceList.insertBefore(node, current ?? null);
    }
    index += 1;
  }
  while (workspaceList.children.length > index) {
    workspaceList.removeChild(workspaceList.children[workspaceList.children.length - 1]);
  }
}

// The rail + follows the last rail entry. It is not a rail entry, so
// workspace dragging and placement never see it.
function renderAddWorkspaceItem(rail) {
  const item = document.createElement("li");
  item.className = "workspace-add-item";
  if (addWorkspaceNeedsDivider(rail)) {
    const divider = document.createElement("span");
    divider.className = "workspace-add-divider";
    divider.setAttribute("aria-hidden", "true");
    item.append(divider);
  }
  const button = document.createElement("button");
  button.className = "workspace-add-button";
  button.type = "button";
  button.disabled = mutationInFlight;
  button.setAttribute("aria-label", "Add workspace");
  const icon = document.createElement("span");
  icon.className = "workspace-add-icon";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("click", () => {
    void createWorkspaceFromRail();
  });
  item.append(button);
  return item;
}

function showView(rawView, announceActivation = false, switchMotion = null) {
  shownRefreshSignature = null;
  const view = parseWorkspaceView(rawView);
  const searchFocus = tabSearch.captureFocus();
  if (currentSettings) {
    applySidebarSettings(document.documentElement, currentSettings);
  }
  cancelWorkspaceDrag();
  currentView = view;
  const workspaceById = new Map(
    view.state.workspaces.map((workspace) => [workspace.id, workspace])
  );
  const summaryByWorkspaceId = new Map(
    view.workspaceTabs.map((summary) => [summary.workspaceId, summary])
  );
  const nextRailNodes = new Map();
  const desiredRail = [];
  view.state.rail.forEach((entry, index) => {
    let key;
    let contentKey;
    let build;
    if (entry.kind === "divider" || entry.kind === "space") {
      key = `${entry.kind}:${index}`;
      contentKey = JSON.stringify(entry);
      build = () => entry.kind === "divider" ? renderDivider(entry) : renderSpace(entry);
    } else {
      const workspace = workspaceById.get(entry.workspaceId);
      const summary = summaryByWorkspaceId.get(entry.workspaceId);
      key = `workspace:${entry.workspaceId}`;
      contentKey = workspaceEntryKey(workspace, view.activeWorkspaceId, summary);
      build = () => renderWorkspace(workspace, view.activeWorkspaceId, summary);
    }
    const previous = railNodesByKey.get(key);
    const node =
      previous !== undefined && previous.contentKey === contentKey && !nextRailNodes.has(key)
        ? previous.node
        : build();
    nextRailNodes.set(key, { node, contentKey });
    desiredRail.push(node);
  });
  {
    const addKey = "add:end";
    const addContentKey = JSON.stringify([view.state.rail, mutationInFlight]);
    const previous = railNodesByKey.get(addKey);
    const node = previous !== undefined && previous.contentKey === addContentKey
      ? previous.node
      : renderAddWorkspaceItem(view.state.rail);
    nextRailNodes.set(addKey, { node, contentKey: addContentKey });
    desiredRail.push(node);
  }
  railNodesByKey = nextRailNodes;
  reconcileRailChildren(desiredRail);
  tabRenderCoordinator.renderTree(view);
  // The tab pane keeps a menu only while its recorded inputs are unchanged;
  // menus it does not own (the rail's) are revalidated here the same way.
  const externalMenu = tabPane.externalMenuContext();
  if (externalMenu !== null && externalMenu.key !== workspaceMenuKey(externalMenu.id)) {
    tabPane.closeMenu();
  }
  tabSearch.setView(view, searchFocus);
  workspaceList.setAttribute("aria-busy", String(mutationInFlight));
  const activeName = workspaceById.get(view.activeWorkspaceId).name;
  if (switchMotion) {
    finishSwitchMotion(view.activeWorkspaceId, switchMotion);
  }
  if (view.notice) {
    showStatus(
      workspaceNoticeText(view.notice),
      view.notice.severity === "error" ? "error" : "warning"
    );
    acknowledgeNotice(view.notice.id);
  } else if (view.visibleExceptionCount > 0) {
    const suffix = view.visibleExceptionCount === 1 ? "tab remains" : "tabs remain";
    showStatus(
      `${activeName} is active. ${view.visibleExceptionCount} protected ${suffix} visible (${visibleExceptionText(view)}).`,
      "warning"
    );
  } else if (announceActivation) {
    showStatus(`${activeName} is active.`, "quiet");
  } else {
    showStatus(`${view.state.workspaces.length} workspaces loaded. ${activeName} is active.`);
  }
  return view;
}

function showError(code, clearWorkspaces = true) {
  const knownCode = WORKSPACE_STATE_ERROR_MESSAGES[code]
    ? code
    : WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR;
  if (clearWorkspaces) {
    workspaceList.replaceChildren();
    tabList.replaceChildren();
  }
  workspaceList.setAttribute("aria-busy", String(mutationInFlight));
  for (const button of workspaceList.querySelectorAll("button")) {
    button.disabled = false;
  }
  showStatus(
    WORKSPACE_STATE_ERROR_MESSAGES[knownCode],
    knownCode === WORKSPACE_STATE_ERROR_CODES.WORKSPACE_ACTIVE ? "warning" : "error"
  );
}

function showSettingsError(code) {
  const knownCode = SETTINGS_STATE_ERROR_MESSAGES[code]
    ? code
    : SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR;
  showStatus(`${SETTINGS_STATE_ERROR_MESSAGES[knownCode]} Default sizes remain active.`, "warning");
}

function showContainerError(code) {
  const knownCode = CONTAINER_ERROR_MESSAGES[code]
    ? code
    : CONTAINER_ERROR_CODES.INTERNAL_ERROR;
  showStatus(CONTAINER_ERROR_MESSAGES[knownCode], "error");
}

// runMutation's single-flight guard would silently discard a drop made while
// an earlier change is still running, so drops wait their turn instead. A drop
// that became stale meanwhile is refused by the background and reported.
let dropQueue = Promise.resolve();
const mutationIdleWaiters = [];

function whenMutationIdle() {
  return new Promise((resolve) => mutationIdleWaiters.push(resolve));
}

function enqueueDrop(run) {
  const next = dropQueue.then(async () => {
    while (mutationInFlight) {
      await whenMutationIdle();
    }
    return run();
  });
  dropQueue = next.catch(() => undefined);
  return next;
}

function setMutationBusy(isBusy) {
  mutationInFlight = isBusy;
  if (!isBusy) {
    for (const resolve of mutationIdleWaiters.splice(0)) resolve();
  }
  workspaceList.setAttribute("aria-busy", String(isBusy));
  tabList.setAttribute("aria-busy", String(isBusy));
  // Disabling a focused control blurs it, so tab search stays enabled while
  // other work runs; its controller ignores activation until that work ends.
  for (const button of document.querySelectorAll(".sidebar-shell button")) {
    if (button.closest(".tab-search, .tab-search-results")) continue;
    button.disabled = isBusy;
  }
  renderUndoControl();
}

async function runMutation(message, pendingText, applyResponse) {
  if (mutationInFlight) {
    return;
  }
  setMutationBusy(true);
  const sequence = ++requestSequence;
  showStatus(pendingText, "quiet");

  try {
    const response = await browser.runtime.sendMessage(message);
    if (sequence !== requestSequence) {
      return;
    }
    if (!response || response.ok !== true) {
      if (CONTAINER_ERROR_MESSAGES[response?.error?.code]) {
        showContainerError(response.error.code);
      } else {
        showError(response?.error?.code, false);
      }
      return;
    }
    applyResponse(response, sequence);
    if (response.undoUnavailable === true) {
      showStatus("Action completed, but Undo is unavailable.", "warning");
    }
    return true;
  } catch {
    showError(WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR, false);
    return false;
  } finally {
    setMutationBusy(false);
    void drainRefreshQueue();
  }
}

async function activateWorkspace(workspaceId) {
  if (workspaceId === currentView?.activeWorkspaceId) {
    return;
  }
  const motionSequence = beginSwitchMotion(workspaceId);
  const applied = await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.ACTIVATE,
      windowId: currentWindowId,
      workspaceId
    },
    "Switching workspace...",
    (response) => showView(response.view, true, motionSequence)
  );
  if (!applied) {
    clearSwitchMotion(motionSequence);
  }
}

async function activateSearchResult(tab) {
  if (
    !currentView ||
    !tab ||
    !currentView.state.workspaces.some(({ id }) => id === tab.workspaceId)
  ) {
    return false;
  }
  // Another sidebar action owns the mutation slot. Leave search untouched so
  // the same result can be chosen again once that action finishes.
  if (mutationInFlight) {
    showStatus("Wait for the current action to finish, then choose the tab again.", "warning");
    return undefined;
  }
  const workspace = workspaceById(tab.workspaceId);
  const applied = await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.ACTIVATE_SEARCH_RESULT,
      windowId: currentWindowId,
      workspaceId: tab.workspaceId,
      logicalTabId: tab.logicalTabId,
      firefoxTabId: tab.firefoxTabId
    },
    `Opening ${tab.title}…`,
    (response) => {
      showView(response.view, tab.workspaceId !== currentView.activeWorkspaceId);
      showStatus(`${tab.title} is active in ${workspace?.name ?? "its workspace"}.`, "quiet");
    }
  );
  if (applied !== true) {
    showStatus("That tab changed or closed. Search results were refreshed.", "warning");
    scheduleRefresh();
    return false;
  }
  return true;
}

async function createNewTab(assignment = null) {
  if (!currentView) return false;
  return runMutation(
    {
      type: CONTAINER_MESSAGE_TYPES.CREATE_WORKSPACE_TAB,
      windowId: currentWindowId,
      workspaceId: currentView.activeWorkspaceId,
      assignment
    },
    "Opening a new tab...",
    (response) => showView(response.result.view)
  );
}

async function createTabGroup(tabs) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.CREATE_GROUP,
      windowId: currentWindowId,
      logicalTabIds: tabs.map(({ logicalId }) => logicalId)
    },
    "Creating group...",
    (response) => {
      showView(response.view);
      showStatus("Group created.", "quiet");
    }
  );
}

async function deleteTabGroup(logicalGroupId) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.DELETE_GROUP,
      windowId: currentWindowId,
      logicalGroupId
    },
    "Deleting group...",
    (response) => showView(response.view)
  );
}

async function renameTabGroup(logicalGroupId, title) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.RENAME_GROUP,
      windowId: currentWindowId,
      logicalGroupId,
      title
    },
    "Renaming group...",
    (response) => showView(response.view)
  );
}

function showCloseOutcome(outcome, warningPreferenceFailed = false) {
  const label = outcome.targetLabel;
  const preferenceText = warningPreferenceFailed
    ? " The warning preference could not be saved."
    : "";
  if (outcome.requestedCount === 0) {
    showStatus(`${label} has no tabs to close.${preferenceText}`, "quiet");
    return;
  }
  if (outcome.remainingCount > 0) {
    showStatus(
      `${label}: ${outcome.closedCount} of ${outcome.requestedCount} ${pluralTabs(outcome.requestedCount)} closed; ${outcome.remainingCount} remain open.${preferenceText}`,
      "warning"
    );
    return;
  }
  const replacementText = outcome.replacementCount > 0
    ? ` Firefox kept ${outcome.replacementCount} replacement ${pluralTabs(outcome.replacementCount)} open so every window remains usable.`
    : "";
  showStatus(
    `${label}: ${outcome.closedCount} ${pluralTabs(outcome.closedCount)} closed.${replacementText}${preferenceText}`,
    "quiet"
  );
}

function displayTabClosure(preflight) {
  closePreflight = parseTabClosePreflight(preflight);
  skipMultipleTabCloseWarning.checked = false;
  const titles = {
    tab: "Close tab?",
    branch: "Close tab branch?",
    tabs: "Close selected tabs?",
    group: "Close tab group?",
    workspace: "Close all workspace tabs?"
  };
  const submitLabels = {
    tab: "Close tab",
    branch: "Close branch",
    tabs: "Close tabs",
    group: "Close group",
    workspace: "Close all tabs"
  };
  closeTabsTitle.textContent = titles[closePreflight.target.kind];
  confirmTabClosureButton.textContent = submitLabels[closePreflight.target.kind];
  const countText = `${closePreflight.tabCount} ${pluralTabs(closePreflight.tabCount)}`;
  if (closePreflight.target.kind === "workspace") {
    const scopeLabel = closePreflight.scope === "private" ? "private" : "normal";
    closeTabsDetails.textContent =
      `${closePreflight.targetLabel} currently has ${countText} across all ${scopeLabel} Firefox windows. All of them will be closed.`;
  } else if (closePreflight.target.kind === "branch") {
    closeTabsDetails.textContent =
      `${closePreflight.targetLabel} and every tab nested under it currently total ${countText}. All of them will be closed.`;
  } else if (closePreflight.target.kind === "tabs") {
    closeTabsDetails.textContent =
      `The selected tabs and every tab nested under them currently total ${countText}. All of them will be closed.`;
  } else if (closePreflight.target.kind === "group") {
    closeTabsDetails.textContent =
      `${closePreflight.targetLabel} currently contains ${countText}. All of them will be closed.`;
  } else {
    closeTabsDetails.textContent = `${closePreflight.targetLabel} will be closed.`;
  }
  if (!closeTabsDialog.open) {
    closeTabsDialog.showModal();
  }
}

async function prepareTabClosure(target) {
  let preflight = null;
  const prepared = await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.PREPARE_CLOSE_TABS,
      windowId: currentWindowId,
      target
    },
    "Counting tabs...",
    (response) => {
      preflight = parseTabClosePreflight(response.preflight);
    }
  );
  if (!prepared || !preflight) {
    return;
  }
  if (
    preflight.tabCount <= 1 ||
    currentSettings?.sidebar.warnBeforeClosingMultipleTabs === false
  ) {
    await closeTabs(preflight);
    return;
  }
  displayTabClosure(preflight);
  showStatus("Review the multiple-tab close warning.", "quiet");
}

async function closeTabs(preflight, warningPreferenceFailed = false) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.CLOSE_TABS,
      windowId: currentWindowId,
      token: preflight.token
    },
    `Closing ${preflight.tabCount} ${pluralTabs(preflight.tabCount)}...`,
    (response) => {
      showView(response.view);
      const outcome = parseTabCloseOutcome(response.outcome);
      if (response.preflight !== null) {
        displayTabClosure(response.preflight);
        showStatus("The tab list changed. Nothing was closed; review the updated count.", "warning");
        return;
      }
      showCloseOutcome(outcome, warningPreferenceFailed);
    }
  );
}

async function unloadTabs(tabs) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.UNLOAD_TABS,
      windowId: currentWindowId,
      logicalTabIds: tabs.map(({ logicalId }) => logicalId)
    },
    "Unloading tabs...",
    (response) => {
      showView(response.view);
      showStatus(`${tabs.length} ${pluralTabs(tabs.length)} unloaded.`, "quiet");
    }
  );
}

// A bare "1 skipped" leaves the user guessing why a tab stayed put, and most
// of these reasons are ordinary and expected rather than faults. Each one is
// named in plain words instead.
const CONTAINER_MOVE_REASON_TEXT = Object.freeze({
  "already-in-container": (count, containerName) =>
    `${count} ${pluralTabs(count)} already in ${containerName}`,
  "unsupported-url": (count) =>
    `${count} ${pluralTabs(count)} on a page Firefox cannot reopen in a container`,
  "split-locked": (count) => `${count} ${pluralTabs(count)} held by a Split View`,
  "container-unavailable": (count, containerName) => `${containerName} was unavailable for ${count} ${pluralTabs(count)}`,
  "stale-request": (count) => `${count} ${pluralTabs(count)} changed before the move ran`,
  "browser-failure": (count) => `Firefox refused ${count} ${pluralTabs(count)}`
});

function containerMoveReasonNotes(outcome, containerName) {
  return outcome.reasons
    .filter(({ reason, count }) => count > 0 && reason !== "close-refused")
    .map(({ reason, count }) =>
      CONTAINER_MOVE_REASON_TEXT[reason]?.(count, containerName) ??
      `${count} ${pluralTabs(count)} skipped`
    );
}

function showContainerMoveOutcome(outcome, containerName) {
  const refusedCount = outcome.reasons.find(
    ({ reason }) => reason === "close-refused"
  )?.count ?? 0;
  // A page that asks to stay open keeps its own tab, so its copy in the new
  // container is left beside it rather than closed.
  const refusedNote = refusedCount > 0
    ? ` ${refusedCount} ${pluralTabs(refusedCount)} asked to stay open; a copy was left in ${containerName} beside ${refusedCount === 1 ? "it" : "them"}.`
    : "";
  if (outcome.status === "applied") {
    showStatus(
      `Moved ${outcome.movedCount} ${pluralTabs(outcome.movedCount)} to ${containerName}.`,
      "quiet"
    );
    return;
  }
  const notes = containerMoveReasonNotes(outcome, containerName);
  const detail = notes.length > 0 ? ` ${notes.join("; ")}.` : "";
  const moved = outcome.movedCount === 0
    ? `Nothing moved to ${containerName}.`
    : `Moved ${outcome.movedCount} of ${outcome.requestedCount} ${pluralTabs(outcome.requestedCount)} to ${containerName}.`;
  showStatus(
    `${moved}${detail}${refusedNote}`,
    outcome.status === "failed" ? "error" : "warning"
  );
}

async function moveTabsToContainer(sources, choice) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.MOVE_TABS_TO_CONTAINER,
      windowId: currentWindowId,
      tabs: sources.map(({ logicalId, firefoxId }) => ({
        logicalTabId: logicalId,
        firefoxTabId: firefoxId
      })),
      assignment: containerMoveAssignment(choice)
    },
    `Moving ${sources.length} ${pluralTabs(sources.length)} to ${choice.name}...`,
    (response) => {
      showView(response.view);
      showContainerMoveOutcome(parseTabContainerMoveOutcome(response.outcome), choice.name);
    }
  );
}

async function loadContainers(reportFailure = true) {
  const sequence = ++containerRequestSequence;
  try {
    const response = await browser.runtime.sendMessage({
      type: CONTAINER_MESSAGE_TYPES.OVERVIEW
    });
    if (sequence !== containerRequestSequence) return false;
    if (!response || response.ok !== true) {
      if (reportFailure) showContainerError(response?.error?.code);
      return false;
    }
    currentContainers = response.result;
    return true;
  } catch {
    if (reportFailure && sequence === containerRequestSequence) {
      showContainerError(CONTAINER_ERROR_CODES.INTERNAL_ERROR);
    }
    return false;
  }
}

async function activateTab(logicalTabId, firefoxTabId) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.ACTIVATE_TAB,
      windowId: currentWindowId,
      logicalTabId,
      firefoxTabId
    },
    "Activating tab...",
    (response) => showView(response.view)
  );
}

function showPlacementResult(response) {
  const view = showView(response.view);
  const outcome = parseWorkspaceOperationOutcome(response.outcome);
  if (outcome.status !== "applied") {
    showStatus(
      outcome.appliedCount < outcome.requestedCount
        ? `${outcome.appliedCount} of ${outcome.requestedCount} tabs reached the requested placement.`
        : "Firefox hasn't finished arranging the moved tabs yet.",
      "warning"
    );
  }
  return view;
}

async function relocateTabs(sources, destination) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.RELOCATE_TABS,
      windowId: currentWindowId,
      sources,
      destination
    },
    "Moving tabs...",
    showPlacementResult
  );
}

async function relocateGroup(source, destination) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.RELOCATE_GROUP,
      windowId: currentWindowId,
      source,
      destination
    },
    "Moving group...",
    showPlacementResult
  );
}

function acceptNativeTabDrop(dataTransfer, destinationWorkspaceId) {
  return nativeTabDropResolver?.accepts(dataTransfer, {
    activeWorkspaceId: currentView?.activeWorkspaceId,
    destinationWorkspaceId
  }) === true;
}

function cancelNativeTabDrop() {
  nativeTabDropResolver?.reset();
}

function relocateNativeSelection(dataTransfer, destinationWorkspaceId) {
  const resolution = nativeTabDropResolver?.resolveDrop(dataTransfer, {
    activeWorkspaceId: currentView?.activeWorkspaceId,
    destinationWorkspaceId,
    activeTabs: currentView?.activeTabs
  });
  if (!resolution) {
    return false;
  }
  void resolution
    .then((intent) => {
      if (!intent) {
        showError(WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST, false);
        return;
      }
      return runMutation(
        {
          type: WORKSPACE_MESSAGE_TYPES.RELOCATE_NATIVE_SELECTION,
          ...intent
        },
        "Moving tabs...",
        showPlacementResult
      );
    })
    .catch(() => showError(WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR, false));
  return true;
}

async function setTreeCollapsed(logicalTabId, collapsed) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.SET_TREE_COLLAPSED,
      windowId: currentWindowId,
      logicalTabId,
      collapsed
    },
    collapsed ? "Collapsing branch..." : "Expanding branch...",
    (response) => showView(response.view)
  );
}

async function flattenTreeBranch(tabs) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.FLATTEN_TREE_BRANCH,
      windowId: currentWindowId,
      tabs
    },
    tabs.length === 1 ? "Flattening branch..." : "Flattening branches...",
    (response) => showView(response.view)
  );
}

async function setGroupCollapsed(logicalGroupId, collapsed) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.SET_GROUP_COLLAPSED,
      windowId: currentWindowId,
      logicalGroupId,
      collapsed
    },
    collapsed ? "Collapsing group..." : "Expanding group...",
    (response) => showView(response.view)
  );
}

function showUnloadResult(view, outcome) {
  const workspaceName = view.state.workspaces.find(
    ({ id }) => id === outcome.workspaceId
  ).name;
  if (outcome.requestedTabCount === 0) {
    showStatus(`${workspaceName} has no tabs to unload.`, "quiet");
    return;
  }
  if (outcome.pendingWindowCount > 0) {
    showStatus(
      `${workspaceName}: ${outcome.switchedWindowCount} windows switched, but ${outcome.pendingWindowCount} still need Firefox to finish switching. No tabs were unloaded.`,
      "warning"
    );
    return;
  }
  if (outcome.safetyTabCount > 0) {
    const unloadedCount = outcome.alreadyDiscardedCount + outcome.newlyDiscardedCount;
    showStatus(
      `${workspaceName}: ${unloadedCount} tabs unloaded; ${outcome.safetyTabCount} active safety ${pluralTabs(outcome.safetyTabCount)} stayed loaded.`,
      "warning"
    );
    return;
  }
  if (
    outcome.remainingPinnedCount > 0 ||
    outcome.remainingGroupedCount > 0 ||
    outcome.remainingVisibleCount > 0
  ) {
    showStatus(
      `${workspaceName}: Firefox left ${outcome.remainingVisibleCount} visible, ${outcome.remainingPinnedCount} pinned, and ${outcome.remainingGroupedCount} grouped tabs; ${outcome.remainingLoadedCount} remain loaded.`,
      "warning"
    );
    return;
  }
  if (outcome.remainingLoadedCount === 0) {
    if (outcome.newlyDiscardedCount === 0) {
      showStatus(
        `${workspaceName}'s ${outcome.requestedTabCount} ${pluralTabs(outcome.requestedTabCount)} were already unloaded.`,
        "quiet"
      );
      return;
    }
    showStatus(
      `${workspaceName}: ${outcome.requestedTabCount} ${pluralTabs(outcome.requestedTabCount)} unloaded.`,
      "quiet"
    );
    return;
  }
  const unloadedCount = outcome.alreadyDiscardedCount + outcome.newlyDiscardedCount;
  showStatus(
    `${workspaceName}: ${unloadedCount} of ${outcome.requestedTabCount} tabs unloaded; ${outcome.remainingLoadedCount} remain loaded.`,
    "warning"
  );
}

async function loadWorkspaceTabs(workspaceId) {
  const workspace = workspaceById(workspaceId);
  await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.LOAD_TABS,
      windowId: currentWindowId,
      workspaceId
    },
    "Loading tabs...",
    (response) => {
      const view = showView(response.result.view);
      const outcome = parseWorkspaceLoadOutcome(
        response.result,
        view.state.workspaces.map(({ id }) => id)
      );
      const name = workspace?.name ?? "The workspace";
      showStatus(
        outcome.failedCount > 0
          ? `${name}: ${outcome.startedCount} of ${outcome.requestedCount} tabs are loading; Firefox refused ${outcome.failedCount}.`
          : `${name}: ${outcome.startedCount} ${outcome.startedCount === 1 ? "tab is" : "tabs are"} loading.`,
        outcome.failedCount > 0 ? "warning" : "quiet"
      );
    }
  );
}

async function unloadWorkspace(workspaceId) {
  await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.UNLOAD,
      windowId: currentWindowId,
      workspaceId
    },
    "Unloading workspace...",
    (response) => {
      const view = showView(response.view);
      const outcome = parseWorkspaceUnloadOutcome(
        response.outcome,
        view.state.workspaces.map(({ id }) => id)
      );
      showUnloadResult(view, outcome);
    }
  );
}

// Adds a workspace without switching to it, then opens Rename for it.
async function createWorkspaceFromRail() {
  if (mutationInFlight || !currentView) {
    return;
  }
  const previousWorkspaces = currentView.state.workspaces;
  let created = null;
  const applied = await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.CREATE,
      windowId: currentWindowId,
      workspace: { ...NEW_WORKSPACE_FIELDS }
    },
    "Adding workspace...",
    (response) => {
      created = createdWorkspace(previousWorkspaces, response.state);
    }
  );
  if (!applied || !created) {
    return;
  }
  await refreshView();
  openWorkspaceRename(created.id, created);
}

async function updateWorkspace(workspaceId, changes) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.UPDATE,
      windowId: currentWindowId,
      workspaceId,
      changes
    },
    "Saving workspace...",
    (response) => {
      showView({ ...currentView, state: response.state });
      showStatus("Workspace saved.", "quiet");
    }
  );
}

async function placeWorkspace(workspaceId, targetWorkspaceId, position) {
  return runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRY,
      windowId: currentWindowId,
      entry: { kind: "workspace", id: workspaceId },
      target: { kind: "workspace", id: targetWorkspaceId },
      position
    },
    "Moving workspace...",
    (response) => {
      showView({ ...currentView, state: response.state });
      showStatus("Workspace order saved.", "quiet");
    }
  );
}

// Removal asks nothing: no tab closes, and the slot beside New Tab offers
// Undo straight after.
async function removeWorkspace(workspaceId) {
  const workspace = workspaceById(workspaceId);
  const successor = cyclicWorkspaceSuccessor(workspaceId);
  if (!workspace || !successor) {
    return;
  }
  await runMutation(
    {
      type: WORKSPACE_MESSAGE_TYPES.REMOVE,
      windowId: currentWindowId,
      workspaceId
    },
    "Moving tabs and removing workspace...",
    (response) => {
      showView(response.view);
      showStatus(
        `${workspace.name} was removed. Its contents moved to ${successor.name}.`,
        "quiet"
      );
    }
  );
}

async function refreshView() {
  const sequence = ++requestSequence;
  try {
    const response = await browser.runtime.sendMessage({
      type: WORKSPACE_MESSAGE_TYPES.GET_VIEW,
      windowId: currentWindowId
    });
    if (mutationInFlight || sequence !== requestSequence) {
      return;
    }
    if (!response || response.ok !== true) {
      showError(response?.error?.code, false);
      return;
    }
    // Background events often reconcile to the view already on screen.
    // Re-rendering it would also close an open menu and restart drags.
    const signature = JSON.stringify(response.view);
    if (currentView && signature === shownRefreshSignature) {
      return;
    }
    showView(response.view);
    shownRefreshSignature = signature;
  } catch {
    if (!mutationInFlight && sequence === requestSequence) {
      showError(WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR, false);
    }
  }
}

async function drainRefreshQueue() {
  if (refreshRunning || mutationInFlight || currentWindowId === undefined) {
    return;
  }
  refreshRunning = true;
  try {
    while (refreshQueued && !mutationInFlight) {
      refreshQueued = false;
      await refreshView();
    }
  } finally {
    refreshRunning = false;
    if (refreshQueued && !mutationInFlight) {
      void drainRefreshQueue();
    }
  }
}

function scheduleRefresh() {
  refreshQueued = true;
  void drainRefreshQueue();
}

// Created, activated, attached, replaced, and view-relevant updated tabs are
// reconciled by the background, which then sends VIEW_CHANGED for this window.
// Requesting a view here as well made every tab event build and render the
// whole window twice. Removal still drops its row at once.
const FAVICON_SOURCE_UPDATE_PROPERTIES = Object.freeze(["favIconUrl", "status"]);

function registerTabRefreshListeners() {
  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (removeInfo.windowId === currentWindowId) {
      faviconPresenter.handleTabRemoved(tabId);
      tabSearch.handleTabRemoved(tabId);
      scheduleRefresh();
    }
  });
  browser.tabs.onDetached.addListener((tabId, detachInfo) => {
    if (detachInfo.oldWindowId === currentWindowId) {
      faviconPresenter.handleTabRemoved(tabId);
      tabSearch.handleTabRemoved(tabId);
      scheduleRefresh();
    }
  });
  const onFaviconSourceUpdated = (tabId, changeInfo, tab) => {
    if (tab.windowId === currentWindowId) {
      faviconPresenter.handleTabUpdate(tabId, changeInfo);
    }
  };
  try {
    browser.tabs.onUpdated.addListener(onFaviconSourceUpdated, {
      windowId: currentWindowId,
      properties: FAVICON_SOURCE_UPDATE_PROPERTIES
    });
  } catch {
    browser.tabs.onUpdated.addListener(onFaviconSourceUpdated);
  }
  browser.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
    faviconPresenter.handleTabReplaced(addedTabId, removedTabId);
  });
}

async function loadSidebarSettings(reportFailure = true) {
  const sequence = ++settingsRequestSequence;
  try {
    const response = await browser.runtime.sendMessage({
      type: SETTINGS_MESSAGE_TYPES.GET
    });
    if (!response || response.ok !== true) {
      if (reportFailure) {
        showSettingsError(response?.error?.code);
      }
      return false;
    }
    if (sequence !== settingsRequestSequence) {
      return false;
    }
    currentSettings = parseSettingsState(response.settings);
    applySidebarSettings(document.documentElement, currentSettings);
    applyTabSearchSettings();
    applyWorkspaceReorderingLock();
    await refreshAppearance();
    if (currentView) {
      showView(currentView);
    }
    return true;
  } catch {
    if (reportFailure && sequence === settingsRequestSequence) {
      showSettingsError(SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR);
    }
    return false;
  }
}

function applyWorkspaceReorderingLock() {
  const locked = workspaceReorderingLocked();
  for (const button of workspaceList.querySelectorAll(".workspace-entry")) {
    button.draggable = !locked;
  }
  if (locked) {
    tabPane.closeMenu();
    cancelWorkspaceDrag();
  }
}

async function refreshAppearance(theme) {
  if (!currentSettings || !themeSource) {
    return;
  }
  const sequence = ++appearanceRequestSequence;
  try {
    const currentTheme = theme ?? await themeSource.getCurrent();
    if (sequence !== appearanceRequestSequence) return;
    applySidebarAppearance(document.documentElement, currentSettings, currentTheme, {
      prefersDark: colorSchemeQuery.matches
    });
  } catch {
    if (sequence !== appearanceRequestSequence) return;
    applySidebarAppearance(document.documentElement, currentSettings, {}, {
      prefersDark: colorSchemeQuery.matches
    });
  }
}

function registerSettingsRefreshListener() {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === "local" &&
      Object.prototype.hasOwnProperty.call(changes, SETTINGS_STATE_STORAGE_KEY)
    ) {
      void loadSidebarSettings();
    }
  });
}

function registerWorkspaceRefreshListener() {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === "local" &&
      Object.prototype.hasOwnProperty.call(changes, WORKSPACE_STATE_STORAGE_KEY)
    ) {
      scheduleRefresh();
    }
  });
}

function registerBackgroundRefreshListener() {
  browser.runtime.onMessage.addListener((message) => {
    if (
      message?.type === SIDEBAR_UNDO_MESSAGE_TYPES.CHANGED &&
      message.windowId === currentWindowId &&
      message.scope === currentUndoScope
    ) {
      undoRequestSequence += 1;
      try {
        currentUndoSummary = parseSidebarUndoSummary(message.summary);
      } catch {
        currentUndoSummary = unavailableUndoSummary();
      }
      renderUndoControl();
      return;
    }
    if (
      message?.type === CONTAINER_MESSAGE_TYPES.CHANGED
    ) {
      void loadContainers(false).then(() => scheduleRefresh());
      return;
    }
    if (
      message?.type === FAVICON_MESSAGE_TYPES.CHANGED &&
      ["icons", "clear", "default-search"].includes(message.change)
    ) {
      faviconPresenter.refresh(message.change, message.firefoxTabIds);
      return;
    }
    if (message?.type === CUSTOM_ICON_MESSAGE_TYPES.CHANGED) {
      void loadCustomIcons().then(() => scheduleRefresh());
      return;
    }
    if (
      message?.type === WORKSPACE_MESSAGE_TYPES.VIEW_CHANGED &&
      message.windowId === currentWindowId
    ) {
      scheduleRefresh();
      return;
    }
    if (
      message?.type === WORKSPACE_MESSAGE_TYPES.TAB_REMOVED &&
      message.windowId === currentWindowId &&
      Number.isInteger(message.firefoxTabId)
    ) {
      faviconPresenter.handleTabRemoved(message.firefoxTabId);
      tabSearch.handleTabRemoved(message.firefoxTabId);
      scheduleRefresh();
    }
  });
}

function registerAppearanceRefreshListeners() {
  themeSource.subscribe((theme) => {
    void refreshAppearance(theme);
  });
  colorSchemeQuery.addEventListener("change", () => {
    void refreshAppearance();
  });
  window.addEventListener("focus", () => {
    void refreshAppearance();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshAppearance();
    }
  });
}

async function loadWorkspaces() {
  try {
    const response = await browser.runtime.sendMessage({
      type: WORKSPACE_MESSAGE_TYPES.GET_VIEW,
      windowId: currentWindowId
    });
    if (!response || response.ok !== true) {
      showError(response?.error?.code);
      return;
    }
    showView(response.view);
    registerTabRefreshListeners();
  } catch {
    showError(WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR);
  }
}

settingsButton.addEventListener("click", async () => {
  settingsButton.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({
      type: WORKSPACE_MESSAGE_TYPES.OPEN_SETTINGS,
      windowId: currentWindowId
    });
    if (!response || response.ok !== true) {
      showSettingsError(response?.error?.code);
    }
  } catch {
    showSettingsError(SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR);
  } finally {
    settingsButton.disabled = false;
  }
});

newTabButton.addEventListener("click", () => {
  void createNewTab(null);
});

function openNewTabMenu() {
  const commands = currentContainers.capability === "available"
    ? [
        ["New tab: No Container", () => createNewTab({ kind: "none" })],
        ...uniqueAvailableContainerEntries(currentContainers.containers)
          .map((container) => [
            `New tab: ${container.descriptor.name}`,
            () => createNewTab({ kind: "container", refId: container.refId })
          ])
      ]
    : [];
  tabPane.openMenu(newTabButton, commands);
}

newTabButton.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openNewTabMenu();
});

undoSidebarButton.addEventListener("click", () => {
  void executeSidebarUndo();
});

function openBlankSidebarMenu(event) {
  if (
    event.defaultPrevented ||
    event.target.closest("dialog, .command-menu, .tab-search, .tab-search-results")
  ) {
    return;
  }
  event.preventDefault();
  tabPane.openMenuAtPoint(event.clientX, event.clientY);
}

tabPaneElement.addEventListener("contextmenu", openBlankSidebarMenu);
workspaceNavigation.addEventListener("contextmenu", openBlankSidebarMenu);

newTabButton.addEventListener("keydown", (event) => {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    openNewTabMenu();
  }
});

renameWorkspaceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const workspaceId = renameWorkspaceId;
  const name = renameWorkspaceInput.value.trim();
  if (!workspaceId || name.length === 0 || name.length > 80) {
    renameWorkspaceInput.setCustomValidity("Enter a workspace name from 1 through 80 characters.");
    renameWorkspaceInput.reportValidity();
    return;
  }
  renameWorkspaceInput.setCustomValidity("");
  void updateWorkspace(workspaceId, { name }).then((saved) => {
    if (saved) {
      renameWorkspaceDialog.close();
    }
  });
});

renameWorkspaceInput.addEventListener("input", () => {
  renameWorkspaceInput.setCustomValidity("");
});

cancelWorkspaceRenameButton.addEventListener("click", () => {
  renameWorkspaceDialog.close();
});

renameWorkspaceDialog.addEventListener("close", () => {
  const workspaceId = renameWorkspaceId;
  renameWorkspaceId = null;
  if (workspaceId) {
    workspaceList.querySelector(
      `[data-workspace-id="${CSS.escape(workspaceId)}"]`
    )?.focus({ preventScroll: true });
  }
});

renameGroupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const logicalGroupId = renameGroupId;
  const title = renameGroupInput.value.trim();
  if (
    !logicalGroupId ||
    title.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(title)
  ) {
    renameGroupInput.setCustomValidity("Enter a group name up to 255 characters.");
    renameGroupInput.reportValidity();
    return;
  }
  renameGroupInput.setCustomValidity("");
  void renameTabGroup(logicalGroupId, title).then((saved) => {
    if (saved) {
      renameGroupDialog.close();
    }
  });
});

renameGroupInput.addEventListener("input", () => {
  renameGroupInput.setCustomValidity("");
});

cancelGroupRenameButton.addEventListener("click", () => {
  renameGroupDialog.close();
});

renameGroupDialog.addEventListener("close", () => {
  const logicalGroupId = renameGroupId;
  renameGroupId = null;
  if (logicalGroupId) {
    tabList.querySelector(
      `[data-group-id="${CSS.escape(logicalGroupId)}"] > .tab-group-header`
    )?.focus({ preventScroll: true });
  }
});

loadTabsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const workspaceId = loadWorkspaceId;
  const disableWarning = skipManyTabLoadWarning.checked;
  loadTabsDialog.close();
  if (!workspaceId) {
    return;
  }
  void (async () => {
    if (disableWarning) {
      try {
        const response = await browser.runtime.sendMessage({
          type: SETTINGS_MESSAGE_TYPES.UPDATE,
          patch: { sidebar: { warnBeforeLoadingManyTabs: false } }
        });
        if (!response || response.ok !== true) {
          throw new Error("Many-tab load warning setting could not be saved.");
        }
        currentSettings = parseSettingsState(response.settings);
        applySidebarSettings(document.documentElement, currentSettings);
      } catch {
        showStatus("The warning preference could not be saved.", "warning");
      }
    }
    await loadWorkspaceTabs(workspaceId);
  })();
});

cancelTabLoadButton.addEventListener("click", () => {
  loadTabsDialog.close();
});

loadTabsDialog.addEventListener("close", () => {
  const workspaceId = loadWorkspaceId;
  loadWorkspaceId = null;
  skipManyTabLoadWarning.checked = false;
  if (workspaceId) {
    workspaceList.querySelector(
      `[data-workspace-id="${CSS.escape(workspaceId)}"]`
    )?.focus({ preventScroll: true });
  }
});

closeTabsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const preflight = closePreflight;
  const disableWarning = skipMultipleTabCloseWarning.checked;
  if (!preflight) {
    return;
  }
  closeTabsDialog.close();
  void (async () => {
    let warningPreferenceFailed = false;
    if (disableWarning) {
      try {
        const response = await browser.runtime.sendMessage({
          type: SETTINGS_MESSAGE_TYPES.UPDATE,
          patch: { sidebar: { warnBeforeClosingMultipleTabs: false } }
        });
        if (!response || response.ok !== true) {
          throw new Error("Multiple-tab close warning setting could not be saved.");
        }
        currentSettings = parseSettingsState(response.settings);
        applySidebarSettings(document.documentElement, currentSettings);
      } catch {
        warningPreferenceFailed = true;
      }
    }
    await closeTabs(preflight, warningPreferenceFailed);
  })();
});

cancelTabClosureButton.addEventListener("click", () => {
  closeTabsDialog.close();
});

closeTabsDialog.addEventListener("close", () => {
  const target = closePreflight?.target ?? null;
  closePreflight = null;
  skipMultipleTabCloseWarning.checked = false;
  if (target?.kind === "workspace") {
    workspaceList.querySelector(
      `[data-workspace-id="${CSS.escape(target.workspaceId)}"]`
    )?.focus({ preventScroll: true });
  } else if (target?.kind === "group") {
    tabList.querySelector(
      `[data-group-id="${CSS.escape(target.logicalGroupId)}"] > .tab-group-header`
    )?.focus({ preventScroll: true });
  } else if (target) {
    const logicalTabId = target.kind === "tabs" ? target.tabs[0].logicalTabId : target.logicalTabId;
    tabList.querySelector(
      `[data-tab-id="${CSS.escape(logicalTabId)}"]`
    )?.focus({ preventScroll: true });
  }
});

async function initializeSidebar() {
  const currentWindow = await browser.windows.getCurrent();
  currentWindowIncognito = currentWindow.incognito === true;
  faviconLookupsEnabled = currentWindow.incognito !== true;
  currentWindowId = currentWindow.id;
  await loadUndoSummary();
  const middleClickUnload = createMiddleClickUnloadController({
    isBlocked: () => mutationInFlight || workspaceDragSession !== null || tabPane.isDragging(),
    onUnloadTarget: createUnloadTargetRouter({
      unloadTab: (target) => tabPane.unloadTarget(target),
      unloadGroup: (target) => tabPane.unloadGroupTarget(target),
      unloadWorkspace,
      hasWorkspace: (workspaceId) =>
        currentView?.state.workspaces.some(({ id }) => id === workspaceId) === true
    })
  });
  window.addEventListener("pagehide", () => middleClickUnload.dispose(), { once: true });
  registerSettingsRefreshListener();
  registerWorkspaceRefreshListener();
  registerBackgroundRefreshListener();
  window.addEventListener("pagehide", () => faviconPresenter.destroy(), { once: true });
  window.addEventListener("pagehide", () => customIconUrls.dispose(), { once: true });
  try {
    nativeTabDropResolver = createNativeTabDropResolver({
      browserApi: browser,
      currentWindowId
    });
    await nativeTabDropResolver.initialize();
    window.addEventListener("pagehide", () => nativeTabDropResolver?.dispose(), {
      once: true
    });
  } catch {
    nativeTabDropResolver = null;
  }
  try {
    themeSource = createFirefoxThemeSource(browser, currentWindowId);
    registerAppearanceRefreshListeners();
  } catch {
    themeSource = null;
  }
  const settingsLoaded = await loadSidebarSettings(false);
  if (!settingsLoaded) {
    // Unreadable settings fall back to the default: search available at the top.
    applyTabSearchSettings();
  }
  await loadContainers(false);
  await loadCustomIcons();
  await loadWorkspaces();
  if (!settingsLoaded && currentView) {
    showSettingsError(SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR);
  }
}

void initializeSidebar().catch(() => {
  showError(WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR);
});

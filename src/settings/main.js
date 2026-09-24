import {
  SETTINGS_STATE_STORAGE_KEY,
  createDefaultSettingsState
} from "../contracts/settings-state.js";
import { WORKSPACE_STATE_STORAGE_KEY } from "../contracts/workspace-state.js";
import {
  SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY,
  SETTINGS_BACKUP_RECORD_STORAGE_PREFIX,
  SNAPSHOT_INDEX_STORAGE_KEY,
  SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY,
  SNAPSHOT_MASTER_STORAGE_KEY,
  SNAPSHOT_RECORD_STORAGE_PREFIX,
  SNAPSHOT_SCHEDULE_STORAGE_KEY
} from "../contracts/snapshots.js";
import {
  PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX
} from "../contracts/private-snapshots.js";
import { CUSTOM_ICON_MESSAGE_TYPES } from "../contracts/custom-icons.js";
import { SIDEBAR_UNDO_MESSAGE_TYPES } from "../contracts/sidebar-undo.js";
import { createFirefoxThemeSource } from "../platform/firefox/theme-source.js";
import { applySettingsAppearance } from "../ui/appearance.js";
import { createCustomIconClient } from "../ui/custom-icon-client.js";
import { CustomIconUrlCache } from "../ui/custom-icon-urls.js";
import { createCustomIconNormalizer } from "./custom-icon-normalizer.js";
import { createCustomIconsPanel } from "./custom-icons-panel.js";
import { createAppearancePanel } from "./appearance-panel.js";
import {
  SETTINGS_DATA_STATES,
  SETTINGS_UNAVAILABLE_MESSAGE,
  WORKSPACES_LOADING_MESSAGE,
  WORKSPACES_UNAVAILABLE_MESSAGE,
  createSettingsDataGate
} from "./data-availability.js";
import { createColorPanel } from "./color-panel.js";
import { createWorkspacePackageView } from "./workspace-package-view.js";
import { initializePanelNavigation } from "./panel-navigation.js";
import {
  bookmarkImportClient,
  containerClient,
  privateClient,
  settingsClient,
  snapshotClient,
  storageClient,
  workspacePackageClient,
  workspaceClient
} from "./settings-client.js";
import {
  cleanupImpactLines,
  createCleanupConfirmation,
  createCleanupDialog,
  previewCleanupImpact,
  privateCleanupNoteApplies,
  unseenPrivateCleanupApplies
} from "./cleanup-confirmation.js";
import { createSidebarPanel } from "./sidebar-panel.js";
import { createSnapshotsPanel } from "./snapshots-panel.js";
import { createWorkspacesPanel } from "./workspaces-panel.js";
import { createPrivacyPanel } from "./privacy-panel.js";
import { createStoragePanel } from "./storage-panel.js";
import { createFirefoxStylingPanel } from "./firefox-styling-panel.js";
import { createWarningsPanel } from "./warnings-panel.js";

const status = document.querySelector("#settings-status");
const resetAllButton = document.querySelector("#reset-all-settings");
const resetAllDialog = document.querySelector("#reset-all-settings-dialog");
const resetAllForm = document.querySelector("#reset-all-settings-form");
const resetAllConfirm = document.querySelector("#reset-all-settings-confirm");
const resetAllSubmit = document.querySelector("#reset-all-settings-submit");
const resetAllCancel = document.querySelector("#reset-all-settings-cancel");
const resetAllCleanup = document.querySelector("#reset-all-settings-cleanup");
const resetAllCleanupSummary = document.querySelector("#reset-all-settings-cleanup-summary");
const resetAllCleanupCounts = document.querySelector("#reset-all-settings-cleanup-counts");
const resetAllCleanupPrivateNote = document.querySelector(
  "#reset-all-settings-cleanup-private-note"
);
const colorSchemeQuery = matchMedia("(prefers-color-scheme: dark)");
let currentSettings = createDefaultSettingsState();
let currentTheme = {};
let themeSource;
let unsubscribeTheme;
let privacyPanel;
let storagePanel;
let settingsWindowId = null;
let themeRefreshGeneration = 0;
let settingsLoadGeneration = 0;
let workspaceLoadGeneration = 0;

function setStatus(message, variant = "quiet") {
  status.textContent = message;
  status.hidden = variant !== "error" && ["Ready.", "Changes save automatically."].includes(message);
  if (variant === "error") {
    status.dataset.variant = "error";
  } else {
    delete status.dataset.variant;
  }
}

let clearPanelConfirmations = () => {};
const panelNavigation = initializePanelNavigation({
  saveNavigation: (navigation) => settingsClient.update({ navigation }),
  reportError: (error) => setStatus(error.message, "error"),
  onSelect: (panelId) => {
    setStatus("Changes save automatically.");
    // A confirmation belongs to the panel and the moment that earned it. The
    // navigation selects a panel while it is being set up, before the panels
    // themselves exist, so this is wired once they do.
    clearPanelConfirmations();
    privacyPanel?.setActive(panelId === "privacy");
    storagePanel?.setActive(panelId === "storage");
  }
});
const colorPanel = createColorPanel();
const customIconUrls = new CustomIconUrlCache();
const sidebarPanel = createSidebarPanel({
  client: settingsClient,
  setStatus
});
const warningsPanel = createWarningsPanel({
  client: settingsClient,
  setStatus
});
const appearancePanel = createAppearancePanel({
  client: settingsClient,
  setStatus,
  colorPanel
});
const workspacesPanel = createWorkspacesPanel({
  client: workspaceClient,
  containerClient,
  setStatus,
  colorPanel,
  customIconUrls
});
const snapshotsPanel = createSnapshotsPanel({
  client: snapshotClient,
  privateClient,
  settingsClient,
  bookmarkImportClient,
  containerClient,
  customIconUrls,
  confirmCleanupImpact: createCleanupConfirmation({
    client: snapshotClient,
    privateClient,
    dialog: createCleanupDialog(document)
  }),
  setStatus
});
createWorkspacePackageView({
  client: workspacePackageClient,
  setStatus,
  onImported: () => {
    void loadWorkspaces({ reportFailure: false });
    void workspacesPanel.refreshIcons();
  }
});
const customIconsPanel = createCustomIconsPanel({
  client: createCustomIconClient(),
  workspaceClient,
  normalizer: createCustomIconNormalizer(),
  iconUrls: customIconUrls,
  onLibraryChanged: () => workspacesPanel.refreshIcons()
});
const dataGate = createSettingsDataGate({
  root: document.documentElement,
  settingsRegions: [
    ...document.querySelectorAll("#sidebar-panel, #appearance-panel, #snapshots-panel > .snapshot-section")
  ],
  workspacesRegion: document.querySelector("#workspaces-panel")
});
workspacesPanel.showDataMessage(WORKSPACES_LOADING_MESSAGE);
privacyPanel = createPrivacyPanel({ client: privateClient });
storagePanel = createStoragePanel({
  client: storageClient,
  privateContext: browser.extension?.inIncognitoContext === true
});
const firefoxStylingPanel = createFirefoxStylingPanel();
clearPanelConfirmations = () => {
  firefoxStylingPanel.clearTransientMessages();
};

function applySettings(settings, { applyNavigation = true } = {}) {
  settingsLoadGeneration += 1;
  currentSettings = settings;
  applySettingsAppearance(document.documentElement, settings, currentTheme, {
    prefersDark: colorSchemeQuery.matches
  });
  sidebarPanel.apply(settings);
  appearancePanel.apply(settings);
  snapshotsPanel.apply(settings);
  warningsPanel.apply(settings);
  if (applyNavigation) {
    panelNavigation.apply(settings.navigation);
  }
}

async function refreshSettingsAppearance(theme) {
  const generation = ++themeRefreshGeneration;
  let nextTheme;
  if (theme) {
    nextTheme = theme;
  } else if (themeSource) {
    try {
      nextTheme = await themeSource.getCurrent();
    } catch {
      nextTheme = {};
    }
  } else {
    nextTheme = currentTheme;
  }
  if (generation !== themeRefreshGeneration) return;
  currentTheme = nextTheme;
  applySettingsAppearance(document.documentElement, currentSettings, currentTheme, {
    prefersDark: colorSchemeQuery.matches
  });
}

async function loadSettings({ reportFailure = true } = {}) {
  const generation = ++settingsLoadGeneration;
  try {
    const settings = await settingsClient.get();
    if (generation !== settingsLoadGeneration) return;
    applySettings(settings);
    dataGate.settingsLoaded();
    if (reportFailure) {
      setStatus("Changes save automatically.");
    }
  } catch (error) {
    if (generation !== settingsLoadGeneration) return;
    // A failed reload keeps the values already read; a failed first read
    // leaves the editors inert rather than showing defaults.
    const state = dataGate.settingsFailed();
    setStatus(
      state === SETTINGS_DATA_STATES.READY
        ? error.message
        : `${SETTINGS_UNAVAILABLE_MESSAGE} ${error.message} Restore defaults to repair it.`,
      "error"
    );
  }
}

async function loadWorkspaces({ reportFailure = true } = {}) {
  const generation = ++workspaceLoadGeneration;
  const [stateResult, containersResult] = await Promise.allSettled([
    workspaceClient.get(),
    containerClient.overview()
  ]);
  if (generation !== workspaceLoadGeneration) return;
  if (containersResult.status === "fulfilled") {
    workspacesPanel.applyContainers(containersResult.value);
  } else if (reportFailure) {
    setStatus(containersResult.reason.message, "error");
  }
  try {
    if (stateResult.status === "rejected") {
      throw stateResult.reason;
    }
    workspacesPanel.apply(stateResult.value);
    dataGate.workspacesLoaded();
  } catch (error) {
    const state = dataGate.workspacesFailed();
    if (state === SETTINGS_DATA_STATES.READY) {
      setStatus(error.message, "error");
      return;
    }
    workspacesPanel.showDataMessage(WORKSPACES_UNAVAILABLE_MESSAGE);
    setStatus(`${WORKSPACES_UNAVAILABLE_MESSAGE} ${error.message}`, "error");
  }
}

function retryUnavailableData() {
  if (dataGate.settingsState !== SETTINGS_DATA_STATES.READY) {
    void loadSettings();
  }
  if (dataGate.workspacesState !== SETTINGS_DATA_STATES.READY) {
    void loadWorkspaces();
  }
}

async function ensureSettingsCompanion({ reportFailure = false } = {}) {
  try {
    await workspaceClient.ensureSettingsCompanion();
    return true;
  } catch (error) {
    if (reportFailure) {
      setStatus(`${error.message} Keep another tab open before closing Settings.`, "error");
    }
    return false;
  }
}

let resetAllPreviewGeneration = 0;

// Restore All Defaults brings back the default maximum of 100, so the dialog
// counts the automatic saves beyond it each time it opens.
async function previewResetCleanup() {
  const generation = ++resetAllPreviewGeneration;
  resetAllCleanup.hidden = true;
  const privateContext = snapshotsPanel.isPrivateContext();
  const defaults = createDefaultSettingsState().snapshots;
  let impact;
  try {
    impact = await previewCleanupImpact({
      client: snapshotClient,
      privateClient,
      snapshots: defaults,
      privateContext
    });
  } catch {
    impact = null;
  }
  if (generation !== resetAllPreviewGeneration || !resetAllDialog.open) {
    return;
  }
  if (impact === null) {
    resetAllCleanupSummary.textContent =
      "Terminus could not count the automatic saves beyond the default maximum of 100.";
    resetAllCleanupCounts.replaceChildren();
    resetAllCleanupPrivateNote.hidden = true;
    resetAllCleanup.hidden = false;
    return;
  }
  // A normal window cannot count private automatic saves, so the defaults can
  // still reach saves this preview shows as none.
  const unseenPrivate = unseenPrivateCleanupApplies({
    privateContext,
    privateAutomaticEnabled: currentSettings.privacy.automaticSnapshotsEnabled,
    currentSnapshots: currentSettings.snapshots,
    snapshots: defaults
  });
  if (impact.total === 0 && !unseenPrivate) {
    return;
  }
  resetAllCleanupSummary.textContent = impact.total === 0
    ? `This may also remove Private Snapshots beyond the default maximum of ${defaults.retentionCount}.`
    : `This also removes ${impact.total} automatic save${impact.total === 1 ? "" : "s"} beyond the default maximum of ${defaults.retentionCount}.`;
  resetAllCleanupCounts.replaceChildren(...cleanupImpactLines(impact).map((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    return item;
  }));
  resetAllCleanupPrivateNote.hidden = !(unseenPrivate || privateCleanupNoteApplies({
    privateContext,
    privateAutomaticEnabled: currentSettings.privacy.automaticSnapshotsEnabled
  }));
  resetAllCleanup.hidden = false;
}

resetAllButton.addEventListener("click", () => {
  resetAllConfirm.checked = false;
  resetAllSubmit.disabled = true;
  resetAllDialog.showModal();
  void previewResetCleanup();
});

resetAllConfirm.addEventListener("change", () => {
  resetAllSubmit.disabled = !resetAllConfirm.checked;
});

resetAllCancel.addEventListener("click", () => resetAllDialog.close());

resetAllDialog.addEventListener("close", () => {
  resetAllConfirm.checked = false;
  resetAllSubmit.disabled = true;
  resetAllButton.focus();
});

resetAllForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resetAllConfirm.checked) {
    return;
  }
  resetAllDialog.close();
  resetAllButton.disabled = true;
  setStatus("Restoring Terminus defaults…");
  try {
    applySettings(await settingsClient.reset());
    dataGate.settingsLoaded();
    await loadWorkspaces({ reportFailure: false });
    await privacyPanel.refresh({ quiet: true });
    setStatus("Terminus was restored to its original three workspaces.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    resetAllButton.disabled = false;
  }
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  const changedKeys = Object.keys(changes);
  const settingsChanged = Object.prototype.hasOwnProperty.call(
    changes,
    SETTINGS_STATE_STORAGE_KEY
  );
  const privateRecordsChanged = changedKeys.some((key) =>
    key.startsWith(PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX)
  );
  privacyPanel.notifyLocalStorageChanged(changes);
  storagePanel?.notifyLocalStorageChanged(changes);
  if (settingsChanged) {
    void loadSettings({ reportFailure: false });
  }
  if (Object.prototype.hasOwnProperty.call(changes, WORKSPACE_STATE_STORAGE_KEY)) {
    void loadWorkspaces({ reportFailure: false });
  }
  if (
    changedKeys.some(
      (key) =>
        key === SNAPSHOT_INDEX_STORAGE_KEY ||
        key === SNAPSHOT_MASTER_STORAGE_KEY ||
        key === SNAPSHOT_SCHEDULE_STORAGE_KEY ||
        key === SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY ||
        key === SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY ||
        key.startsWith(SETTINGS_BACKUP_RECORD_STORAGE_PREFIX) ||
        key.startsWith(SNAPSHOT_RECORD_STORAGE_PREFIX)
    )
  ) {
    void snapshotsPanel.refresh({ quiet: true });
  }
  if (privateRecordsChanged) {
    void snapshotsPanel.refresh({ quiet: true });
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "container.changed") {
    void loadWorkspaces({ reportFailure: false });
  }
  if (message?.type === CUSTOM_ICON_MESSAGE_TYPES.CHANGED) {
    void customIconsPanel.refresh();
  }
  if (
    message?.type === SIDEBAR_UNDO_MESSAGE_TYPES.CHANGED &&
    settingsWindowId !== null &&
    message.windowId === settingsWindowId
  ) {
    workspacesPanel.applyUndoSummary(message.summary);
  }
});

browser.permissions.onAdded.addListener(() => {
  void snapshotsPanel.refresh({ quiet: true });
});
browser.permissions.onRemoved.addListener(() => {
  void snapshotsPanel.refresh({ quiet: true });
});

window.addEventListener("focus", () => {
  retryUnavailableData();
  void ensureSettingsCompanion({ reportFailure: true });
  void refreshSettingsAppearance();
  void privacyPanel.refresh({ quiet: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    retryUnavailableData();
    void ensureSettingsCompanion({ reportFailure: true });
    void refreshSettingsAppearance();
  }
});

try {
  const settingsWindow = await browser.windows.getCurrent();
  settingsWindowId = settingsWindow.id;
  themeSource = createFirefoxThemeSource(browser, settingsWindow.id);
  await refreshSettingsAppearance();
  unsubscribeTheme = themeSource.subscribe((theme) => {
    void refreshSettingsAppearance(theme);
  });
} catch {
  await refreshSettingsAppearance({});
}
colorSchemeQuery.addEventListener("change", () => {
  void refreshSettingsAppearance();
});
window.addEventListener("pagehide", () => unsubscribeTheme?.(), { once: true });
window.addEventListener("pagehide", () => privacyPanel.destroy(), { once: true });
window.addEventListener("pagehide", () => storagePanel.destroy(), { once: true });
window.addEventListener("pagehide", () => customIconUrls.dispose(), { once: true });
// Snapshot Viewer and workspace rows draw custom images from this library.
await customIconsPanel.refresh();
const initializationResults = await Promise.all([
  ensureSettingsCompanion({ reportFailure: true }),
  loadSettings(),
  loadWorkspaces(),
  snapshotsPanel.refresh(),
  privacyPanel.refresh(),
  storagePanel.refresh({ quiet: true })
]);
if (!initializationResults[0]) {
  setStatus("Keep another tab open before closing Settings.", "error");
}

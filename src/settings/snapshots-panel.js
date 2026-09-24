import {
  SNAPSHOT_SETTINGS_LIMITS,
  getSnapshotIntervalValueLimits
} from "../contracts/settings-state.js";
import {
  MAX_BACKUP_BYTES,
  SETTINGS_BACKUP_REASONS,
  SNAPSHOT_KINDS,
  SNAPSHOT_RESTORE_SCOPES
} from "../contracts/snapshots.js";
import { presentWorkspaceIcon } from "../ui/workspace-icon-presentation.js";
import { createBookmarkImportView } from "./bookmark-import-view.js";
import { groupColorToken } from "../ui/group-colors.js";

function formatDate(value) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(
    new Date(value)
  );
}

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "Unavailable";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

const SITE_TILE_COLORS = Object.freeze([
  "#5b8def", "#4fb3c9", "#56b88a", "#e6a23c", "#d86b6b", "#c778dd", "#8a9cf0", "#d98fb0"
]);

function kindLabel(kind) {
  return kind === "automatic" ? "Automatic" : "Manual";
}

export function snapshotProvenance(record) {
  if (record?.documentType === "sidebars.private-snapshot-record") {
    return Object.freeze({ id: "private", label: "Private" });
  }
  if (record?.reason === "firefox-sync-import") {
    return Object.freeze({ id: "imported", label: "Imported" });
  }
  if (["file-import", "legacy-master-import"].includes(record?.reason)) {
    return Object.freeze({ id: "imported", label: "Imported" });
  }
  return Object.freeze({ id: record?.kind ?? "manual", label: kindLabel(record?.kind) });
}

export function latestAutomaticSnapshotCreatedAt(records) {
  let latestCreatedAt = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (record?.kind !== SNAPSHOT_KINDS.AUTOMATIC) {
      continue;
    }
    const timestamp = Date.parse(record.createdAt);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestCreatedAt = record.createdAt;
      latestTimestamp = timestamp;
    }
  }
  return latestCreatedAt;
}

function tabCount(record) {
  return record.payload.windows.reduce(
    (total, window) => total + window.workspaceLayouts.reduce(
      (count, layout) => count + layout.tabs.length,
      0
    ),
    0
  );
}

// A snapshot in the list is a selectable row, not one of the three action
// buttons, so it is built without their shared styling.
function listEntry(onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "snapshot-list-item";
  element.addEventListener("click", onClick);
  return element;
}

function button(label, onClick, className = null) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className ? `btn ${className}` : "btn";
  element.addEventListener("click", onClick);
  return element;
}

const RESTORE_ISSUE_LABELS = Object.freeze({
  "interrupted-restore-undone": "Interrupted restore undone",
  "newer-changes-kept": "Newer changes kept",
  "recovery-record-unreadable": "Unreadable recovery record removed",
  "tab-tidying-failed": "Tab tidying failed; Terminus will retry"
});

const SETTINGS_SECTION_LABELS = Object.freeze({
  sidebar: "Sidebar",
  appearance: "Appearance",
  navigation: "Settings page",
  snapshots: "Snapshots",
  workspaces: "Workspaces"
});

export function restoreIssueLabel(kind) {
  return RESTORE_ISSUE_LABELS[kind] ?? String(kind)
    .replaceAll("-", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

// A settings restore opens no tabs or windows, so its summary names the
// restored sections instead of snapshot tab and window counts.
export function settingsRestoreReportSummary(report, formattedDate) {
  const sections = report.sections.length === 0
    ? "sections unknown"
    : report.sections.map((section) => SETTINGS_SECTION_LABELS[section] ?? section).join(", ");
  return `${report.status === "complete" ? "Completed" : "Partly completed"} ${formattedDate} · ${sections}`;
}

// The Snapshots summary line; it describes every automatic library, including
// private automatic saves that a normal window cannot edit.
export function cleanupSummaryText(settings) {
  const { snapshots, privacy } = settings;
  if (
    !snapshots.automaticEnabled &&
    !snapshots.automaticSettingsBackupsEnabled &&
    !privacy.automaticSnapshotsEnabled
  ) {
    return "Automatic saves are off, so nothing is removed.";
  }
  return `Keeps the newest ${snapshots.retentionCount} automatic saves in each library and removes the oldest when a new one goes over.`;
}

export function sanitizeBoundedIntegerText(value, { min, max }, { commit = false } = {}) {
  const digits = String(value).replace(/\D/g, "");
  if (digits === "") {
    return commit ? String(min) : "";
  }
  const number = Number(digits);
  if (number > max) {
    return String(max);
  }
  if (commit && number < min) {
    return String(min);
  }
  return commit ? String(number) : digits;
}

export function createSnapshotsPanel({
  client,
  privateClient,
  settingsClient,
  bookmarkImportClient,
  containerClient = null,
  customIconUrls = null,
  confirmCleanupImpact,
  setStatus
}) {
  function snapshotWorkspaceIcon(workspace) {
    const presentation = presentWorkspaceIcon(workspace?.icon, customIconUrls);
    if (presentation.kind === "image") {
      const image = document.createElement("img");
      image.className = "snapshot-workspace-icon snapshot-workspace-icon--image";
      image.alt = "";
      image.src = presentation.url;
      return image;
    }
    const workspaceIcon = document.createElement("span");
    workspaceIcon.className = "snapshot-workspace-icon";
    workspaceIcon.setAttribute("aria-hidden", "true");
    workspaceIcon.style.setProperty("--icon-mask", `url("${presentation.path}")`);
    workspaceIcon.style.setProperty("--icon-scale", String(presentation.opticalScale));
    workspaceIcon.style.setProperty("--icon-color", workspace?.color ?? "#2563eb");
    return workspaceIcon;
  }

  const automaticEnabled = document.querySelector("#snapshots-automatic-enabled");
  const automaticSettingsBackupsEnabled = document.querySelector(
    "#settings-backups-automatic-enabled"
  );
  const intervalValue = document.querySelector("#snapshots-interval-value");
  const intervalUnit = document.querySelector("#snapshots-interval-unit");
  const testAutomatic = document.querySelector("#snapshots-test-automatic");
  const testStatus = document.querySelector("#snapshots-test-status");
  const retentionCount = document.querySelector("#snapshots-retention-count");
  const restoreBatchSize = document.querySelector("#snapshots-restore-batch-size");
  const cleanupSummary = document.querySelector("#snapshots-cleanup-summary");
  const clearViewerButton = document.querySelector("#snapshots-clear-viewer");
  const storageStatus = document.querySelector("#snapshots-storage-status");
  const lastSave = document.querySelector("#snapshots-last-save");
  const nextSave = document.querySelector("#snapshots-next-save");
  const schedulePill = document.querySelector("#snapshots-schedule-pill");
  const list = document.querySelector("#snapshots-list");
  const listCount = document.querySelector("#snapshots-count");
  const viewerTitle = document.querySelector("#snapshot-viewer-title");
  const viewerMeta = document.querySelector("#snapshot-viewer-meta");
  const viewerActions = document.querySelector("#snapshot-viewer-actions");
  const viewerTree = document.querySelector("#snapshot-viewer-tree");
  const addImportButton = document.querySelector("#snapshots-add-import");
  const exportButton = document.querySelector("#snapshots-export");
  const openSelectedButton = document.querySelector("#snapshots-open-selected");
  const openAllButton = document.querySelector("#snapshots-open-all");
  const deleteButton = document.querySelector("#snapshots-delete");
  const restoreReport = document.querySelector("#snapshots-restore-report");
  const viewerLastAutomaticSave = document.querySelector(
    "#snapshot-viewer-last-automatic-save"
  );
  const viewerNextAutomaticSave = document.querySelector(
    "#snapshot-viewer-next-automatic-save"
  );
  const viewerStatus = document.querySelector("#snapshot-viewer-status");
  const settingsRestoreReport = document.querySelector("#settings-backup-restore-report");
  const snapshotImportFile = document.querySelector("#snapshots-import-file");
  const settingsImportFile = document.querySelector("#settings-backup-import-file");
  const settingsImportPreview = document.querySelector("#settings-backup-import-preview");
  const settingsBackupList = document.querySelector("#settings-backup-list");
  const deleteDialog = document.querySelector("#snapshot-delete-dialog");
  const deleteForm = document.querySelector("#snapshot-delete-form");
  const deleteDialogTitle = document.querySelector("#snapshot-delete-dialog-title");
  const deleteDialogDetails = document.querySelector("#snapshot-delete-dialog-details");
  const skipDeleteWarning = document.querySelector("#snapshot-skip-delete-warning");
  const cancelDeleteButton = document.querySelector("#snapshot-cancel-delete");
  const confirmActionButton = document.querySelector("#snapshot-confirm-action");
  const containerDialog = document.querySelector("#snapshot-container-dialog");
  const containerForm = document.querySelector("#snapshot-container-form");
  const containerResolutions = document.querySelector("#snapshot-container-resolutions");
  const cancelContainerButton = document.querySelector("#snapshot-container-cancel");
  const snapshotsHeading = document.querySelector("#snapshots-heading");
  const snapshotsAutomaticLabel = document.querySelector("#snapshots-automatic-label");
  const snapshotsAutomaticDescription = document.querySelector("#snapshots-automatic-description");
  const viewerHeading = document.querySelector("#snapshot-viewer-heading");
  const locationNote = document.querySelector("#snapshot-location-note");
  const snapshotsNavigationLabel = document.querySelector("#snapshots-navigation-label");
  const viewerNavigationLabel = document.querySelector("#snapshot-viewer-navigation-label");
  const snapshotsMobileLabel = document.querySelector("#snapshots-mobile-label");
  const viewerMobileLabel = document.querySelector("#snapshot-viewer-mobile-label");
  const viewerAutomaticHeading = document.querySelector("#snapshot-automatic-status-heading");
  const createButton = document.querySelector("#snapshots-create");
  let currentSettings = null;
  let currentView = null;
  let loadedSnapshots = [];
  let busy = false;
  let testPending = false;
  let testTimer = null;
  let pendingConfirmation = null;
  let pendingContainerResolution = null;
  let privateContext = false;
  let availableContainerRefs = new Set();
  const selectedTabIds = new Set();
  let refreshGeneration = 0;
  let snapshotImportGeneration = 0;
  let settingsImportGeneration = 0;
  let pendingSnapshotSelectionId = null;

  function snapshotClient() {
    return privateContext ? privateClient : client;
  }

  function configureScope(nextPrivateContext) {
    if (privateContext !== nextPrivateContext) {
      snapshotImportGeneration += 1;
      currentView = null;
      selectedTabIds.clear();
      snapshotImportFile.value = "";
    }
    privateContext = nextPrivateContext;
    snapshotsHeading.textContent = privateContext ? "Private Snapshots" : "Snapshots";
    snapshotsAutomaticLabel.textContent = privateContext
      ? "Automatic Private Snapshots"
      : "Automatic Sidebar Snapshots";
    snapshotsAutomaticDescription.textContent = privateContext
      ? "Saves private workspaces and tabs on this computer."
      : "Saves workspaces and tabs.";
    viewerHeading.textContent = privateContext ? "Private Snapshot Viewer" : "Snapshot Viewer";
    locationNote.textContent = privateContext
      ? "Private Snapshots stay in this Firefox profile. Exported files hold private tab addresses and titles. An ordinary snapshot file imports here as a private copy, without its containers, and stays until you remove it."
      : "Snapshots stay in this Firefox profile. Exported files hold tab addresses, titles and container names, never cookies or sign-ins.";
    snapshotsNavigationLabel.textContent = privateContext ? "Private Snapshots" : "Snapshots";
    viewerNavigationLabel.textContent = privateContext ? "Private Snapshot Viewer" : "Snapshot Viewer";
    snapshotsMobileLabel.textContent = snapshotsNavigationLabel.textContent;
    viewerMobileLabel.textContent = viewerNavigationLabel.textContent;
    viewerAutomaticHeading.textContent = privateContext
      ? "Automatic Private Snapshots"
      : "Automatic snapshots";
    createButton.textContent = privateContext ? "Create private snapshot" : "Create snapshot";
  }

  // The Viewer is the only home for bookmark import. This panel owns the shared
  // header, action row, and tree elements, so it hands them to the import view
  // and steps aside while that view is active.
  const bookmarkImport = createBookmarkImportView({
    document,
    client: bookmarkImportClient,
    importButton: document.querySelector("#bookmark-import"),
    privateNote: document.querySelector("#bookmark-import-private-note"),
    dialog: document.querySelector("#bookmark-import-dialog"),
    form: document.querySelector("#bookmark-import-form"),
    firefoxChoice: document.querySelector("#bookmark-import-firefox-choice"),
    fileChoice: document.querySelector("#bookmark-import-file-choice"),
    dialogCancel: document.querySelector("#bookmark-import-cancel-dialog"),
    fileInput: document.querySelector("#bookmark-import-file"),
    viewerTitle,
    viewerMeta,
    viewerActions,
    viewerTree,
    importActions: document.querySelector("#bookmark-import-actions"),
    importTotals: document.querySelector("#bookmark-import-totals"),
    createButton: document.querySelector("#bookmark-import-create"),
    cancelButton: document.querySelector("#bookmark-import-cancel"),
    setStatus: reportViewerStatus,
    onEnter: () => {
      currentView = null;
      selectedTabIds.clear();
      renderSnapshotList();
    },
    onExit: () => {
      void refresh({ quiet: true });
    }
  });

  function reportViewerStatus(message, variant = "quiet") {
    viewerStatus.textContent = message;
    if (variant === "error") {
      viewerStatus.dataset.variant = "error";
    } else {
      delete viewerStatus.dataset.variant;
    }
    setStatus(message, variant);
  }

  function apply(settings) {
    currentSettings = settings;
    const snapshots = settings.snapshots;
    const automaticSnapshotsEnabled = privateContext
      ? settings.privacy.automaticSnapshotsEnabled
      : snapshots.automaticEnabled;
    automaticEnabled.checked = automaticSnapshotsEnabled;
    automaticSettingsBackupsEnabled.checked = snapshots.automaticSettingsBackupsEnabled;
    const scheduledEnabled = automaticSnapshotsEnabled ||
      snapshots.automaticSettingsBackupsEnabled;
    intervalValue.value = String(snapshots.intervalValue);
    intervalUnit.value = snapshots.intervalUnit;
    retentionCount.value = String(snapshots.retentionCount);
    restoreBatchSize.value = String(snapshots.restoreBatchSize);
    cleanupSummary.textContent = cleanupSummaryText(settings);
    intervalValue.disabled = !scheduledEnabled;
    intervalUnit.disabled = !scheduledEnabled;
    testAutomatic.disabled = !automaticSnapshotsEnabled || testPending;
    if (!testPending) {
      testStatus.textContent = automaticSnapshotsEnabled
        ? "Ready to start a five-second test snapshot."
        : `Turn on Automatic ${privateContext ? "Private" : "Sidebar"} Snapshots to run this test.`;
    }
    retentionCount.disabled = !scheduledEnabled;
    const setDisabledRow = (input, disabled) => {
      const row = input.closest(".setting-row");
      row?.classList.toggle("is-disabled", disabled);
      row?.setAttribute("aria-disabled", String(disabled));
    };
    setDisabledRow(intervalValue, !scheduledEnabled);
    setDisabledRow(testAutomatic, !automaticSnapshotsEnabled);
    setDisabledRow(retentionCount, !scheduledEnabled);
    const intervalLimits = getSnapshotIntervalValueLimits(snapshots.intervalUnit);
    intervalValue.setAttribute("aria-valuemin", String(intervalLimits.min));
    intervalValue.setAttribute("aria-valuemax", String(intervalLimits.max));
    retentionCount.setAttribute("aria-valuemin", String(SNAPSHOT_SETTINGS_LIMITS.retentionCount.min));
    retentionCount.setAttribute("aria-valuemax", String(SNAPSHOT_SETTINGS_LIMITS.retentionCount.max));
    restoreBatchSize.setAttribute("aria-valuemin", String(SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.min));
    restoreBatchSize.setAttribute("aria-valuemax", String(SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.max));
  }

  async function updateSettings(patch) {
    try {
      const settings = await settingsClient.update({ snapshots: patch });
      apply(settings);
      setStatus("Automatic backup settings saved.");
    } catch (error) {
      if (currentSettings) {
        apply(currentSettings);
      }
      setStatus(error.message, "error");
    }
  }

  // Any change to the maximum or age limit is previewed first; saves that
  // already exist are removed only after the user chooses Remove.
  async function updateCleanupSettings(patch) {
    if (!currentSettings) {
      return;
    }
    let confirmed;
    try {
      confirmed = await confirmCleanupImpact({
        snapshots: { ...currentSettings.snapshots, ...patch },
        currentSnapshots: currentSettings.snapshots,
        privateContext,
        privateAutomaticEnabled: currentSettings.privacy.automaticSnapshotsEnabled
      });
    } catch (error) {
      apply(currentSettings);
      setStatus(error.message, "error");
      return;
    }
    if (!confirmed) {
      apply(currentSettings);
      setStatus("Automatic save cleanup was not changed.");
      return;
    }
    await updateSettings(patch);
  }

  async function confirmBackupCleanup(backupSnapshots) {
    try {
      const confirmed = await confirmCleanupImpact({
        snapshots: await backupSnapshots(),
        currentSnapshots: currentSettings?.snapshots ?? null,
        privateContext,
        privateAutomaticEnabled: currentSettings?.privacy.automaticSnapshotsEnabled === true
      });
      if (!confirmed) {
        setStatus("The settings backup was not restored.");
      }
      return confirmed;
    } catch (error) {
      setStatus(error.message, "error");
      return false;
    }
  }

  async function updateAutomaticSnapshots(enabled) {
    if (!privateContext) {
      return updateSettings({ automaticEnabled: enabled });
    }
    try {
      const result = await privateClient.setAutomaticSnapshots(enabled);
      apply(result.settings);
      setStatus("Automatic Private Snapshot settings saved.");
      return result.settings;
    } catch (error) {
      if (currentSettings) {
        apply(currentSettings);
      }
      setStatus(error.message, "error");
      return null;
    }
  }

  function bindIntegerInput(input, limits, currentValue, onCommit) {
    const sanitize = (commit = false) => {
      input.value = sanitizeBoundedIntegerText(input.value, limits(), { commit });
      return input.value === "" ? null : Number(input.value);
    };
    input.addEventListener("input", () => sanitize(false));
    input.addEventListener("change", () => {
      const value = sanitize(true);
      if (value !== currentValue()) {
        void onCommit(value);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    return sanitize;
  }

  const sanitizeInterval = bindIntegerInput(
    intervalValue,
    () => getSnapshotIntervalValueLimits(intervalUnit.value),
    () => currentSettings?.snapshots.intervalValue,
    (value) => updateSettings({ intervalValue: value })
  );
  bindIntegerInput(
    retentionCount,
    () => SNAPSHOT_SETTINGS_LIMITS.retentionCount,
    () => currentSettings?.snapshots.retentionCount,
    (value) => updateCleanupSettings({ retentionCount: value })
  );
  bindIntegerInput(
    restoreBatchSize,
    () => SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize,
    () => currentSettings?.snapshots.restoreBatchSize,
    (value) => updateSettings({ restoreBatchSize: value })
  );

  async function ensureDownloadsPermission() {
    const granted = await snapshotClient().requestDownloadsPermission();
    if (!granted) {
      const error = new Error("Allow Downloads access to save files.");
      error.code = "PERMISSION_REQUIRED";
      throw error;
    }
  }

  async function run(
    buttonElement,
    progress,
    operation,
    success,
    { refreshAfter = true, report = setStatus } = {}
  ) {
    if (busy) {
      return null;
    }
    busy = true;
    buttonElement.disabled = true;
    report(progress);
    try {
      const result = await operation();
      report(typeof success === "function" ? success(result) : success);
      if (refreshAfter) {
        await refresh({ quiet: true });
      }
      return result;
    } catch (error) {
      report(error.message, "error");
      return null;
    } finally {
      busy = false;
      buttonElement.disabled = false;
    }
  }

  async function performRestore(
    source,
    scope,
    options,
    trigger,
    warningPreferenceFailed = false
  ) {
    if (!source) {
      return;
    }
    const request = { scope, ...options };
    if (!privateContext) {
      try {
        reportViewerStatus("Checking Firefox container assignments...");
        const preflight = await client.containerPreflight(source, request);
        if (preflight.required) {
          const decisions = await chooseContainerResolutions(preflight);
          if (!decisions) {
            reportViewerStatus("Snapshot restore canceled.");
            return;
          }
          request.containerResolutions = decisions;
        }
      } catch (error) {
        reportViewerStatus(error.message, "error");
        return;
      }
    }
    await run(
      trigger,
      "Opening snapshot…",
      () => snapshotClient().restore(source, request),
      (report) => report.status === "complete"
        ? `Restored ${report.created.tabs} tabs across ${report.created.windows + 1} window${report.created.windows === 0 ? "" : "s"}; closed ${report.applied.closedTabs} previous tab${report.applied.closedTabs === 1 ? "" : "s"} and ${report.applied.closedWindows} previous window${report.applied.closedWindows === 1 ? "" : "s"}.${warningPreferenceFailed ? " The warning preference could not be saved." : ""}`
        : `The snapshot replacement partly completed.${warningPreferenceFailed ? " The warning preference could not be saved." : ""}`,
      { report: reportViewerStatus }
    );
  }

  function chooseContainerResolutions(preflight) {
    containerResolutions.replaceChildren();
    const unresolved = preflight.references.filter(({ autoReuse }) => !autoReuse);
    for (const reference of unresolved) {
      const row = document.createElement("div");
      row.className = "snapshot-container-resolution";
      const strong = document.createElement("strong");
      strong.textContent = reference.descriptor.name;
      const usage = document.createElement("p");
      usage.textContent = `${reference.tabCount} tab${reference.tabCount === 1 ? "" : "s"}, ${reference.workspaceDefaultCount} workspace default${reference.workspaceDefaultCount === 1 ? "" : "s"}`;
      const select = document.createElement("select");
      select.required = true;
      select.dataset.refId = reference.refId;
      select.setAttribute("aria-label", `Container for ${reference.descriptor.name}`);
      const preferredRefId = reference.suggestedRefIds[0] ?? reference.nameMatchRefIds[0] ?? null;
      const canRecreate = preferredRefId === null &&
        preflight.capability === "available" &&
        preflight.supportedColors.includes(reference.descriptor.color) &&
        preflight.supportedIcons.includes(reference.descriptor.icon);
      for (const choice of preflight.choices) {
        const option = document.createElement("option");
        option.value = `existing:${choice.refId}`;
        option.textContent = choice.descriptor.name;
        if (reference.suggestedRefIds.includes(choice.refId)) {
          option.className = "snapshot-container-match";
          option.title = "Exact snapshot match";
        }
        option.selected = choice.refId === preferredRefId;
        select.append(option);
      }
      if (canRecreate) {
        const recreate = document.createElement("option");
        recreate.value = "recreate";
        recreate.textContent = reference.descriptor.name;
        recreate.title = "Create this missing Firefox container";
        recreate.selected = true;
        select.append(recreate);
      }
      const none = document.createElement("option");
      none.value = "none";
      none.textContent = "Ignore Containers";
      none.selected = preferredRefId === null && !canRecreate;
      select.append(none);
      row.append(strong, usage, select);
      containerResolutions.append(row);
    }
    containerDialog.showModal();
    return new Promise((resolve) => {
      pendingContainerResolution = resolve;
    });
  }

  function requestRestore(scope, options, trigger) {
    const source = currentView?.source ? structuredClone(currentView.source) : null;
    if (!source) {
      return;
    }
    if (currentSettings?.snapshots.warnBeforeSnapshotDeletion === false) {
      void performRestore(source, scope, options, trigger);
      return;
    }
    pendingConfirmation = { kind: "restore", source, scope, options, trigger };
    skipDeleteWarning.checked = false;
    deleteDialogTitle.textContent = "Overwrite current tabs?";
    deleteDialogDetails.textContent =
      `This will close every tab currently open in all ${privateContext ? "private" : "normal"} Firefox windows, including tabs created after this snapshot. Only the selected snapshot content will remain. Terminus creates an internal safety snapshot first and keeps Firefox open, but unsaved page data can still be lost.`;
    confirmActionButton.textContent = "Overwrite tabs";
    deleteDialog.showModal();
  }

  function updateSelectedAction() {
    const count = selectedTabIds.size;
    openSelectedButton.disabled = count === 0;
    openSelectedButton.textContent = count === 0
      ? "Open selected tabs"
      : `Open selected tabs (${count})`;
  }

  function treeDepth(layout, tabId) {
    const byId = new Map(layout.tree.map((node) => [node.tabId, node]));
    const visited = new Set();
    let depth = 0;
    let current = byId.get(tabId);
    while (current?.parentTabId && !visited.has(current.parentTabId) && depth < 12) {
      visited.add(current.parentTabId);
      depth += 1;
      current = byId.get(current.parentTabId);
    }
    return depth;
  }

  // A tab or workspace with no container shows nothing; only a real container
  // earns a chip, and one missing from this profile says so in words.
  function containerChip(record, assignment) {
    if (!assignment || assignment.kind === "none") return null;
    const descriptor = record.payload.containerCatalog
      ?.find(({ refId }) => refId === assignment.refId)?.descriptor;
    const name = descriptor?.name ?? "Unavailable container";
    const chip = document.createElement("span");
    chip.className = "snapshot-container-chip";
    chip.style.setProperty("--container-color", descriptor?.colorCode ?? "currentColor");
    if (availableContainerRefs.has(assignment.refId)) {
      chip.textContent = name;
    } else {
      chip.classList.add("is-unavailable");
      chip.textContent = `${name} · not on this profile`;
    }
    return chip;
  }

  // Snapshots keep no favicons, so each tab shows its site's first letter on a
  // colour picked from the site, the same for that site in every snapshot.
  function siteTile(url) {
    let site = "";
    try {
      const parsed = new URL(url);
      site = parsed.hostname.replace(/^www\./, "") || parsed.pathname.replace(/^\/+/, "");
    } catch {
      site = "";
    }
    let hash = 0;
    for (const character of site) {
      hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
    }
    const tile = document.createElement("span");
    tile.className = "snapshot-tab-site";
    tile.setAttribute("aria-hidden", "true");
    tile.style.setProperty("--site-color", SITE_TILE_COLORS[hash % SITE_TILE_COLORS.length]);
    tile.textContent = (site[0] ?? "·").toUpperCase();
    return tile;
  }

  function treeCount(text) {
    const count = document.createElement("span");
    count.className = "snapshot-tree-count";
    count.textContent = text;
    return count;
  }

  function createTabRow(record, tab, layout) {
    const row = document.createElement("label");
    row.className = "snapshot-tab-row";
    row.style.setProperty("--tree-depth", String(treeDepth(layout, tab.id)));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedTabIds.has(tab.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedTabIds.add(tab.id);
      } else {
        selectedTabIds.delete(tab.id);
      }
      updateSelectedAction();
    });
    const title = document.createElement("span");
    title.className = "snapshot-tab-title";
    title.textContent = tab.title || "Untitled tab";
    title.title = tab.url;
    const meta = document.createElement("span");
    meta.className = "snapshot-tab-meta";
    if (layout.pinnedTabIds.includes(tab.id)) {
      const pinned = document.createElement("span");
      pinned.className = "snapshot-tab-pinned";
      pinned.textContent = "Pinned";
      meta.append(pinned);
    }
    const chip = containerChip(record, tab.container);
    if (chip) meta.append(chip);
    row.append(checkbox, siteTile(tab.url), title, meta);
    return row;
  }

  function appendWorkspaceTabs(record, container, layout) {
    const groupByTab = new Map();
    for (const group of layout.groups) {
      for (const tabId of group.tabIds) {
        groupByTab.set(tabId, group);
      }
    }
    const renderedGroups = new Set();
    for (const tab of layout.tabs) {
      const group = groupByTab.get(tab.id);
      if (!group) {
        container.append(createTabRow(record, tab, layout));
        continue;
      }
      if (renderedGroups.has(group.id)) {
        continue;
      }
      renderedGroups.add(group.id);
      const details = document.createElement("details");
      details.className = "snapshot-tree-group";
      details.style.setProperty("--group-color", groupColorToken(group.color));
      details.open = !group.collapsed;
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.className = "snapshot-tree-group-title";
      title.textContent = group.title || "Tab group";
      summary.append(title, treeCount(`${group.tabIds.length} tabs`));
      details.append(summary);
      const members = new Set(group.tabIds);
      layout.tabs.filter(({ id }) => members.has(id)).forEach((member) => {
        details.append(createTabRow(record, member, layout));
      });
      container.append(details);
    }
  }

  // The rail is the workspace order the user actually sees in the sidebar, top
  // to bottom. A window stores its layouts in its own order, so the viewer
  // reorders them to match the rail instead of presenting a different sequence
  // from the one the snapshot was taken from. A layout whose workspace is
  // missing from the rail keeps its relative position at the end.
  function railOrderedLayouts(record, snapshotWindow) {
    const railOrder = new Map(
      (record.payload.workspaceState.rail ?? [])
        .filter(({ kind }) => kind === "workspace")
        .map((entry, index) => [entry.workspaceId, index])
    );
    const unranked = railOrder.size;
    return [...snapshotWindow.workspaceLayouts].sort(
      (left, right) =>
        (railOrder.get(left.workspaceId) ?? unranked) -
        (railOrder.get(right.workspaceId) ?? unranked)
    );
  }

  function renderTree(record) {
    viewerTree.replaceChildren();
    const workspaces = new Map(record.payload.workspaceState.workspaces.map((item) => [item.id, item]));
    record.payload.windows.forEach((window, windowIndex) => {
      const windowNode = document.createElement("details");
      windowNode.className = "snapshot-tree-window";
      windowNode.open = true;
      const windowSummary = document.createElement("summary");
      const windowName = document.createElement("strong");
      windowName.textContent = `Window ${windowIndex + 1}`;
      const windowTabs = window.workspaceLayouts.reduce((total, layout) => total + layout.tabs.length, 0);
      windowSummary.append(windowName, treeCount(`${windowTabs} tabs`));
      const windowActions = document.createElement("div");
      windowActions.className = "snapshot-node-actions";
      windowActions.append(button("Open window", (event) => {
        requestRestore(
          SNAPSHOT_RESTORE_SCOPES.WINDOW,
          { windowId: window.id },
          event.currentTarget
        );
      }, "snapshot-restore-button"));
      windowNode.append(windowSummary, windowActions);

      for (const layout of railOrderedLayouts(record, window)) {
        const workspace = workspaces.get(layout.workspaceId);
        const workspaceNode = document.createElement("details");
        workspaceNode.className = "snapshot-tree-workspace";
        workspaceNode.open = true;
        const workspaceSummary = document.createElement("summary");
        const workspaceLabel = document.createElement("span");
        workspaceLabel.className = "snapshot-workspace-label";
        const workspaceIcon = snapshotWorkspaceIcon(workspace);
        const workspaceName = document.createElement("strong");
        workspaceName.textContent = workspace?.name ?? "Workspace";
        workspaceLabel.append(workspaceIcon, workspaceName);
        const defaultChip = workspace?.defaultContainerRef
          ? containerChip(record, { kind: "container", refId: workspace.defaultContainerRef })
          : null;
        if (defaultChip) workspaceLabel.append(defaultChip);
        workspaceSummary.append(workspaceLabel, treeCount(`${layout.tabs.length} tabs`));
        workspaceNode.append(workspaceSummary);
        appendWorkspaceTabs(record, workspaceNode, layout);
        windowNode.append(workspaceNode);
      }
      viewerTree.append(windowNode);
    });
  }

  function renderViewer(view) {
    bookmarkImport.exit({ restore: false });
    currentView = view;
    selectedTabIds.clear();
    updateSelectedAction();
    const { record, summary, imported } = view;
    const provenance = privateContext
      ? Object.freeze({ id: "private", label: "Private" })
      : snapshotProvenance(record);
    viewerTitle.textContent = `${provenance.label} snapshot — ${formatDate(record.createdAt)}`;
    viewerTitle.dataset.provenance = provenance.id;
    viewerMeta.textContent = `${record.payload.windows.length} window${record.payload.windows.length === 1 ? "" : "s"} · ${record.payload.workspaceState.workspaces.length} workspaces · ${tabCount(record)} tabs${summary ? ` · ${formatBytes(summary.byteLength)}` : ""}${summary?.protected ? " · Startup protected" : ""}`;
    viewerActions.hidden = false;
    addImportButton.hidden = !imported;
    exportButton.hidden = imported;
    exportButton.dataset.snapshotProvenance = provenance.id;
    deleteButton.hidden = imported;
    openAllButton.textContent = "Open all windows";
    renderTree(record);
    renderSnapshotList();
  }

  function renderSnapshotList() {
    list.replaceChildren();
    listCount.textContent = `${loadedSnapshots.length} saved`;
    if (loadedSnapshots.length === 0) {
      const empty = document.createElement("p");
      empty.className = "snapshot-empty";
      empty.textContent = privateContext
        ? "No private snapshots saved yet."
        : "No snapshots saved yet.";
      list.append(empty);
      return;
    }
    for (const item of loadedSnapshots) {
      const entry = listEntry(() => renderViewer({
        ...item,
        source: { id: item.summary.id },
        imported: false
      }));
      entry.setAttribute("aria-pressed", String(currentView?.summary?.id === item.summary.id));
      const heading = document.createElement("span");
      const date = document.createElement("strong");
      date.textContent = formatDate(item.summary.createdAt);
      const badge = document.createElement("span");
      const provenance = privateContext
        ? Object.freeze({ id: "private", label: "Private" })
        : snapshotProvenance(item.record);
      badge.className = `snapshot-kind snapshot-kind--${provenance.id}`;
      badge.textContent = provenance.label;
      heading.append(date, badge);
      const meta = document.createElement("small");
      meta.textContent = `${item.record.payload.windows.length} window${item.record.payload.windows.length === 1 ? "" : "s"} · ${tabCount(item.record)} tabs · ${formatBytes(item.summary.byteLength)}${item.summary.protected ? " · Startup protected" : ""}`;
      entry.replaceChildren(heading, meta);
      list.append(entry);
    }
  }

  function renderRestoreReport(container, report, emptyMessage) {
    container.replaceChildren();
    if (!report) {
      const empty = document.createElement("p");
      empty.className = "snapshot-empty";
      empty.textContent = emptyMessage;
      container.append(empty);
      return;
    }
    const summary = document.createElement("p");
    summary.className = "snapshot-report-summary";
    const settingsScope = report.scope === "settings";
    summary.textContent = settingsScope
      ? settingsRestoreReportSummary(report, formatDate(report.finishedAt))
      : `${report.status === "complete" ? "Completed" : "Partly completed"} ${formatDate(report.finishedAt)} · ${report.created.tabs} snapshot tabs restored across ${report.created.windows + 1} window${report.created.windows === 0 ? "" : "s"} · ${report.applied.closedTabs} previous tabs closed · ${report.applied.closedWindows} previous windows closed`;
    container.append(summary);
    for (const [heading, entries] of [
      ["Changed", report.approximations],
      ["Skipped", report.skipped],
      [settingsScope ? "Problems" : "Could not open", report.failures]
    ]) {
      if (entries.length === 0) {
        continue;
      }
      const details = document.createElement("details");
      details.className = "snapshot-report-details";
      const label = document.createElement("summary");
      label.textContent = `${heading} (${entries.length})`;
      const items = document.createElement("ul");
      for (const entry of entries) {
        const item = document.createElement("li");
        item.textContent = "title" in entry
          ? entry.title || "Untitled tab"
          : `${restoreIssueLabel(entry.kind)}${entry.count > 1 ? ` (${entry.count})` : ""}`;
        items.append(item);
      }
      details.append(label, items);
      container.append(details);
    }
  }

  function renderSettingsBackups(records) {
    settingsBackupList.replaceChildren();
    if (records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "snapshot-empty";
      empty.textContent = "No settings backups saved yet.";
      settingsBackupList.append(empty);
      return;
    }
    for (const record of records) {
      const row = document.createElement("div");
      row.className = "settings-backup-row";
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = record.reason === SETTINGS_BACKUP_REASONS.FIREFOX_SYNC_IMPORT
        ? "Imported settings backup"
        : `${record.kind === "automatic" ? "Automatic" : "Manual"} settings backup`;
      const meta = document.createElement("small");
      meta.textContent = `${formatDate(record.createdAt)} · ${formatBytes(record.byteLength)}`;
      copy.append(title, meta);
      if (record.reason === SETTINGS_BACKUP_REASONS.FIREFOX_SYNC_IMPORT) {
        const provenance = document.createElement("span");
        provenance.className = "settings-backup-provenance";
        provenance.textContent = "Imported";
        copy.append(provenance);
      }
      const actions = document.createElement("span");
      actions.className = "settings-backup-actions";
      actions.append(
        button("Load", (event) => {
          const trigger = event.currentTarget;
          void (async () => {
            // Load always restores the Snapshots section, including its cleanup values.
            const confirmed = await confirmBackupCleanup(async () =>
              (await client.getSettings(record.id)).payload.settings.snapshots
            );
            if (!confirmed) {
              return;
            }
            await run(
              trigger,
              "Loading settings backup…",
              () => client.restoreStoredSettings(record.id, [
                "sidebar",
                "appearance",
                "navigation",
                "snapshots"
              ]),
              "Settings backup loaded."
            );
          })();
        }),
        button("Export", (event) => {
          const trigger = event.currentTarget;
          void (async () => {
            try {
              await ensureDownloadsPermission();
            } catch (error) {
              setStatus(error.message, "error");
              return;
            }
            await run(
              trigger,
              "Exporting settings backup…",
              () => client.exportSettings(record.id),
              "Settings backup export started."
            );
          })();
        }),
        button("Delete", (event) => {
          void run(
            event.currentTarget,
            "Deleting settings backup…",
            () => client.deleteSettings(record.id),
            "Settings backup deleted."
          );
        }, "is-danger")
      );
      row.append(copy, actions);
      settingsBackupList.append(row);
    }
  }

  async function refresh({ quiet = false, selectId = null } = {}) {
    if (selectId !== null) pendingSnapshotSelectionId = selectId;
    const generation = ++refreshGeneration;
    try {
      const [ordinaryOverview, privateOverview, containerOverview] = await Promise.all([
        client.overview(),
        privateClient.overview(),
        containerClient
          ? containerClient.overview().catch(() => null)
          : Promise.resolve(null)
      ]);
      if (generation !== refreshGeneration) return null;
      const nextPrivateContext = privateOverview.privateContext === true;
      const overview = nextPrivateContext
        ? {
            ...privateOverview,
            records: privateOverview.snapshots ?? [],
            warnings: [],
            schedule: ordinaryOverview.schedule,
            settingsBackups: ordinaryOverview.settingsBackups,
            lastSnapshotRestoreReport: privateOverview.lastRestoreReport,
            lastSettingsRestoreReport: ordinaryOverview.lastSettingsRestoreReport
          }
        : ordinaryOverview;
      const activeClient = nextPrivateContext ? privateClient : client;
      const visible = overview.records.filter(({ kind }) => kind === "manual" || kind === "automatic");
      const nextLoadedSnapshots = (await Promise.all(visible.map(async (summary) => {
        try {
          return { summary, record: await activeClient.get(summary.id) };
        } catch {
          return null;
        }
      }))).filter(Boolean);
      if (generation !== refreshGeneration) return null;

      configureScope(nextPrivateContext);
      bookmarkImport.configureScope(privateContext);
      availableContainerRefs = new Set(
        containerOverview?.capability === "available"
          ? containerOverview.containers
              .filter(({ status }) => status === "available")
              .map(({ refId }) => refId)
          : []
      );
      if (currentSettings) {
        apply(currentSettings);
      }
      storageStatus.textContent = formatBytes(overview.storageBytes);
      lastSave.textContent = formatDate(overview.schedule.capture.lastSuccessAt);
      nextSave.textContent = formatDate(overview.schedule.capture.nextDueAt);
      // The pill repeats in one word what "Next scheduled backup" says in full.
      const scheduled = Boolean(overview.schedule.capture.nextDueAt);
      schedulePill.textContent = scheduled ? "On" : "Off";
      schedulePill.className = scheduled ? "state-pill is-good" : "state-pill";
      viewerLastAutomaticSave.textContent = formatDate(
        latestAutomaticSnapshotCreatedAt(overview.records)
      );
      viewerNextAutomaticSave.textContent = overview.schedule.capture.nextDueAt
        ? formatDate(overview.schedule.capture.nextDueAt)
        : "Not scheduled";
      renderSettingsBackups(overview.settingsBackups ?? []);
      renderRestoreReport(restoreReport, overview.lastSnapshotRestoreReport, "No snapshot has been opened yet.");
      renderRestoreReport(settingsRestoreReport, overview.lastSettingsRestoreReport, "No settings backup has been restored yet.");
      loadedSnapshots = nextLoadedSnapshots;
      const requestedSelectionId = pendingSnapshotSelectionId;
      pendingSnapshotSelectionId = null;
      const preferredId = requestedSelectionId ?? (
        currentView?.imported ? null : currentView?.summary?.id
      );
      const preferred = loadedSnapshots.find(({ summary }) => summary.id === preferredId);
      if (bookmarkImport.isActive()) {
        // Granting the bookmarks permission refreshes this panel; the picked
        // tree must survive that instead of being replaced by a snapshot.
        renderSnapshotList();
      } else if (preferred) {
        renderViewer({ ...preferred, source: { id: preferred.summary.id }, imported: false });
      } else if (!currentView?.imported && loadedSnapshots.length > 0) {
        const first = loadedSnapshots[0];
        renderViewer({ ...first, source: { id: first.summary.id }, imported: false });
      } else {
        renderSnapshotList();
        if (!currentView) {
          viewerActions.hidden = true;
          viewerTitle.textContent = privateContext
            ? "Choose a private snapshot"
            : "Choose a snapshot";
          delete viewerTitle.dataset.provenance;
          viewerMeta.textContent = privateContext
            ? "Select a saved Private Snapshot to view its tabs."
            : "Select a saved snapshot to view its tabs.";
          const empty = document.createElement("p");
          empty.className = "snapshot-empty";
          empty.textContent = privateContext
            ? "No private snapshot selected."
            : "No snapshot selected.";
          viewerTree.replaceChildren(empty);
        }
      }
      if (overview.warnings.length > 0 && !quiet) {
        reportViewerStatus("Some saved snapshots could not be opened.", "error");
      }
      return overview;
    } catch (error) {
      if (generation === refreshGeneration && !quiet) {
        reportViewerStatus(error.message, "error");
      }
      return null;
    }
  }

  automaticEnabled.addEventListener("change", () =>
    updateAutomaticSnapshots(automaticEnabled.checked)
  );
  automaticSettingsBackupsEnabled.addEventListener("change", () =>
    updateSettings({
      automaticSettingsBackupsEnabled: automaticSettingsBackupsEnabled.checked
    })
  );
  intervalUnit.addEventListener("change", () => {
    const value = sanitizeInterval(true);
    void updateSettings({ intervalValue: value, intervalUnit: intervalUnit.value });
  });
  testAutomatic.addEventListener("click", () => {
    if (testPending) {
      return;
    }
    void (async () => {
      testPending = true;
      testAutomatic.disabled = true;
      const startedAt = Date.now();
      try {
        const scheduled = await snapshotClient().testAutomatic();
        const dueAt = Date.parse(scheduled.dueAt);
        const updateCountdown = () => {
          const seconds = Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
          testStatus.textContent = seconds > 0
            ? `Test snapshot starts in ${seconds} second${seconds === 1 ? "" : "s"}...`
            : "Timer finished. Checking for the test snapshot...";
        };
        updateCountdown();
        testTimer = setInterval(updateCountdown, 250);
        let confirmed = false;
        for (let attempt = 0; attempt < 12 && !confirmed; attempt += 1) {
          const wait = Math.max(0, dueAt - Date.now()) + (attempt === 0 ? 250 : 1000);
          await new Promise((resolve) => setTimeout(resolve, wait));
          await refresh({ quiet: true });
          confirmed = loadedSnapshots.some(
            ({ record }) =>
              record.kind === SNAPSHOT_KINDS.AUTOMATIC &&
              (privateContext || record.reason === "five-second-test") &&
              Date.parse(record.createdAt) >= startedAt
          ) === true;
        }
        testStatus.textContent = confirmed
          ? "Test passed. Automatic snapshots are working."
          : "Test not confirmed. Keep Firefox open and try again.";
        setStatus(testStatus.textContent, confirmed ? "quiet" : "error");
      } catch (error) {
        testStatus.textContent = error.message;
        setStatus(error.message, "error");
      } finally {
        clearInterval(testTimer);
        testTimer = null;
        testPending = false;
        testAutomatic.disabled = privateContext
          ? !currentSettings?.privacy.automaticSnapshotsEnabled
          : !currentSettings?.snapshots.automaticEnabled;
      }
    })();
  });

  createButton.addEventListener("click", async (event) => {
    const trigger = event.currentTarget;
    const result = await run(
      trigger,
      "Creating snapshot…",
      () => snapshotClient().create(),
      `${privateContext ? "Private snapshot" : "Snapshot"} saved inside this Firefox profile.`,
      { refreshAfter: false, report: reportViewerStatus }
    );
    if (result?.record?.id) {
      await refresh({ quiet: true, selectId: result.record.id });
    }
  });

  document.querySelector("#snapshots-refresh").addEventListener("click", async (event) => {
    await run(event.currentTarget, "Refreshing snapshots…", () => refresh({ quiet: true }), "Snapshots refreshed.", {
      refreshAfter: false,
      report: reportViewerStatus
    });
  });

  async function performDeletion(action, warningPreferenceFailed = false) {
    if (action.kind === "clear") {
      const result = await run(
        action.trigger,
        "Clearing snapshot viewer…",
        () => snapshotClient().clearViewer(),
        (cleared) => {
          const suffix = warningPreferenceFailed
            ? " The warning preference could not be saved."
            : "";
          return `${cleared.removed} snapshot${cleared.removed === 1 ? "" : "s"} removed from the viewer. Exported files were kept.${suffix}`;
        },
        { refreshAfter: false, report: reportViewerStatus }
      );
      if (result) {
        currentView = null;
        selectedTabIds.clear();
        await refresh({ quiet: true });
      }
      return;
    }

    const result = await run(
      action.trigger,
      "Deleting snapshot…",
      () => snapshotClient().delete(action.id),
      `Snapshot deleted.${warningPreferenceFailed ? " The warning preference could not be saved." : ""}`,
      { refreshAfter: false, report: reportViewerStatus }
    );
    if (result) {
      currentView = null;
      await refresh({ quiet: true });
    }
  }

  function requestDeletion(action) {
    if (currentSettings?.snapshots.warnBeforeSnapshotDeletion === false) {
      void performDeletion(action);
      return;
    }
    pendingConfirmation = action;
    skipDeleteWarning.checked = false;
    deleteDialogTitle.textContent = action.kind === "clear"
      ? "Clear snapshot viewer?"
      : "Delete snapshot?";
    deleteDialogDetails.textContent = action.kind === "clear"
      ? "This removes all automatic and manual snapshots from the viewer. Exported files are kept."
      : `Delete this ${kindLabel(action.snapshotKind).toLowerCase()} snapshot? Exported files are kept.`;
    confirmActionButton.textContent = action.kind === "clear" ? "Clear" : "Delete";
    deleteDialog.showModal();
  }

  clearViewerButton.addEventListener("click", (event) => {
    if (loadedSnapshots.length === 0) {
      reportViewerStatus("The snapshot viewer is already empty.");
      return;
    }
    requestDeletion({ kind: "clear", trigger: event.currentTarget });
  });

  openAllButton.addEventListener("click", (event) => {
    requestRestore(SNAPSHOT_RESTORE_SCOPES.ALL, {}, event.currentTarget);
  });
  openSelectedButton.addEventListener("click", (event) => {
    if (selectedTabIds.size > 0) {
      requestRestore(
        SNAPSHOT_RESTORE_SCOPES.TABS,
        { tabIds: [...selectedTabIds] },
        event.currentTarget
      );
    }
  });
  exportButton.addEventListener("click", async (event) => {
    const trigger = event.currentTarget;
    if (!currentView?.summary) {
      return;
    }
    const snapshotId = currentView.summary.id;
    try {
      await ensureDownloadsPermission();
    } catch (error) {
      reportViewerStatus(error.message, "error");
      return;
    }
    await run(
      trigger,
      "Exporting snapshot…",
      () => snapshotClient().export(snapshotId),
      "Snapshot export started.",
      { report: reportViewerStatus }
    );
  });
  deleteButton.addEventListener("click", (event) => {
    if (!currentView?.summary) {
      return;
    }
    requestDeletion({
      kind: "single",
      id: currentView.summary.id,
      snapshotKind: currentView.summary.kind,
      trigger: event.currentTarget
    });
  });

  deleteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const action = pendingConfirmation;
    const disableWarning = skipDeleteWarning.checked;
    pendingConfirmation = null;
    deleteDialog.close();
    if (!action) {
      return;
    }
    void (async () => {
      let warningPreferenceFailed = false;
      if (disableWarning) {
        try {
          const settings = await settingsClient.update({
            snapshots: { warnBeforeSnapshotDeletion: false }
          });
          apply(settings);
        } catch {
          warningPreferenceFailed = true;
        }
      }
      if (action.kind === "restore") {
        await performRestore(
          action.source,
          action.scope,
          action.options,
          action.trigger,
          warningPreferenceFailed
        );
      } else {
        await performDeletion(action, warningPreferenceFailed);
      }
    })();
  });
  cancelDeleteButton.addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("close", () => {
    pendingConfirmation = null;
    skipDeleteWarning.checked = false;
  });
  containerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const decisions = [...containerResolutions.querySelectorAll("select")].map((select) => {
      const [action, targetRefId] = select.value.split(":");
      if (action === "existing") {
        return { refId: select.dataset.refId, action, targetRefId };
      }
      return { refId: select.dataset.refId, action };
    });
    const resolve = pendingContainerResolution;
    pendingContainerResolution = null;
    containerDialog.close();
    resolve?.(decisions);
  });
  cancelContainerButton.addEventListener("click", () => {
    const resolve = pendingContainerResolution;
    pendingContainerResolution = null;
    containerDialog.close();
    resolve?.(null);
  });
  containerDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelContainerButton.click();
  });
  addImportButton.addEventListener("click", async (event) => {
    if (!currentView?.imported) {
      return;
    }
    const result = await run(
      event.currentTarget,
      "Saving imported snapshot…",
      () => snapshotClient().import(currentView.source.text),
      "Imported snapshot saved.",
      { refreshAfter: false, report: reportViewerStatus }
    );
    if (result?.record?.id) {
      currentView = null;
      await refresh({ quiet: true, selectId: result.record.id });
    }
  });

  async function readSelectedBackup(input, previewClient = snapshotClient()) {
    const file = input.files?.[0];
    if (!file) {
      return null;
    }
    if (file.size > MAX_BACKUP_BYTES) {
      throw new Error(`Backup files must not exceed ${formatBytes(MAX_BACKUP_BYTES)}.`);
    }
    const text = await file.text();
    return { text, preview: await previewClient.preview(text) };
  }

  snapshotImportFile.addEventListener("change", async () => {
    const generation = ++snapshotImportGeneration;
    reportViewerStatus("Checking snapshot…");
    try {
      const selected = await readSelectedBackup(snapshotImportFile);
      if (generation !== snapshotImportGeneration) return;
      if (!selected) {
        return;
      }
      if (selected.preview.kind !== "snapshot") {
        throw new Error("This is a Terminus settings backup. Import it from Snapshots > Settings Backups.");
      }
      renderViewer({
        summary: null,
        record: selected.preview.document,
        source: { text: selected.text },
        imported: true
      });
      reportViewerStatus("Snapshot ready to open or save.");
    } catch (error) {
      if (generation !== snapshotImportGeneration) return;
      snapshotImportFile.value = "";
      reportViewerStatus(error.message, "error");
    }
  });

  document.querySelector("#snapshots-save-settings").addEventListener("click", async (event) => {
    await run(
      event.currentTarget,
      "Creating settings backup…",
      () => client.saveSettings(),
      "Settings backup saved inside this Firefox profile."
    );
  });

  settingsImportFile.addEventListener("change", async () => {
    const generation = ++settingsImportGeneration;
    settingsImportPreview.replaceChildren();
    setStatus("Checking settings backup…");
    try {
      const selected = await readSelectedBackup(settingsImportFile, client);
      if (generation !== settingsImportGeneration) return;
      if (!selected) {
        return;
      }
      if (selected.preview.kind !== "settings") {
        throw new Error("This is a Terminus snapshot. Import it from Snapshot Viewer.");
      }
      const heading = document.createElement("h4");
      heading.textContent = `Settings from ${formatDate(selected.preview.createdAt)}`;
      const sections = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "Choose settings to restore";
      sections.append(legend);
      const inputs = [];
      for (const [value, label] of [
        ["sidebar", "Sidebar"],
        ["appearance", "Appearance"],
        ["navigation", "Settings page"],
        ["snapshots", "Snapshot preferences"]
      ]) {
        const row = document.createElement("label");
        row.className = "snapshot-checkbox-label";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = value;
        input.checked = true;
        inputs.push(input);
        row.append(input, document.createTextNode(label));
        sections.append(row);
      }
      settingsImportPreview.append(
        heading,
        sections,
        button("Add to Settings Backups", (event) => {
          void run(
            event.currentTarget,
            "Importing settings backup…",
            () => client.importSettings(selected.text),
            "Settings backup added to Settings Backups."
          );
        }),
        button("Restore selected settings", (event) => {
          const trigger = event.currentTarget;
          const chosen = inputs.filter(({ checked }) => checked).map(({ value }) => value);
          if (chosen.length === 0) {
            setStatus("Choose at least one setting.", "error");
            return;
          }
          void (async () => {
            // The preview document is the verified backup the restore applies.
            if (
              chosen.includes("snapshots") &&
              !(await confirmBackupCleanup(async () =>
                selected.preview.document.payload.settings.snapshots
              ))
            ) {
              return;
            }
            await run(
              trigger,
              "Restoring settings…",
              () => client.restoreSettings(selected.text, chosen),
              "Selected settings restored."
            );
          })();
        })
      );
      setStatus("Settings backup ready.");
    } catch (error) {
      if (generation !== settingsImportGeneration) return;
      settingsImportFile.value = "";
      setStatus(error.message, "error");
    }
  });

  return Object.freeze({ apply, refresh, isPrivateContext: () => privateContext });
}

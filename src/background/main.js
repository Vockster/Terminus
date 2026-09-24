import { createFirefoxWorkspaceBrowser } from "../platform/firefox/workspace-browser.js";
import { createFirefoxSettingsStorage } from "../platform/firefox/settings-storage.js";
import { createFirefoxWorkspaceRuntimeStorage } from "../platform/firefox/workspace-runtime-storage.js";
import {
  PRIVATE_WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY,
  PRIVATE_WORKSPACE_RUNTIME_STORAGE_KEY
} from "../platform/firefox/workspace-runtime-storage.js";
import { createFirefoxWindowScopeRegistry } from "../platform/firefox/window-scope-registry.js";
import { createFirefoxWorkspaceStorage } from "../platform/firefox/workspace-storage.js";
import { createFirefoxSidebarUndoStorage } from "../platform/firefox/sidebar-undo-storage.js";
import { createFirefoxSnapshotAlarms } from "../platform/firefox/snapshot-alarms.js";
import { createFirefoxSnapshotBrowser } from "../platform/firefox/snapshot-browser.js";
import { createFirefoxSnapshotDownloads } from "../platform/firefox/snapshot-downloads.js";
import { createFirefoxSnapshotStorage } from "../platform/firefox/snapshot-storage.js";
import { createFirefoxSettingsTransferStorage } from "../platform/firefox/settings-transfer-storage.js";
import { createFirefoxPrivateSnapshotStorage } from "../platform/firefox/private-snapshot-storage.js";
import { createFirefoxFaviconCacheStorage } from "../platform/firefox/favicon-cache-storage.js";
import { createFirefoxFaviconBrowser } from "../platform/firefox/favicon-browser.js";
import { createFirefoxContainerBrowser } from "../platform/firefox/container-browser.js";
import { createFirefoxContainerStorage } from "../platform/firefox/container-storage.js";
import { createFirefoxCustomIconStorage } from "../platform/firefox/custom-icon-storage.js";
import { createFirefoxCustomIconDecoder } from "../platform/firefox/custom-icon-decoder.js";
import { createFirefoxBookmarksBrowser } from "../platform/firefox/bookmarks-browser.js";
import { removeRetiredStorage } from "../platform/firefox/retired-storage.js";
import { BookmarkImportService } from "../core/bookmark-import-service.js";
import { WorkspacePackageService } from "../core/workspace-package-service.js";
import { SettingsTransferService } from "../core/settings-transfer-service.js";
import { SettingsStateService } from "../core/settings-state-service.js";
import { SnapshotCaptureService } from "../core/snapshot-capture-service.js";
import { SnapshotRepository } from "../core/snapshot-repository.js";
import { SnapshotRestoreService } from "../core/snapshot-restore-service.js";
import { SnapshotScheduleService } from "../core/snapshot-schedule-service.js";
import { SnapshotService } from "../core/snapshot-service.js";
import { PrivateSnapshotService } from "../core/private-snapshot-service.js";
import { retentionRuleChanged } from "../core/automatic-retention-policy.js";
import { FaviconCacheService } from "../core/favicon-cache-service.js";
import { FaviconAcquisitionCoordinator } from "../core/favicon-acquisition-coordinator.js";
import { ContainerService } from "../core/container-service.js";
import { CustomIconService } from "../core/custom-icon-service.js";
import { WorkspaceController } from "../core/workspace-controller.js";
import { WorkspaceRuntimeService } from "../core/workspace-runtime-service.js";
import { WorkspaceStateService } from "../core/workspace-state-service.js";
import { createResetWorkspaceState } from "../core/workspace-defaults.js";
import { createSerialOperationExecutor } from "../core/serial-operation-executor.js";
import { SidebarUndoService } from "../core/sidebar-undo-service.js";
import { createSingleFlightInitializer, runStartupSteps } from "../core/runtime-initializer.js";
import { WORKSPACE_SCOPES } from "../contracts/workspace-scope.js";
import { WORKSPACE_MESSAGE_TYPES } from "../contracts/workspace-messages.js";
import { WORKSPACE_STATE_STORAGE_KEY } from "../contracts/workspace-state.js";
import { SETTINGS_STATE_STORAGE_KEY } from "../contracts/settings-state.js";
import { BOOKMARK_IMPORT_MESSAGE_TYPES } from "../contracts/bookmark-import.js";
import {
  SETTINGS_BACKUP_KINDS,
  SNAPSHOT_AUTOMATIC_LIBRARIES,
  SNAPSHOT_KINDS
} from "../contracts/snapshots.js";
import { canonicalizePageOrigin } from "../contracts/favicon-cache.js";
import { faviconChanged } from "../contracts/favicon-messages.js";
import { customIconChanged } from "../contracts/custom-icons.js";
import { sidebarUndoChanged } from "../contracts/sidebar-undo.js";
import { CONTAINER_MESSAGE_TYPES } from "../contracts/container-messages.js";
import { createSettingsMessageHandler } from "./settings-message-handler.js";
import { createBookmarkImportMessageHandler } from "./bookmark-import-message-handler.js";
import { createWorkspacePackageMessageHandler } from "./workspace-package-message-handler.js";
import { createSnapshotMessageHandler } from "./snapshot-message-handler.js";
import { createWorkspaceEventRouter } from "./workspace-event-router.js";
import {
  SnapshotStartupCoordinator,
  SnapshotStartupReadiness
} from "./snapshot-startup-coordinator.js";
import { createWorkspaceMenuService } from "./workspace-menu-service.js";
import { createWorkspaceMessageHandler } from "./workspace-message-handler.js";
import { createPrivateMessageHandler } from "./private-message-handler.js";
import { createFaviconMessageHandler } from "./favicon-message-handler.js";
import { createCustomIconMessageHandler } from "./custom-icon-message-handler.js";
import { createContainerMessageHandler } from "./container-message-handler.js";
import { createSidebarActionCoordinator } from "./sidebar-action-coordinator.js";
import { createSidebarUndoMessageHandler } from "./sidebar-undo-message-handler.js";
import { withSharedWorkspaceRemoval } from "./shared-workspace-removal.js";
import { createViewChangeNotifier } from "./view-change-notifier.js";

const settingsStateService = new SettingsStateService(createFirefoxSettingsStorage(browser));
const workspaceStorage = createFirefoxWorkspaceStorage(browser);
const workspaceStateService = new WorkspaceStateService(workspaceStorage);
const workspaceRuntimeStorage = createFirefoxWorkspaceRuntimeStorage(browser);
const workspaceRuntimeService = new WorkspaceRuntimeService(workspaceRuntimeStorage);
const privateWorkspaceRuntimeStorage = createFirefoxWorkspaceRuntimeStorage(browser, {
  areaName: "session",
  storageKey: PRIVATE_WORKSPACE_RUNTIME_STORAGE_KEY,
  migrationKey: PRIVATE_WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY
});
const privateWorkspaceRuntimeService = new WorkspaceRuntimeService(
  privateWorkspaceRuntimeStorage
);
const windowScopeRegistry = createFirefoxWindowScopeRegistry(browser);
windowScopeRegistry.start();
const workspaceBrowser = createFirefoxWorkspaceBrowser(browser, undefined, {
  scope: WORKSPACE_SCOPES.NORMAL,
  windowScopeRegistry
});
const privateWorkspaceBrowser = createFirefoxWorkspaceBrowser(browser, undefined, {
  scope: WORKSPACE_SCOPES.PRIVATE,
  windowScopeRegistry
});
const workspaceOperationExecutor = createSerialOperationExecutor();
const containerBrowser = createFirefoxContainerBrowser(browser);
const containerService = new ContainerService({
  storage: createFirefoxContainerStorage(browser),
  browserAdapter: containerBrowser,
  onBindingsRemoved: (refIds) => workspaceStateService.clearDefaultContainerRefs(refIds)
});
const settingsTransferStorage = createFirefoxSettingsTransferStorage(browser);
const snapshotRepository = new SnapshotRepository(createFirefoxSnapshotStorage(browser));
const customIconStorage = createFirefoxCustomIconStorage();
const customIconService = new CustomIconService({
  storage: customIconStorage,
  decoder: createFirefoxCustomIconDecoder(),
  workspaceStateService,
  onChanged: notifyCustomIconsChanged,
  operationExecutor: workspaceOperationExecutor
});
const faviconStorage = createFirefoxFaviconCacheStorage();
const faviconBrowser = createFirefoxFaviconBrowser({ browser });
const faviconCoordinator = new FaviconAcquisitionCoordinator();
const snapshotDownloads = createFirefoxSnapshotDownloads(browser);
const privateSnapshotStorage = createFirefoxPrivateSnapshotStorage(browser);
const privateSnapshotBrowser = createFirefoxSnapshotBrowser(browser, {
  scope: WORKSPACE_SCOPES.PRIVATE,
  windowScopeRegistry
});
const snapshotCaptureService = new SnapshotCaptureService(
  createFirefoxSnapshotBrowser(browser, {
    scope: WORKSPACE_SCOPES.NORMAL,
    windowScopeRegistry
  }),
  { containerService }
);
const snapshotService = new SnapshotService({
  repository: snapshotRepository,
  captureService: snapshotCaptureService,
  downloadsAdapter: snapshotDownloads
});
const settingsTransferService = new SettingsTransferService({
  settingsService: settingsStateService,
  stateService: workspaceStateService,
  runtimeService: workspaceRuntimeService,
  storage: settingsTransferStorage
});
const snapshotRestoreService = new SnapshotRestoreService({
  browserAdapter: createFirefoxSnapshotBrowser(browser, {
    scope: WORKSPACE_SCOPES.NORMAL,
    windowScopeRegistry
  }),
  repository: snapshotRepository,
  stateService: workspaceStateService,
  runtimeService: workspaceRuntimeService,
  settingsTransferService,
  containerService,
  customIconService
});
const privateWorkspaceController = new WorkspaceController({
  browserAdapter: privateWorkspaceBrowser,
  runtimeService: privateWorkspaceRuntimeService,
  stateService: workspaceStateService,
  settingsService: settingsStateService,
  operationExecutor: workspaceOperationExecutor
});
const privateSnapshotRestoreService = new SnapshotRestoreService({
  browserAdapter: privateSnapshotBrowser,
  repository: privateSnapshotStorage,
  stateService: workspaceStateService,
  runtimeService: privateWorkspaceRuntimeService,
  settingsTransferService: null,
  customIconService
});
const privateSnapshotService = new PrivateSnapshotService({
  storage: privateSnapshotStorage,
  settingsService: settingsStateService,
  controller: privateWorkspaceController,
  browserAdapter: privateSnapshotBrowser,
  restoreService: privateSnapshotRestoreService,
  downloadsAdapter: snapshotDownloads
});
privateWorkspaceController.setSnapshotService(privateSnapshotService);
// Only normal windows come back after a restart or from recently closed
// windows, so only they keep a closed window's workspaces for its return.
const workspaceController = new WorkspaceController({
  browserAdapter: workspaceBrowser,
  runtimeService: workspaceRuntimeService,
  stateService: workspaceStateService,
  settingsService: settingsStateService,
  snapshotService,
  restoreService: snapshotRestoreService,
  settingsTransferService,
  containerService,
  operationExecutor: workspaceOperationExecutor,
  retainClosedWindows: true
});
const sidebarUndoService = new SidebarUndoService({
  storage: createFirefoxSidebarUndoStorage(browser),
  onChanged: notifySidebarUndoChanged
});
const sidebarActionCoordinator = createSidebarActionCoordinator({
  browserApi: browser,
  windowScopeRegistry,
  undoService: sidebarUndoService,
  normalController: workspaceController,
  privateController: privateWorkspaceController,
  operationExecutor: workspaceOperationExecutor
});
const handleSidebarUndoMessage = createSidebarUndoMessageHandler(sidebarActionCoordinator);
async function snapshotFaviconReferences() {
  const { records } = await snapshotRepository.list();
  const origins = new Set();
  for (const summary of records) {
    const record = await snapshotRepository.get(summary.id);
    for (const window of record.payload.windows) {
      for (const layout of window.workspaceLayouts) {
        for (const tab of layout.tabs) {
          const origin = canonicalizePageOrigin(tab.url);
          if (origin) origins.add(origin);
        }
      }
    }
  }
  return origins;
}

async function notifyCustomIconsChanged(change) {
  try {
    await browser.runtime.sendMessage(customIconChanged(change));
  } catch {
    // No open sidebar or Settings view is a normal state.
  }
}

async function notifyFaviconChanged(change, firefoxTabIds = null) {
  try {
    await browser.runtime.sendMessage(faviconChanged(change, firefoxTabIds));
  } catch {
    // No open sidebar or Settings view is a normal state.
  }
}

async function notifySidebarUndoChanged(scope, windowId, summary) {
  try {
    await browser.runtime.sendMessage(sidebarUndoChanged(windowId, scope, summary));
  } catch {
    // No open sidebar is a normal state; the summary remains in session storage.
  }
}

function reportFaviconDiagnostic(reason) {
  console.debug("[Terminus favicon]", reason);
}

const faviconCacheService = new FaviconCacheService({
  storage: faviconStorage,
  browser: faviconBrowser,
  coordinator: faviconCoordinator,
  snapshotReferenceProvider: snapshotFaviconReferences,
  onChanged: notifyFaviconChanged,
  onDiagnostic: reportFaviconDiagnostic
});
const handleFaviconMessage = createFaviconMessageHandler({
  service: faviconCacheService,
  resolveWindowScope: (windowId) => windowScopeRegistry.resolveScope(windowId)
});
const handleCustomIconMessage = createCustomIconMessageHandler({ service: customIconService });
const handleContainerMessage = createContainerMessageHandler({
  service: containerService,
  workspaceController,
  resolveWorkspaceController: async (sender, windowId) => {
    const direct = controllerForSender(sender);
    if (direct) return direct;
    const scope = await windowScopeRegistry.resolveScope(windowId);
    return scope === WORKSPACE_SCOPES.PRIVATE
      ? privateWorkspaceController
      : workspaceController;
  }
});
function controllerForSender(sender) {
  if (sender?.tab?.incognito === true) {
    return privateWorkspaceController;
  }
  if (sender?.tab?.incognito === false) {
    return workspaceController;
  }
  return null;
}

const handleNormalWorkspaceMessage = createWorkspaceMessageHandler(
  workspaceStateService,
  withSharedWorkspaceRemoval(
    workspaceController,
    privateWorkspaceController,
    workspaceOperationExecutor
  ),
  { sidebarActionCoordinator }
);
const handlePrivateWorkspaceMessage = createWorkspaceMessageHandler(
  workspaceStateService,
  withSharedWorkspaceRemoval(
    privateWorkspaceController,
    workspaceController,
    workspaceOperationExecutor
  ),
  { sidebarActionCoordinator }
);

async function workspaceHandlerForMessage(message, sender) {
  const controller = controllerForSender(sender);
  if (controller === privateWorkspaceController) {
    return handlePrivateWorkspaceMessage(message, sender);
  }
  if (controller === workspaceController) {
    return handleNormalWorkspaceMessage(message, sender);
  }
  if (Number.isInteger(message?.windowId)) {
    const scope = await windowScopeRegistry.resolveScope(message.windowId);
    if (scope === WORKSPACE_SCOPES.PRIVATE) {
      return handlePrivateWorkspaceMessage(message, sender);
    }
    if (scope === WORKSPACE_SCOPES.NORMAL) {
      return handleNormalWorkspaceMessage(message, sender);
    }
    return undefined;
  }
  return handleNormalWorkspaceMessage(message, sender);
}
const handleSettingsMessage = createSettingsMessageHandler(settingsStateService, {
  resetWithSafety: async (windowId) => {
    const resetState = createResetWorkspaceState(
      await workspaceStateService.getOrInitialize()
    );
    const token = await privateWorkspaceController.prepareWorkspaceStateReplacement(
      resetState
    );
    try {
      return await workspaceController.resetSettingsWithSafety(windowId, resetState);
    } catch (error) {
      try {
        await privateWorkspaceController.restorePreparedWorkspaceState(token);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Restore all defaults failed and a rollback also failed."
        );
      }
      throw error;
    }
  }
});
const snapshotAlarms = createFirefoxSnapshotAlarms(browser);
const snapshotScheduleService = new SnapshotScheduleService({
  settingsService: settingsStateService,
  repository: snapshotRepository,
  alarmsAdapter: snapshotAlarms,
  captureAutomatic: async (settings, libraries) => {
    const requested = new Set(libraries);
    const normalWindowIds = requested.has(SNAPSHOT_AUTOMATIC_LIBRARIES.SIDEBAR)
      ? await workspaceBrowser.listNormalWindowIds()
      : [];
    const snapshot = requested.has(SNAPSHOT_AUTOMATIC_LIBRARIES.SIDEBAR) &&
      normalWindowIds.length > 0
      ? workspaceController.createSnapshot(
        { kind: SNAPSHOT_KINDS.AUTOMATIC },
        settings
      )
      : Promise.resolve({ created: false, reason: "no-normal-window", record: null });
    const operations = [
      [SNAPSHOT_AUTOMATIC_LIBRARIES.SIDEBAR, snapshot],
      [
        SNAPSHOT_AUTOMATIC_LIBRARIES.SETTINGS,
        requested.has(SNAPSHOT_AUTOMATIC_LIBRARIES.SETTINGS)
        ? snapshotService.saveSettings(settings, {
            kind: SETTINGS_BACKUP_KINDS.AUTOMATIC
          })
        : Promise.resolve({ created: false, reason: "disabled", record: null })
      ],
      [
        SNAPSHOT_AUTOMATIC_LIBRARIES.PRIVATE,
        requested.has(SNAPSHOT_AUTOMATIC_LIBRARIES.PRIVATE)
        ? privateSnapshotService.captureAutomatic(settings)
        : Promise.resolve({ created: false, reason: "disabled", record: null })
      ]
    ];
    const settled = await Promise.allSettled(operations.map(([, operation]) => operation));
    const completedLibraries = operations
      .filter((_, index) => settled[index].status === "fulfilled")
      .map(([library]) => library)
      .filter((library) => requested.has(library));
    const failures = settled.filter(({ status }) => status === "rejected");
    if (failures.length > 0) {
      const error = new AggregateError(
        failures.map(({ reason }) => reason),
        "One or more automatic snapshot libraries failed."
      );
      error.completedLibraries = completedLibraries;
      throw error;
    }
    const [normalSnapshot, settingsBackup, privateSnapshot] = settled.map(({ value }) => value);
    return {
      ...normalSnapshot,
      created: normalSnapshot.created || settingsBackup.created || privateSnapshot.created,
      settingsBackup,
      privateSnapshot
    };
  },
  captureAutomaticTest: (settings) =>
    workspaceController.createSnapshot(
      { kind: SNAPSHOT_KINDS.AUTOMATIC, reason: "five-second-test", force: true },
      settings
    ),
  capturePrivateAutomaticTest: (settings) =>
    privateSnapshotService.captureAutomatic(settings, { force: true }),
  cleanupAutomatic: async (settings) => {
    const [ordinary, privateHistory] = await Promise.all([
      snapshotService.cleanupAutomatic(settings),
      privateSnapshotService.cleanupAutomatic(settings)
    ]);
    return {
      ...ordinary,
      privateHistory,
      removed: [
        ...ordinary.removed,
        ...ordinary.removedSettings,
        ...privateHistory.removed
      ]
    };
  }
});
const handlePrivateMessage = createPrivateMessageHandler({
  service: privateSnapshotService,
  browserApi: browser,
  scheduleService: snapshotScheduleService,
  settingsService: settingsStateService
});
const handleSnapshotMessage = createSnapshotMessageHandler({
  snapshotService,
  workspaceController,
  settingsService: settingsStateService,
  scheduleService: snapshotScheduleService
});
const handleBookmarkImportMessage = createBookmarkImportMessageHandler({
  service: new BookmarkImportService({
    bookmarksBrowser: createFirefoxBookmarksBrowser(browser),
    workspaceController,
    settingsService: settingsStateService,
    onProgress: (progress) => {
      void browser.runtime
        .sendMessage({ type: BOOKMARK_IMPORT_MESSAGE_TYPES.PROGRESS, ...progress })
        .catch(() => undefined);
    }
  }),
  onImported: (windowId) => {
    void notifyWorkspaceViewChanged(windowId);
  }
});

const handleWorkspacePackageMessage = createWorkspacePackageMessageHandler({
  service: new WorkspacePackageService({
    workspaceStateService,
    customIconService,
    decoder: createFirefoxCustomIconDecoder(),
    normalController: workspaceController,
    // Definitions are shared, so the private runtime is prepared alongside the
    // normal one exactly as Restore all defaults does.
    privateController: privateWorkspaceController,
    captureSafetySnapshot: (executorLease) =>
      workspaceController.createSnapshot({
        kind: SNAPSHOT_KINDS.SAFETY,
        reason: "workspace-package-replace"
      }, null, executorLease),
    operationExecutor: workspaceOperationExecutor
  }),
  downloads: snapshotDownloads,
  onImported: (windowId) => {
    // Icon additions announce themselves through CustomIconService.
    void notifyWorkspaceViewChanged(windowId);
  }
});

const viewChangeNotifier = createViewChangeNotifier(async (windowId) => {
  try {
    await browser.runtime.sendMessage({
      type: WORKSPACE_MESSAGE_TYPES.VIEW_CHANGED,
      windowId
    });
  } catch {
    // No open sidebar is a normal state; persisted notices survive until one opens.
  }
});

function notifyWorkspaceViewChanged(windowId, view = null) {
  return viewChangeNotifier.notify(windowId, view);
}

async function notifyWorkspaceTabRemoved(windowId, firefoxTabId) {
  try {
    await browser.runtime.sendMessage({
      type: WORKSPACE_MESSAGE_TYPES.TAB_REMOVED,
      windowId,
      firefoxTabId
    });
  } catch {
    // No open sidebar is a normal state.
  }
}

let ensureRuntimeInitialized;
let snapshotStartupCoordinator;
const workspaceEventRouter = createWorkspaceEventRouter({
  browserAdapter: workspaceBrowser,
  controller: workspaceController,
  onReconciled: notifyWorkspaceViewChanged,
  onTabRemoved: notifyWorkspaceTabRemoved,
  onStructuralActivity: () => snapshotStartupCoordinator.noteStructuralActivity()
});
const privateWorkspaceEventRouter = createWorkspaceEventRouter({
  browserAdapter: privateWorkspaceBrowser,
  controller: privateWorkspaceController,
  onTabRemoved: notifyWorkspaceTabRemoved,
  onStructuralActivity: () => snapshotStartupCoordinator.noteStructuralActivity(),
  onReconciled: async (windowId, view = null) => {
    await notifyWorkspaceViewChanged(windowId, view);
    // Recovery capture stays unconditional: it persists URLs the rendered
    // view does not carry, so a suppressed notification must not skip it.
    privateSnapshotService.scheduleRecoveryCapture(windowId);
  }
});
snapshotStartupCoordinator = new SnapshotStartupCoordinator({
  ensureInitialized: () => ensureRuntimeInitialized(),
  scheduleService: snapshotScheduleService,
  routers: [workspaceEventRouter, privateWorkspaceEventRouter],
  readiness: new SnapshotStartupReadiness()
});
const workspaceMenuService = createWorkspaceMenuService({
  browserApi: browser,
  controller: workspaceController,
  controllerForTab: (tab) =>
    tab?.incognito === true ? privateWorkspaceController :
      tab?.incognito === false ? workspaceController : null,
  stateService: workspaceStateService,
  containerService,
  onOperationFinished: notifyWorkspaceViewChanged
});

// MV3 background listeners must exist before any asynchronous initialization begins.
workspaceEventRouter.start();
privateWorkspaceEventRouter.start();
workspaceMenuService.start();
containerService.start(async (overview) => {
  snapshotStartupCoordinator.noteStructuralActivity();
  try {
    await browser.runtime.sendMessage({ type: CONTAINER_MESSAGE_TYPES.CHANGED });
  } catch {
    // No open sidebar or Settings view is a normal state.
  }
  await workspaceMenuService.synchronize(overview).catch(() => undefined);
  await workspaceEventRouter.enqueueAll();
});
faviconBrowser.observe({
  onObserve: (tabId, options) => {
    void faviconCacheService.observeTab(tabId, options).catch(() => undefined);
  },
  onCancel: (tabId) => faviconCacheService.cancelTab(tabId),
  onDefaultSearchRefresh: () => {
    void faviconCacheService.refreshDefaultSearchIconForOpenTabs().catch(() => undefined);
  }
});
browser.windows.onCreated.addListener((window) => {
  if (window?.incognito === true && Number.isInteger(window.id)) {
    void privateSnapshotService.restoreRecoveryIfEligible(window.id).catch(() => undefined);
  }
});
snapshotAlarms.subscribe((name) => {
  void snapshotStartupCoordinator.handleAlarm(name).catch(() => undefined);
});
browser.runtime.onMessage.addListener((message, sender) => {
  const undoResponse = handleSidebarUndoMessage(message, sender);
  if (undoResponse !== undefined) {
    return undoResponse;
  }
  const containerResponse = handleContainerMessage(message, sender);
  if (containerResponse !== undefined) {
    return containerResponse;
  }
  const faviconResponse = handleFaviconMessage(message, sender);
  if (faviconResponse !== undefined) {
    return faviconResponse;
  }
  const customIconResponse = handleCustomIconMessage(message, sender);
  if (customIconResponse !== undefined) {
    return customIconResponse;
  }
  const privateResponse = handlePrivateMessage(message, sender);
  if (privateResponse !== undefined) {
    return privateResponse;
  }
  const settingsResponse = handleSettingsMessage(message, sender);
  if (settingsResponse !== undefined) {
    return settingsResponse;
  }
  const bookmarkImportResponse = handleBookmarkImportMessage(message, sender);
  if (bookmarkImportResponse !== undefined) {
    return bookmarkImportResponse;
  }
  const workspacePackageResponse = handleWorkspacePackageMessage(message, sender);
  if (workspacePackageResponse !== undefined) {
    return workspacePackageResponse;
  }
  // Ordinary snapshot services remain normal-scoped even when Settings is
  // opened privately; their adapters exclude private windows and documents.
  const snapshotResponse = handleSnapshotMessage(message, sender);
  return snapshotResponse === undefined
    ? workspaceHandlerForMessage(message, sender)
    : snapshotResponse;
});

browser.runtime.onSuspend?.addListener(() => {
  faviconCacheService.close();
  customIconStorage.close();
});

browser.windows.onRemoved.addListener((windowId) => {
  viewChangeNotifier.forget(windowId);
  void sidebarUndoService.clearWindow(windowId).catch(() => undefined);
  queueMicrotask(() => {
    void privateWorkspaceBrowser.listNormalWindowIds().then(async (windowIds) => {
      if (windowIds.length === 0) {
        await privateWorkspaceRuntimeStorage.clear();
        await privateSnapshotService.endSession();
        await sidebarUndoService.clearPrivate();
      }
    }).catch(() => undefined);
  });
});

async function initializeRuntime() {
  let privateWindowIdsRead = null;
  const privateWindowIds = () => {
    privateWindowIdsRead ??= privateWorkspaceBrowser.listNormalWindowIds().catch((error) => {
      privateWindowIdsRead = null;
      throw error;
    });
    return privateWindowIdsRead;
  };
  const workspaceIds = async () =>
    (await workspaceStateService.getOrInitialize()).workspaces.map((workspace) => workspace.id);
  await runStartupSteps([
    ["window-scope", () => windowScopeRegistry.initialize()],
    ["core-documents", () => Promise.all([
      settingsStateService.getOrInitialize(),
      workspaceStateService.getOrInitialize(),
      containerService.refresh(),
      snapshotService.initialize(),
      faviconStorage.open().catch(() => undefined),
      customIconStorage.open().catch(() => undefined),
      sidebarUndoService.initialize()
    ])],
    ["restore-recovery", () => snapshotRestoreService.recoverPending()],
    ["settings-restore-recovery", async () => {
      const outcome = await workspaceController.recoverSettingsTransfer();
      await snapshotRestoreService.recordInterruptedSettingsRestore(outcome);
    }],
    ["retired-storage", () => removeRetiredStorage({ browserApi: browser })],
    ["private-cleanup", async () => {
      if ((await privateWindowIds()).length === 0) {
        await privateWorkspaceRuntimeStorage.clear();
        await privateSnapshotService.endSession();
        await sidebarUndoService.clearPrivate();
      }
    }],
    ["normal-runtime", async () => workspaceRuntimeService.getOrInitialize(await workspaceIds())],
    ["private-runtime", async () => {
      if ((await privateWindowIds()).length > 0) {
        await privateWorkspaceRuntimeService.getOrInitialize(await workspaceIds());
      }
    }],
    ["private-restore-recovery", () => privateSnapshotRestoreService.recoverPending()],
    ["private-recovery-restore", async () => {
      const windowIds = await privateWindowIds();
      if (windowIds.length === 1) {
        await privateSnapshotService
          .restoreRecoveryIfEligible(windowIds[0])
          .catch(() => undefined);
      }
    }],
    ["schedule", () => snapshotScheduleService.synchronize({ initializing: true })]
  ]);
}

ensureRuntimeInitialized = createSingleFlightInitializer(initializeRuntime);

browser.runtime.onInstalled.addListener(() => {
  void ensureRuntimeInitialized()
    .then(() => Promise.all([
      workspaceMenuService.synchronize(),
      workspaceEventRouter.enqueueAll(),
      privateWorkspaceEventRouter.enqueueAll()
    ]))
    .catch(() => undefined);
});

browser.runtime.onStartup.addListener(() => {
  snapshotStartupCoordinator.noteBrowserStartup();
  void ensureRuntimeInitialized()
    .then(() => Promise.all([
      workspaceMenuService.synchronize(),
      workspaceEventRouter.enqueueAll(),
      privateWorkspaceEventRouter.enqueueAll()
    ]))
    .catch(() => undefined);
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    Object.prototype.hasOwnProperty.call(changes, WORKSPACE_STATE_STORAGE_KEY)
  ) {
    void workspaceMenuService.synchronize().catch(() => undefined);
    void workspaceEventRouter.enqueueAll();
    void privateWorkspaceEventRouter.enqueueAll();
  }
  if (
    areaName === "local" &&
    Object.prototype.hasOwnProperty.call(changes, SETTINGS_STATE_STORAGE_KEY)
  ) {
    const { oldValue, newValue } = changes[SETTINGS_STATE_STORAGE_KEY];
    void snapshotScheduleService.synchronize().catch(() => undefined);
    // Settings pages confirm any removal before writing, so a changed rule is
    // applied at once (queued after synchronize) rather than at the next save.
    if (retentionRuleChanged(oldValue, newValue)) {
      void snapshotScheduleService.applyRetention().catch(() => undefined);
    }
    if (
      (oldValue?.sidebar?.hideUnloadedTabsFromFirefox === true) !==
      (newValue?.sidebar?.hideUnloadedTabsFromFirefox === true)
    ) {
      void workspaceEventRouter.enqueueAll();
      void privateWorkspaceEventRouter.enqueueAll();
    }
  }
});

void ensureRuntimeInitialized()
  .then(() => Promise.all([
    workspaceEventRouter.enqueueAll(),
    privateWorkspaceEventRouter.enqueueAll()
  ]))
  .catch(() => undefined);

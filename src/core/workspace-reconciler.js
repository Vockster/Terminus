import {
  WORKSPACE_PENDING_OPERATION_KINDS
} from "../contracts/workspace-runtime.js";
import {
  WORKSPACE_CONVERGENCE_CHECKS,
  WORKSPACE_NOTICE_SCHEMA_VERSION,
  WORKSPACE_NOTICE_SEVERITIES,
  WORKSPACE_OPERATION_REASONS,
  parseWorkspaceNotice
} from "../contracts/workspace-operation.js";
import {
  captureWorkspaceLayout,
  ensureWorkspaceLayout,
  findWorkspaceLayoutForTab,
  orderedMaterializedTabIds,
  placeTabInLayout,
  preserveRelocatedWholeGroups,
  preserveRelocatedWholeSplitViews,
  repairWorkspaceTree,
  removeTabFromLayouts,
  setLogicalTreeParent,
  setLogicalGroupPartition
} from "./workspace-layout-policy.js";
import {
  WORKSPACE_TAB_VISIBILITIES,
  deriveWorkspaceTabVisibility,
  workspaceTabVisibilityIsSettled
} from "./workspace-tab-visibility.js";

const FIREFOX_TAB_GROUP_ID_NONE = -1;
const FIREFOX_SPLIT_VIEW_ID_NONE = -1;
// Records of closed windows kept so a restored window gets its workspaces
// back. Windows open when Firefox last quit come first, so only records of
// windows closed long before are ever dropped for space.
export const MAX_RETAINED_CLOSED_WINDOWS = 64;

class TabLifecycleRestart extends Error {
  constructor(cause) {
    super("Firefox tab lifecycle changed during workspace inventory.", { cause });
    this.name = "TabLifecycleRestart";
  }
}

class RequiredActiveTabUnavailable extends Error {
  constructor() {
    super("The required active tab is no longer available.");
    this.name = "RequiredActiveTabUnavailable";
  }
}
const FIREFOX_TAB_ID_NONE = -1;

function validWindowId(windowId) {
  return Number.isInteger(windowId) && windowId >= 0;
}

function validRequiredActiveTab(value) {
  return value === null || (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 3 &&
    typeof value.workspaceId === "string" &&
    typeof value.logicalTabId === "string" &&
    Number.isInteger(value.firefoxTabId) &&
    value.firefoxTabId >= 0
  );
}

function firstWorkspaceId(state) {
  return state.rail.find((entry) => entry.kind === "workspace").workspaceId;
}

function compareTabs(left, right) {
  const leftIndex = Number.isInteger(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isInteger(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || left.id - right.id;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function selectionsEqual(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (selection, index) =>
        selection.workspaceId === right[index].workspaceId &&
        selection.tabId === right[index].tabId
    )
  );
}

function tabIsSharing(tab) {
  const sharing = tab.sharingState;
  return Boolean(sharing && (sharing.camera || sharing.microphone || sharing.screen));
}

function groupIdsOutsideLayout(runtime, targetLayout) {
  return new Set(
    runtime.windows.flatMap((windowRuntime) =>
      windowRuntime.workspaceLayouts.flatMap((layout) =>
        layout === targetLayout ? [] : layout.groups.map((group) => group.id)
      )
    )
  );
}

function splitViewIdsOutsideLayout(runtime, targetLayout) {
  return new Set(
    runtime.windows.flatMap((windowRuntime) =>
      windowRuntime.workspaceLayouts.flatMap((layout) =>
        layout === targetLayout
          ? []
          : (layout.splitViews ?? []).map((splitView) => splitView.id)
      )
    )
  );
}

function logicalGroupByTabId(layout) {
  const result = new Map();
  for (const group of layout?.groups ?? []) {
    for (const tabId of group.tabIds) {
      result.set(tabId, group);
    }
  }
  return result;
}

function operationId(createUuid) {
  return `operation-${createUuid()}`.toLowerCase();
}

function windowHoldsTabs(windowRuntime) {
  return windowRuntime.workspaceLayouts.some((layout) => layout.tabIds.length > 0);
}

function noticeId(createUuid) {
  return `notice-${createUuid()}`.toLowerCase();
}

export class WorkspaceReconciler {
  #browser;
  #runtimeService;
  #settingsService;
  #stateService;
  #createUuid;
  #createTabForWorkspace;
  #retainClosedWindows;
  // The identity last read from each open Firefox window. When a window later
  // reports another one, Firefox restored a saved window into it, and the
  // record made for it before that restore is obsolete.
  #observedWindowIdentities = new Map();

  constructor({
    browserAdapter,
    runtimeService,
    settingsService = null,
    stateService,
    createTabForWorkspace = null,
    createUuid,
    retainClosedWindows = false
  }) {
    this.#browser = browserAdapter;
    this.#runtimeService = runtimeService;
    this.#settingsService = settingsService;
    this.#stateService = stateService;
    this.#createTabForWorkspace = createTabForWorkspace;
    this.#createUuid = createUuid ?? (() => globalThis.crypto.randomUUID());
    this.#retainClosedWindows = retainClosedWindows === true;
  }

  async reconcile(
    requestedWindowId,
    { converge = true, requiredActiveTab = null } = {}
  ) {
    if (
      !validRequiredActiveTab(requiredActiveTab) ||
      (requiredActiveTab !== null && (!converge || !validWindowId(requestedWindowId)))
    ) {
      throw new TypeError("A required active tab needs an exact converging window request.");
    }
    const [settings, state] = await Promise.all([
      this.#settingsService ? this.#settingsService.getOrInitialize() : null,
      this.#stateService.getOrInitialize()
    ]);
    const workspaceIds = state.workspaces.map(({ id }) => id);
    let runtime = await this.#runtimeService.getOrInitialize(workspaceIds);
    let inventory = await this.#inventoryWithLifecycleRestarts(
      state,
      runtime,
      requestedWindowId,
      { capture: true }
    );
    runtime = inventory.runtime;

    if (inventory.changed) {
      runtime = await this.#runtimeService.save(runtime, workspaceIds);
      inventory = this.#replaceRuntime(inventory, runtime);
    }

    if (requiredActiveTab !== null) {
      await this.#requireActiveTab(inventory.requestedContext, requiredActiveTab);
    }

    if (converge) {
      const contextsMissingActiveTabs = [...inventory.contexts.values()].filter(
        (context) =>
          context.splitViewChooserTabId === null &&
          !context.tabs.some(
            (tab) =>
              context.assignmentByTabId.get(tab.logicalId) ===
              context.windowRuntime.activeWorkspaceId
          )
      );
      if (contextsMissingActiveTabs.length > 0) {
        let pendingChanged = false;
        for (const context of contextsMissingActiveTabs) {
          if (!context.windowRuntime.pendingOperation) {
            context.windowRuntime.pendingOperation = {
              id: operationId(this.#createUuid),
              kind: WORKSPACE_PENDING_OPERATION_KINDS.RECONCILE
            };
            pendingChanged = true;
          }
        }
        if (pendingChanged) {
          runtime = await this.#runtimeService.save(runtime, workspaceIds);
          inventory = this.#replaceRuntime(inventory, runtime);
        }

        let created = false;
        for (const priorContext of contextsMissingActiveTabs) {
          const context = inventory.contexts.get(priorContext.windowId);
          try {
            const tab = this.#createTabForWorkspace
              ? await this.#createTabForWorkspace(
                context.windowId,
                state,
                context.windowRuntime.activeWorkspaceId
              )
              : await this.#browser.createTab(context.windowId);
            let logicalId = await this.#browser.getOrCreateTabIdentity(tab.id);
            if (runtime.tabs.some((entry) => entry.id === logicalId)) {
              logicalId = await this.#browser.replaceTabIdentity(tab.id);
            }
            runtime.tabs.push({
              id: logicalId,
              workspaceId: context.windowRuntime.activeWorkspaceId
            });
            placeTabInLayout(
              context.windowRuntime,
              context.windowRuntime.activeWorkspaceId,
              logicalId
            );
            created = true;
          } catch {
            await this.storeNotice(context.windowId, {
              operation: context.windowRuntime.pendingOperation.kind,
              severity: WORKSPACE_NOTICE_SEVERITIES.ERROR,
              reasons: [
                {
                  reason: WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE,
                  count: 1,
                  retryable: true
                }
              ]
            }).catch(() => undefined);
          }
        }
        if (created) {
          runtime = await this.#runtimeService.save(runtime, workspaceIds);
          inventory = await this.#inventoryWithLifecycleRestarts(state, runtime, requestedWindowId, {
            capture: false
          });
          runtime = inventory.runtime;
        }
      }

      let marked = false;
      for (const context of inventory.contexts.values()) {
        if (
          context.splitViewChooserTabId === null &&
          !context.windowRuntime.pendingOperation &&
          this.#convergenceGap(context, settings) !== null
        ) {
          context.windowRuntime.pendingOperation = {
            id: operationId(this.#createUuid),
            kind: WORKSPACE_PENDING_OPERATION_KINDS.RECONCILE
          };
          marked = true;
        }
      }
      if (marked) {
        runtime = await this.#runtimeService.save(runtime, workspaceIds);
        inventory = this.#replaceRuntime(inventory, runtime);
      }

      const failedWindows = new Set();
      const refusedActiveHideKeysByWindow = new Map();
      for (const context of inventory.contexts.values()) {
        if (
          context.splitViewChooserTabId !== null ||
          !context.windowRuntime.pendingOperation
        ) {
          continue;
        }
        const materialization = await this.#materialize(
          context,
          settings,
          context.windowId === requestedWindowId ? requiredActiveTab : null
        );
        if (materialization.failed) {
          failedWindows.add(context.windowId);
        }
        refusedActiveHideKeysByWindow.set(
          context.windowId,
          materialization.refusedActiveHideKeys
        );
      }

      if ([...inventory.contexts.values()].some((context) => context.windowRuntime.pendingOperation)) {
        let finalInventory = await this.#inventoryWithLifecycleRestarts(state, runtime, requestedWindowId, {
          capture: false
        });
        runtime = finalInventory.runtime;
        if (requiredActiveTab !== null) {
          await this.#requireActiveTab(
            finalInventory.requestedContext,
            requiredActiveTab,
            { mustBeActive: true }
          );
        }
        let cleared = false;
        for (const context of finalInventory.contexts.values()) {
          if (
            context.splitViewChooserTabId !== null ||
            !context.windowRuntime.pendingOperation
          ) {
            continue;
          }
          const gap = this.#convergenceGap(context, settings, {
            refusedActiveHideKeys:
              refusedActiveHideKeysByWindow.get(context.windowId) ?? new Set()
          });
          if (gap === null) {
            const convergedOperation = context.windowRuntime.pendingOperation.kind;
            context.windowRuntime.pendingOperation = null;
            cleared = true;
            await this.#clearSettledNotice(context.windowId, convergedOperation);
          } else {
            await this.#storeIncompleteNotice(context, failedWindows.has(context.windowId), gap);
          }
        }
        if (finalInventory.changed || cleared) {
          runtime = await this.#runtimeService.save(runtime, workspaceIds);
          finalInventory = this.#replaceRuntime(finalInventory, runtime);
        }
        inventory = finalInventory;
      }
    }

    await Promise.all([...inventory.contexts.values()].map(async (context) => {
      context.notice = await this.#readNotice(context.windowId);
    }));
    return inventory;
  }

  async setPending(runtime, workspaceIds, windowRuntime, kind) {
    this.markPending(windowRuntime, kind);
    return this.#runtimeService.save(runtime, workspaceIds);
  }

  markPending(windowRuntime, kind) {
    windowRuntime.pendingOperation = { id: operationId(this.#createUuid), kind };
  }

  async storeNotice(windowId, { operation, severity, reasons, convergenceCheck = null }) {
    const parsedReasons = reasons.filter((entry) => entry.count > 0);
    if (parsedReasons.length === 0) {
      return null;
    }
    const notice = parseWorkspaceNotice({
      schemaVersion: WORKSPACE_NOTICE_SCHEMA_VERSION,
      id: noticeId(this.#createUuid),
      operation,
      severity,
      retryable: parsedReasons.some((entry) => entry.retryable),
      reasons: parsedReasons,
      convergenceCheck
    });
    await this.#browser.setWindowNotice(windowId, notice);
    return notice;
  }

  // A warning about an operation that fresh inventory has since proved
  // converged is no longer true, so it is removed rather than left for the
  // user to dismiss. Non-retryable and other-operation notices stay.
  async #clearSettledNotice(windowId, operation) {
    const notice = await this.#readNotice(windowId);
    if (
      notice &&
      notice.operation === operation &&
      notice.reasons.every((entry) => entry.retryable)
    ) {
      await this.#browser.clearWindowNotice(windowId);
    }
  }

  async acknowledgeNotice(windowId, expectedNoticeId) {
    const notice = await this.#readNotice(windowId);
    if (!notice || notice.id !== expectedNoticeId) {
      return false;
    }
    await this.#browser.clearWindowNotice(windowId);
    return true;
  }

  #replaceRuntime(inventory, runtime) {
    const contexts = new Map();
    for (const [windowId, context] of inventory.contexts) {
      const windowRuntime = runtime.windows.find((entry) => entry.id === context.windowRuntime.id);
      if (windowRuntime) {
        contexts.set(windowId, { ...context, windowRuntime });
      }
    }
    return {
      ...inventory,
      runtime,
      contexts,
      requestedContext: inventory.requestedContext
        ? contexts.get(inventory.requestedContext.windowId) ?? null
        : null
    };
  }

  // A window that is not open may still come back under its saved identity:
  // Firefox restores the previous session's windows after this background
  // can already run, and it reopens recently closed windows. Keeping the
  // record keeps its tabs' workspaces, order, pins, groups, and trees for
  // that moment; without it every restored tab lands in the window's active
  // workspace. Private windows never come back, and a record whose Firefox
  // window now carries another identity was made before a restore, so those
  // records go. Open windows stay first and closed ones follow in the order
  // they closed, most recent first, so the cap drops the oldest.
  #partitionClosedWindows(runtime, liveWindowLogicalIds, replacedWindowIds) {
    const open = [];
    const closed = [];
    for (const windowRuntime of runtime.windows) {
      if (liveWindowLogicalIds.has(windowRuntime.id)) {
        open.push(windowRuntime);
      } else if (
        this.#retainClosedWindows &&
        !replacedWindowIds.has(windowRuntime.id) &&
        windowHoldsTabs(windowRuntime)
      ) {
        closed.push(windowRuntime);
      }
    }
    const next = [...open, ...closed.slice(0, MAX_RETAINED_CLOSED_WINDOWS)];
    if (arraysEqual(next, runtime.windows)) {
      return false;
    }
    runtime.windows = next;
    return true;
  }

  // Tabs from a closed window can reappear in an open one, as when Firefox
  // reopens a closed tab. Their placement has already moved, so the closed
  // record forgets them, and a record left without tabs has nothing to give.
  #settleClosedWindows(runtime, liveWindowLogicalIds) {
    let changed = false;
    const kept = runtime.windows.filter((windowRuntime) => {
      if (liveWindowLogicalIds.has(windowRuntime.id)) {
        return true;
      }
      const ownTabIds = new Set(
        windowRuntime.workspaceLayouts.flatMap((layout) => layout.tabIds)
      );
      if (ownTabIds.size === 0) {
        changed = true;
        return false;
      }
      const selectedTabs = windowRuntime.selectedTabs.filter(({ tabId }) => ownTabIds.has(tabId));
      if (!selectionsEqual(windowRuntime.selectedTabs, selectedTabs)) {
        windowRuntime.selectedTabs = selectedTabs;
        changed = true;
      }
      return true;
    });
    if (kept.length !== runtime.windows.length) {
      runtime.windows = kept;
    }
    return changed;
  }

  async #inventoryWithLifecycleRestarts(state, runtime, requestedWindowId, options) {
    let restarts = 0;
    while (true) {
      try {
        return await this.#inventory(state, runtime, requestedWindowId, options);
      } catch (error) {
        if (!(error instanceof TabLifecycleRestart) || restarts >= 3) {
          throw error instanceof TabLifecycleRestart ? error.cause : error;
        }
        restarts += 1;
      }
    }
  }

  async #runTabSessionPhase(context, tabId, operation) {
    const before = this.#browser.getTabLifecycle?.(context.windowId)?.generation ?? 0;
    try {
      return await operation();
    } catch (error) {
      let listedTabs;
      try {
        listedTabs = await this.#browser.listTabs(context.windowId);
      } catch {
        throw error;
      }
      const after = this.#browser.getTabLifecycle?.(context.windowId)?.generation ?? before;
      if (
        this.#browser.isTabTombstoned?.(context.windowId, tabId) === true ||
        !listedTabs.some(({ id }) => id === tabId) ||
        after !== before
      ) {
        throw new TabLifecycleRestart(error);
      }
      throw error;
    }
  }

  async #inventory(state, runtime, requestedWindowId, { capture }) {
    const workspaceIds = state.workspaces.map(({ id }) => id);
    const workspaceOrder = new Map(workspaceIds.map((id, index) => [id, index]));
    const windowIds = [...new Set(await this.#browser.listNormalWindowIds())]
      .filter(validWindowId)
      .sort((left, right) => left - right);
    let changed = false;
    const previousPlacement = new Map();
    const relocatedGroups = new Map();
    const relocatedSplitViews = new Map();
    for (const windowRuntime of runtime.windows) {
      for (const layout of windowRuntime.workspaceLayouts) {
        const groupMap = logicalGroupByTabId(layout);
        for (const tabId of layout.tabIds) {
          previousPlacement.set(tabId, {
            pinned: layout.pinnedTabIds.includes(tabId),
            group: groupMap.get(tabId) ?? null,
            splitView:
              (layout.splitViews ?? []).find((splitView) =>
                splitView.tabIds.includes(tabId)
              ) ?? null
          });
        }
      }
    }

    const contexts = new Map();
    const liveWindowLogicalIds = new Set();
    const replacedWindowIds = new Set();
    const windowRecords = [];
    for (const windowId of windowIds) {
      let logicalWindowId = await this.#browser.getOrCreateWindowIdentity(windowId);
      if (liveWindowLogicalIds.has(logicalWindowId)) {
        logicalWindowId = await this.#browser.replaceWindowIdentity(windowId);
        changed = true;
      }
      liveWindowLogicalIds.add(logicalWindowId);
      const observedWindowId = this.#observedWindowIdentities.get(windowId);
      if (observedWindowId !== undefined && observedWindowId !== logicalWindowId) {
        replacedWindowIds.add(observedWindowId);
      }
      this.#observedWindowIdentities.set(windowId, logicalWindowId);
      // A closed window's retained record is found here too, so a window
      // Firefox restores resumes its saved workspaces and layouts.
      let windowRuntime = runtime.windows.find((entry) => entry.id === logicalWindowId);
      const createdWindowRuntime = !windowRuntime;
      if (!windowRuntime) {
        windowRuntime = {
          id: logicalWindowId,
          activeWorkspaceId: firstWorkspaceId(state),
          selectedTabs: [],
          workspaceLayouts: [],
          pendingOperation: null
        };
        runtime.windows.push(windowRuntime);
        changed = true;
      }
      windowRecords.push({ windowId, windowRuntime, createdWindowRuntime });
    }

    // Tab and group listings are independent reads per window; identity
    // resolution above stays ordered so duplicate detection is deterministic.
    const windowListings = await Promise.all(
      windowRecords.map(({ windowId }) =>
        Promise.all([this.#browser.listTabs(windowId), this.#browser.listTabGroups(windowId)])
      )
    );
    windowRecords.forEach(({ windowId, windowRuntime, createdWindowRuntime }, index) => {
      const [rawTabs, nativeGroupList] = windowListings[index];
      const listedTabs = [...rawTabs].sort(compareTabs);
      const splitViewChooserTabId =
        listedTabs.find((tab) => tab.splitViewChooser === true)?.id ?? null;
      const tabs = listedTabs.filter((tab) => tab.splitViewChooser !== true);
      contexts.set(windowId, {
        windowId,
        windowRuntime,
        bootstrap: windowRuntime.workspaceLayouts.length === 0,
        tabs,
        splitViewChooserTabId,
        nativeGroups: new Map(nativeGroupList.map((group) => [group.id, group])),
        createdWindowRuntime
      });
    });

    for (const windowId of this.#observedWindowIdentities.keys()) {
      if (!windowIds.includes(windowId)) {
        this.#observedWindowIdentities.delete(windowId);
      }
    }
    changed = this.#partitionClosedWindows(runtime, liveWindowLogicalIds, replacedWindowIds) || changed;

    const liveTabLogicalIds = new Set();
    const tabByFirefoxId = new Map();
    for (const context of contexts.values()) {
      let reconciledTabs;
      let identityRestarts = 0;
      while (!reconciledTabs) {
        const candidateTabs = [];
        const candidateLogicalIds = new Set(liveTabLogicalIds);
        let closedDuringIdentityRead = false;
        const lifecycleBefore =
          this.#browser.getTabLifecycle?.(context.windowId)?.generation ?? 0;
        // Identity and logical-group session reads are independent per tab, so
        // one batch replaces the per-tab round trips that dominated cold-start
        // reconciles. Duplicate handling stays sequential below, in tab order,
        // so the first listed tab keeps a duplicated identity deterministically.
        const identityReads = await Promise.all(context.tabs.map(async (tab) => {
          try {
            const [logicalId, logicalGroupId] = await Promise.all([
              this.#browser.getOrCreateTabIdentity(tab.id),
              this.#browser.getTabLogicalGroupId(tab.id)
            ]);
            return { tab, logicalId, logicalGroupId };
          } catch (error) {
            return { tab, error };
          }
        }));
        let failedRead = null;
        for (const read of identityReads) {
          if (read.error) {
            failedRead = read;
            break;
          }
          let logicalId = read.logicalId;
          if (candidateLogicalIds.has(logicalId)) {
            try {
              logicalId = await this.#browser.replaceTabIdentity(read.tab.id);
              changed = true;
            } catch (error) {
              failedRead = { tab: read.tab, error };
              break;
            }
          }
          candidateLogicalIds.add(logicalId);
          candidateTabs.push({ ...read.tab, logicalId, logicalGroupId: read.logicalGroupId });
        }
        if (failedRead !== null) {
          const { tab, error } = failedRead;
          let listedTabs;
          try {
            listedTabs = (await this.#browser.listTabs(context.windowId)).sort(compareTabs);
          } catch {
            throw error;
          }
          const lifecycleAfter =
            this.#browser.getTabLifecycle?.(context.windowId)?.generation ?? lifecycleBefore;
          const removed =
            this.#browser.isTabTombstoned?.(context.windowId, tab.id) === true ||
            !listedTabs.some(({ id }) => id === tab.id) ||
            lifecycleAfter !== lifecycleBefore;
          if (!removed || identityRestarts >= 3) {
            throw error;
          }
          context.splitViewChooserTabId =
            listedTabs.find((entry) => entry.splitViewChooser === true)?.id ?? null;
          context.tabs = listedTabs.filter((entry) => entry.splitViewChooser !== true);
          const nativeGroupList = await this.#browser.listTabGroups(context.windowId);
          context.nativeGroups = new Map(
            nativeGroupList.map((group) => [group.id, group])
          );
          identityRestarts += 1;
          closedDuringIdentityRead = true;
        }
        // Cached identities no longer fail for a tab that closed mid-read, so
        // removal evidence recorded during the pass restarts it explicitly.
        if (
          !closedDuringIdentityRead &&
          candidateTabs.some((tab) => this.#browser.isTabTombstoned?.(context.windowId, tab.id) === true)
        ) {
          if (identityRestarts >= 3) {
            throw new TabLifecycleRestart(new Error("Tabs kept closing during inventory."));
          }
          const listedTabs = (await this.#browser.listTabs(context.windowId)).sort(compareTabs);
          context.splitViewChooserTabId =
            listedTabs.find((entry) => entry.splitViewChooser === true)?.id ?? null;
          context.tabs = listedTabs.filter((entry) => entry.splitViewChooser !== true);
          context.nativeGroups = new Map(
            (await this.#browser.listTabGroups(context.windowId)).map((group) => [group.id, group])
          );
          identityRestarts += 1;
          closedDuringIdentityRead = true;
        }
        if (!closedDuringIdentityRead) {
          reconciledTabs = candidateTabs;
        }
      }
      for (const tab of reconciledTabs) {
        liveTabLogicalIds.add(tab.logicalId);
        tabByFirefoxId.set(tab.id, tab);
      }
      context.tabs = reconciledTabs;
    }

    // Firefox restores a saved window by replacing that window's saved values
    // and can reuse its selected tab for a restored one. If that happened
    // while tab identities were read, the reads mix the blank window with the
    // restored one, so the inventory starts again from the restored identity.
    const verifiedWindowIdentities = await Promise.all(
      [...contexts.values()].map(async (context) => ({
        context,
        identity: await this.#browser.getWindowIdentity(context.windowId)
      }))
    );
    for (const { context, identity } of verifiedWindowIdentities) {
      if (identity !== context.windowRuntime.id) {
        throw new TabLifecycleRestart(new Error("A Firefox window was restored during inventory."));
      }
    }

    const assignmentByTabId = new Map(
      runtime.tabs.map((entry) => [entry.id, entry.workspaceId])
    );
    const inheritedParentByTabId = new Map();
    const resolving = new Set();
    const resolveWorkspace = (tab, context) => {
      const existing = assignmentByTabId.get(tab.logicalId);
      if (existing) {
        return existing;
      }
      if (resolving.has(tab.logicalId)) {
        return context.windowRuntime.activeWorkspaceId;
      }
      resolving.add(tab.logicalId);
      const opener = Number.isInteger(tab.openerTabId) ? tabByFirefoxId.get(tab.openerTabId) : null;
      const openerContext = opener ? contexts.get(opener.windowId) : null;
      const workspaceId = opener && openerContext
        ? resolveWorkspace(opener, openerContext)
        : context.windowRuntime.activeWorkspaceId;
      if (
        opener &&
        openerContext === context &&
        opener.pinned !== true &&
        tab.pinned !== true &&
        (opener.groupId ?? FIREFOX_TAB_GROUP_ID_NONE) ===
          (tab.groupId ?? FIREFOX_TAB_GROUP_ID_NONE)
      ) {
        inheritedParentByTabId.set(tab.logicalId, opener.logicalId);
      }
      resolving.delete(tab.logicalId);
      assignmentByTabId.set(tab.logicalId, workspaceId);
      runtime.tabs.push({ id: tab.logicalId, workspaceId });
      changed = true;
      return workspaceId;
    };
    for (const context of contexts.values()) {
      for (const tab of context.tabs) {
        resolveWorkspace(tab, context);
      }
      if (
        !context.windowRuntime.pendingOperation &&
        context.splitViewChooserTabId === null
      ) {
        const nativeSplitViews = new Map();
        for (const tab of context.tabs) {
          if (
            Number.isInteger(tab.splitViewId) &&
            tab.splitViewId !== FIREFOX_SPLIT_VIEW_ID_NONE
          ) {
            const members = nativeSplitViews.get(tab.splitViewId) ?? [];
            members.push(tab);
            nativeSplitViews.set(tab.splitViewId, members);
          }
        }
        for (const members of nativeSplitViews.values()) {
          if (members.length !== 2) {
            continue;
          }
          const workspacePartitions = new Set(
            members.map((tab) => assignmentByTabId.get(tab.logicalId))
          );
          if (workspacePartitions.size <= 1) {
            continue;
          }
          const targetWorkspaceId =
            assignmentByTabId.get(members.find((tab) => tab.active === true)?.logicalId) ??
            (workspacePartitions.has(context.windowRuntime.activeWorkspaceId)
              ? context.windowRuntime.activeWorkspaceId
              : assignmentByTabId.get(members[0].logicalId));
          for (const member of members) {
            if (assignmentByTabId.get(member.logicalId) === targetWorkspaceId) {
              continue;
            }
            assignmentByTabId.set(member.logicalId, targetWorkspaceId);
            runtime.tabs.find((entry) => entry.id === member.logicalId).workspaceId =
              targetWorkspaceId;
            changed = true;
          }
        }

        const inactiveNativeSplit = [...nativeSplitViews.values()]
          .filter((members) => members.length === 2)
          .map((members) => ({
            members,
            workspaceId: assignmentByTabId.get(members[0].logicalId)
          }))
          .find(
            ({ workspaceId }) =>
              workspaceId &&
              workspaceId !== context.windowRuntime.activeWorkspaceId
          );
        if (inactiveNativeSplit) {
          context.windowRuntime.activeWorkspaceId = inactiveNativeSplit.workspaceId;
          changed = true;
        }

        const activeTab = context.tabs.find((tab) => tab.active === true);
        const activeTabWorkspaceId = activeTab
          ? assignmentByTabId.get(activeTab.logicalId)
          : null;
        if (
          !inactiveNativeSplit &&
          activeTabWorkspaceId &&
          context.windowRuntime.activeWorkspaceId !== activeTabWorkspaceId
        ) {
          context.windowRuntime.activeWorkspaceId = activeTabWorkspaceId;
          changed = true;
        }
      }
    }

    const closedWindowTabIds = new Set(
      runtime.windows
        .filter((entry) => !liveWindowLogicalIds.has(entry.id))
        .flatMap((entry) => entry.workspaceLayouts.flatMap((layout) => layout.tabIds))
    );
    const staleTabIds = runtime.tabs
      .filter((entry) => !liveTabLogicalIds.has(entry.id) && !closedWindowTabIds.has(entry.id))
      .map((entry) => entry.id);
    if (staleTabIds.length > 0) {
      const staleSet = new Set(staleTabIds);
      for (const context of contexts.values()) {
        if (!context.windowRuntime.pendingOperation) {
          continue;
        }
        const missingCount = context.windowRuntime.workspaceLayouts.reduce(
          (count, layout) =>
            count + layout.tabIds.filter((tabId) => staleSet.has(tabId)).length,
          0
        );
        if (missingCount > 0) {
          await this.storeNotice(context.windowId, {
            operation: context.windowRuntime.pendingOperation.kind,
            severity: WORKSPACE_NOTICE_SEVERITIES.WARNING,
            reasons: [
              {
                reason: WORKSPACE_OPERATION_REASONS.MISSING,
                count: missingCount,
                retryable: false
              }
            ]
          });
        }
      }
      for (const tabId of staleTabIds) {
        removeTabFromLayouts(runtime, tabId);
      }
      runtime.tabs = runtime.tabs.filter((entry) => !staleSet.has(entry.id));
      assignmentByTabId.clear();
      for (const entry of runtime.tabs) {
        assignmentByTabId.set(entry.id, entry.workspaceId);
      }
      changed = true;
    }

    const liveOwnerByTabId = new Map();
    for (const context of contexts.values()) {
      for (const tab of context.tabs) {
        liveOwnerByTabId.set(tab.logicalId, context.windowRuntime.id);
        let placement = findWorkspaceLayoutForTab(context.windowRuntime, tab.logicalId);
        const workspaceId = assignmentByTabId.get(tab.logicalId);
        if (!placement || placement.layout.workspaceId !== workspaceId) {
          const prior = previousPlacement.get(tab.logicalId);
          if (prior?.group) {
            relocatedGroups.set(prior.group.id, {
              ...prior.group,
              tabIds: [...prior.group.tabIds]
            });
          }
          if (prior?.splitView) {
            relocatedSplitViews.set(prior.splitView.id, {
              ...prior.splitView,
              tabIds: [...prior.splitView.tabIds]
            });
          }
          removeTabFromLayouts(runtime, tab.logicalId);
          placeTabInLayout(context.windowRuntime, workspaceId, tab.logicalId, {
            pinned: prior?.pinned === true
          });
          changed = true;
        }
      }
    }

    changed =
      preserveRelocatedWholeGroups({
        runtime,
        groups: relocatedGroups.values(),
        liveOwnerByTabId,
        assignmentByTabId
      }) || changed;

    changed =
      preserveRelocatedWholeSplitViews({
        runtime,
        splitViews: relocatedSplitViews.values(),
        liveOwnerByTabId,
        assignmentByTabId
      }) || changed;

    for (const [tabId, parentTabId] of inheritedParentByTabId) {
      const ownerId = liveOwnerByTabId.get(tabId);
      const context = [...contexts.values()].find(
        ({ windowRuntime }) => windowRuntime.id === ownerId
      );
      const layout = context?.windowRuntime.workspaceLayouts.find(
        ({ workspaceId }) => workspaceId === assignmentByTabId.get(tabId)
      );
      if (layout && setLogicalTreeParent(layout, tabId, parentTabId)) {
        changed = true;
      }
    }

    const rememberedTabIds = new Set();
    for (const context of contexts.values()) {
      const nextSelections = context.windowRuntime.selectedTabs.filter((selection) => {
        if (
          rememberedTabIds.has(selection.tabId) ||
          liveOwnerByTabId.get(selection.tabId) !== context.windowRuntime.id ||
          assignmentByTabId.get(selection.tabId) !== selection.workspaceId
        ) {
          return false;
        }
        rememberedTabIds.add(selection.tabId);
        return true;
      });
      if (!selectionsEqual(context.windowRuntime.selectedTabs, nextSelections)) {
        context.windowRuntime.selectedTabs = nextSelections;
        changed = true;
      }
    }
    changed = this.#settleClosedWindows(runtime, liveWindowLogicalIds) || changed;

    if (capture) {
      const reservedGroupIds = new Set(
        runtime.windows.flatMap((windowRuntime) =>
          windowRuntime.workspaceLayouts.flatMap((layout) => layout.groups.map((group) => group.id))
        )
      );
      for (const context of contexts.values()) {
        if (
          context.windowRuntime.pendingOperation ||
          context.splitViewChooserTabId !== null
        ) {
          continue;
        }

        for (const [nativeGroupId, nativeGroup] of context.nativeGroups) {
          const members = context.tabs.filter((tab) => tab.groupId === nativeGroupId);
          const partitions = new Map();
          for (const member of members) {
            const workspaceId = assignmentByTabId.get(member.logicalId);
            const partition = partitions.get(workspaceId) ?? [];
            partition.push(member);
            partitions.set(workspaceId, partition);
          }
          if (partitions.size <= 1) {
            continue;
          }
          for (const [workspaceId, partition] of partitions) {
            const candidateId = partition.map((tab) => tab.logicalGroupId).find(Boolean);
            const logicalGroup = setLogicalGroupPartition({
              windowRuntime: context.windowRuntime,
              workspaceId,
              memberTabIds: partition.sort(compareTabs).map((tab) => tab.logicalId),
              group: {
                id: candidateId,
                title: typeof nativeGroup.title === "string" ? nativeGroup.title : "",
                color: typeof nativeGroup.color === "string" ? nativeGroup.color : "grey",
                collapsed: nativeGroup.collapsed === true
              },
              createGroupId: () => this.#browser.createLogicalGroupId(),
              reservedGroupIds
            });
            reservedGroupIds.add(logicalGroup.id);
            for (const member of partition) {
              await this.#runTabSessionPhase(
                context,
                member.id,
                () => this.#browser.setTabLogicalGroupId(member.id, logicalGroup.id)
              );
              member.logicalGroupId = logicalGroup.id;
            }
          }
          changed = true;
          await this.storeNotice(context.windowId, {
            operation: WORKSPACE_PENDING_OPERATION_KINDS.RECONCILE,
            severity: WORKSPACE_NOTICE_SEVERITIES.WARNING,
            reasons: [
              {
                reason: WORKSPACE_OPERATION_REASONS.MIXED_GROUP,
                count: 1,
                retryable: false
              }
            ]
          });
        }

        const captureWorkspaceIds = context.bootstrap
          ? workspaceIds.filter((workspaceId) =>
              context.tabs.some((tab) => assignmentByTabId.get(tab.logicalId) === workspaceId)
            )
          : [context.windowRuntime.activeWorkspaceId];
        for (const workspaceId of captureWorkspaceIds) {
          const layout = ensureWorkspaceLayout(context.windowRuntime, workspaceId);
          const result = captureWorkspaceLayout({
            windowRuntime: context.windowRuntime,
            workspaceId,
            tabs: context.tabs.filter(
              (tab) => assignmentByTabId.get(tab.logicalId) === workspaceId
            ),
            nativeGroups: context.nativeGroups,
            createGroupId: () => this.#browser.createLogicalGroupId(),
            reservedGroupIds: groupIdsOutsideLayout(runtime, layout),
            createSplitViewId: () => this.#browser.createLogicalSplitViewId(),
            reservedSplitViewIds: splitViewIdsOutsideLayout(runtime, layout)
          });
          changed = result.changed || changed;
          changed = repairWorkspaceTree(result.layout) || changed;
          for (const tab of context.tabs.filter(
            (entry) => assignmentByTabId.get(entry.logicalId) === workspaceId
          )) {
            const logicalGroupId = result.sessionGroupByTabId.get(tab.id);
            if (logicalGroupId) {
              if (tab.logicalGroupId !== logicalGroupId) {
                await this.#runTabSessionPhase(
                  context,
                  tab.id,
                  () => this.#browser.setTabLogicalGroupId(tab.id, logicalGroupId)
                );
                tab.logicalGroupId = logicalGroupId;
              }
            } else if (tab.logicalGroupId) {
              await this.#runTabSessionPhase(
                context,
                tab.id,
                () => this.#browser.clearTabLogicalGroupId(tab.id)
              );
              tab.logicalGroupId = null;
            }
          }
        }
      }
    }

    for (const context of contexts.values()) {
      const activeTab = context.tabs.find((tab) => tab.active === true);
      if (
        activeTab &&
        assignmentByTabId.get(activeTab.logicalId) === context.windowRuntime.activeWorkspaceId
      ) {
        const nextSelections = context.windowRuntime.selectedTabs.filter(
          (selection) => selection.workspaceId !== context.windowRuntime.activeWorkspaceId
        );
        nextSelections.push({
          workspaceId: context.windowRuntime.activeWorkspaceId,
          tabId: activeTab.logicalId
        });
        nextSelections.sort(
          (left, right) => workspaceOrder.get(left.workspaceId) - workspaceOrder.get(right.workspaceId)
        );
        if (!selectionsEqual(context.windowRuntime.selectedTabs, nextSelections)) {
          context.windowRuntime.selectedTabs = nextSelections;
          changed = true;
        }
      }
      context.assignmentByTabId = assignmentByTabId;
      context.state = state;
    }

    return {
      state,
      runtime,
      contexts,
      requestedContext: validWindowId(requestedWindowId) ? contexts.get(requestedWindowId) : null,
      changed
    };
  }

  #selectedActiveTab(context, layout, activeTabs) {
    const activeByLogicalId = new Map(activeTabs.map((tab) => [tab.logicalId, tab]));
    const desiredOrder = orderedMaterializedTabIds(layout ?? {
      tabIds: [],
      pinnedTabIds: [],
      groups: []
    }).filter((id) => activeByLogicalId.has(id));
    const rememberedTabId = context.windowRuntime.selectedTabs.find(
      (selection) => selection.workspaceId === context.windowRuntime.activeWorkspaceId
    )?.tabId;
    return activeByLogicalId.get(rememberedTabId) ??
      activeByLogicalId.get(desiredOrder[0]) ??
      null;
  }

  #activeTabVisibility(context, settings, layout, activeTabs) {
    const selectedTab = this.#selectedActiveTab(context, layout, activeTabs);
    const logicalPins = new Set(layout?.pinnedTabIds ?? []);
    const logicalSplitMembers = new Set(
      (layout?.splitViews ?? []).flatMap(({ tabIds }) => tabIds)
    );
    return {
      selectedTab,
      entries: activeTabs.map((tab) => ({
        tab,
        classification: deriveWorkspaceTabVisibility({
          settings,
          tab,
          isActiveWorkspace: true,
          isLogicalPinned: logicalPins.has(tab.logicalId),
          isLogicalSplitViewMember: logicalSplitMembers.has(tab.logicalId),
          isSelected: selectedTab?.logicalId === tab.logicalId
        })
      }))
    };
  }

  #visibilityAttemptKey(tab) {
    return `${tab.logicalId}\u0000${tab.id}`;
  }

  async #requireActiveTab(context, requiredActiveTab, { mustBeActive = false } = {}) {
    const selectedTabId = context?.windowRuntime.selectedTabs.find(
      ({ workspaceId }) => workspaceId === requiredActiveTab.workspaceId
    )?.tabId;
    const inventoryTab = context?.tabs.find(
      (tab) =>
        tab.logicalId === requiredActiveTab.logicalTabId &&
        tab.id === requiredActiveTab.firefoxTabId
    );
    if (
      !context ||
      context.windowRuntime.activeWorkspaceId !== requiredActiveTab.workspaceId ||
      selectedTabId !== requiredActiveTab.logicalTabId ||
      context.assignmentByTabId.get(requiredActiveTab.logicalTabId) !==
        requiredActiveTab.workspaceId ||
      !inventoryTab ||
      (mustBeActive && inventoryTab.active !== true)
    ) {
      throw new RequiredActiveTabUnavailable();
    }
    try {
      const liveTab = await this.#browser.getTab(requiredActiveTab.firefoxTabId);
      const liveLogicalId = await this.#browser.getTabIdentity(
        requiredActiveTab.firefoxTabId
      );
      if (
        liveTab.windowId !== context.windowId ||
        liveLogicalId !== requiredActiveTab.logicalTabId ||
        (mustBeActive && liveTab.active !== true)
      ) {
        throw new RequiredActiveTabUnavailable();
      }
    } catch (error) {
      if (error instanceof RequiredActiveTabUnavailable) throw error;
      throw new RequiredActiveTabUnavailable();
    }
    return inventoryTab;
  }

  async #materialize(context, settings, requiredActiveTab = null) {
    if (requiredActiveTab !== null) {
      await this.#requireActiveTab(context, requiredActiveTab);
    }
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const activeLayout = ensureWorkspaceLayout(context.windowRuntime, activeWorkspaceId);
    const activeTabs = context.tabs.filter(
      (tab) => context.assignmentByTabId.get(tab.logicalId) === activeWorkspaceId
    );
    const inactiveTabs = context.tabs.filter(
      (tab) => context.assignmentByTabId.get(tab.logicalId) !== activeWorkspaceId
    );
    const activeVisibility = this.#activeTabVisibility(
      context,
      settings,
      activeLayout,
      activeTabs
    );
    const refusedActiveHideKeys = new Set();
    let failed = false;
    const attempt = async (operation) => {
      try {
        await operation();
      } catch {
        failed = true;
      }
    };

    await attempt(() => this.#browser.showTabs(
      activeVisibility.entries
        .filter(({ classification }) =>
          classification.desiredVisibility === WORKSPACE_TAB_VISIBILITIES.VISIBLE
        )
        .filter(({ tab }) => tab.hidden === true)
        .map(({ tab }) => tab.id)
    ));
    const activeByLogicalId = new Map(activeTabs.map((tab) => [tab.logicalId, tab]));
    const desiredOrder = orderedMaterializedTabIds(activeLayout).filter((id) =>
      activeByLogicalId.has(id)
    );
    const selectedTab = activeVisibility.selectedTab;
    if (selectedTab && selectedTab.active !== true) {
      if (selectedTab.hidden === true) {
        await attempt(() => this.#browser.showTabs([selectedTab.id]));
      }
      await attempt(() => this.#browser.activateTab(selectedTab.id));
    }

    let mutatedPins = false;
    for (const tab of inactiveTabs.filter((entry) => entry.pinned === true)) {
      mutatedPins = true;
      await attempt(() => this.#browser.setTabPinned(tab.id, false));
    }
    const groupedFirefoxTabIds = context.tabs.filter(
      (entry) => Number.isInteger(entry.groupId) && entry.groupId !== FIREFOX_TAB_GROUP_ID_NONE
    ).map((tab) => tab.id);
    if (groupedFirefoxTabIds.length > 0) {
      await attempt(() => this.#browser.ungroupTabs(groupedFirefoxTabIds));
    }
    await attempt(() => this.#browser.hideTabs(
      inactiveTabs.filter((tab) => tab.hidden !== true).map((tab) => tab.id)
    ));

    const desiredPinSet = new Set(activeLayout.pinnedTabIds);
    for (const tab of activeTabs) {
      const shouldPin = desiredPinSet.has(tab.logicalId);
      if (tab.pinned !== shouldPin) {
        mutatedPins = true;
        await attempt(() => this.#browser.setTabPinned(tab.id, shouldPin));
      }
    }
    const pinnedFirefoxIds = activeLayout.pinnedTabIds
      .map((tabId) => activeByLogicalId.get(tabId)?.id)
      .filter(Number.isInteger);
    const unpinnedFirefoxIds = desiredOrder
      .filter((tabId) => !desiredPinSet.has(tabId))
      .map((tabId) => activeByLogicalId.get(tabId)?.id)
      .filter(Number.isInteger);
    // Hiding, showing, and mutating other workspaces' tabs never reorders the
    // active tabs relative to each other, so an already-ordered window skips
    // both whole-workspace moves and the tab events they would echo. Pin
    // changes and native groups can still relocate active tabs, so any of
    // those falls back to the explicit moves.
    const desiredFirefoxOrder = [...pinnedFirefoxIds, ...unpinnedFirefoxIds];
    const observedFirefoxOrder = activeTabs.map((tab) => tab.id);
    const activeTabsNativelyGrouped = activeTabs.some(
      (tab) => Number.isInteger(tab.groupId) && tab.groupId !== FIREFOX_TAB_GROUP_ID_NONE
    );
    const orderConverged =
      !mutatedPins &&
      !activeTabsNativelyGrouped &&
      observedFirefoxOrder.length === desiredFirefoxOrder.length &&
      observedFirefoxOrder.every((id, index) => id === desiredFirefoxOrder[index]);
    if (!orderConverged) {
      await attempt(() => this.#browser.moveTabs(pinnedFirefoxIds, { index: 0 }));
      await attempt(() =>
        this.#browser.moveTabs(unpinnedFirefoxIds, { index: pinnedFirefoxIds.length })
      );
    }

    const logicalGroupByFirefoxId = new Map(
      activeTabs.map((tab) => [tab.id, tab.logicalGroupId])
    );
    for (const group of activeLayout.groups) {
      const firefoxTabIds = group.tabIds
        .map((tabId) => activeByLogicalId.get(tabId)?.id)
        .filter(Number.isInteger);
      if (firefoxTabIds.length === 0) {
        continue;
      }
      let nativeGroupId = null;
      await attempt(async () => {
        nativeGroupId = await this.#browser.createTabGroup(firefoxTabIds, context.windowId);
        if (nativeGroupId === null) {
          throw new Error("Firefox did not return a tab group ID.");
        }
        await this.#browser.updateTabGroup(nativeGroupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed
        });
      });
      for (const tabId of firefoxTabIds) {
        // The session value survives the native ungroup/regroup cycle, so a
        // member whose inventoried value already matches skips the write,
        // mirroring the capture-side guard.
        if (logicalGroupByFirefoxId.get(tabId) !== group.id) {
          await attempt(() => this.#browser.setTabLogicalGroupId(tabId, group.id));
        }
      }
    }
    // context.tabs predates the activation above; the chain must start from
    // the tab this materialization selected, as the final check will see it.
    const successorPlan = this.#successorPlan(context, selectedTab?.logicalId);
    if (successorPlan) {
      await attempt(() =>
        this.#browser.moveTabsInSuccession(
          successorPlan.tabIds,
          successorPlan.anchorTabId
        )
      );
    }
    const activeHideTabs = activeVisibility.entries
      .filter(({ classification }) =>
        classification.desiredVisibility === WORKSPACE_TAB_VISIBILITIES.HIDDEN
      )
      .filter(({ tab }) => tab.hidden !== true)
      .map(({ tab }) => tab);
    if (activeHideTabs.length > 0) {
      try {
        const requestedIds = new Set(activeHideTabs.map((tab) => tab.id));
        const hiddenIds = new Set(
          (await this.#browser.hideTabs([...requestedIds])).filter((id) => requestedIds.has(id))
        );
        for (const tab of activeHideTabs) {
          if (!hiddenIds.has(tab.id)) {
            refusedActiveHideKeys.add(this.#visibilityAttemptKey(tab));
          }
        }
      } catch {
        // Firefox can refuse a mixed hide batch for transient/protected state.
        // Fresh inventory below determines what actually happened.
        failed = true;
      }
    }
    return { failed, refusedActiveHideKeys };
  }

  #successorPlan(
    context,
    activeLogicalId = context.tabs.find((tab) => tab.active === true)?.logicalId
  ) {
    if (typeof this.#browser.moveTabsInSuccession !== "function") {
      return null;
    }
    const liveByLogicalId = new Map(
      context.tabs.map((tab) => [tab.logicalId, tab])
    );
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const activeLayout = context.windowRuntime.workspaceLayouts.find(
      (layout) => layout.workspaceId === activeWorkspaceId
    );
    const orderedActiveIds = orderedMaterializedTabIds(activeLayout ?? {
      tabIds: [],
      pinnedTabIds: [],
      groups: []
    }).filter((tabId) => liveByLogicalId.has(tabId));
    if (orderedActiveIds.length === 0) {
      return null;
    }
    const activeIndex = orderedActiveIds.indexOf(activeLogicalId);
    const chainIds = activeIndex < 0
      ? orderedActiveIds
      : [...orderedActiveIds.slice(activeIndex), ...orderedActiveIds.slice(0, activeIndex)];

    const railWorkspaceIds = context.state.rail
      .filter((entry) => entry.kind === "workspace")
      .map((entry) => entry.workspaceId);
    const activeRailIndex = railWorkspaceIds.indexOf(activeWorkspaceId);
    let anchorLogicalId = null;
    for (let offset = 1; offset < railWorkspaceIds.length; offset += 1) {
      const workspaceId = railWorkspaceIds[
        (activeRailIndex + offset + railWorkspaceIds.length) % railWorkspaceIds.length
      ];
      const layout = context.windowRuntime.workspaceLayouts.find(
        (entry) => entry.workspaceId === workspaceId
      );
      const liveIds = orderedMaterializedTabIds(layout ?? {
        tabIds: [],
        pinnedTabIds: [],
        groups: []
      }).filter((tabId) => liveByLogicalId.has(tabId));
      if (liveIds.length === 0) {
        continue;
      }
      const remembered = context.windowRuntime.selectedTabs.find(
        (selection) => selection.workspaceId === workspaceId
      )?.tabId;
      anchorLogicalId = liveIds.includes(remembered) ? remembered : liveIds[0];
      break;
    }
    return {
      tabIds: chainIds.map((tabId) => liveByLogicalId.get(tabId).id),
      anchorTabId: anchorLogicalId === null
        ? FIREFOX_TAB_ID_NONE
        : liveByLogicalId.get(anchorLogicalId).id
    };
  }

  #convergenceGap(context, settings, { refusedActiveHideKeys = new Set() } = {}) {
    const activeWorkspaceId = context.windowRuntime.activeWorkspaceId;
    const layout = context.windowRuntime.workspaceLayouts.find(
      (entry) => entry.workspaceId === activeWorkspaceId
    );
    const activeTabs = context.tabs.filter(
      (tab) => context.assignmentByTabId.get(tab.logicalId) === activeWorkspaceId
    );
    const inactiveTabs = context.tabs.filter(
      (tab) => context.assignmentByTabId.get(tab.logicalId) !== activeWorkspaceId
    );
    if (activeTabs.length === 0) {
      return WORKSPACE_CONVERGENCE_CHECKS.NO_ACTIVE_WORKSPACE_TABS;
    }
    const activeVisibility = this.#activeTabVisibility(context, settings, layout, activeTabs);
    if (activeVisibility.entries.some(({ tab, classification }) =>
      !workspaceTabVisibilityIsSettled({
        classification,
        observedHidden: tab.hidden === true,
        hideRefused: refusedActiveHideKeys.has(this.#visibilityAttemptKey(tab))
      })
    )) {
      return WORKSPACE_CONVERGENCE_CHECKS.ACTIVE_VISIBILITY;
    }
    if (inactiveTabs.some((tab) => tab.hidden !== true)) {
      return WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_VISIBLE;
    }
    if (inactiveTabs.some((tab) => tab.pinned === true)) {
      return WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_PINNED;
    }
    if (inactiveTabs.some((tab) =>
      Number.isInteger(tab.splitViewId) && tab.splitViewId !== FIREFOX_SPLIT_VIEW_ID_NONE
    )) {
      return WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_SPLIT;
    }
    if (inactiveTabs.some((tab) =>
      Number.isInteger(tab.groupId) && tab.groupId !== FIREFOX_TAB_GROUP_ID_NONE
    )) {
      return WORKSPACE_CONVERGENCE_CHECKS.INACTIVE_TAB_GROUPED;
    }
    if (!layout) {
      return WORKSPACE_CONVERGENCE_CHECKS.MISSING_LAYOUT;
    }
    const actualOrder = [...activeTabs].sort(compareTabs).map((tab) => tab.logicalId);
    const activeIdSet = new Set(actualOrder);
    const expectedOrder = orderedMaterializedTabIds(layout).filter((id) => activeIdSet.has(id));
    if (!arraysEqual(actualOrder, expectedOrder)) {
      return WORKSPACE_CONVERGENCE_CHECKS.TAB_ORDER;
    }
    const desiredPinSet = new Set(layout.pinnedTabIds);
    if (activeTabs.some((tab) => tab.pinned !== desiredPinSet.has(tab.logicalId))) {
      return WORKSPACE_CONVERGENCE_CHECKS.PIN_STATE;
    }
    const desiredGroupMap = logicalGroupByTabId(layout);
    for (const tab of activeTabs) {
      const desiredGroup = desiredGroupMap.get(tab.logicalId);
      if (!desiredGroup) {
        if (Number.isInteger(tab.groupId) && tab.groupId !== FIREFOX_TAB_GROUP_ID_NONE) {
          return WORKSPACE_CONVERGENCE_CHECKS.GROUP_MEMBERSHIP;
        }
        continue;
      }
      if (!Number.isInteger(tab.groupId) || tab.groupId === FIREFOX_TAB_GROUP_ID_NONE) {
        return WORKSPACE_CONVERGENCE_CHECKS.GROUP_MEMBERSHIP;
      }
      const members = activeTabs
        .filter((candidate) => candidate.groupId === tab.groupId)
        .sort(compareTabs)
        .map((candidate) => candidate.logicalId);
      if (!arraysEqual(members, desiredGroup.tabIds)) {
        return WORKSPACE_CONVERGENCE_CHECKS.GROUP_MEMBERSHIP;
      }
      const nativeGroup = context.nativeGroups.get(tab.groupId);
      if (
        !nativeGroup ||
        nativeGroup.title !== desiredGroup.title ||
        nativeGroup.color !== desiredGroup.color ||
        nativeGroup.collapsed !== desiredGroup.collapsed
      ) {
        return WORKSPACE_CONVERGENCE_CHECKS.GROUP_METADATA;
      }
    }
    if (!activeTabs.some((tab) => tab.active === true)) {
      return WORKSPACE_CONVERGENCE_CHECKS.NO_ACTIVE_TAB;
    }
    const successorPlan = this.#successorPlan(context);
    if (successorPlan) {
      const tabByFirefoxId = new Map(context.tabs.map((tab) => [tab.id, tab]));
      for (let index = 0; index < successorPlan.tabIds.length; index += 1) {
        const tabId = successorPlan.tabIds[index];
        const desiredSuccessorId =
          successorPlan.tabIds[index + 1] ?? successorPlan.anchorTabId;
        if (tabByFirefoxId.get(tabId)?.successorTabId !== desiredSuccessorId) {
          return WORKSPACE_CONVERGENCE_CHECKS.SUCCESSOR_CHAIN;
        }
      }
    }
    return null;
  }

  async #storeIncompleteNotice(context, browserFailed, convergenceCheck) {
    const inactiveVisible = context.tabs.filter(
      (tab) =>
        context.assignmentByTabId.get(tab.logicalId) !== context.windowRuntime.activeWorkspaceId &&
        tab.hidden !== true
    );
    const reasons = [
      {
        reason: WORKSPACE_OPERATION_REASONS.ACTIVE,
        count: inactiveVisible.filter((tab) => tab.active === true).length,
        retryable: true
      },
      {
        reason: WORKSPACE_OPERATION_REASONS.PINNED,
        count: inactiveVisible.filter((tab) => tab.active !== true && tab.pinned === true).length,
        retryable: true
      },
      {
        reason: WORKSPACE_OPERATION_REASONS.SHARING,
        count: inactiveVisible.filter(
          (tab) => tab.active !== true && tab.pinned !== true && tabIsSharing(tab)
        ).length,
        retryable: true
      },
      {
        reason: WORKSPACE_OPERATION_REASONS.CLOSING,
        count: inactiveVisible.filter(
          (tab) => tab.active !== true && tab.pinned !== true && !tabIsSharing(tab)
        ).length,
        retryable: true
      },
      {
        reason: WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE,
        count: browserFailed ? 1 : 0,
        retryable: true
      },
      {
        reason: WORKSPACE_OPERATION_REASONS.INCOMPLETE,
        count: !browserFailed && inactiveVisible.length === 0 ? 1 : 0,
        retryable: true
      }
    ];
    await this.storeNotice(context.windowId, {
      operation: context.windowRuntime.pendingOperation.kind,
      severity: browserFailed
        ? WORKSPACE_NOTICE_SEVERITIES.ERROR
        : WORKSPACE_NOTICE_SEVERITIES.WARNING,
      reasons,
      convergenceCheck
    });
  }

  async #readNotice(windowId) {
    const raw = await this.#browser.getWindowNotice(windowId);
    if (raw === undefined || raw === null) {
      return null;
    }
    try {
      return parseWorkspaceNotice(raw);
    } catch {
      await this.#browser.clearWindowNotice(windowId);
      return null;
    }
  }
}

import {
  SNAPSHOT_SETTINGS_LIMITS,
  parseSettingsState,
  useSystemInterfaceTypography
} from "../contracts/settings-state.js";
import {
  RESTORE_JOURNAL_SCHEMA_VERSION,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_RESTORE_MODES,
  SNAPSHOT_RESTORE_SCOPES,
  SnapshotError,
  verifySettingsBackup,
  verifySnapshotRecord
} from "../contracts/snapshots.js";
import {
  WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceState
} from "../contracts/workspace-state.js";
import { isCustomIconId } from "../contracts/custom-icons.js";
import { createEmptyWorkspaceRuntime } from "../contracts/workspace-runtime.js";
import {
  SETTINGS_TRANSFER_JOURNAL_SCHEMA_VERSION,
  parseSettingsTransferJournal
} from "../contracts/settings-transfer.js";
import {
  CONTAINER_CAPABILITIES,
  CONTAINER_RESOLUTION_ACTIONS,
  CONTAINER_STATUSES,
  parseContainerResolutionDecisions,
  uniqueAvailableContainerEntries
} from "../contracts/containers.js";
import { normalizeManagedName } from "./managed-name-policy.js";
import { SETTINGS_BACKUP_REVISION_PREFIX } from "./settings-transfer-service.js";
import {
  WORKSPACE_IMPORT_BEHAVIORS,
  normalizeImportedWorkspaces
} from "./workspace-import-policy.js";

function emptyReport({ id, snapshotId, scope, mode = SNAPSHOT_RESTORE_MODES.OVERWRITE, startedAt }) {
  return {
    id,
    snapshotId,
    status: "running",
    scope,
    mode,
    startedAt,
    finishedAt: null,
    created: { workspaces: 0, windows: 0, tabs: 0 },
    applied: {
      workspaces: 0,
      groups: 0,
      pins: 0,
      discarded: 0,
      replacedTabs: 0,
      closedTabs: 0,
      closedWindows: 0
    },
    approximations: [],
    skipped: [],
    failures: []
  };
}

// Firefox validates every ID in one tabs.hide/remove call, so large sets are
// split to keep each call bounded and a single stale ID from failing them all.
const TAB_CALL_CHUNK_SIZE = 200;

function chunks(items, size) {
  const result = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

function parseRestoreBatchSize(value) {
  const { min, max } = SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function appendCount(items, kind, count = 1, detail = null) {
  if (count < 1) {
    return;
  }
  const existing = items.find((entry) => entry.kind === kind && entry.detail === detail);
  if (existing) {
    existing.count += count;
  } else {
    items.push({ kind, count, detail });
  }
}

function mergeLayouts(target, source) {
  target.tabs.push(...source.tabs);
  target.pinnedTabIds.push(...source.pinnedTabIds);
  target.groups.push(...source.groups);
  target.tree.push(...source.tree);
  target.splitViews.push(...source.splitViews);
}

export class SnapshotRestoreService {
  #browser;
  #repository;
  #stateService;
  #runtimeService;
  #settingsTransferService;
  #containerService;
  #customIconService;
  #clock;
  #idGenerator;

  constructor({
    browserAdapter,
    repository,
    stateService,
    runtimeService,
    settingsTransferService,
    containerService = null,
    customIconService,
    clock = () => new Date(),
    idGenerator
  }) {
    this.#browser = browserAdapter;
    this.#repository = repository;
    this.#stateService = stateService;
    this.#runtimeService = runtimeService;
    this.#settingsTransferService = settingsTransferService;
    this.#containerService = containerService;
    this.#customIconService = customIconService;
    this.#clock = clock;
    this.#idGenerator = idGenerator ?? (() => globalThis.crypto.randomUUID());
  }

  async recoverPending() {
    const journal = await this.#repository.readRestoreJournal();
    if (!journal) {
      return null;
    }
    if (journal.phase === "partial") {
      return journal.report;
    }
    const report = {
      ...(journal.report ?? emptyReport({
        id: journal.id,
        snapshotId: journal.snapshotId,
        scope: journal.scope,
        mode: journal.mode,
        startedAt: journal.startedAt
      })),
      status: "partial",
      finishedAt: this.#clock().toISOString(),
      failures: [
        ...(journal.report?.failures ?? []),
        { kind: "background-restarted", count: 1, detail: journal.phase }
      ]
    };
    await this.#repository.writeRestoreJournal({ ...journal, phase: "partial", report });
    await this.#repository.writeLastRestoreReport(report);
    return report;
  }

  async containerPreflight(record, request) {
    const snapshot = await verifySnapshotRecord(record);
    const parsedRequest = this.#parseRequest(request, snapshot);
    const report = emptyReport({
      id: "restore-preflight",
      snapshotId: snapshot.id,
      scope: parsedRequest.scope,
      startedAt: this.#clock().toISOString()
    });
    const selection = this.#selectSnapshotContent(snapshot, parsedRequest, report);
    const selectedWorkspaceIds = new Set(selection.workspaceIds);
    const usage = new Map();
    const count = (refId, kind) => {
      const current = usage.get(refId) ?? { tabs: 0, workspaceDefaults: 0 };
      current[kind] += 1;
      usage.set(refId, current);
    };
    for (const window of selection.windows) {
      for (const layout of window.workspaceLayouts) {
        for (const tab of layout.tabs) {
          if (tab.container.kind === "container") count(tab.container.refId, "tabs");
        }
      }
    }
    for (const workspace of snapshot.payload.workspaceState.workspaces) {
      if (selectedWorkspaceIds.has(workspace.id) && workspace.defaultContainerRef !== null) {
        count(workspace.defaultContainerRef, "workspaceDefaults");
      }
    }
    if (usage.size === 0) {
      return {
        required: false,
        capability: this.#containerService
          ? (await this.#containerService.overview()).capability
          : CONTAINER_CAPABILITIES.UNSUPPORTED,
        references: [],
        choices: [],
        workspaceNames: []
      };
    }
    if (!this.#containerService) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE);
    }
    const overview = await this.#containerService.overview();
    const catalog = new Map(snapshot.payload.containerCatalog.map((entry) => [entry.refId, entry]));
    const local = new Map(overview.containers.map((entry) => [entry.refId, entry]));
    const trustedLocal = ![
      "file-import",
      "legacy-master-import",
      "firefox-sync-import"
    ].includes(snapshot.reason);
    const choices = uniqueAvailableContainerEntries(overview.containers);
    const references = [...usage.entries()].map(([refId, counts]) => {
      const descriptor = catalog.get(refId)?.descriptor;
      const current = local.get(refId);
      const autoReuse = trustedLocal && current?.status === CONTAINER_STATUSES.AVAILABLE;
      return {
        refId,
        descriptor,
        tabCount: counts.tabs,
        workspaceDefaultCount: counts.workspaceDefaults,
        autoReuse,
        suggestedRefIds: choices
          .filter((entry) => this.#containerDescriptorsMatch(entry.descriptor, descriptor))
          .map(({ refId: suggestedRefId }) => suggestedRefId),
        nameMatchRefIds: choices
          .filter((entry) => normalizeManagedName(entry.descriptor.name) === normalizeManagedName(descriptor.name))
          .map(({ refId: nameMatchRefId }) => nameMatchRefId)
      };
    });
    return {
      required: references.some(({ autoReuse }) => !autoReuse),
      capability: overview.capability,
      references,
      choices,
      supportedColors: overview.supportedColors,
      supportedIcons: overview.supportedIcons,
      workspaceNames: snapshot.payload.workspaceState.workspaces
        .filter(({ id }) => selectedWorkspaceIds.has(id))
        .map(({ name }) => name)
    };
  }

  #containerDescriptorsMatch(candidate, saved) {
    return Boolean(
      candidate &&
      saved &&
      normalizeManagedName(candidate.name) === normalizeManagedName(saved.name) &&
      candidate.color === saved.color &&
      candidate.icon === saved.icon &&
      candidate.colorCode === saved.colorCode
    );
  }

  async restoreSettingsBackup({
    backup,
    sections,
    inventory,
    currentSettings,
    createSafetySnapshot,
    convergeWindows
  }) {
    const parsed = await verifySettingsBackup(backup);
    const selected = new Set(sections);
    if (
      selected.size === 0 ||
      [...selected].some(
        (section) =>
          !["sidebar", "appearance", "navigation", "snapshots"].includes(section)
      )
    ) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    if (
      !this.#settingsTransferService ||
      typeof this.#settingsTransferService.applyDocuments !== "function" ||
      typeof convergeWindows !== "function"
    ) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    if (selected.has("snapshots")) {
      await createSafetySnapshot("settings-import");
    }
    let nextSettings = parseSettingsState(currentSettings);
    for (const section of ["sidebar", "appearance", "navigation", "snapshots"]) {
      if (selected.has(section)) {
        nextSettings = parseSettingsState({
          ...nextSettings,
          [section]: parsed.payload.settings[section]
        });
      }
    }
    nextSettings = useSystemInterfaceTypography(nextSettings);
    const nextState = inventory.state;
    const restoreId = `restore-${this.#idGenerator()}`.toLowerCase();
    const startedAt = this.#clock().toISOString();
    const workspaceDefinitionsChanged = false;
    const journal = parseSettingsTransferJournal({
      schemaVersion: SETTINGS_TRANSFER_JOURNAL_SCHEMA_VERSION,
      revisionId: `${SETTINGS_BACKUP_REVISION_PREFIX}${restoreId.slice("restore-".length)}`,
      phase: "applying",
      before: {
        settings: currentSettings,
        workspaceState: inventory.state,
        runtime: inventory.runtime
      },
      after: {
        settings: nextSettings,
        workspaceState: nextState,
        runtime: inventory.runtime
      },
      report: {
        workspaceDefinitionsChanged,
        removedWorkspaces: [],
        reassignedTabCount: 0
      }
    });
    await this.#settingsTransferService.applyDocuments({ journal, convergeWindows });
    const finishedAt = this.#clock().toISOString();
    const report = {
      id: restoreId,
      snapshotId: null,
      status: "complete",
      scope: SNAPSHOT_RESTORE_SCOPES.SETTINGS,
      mode: SNAPSHOT_RESTORE_MODES.COPY,
      startedAt,
      finishedAt,
      created: {
        workspaces: 0,
        windows: 0,
        tabs: 0
      },
      applied: {
        workspaces: 0,
        groups: 0,
        pins: 0,
        discarded: 0,
        replacedTabs: 0,
        closedTabs: 0,
        closedWindows: 0
      },
      approximations: [],
      skipped: [],
      failures: [],
      sections: [...selected]
    };
    await this.#repository.writeLastSettingsRestoreReport(report);
    return report;
  }

  // Startup recovery of an interrupted settings restore reports what it kept,
  // undid, or retired in the one user-visible settings restore report.
  async recordInterruptedSettingsRestore(outcome) {
    if (!outcome) {
      return null;
    }
    const now = this.#clock().toISOString();
    const decisions = outcome.documents ? Object.values(outcome.documents) : [];
    const entry = (kind, count) => (count > 0 ? [{ kind, count, detail: null }] : []);
    const report = {
      ...emptyReport({
        id: `restore-recovery-${this.#idGenerator()}`.toLowerCase(),
        snapshotId: null,
        scope: SNAPSHOT_RESTORE_SCOPES.SETTINGS,
        mode: SNAPSHOT_RESTORE_MODES.COPY,
        startedAt: now
      }),
      status: "partial",
      finishedAt: now,
      approximations: [
        ...entry("interrupted-restore-undone", decisions.filter((decision) => decision === "undone").length),
        ...entry("newer-changes-kept", decisions.filter((decision) => decision === "kept-newer").length)
      ],
      failures: [
        ...entry("recovery-record-unreadable", outcome.unreadable ? 1 : 0),
        ...entry("tab-tidying-failed", outcome.convergenceFailed ? 1 : 0)
      ],
      sections: [...outcome.sections]
    };
    return this.#repository.writeLastSettingsRestoreReport(report);
  }

  async restoreSnapshot({
    record,
    request,
    inventory,
    createSafetySnapshot,
    convergeWindow,
    recoverAfterDestructiveFailure = null,
    restoreBatchSize = SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
  }) {
    const batchSize = parseRestoreBatchSize(restoreBatchSize);
    const snapshot = await verifySnapshotRecord(record);
    const parsedRequest = this.#parseRequest(request, snapshot);
    const startedAt = this.#clock().toISOString();
    const journalId = `restore-${this.#idGenerator()}`.toLowerCase();
    const report = emptyReport({
      id: journalId,
      snapshotId: snapshot.id,
      scope: parsedRequest.scope,
      mode: parsedRequest.mode,
      startedAt
    });
    const containerPreflight = await this.containerPreflight(snapshot, request);
    const containerChoices = this.#validateContainerChoices(
      containerPreflight,
      parsedRequest.containerResolutions
    );
    const resolvedSnapshot = this.#applyContainerChoices(snapshot, containerChoices, report);
    const selection = this.#selectSnapshotContent(resolvedSnapshot, parsedRequest, report);
    const customIconCompatibility = await this.#customIconCompatibility();
    const restorePlan = this.#planWorkspaceRestore(
      resolvedSnapshot,
      selection,
      inventory,
      customIconCompatibility
    );
    const targetContext = this.#targetContext(inventory);
    const originalSession = await this.#originalSession(inventory, targetContext);
    report.created.workspaces = restorePlan.createdWorkspaces;
    report.applied.workspaces = restorePlan.reusedWorkspaces;
    if (typeof createSafetySnapshot !== "function" || typeof convergeWindow !== "function") {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    await createSafetySnapshot("snapshot-session-overwrite");
    let journal = {
      schemaVersion: RESTORE_JOURNAL_SCHEMA_VERSION,
      id: journalId,
      snapshotId: snapshot.id,
      phase: "planned",
      mode: parsedRequest.mode,
      scope: parsedRequest.scope,
      targetWindowId: targetContext.windowId,
      createdWindowIds: [],
      createdTabIds: [],
      originalWindowIds: originalSession.windows.map(({ id }) => id),
      originalTabIds: originalSession.windows.flatMap(({ tabIds }) => tabIds),
      originalLogicalWindowIds: originalSession.windows.map(({ logicalId }) => logicalId),
      originalLogicalTabIds: originalSession.logicalTabIds,
      replacementState: restorePlan.state,
      startedAt,
      report
    };
    await this.#repository.writeRestoreJournal(journal);

    try {
      const containerAssignments = await this.#materializeContainerChoices(
        resolvedSnapshot,
        containerChoices,
        report
      );
      journal = await this.#restoreSelection(
        selection,
        restorePlan,
        targetContext,
        journal,
        report,
        convergeWindow,
        containerAssignments,
        batchSize
      );
      report.status = report.failures.length > 0 ? "partial" : "complete";
      report.finishedAt = this.#clock().toISOString();
      await this.#repository.writeLastRestoreReport(report);
      await this.#repository.clearRestoreJournal();
      return report;
    } catch (error) {
      const failure = error?.containerMismatch === true
        ? new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_MISMATCH)
        : error;
      const latestJournal = await this.#repository.readRestoreJournal().catch(() => null);
      const cleanupJournal = latestJournal ?? journal;
      if (["planned", "materializing", "persisting"].includes(cleanupJournal.phase)) {
        await this.#cleanupMaterialized(cleanupJournal);
      }
      report.status = "partial";
      report.finishedAt = this.#clock().toISOString();
      appendCount(report.failures, "restore-interrupted", 1, failure.code ?? "unexpected");
      await this.#repository.writeRestoreJournal({ ...(latestJournal ?? journal), phase: "partial", report });
      await this.#repository.writeLastRestoreReport(report);
      if (
        ["cleanup", "verifying"].includes(cleanupJournal.phase) &&
        typeof recoverAfterDestructiveFailure === "function"
      ) {
        try {
          await recoverAfterDestructiveFailure({
            failure,
            phase: cleanupJournal.phase,
            report: structuredClone(report)
          });
          appendCount(report.failures, "private-rollback-complete", 1, cleanupJournal.phase);
          await this.#repository.clearRestoreJournal();
          await this.#repository.writeLastRestoreReport(report);
        } catch (rollbackError) {
          throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTERNAL_ERROR, undefined, {
            cause: new AggregateError(
              [failure, rollbackError],
              "The private restore and its rollback both failed."
            )
          });
        }
      }
      throw failure;
    }
  }

  #validateContainerChoices(preflight, rawDecisions) {
    const decisions = new Map((rawDecisions ?? []).map((entry) => [entry.refId, entry]));
    const referenced = new Set(preflight.references.map(({ refId }) => refId));
    if ([...decisions.keys()].some((refId) => !referenced.has(refId))) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    const available = new Set(preflight.choices.map(({ refId }) => refId));
    const choices = new Map();
    for (const reference of preflight.references) {
      const decision = decisions.get(reference.refId);
      if (!decision && reference.autoReuse) {
        choices.set(reference.refId, {
          refId: reference.refId,
          action: CONTAINER_RESOLUTION_ACTIONS.EXISTING,
          targetRefId: reference.refId
        });
        continue;
      }
      if (!decision) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_RESOLUTION_REQUIRED);
      }
      if (decision.action === CONTAINER_RESOLUTION_ACTIONS.EXISTING) {
        if (
          preflight.capability !== CONTAINER_CAPABILITIES.AVAILABLE ||
          !available.has(decision.targetRefId)
        ) {
          throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE);
        }
      } else if (decision.action === CONTAINER_RESOLUTION_ACTIONS.RECREATE) {
        if (
          preflight.capability !== CONTAINER_CAPABILITIES.AVAILABLE ||
          !preflight.supportedColors.includes(reference.descriptor.color) ||
          !preflight.supportedIcons.includes(reference.descriptor.icon)
        ) {
          throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE);
        }
      } else if (
        decision.action === CONTAINER_RESOLUTION_ACTIONS.SKIP &&
        reference.workspaceDefaultCount > 0 &&
        decision.clearWorkspaceDefaults !== true
      ) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      choices.set(reference.refId, decision);
    }
    return choices;
  }

  #applyContainerChoices(snapshot, choices, report) {
    const payload = structuredClone(snapshot.payload);
    payload.workspaceState.workspaces = payload.workspaceState.workspaces.map((workspace) => {
      const choice = workspace.defaultContainerRef === null
        ? null
        : choices.get(workspace.defaultContainerRef);
      return choice && [
        CONTAINER_RESOLUTION_ACTIONS.NONE,
        CONTAINER_RESOLUTION_ACTIONS.SKIP
      ].includes(choice.action)
        ? { ...workspace, defaultContainerRef: null }
        : workspace;
    });
    payload.windows = payload.windows.flatMap((window) => {
      const workspaceLayouts = window.workspaceLayouts.flatMap((layout) => {
        const removed = new Set(layout.tabs.flatMap((tab) => {
          if (tab.container.kind !== "container") return [];
          return choices.get(tab.container.refId)?.action === CONTAINER_RESOLUTION_ACTIONS.SKIP
            ? [tab.id]
            : [];
        }));
        const tabs = layout.tabs
          .filter(({ id }) => !removed.has(id))
          .map((tab) => {
            if (
              tab.container.kind === "container" &&
              choices.get(tab.container.refId)?.action === CONTAINER_RESOLUTION_ACTIONS.NONE
            ) {
              return { ...tab, container: { kind: "none" } };
            }
            return tab;
          });
        if (removed.size > 0) {
          appendCount(report.skipped, "container-tabs-skipped", removed.size);
        }
        if (tabs.length === 0) return [];
        const present = new Set(tabs.map(({ id }) => id));
        return [{
          ...layout,
          tabs,
          pinnedTabIds: layout.pinnedTabIds.filter((id) => present.has(id)),
          groups: layout.groups.filter((group) =>
            group.tabIds.every((id) => present.has(id))
          ),
          tree: layout.tree
            .filter(({ tabId }) => present.has(tabId))
            .map((node) => ({
              ...node,
              parentTabId: present.has(node.parentTabId) ? node.parentTabId : null,
              collapsed: present.has(node.parentTabId) ? node.collapsed : false
            })),
          splitViews: layout.splitViews.filter((split) =>
            split.tabIds.every((id) => present.has(id))
          )
        }];
      });
      if (workspaceLayouts.length === 0) return [];
      const presentTabs = new Set(workspaceLayouts.flatMap(({ tabs }) => tabs.map(({ id }) => id)));
      const activeWorkspaceId = workspaceLayouts.some(
        ({ workspaceId }) => workspaceId === window.activeWorkspaceId
      )
        ? window.activeWorkspaceId
        : workspaceLayouts[0].workspaceId;
      return [{
        ...window,
        activeWorkspaceId,
        selectedTabs: window.selectedTabs.filter(({ tabId }) => presentTabs.has(tabId)),
        workspaceLayouts
      }];
    });
    const tabCount = payload.windows.reduce((total, window) =>
      total + window.workspaceLayouts.reduce((count, layout) => count + layout.tabs.length, 0), 0
    );
    if (tabCount === 0) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    return { ...snapshot, payload };
  }

  async #materializeContainerChoices(snapshot, choices, report) {
    const assignments = new Map();
    if (choices.size === 0) return assignments;
    if (!this.#containerService) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE);
    }
    const catalog = new Map(snapshot.payload.containerCatalog.map((entry) => [entry.refId, entry]));
    for (const [refId, choice] of choices) {
      if ([CONTAINER_RESOLUTION_ACTIONS.NONE, CONTAINER_RESOLUTION_ACTIONS.SKIP].includes(choice.action)) {
        continue;
      }
      try {
        if (
          choice.action === CONTAINER_RESOLUTION_ACTIONS.EXISTING &&
          choice.targetRefId !== refId
        ) {
          await this.#containerService.bindReference(refId, choice.targetRefId);
        } else if (choice.action === CONTAINER_RESOLUTION_ACTIONS.RECREATE) {
          await this.#containerService.recreateReference(refId, {
            ...catalog.get(refId).descriptor,
            ...(choice.name ? { name: choice.name } : {})
          });
          appendCount(report.approximations, "created-container-retained");
        }
        assignments.set(refId, await this.#containerService.resolve(refId));
      } catch {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE);
      }
    }
    return assignments;
  }

  #targetContext(inventory) {
    const context = inventory?.requestedContext;
    if (
      !context ||
      !Number.isInteger(context.windowId) ||
      typeof context.windowRuntime?.id !== "string" ||
      context.windowRuntime.pendingOperation !== null
    ) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    return context;
  }

  async #originalSession(inventory, targetContext) {
    if (!(inventory?.contexts instanceof Map)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    const windows = await this.#browser.listNormalWindows();
    if (!Array.isArray(windows) || windows.length === 0) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    const originalWindows = windows.map((window) => {
      const context = inventory.contexts.get(window.id);
      if (
        !Number.isInteger(window.id) ||
        !context ||
        typeof context.windowRuntime?.id !== "string" ||
        context.windowRuntime.pendingOperation !== null ||
        !Array.isArray(context.tabs) ||
        !Array.isArray(window.tabs)
      ) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
      }
      const tabIds = window.tabs.map(({ id }) => id);
      const contextTabIds = new Set(context.tabs.map(({ id }) => id));
      if (
        tabIds.length === 0 ||
        tabIds.some((id) => !Number.isInteger(id) || !contextTabIds.has(id)) ||
        context.tabs.length !== tabIds.length ||
        context.tabs.some(({ logicalId }) => typeof logicalId !== "string")
      ) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
      }
      return {
        id: window.id,
        logicalId: context.windowRuntime.id,
        tabIds
      };
    });
    if (!originalWindows.some(({ id }) => id === targetContext.windowId)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    return {
      windows: originalWindows,
      logicalTabIds: originalWindows.flatMap(({ id }) =>
        inventory.contexts.get(id).tabs.map(({ logicalId }) => logicalId)
      )
    };
  }

  #parseRequest(value, snapshot) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    const expected = {
      [SNAPSHOT_RESTORE_SCOPES.ALL]: ["scope"],
      [SNAPSHOT_RESTORE_SCOPES.WINDOW]: ["scope", "windowId"],
      [SNAPSHOT_RESTORE_SCOPES.TABS]: ["scope", "tabIds"]
    }[value.scope];
    if (expected && Object.prototype.hasOwnProperty.call(value, "containerResolutions")) {
      expected.push("containerResolutions");
    }
    const actualKeys = Object.keys(value);
    if (
      !expected ||
      actualKeys.some((key) => !expected.includes(key)) ||
      expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      actualKeys.length !== expected.length
    ) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    const savedWindow = typeof value.windowId === "string"
      ? snapshot.payload.windows.find(({ id }) => id === value.windowId)
      : null;
    if (value.scope === SNAPSHOT_RESTORE_SCOPES.WINDOW && !savedWindow) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    if (value.scope === SNAPSHOT_RESTORE_SCOPES.TABS) {
      const available = new Set(snapshot.payload.windows.flatMap((window) =>
        window.workspaceLayouts.flatMap((layout) => layout.tabs.map(({ id }) => id))
      ));
      if (
        !Array.isArray(value.tabIds) ||
        value.tabIds.length === 0 ||
        new Set(value.tabIds).size !== value.tabIds.length ||
        value.tabIds.some((id) => typeof id !== "string" || !available.has(id))
      ) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
    }
    return {
      scope: value.scope,
      mode: SNAPSHOT_RESTORE_MODES.OVERWRITE,
      windowId: value.windowId ?? null,
      tabIds: value.tabIds ?? [],
      containerResolutions: Object.prototype.hasOwnProperty.call(value, "containerResolutions")
        ? parseContainerResolutionDecisions(value.containerResolutions, () =>
            new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST)
          )
        : null
    };
  }

  #selectSnapshotContent(snapshot, request, report) {
    if (request.scope === SNAPSHOT_RESTORE_SCOPES.ALL) {
      return {
        windows: snapshot.payload.windows,
        workspaceIds: snapshot.payload.workspaceState.workspaces.map(({ id }) => id),
        preserveRail: true
      };
    }
    const savedWindow = snapshot.payload.windows.find(({ id }) => id === request.windowId);
    if (request.scope === SNAPSHOT_RESTORE_SCOPES.WINDOW) {
      return {
        windows: [savedWindow],
        workspaceIds: savedWindow.workspaceLayouts.map(({ workspaceId }) => workspaceId),
        preserveRail: false
      };
    }
    return this.#selectTabs(snapshot, new Set(request.tabIds), report);
  }

  #selectTabs(snapshot, selectedIds, report) {
    const layouts = new Map();
    const selectedByWorkspace = new Map();
    let firstWindowId = null;
    for (const window of snapshot.payload.windows) {
      for (const layout of window.workspaceLayouts) {
        const filtered = this.#filterLayout(layout, selectedIds, report);
        if (filtered.tabs.length === 0) {
          continue;
        }
        firstWindowId ??= window.id;
        if (layouts.has(layout.workspaceId)) {
          mergeLayouts(layouts.get(layout.workspaceId), filtered);
        } else {
          layouts.set(layout.workspaceId, filtered);
        }
        const selected = window.selectedTabs.find(
          ({ workspaceId, tabId }) => workspaceId === layout.workspaceId && selectedIds.has(tabId)
        );
        if (selected && !selectedByWorkspace.has(layout.workspaceId)) {
          selectedByWorkspace.set(layout.workspaceId, selected);
        }
      }
    }
    const workspaceLayouts = [...layouts.values()];
    if (workspaceLayouts.length === 0) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
    }
    return {
      windows: [{
        id: firstWindowId,
        geometry: null,
        activeWorkspaceId: workspaceLayouts[0].workspaceId,
        selectedTabs: [...selectedByWorkspace.values()],
        workspaceLayouts
      }],
      workspaceIds: workspaceLayouts.map(({ workspaceId }) => workspaceId),
      preserveRail: false
    };
  }

  #filterLayout(layout, selectedIds, report) {
    const tabs = layout.tabs.filter(({ id }) => selectedIds.has(id));
    const present = new Set(tabs.map(({ id }) => id));
    const groups = layout.groups.filter((group) => {
      const selectedCount = group.tabIds.filter((id) => present.has(id)).length;
      if (selectedCount > 0 && selectedCount < group.tabIds.length) {
        appendCount(report.approximations, "partial-group-opened-ungrouped");
      }
      return selectedCount === group.tabIds.length;
    });
    const splitViews = layout.splitViews.filter((split) => {
      const selectedCount = split.tabIds.filter((id) => present.has(id)).length;
      if (selectedCount > 0 && selectedCount < split.tabIds.length) {
        appendCount(report.approximations, "partial-split-opened-independently");
      }
      return selectedCount === split.tabIds.length;
    });
    return {
      workspaceId: layout.workspaceId,
      tabs,
      pinnedTabIds: layout.pinnedTabIds.filter((id) => present.has(id)),
      groups,
      tree: layout.tree
        .filter(({ tabId }) => present.has(tabId))
        .map((node) => ({
          ...node,
          parentTabId: present.has(node.parentTabId) ? node.parentTabId : null,
          collapsed: present.has(node.parentTabId) ? node.collapsed : false
        })),
      splitViews
    };
  }

  async #customIconCompatibility() {
    if (!this.#customIconService || typeof this.#customIconService.list !== "function") {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    if (typeof this.#customIconService.snapshotCompatibility === "function") {
      const { icons, compatibility } = await this.#customIconService.snapshotCompatibility();
      return {
        iconById: new Map(icons.map((icon) => [icon.id, icon])),
        compatibilityBySourceId: new Map(
          compatibility.map((record) => [record.sourceId, record])
        )
      };
    }
    const { icons } = await this.#customIconService.list();
    return {
      iconById: new Map(icons.map((icon) => [icon.id, icon])),
      compatibilityBySourceId: new Map()
    };
  }

  #resolveCustomIconId(iconId, { iconById, compatibilityBySourceId }) {
    const direct = iconById.get(iconId) ?? null;
    const compatibility = compatibilityBySourceId.get(iconId) ?? null;
    if (!compatibility) return direct ? iconId : null;

    const liveMappings = compatibility.mappings.filter((mapping) =>
      iconById.get(mapping.targetId)?.digest === mapping.digest
    );
    if (direct) {
      // If this ID now holds the same bytes, it has become safe again. Any
      // other direct row is the collision that forced a remap, and a legacy
      // snapshot has no digest with which to choose between them.
      return liveMappings.some(({ digest }) => digest === direct.digest)
        ? iconId
        : null;
    }
    const targets = [...new Set(liveMappings.map(({ targetId }) => targetId))];
    return targets.length === 1 ? targets[0] : null;
  }

  #planWorkspaceRestore(snapshot, selection, inventory, customIconCompatibility) {
    const selectedWorkspaceIds = new Set(selection.workspaceIds);
    const selectedSourceWorkspaces = snapshot.payload.workspaceState.workspaces.filter(
      ({ id }) => selectedWorkspaceIds.has(id)
    );
    const workspaceMap = new Map(selectedSourceWorkspaces.map(({ id }) => [id, id]));
    const sourceWorkspaces = normalizeImportedWorkspaces({
      sourceWorkspaces: selectedSourceWorkspaces,
      currentWorkspaces: inventory.state.workspaces,
      workspaceIdMap: workspaceMap,
      behavior: WORKSPACE_IMPORT_BEHAVIORS.REPLACE,
      resolveIcon: (iconId) => isCustomIconId(iconId)
        ? this.#resolveCustomIconId(iconId, customIconCompatibility)
        : iconId
    });
    // A window or tab restore drops the rail entries of workspaces it is not
    // restoring, but dividers and spaces belong to no workspace: they are the
    // user's own rail arrangement and survive every scope.
    const rail = selection.preserveRail
      ? snapshot.payload.workspaceState.rail
      : snapshot.payload.workspaceState.rail.filter(
          (entry) => entry.kind !== "workspace" || selectedWorkspaceIds.has(entry.workspaceId)
        );
    const state = parseWorkspaceState({
      schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaces: sourceWorkspaces,
      rail
    });
    const currentIds = new Set(inventory.state.workspaces.map(({ id }) => id));
    return {
      state,
      workspaceMap,
      createdWorkspaces: sourceWorkspaces.filter(({ id }) => !currentIds.has(id)).length,
      reusedWorkspaces: sourceWorkspaces.filter(({ id }) => currentIds.has(id)).length
    };
  }

  async #restoreSelection(
    selection,
    restorePlan,
    targetContext,
    journal,
    report,
    convergeWindow,
    containerAssignments,
    batchSize
  ) {
    const { state, workspaceMap } = restorePlan;
    const runtime = createEmptyWorkspaceRuntime();
    const usedLogicalIds = new Set();
    journal = { ...journal, phase: "materializing", report };
    await this.#repository.writeRestoreJournal(journal);

    const firstSavedWindow = selection.windows[0];
    const firstMapped = this.#mapSavedWindow(firstSavedWindow, workspaceMap, usedLogicalIds);
    const firstMaterialized = await this.#materializeCurrentWindow(
      firstMapped,
      targetContext.windowId,
      firstSavedWindow.geometry,
      journal,
      report,
      containerAssignments,
      batchSize
    );
    journal = firstMaterialized.journal;
    runtime.tabs.push(...firstMapped.assignments);
    runtime.windows.push({
      ...firstMapped.runtimeWindow,
      id: firstMaterialized.logicalWindowId
    });

    for (const savedWindow of selection.windows.slice(1)) {
      const mapped = this.#mapSavedWindow(savedWindow, workspaceMap, usedLogicalIds);
      const materialized = await this.#materializeNewWindow(
        mapped,
        savedWindow.geometry,
        journal,
        report,
        containerAssignments,
        batchSize
      );
      journal = materialized.journal;
      runtime.tabs.push(...mapped.assignments);
      runtime.windows.push({ ...mapped.runtimeWindow, id: materialized.logicalWindowId });
    }
    const replacementWindowIds = [targetContext.windowId, ...journal.createdWindowIds];
    journal = { ...journal, phase: "persisting", report };
    await this.#repository.writeRestoreJournal(journal);
    await this.#stateService.replaceForRestore(state);
    await this.#runtimeService.save(runtime, state.workspaces.map(({ id }) => id));
    await this.#assertReplacementReady(journal.createdTabIds, replacementWindowIds);
    journal = { ...journal, phase: "cleanup", report };
    await this.#repository.writeRestoreJournal(journal);
    await this.#closeOriginalSession({
      targetWindowId: targetContext.windowId,
      targetReplacementTabIds: firstMaterialized.firefoxTabIds,
      replacementWindowIds,
      report
    });
    for (const windowId of replacementWindowIds) {
      try {
        await convergeWindow(windowId);
      } catch {
        appendCount(report.failures, "restore-reconcile-failed");
      }
    }
    await this.#verifyCreated(journal.createdTabIds, report);
    journal = { ...journal, phase: "verifying", report };
    await this.#repository.writeRestoreJournal(journal);
    return journal;
  }

  // One scoped window listing answers "does this tab still exist" for every
  // tab at once; a per-tab lookup would cost thousands of calls for large restores.
  async #liveSession() {
    const windows = await this.#browser.listNormalWindows();
    return {
      windowIds: new Set(windows.map(({ id }) => id).filter(Number.isInteger)),
      tabIds: new Set(
        windows.flatMap(({ tabs }) => (Array.isArray(tabs) ? tabs : []))
          .map(({ id }) => id)
          .filter(Number.isInteger)
      )
    };
  }

  async #assertReplacementReady(tabIds, windowIds) {
    if (tabIds.length === 0 || windowIds.length === 0) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    const live = await this.#liveSession();
    if (
      tabIds.some((tabId) => !live.tabIds.has(tabId)) ||
      windowIds.some((windowId) => !live.windowIds.has(windowId))
    ) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
  }

  async #closeOriginalSession({
    targetWindowId,
    targetReplacementTabIds,
    replacementWindowIds,
    report
  }) {
    const replacementIds = new Set(replacementWindowIds);
    const targetKeepIds = new Set(targetReplacementTabIds);
    const targetTabs = await this.#browser.listTabs(targetWindowId);
    const targetOriginalIds = targetTabs
      .map(({ id }) => id)
      .filter((id) => Number.isInteger(id) && !targetKeepIds.has(id));
    for (const chunk of chunks(targetOriginalIds, TAB_CALL_CHUNK_SIZE)) {
      try {
        await this.#browser.removeTabs(chunk);
      } catch {
        // The fresh listing below owns the observed result; Firefox may have
        // completed only part of a call.
      }
    }
    const remainingTabIds = (await this.#liveSession()).tabIds;
    const targetRemovalFailures = targetOriginalIds.filter((tabId) => remainingTabIds.has(tabId)).length;
    report.applied.closedTabs += targetOriginalIds.length - targetRemovalFailures;
    appendCount(report.failures, "original-tab-removal-failed", targetRemovalFailures);

    const beforeWindowCleanup = await this.#browser.listNormalWindows();
    const windowsToClose = beforeWindowCleanup.filter(
      ({ id }) => Number.isInteger(id) && !replacementIds.has(id)
    );
    for (const window of windowsToClose) {
      try {
        await this.#browser.removeWindow(window.id);
      } catch {
        // Fresh inventory below owns the observed result.
      }
    }
    const remainingWindows = await this.#browser.listNormalWindows();
    const remainingIds = new Set(remainingWindows.map(({ id }) => id));
    for (const window of windowsToClose) {
      if (remainingIds.has(window.id)) {
        appendCount(report.failures, "original-window-removal-failed");
      } else {
        report.applied.closedWindows += 1;
        report.applied.closedTabs += Array.isArray(window.tabs)
          ? window.tabs.filter(({ id }) => Number.isInteger(id)).length
          : 0;
      }
    }
    if (!remainingIds.has(targetWindowId)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  #mapSavedWindow(savedWindow, workspaceMap, usedLogicalIds) {
    const tabMap = new Map();
    const groupMap = new Map();
    const splitMap = new Map();
    for (const layout of savedWindow.workspaceLayouts) {
      layout.tabs.forEach((tab) => {
        tabMap.set(tab.id, this.#freshId("tab", usedLogicalIds));
      });
      layout.groups.forEach((group) => {
        groupMap.set(group.id, this.#freshId("group", usedLogicalIds));
      });
      layout.splitViews.forEach((split) => {
        splitMap.set(split.id, this.#freshId("split", usedLogicalIds));
      });
    }
    const layouts = savedWindow.workspaceLayouts.map((layout) => ({
      workspaceId: workspaceMap.get(layout.workspaceId),
      tabs: layout.tabs.map((tab) => ({ ...tab, id: tabMap.get(tab.id) })),
      tabIds: layout.tabs.map(({ id }) => tabMap.get(id)),
      pinnedTabIds: layout.pinnedTabIds.map((id) => tabMap.get(id)),
      groups: layout.groups.map((group) => ({
        ...group,
        id: groupMap.get(group.id),
        tabIds: group.tabIds.map((id) => tabMap.get(id))
      })),
      tree: layout.tree.map((node) => ({
        ...node,
        tabId: tabMap.get(node.tabId),
        parentTabId: node.parentTabId === null ? null : tabMap.get(node.parentTabId)
      })),
      splitViews: layout.splitViews.map((split) => ({
        ...split,
        id: splitMap.get(split.id),
        tabIds: split.tabIds.map((id) => tabMap.get(id))
      }))
    }));
    const selectedTabs = savedWindow.selectedTabs
      .filter(({ workspaceId, tabId }) => workspaceMap.has(workspaceId) && tabMap.has(tabId))
      .map(({ workspaceId, tabId }) => ({
        workspaceId: workspaceMap.get(workspaceId),
        tabId: tabMap.get(tabId)
      }));
    return {
      activeWorkspaceId: workspaceMap.get(savedWindow.activeWorkspaceId),
      layouts,
      assignments: layouts.flatMap((layout) =>
        layout.tabIds.map((id) => ({ id, workspaceId: layout.workspaceId }))
      ),
      runtimeWindow: {
        id: null,
        activeWorkspaceId: workspaceMap.get(savedWindow.activeWorkspaceId),
        selectedTabs,
        workspaceLayouts: layouts.map((layout) => ({
          workspaceId: layout.workspaceId,
          tabIds: layout.tabIds,
          pinnedTabIds: layout.pinnedTabIds,
          groups: layout.groups,
          tree: layout.tree,
          splitViews: layout.splitViews
        })),
        pendingOperation: null
      },
      usedLogicalIds
    };
  }

  // Restored tabs are created unloaded, at most `batchSize` at a time, so a
  // large snapshot never makes Firefox load every page at once. Each batch is
  // journaled before the next starts: an interrupted restore can always find
  // every tab it created except, at worst, those in the batch still in flight.
  async #createRestoredTabs(windowId, descriptors, {
    batchSize,
    journal,
    report,
    containerAssignments,
    firefoxByLogicalId,
    unloadedTabIds
  }) {
    for (const batch of chunks(descriptors, batchSize)) {
      const outcomes = await Promise.allSettled(batch.map(async (descriptor) => ({
        descriptor,
        result: await this.#browser.createTab(windowId, descriptor.tab.url, {
          cookieStoreId: this.#cookieStoreId(descriptor.tab, containerAssignments),
          discarded: true,
          title: descriptor.tab.title
        })
      })));
      const created = outcomes
        .filter(({ status }) => status === "fulfilled")
        .map(({ value }) => value);
      for (const { descriptor, result } of created) {
        if (!result.urlSupported) {
          report.skipped.push({ kind: "protected-url", title: descriptor.tab.title });
        }
        if (result.discarded === true) {
          unloadedTabIds.add(result.tab.id);
        }
        firefoxByLogicalId.set(descriptor.tab.id, result.tab.id);
      }
      report.created.tabs += created.length;
      journal = {
        ...journal,
        createdTabIds: [...journal.createdTabIds, ...created.map(({ result }) => result.tab.id)],
        report
      };
      await this.#repository.writeRestoreJournal(journal);
      const creationFailure = outcomes.find(({ status }) => status === "rejected");
      if (creationFailure) {
        throw creationFailure.reason;
      }
      const identityFailure = (await Promise.allSettled(created.map(({ descriptor, result }) =>
        this.#browser.setTabIdentity(result.tab.id, descriptor.tab.id)
      ))).find(({ status }) => status === "rejected");
      if (identityFailure) {
        throw identityFailure.reason;
      }
    }
    return journal;
  }

  async #materializeCurrentWindow(
    mapped,
    windowId,
    geometry,
    journal,
    report,
    containerAssignments = new Map(),
    batchSize = SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
  ) {
    const descriptors = mapped.layouts.flatMap((layout) =>
      layout.tabs.map((tab) => ({ tab, workspaceId: layout.workspaceId }))
    );
    if (descriptors.length === 0) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    if (geometry) {
      appendCount(report.approximations, "current-window-geometry-preserved");
    }
    const logicalWindowId = this.#freshId("window", mapped.usedLogicalIds);
    const firefoxByLogicalId = new Map();
    const unloadedTabIds = new Set();
    journal = await this.#createRestoredTabs(windowId, descriptors, {
      batchSize,
      journal,
      report,
      containerAssignments,
      firefoxByLogicalId,
      unloadedTabIds
    });
    await this.#applyPresentation(
      windowId,
      mapped.layouts,
      mapped.activeWorkspaceId,
      firefoxByLogicalId,
      report,
      { unloadedTabIds }
    );
    await this.#browser.setWindowIdentity(windowId, logicalWindowId);
    return {
      journal,
      logicalWindowId,
      firefoxTabIds: [...firefoxByLogicalId.values()]
    };
  }

  async #materializeNewWindow(
    mapped,
    geometry,
    journal,
    report,
    containerAssignments = new Map(),
    batchSize = SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
  ) {
    const descriptors = mapped.layouts.flatMap((layout) =>
      layout.tabs.map((tab) => ({ tab, workspaceId: layout.workspaceId }))
    );
    if (descriptors.length === 0) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    const first = descriptors[0];
    const created = await this.#browser.createWindow(first.tab.url, geometry, {
      cookieStoreId: this.#cookieStoreId(first.tab, containerAssignments)
    });
    if (!created.urlSupported) {
      report.skipped.push({ kind: "protected-url", title: first.tab.title });
    }
    if (!created.geometryApplied && geometry) {
      appendCount(report.approximations, "window-geometry-fallback");
    }
    const windowId = created.window.id;
    const logicalWindowId = this.#freshId("window", mapped.usedLogicalIds);
    await this.#browser.setWindowIdentity(windowId, logicalWindowId);
    let firstFirefoxTab = created.window.tabs?.find(({ id }) => Number.isInteger(id));
    if (!firstFirefoxTab) {
      firstFirefoxTab = (await this.#browser.listTabs(windowId))[0];
    }
    if (!Number.isInteger(firstFirefoxTab?.id)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTERNAL_ERROR);
    }
    await this.#browser.setTabIdentity(firstFirefoxTab.id, first.tab.id);
    const firefoxByLogicalId = new Map([[first.tab.id, firstFirefoxTab.id]]);
    journal = {
      ...journal,
      createdWindowIds: [...journal.createdWindowIds, windowId],
      createdTabIds: [...journal.createdTabIds, firstFirefoxTab.id],
      report
    };
    report.created.windows += 1;
    report.created.tabs += 1;
    await this.#repository.writeRestoreJournal(journal);
    const unloadedTabIds = new Set();
    journal = await this.#createRestoredTabs(windowId, descriptors.slice(1), {
      batchSize,
      journal,
      report,
      containerAssignments,
      firefoxByLogicalId,
      unloadedTabIds
    });
    // Firefox gives a new window one loaded tab; unload it unless it is the
    // tab this window selects.
    await this.#applyPresentation(
      windowId,
      mapped.layouts,
      mapped.activeWorkspaceId,
      firefoxByLogicalId,
      report,
      {
        unloadedTabIds,
        loadedTabIds: created.urlSupported ? [firstFirefoxTab.id] : []
      }
    );
    return { journal, logicalWindowId, windowId };
  }

  async #applyPresentation(
    windowId,
    layouts,
    activeWorkspaceId,
    firefoxByLogicalId,
    report,
    { unloadedTabIds = new Set(), loadedTabIds = [] } = {}
  ) {
    for (const layout of layouts) {
      for (const group of layout.groups) {
        const memberIds = group.tabIds.map((id) => firefoxByLogicalId.get(id)).filter(Number.isInteger);
        if (memberIds.length !== group.tabIds.length) {
          appendCount(report.failures, "group-members-missing");
          continue;
        }
        try {
          await this.#browser.createGroup(memberIds, {
            windowId,
            title: group.title,
            color: group.color,
            collapsed: group.collapsed
          });
          for (const tabId of memberIds) {
            await this.#browser.setTabGroupIdentity(tabId, group.id);
          }
          report.applied.groups += 1;
        } catch {
          appendCount(report.failures, "group-restore-failed");
        }
      }
      if (layout.splitViews.length > 0) {
        appendCount(report.approximations, "split-restored-as-adjacent-tabs", layout.splitViews.length);
      }
      if (layout.workspaceId === activeWorkspaceId) {
        for (const logicalId of layout.pinnedTabIds) {
          try {
            await this.#browser.updateTab(firefoxByLogicalId.get(logicalId), { pinned: true });
            report.applied.pins += 1;
          } catch {
            appendCount(report.failures, "pin-restore-failed");
          }
        }
      }
    }
    const activeLayout = layouts.find(({ workspaceId }) => workspaceId === activeWorkspaceId);
    const selectedLogicalId = activeLayout?.tabs.find(({ active }) => active)?.id ?? activeLayout?.tabIds[0];
    if (selectedLogicalId) {
      try {
        await this.#browser.updateTab(firefoxByLogicalId.get(selectedLogicalId), { active: true });
      } catch {
        appendCount(report.failures, "selection-restore-failed");
      }
    }
    const inactiveIds = layouts
      .filter(({ workspaceId }) => workspaceId !== activeWorkspaceId)
      .flatMap(({ tabIds }) => tabIds.map((id) => firefoxByLogicalId.get(id)))
      .filter(Number.isInteger);
    for (const chunk of chunks(inactiveIds, TAB_CALL_CHUNK_SIZE)) {
      try {
        await this.#browser.hideTabs(chunk);
      } catch {
        appendCount(report.failures, "hide-restored-tabs-failed", chunk.length);
      }
    }
    // Selecting a tab makes Firefox load it, so only the others stay unloaded.
    const selectedFirefoxId = selectedLogicalId ? firefoxByLogicalId.get(selectedLogicalId) : null;
    report.applied.discarded += [...unloadedTabIds].filter((tabId) => tabId !== selectedFirefoxId).length;
    for (const tabId of loadedTabIds) {
      if (tabId === selectedFirefoxId) continue;
      try {
        await this.#browser.discardTab(tabId);
        report.applied.discarded += 1;
      } catch {
        appendCount(report.failures, "discard-restore-failed");
      }
    }
    const highlightedIds = activeLayout?.tabs.filter(({ highlighted }) => highlighted).map(({ id }) => id) ?? [];
    if (highlightedIds.length > 1) {
      try {
        const tabs = await this.#browser.listTabs(windowId);
        const indexById = new Map(tabs.map(({ id, index }) => [id, index]));
        await this.#browser.highlightTabs(
          windowId,
          highlightedIds
            .map((id) => indexById.get(firefoxByLogicalId.get(id)))
            .filter(Number.isInteger)
        );
      } catch {
        appendCount(report.failures, "highlight-restore-failed");
      }
    }
  }

  #cookieStoreId(tab, assignments) {
    if (tab.container.kind === "none") return null;
    if (!assignments.has(tab.container.refId)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE);
    }
    return assignments.get(tab.container.refId);
  }

  async #verifyCreated(tabIds, report) {
    const live = await this.#liveSession();
    appendCount(
      report.failures,
      "created-tab-missing",
      tabIds.filter((tabId) => !live.tabIds.has(tabId)).length
    );
  }

  async #cleanupMaterialized(journal) {
    for (const windowId of [...journal.createdWindowIds].reverse()) {
      await this.#browser.removeWindow(windowId).catch(() => undefined);
    }
    for (const chunk of chunks([...journal.createdTabIds].reverse(), TAB_CALL_CHUNK_SIZE)) {
      try {
        await this.#browser.removeTabs(chunk);
      } catch {
        // One already-closed tab fails the whole call, so fall back to each tab.
        for (const tabId of chunk) {
          await this.#browser.removeTabs([tabId]).catch(() => undefined);
        }
      }
    }
  }

  #freshId(prefix, used) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = `${prefix}-${this.#idGenerator()}`.toLowerCase();
      if (/^[a-z0-9][a-z0-9-]{0,127}$/.test(id) && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTERNAL_ERROR);
  }
}

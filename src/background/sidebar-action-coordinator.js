import { WORKSPACE_SCOPES, workspaceScopeFromIncognito } from "../contracts/workspace-scope.js";
import {
  SIDEBAR_UNDO_OPERATION_KINDS,
  SIDEBAR_UNDO_OUTCOME_STATUSES,
  SIDEBAR_UNDO_REASON_CODES,
  parseSidebarUndoOutcome
} from "../contracts/sidebar-undo.js";
import { fingerprintUndoSnapshot } from "../core/sidebar-undo-service.js";

function requestedCount(entry) {
  const tabCount = entry.affectedKeys.filter((key) => key.startsWith("tab:")).length;
  const workspaceCount = entry.affectedKeys.filter((key) => key.startsWith("workspace:")).length;
  return Math.max(tabCount, workspaceCount, 1);
}

function combineOutcomes(primary, companion) {
  if (!companion) return primary;
  const reasons = new Map();
  for (const entry of [...primary.reasons, ...companion.reasons]) {
    reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + entry.count);
  }
  const totals = {
    requestedCount: primary.requestedCount + companion.requestedCount,
    restoredCount: primary.restoredCount + companion.restoredCount,
    skippedCount: primary.skippedCount + companion.skippedCount,
    failedCount: primary.failedCount + companion.failedCount,
    approximatedCount: primary.approximatedCount + companion.approximatedCount,
    retainedSafetyCount: primary.retainedSafetyCount + companion.retainedSafetyCount
  };
  const status = totals.restoredCount === totals.requestedCount
    ? SIDEBAR_UNDO_OUTCOME_STATUSES.APPLIED
    : totals.restoredCount === 0 && totals.skippedCount === totals.requestedCount
      ? SIDEBAR_UNDO_OUTCOME_STATUSES.SKIPPED
      : totals.restoredCount === 0 && totals.failedCount === totals.requestedCount
        ? SIDEBAR_UNDO_OUTCOME_STATUSES.FAILED
        : SIDEBAR_UNDO_OUTCOME_STATUSES.PARTIAL;
  return parseSidebarUndoOutcome({
    status,
    ...totals,
    reasons: [...reasons].map(([reason, count]) => ({ reason, count }))
  });
}

function unavailableCompanionOutcome(entry, reason, status) {
  const count = requestedCount(entry);
  return parseSidebarUndoOutcome({
    status,
    requestedCount: count,
    restoredCount: 0,
    skippedCount: status === SIDEBAR_UNDO_OUTCOME_STATUSES.SKIPPED ? count : 0,
    failedCount: status === SIDEBAR_UNDO_OUTCOME_STATUSES.FAILED ? count : 0,
    approximatedCount: 0,
    retainedSafetyCount: 0,
    reasons: [{ reason, count }]
  });
}

export function createSidebarActionCoordinator({
  browserApi,
  windowScopeRegistry,
  undoService,
  normalController,
  privateController,
  operationExecutor
}) {
  const sidebarUrl = browserApi.runtime.getURL("src/sidebar/index.html");
  const settingsUrl = browserApi.runtime.getURL("src/settings/index.html");

  function isSidebarSender(sender) {
    return sender?.url === sidebarUrl;
  }

  // Settings runs in an ordinary tab, so its window is the tab's own and is
  // never taken from the message alone.
  function isSettingsSender(sender) {
    return !isSidebarSender(sender) &&
      sender?.url === settingsUrl &&
      Number.isInteger(sender?.tab?.windowId);
  }

  async function verifiedScope(sender, windowId, { allowSettings = false } = {}) {
    const settingsRequest = allowSettings && isSettingsSender(sender);
    if (
      (!isSidebarSender(sender) && !settingsRequest) ||
      !Number.isInteger(windowId) ||
      windowId < 0
    ) {
      throw new TypeError("Sidebar action sender is invalid.");
    }
    if (
      (settingsRequest || Number.isInteger(sender?.tab?.windowId)) &&
      sender.tab.windowId !== windowId
    ) {
      throw new TypeError("Sidebar action window does not match its sender.");
    }
    const scope = await windowScopeRegistry.resolveScope(windowId);
    if (!scope) throw new TypeError("Sidebar action window is unavailable.");
    const hintedScope = workspaceScopeFromIncognito(sender?.tab?.incognito);
    if (hintedScope && hintedScope !== scope) {
      throw new TypeError("Sidebar action scope does not match its sender.");
    }
    return scope;
  }

  function controllerForScope(scope) {
    return scope === WORKSPACE_SCOPES.PRIVATE ? privateController : normalController;
  }

  return Object.freeze({
    isSidebarSender,
    isSettingsSender,

    verifySidebarRequest({ sender, windowId }) {
      return verifiedScope(sender, windowId);
    },

    // Removing workspaces is the one Settings action that fills its window's
    // Undo slot; every other Settings action stays outside it.
    async createSettingsRemovalTransaction({ sender, windowId, label }) {
      if (!isSettingsSender(sender)) {
        throw new TypeError("Settings action sender is invalid.");
      }
      const scope = await verifiedScope(sender, windowId, { allowSettings: true });
      return undoService.createCompositeTransaction({
        primaryScope: scope,
        windowId,
        operation: SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE,
        label
      });
    },

    async createTransaction({ sender, windowId, operation, label }) {
      const scope = await verifiedScope(sender, windowId);
      if (operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE) {
        return undoService.createCompositeTransaction({
          primaryScope: scope,
          windowId,
          operation,
          label
        });
      }
      return undoService.createTransaction({ scope, windowId, operation, label });
    },

    async getSummary({ sender, windowId }) {
      const scope = await verifiedScope(sender, windowId, { allowSettings: true });
      return { scope, summary: await undoService.getSummary(scope, windowId) };
    },

    async execute({ sender, windowId, undoId }) {
      const scope = await verifiedScope(sender, windowId, { allowSettings: true });
      if (isSettingsSender(sender)) {
        // Settings offers Undo only for its own removal, so it may run the
        // slot only while the slot still holds that removal's Undo.
        const summary = await undoService.getSummary(scope, windowId);
        if (
          summary.undoId !== undoId ||
          summary.operation !== SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE ||
          summary.action !== "undo"
        ) {
          throw new TypeError("Settings may undo only its own workspace removal.");
        }
      }
      const controller = controllerForScope(scope);
      return undoService.execute({
        scope,
        windowId,
        undoId,
        restore: (entry) => controller.restoreSidebarUndo(windowId, entry),
        restoreComposite: async (primaryEntry, companionEntry) => {
          if (!operationExecutor?.runExclusive) {
            throw new TypeError("Shared workspace Undo serialization is unavailable.");
          }
          return operationExecutor.runExclusive(async (lease) => {
            const primaryController = controllerForScope(primaryEntry.scope);
            const companionController = companionEntry
              ? controllerForScope(companionEntry.scope)
              : null;
            const primaryCurrent = await primaryController.captureSidebarUndoSnapshot(
              windowId,
              lease
            );
            const companionCurrent = companionEntry
              ? await companionController.captureSidebarUndoSnapshot(null, lease)
              : null;
            const compatible =
              fingerprintUndoSnapshot(primaryCurrent, primaryEntry.affectedKeys) ===
                primaryEntry.expectedPostFingerprint &&
              (!companionEntry ||
                fingerprintUndoSnapshot(companionCurrent, companionEntry.affectedKeys) ===
                  companionEntry.expectedPostFingerprint);
            if (!compatible) {
              const total = requestedCount(primaryEntry) +
                (companionEntry ? requestedCount(companionEntry) : 0);
              return {
                view: await primaryController.getViewWithLease(windowId, lease),
                outcome: parseSidebarUndoOutcome({
                  status: SIDEBAR_UNDO_OUTCOME_STATUSES.SKIPPED,
                  requestedCount: total,
                  restoredCount: 0,
                  skippedCount: total,
                  failedCount: 0,
                  approximatedCount: 0,
                  retainedSafetyCount: 0,
                  reasons: [{ reason: SIDEBAR_UNDO_REASON_CODES.STALE, count: total }]
                }),
                reversals: []
              };
            }
            const primaryResult = await primaryController.restoreSidebarUndoWithLease(
              windowId,
              primaryEntry,
              lease
            );
            if (!companionEntry) {
              return primaryResult;
            }
            if (primaryResult.outcome.status !== SIDEBAR_UNDO_OUTCOME_STATUSES.APPLIED) {
              return {
                view: primaryResult.view,
                outcome: combineOutcomes(
                  primaryResult.outcome,
                  unavailableCompanionOutcome(
                    companionEntry,
                    SIDEBAR_UNDO_REASON_CODES.STALE,
                    SIDEBAR_UNDO_OUTCOME_STATUSES.SKIPPED
                  )
                ),
                reversals: primaryResult.reversals ?? []
              };
            }
            let companionResult;
            try {
              companionResult = await companionController.restoreSidebarUndoCompanion(
                companionEntry,
                lease
              );
            } catch {
              companionResult = {
                outcome: unavailableCompanionOutcome(
                  companionEntry,
                  SIDEBAR_UNDO_REASON_CODES.BROWSER_FAILURE,
                  SIDEBAR_UNDO_OUTCOME_STATUSES.FAILED
                ),
                reversals: []
              };
            }
            return {
              view: primaryResult.view,
              outcome: combineOutcomes(primaryResult.outcome, companionResult.outcome),
              reversals: [
                ...(primaryResult.reversals ?? []),
                ...(companionResult.reversals ?? [])
              ]
            };
          });
        }
      });
    }
  });
}

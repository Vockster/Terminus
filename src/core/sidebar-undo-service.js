import {
  SIDEBAR_UNDO_ACTIONS,
  SIDEBAR_UNDO_OPERATION_KINDS,
  SIDEBAR_UNDO_SCHEMA_VERSION,
  SIDEBAR_UNDO_STATES,
  createEmptySidebarUndoDocument,
  parseSidebarUndoDocument,
  parseSidebarUndoEntry,
  parseSidebarUndoSnapshot,
  sidebarUndoSummary
} from "../contracts/sidebar-undo.js";
import { WORKSPACE_SCOPES, parseWorkspaceScope } from "../contracts/workspace-scope.js";

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function semanticJson(value) {
  return JSON.stringify(stableValue(value));
}

function valuesDiffer(left, right) {
  return semanticJson(left) !== semanticJson(right);
}

function mapBy(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

// Placement, load state, and container identify a tab for staleness and
// affected-key purposes. The page address is deliberately excluded: workspace
// inventory does not carry it, and a close slot reads it only for the exact
// tabs it may reopen, so comparing it would make a slot look stale depending
// on which side of a comparison was journaled.
function tabSemantic(tab) {
  if (!tab) return null;
  return {
    logicalTabId: tab.logicalTabId,
    firefoxTabId: tab.firefoxTabId,
    windowId: tab.windowId,
    logicalWindowId: tab.logicalWindowId,
    workspaceId: tab.workspaceId,
    pinned: tab.pinned,
    discarded: tab.discarded,
    containerRef: tab.containerRef
  };
}

export function deriveUndoAffectedKeys(rawBefore, rawAfter) {
  const before = parseSidebarUndoSnapshot(rawBefore);
  const after = parseSidebarUndoSnapshot(rawAfter);
  const keys = new Set();

  const beforeWorkspaces = mapBy(before.workspaceState.workspaces, "id");
  const afterWorkspaces = mapBy(after.workspaceState.workspaces, "id");
  for (const id of new Set([...beforeWorkspaces.keys(), ...afterWorkspaces.keys()])) {
    if (valuesDiffer(beforeWorkspaces.get(id) ?? null, afterWorkspaces.get(id) ?? null)) {
      keys.add(`workspace:${id}`);
    }
  }
  if (valuesDiffer(before.workspaceState.rail, after.workspaceState.rail)) {
    keys.add("rail");
  }

  const beforeAssignments = mapBy(before.workspaceRuntime.tabs, "id");
  const afterAssignments = mapBy(after.workspaceRuntime.tabs, "id");
  for (const id of new Set([...beforeAssignments.keys(), ...afterAssignments.keys()])) {
    if (valuesDiffer(beforeAssignments.get(id) ?? null, afterAssignments.get(id) ?? null)) {
      keys.add(`assignment:${id}`);
    }
  }
  const beforeWindows = mapBy(before.workspaceRuntime.windows, "id");
  const afterWindows = mapBy(after.workspaceRuntime.windows, "id");
  for (const id of new Set([...beforeWindows.keys(), ...afterWindows.keys()])) {
    if (valuesDiffer(beforeWindows.get(id) ?? null, afterWindows.get(id) ?? null)) {
      keys.add(`window:${id}`);
    }
  }

  const beforeTabs = mapBy(before.browserTabs, "logicalTabId");
  const afterTabs = mapBy(after.browserTabs, "logicalTabId");
  for (const id of new Set([...beforeTabs.keys(), ...afterTabs.keys()])) {
    if (valuesDiffer(tabSemantic(beforeTabs.get(id)), tabSemantic(afterTabs.get(id)))) {
      keys.add(`tab:${id}`);
    }
  }
  return [...keys].sort();
}

function snapshotSemanticSlice(snapshot, affectedKeys) {
  const workspaces = mapBy(snapshot.workspaceState.workspaces, "id");
  const assignments = mapBy(snapshot.workspaceRuntime.tabs, "id");
  const windows = mapBy(snapshot.workspaceRuntime.windows, "id");
  const tabs = mapBy(snapshot.browserTabs, "logicalTabId");
  return affectedKeys.map((key) => {
    if (key === "rail") return [key, snapshot.workspaceState.rail];
    const separator = key.indexOf(":");
    const kind = separator < 0 ? key : key.slice(0, separator);
    const id = separator < 0 ? "" : key.slice(separator + 1);
    if (kind === "workspace") return [key, workspaces.get(id) ?? null];
    if (kind === "assignment") return [key, assignments.get(id) ?? null];
    if (kind === "window") return [key, windows.get(id) ?? null];
    if (kind === "tab") return [key, tabSemantic(tabs.get(id))];
    return [key, null];
  });
}

function hashSemantic(value) {
  const text = semanticJson(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function fingerprintUndoSnapshot(rawSnapshot, affectedKeys) {
  const snapshot = parseSidebarUndoSnapshot(rawSnapshot);
  return `undo-post-${hashSemantic(snapshotSemanticSlice(snapshot, affectedKeys))}`;
}

function overlaps(left, right) {
  const rightSet = new Set(right);
  return left.some((key) => rightSet.has(key));
}

function sharedDefinitionKeys(keys) {
  return keys.filter((key) => key === "rail" || key.startsWith("workspace:"));
}

function defaultUuid() {
  return globalThis.crypto.randomUUID();
}

function withoutBrowserTabs(snapshot) {
  return parseSidebarUndoSnapshot({
    ...snapshot,
    browserTabs: []
  });
}

function journaledBeforeSnapshot(snapshot, operation, affectedKeys) {
  if (
    operation !== SIDEBAR_UNDO_OPERATION_KINDS.TABS_CLOSE &&
    operation !== SIDEBAR_UNDO_OPERATION_KINDS.TABS_UNLOAD &&
    operation !== SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE
  ) {
    return withoutBrowserTabs(snapshot);
  }
  const affectedTabIds = new Set(
    affectedKeys
      .filter((key) => key.startsWith("tab:"))
      .map((key) => key.slice("tab:".length))
  );
  // A container move reopens each tab from its live page, so its journal
  // keeps placement and container only, never the page address or title.
  const withoutPage = operation === SIDEBAR_UNDO_OPERATION_KINDS.TABS_CONTAINER_MOVE;
  return parseSidebarUndoSnapshot({
    ...snapshot,
    browserTabs: snapshot.browserTabs
      .filter(({ logicalTabId }) => affectedTabIds.has(logicalTabId))
      .map((tab) => withoutPage ? { ...tab, url: "about:blank", title: "" } : tab)
  });
}

function reciprocalAction(action) {
  return action === SIDEBAR_UNDO_ACTIONS.UNDO
    ? SIDEBAR_UNDO_ACTIONS.REDO
    : SIDEBAR_UNDO_ACTIONS.UNDO;
}

export class SidebarUndoService {
  #storage;
  #createUuid;
  #onChanged;
  #tail = Promise.resolve();

  constructor({ storage, createUuid = defaultUuid, onChanged = null }) {
    this.#storage = storage;
    this.#createUuid = createUuid;
    this.#onChanged = onChanged;
  }

  initialize() {
    return this.#enqueue(async () => {
      for (const scope of Object.values(WORKSPACE_SCOPES)) {
        const document = await this.#read(scope);
        const entries = document.entries.filter(({ state }) => state === SIDEBAR_UNDO_STATES.READY);
        if (entries.length !== document.entries.length) {
          await this.#write(scope, document, entries);
        }
      }
      return true;
    });
  }

  getSummary(scope, windowId) {
    return this.#enqueue(async () => {
      const parsedScope = parseWorkspaceScope(scope);
      if (!Number.isInteger(windowId) || windowId < 0) throw new TypeError("Invalid Undo window.");
      const document = await this.#read(parsedScope);
      return sidebarUndoSummary(
        document.entries.find((entry) =>
          entry.originWindowId === windowId && entry.state === SIDEBAR_UNDO_STATES.READY
        ) ?? null
      );
    });
  }

  createTransaction({ scope, windowId, operation, label }, { affectedKeyFilter = null } = {}) {
    const parsedScope = parseWorkspaceScope(scope);
    if (
      !Number.isInteger(windowId) || windowId < 0 ||
      !Object.values(SIDEBAR_UNDO_OPERATION_KINDS).includes(operation) ||
      typeof label !== "string" || label.trim().length === 0 || label.length > 160
    ) {
      throw new TypeError("Invalid sidebar Undo transaction metadata.");
    }
    if (affectedKeyFilter !== null && typeof affectedKeyFilter !== "function") {
      throw new TypeError("Invalid sidebar Undo affected-key filter.");
    }
    const metadata = { scope: parsedScope, windowId, operation, label, affectedKeyFilter };
    const service = this;
    let handle = null;
    let finished = false;
    let finalization = null;
    return Object.freeze({
      async prepare(snapshot) {
        if (handle || finished) throw new TypeError("Undo transaction was already prepared.");
        handle = await service.#prepare(metadata, snapshot);
        return true;
      },
      async commit(snapshot) {
        if (!handle || finished) throw new TypeError("Undo transaction is not prepared.");
        finished = true;
        finalization = await service.#commit(handle, snapshot);
        return finalization;
      },
      async abort() {
        if (!handle || finished) return false;
        finished = true;
        return service.#abort(handle);
      },
      async failApplied() {
        if (!handle) return false;
        finished = true;
        finalization = await service.#markUnavailable(handle);
        return finalization;
      },
      get finalization() {
        return finalization;
      }
    });
  }

  createCompositeTransaction({ primaryScope, windowId, operation, label }) {
    const parsedPrimaryScope = parseWorkspaceScope(primaryScope);
    const companionScope = parsedPrimaryScope === WORKSPACE_SCOPES.NORMAL
      ? WORKSPACE_SCOPES.PRIVATE
      : WORKSPACE_SCOPES.NORMAL;
    const primary = this.createTransaction({
      scope: parsedPrimaryScope,
      windowId,
      operation,
      label
    });
    const companion = this.createTransaction({
      scope: companionScope,
      windowId,
      operation,
      label
    }, {
      affectedKeyFilter: (key) => key !== "rail" && !key.startsWith("workspace:")
    });
    let prepared = false;
    let finished = false;
    let finalization = null;
    return Object.freeze({
      composite: true,
      primaryScope: parsedPrimaryScope,
      companionScope,
      async prepareComposite(primarySnapshot, companionSnapshot) {
        if (prepared || finished) throw new TypeError("Composite Undo was already prepared.");
        await primary.prepare(primarySnapshot);
        try {
          await companion.prepare(companionSnapshot);
          prepared = true;
          return true;
        } catch (error) {
          await primary.abort().catch(() => undefined);
          finished = true;
          throw error;
        }
      },
      async commitComposite(primarySnapshot, companionSnapshot) {
        if (!prepared || finished) throw new TypeError("Composite Undo is not prepared.");
        finished = true;
        let companionResult = null;
        let primaryResult = null;
        try {
          companionResult = await companion.commit(companionSnapshot);
          primaryResult = await primary.commit(primarySnapshot);
        } catch {
          await Promise.allSettled([
            primary.failApplied(),
            companion.failApplied()
          ]);
          finalization = { unavailable: true, applied: true, summary: sidebarUndoSummary() };
          return finalization;
        }
        if (companionResult.unavailable || primaryResult.unavailable) {
          await Promise.allSettled([
            primary.failApplied(),
            companion.failApplied()
          ]);
          finalization = { unavailable: true, applied: true, summary: sidebarUndoSummary() };
          return finalization;
        }
        finalization = primaryResult;
        return finalization;
      },
      async abort() {
        if (!prepared || finished) return false;
        finished = true;
        const results = await Promise.allSettled([companion.abort(), primary.abort()]);
        return results.some(({ status, value }) => status === "fulfilled" && value === true);
      },
      async failApplied() {
        if (!prepared) return false;
        finished = true;
        await Promise.allSettled([companion.failApplied(), primary.failApplied()]);
        finalization = { unavailable: true, applied: true, summary: sidebarUndoSummary() };
        return finalization;
      },
      get finalization() {
        return finalization;
      }
    });
  }

  execute({ scope, windowId, undoId, restore, restoreComposite = null }) {
    return this.#enqueue(async () => {
      const parsedScope = parseWorkspaceScope(scope);
      if (
        !Number.isInteger(windowId) || windowId < 0 ||
        typeof undoId !== "string" || typeof restore !== "function" ||
        (restoreComposite !== null && typeof restoreComposite !== "function")
      ) {
        throw new TypeError("Invalid sidebar Undo execution request.");
      }
      let document = await this.#read(parsedScope);
      const entry = document.entries.find(({ originWindowId }) => originWindowId === windowId);
      if (!entry || entry.undoId !== undoId || entry.state !== SIDEBAR_UNDO_STATES.READY) {
        throw new TypeError("The sidebar Undo entry is unavailable or stale.");
      }
      const consuming = { ...entry, state: SIDEBAR_UNDO_STATES.CONSUMING };
      const companionScope = parsedScope === WORKSPACE_SCOPES.NORMAL
        ? WORKSPACE_SCOPES.PRIVATE
        : WORKSPACE_SCOPES.NORMAL;
      let companionDocument = null;
      let companion = null;
      let consumingCompanion = null;
      if (
        entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE &&
        restoreComposite
      ) {
        companionDocument = await this.#read(companionScope);
        companion = companionDocument.entries.find((candidate) =>
          candidate.originWindowId === windowId &&
          candidate.operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE &&
          candidate.action === entry.action &&
          candidate.state === SIDEBAR_UNDO_STATES.READY
        ) ?? null;
        consumingCompanion = companion
          ? { ...companion, state: SIDEBAR_UNDO_STATES.CONSUMING }
          : null;
      }
      const readyDocument = document;
      document = await this.#write(
        parsedScope,
        document,
        document.entries.map((candidate) =>
          candidate.originWindowId === windowId ? consuming : candidate
        )
      );
      if (consumingCompanion) {
        try {
          companionDocument = await this.#write(
            companionScope,
            companionDocument,
            companionDocument.entries.map((candidate) =>
              candidate.originWindowId === windowId ? consumingCompanion : candidate
            )
          );
        } catch (error) {
          await this.#write(parsedScope, document, readyDocument.entries).catch(() => undefined);
          throw error;
        }
      }
      await this.#publish(parsedScope, windowId, null);
      if (companion) {
        await this.#publish(companionScope, windowId, null);
      }
      let result;
      try {
        result = consumingCompanion
          ? await restoreComposite(consuming, consumingCompanion)
          : entry.operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE && restoreComposite
            ? await restoreComposite(consuming, null)
            : await restore(consuming);
      } catch (error) {
        await this.#clearExecutedEntries([
          { scope: parsedScope, entry },
          ...(companion ? [{ scope: companionScope, entry: companion }] : [])
        ], windowId);
        throw error;
      }

      const originals = new Map([[parsedScope, entry]]);
      if (companion) originals.set(companionScope, companion);
      const reciprocals = new Map();
      try {
        for (const receipt of Array.isArray(result?.reversals) ? result.reversals : []) {
          const receiptScope = parseWorkspaceScope(receipt?.scope);
          const original = originals.get(receiptScope);
          if (!original || reciprocals.has(receiptScope)) continue;
          const target = parseSidebarUndoSnapshot(receipt.before);
          const current = parseSidebarUndoSnapshot(receipt.after);
          const affectedKeys = deriveUndoAffectedKeys(target, current);
          if (affectedKeys.length === 0) continue;
          reciprocals.set(receiptScope, parseSidebarUndoEntry({
            schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION,
            undoId: `undo-${this.#createUuid()}`.toLowerCase(),
            scope: receiptScope,
            originWindowId: windowId,
            operation: original.operation,
            label: original.label,
            action: reciprocalAction(original.action),
            state: SIDEBAR_UNDO_STATES.READY,
            affectedKeys,
            before: journaledBeforeSnapshot(target, original.operation, affectedKeys),
            expectedPostFingerprint: fingerprintUndoSnapshot(current, affectedKeys)
          }, receiptScope));
        }
      } catch (error) {
        await this.#clearExecutedEntries([
          { scope: parsedScope, entry },
          ...(companion ? [{ scope: companionScope, entry: companion }] : [])
        ], windowId);
        throw error;
      }

      try {
        for (const { scope: executionScope, entry: original } of [
          ...(companion ? [{ scope: companionScope, entry: companion }] : []),
          { scope: parsedScope, entry }
        ]) {
          const latest = await this.#read(executionScope);
          const stillConsuming = latest.entries.some((candidate) =>
            candidate.originWindowId === windowId &&
            candidate.undoId === original.undoId &&
            candidate.state === SIDEBAR_UNDO_STATES.CONSUMING
          );
          if (!stillConsuming) continue;
          const nextEntries = latest.entries.filter((candidate) =>
            candidate.originWindowId !== windowId
          );
          const reciprocal = reciprocals.get(executionScope) ?? null;
          if (reciprocal) nextEntries.push(reciprocal);
          await this.#write(executionScope, latest, nextEntries);
          await this.#publish(executionScope, windowId, reciprocal);
        }
      } catch {
        await this.#clearExecutedEntries([
          { scope: parsedScope, entry },
          ...(companion ? [{ scope: companionScope, entry: companion }] : [])
        ], windowId);
        reciprocals.clear();
      }
      return result !== null && typeof result === "object"
        ? {
            ...result,
            summary: sidebarUndoSummary(reciprocals.get(parsedScope) ?? null)
          }
        : result;
    });
  }

  clearWindow(windowId) {
    return this.#enqueue(async () => {
      if (!Number.isInteger(windowId) || windowId < 0) return false;
      let changed = false;
      for (const scope of Object.values(WORKSPACE_SCOPES)) {
        const document = await this.#read(scope);
        const entries = document.entries.filter((entry) => entry.originWindowId !== windowId);
        if (entries.length !== document.entries.length) {
          await this.#write(scope, document, entries);
          await this.#publish(scope, windowId, null);
          changed = true;
        }
      }
      return changed;
    });
  }

  discard(scope, windowId) {
    return this.#enqueue(async () => {
      const parsedScope = parseWorkspaceScope(scope);
      if (!Number.isInteger(windowId) || windowId < 0) return false;
      const document = await this.#read(parsedScope);
      const entries = document.entries.filter((entry) => entry.originWindowId !== windowId);
      if (entries.length === document.entries.length) return false;
      await this.#write(parsedScope, document, entries);
      await this.#publish(parsedScope, windowId, null);
      return true;
    });
  }

  clearPrivate() {
    return this.#enqueue(async () => {
      const document = await this.#read(WORKSPACE_SCOPES.PRIVATE);
      const compositeWindowIds = new Set(
        document.entries
          .filter(({ operation }) => operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE)
          .map(({ originWindowId }) => originWindowId)
      );
      await this.#storage.clear(WORKSPACE_SCOPES.PRIVATE);
      for (const entry of document.entries) {
        await this.#publish(WORKSPACE_SCOPES.PRIVATE, entry.originWindowId, null);
      }
      if (compositeWindowIds.size > 0) {
        const normal = await this.#read(WORKSPACE_SCOPES.NORMAL);
        const retained = normal.entries.filter((entry) =>
          entry.operation !== SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_REMOVE ||
          !compositeWindowIds.has(entry.originWindowId)
        );
        if (retained.length !== normal.entries.length) {
          await this.#write(WORKSPACE_SCOPES.NORMAL, normal, retained);
          for (const windowId of compositeWindowIds) {
            await this.#publish(WORKSPACE_SCOPES.NORMAL, windowId, null);
          }
        }
      }
      return document.entries.length > 0;
    });
  }

  #prepare(metadata, rawBefore) {
    return this.#enqueue(async () => {
      const before = parseSidebarUndoSnapshot(rawBefore);
      const document = await this.#read(metadata.scope);
      const prior = document.entries.find(({ originWindowId }) =>
        originWindowId === metadata.windowId
      ) ?? null;
      const undoId = `undo-${this.#createUuid()}`.toLowerCase();
      const prepared = parseSidebarUndoEntry({
        schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION,
        undoId,
        scope: metadata.scope,
        originWindowId: metadata.windowId,
        operation: metadata.operation,
        label: metadata.label,
        action: SIDEBAR_UNDO_ACTIONS.UNDO,
        state: SIDEBAR_UNDO_STATES.PREPARED,
        affectedKeys: [],
        before: withoutBrowserTabs(before),
        expectedPostFingerprint: "pending"
      });
      await this.#write(
        metadata.scope,
        document,
        [...document.entries.filter(({ originWindowId }) =>
          originWindowId !== metadata.windowId
        ), prepared]
      );
      await this.#publish(metadata.scope, metadata.windowId, null);
      return { metadata, undoId, prior, preparedBefore: before };
    });
  }

  #commit(handle, rawAfter) {
    return this.#enqueue(async () => {
      const after = parseSidebarUndoSnapshot(rawAfter);
      let before = handle.preparedBefore;
      let operation = handle.metadata.operation;
      let label = handle.metadata.label;
      let affectedKeys = deriveUndoAffectedKeys(before, after);
      if (
        handle.prior?.state === SIDEBAR_UNDO_STATES.READY &&
        handle.prior.action === SIDEBAR_UNDO_ACTIONS.UNDO &&
        handle.prior.operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_CREATE &&
        operation === SIDEBAR_UNDO_OPERATION_KINDS.WORKSPACE_RENAME &&
        overlaps(handle.prior.affectedKeys, affectedKeys)
      ) {
        before = handle.prior.before;
        operation = handle.prior.operation;
        label = handle.prior.label;
        affectedKeys = deriveUndoAffectedKeys(before, after);
      }
      if (handle.metadata.affectedKeyFilter) {
        affectedKeys = affectedKeys.filter(handle.metadata.affectedKeyFilter);
      }
      const document = await this.#read(handle.metadata.scope);
      const pending = document.entries.find(({ originWindowId }) =>
        originWindowId === handle.metadata.windowId
      );
      if (!pending || pending.undoId !== handle.undoId || pending.state !== SIDEBAR_UNDO_STATES.PREPARED) {
        throw new TypeError("The prepared sidebar Undo transaction was displaced.");
      }
      if (affectedKeys.length === 0) {
        await this.#replaceWithPrior(document, handle);
        return { summary: sidebarUndoSummary(handle.prior), unavailable: false, applied: false };
      }
      const ready = parseSidebarUndoEntry({
        schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION,
        undoId: handle.undoId,
        scope: handle.metadata.scope,
        originWindowId: handle.metadata.windowId,
        operation,
        label,
        action: SIDEBAR_UNDO_ACTIONS.UNDO,
        state: SIDEBAR_UNDO_STATES.READY,
        affectedKeys,
        before: journaledBeforeSnapshot(before, operation, affectedKeys),
        expectedPostFingerprint: fingerprintUndoSnapshot(after, affectedKeys)
      });
      try {
        await this.#write(
          handle.metadata.scope,
          document,
          document.entries.map((entry) =>
            entry.originWindowId === handle.metadata.windowId ? ready : entry
          )
        );
      } catch {
        const latest = await this.#read(handle.metadata.scope).catch(() => createEmptySidebarUndoDocument());
        await this.#write(
          handle.metadata.scope,
          latest,
          latest.entries.filter(({ originWindowId }) => originWindowId !== handle.metadata.windowId)
        ).catch(() => undefined);
        await this.#publish(handle.metadata.scope, handle.metadata.windowId, null);
        return { summary: sidebarUndoSummary(), unavailable: true, applied: true };
      }
      await this.#invalidateOverlaps(ready);
      await this.#publish(handle.metadata.scope, handle.metadata.windowId, ready);
      return { summary: sidebarUndoSummary(ready), unavailable: false, applied: true };
    });
  }

  #abort(handle) {
    return this.#enqueue(async () => {
      const document = await this.#read(handle.metadata.scope);
      const pending = document.entries.find(({ originWindowId }) =>
        originWindowId === handle.metadata.windowId
      );
      if (!pending || pending.undoId !== handle.undoId) return false;
      await this.#replaceWithPrior(document, handle);
      return true;
    });
  }

  #markUnavailable(handle) {
    return this.#enqueue(async () => {
      try {
        const document = await this.#read(handle.metadata.scope);
        const entries = document.entries.filter(({ originWindowId }) =>
          originWindowId !== handle.metadata.windowId
        );
        if (entries.length !== document.entries.length) {
          await this.#write(handle.metadata.scope, document, entries);
        }
      } catch {
        // The slot remains unavailable even if session storage cannot be
        // cleaned immediately. Startup removes any interrupted entry.
      }
      await this.#publish(handle.metadata.scope, handle.metadata.windowId, null);
      return { summary: sidebarUndoSummary(), unavailable: true, applied: true };
    });
  }

  async #replaceWithPrior(document, handle) {
    const entries = document.entries.filter(({ originWindowId }) =>
      originWindowId !== handle.metadata.windowId
    );
    if (handle.prior) entries.push(handle.prior);
    await this.#write(handle.metadata.scope, document, entries);
    await this.#publish(handle.metadata.scope, handle.metadata.windowId, handle.prior);
  }

  async #clearExecutedEntries(executions, windowId) {
    for (const { scope } of executions) {
      try {
        const latest = await this.#read(scope);
        const retained = latest.entries.filter((candidate) =>
          candidate.originWindowId !== windowId
        );
        if (retained.length !== latest.entries.length) {
          await this.#write(scope, latest, retained);
        }
      } catch {
        // Startup removes any interrupted entry if session storage cleanup fails.
      }
      await this.#publish(scope, windowId, null);
    }
  }

  async #invalidateOverlaps(ready) {
    for (const scope of Object.values(WORKSPACE_SCOPES)) {
      const keys = scope === ready.scope
        ? ready.affectedKeys
        : sharedDefinitionKeys(ready.affectedKeys);
      if (keys.length === 0) continue;
      const document = await this.#read(scope);
      const removed = document.entries.filter((entry) =>
        !(scope === ready.scope && entry.originWindowId === ready.originWindowId) &&
        overlaps(entry.affectedKeys, keys)
      );
      if (removed.length === 0) continue;
      await this.#write(
        scope,
        document,
        document.entries.filter((entry) => !removed.includes(entry))
      );
      for (const entry of removed) {
        await this.#publish(scope, entry.originWindowId, null);
      }
    }
  }

  async #read(scope) {
    return parseSidebarUndoDocument(await this.#storage.read(scope), scope);
  }

  async #write(scope, document, entries) {
    const next = parseSidebarUndoDocument({
      schemaVersion: SIDEBAR_UNDO_SCHEMA_VERSION,
      sequence: document.sequence + 1,
      entries
    }, scope);
    const written = await this.#storage.write(scope, next);
    if (written === false) throw new Error("A newer sidebar Undo document already exists.");
    return next;
  }

  async #publish(scope, windowId, entry) {
    if (typeof this.#onChanged !== "function") return;
    await this.#onChanged(scope, windowId, sidebarUndoSummary(
      entry?.state === SIDEBAR_UNDO_STATES.READY ? entry : null
    )).catch(() => undefined);
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY,
  parseSettingsTransferJournal
} from "../../src/contracts/settings-transfer.js";
import { createDefaultSettingsState, parseSettingsState } from "../../src/contracts/settings-state.js";
import {
  WORKSPACE_RUNTIME_SCHEMA_VERSION,
  parseWorkspaceRuntime
} from "../../src/contracts/workspace-runtime.js";
import { parseWorkspaceState } from "../../src/contracts/workspace-state.js";
import { SettingsTransferService } from "../../src/core/settings-transfer-service.js";

function workspaceState(ids = ["ws-a", "ws-b"]) {
  return parseWorkspaceState({
    schemaVersion: 5,
    workspaces: ids.map((id) => ({
      id,
      name: id.toUpperCase(),
      icon: "house",
      color: "#336699",
      defaultContainerRef: null
    })),
    rail: ids.map((workspaceId) => ({ kind: "workspace", workspaceId }))
  });
}

function runtime(state, assignments = [["tab-a", state.workspaces[0].id]]) {
  const workspaceIds = state.workspaces.map(({ id }) => id);
  const tabs = assignments.map(([id, workspaceId]) => ({ id, workspaceId }));
  return parseWorkspaceRuntime({
    schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
    tabs,
    windows: []
  }, workspaceIds);
}

function documents({ size = "medium", workspaceIds = ["ws-a", "ws-b"], assignments } = {}) {
  const settings = createDefaultSettingsState();
  settings.sidebar.workspaceSize = size;
  const workspaceStateDocument = workspaceState(workspaceIds);
  return {
    settings: parseSettingsState(settings),
    workspaceState: workspaceStateDocument,
    runtime: runtime(workspaceStateDocument, assignments)
  };
}

function journal({
  before,
  after,
  phase = "applying",
  revisionId = "revision-settings-backup-test",
  workspaceDefinitionsChanged = false
}) {
  return parseSettingsTransferJournal({
    schemaVersion: 1,
    revisionId,
    phase,
    before,
    after,
    report: {
      workspaceDefinitionsChanged,
      removedWorkspaces: workspaceDefinitionsChanged
        ? [{ sourceWorkspaceId: "ws-a", destinationWorkspaceId: "ws-b" }]
        : [],
      reassignedTabCount: workspaceDefinitionsChanged ? 1 : 0
    }
  });
}

function harness({
  initial = documents(),
  initialJournal,
  failJournalRead = false,
  settingsWriteFailures = 0,
  onSettingsWriteFailure = null
} = {}) {
  let settings = structuredClone(initial.settings);
  let state = structuredClone(initial.workspaceState);
  let currentRuntime = structuredClone(initial.runtime);
  let storedJournal = structuredClone(initialJournal);
  let remainingSettingsFailures = settingsWriteFailures;
  const calls = [];
  const service = new SettingsTransferService({
    settingsService: {
      async getOrInitialize() { return parseSettingsState(settings); },
      async replaceForRestore(value) {
        calls.push("settings");
        if (remainingSettingsFailures > 0) {
          remainingSettingsFailures -= 1;
          if (onSettingsWriteFailure) settings = parseSettingsState(onSettingsWriteFailure(settings));
          throw new Error("synthetic settings write failure");
        }
        settings = parseSettingsState(value);
        return settings;
      }
    },
    stateService: {
      async getOrInitialize() { return parseWorkspaceState(state); },
      async replaceForRestore(value) {
        calls.push("state");
        state = parseWorkspaceState(value);
        return state;
      }
    },
    runtimeService: {
      async getOrInitialize(ids) { return parseWorkspaceRuntime(currentRuntime, ids); },
      async save(value, ids) {
        calls.push("runtime");
        currentRuntime = parseWorkspaceRuntime(value, ids);
        return currentRuntime;
      }
    },
    storage: {
      async readJournal() {
        calls.push("journal:read");
        if (failJournalRead) throw new Error("synthetic journal read failure");
        return structuredClone(storedJournal);
      },
      async writeJournal(value) {
        calls.push(`journal:${value.phase}`);
        storedJournal = structuredClone(value);
      },
      async removeJournal() {
        calls.push("journal:remove");
        storedJournal = undefined;
      }
    }
  });
  return {
    service,
    calls,
    get documents() {
      return {
        settings: parseSettingsState(settings),
        workspaceState: parseWorkspaceState(state),
        runtime: structuredClone(currentRuntime)
      };
    },
    get journal() { return structuredClone(storedJournal); },
    setDocuments(value) {
      settings = parseSettingsState(value.settings);
      state = parseWorkspaceState(value.workspaceState);
      currentRuntime = parseWorkspaceRuntime(
        value.runtime,
        state.workspaces.map(({ id }) => id)
      );
    }
  };
}

test("the transfer journal retains the legacy local storage key", () => {
  assert.equal(SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY, "configurationSyncApplyJournal");
});

test("apply writes and verifies the journal before documents, then converges and removes it", async () => {
  const before = documents();
  const after = documents({
    size: "large",
    workspaceIds: ["ws-b"],
    assignments: [["tab-a", "ws-b"]]
  });
  const h = harness({ initial: before });
  let converged = 0;

  const report = await h.service.applyDocuments({
    journal: journal({ before, after, workspaceDefinitionsChanged: true }),
    convergeWindows: async () => { converged += 1; h.calls.push("converge"); }
  });

  assert.deepEqual(report, {
    workspaceDefinitionsChanged: true,
    removedWorkspaces: [{ sourceWorkspaceId: "ws-a", destinationWorkspaceId: "ws-b" }],
    reassignedTabCount: 1
  });
  assert.deepEqual(h.documents, after);
  assert.equal(converged, 1);
  assert.equal(h.journal, undefined);
  assert.ok(h.calls.indexOf("journal:applying") < h.calls.indexOf("runtime"));
  assert.ok(h.calls.indexOf("runtime") < h.calls.indexOf("state"));
  assert.ok(h.calls.indexOf("state") < h.calls.indexOf("settings"));
  assert.ok(h.calls.indexOf("journal:reconciling") < h.calls.indexOf("converge"));
  assert.ok(h.calls.indexOf("converge") < h.calls.lastIndexOf("journal:remove"));
});

test("a failed apply restores an applied settings document and clears the settled journal", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({ initial: before, settingsWriteFailures: 1 });

  await assert.rejects(
    h.service.applyDocuments({
      journal: journal({ before, after }),
      convergeWindows: async () => undefined
    }),
    /synthetic settings write failure/
  );

  assert.deepEqual(h.documents, before);
  assert.equal(h.journal, undefined);
});

test("a failed apply preserves a newer settings edit made while the write was running", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({
    initial: before,
    settingsWriteFailures: 1,
    onSettingsWriteFailure(current) {
      const newer = structuredClone(current);
      newer.appearance.mode = "firefox";
      return newer;
    }
  });

  await assert.rejects(
    h.service.applyDocuments({
      journal: journal({ before, after }),
      convergeWindows: async () => undefined
    }),
    /synthetic settings write failure/
  );

  assert.equal(h.documents.settings.appearance.mode, "firefox");
  assert.equal(h.documents.settings.sidebar.workspaceSize, "medium");
  assert.equal(h.journal, undefined);
});

test("startup recovery undoes only an interrupted document that still equals the write", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({ initial: after, initialJournal: journal({ before, after }) });

  const outcome = await h.service.recover({
    convergeWindows: async () => assert.fail("settings-only recovery must not converge windows")
  });

  assert.deepEqual(outcome, {
    source: "settings-backup",
    unreadable: false,
    phase: "applying",
    documents: { workspaceState: "unchanged", runtime: "unchanged", settings: "undone" },
    sections: ["sidebar"],
    convergenceFailed: false
  });
  assert.deepEqual(h.documents, before);
  assert.equal(h.journal, undefined);
  assert.equal(await h.service.recover({ convergeWindows: async () => undefined }), null);
});

test("startup recovery writes nothing when an interrupted write never landed", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({ initial: before, initialJournal: journal({ before, after }) });

  const outcome = await h.service.recover({ convergeWindows: async () => undefined });

  assert.deepEqual(outcome.documents, {
    workspaceState: "unchanged",
    runtime: "unchanged",
    settings: "not-applied"
  });
  assert.equal(h.calls.includes("settings"), false);
  assert.equal(h.journal, undefined);
});

test("a reconciling journal keeps written documents and attempts convergence", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({
    initial: after,
    initialJournal: journal({ before, after, phase: "reconciling" })
  });
  let converged = 0;

  const outcome = await h.service.recover({ convergeWindows: async () => { converged += 1; } });

  assert.equal(outcome.documents.settings, "kept");
  assert.equal(outcome.convergenceFailed, false);
  assert.equal(converged, 1);
  assert.deepEqual(h.documents, after);
  assert.equal(h.journal, undefined);
});

test("legacy journals are reported neutrally and newer live documents are kept", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const newer = documents();
  newer.settings.appearance.mode = "firefox";
  const h = harness({
    initial: newer,
    initialJournal: journal({ before, after, revisionId: "revision-legacy-remote" })
  });

  const outcome = await h.service.recover({ convergeWindows: async () => undefined });

  assert.equal(outcome.source, "legacy");
  assert.equal(outcome.documents.settings, "kept-newer");
  assert.equal(h.documents.settings.appearance.mode, "firefox");
  assert.equal(h.journal, undefined);
});

test("an unreadable journal is retired without touching documents", async () => {
  const initial = documents();
  const h = harness({ initial, initialJournal: { schemaVersion: 99 } });

  const outcome = await h.service.recover({ convergeWindows: async () => undefined });

  assert.deepEqual(outcome, {
    source: "unknown",
    unreadable: true,
    phase: null,
    documents: null,
    sections: [],
    convergenceFailed: false
  });
  assert.deepEqual(h.documents, initial);
  assert.equal(h.journal, undefined);
});

test("journal read failures propagate without retiring unknown recovery state", async () => {
  const before = documents();
  const h = harness({
    initial: before,
    initialJournal: journal({ before, after: documents({ size: "large" }) }),
    failJournalRead: true
  });

  await assert.rejects(
    h.service.recover({ convergeWindows: async () => undefined }),
    /synthetic journal read failure/
  );
  assert.notEqual(h.journal, undefined);
  assert.equal(h.calls.includes("journal:remove"), false);
});

test("a recovery write failure keeps the journal for an idempotent retry", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({
    initial: after,
    initialJournal: journal({ before, after }),
    settingsWriteFailures: 1
  });

  await assert.rejects(
    h.service.recover({ convergeWindows: async () => undefined }),
    /synthetic settings write failure/
  );
  assert.notEqual(h.journal, undefined);

  const outcome = await h.service.recover({ convergeWindows: async () => undefined });
  assert.equal(outcome.documents.settings, "undone");
  assert.deepEqual(h.documents, before);
  assert.equal(h.journal, undefined);
});

test("a convergence failure is reported after document recovery and still retires the journal", async () => {
  const before = documents();
  const after = documents({ size: "large" });
  const h = harness({
    initial: after,
    initialJournal: journal({ before, after, phase: "reconciling" })
  });

  const outcome = await h.service.recover({
    convergeWindows: async () => { throw new Error("synthetic convergence failure"); }
  });

  assert.equal(outcome.convergenceFailed, true);
  assert.equal(h.journal, undefined);
});

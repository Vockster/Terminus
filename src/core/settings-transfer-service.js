import {
  SettingsTransferError,
  parseSettingsTransferJournal
} from "../contracts/settings-transfer.js";
import { parseWorkspaceRuntime } from "../contracts/workspace-runtime.js";

export const SETTINGS_BACKUP_REVISION_PREFIX = "revision-settings-backup-";

const RESTORABLE_SETTINGS_SECTIONS = Object.freeze(["sidebar", "appearance", "navigation", "snapshots"]);

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function workspaceIdsOf(state) {
  return state.workspaces.map(({ id }) => id);
}

function decideDocument(phase, before, after, live) {
  if (same(before, after)) return "unchanged";
  if (phase === "reconciling") return "kept";
  if (same(live, after)) return "undone";
  return same(live, before) ? "not-applied" : "kept-newer";
}

function runtimeFitsDefinitions(runtime, state) {
  try {
    parseWorkspaceRuntime(runtime, workspaceIdsOf(state));
    return true;
  } catch {
    return false;
  }
}

function restoredWorkspaceDocuments(documents) {
  return documents.workspaceState === "undone" || documents.runtime === "undone";
}

function changedSettingsSections(before, after) {
  return RESTORABLE_SETTINGS_SECTIONS.filter((section) => !same(before[section], after[section]));
}

export class SettingsTransferService {
  #settingsService;
  #stateService;
  #runtimeService;
  #storage;

  constructor({ settingsService, stateService, runtimeService, storage }) {
    this.#settingsService = settingsService;
    this.#stateService = stateService;
    this.#runtimeService = runtimeService;
    this.#storage = storage;
  }

  async applyDocuments({ journal: rawJournal, convergeWindows }) {
    const journal = parseSettingsTransferJournal(rawJournal);
    const changes = {
      settings: !same(journal.before.settings, journal.after.settings),
      state: !same(journal.before.workspaceState, journal.after.workspaceState),
      runtime: !same(journal.before.runtime, journal.after.runtime)
    };
    await this.#writeJournal(journal);

    try {
      const targetWorkspaceIds = journal.after.workspaceState.workspaces.map(({ id }) => id);
      if (changes.runtime) await this.#runtimeService.save(journal.after.runtime, targetWorkspaceIds);
      if (changes.state) await this.#stateService.replaceForRestore(journal.after.workspaceState);
      const [verifiedRuntime, verifiedState] = await Promise.all([
        this.#runtimeService.getOrInitialize(targetWorkspaceIds),
        this.#stateService.getOrInitialize()
      ]);
      if (!same(verifiedRuntime, journal.after.runtime) || !same(verifiedState, journal.after.workspaceState)) {
        throw new Error("Workspace data could not be verified after writing.");
      }
      if (changes.settings) await this.#settingsService.replaceForRestore(journal.after.settings);
      const verifiedSettings = await this.#settingsService.getOrInitialize();
      if (!same(verifiedSettings, journal.after.settings)) {
        throw new Error("Settings could not be verified after writing.");
      }
      await this.#writeJournal({ ...journal, phase: "reconciling" });
      if (journal.report.workspaceDefinitionsChanged) await convergeWindows();
      await this.#storage.removeJournal();
      return journal.report;
    } catch (error) {
      let documents;
      try {
        documents = await this.#decideInterruptedDocuments(journal, "applying");
        await this.#storage.removeJournal();
      } catch {
        throw error;
      }
      if (restoredWorkspaceDocuments(documents)) {
        await convergeWindows().catch(() => undefined);
      }
      throw error;
    }
  }

  async recover({ convergeWindows }) {
    const rawJournal = await this.#storage.readJournal();
    if (rawJournal === undefined) return null;
    let journal;
    try {
      journal = parseSettingsTransferJournal(rawJournal);
    } catch (error) {
      if (!(error instanceof SettingsTransferError)) throw error;
      await this.#storage.removeJournal();
      return {
        source: "unknown",
        unreadable: true,
        phase: null,
        documents: null,
        sections: [],
        convergenceFailed: false
      };
    }
    const documents = await this.#decideInterruptedDocuments(journal, journal.phase);
    await this.#storage.removeJournal();
    let convergenceFailed = false;
    if (journal.phase === "reconciling" || restoredWorkspaceDocuments(documents)) {
      try {
        await convergeWindows();
      } catch {
        convergenceFailed = true;
      }
    }
    return {
      source: journal.revisionId.startsWith(SETTINGS_BACKUP_REVISION_PREFIX)
        ? "settings-backup"
        : "legacy",
      unreadable: false,
      phase: journal.phase,
      documents,
      sections: changedSettingsSections(journal.before.settings, journal.after.settings),
      convergenceFailed
    };
  }

  async #decideInterruptedDocuments(journal, phase) {
    const { before, after } = journal;
    const liveState = await this.#stateService.getOrInitialize();
    const knownWorkspaceIds = [...new Set([
      ...workspaceIdsOf(liveState),
      ...workspaceIdsOf(before.workspaceState),
      ...workspaceIdsOf(after.workspaceState)
    ])];
    const [liveSettings, liveRuntime] = await Promise.all([
      this.#settingsService.getOrInitialize(),
      this.#runtimeService.getOrInitialize(knownWorkspaceIds)
    ]);

    const stateDecision = decideDocument(phase, before.workspaceState, after.workspaceState, liveState);
    if (stateDecision === "undone") await this.#stateService.replaceForRestore(before.workspaceState);
    const finalState = stateDecision === "undone" ? before.workspaceState : liveState;

    let runtimeDecision = decideDocument(phase, before.runtime, after.runtime, liveRuntime);
    if (runtimeDecision === "undone" && !runtimeFitsDefinitions(before.runtime, finalState)) {
      runtimeDecision = "kept-newer";
    }
    if (runtimeDecision === "undone") {
      await this.#runtimeService.save(before.runtime, workspaceIdsOf(finalState));
    }

    const settingsDecision = decideDocument(phase, before.settings, after.settings, liveSettings);
    if (settingsDecision === "undone") await this.#settingsService.replaceForRestore(before.settings);
    return { workspaceState: stateDecision, runtime: runtimeDecision, settings: settingsDecision };
  }

  async #writeJournal(journal) {
    const parsed = parseSettingsTransferJournal(journal);
    await this.#storage.writeJournal(parsed);
    const verified = parseSettingsTransferJournal(await this.#storage.readJournal());
    if (!same(parsed, verified)) {
      throw new Error("The settings transfer journal could not be verified.");
    }
  }
}

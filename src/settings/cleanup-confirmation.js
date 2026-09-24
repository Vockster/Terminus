import { CLEANUP_PREVIEW_SNAPSHOT_KEYS } from "../contracts/snapshot-messages.js";
import {
  automaticRetentionRule,
  retentionRuleTightens
} from "../core/automatic-retention-policy.js";

const LIBRARY_LABELS = Object.freeze([
  ["sidebarSnapshots", "Sidebar Snapshot"],
  ["settingsBackups", "Settings Backup"],
  ["privateSnapshots", "Private Snapshot"]
]);

export function cleanupPreviewValues(snapshots) {
  return Object.fromEntries(CLEANUP_PREVIEW_SNAPSHOT_KEYS.map((key) => [key, snapshots[key]]));
}

export function cleanupImpactLines(impact) {
  return LIBRARY_LABELS
    .filter(([key]) => (impact[key] ?? 0) > 0)
    .map(([key, label]) => `${impact[key]} ${label}${impact[key] === 1 ? "" : "s"}`);
}

// A normal window cannot see private counts, so it can only say that
// private automatic saves may also be affected.
export function privateCleanupNoteApplies({ privateContext, privateAutomaticEnabled }) {
  return !privateContext && privateAutomaticEnabled === true;
}

// A normal window cannot count private automatic saves, so a change that would
// remove only those previews as zero and would otherwise be written in silence.
// It can still tell that the new rule keeps less than the old one, which is
// enough to ask first. Asking needs no count: the dialog says private saves may
// be affected rather than claiming a number it cannot see.
export function unseenPrivateCleanupApplies({
  privateContext,
  privateAutomaticEnabled,
  currentSnapshots,
  snapshots
}) {
  if (privateContext || privateAutomaticEnabled !== true || !currentSnapshots) {
    return false;
  }
  return retentionRuleTightens(
    automaticRetentionRule({ snapshots: currentSnapshots }),
    automaticRetentionRule({ snapshots })
  );
}

// Private counts are requested only from Settings in a private window; the
// background also withholds them from any other sender.
export async function previewCleanupImpact({ client, privateClient, snapshots, privateContext }) {
  const values = cleanupPreviewValues(snapshots);
  const [ordinary, privateHistory] = await Promise.all([
    client.previewCleanup(values),
    privateContext ? privateClient.previewCleanup(values) : { privateSnapshots: null }
  ]);
  const impact = {
    sidebarSnapshots: ordinary.sidebarSnapshots,
    settingsBackups: ordinary.settingsBackups,
    privateSnapshots: privateHistory.privateSnapshots
  };
  return {
    ...impact,
    total: impact.sidebarSnapshots + impact.settingsBackups + (impact.privateSnapshots ?? 0)
  };
}

// Resolves true when the proposed cleanup values may be written: nothing
// existing would be removed, or the user chose Remove. A failed preview
// rejects so the caller writes nothing.
export function createCleanupConfirmation({ client, privateClient, dialog }) {
  return async function confirmCleanupImpact({
    snapshots,
    currentSnapshots = null,
    privateContext,
    privateAutomaticEnabled
  }) {
    const impact = await previewCleanupImpact({ client, privateClient, snapshots, privateContext });
    const unseenPrivate = unseenPrivateCleanupApplies({
      privateContext,
      privateAutomaticEnabled,
      currentSnapshots,
      snapshots
    });
    if (impact.total === 0 && !unseenPrivate) {
      return true;
    }
    return dialog.ask({
      lines: cleanupImpactLines(impact),
      privateNote: unseenPrivate ||
        privateCleanupNoteApplies({ privateContext, privateAutomaticEnabled })
    });
  };
}

// Wording for the case a normal window cannot count, kept beside the dialog
// that shows it rather than in the markup, which states the counted case.
const UNCOUNTED_PRIVATE_NOTE =
  "This may also remove Private Snapshots. A normal window cannot count them.";
const COUNTED_PRIVATE_NOTE = "Private Snapshots may also be removed.";

export function createCleanupDialog(root = document) {
  const dialog = root.querySelector("#snapshot-cleanup-dialog");
  const form = root.querySelector("#snapshot-cleanup-form");
  const intro = root.querySelector("#snapshot-cleanup-intro");
  const counts = root.querySelector("#snapshot-cleanup-counts");
  const privateNote = root.querySelector("#snapshot-cleanup-private-note");
  const cancel = root.querySelector("#snapshot-cleanup-cancel");
  let pending = null;

  function settle(confirmed) {
    const resolve = pending;
    pending = null;
    if (dialog.open) {
      dialog.close();
    }
    resolve?.(confirmed);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    settle(true);
  });
  cancel.addEventListener("click", () => settle(false));
  // Escape closes the dialog without choosing Remove.
  dialog.addEventListener("close", () => settle(false));

  return Object.freeze({
    ask({ lines, privateNote: showPrivateNote }) {
      settle(false);
      counts.replaceChildren(...lines.map((line) => {
        const item = root.createElement("li");
        item.textContent = line;
        return item;
      }));
      // With nothing counted, the intro would head an empty list and the note
      // is the whole reason the dialog opened.
      intro.hidden = lines.length === 0;
      privateNote.textContent = lines.length === 0
        ? UNCOUNTED_PRIVATE_NOTE
        : COUNTED_PRIVATE_NOTE;
      privateNote.hidden = !showPrivateNote;
      dialog.showModal();
      return new Promise((resolve) => {
        pending = resolve;
      });
    }
  });
}

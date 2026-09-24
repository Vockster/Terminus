import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  cleanupImpactLines,
  cleanupPreviewValues,
  createCleanupConfirmation,
  createCleanupDialog
} from "../../src/settings/cleanup-confirmation.js";

function clients({ ordinary = { sidebarSnapshots: 0, settingsBackups: 0 }, privateCount = 0, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async previewCleanup(values) {
        calls.push(["ordinary", values]);
        if (fail) throw new Error("Preview unavailable.");
        return ordinary;
      }
    },
    privateClient: {
      async previewCleanup(values) {
        calls.push(["private", values]);
        return { privateSnapshots: privateCount };
      }
    }
  };
}

function dialogDouble(answer) {
  const asked = [];
  return {
    asked,
    async ask(request) {
      asked.push(request);
      return answer;
    }
  };
}

const snapshots = createDefaultSettingsState().snapshots;

// Schema 31 left one cleanup value, so a preview proposes exactly the maximum
// and never a whole settings document.
test("only the cleanup maximum is sent for a preview", () => {
  assert.deepEqual(cleanupPreviewValues({ ...snapshots, automaticEnabled: true, retentionCount: 7 }), {
    retentionCount: 7
  });
});

test("nothing to remove skips the dialog", async () => {
  const doubles = clients();
  const dialog = dialogDouble(false);
  const confirm = createCleanupConfirmation({ ...doubles, dialog });
  assert.equal(await confirm({ snapshots, privateContext: false, privateAutomaticEnabled: false }), true);
  assert.deepEqual(dialog.asked, []);
  assert.deepEqual(doubles.calls.map(([kind]) => kind), ["ordinary"]);
});

// A normal window never receives private counts, so a rule that reaches only
// private automatic saves previews as zero. Writing it unasked would delete
// saves the user still has, which is the one thing confirmation exists to stop.
test("a normal window asks before a tighter rule reaches private saves it cannot count", async () => {
  const doubles = clients();
  const dialog = dialogDouble(false);
  const confirm = createCleanupConfirmation({ ...doubles, dialog });
  const request = {
    snapshots: { ...snapshots, retentionCount: snapshots.retentionCount - 1 },
    currentSnapshots: snapshots,
    privateContext: false,
    privateAutomaticEnabled: true
  };

  assert.equal(await confirm(request), false);
  assert.deepEqual(dialog.asked, [{ lines: [], privateNote: true }]);
  // No private preview was requested: the count is not ours to see.
  assert.deepEqual(doubles.calls.map(([kind]) => kind), ["ordinary"]);
});

test("a rule that keeps more never asks, and neither does one with private saves off", async () => {
  const looser = dialogDouble(false);
  assert.equal(
    await createCleanupConfirmation({ ...clients(), dialog: looser })({
      snapshots: { ...snapshots, retentionCount: snapshots.retentionCount + 50 },
      currentSnapshots: snapshots,
      privateContext: false,
      privateAutomaticEnabled: true
    }),
    true
  );
  assert.deepEqual(looser.asked, []);

  const disabled = dialogDouble(false);
  assert.equal(
    await createCleanupConfirmation({ ...clients(), dialog: disabled })({
      snapshots: { ...snapshots, retentionCount: 1 },
      currentSnapshots: snapshots,
      privateContext: false,
      privateAutomaticEnabled: false
    }),
    true
  );
  assert.deepEqual(disabled.asked, []);
});

// A normal window cannot count private saves, so a tighter maximum still has
// to ask there, stating only that private saves may be removed.
test("lowering the maximum reaches private saves too", async () => {
  for (const patch of [
    { retentionCount: 10 },
    { retentionCount: 1 }
  ]) {
    const dialog = dialogDouble(true);
    const current = snapshots;
    assert.equal(
      await createCleanupConfirmation({ ...clients(), dialog })({
        snapshots: { ...current, ...patch },
        currentSnapshots: current,
        privateContext: false,
        privateAutomaticEnabled: true
      }),
      true
    );
    assert.deepEqual(dialog.asked, [{ lines: [], privateNote: true }]);
  }
});

// In a private window the counts are available, so the dialog states them and
// the uncounted path must not trigger.
test("a private window still previews exact private counts", async () => {
  const doubles = clients({ privateCount: 4 });
  const dialog = dialogDouble(true);
  assert.equal(
    await createCleanupConfirmation({ ...doubles, dialog })({
      snapshots: { ...snapshots, retentionCount: 1 },
      currentSnapshots: snapshots,
      privateContext: true,
      privateAutomaticEnabled: true
    }),
    true
  );
  assert.deepEqual(dialog.asked, [{ lines: ["4 Private Snapshots"], privateNote: false }]);
  assert.deepEqual(doubles.calls.map(([kind]) => kind), ["ordinary", "private"]);
});

test("the dialog lists each non-zero library and resolves with the user's choice", async () => {
  const doubles = clients({ ordinary: { sidebarSnapshots: 12, settingsBackups: 0 } });
  const remove = dialogDouble(true);
  assert.equal(
    await createCleanupConfirmation({ ...doubles, dialog: remove })({
      snapshots,
      privateContext: false,
      privateAutomaticEnabled: false
    }),
    true
  );
  assert.deepEqual(remove.asked, [{ lines: ["12 Sidebar Snapshots"], privateNote: false }]);

  const cancel = dialogDouble(false);
  assert.equal(
    await createCleanupConfirmation({ ...doubles, dialog: cancel })({
      snapshots,
      privateContext: false,
      privateAutomaticEnabled: false
    }),
    false
  );
  assert.deepEqual(
    cleanupImpactLines({ sidebarSnapshots: 1, settingsBackups: 3, privateSnapshots: 4 }),
    ["1 Sidebar Snapshot", "3 Settings Backups", "4 Private Snapshots"]
  );
});

test("a normal window never asks for private counts and shows only the private note", async () => {
  const doubles = clients({ ordinary: { sidebarSnapshots: 0, settingsBackups: 3 }, privateCount: 9 });
  const dialog = dialogDouble(true);
  await createCleanupConfirmation({ ...doubles, dialog })({
    snapshots,
    privateContext: false,
    privateAutomaticEnabled: true
  });
  assert.deepEqual(doubles.calls.map(([kind]) => kind), ["ordinary"]);
  assert.deepEqual(dialog.asked, [{ lines: ["3 Settings Backups"], privateNote: true }]);
});

test("a private window counts private saves and needs no note", async () => {
  const doubles = clients({ privateCount: 4 });
  const dialog = dialogDouble(true);
  await createCleanupConfirmation({ ...doubles, dialog })({
    snapshots,
    privateContext: true,
    privateAutomaticEnabled: true
  });
  assert.deepEqual(doubles.calls.map(([kind]) => kind), ["ordinary", "private"]);
  assert.deepEqual(dialog.asked, [{ lines: ["4 Private Snapshots"], privateNote: false }]);
});

test("a failed preview rejects so the caller writes nothing", async () => {
  const doubles = clients({ fail: true });
  const dialog = dialogDouble(true);
  await assert.rejects(
    createCleanupConfirmation({ ...doubles, dialog })({
      snapshots,
      privateContext: false,
      privateAutomaticEnabled: false
    }),
    /Preview unavailable/
  );
  assert.deepEqual(dialog.asked, []);
});

function fakeElement() {
  const listeners = new Map();
  return {
    hidden: false,
    children: [],
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ preventDefault() {}, ...event });
      }
    },
    replaceChildren(...children) {
      this.children = children;
    }
  };
}

function fakeDocument() {
  const dialog = fakeElement();
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatch("close");
  };
  const elements = {
    "#snapshot-cleanup-dialog": dialog,
    "#snapshot-cleanup-form": fakeElement(),
    "#snapshot-cleanup-intro": fakeElement(),
    "#snapshot-cleanup-counts": fakeElement(),
    "#snapshot-cleanup-private-note": fakeElement(),
    "#snapshot-cleanup-cancel": fakeElement()
  };
  return {
    elements,
    querySelector: (selector) => elements[selector],
    createElement: () => ({ textContent: "" })
  };
}

test("the dialog resolves Remove on submit and Cancel on the button or Escape", async () => {
  const root = fakeDocument();
  const dialog = createCleanupDialog(root);

  const removed = dialog.ask({ lines: ["12 Sidebar Snapshots", "3 Settings Backups"], privateNote: true });
  assert.equal(root.elements["#snapshot-cleanup-dialog"].open, true);
  assert.deepEqual(
    root.elements["#snapshot-cleanup-counts"].children.map(({ textContent }) => textContent),
    ["12 Sidebar Snapshots", "3 Settings Backups"]
  );
  assert.equal(root.elements["#snapshot-cleanup-private-note"].hidden, false);
  root.elements["#snapshot-cleanup-form"].dispatch("submit");
  assert.equal(await removed, true);
  assert.equal(root.elements["#snapshot-cleanup-dialog"].open, false);

  const cancelled = dialog.ask({ lines: ["1 Settings Backup"], privateNote: false });
  assert.equal(root.elements["#snapshot-cleanup-private-note"].hidden, true);
  root.elements["#snapshot-cleanup-cancel"].dispatch("click");
  assert.equal(await cancelled, false);

  const escaped = dialog.ask({ lines: ["1 Settings Backup"], privateNote: false });
  root.elements["#snapshot-cleanup-dialog"].close();
  assert.equal(await escaped, false);
});

// A normal window cannot count private saves, so the dialog can open with the
// note as its only content. The intro must not head an empty list, and the note
// must not claim a number.
test("the dialog drops its counted intro when only private saves may be removed", async () => {
  const root = fakeDocument();
  const dialog = createCleanupDialog(root);

  const pending = dialog.ask({ lines: [], privateNote: true });
  assert.equal(root.elements["#snapshot-cleanup-intro"].hidden, true);
  assert.deepEqual(root.elements["#snapshot-cleanup-counts"].children, []);
  assert.equal(root.elements["#snapshot-cleanup-private-note"].hidden, false);
  assert.match(
    root.elements["#snapshot-cleanup-private-note"].textContent,
    /cannot count them/
  );
  root.elements["#snapshot-cleanup-cancel"].dispatch("click");
  assert.equal(await pending, false);

  const counted = dialog.ask({ lines: ["2 Sidebar Snapshots"], privateNote: true });
  assert.equal(root.elements["#snapshot-cleanup-intro"].hidden, false);
  assert.match(
    root.elements["#snapshot-cleanup-private-note"].textContent,
    /may also be removed/
  );
  root.elements["#snapshot-cleanup-cancel"].dispatch("click");
  assert.equal(await counted, false);
});

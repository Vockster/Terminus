import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY,
  PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY,
  PRIVATE_RECOVERY_STORAGE_KEY,
  PRIVATE_RESTORE_JOURNAL_STORAGE_KEY,
  PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX
} from "../../src/contracts/private-snapshots.js";
import { SETTINGS_STATE_STORAGE_KEY } from "../../src/contracts/settings-state.js";
import {
  createPrivacyPanel,
  hasPrivacyPanelStorageChange
} from "../../src/settings/privacy-panel.js";

function createNode(nodes) {
  const listeners = new Map();
  return {
    checked: false,
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    close() {},
    querySelector(selector) {
      return nodes.get(selector) ?? null;
    },
    showModal() {}
  };
}

function createDocumentHarness() {
  const nodes = new Map();
  for (const selector of [
    "#privacy-panel",
    "#private-access-status",
    "#private-access-help",
    "#private-keep-tabs",
    "#private-recovery-summary",
    "#private-recovery-pill",
    "#private-clear-recovery",
    "#private-status",
    "#private-disable-recovery-dialog",
    "#private-disable-recovery-form",
    "#private-disable-recovery-cancel",
    "#private-clear-recovery-dialog",
    "#private-clear-recovery-form",
    "#private-clear-recovery-cancel"
  ]) {
    nodes.set(selector, createNode(nodes));
  }
  return {
    querySelector(selector) {
      return nodes.get(selector) ?? null;
    }
  };
}

function overviewFixture() {
  return {
    keepPrivateTabsBetweenSessions: false,
    privateAccessAllowed: true,
    recovery: null
  };
}

function flushScheduledRefresh() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("privacy storage routing recognizes every owned key family and ignores unrelated changes", () => {
  for (const key of [
    SETTINGS_STATE_STORAGE_KEY,
    PRIVATE_RECOVERY_STORAGE_KEY,
    PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY,
    PRIVATE_RESTORE_JOURNAL_STORAGE_KEY,
    PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY,
    `${PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX}snapshot-1`
  ]) {
    assert.equal(hasPrivacyPanelStorageChange({ [key]: {} }), true, key);
  }
  assert.equal(hasPrivacyPanelStorageChange({ workspaceState: {} }), false);
  assert.equal(hasPrivacyPanelStorageChange(null), false);
});

test("privacy refreshes coalesce, defer while inactive, and stop after teardown", async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = createDocumentHarness();
  t.after(() => {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  });

  let overviewCalls = 0;
  const panel = createPrivacyPanel({
    client: {
      async overview() {
        overviewCalls += 1;
        return overviewFixture();
      }
    }
  });

  panel.notifyLocalStorageChanged({ [PRIVATE_RECOVERY_STORAGE_KEY]: {} });
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 0);

  panel.setActive(true);
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 1);

  panel.notifyLocalStorageChanged({
    [PRIVATE_RECOVERY_STORAGE_KEY]: {},
    [PRIVATE_RESTORE_JOURNAL_STORAGE_KEY]: {}
  });
  panel.notifyLocalStorageChanged({
    [`${PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX}snapshot-2`]: {}
  });
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 2);

  panel.notifyLocalStorageChanged({ unrelated: {} });
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 2);

  panel.setActive(false);
  panel.notifyLocalStorageChanged({ [SETTINGS_STATE_STORAGE_KEY]: {} });
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 2);
  panel.setActive(true);
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 3);

  panel.destroy();
  panel.notifyLocalStorageChanged({ [PRIVATE_RECOVERY_STORAGE_KEY]: {} });
  panel.setActive(true);
  await panel.refresh();
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 3);
});

test("privacy changes during an in-flight refresh request one follow-up", async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = createDocumentHarness();
  t.after(() => {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  });

  let overviewCalls = 0;
  let resolveFirstOverview;
  const panel = createPrivacyPanel({
    client: {
      overview() {
        overviewCalls += 1;
        if (overviewCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstOverview = () => resolve(overviewFixture());
          });
        }
        return Promise.resolve(overviewFixture());
      }
    }
  });

  panel.setActive(true);
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 1);
  panel.notifyLocalStorageChanged({ [PRIVATE_RECOVERY_STORAGE_KEY]: {} });
  panel.notifyLocalStorageChanged({ [PRIVATE_RESTORE_JOURNAL_STORAGE_KEY]: {} });
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 1);

  resolveFirstOverview();
  await flushScheduledRefresh();
  await flushScheduledRefresh();
  assert.equal(overviewCalls, 2);
  panel.destroy();
});

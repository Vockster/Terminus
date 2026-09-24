import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import { createSidebarPanel } from "../../src/settings/sidebar-panel.js";

class FakeControl {
  constructor({ id = "", name = "", value = "", checked = false } = {}) {
    this.id = id;
    this.name = name;
    this.value = value;
    this.checked = checked;
    this.disabled = false;
    this.listeners = new Map();
    this.attributes = new Map();
    this.row = {
      setAttribute: (name, value) => this.attributes.set(name, value)
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this });
  }

  closest(selector) {
    return selector === ".setting-row" ? this.row : null;
  }
}

function mergeSettings(settings, patch) {
  return {
    ...settings,
    ...(patch.sidebar ? { sidebar: { ...settings.sidebar, ...patch.sidebar } } : {}),
    ...(patch.appearance ? { appearance: { ...settings.appearance, ...patch.appearance } } : {})
  };
}

function panelHarness({ failUpdate = false } = {}) {
  const workspaceSizes = ["small", "medium", "large", "massive"].map((value) =>
    new FakeControl({ name: "workspaceSize", value })
  );
  const tabSizes = ["small", "medium", "large", "massive"].map((value) =>
    new FakeControl({ name: "tabSize", value })
  );
  const contentModes = ["full", "icons"].map((value) =>
    new FakeControl({ name: "content-mode", value })
  );
  const controls = new Map([
    ["#workspace-reordering-locked", new FakeControl({ name: "workspaceReorderingLocked" })],
    ["#show-add-workspace-button", new FakeControl({ name: "showAddWorkspaceButton" })],
    ["#show-action-buttons", new FakeControl({ name: "showActionButtons" })],
    ["#hide-unloaded-tabs-from-firefox", new FakeControl({ name: "hideUnloadedTabsFromFirefox" })],
    ["#show-tab-search", new FakeControl({ name: "showTabSearch" })],
    ["#tab-search-position", new FakeControl({ name: "tabSearchPosition", value: "top" })],
    ["#reset-sidebar", new FakeControl({ id: "reset-sidebar" })]
  ]);
  const panel = {
    querySelectorAll(selector) {
      if (selector === 'input[name="workspaceSize"]') return workspaceSizes;
      if (selector === 'input[name="tabSize"]') return tabSizes;
      if (selector === 'input[name="content-mode"]') return contentModes;
      return [];
    },
    querySelector(selector) {
      return controls.get(selector) ?? null;
    }
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      return selector === "#sidebar-panel" ? panel : null;
    }
  };
  let settings = createDefaultSettingsState();
  const updates = [];
  let getCount = 0;
  const client = {
    async update(patch) {
      updates.push(structuredClone(patch));
      if (failUpdate) throw new Error("synthetic save failure");
      settings = mergeSettings(settings, patch);
      return structuredClone(settings);
    },
    async get() {
      getCount += 1;
      return structuredClone(settings);
    },
    async resetSection() {
      settings = createDefaultSettingsState();
      return structuredClone(settings);
    }
  };
  const statuses = [];
  const view = createSidebarPanel({
    client,
    setStatus: (...args) => statuses.push(args),
    saveDelayMs: 5
  });
  view.apply(settings);
  return {
    workspaceSizes,
    tabSizes,
    contentModes,
    controls,
    updates,
    statuses,
    view,
    getCount: () => getCount,
    restoreDocument() {
      view.destroy();
      globalThis.document = previousDocument;
    }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("sidebar saves retain every pending field across debounce and immediate controls", async (t) => {
  await t.test("two debounced choices are sent together", async () => {
    const harness = panelHarness();
    try {
      const workspace = harness.workspaceSizes.find(({ value }) => value === "massive");
      const tab = harness.tabSizes.find(({ value }) => value === "small");
      workspace.checked = true;
      workspace.dispatch("change");
      tab.checked = true;
      tab.dispatch("change");
      await settle();

      assert.deepEqual(harness.updates, [{
        sidebar: { workspaceSize: "massive", tabSize: "small" }
      }]);
    } finally {
      harness.restoreDocument();
    }
  });

  await t.test("an immediate checkbox flushes an earlier debounced choice", async () => {
    const harness = panelHarness();
    try {
      const workspace = harness.workspaceSizes.find(({ value }) => value === "large");
      const actionButtons = harness.controls.get("#show-action-buttons");
      workspace.checked = true;
      workspace.dispatch("change");
      actionButtons.checked = false;
      actionButtons.dispatch("change");
      await settle();

      assert.deepEqual(harness.updates, [{
        sidebar: { workspaceSize: "large", showActionButtons: false }
      }]);
    } finally {
      harness.restoreDocument();
    }
  });

  await t.test("content mode and a pending sidebar choice share one update", async () => {
    const harness = panelHarness();
    try {
      const position = harness.controls.get("#tab-search-position");
      const icons = harness.contentModes.find(({ value }) => value === "icons");
      position.value = "bottom";
      position.dispatch("change");
      icons.checked = true;
      icons.dispatch("change");
      await settle();

      assert.deepEqual(harness.updates, [{
        appearance: { contentMode: "icons" },
        sidebar: { tabSearchPosition: "bottom" }
      }]);
    } finally {
      harness.restoreDocument();
    }
  });

  await t.test("a failed save re-applies confirmed settings", async () => {
    const harness = panelHarness({ failUpdate: true });
    try {
      const workspace = harness.workspaceSizes.find(({ value }) => value === "large");
      workspace.checked = true;
      workspace.dispatch("change");
      await settle();

      assert.equal(harness.getCount(), 1);
      assert.equal(workspace.checked, false);
      assert.equal(
        harness.workspaceSizes.find(({ value }) => value === "medium").checked,
        true
      );
      assert.deepEqual(harness.statuses.at(-1), ["synthetic save failure", "error"]);
    } finally {
      harness.restoreDocument();
    }
  });
});

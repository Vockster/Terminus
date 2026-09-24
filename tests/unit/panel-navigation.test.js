import test from "node:test";
import assert from "node:assert/strict";

import { initializePanelNavigation } from "../../src/settings/panel-navigation.js";

class ElementDouble extends EventTarget {
  constructor(properties = {}) {
    super();
    Object.assign(this, properties);
    this.attributes = {};
    this.focused = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  focus() {
    this.focused = true;
  }
}

test("Settings navigation applies the saved panel once and persists only enabled user choices", async () => {
  const panelIds = ["sidebar", "appearance", "workspaces", "snapshots", "snapshot-viewer", "storage"];
  const buttons = panelIds.map(
    (panel) => new ElementDouble({ dataset: { panel } })
  );
  const panels = panelIds.map(
    (panelContent) => new ElementDouble({ dataset: { panelContent }, hidden: panelContent !== "sidebar" })
  );
  const select = new ElementDouble({ value: "sidebar" });
  const remember = new ElementDouble({ checked: true });
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === "[data-open-panel]") return [];
      return selector === "[data-panel]" ? buttons : panels;
    },
    querySelector(selector) {
      return selector === "#settings-section" ? select : remember;
    }
  };
  const saved = [];
  try {
    const navigation = initializePanelNavigation({
      saveNavigation: async (patch) => { saved.push(patch); }
    });
    navigation.apply({ rememberLastPanel: true, lastPanel: "snapshots" });
    assert.equal(select.value, "snapshots");
    assert.equal(panels.find(({ dataset }) => dataset.panelContent === "snapshots").hidden, false);

    navigation.apply({ rememberLastPanel: false, lastPanel: "storage" });
    assert.equal(select.value, "snapshots");
    assert.equal(remember.checked, false);
    select.value = "appearance";
    select.dispatchEvent(new Event("change"));
    await Promise.resolve();
    assert.deepEqual(saved, []);

    remember.checked = true;
    remember.dispatchEvent(new Event("change"));
    await Promise.resolve();
    assert.deepEqual(saved, [{ rememberLastPanel: true, lastPanel: "appearance" }]);
    buttons.at(-1).dispatchEvent(new Event("click"));
    await Promise.resolve();
    assert.deepEqual(saved.at(-1), { lastPanel: "storage" });
  } finally {
    globalThis.document = originalDocument;
  }
});

test("an in-page open-panel button selects, focuses, and remembers its Settings tab", async () => {
  const panelIds = ["sidebar", "storage", "overview"];
  const buttons = panelIds.map((panel) => new ElementDouble({ dataset: { panel } }));
  const panels = panelIds.map(
    (panelContent) => new ElementDouble({ dataset: { panelContent }, hidden: panelContent !== "sidebar" })
  );
  const opener = new ElementDouble({ dataset: { openPanel: "storage" } });
  const select = new ElementDouble({ value: "sidebar" });
  const remember = new ElementDouble({ checked: true });
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === "[data-open-panel]") return [opener];
      return selector === "[data-panel]" ? buttons : panels;
    },
    querySelector(selector) {
      return selector === "#settings-section" ? select : remember;
    }
  };
  const saved = [];
  try {
    const navigation = initializePanelNavigation({
      saveNavigation: async (patch) => { saved.push(patch); }
    });
    navigation.apply({ rememberLastPanel: true, lastPanel: "overview" });
    assert.equal(select.value, "overview");
    opener.dispatchEvent(new Event("click"));
    await Promise.resolve();
    assert.equal(select.value, "storage");
    assert.equal(panels.find(({ dataset }) => dataset.panelContent === "storage").hidden, false);
    assert.equal(panels.find(({ dataset }) => dataset.panelContent === "overview").hidden, true);
    assert.equal(buttons.find(({ dataset }) => dataset.panel === "storage").focused, true);
    assert.deepEqual(saved, [{ lastPanel: "storage" }]);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("Settings panel changes remain usable when persistence fails", async () => {
  const button = new ElementDouble({ dataset: { panel: "sidebar" } });
  const panel = new ElementDouble({ dataset: { panelContent: "sidebar" }, hidden: false });
  const select = new ElementDouble({ value: "sidebar" });
  const remember = new ElementDouble({ checked: true });
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === "[data-open-panel]") return [];
      return selector === "[data-panel]" ? [button] : [panel];
    },
    querySelector(selector) { return selector === "#settings-section" ? select : remember; }
  };
  const failures = [];
  try {
    const navigation = initializePanelNavigation({
      saveNavigation: async () => { throw new Error("synthetic save failure"); },
      reportError: (error) => failures.push(error.message)
    });
    navigation.apply({ rememberLastPanel: true, lastPanel: "sidebar" });
    button.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(panel.hidden, false);
    assert.deepEqual(failures, ["synthetic save failure"]);
  } finally {
    globalThis.document = originalDocument;
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  createMiddleClickUnloadController,
  createUnloadTargetRouter,
  resolveUnloadTarget
} from "../../src/sidebar/middle-click-unload.js";

const ID_FIELDS = Object.freeze({ tab: "tabId", workspace: "workspaceId", group: "groupId" });

class FakeDocument {
  #listeners = new Map();

  addEventListener(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatch(event) {
    for (const listener of [...(this.#listeners.get(event.type) ?? [])]) listener(event);
  }

  count(type) {
    return this.#listeners.get(type)?.size ?? 0;
  }
}

class FakeElement {
  constructor(kind = null, id = "one", { ignored = false, disabled = false } = {}) {
    this.dataset = {};
    if (kind) {
      this.dataset.unloadTarget = kind;
      this.dataset[ID_FIELDS[kind]] = id;
    }
    this.ignored = ignored;
    this.disabled = disabled;
    this.isConnected = true;
    this.hidden = false;
  }

  closest(selector) {
    if (selector === "[data-unload-target]") return this.dataset.unloadTarget ? this : null;
    if (selector === "[hidden], [aria-hidden='true']") return null;
    if (selector.includes("input") || selector.includes("dialog")) return this.ignored ? this : null;
    return null;
  }

  matches(selector) {
    return selector === ":disabled, [aria-disabled='true']" ? this.disabled : false;
  }
}

function pointerEvent(type, target, values = {}) {
  return {
    type,
    target,
    button: 1,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    composedPath: () => [target],
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    ...values
  };
}

function createHarness({ blocked = () => false, now = () => 0, onUnloadTarget = null } = {}) {
  const documentElement = new FakeDocument();
  const calls = [];
  const controller = createMiddleClickUnloadController({
    onUnloadTarget: (details) => {
      calls.push(details);
      return onUnloadTarget?.(details);
    },
    isBlocked: blocked,
    documentElement,
    now
  });
  return { controller, documentElement, calls };
}

function click(harness, target, values = {}) {
  const down = pointerEvent("pointerdown", target, values);
  const up = pointerEvent("pointerup", target, values);
  harness.documentElement.dispatch(down);
  harness.documentElement.dispatch(up);
  return { down, up };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("middle mouse unloads on pointerup and suppresses the following auxclick", async () => {
  const harness = createHarness();
  const tab = new FakeElement("tab", "tab-one");
  const down = pointerEvent("pointerdown", tab);
  harness.documentElement.dispatch(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(harness.calls.length, 0);

  const up = pointerEvent("pointerup", tab);
  harness.documentElement.dispatch(up);
  await flush();
  assert.equal(up.defaultPrevented, true);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].kind, "tab");
  assert.equal(harness.calls[0].target, tab);
  assert.equal(harness.calls[0].event, up);

  const auxclick = pointerEvent("auxclick", tab);
  harness.documentElement.dispatch(auxclick);
  await flush();
  assert.equal(auxclick.defaultPrevented, true);
  assert.equal(harness.calls.length, 1);
});

test("auxclick unloads once when Firefox reports no pointerup", async () => {
  const harness = createHarness();
  const group = new FakeElement("group", "fallback");
  harness.documentElement.dispatch(pointerEvent("pointerdown", group));
  harness.documentElement.dispatch(pointerEvent("auxclick", group));
  harness.documentElement.dispatch(pointerEvent("auxclick", group));
  await flush();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].target, group);
});

test("middle mouse unloads tabs, group headers, and workspaces alike", async () => {
  for (const kind of ["tab", "group", "workspace"]) {
    const harness = createHarness();
    const target = new FakeElement(kind, `${kind}-target`);
    click(harness, target);
    await flush();
    assert.equal(harness.calls.length, 1, kind);
    assert.equal(harness.calls[0].kind, kind, kind);
    assert.equal(harness.calls[0].target, target, kind);
  }
});

test("other buttons and modified middle clicks are left to Firefox", async () => {
  const harness = createHarness();
  const tab = new FakeElement("tab", "untouched");
  const presses = [
    { button: 0 },
    { button: 2 },
    { button: 3 },
    { button: 4 },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true }
  ].map((values) => click(harness, tab, values));
  await flush();
  assert.equal(harness.calls.length, 0);
  for (const { down, up } of presses) {
    assert.equal(down.defaultPrevented, undefined);
    assert.equal(up.defaultPrevented, undefined);
  }
});

test("a press and release on different targets does not unload", async () => {
  const harness = createHarness();
  harness.documentElement.dispatch(pointerEvent("pointerdown", new FakeElement("group", "first")));
  harness.documentElement.dispatch(pointerEvent("pointerup", new FakeElement("group", "second")));
  harness.documentElement.dispatch(pointerEvent("pointerdown", new FakeElement("tab", "same-id")));
  harness.documentElement.dispatch(pointerEvent("pointerup", new FakeElement("workspace", "same-id")));
  await flush();
  assert.equal(harness.calls.length, 0);
});

test("a press held longer than a second does not unload on release", async () => {
  let time = 1_000;
  const harness = createHarness({ now: () => time });
  const tab = new FakeElement("tab", "held");
  harness.documentElement.dispatch(pointerEvent("pointerdown", tab));
  time += 1_001;
  harness.documentElement.dispatch(pointerEvent("pointerup", tab));
  await flush();
  assert.equal(harness.calls.length, 0);
});

test("controls, disabled targets, blocked UI, and in-flight unloads never unload", async () => {
  let blocked = false;
  let finish;
  const harness = createHarness({
    blocked: () => blocked,
    onUnloadTarget: () => new Promise((resolve) => { finish = resolve; })
  });
  const ignored = new FakeElement("tab", "menu-button", { ignored: true });
  const ignoredPress = click(harness, ignored);
  assert.equal(ignoredPress.down.defaultPrevented, undefined);
  assert.equal(resolveUnloadTarget(pointerEvent("pointerdown", ignored)), null);
  click(harness, new FakeElement("tab", "disabled", { disabled: true }));
  const disconnected = new FakeElement("tab", "gone");
  disconnected.isConnected = false;
  click(harness, disconnected);
  click(harness, new FakeElement());

  blocked = true;
  const tab = new FakeElement("tab", "blocked");
  click(harness, tab);
  await flush();
  assert.equal(harness.calls.length, 0);

  blocked = false;
  click(harness, tab);
  await flush();
  assert.equal(harness.calls.length, 1);
  click(harness, tab);
  await flush();
  assert.equal(harness.calls.length, 1);
  finish();
  await flush();
  click(harness, tab);
  await flush();
  assert.equal(harness.calls.length, 2);
});

test("a failed unload releases the lock for the next click", async () => {
  const harness = createHarness({ onUnloadTarget: () => Promise.reject(new Error("unload failed")) });
  const tab = new FakeElement("tab", "retry");
  click(harness, tab);
  await flush();
  click(harness, tab);
  await flush();
  assert.equal(harness.calls.length, 2);
});

test("the unload router sends tabs, groups, and known workspaces to their owners", async () => {
  const routed = [];
  const router = createUnloadTargetRouter({
    unloadTab: (target) => { routed.push(["tab", target.dataset.tabId]); return Promise.resolve("tab"); },
    unloadGroup: (target) => { routed.push(["group", target.dataset.groupId]); return Promise.resolve("group"); },
    unloadWorkspace: (workspaceId) => { routed.push(["workspace", workspaceId]); return Promise.resolve("workspace"); },
    hasWorkspace: (workspaceId) => workspaceId === "ws-known"
  });
  assert.equal(await router({ kind: "tab", target: new FakeElement("tab", "t1") }), "tab");
  assert.equal(await router({ kind: "group", target: new FakeElement("group", "g1") }), "group");
  assert.equal(await router({ kind: "workspace", target: new FakeElement("workspace", "ws-known") }), "workspace");
  assert.equal(router({ kind: "workspace", target: new FakeElement("workspace", "ws-removed") }), false);
  assert.equal(router({ kind: "workspace", target: new FakeElement() }), false);
  assert.equal(router({ kind: "unknown", target: new FakeElement("tab", "t2") }), false);
  assert.deepEqual(routed, [["tab", "t1"], ["group", "g1"], ["workspace", "ws-known"]]);
});

test("disposal removes every listener", async () => {
  const harness = createHarness();
  harness.controller.dispose();
  for (const type of ["pointerdown", "pointerup", "auxclick"]) {
    assert.equal(harness.documentElement.count(type), 0, type);
  }
  click(harness, new FakeElement("tab", "after-dispose"));
  await flush();
  assert.equal(harness.calls.length, 0);
  assert.throws(
    () => createMiddleClickUnloadController({ documentElement: new FakeDocument() }),
    TypeError
  );
});

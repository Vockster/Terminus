import test from "node:test";
import assert from "node:assert/strict";

import { FaviconPresenter, faviconFallback } from "../../src/sidebar/favicon-presenter.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeDom() {
  const classes = new Set();
  const favicon = {
    isConnected: true,
    children: [],
    classList: {
      add: (...names) => names.forEach((name) => {
        classes.add(name);
      }),
      remove: (...names) => names.forEach((name) => {
        classes.delete(name);
      })
    },
    append(image) {
      image.owner = this;
      image.parentNode = this;
      if (!this.children.includes(image)) this.children.push(image);
    }
  };
  const row = { querySelector: () => favicon };
  const root = {
    querySelector(selector) { return selector.includes('data-tab-id="tab-one"') && selector.includes('data-firefox-tab-id="11"') ? row : null; },
    querySelectorAll(selector) {
      if (selector === ".tab-favicon-image") return [...favicon.children];
      if (selector === ".tab-favicon--loaded") return classes.has("tab-favicon--loaded") ? [favicon] : [];
      return [];
    }
  };
  const document = {
    createElement() {
      const listeners = {};
      return {
        className: "", alt: "", draggable: true, owner: null,
        addEventListener(name, listener) { listeners[name] = listener; },
        set src(value) { this.source = value; queueMicrotask(() => listeners.load?.()); },
        remove() {
          if (this.owner) this.owner.children = this.owner.children.filter((child) => child !== this);
        }
      };
    }
  };
  return { root, favicon, document };
}

test("favicon fallbacks are deterministic and an identical refresh keeps the displayed image", async () => {
  assert.deepEqual(faviconFallback("Alpha", "tab-one"), faviconFallback("Alpha", "tab-one"));
  assert.equal(faviconFallback(" Alpha", "tab-one").initial, "A");
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = fakeDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const created = [];
  const revoked = [];
  const diagnostics = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: async () => ({
        ok: true,
        result: { icons: [{ logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1) }] }
      }),
      createObjectURL() { const url = `blob:${created.length + 1}`; created.push(url); return url; },
      revokeObjectURL: (url) => revoked.push(url),
      onDiagnostic: (reason) => diagnostics.push(reason)
    });
    const view = { activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] };
    presenter.present(view, 7);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(created, ["blob:1"]);
    assert.deepEqual(diagnostics, ["displayed"]);
    const displayed = dom.favicon.children[0];
    presenter.refresh();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(created, ["blob:1"], "identical bytes allocate no replacement");
    assert.deepEqual(revoked, []);
    assert.deepEqual(diagnostics, ["displayed"]);
    assert.equal(dom.favicon.children.length, 1);
    assert.equal(dom.favicon.children[0], displayed);
    presenter.destroy();
    assert.deepEqual(revoked, ["blob:1"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("late cache responses cannot cross an exact source-change invalidation", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = fakeDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const first = deferred();
  let requests = 0;
  let created = 0;
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage() {
        requests += 1;
        return requests === 1 ? first.promise : Promise.resolve({ ok: true, result: { icons: [] } });
      },
      createObjectURL() { created += 1; return `blob:${created}`; },
      revokeObjectURL() {}
    });
    const view = { activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] };
    presenter.present(view, 7);
    presenter.handleTabUpdate(11, { favIconUrl: "https://changed.invalid/icon.png" });
    first.resolve({
      ok: true,
      result: { icons: [{ logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1) }] }
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(created, 0);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

// The tab pane rebuilds every row on render, so a presenter that discarded its
// images would show the fallback initial until a background round trip
// returned. Re-rendering must reattach the decoded image with no refetch.
// The fake mirrors replaceChildren: each render produces a brand new element,
// leaving the retained image parented to the discarded one.
function rebuildableDom() {
  function makeFavicon() {
    const classes = new Set();
    return {
      isConnected: true,
      children: [],
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        has: (name) => classes.has(name)
      },
      append(image) {
        image.parentNode = this;
        if (!this.children.includes(image)) this.children.push(image);
      }
    };
  }
  let favicon = makeFavicon();
  const root = {
    querySelector: (selector) =>
      selector.includes('data-tab-id="tab-one"') && selector.includes('data-firefox-tab-id="11"')
        ? { querySelector: () => favicon }
        : null,
    querySelectorAll: () => []
  };
  const document = {
    createElement() {
      const listeners = {};
      return {
        className: "", alt: "", draggable: true, parentNode: null,
        addEventListener(name, listener) { listeners[name] = listener; },
        set src(value) { this.source = value; queueMicrotask(() => listeners.load?.()); },
        remove() {
          if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
          this.parentNode = null;
        }
      };
    }
  };
  return {
    root,
    document,
    get favicon() { return favicon; },
    rerender() { favicon = makeFavicon(); }
  };
}

test("re-rendering reattaches the decoded favicon without a refetch", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = rebuildableDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  let requests = 0;
  const revoked = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: async () => {
        requests += 1;
        return {
          ok: true,
          result: { icons: [{ logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1) }] }
        };
      },
      createObjectURL: () => "blob:1",
      revokeObjectURL: (url) => revoked.push(url)
    });
    const view = { activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] };
    presenter.present(view, 7);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(requests, 1);
    const displayed = dom.favicon.children[0];
    assert.ok(displayed, "the first present resolves an icon");

    dom.rerender();
    presenter.present(view, 7);
    // Synchronous: no await, because a gap here is what the user sees flicker.
    assert.equal(dom.favicon.children.length, 1);
    assert.equal(dom.favicon.children[0], displayed, "the same decoded image is reused");
    assert.ok(dom.favicon.classList.has("tab-favicon--loaded"));
    assert.equal(requests, 1, "a rebuilt row must not trigger another lookup");
    assert.deepEqual(revoked, [], "a retained icon is never revoked mid-render");

    // Leaving the current projection is not proof that the Firefox tab died.
    presenter.present({ activeTabs: [] }, 7);
    dom.rerender();
    presenter.present(view, 7);
    assert.equal(dom.favicon.children[0], displayed, "a workspace/search round trip keeps the decoded node");
    assert.equal(requests, 1);
    assert.deepEqual(revoked, []);

    // A tab replaced by a different Firefox handle must not keep the old icon.
    presenter.handleTabReplaced(12, 11);
    assert.deepEqual(revoked, ["blob:1"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

function controlledDom() {
  const classes = new Set();
  const favicon = {
    isConnected: true,
    children: [],
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      has: (name) => classes.has(name)
    },
    append(image) {
      image.parentNode?.removeChild?.(image);
      image.parentNode = this;
      if (!this.children.includes(image)) this.children.push(image);
    },
    removeChild(image) {
      this.children = this.children.filter((child) => child !== image);
      image.parentNode = null;
    }
  };
  const images = [];
  const document = {
    createElement() {
      const listeners = {};
      const image = {
        className: "", alt: "", draggable: true, parentNode: null,
        addEventListener(name, listener) { listeners[name] = listener; },
        set src(value) { this.source = value; },
        emit(name) { listeners[name]?.(); },
        remove() { this.parentNode?.removeChild?.(this); }
      };
      images.push(image);
      return image;
    }
  };
  const root = {
    querySelector(selector) {
      return selector.includes('data-tab-id="tab-one"') && /data-firefox-tab-id="(?:11|12)"/.test(selector)
        ? { querySelector: () => favicon }
        : null;
    },
    querySelectorAll: () => []
  };
  return { root, document, favicon, images };
}

test("coarse cache revalidation is double-buffered and releases every allocated URL exactly once", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const responses = [];
  const revoked = [];
  let nextUrl = 0;
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: () => {
        const gate = deferred();
        responses.push(gate);
        return gate.promise;
      },
      createObjectURL: () => `blob:${++nextUrl}`,
      revokeObjectURL: (url) => revoked.push(url)
    });
    presenter.present({ activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] }, 7);
    responses.shift().resolve({
      ok: true,
      result: { icons: [{
        logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1)
      }] }
    });
    await Promise.resolve();
    dom.images[0].emit("load");
    const original = dom.favicon.children[0];

    presenter.refresh("icons");
    responses.shift().resolve({
      ok: true,
      result: { icons: [{
        logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(2)
      }] }
    });
    await Promise.resolve();
    assert.equal(dom.favicon.children[0], original, "the old decoded image stays visible while its replacement decodes");
    assert.deepEqual(revoked, []);
    dom.images[1].emit("error");
    assert.equal(dom.favicon.children[0], original, "a failed replacement cannot destroy a valid prior image");
    assert.deepEqual(revoked, ["blob:2"]);

    presenter.refresh("icons");
    responses.shift().resolve({
      ok: true,
      result: { icons: [{
        logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(3)
      }] }
    });
    await Promise.resolve();
    dom.images[2].emit("load");
    assert.equal(dom.favicon.children[0], dom.images[2]);
    assert.deepEqual(revoked, ["blob:2", "blob:1"]);

    presenter.handleTabRemoved(12);
    assert.deepEqual(revoked, ["blob:2", "blob:1"], "a different composite identity cannot release the icon");
    presenter.handleTabRemoved(11);
    presenter.destroy();
    assert.deepEqual(revoked, ["blob:2", "blob:1", "blob:3"]);
    assert.equal(new Set(revoked).size, revoked.length);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("successful cache omissions clear stale icons while failed lookups preserve them", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const responses = [];
  const revoked = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: () => {
        const gate = deferred();
        responses.push(gate);
        return gate.promise;
      },
      createObjectURL: () => "blob:only",
      revokeObjectURL: (url) => revoked.push(url)
    });
    presenter.present({ activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] }, 7);
    responses.shift().resolve({
      ok: true,
      result: { icons: [{
        logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1)
      }] }
    });
    await Promise.resolve();
    dom.images[0].emit("load");

    presenter.refresh("icons");
    responses.shift().reject(new Error("transient transport failure"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 1);
    assert.deepEqual(revoked, []);

    presenter.refresh("icons");
    responses.shift().resolve({ ok: false, error: { code: "INTERNAL_ERROR" } });
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 1);
    assert.deepEqual(revoked, []);

    presenter.refresh("icons");
    responses.shift().resolve({ ok: true, result: { icons: [] } });
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 0, "a successful omission restores the fallback");
    assert.deepEqual(revoked, ["blob:only"]);
    assert.equal(dom.favicon.classList.has("tab-favicon--loaded"), false);

    presenter.handleTabUpdate(11, { favIconUrl: "https://changed.invalid/icon.png" });
    assert.equal(dom.favicon.children.length, 0);
    assert.deepEqual(revoked, ["blob:only"]);
    assert.equal(dom.favicon.classList.has("tab-favicon--loaded"), false);
    responses.shift().resolve({ ok: false, error: { code: "INTERNAL_ERROR" } });
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 0, "transport failure cannot restore a known-stale icon");
    assert.deepEqual(revoked, ["blob:only"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("a URL or icon update keeps the image until an authoritative answer replaces or clears it", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const responses = [];
  const revoked = [];
  let nextUrl = 0;
  const icon = (byte) => ({
    ok: true,
    result: { icons: [{ logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(byte) }], pending: [] }
  });
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: () => {
        const gate = deferred();
        responses.push(gate);
        return gate.promise;
      },
      createObjectURL: () => `blob:${++nextUrl}`,
      revokeObjectURL: (url) => revoked.push(url)
    });
    presenter.present({ activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] }, 7);
    responses.shift().resolve(icon(1));
    await Promise.resolve();
    dom.images[0].emit("load");
    const original = dom.favicon.children[0];

    // A URL change alone, as single-page video sites make constantly, is not
    // an icon change: no lookup runs and nothing on screen changes.
    presenter.handleTabUpdate(11, { url: "https://video.invalid/watch?v=next" });
    assert.equal(responses.length, 0, "a URL-only change sends no lookup");
    assert.equal(dom.favicon.children[0], original);

    // Firefox reports the same icon again: identical bytes are not restaged.
    presenter.handleTabUpdate(11, { favIconUrl: "https://video.invalid/icon.png" });
    assert.equal(dom.favicon.children[0], original, "no fallback is shown while the lookup runs");
    responses.shift().resolve(icon(1));
    await Promise.resolve();
    assert.equal(dom.images.length, 1, "identical bytes are not restaged");
    assert.equal(dom.favicon.children[0], original);

    // Navigation clears the icon while the next page loads; the image stays.
    presenter.handleTabUpdate(11, { favIconUrl: undefined });
    responses.shift().resolve({
      ok: true,
      result: { icons: [], pending: [{ logicalId: "tab-one", firefoxTabId: 11 }] }
    });
    await Promise.resolve();
    assert.equal(dom.favicon.children[0], original);
    assert.deepEqual(revoked, []);

    // Its icon arrives with different bytes: swapped only after decode.
    presenter.handleTabUpdate(11, { favIconUrl: "https://other.invalid/icon.png" });
    responses.shift().resolve(icon(2));
    await Promise.resolve();
    assert.equal(dom.favicon.children[0], original, "the old image stays until its replacement loads");
    dom.images[1].emit("load");
    assert.equal(dom.favicon.children[0], dom.images[1]);
    assert.deepEqual(revoked, ["blob:1"]);

    // Completion without any icon is authoritative and restores the fallback.
    presenter.handleTabUpdate(11, { status: "complete" });
    responses.shift().resolve({ ok: true, result: { icons: [], pending: [] } });
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 0);
    assert.deepEqual(revoked, ["blob:1", "blob:2"]);
    presenter.destroy();
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("a same-site stand-in never replaces a shown icon on a refresh, but does after the tab's icon changes", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const responses = [];
  let nextUrl = 0;
  const answer = (byte, substitute) => ({
    ok: true,
    result: {
      icons: [{ logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(byte), substitute }],
      pending: []
    }
  });
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: () => {
        const gate = deferred();
        responses.push(gate);
        return gate.promise;
      },
      createObjectURL: () => `blob:${++nextUrl}`,
      revokeObjectURL: () => undefined
    });
    // A tab showing nothing takes the stand-in rather than the letter.
    presenter.present({ activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] }, 7);
    responses.shift().resolve(answer(1, true));
    await Promise.resolve();
    dom.images[0].emit("load");
    const standIn = dom.favicon.children[0];
    assert.equal(standIn, dom.images[0]);

    // Another tab on the site saves a different icon: the refresh keeps it.
    presenter.refresh("icons");
    responses.shift().resolve(answer(2, true));
    await Promise.resolve();
    assert.equal(dom.images.length, 1, "no replacement is staged for a stand-in");
    assert.equal(dom.favicon.children[0], standIn);

    // The tab's own icon is saved: it replaces the stand-in.
    presenter.refresh("icons");
    responses.shift().resolve(answer(3, false));
    await Promise.resolve();
    dom.images[1].emit("load");
    const own = dom.favicon.children[0];
    assert.equal(own, dom.images[1]);

    // The tab's icon changes to one not cached yet: the stand-in replaces the
    // now outdated image, because what was shown belongs to another source.
    presenter.handleTabUpdate(11, { favIconUrl: "https://example.invalid/next.png" });
    responses.shift().resolve(answer(4, true));
    await Promise.resolve();
    dom.images[2].emit("load");
    assert.equal(dom.favicon.children[0], dom.images[2]);
    presenter.destroy();
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("a failed lookup after a proven source change cannot keep the old image", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const responses = [];
  const revoked = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: () => {
        const gate = deferred();
        responses.push(gate);
        return gate.promise;
      },
      createObjectURL: () => "blob:old",
      revokeObjectURL: (url) => revoked.push(url)
    });
    presenter.present({ activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] }, 7);
    responses.shift().resolve({
      ok: true,
      result: { icons: [{ logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1) }] }
    });
    await Promise.resolve();
    dom.images[0].emit("load");

    presenter.handleTabUpdate(11, { favIconUrl: "https://changed.invalid/icon.png" });
    assert.equal(dom.favicon.children.length, 1);
    responses.shift().reject(new Error("background unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 0);
    assert.deepEqual(revoked, ["blob:old"]);
    presenter.destroy();
    assert.deepEqual(revoked, ["blob:old"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("a successful omission invalidates an icon retained after its row leaves the projection", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const responses = [];
  const revoked = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: () => {
        const gate = deferred();
        responses.push(gate);
        return gate.promise;
      },
      createObjectURL: () => "blob:retained",
      revokeObjectURL: (url) => revoked.push(url)
    });
    const view = { activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] };
    presenter.present(view, 7);
    responses.shift().resolve({
      ok: true,
      result: { icons: [{
        logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1)
      }] }
    });
    await Promise.resolve();
    dom.images[0].emit("load");

    presenter.present({ activeTabs: [] }, 7);
    presenter.refresh("icons");
    const omission = responses.shift();
    omission.resolve({ ok: true, result: { icons: [] } });
    await Promise.resolve();
    assert.deepEqual(revoked, ["blob:retained"]);

    presenter.present(view, 7);
    assert.equal(dom.favicon.children.length, 0, "the stale retained node cannot be reattached");
    assert.equal(responses.length, 1, "the restored projection requests fresh authoritative state");
    responses.shift().resolve({ ok: false, error: { code: "INTERNAL_ERROR" } });
    await Promise.resolve();
    assert.equal(dom.favicon.children.length, 0, "a failed retry cannot revive the invalidated icon");
    presenter.destroy();
    assert.deepEqual(revoked, ["blob:retained"], "the retained object URL is revoked exactly once");
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("lookups are deterministically partitioned into independent 500-tab chunks", async () => {
  const requests = [];
  const firstChunk = deferred();
  const presenter = new FaviconPresenter({
    root: { querySelector: () => null, querySelectorAll: () => [] },
    sendMessage(message) {
      requests.push(message);
      return requests.length === 1
        ? firstChunk.promise
        : Promise.resolve({ ok: true, result: { icons: [] } });
    },
    createObjectURL() { throw new Error("empty results cannot allocate URLs"); }
  });
  const activeTabs = Array.from({ length: 1001 }, (_, index) => ({
    logicalId: `tab-${index}`,
    firefoxId: index + 1
  }));
  presenter.present({ activeTabs }, 7);
  await Promise.resolve();
  assert.deepEqual(requests.map(({ tabs }) => tabs.length), [500, 500, 1]);
  assert.equal(requests[0].tabs[0].logicalId, "tab-0");
  assert.equal(requests[1].tabs[0].logicalId, "tab-500");
  assert.equal(requests[2].tabs[0].logicalId, "tab-1000");

  // The unresolved first chunk remains guarded while completed later chunks
  // can retry independently on another presentation pass.
  presenter.present({ activeTabs }, 7);
  assert.deepEqual(requests.map(({ tabs }) => tabs.length), [500, 500, 1, 500, 1]);
  assert.equal(requests[3].tabs[0].logicalId, "tab-500");
  firstChunk.resolve({ ok: true, result: { icons: [] } });
  await Promise.resolve();
  presenter.destroy();
});

test("an authoritative live inventory is the only projection-independent prune", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = controlledDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const revoked = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage: async () => ({
        ok: true,
        result: { icons: [{
          logicalId: "tab-one", firefoxTabId: 11, mime: "image/png", bytes: Uint8Array.of(1)
        }] }
      }),
      createObjectURL: () => "blob:one",
      revokeObjectURL: (url) => revoked.push(url)
    });
    const view = { activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] };
    presenter.present(view, 7);
    await Promise.resolve();
    dom.images[0].emit("load");
    presenter.present({ activeTabs: [] }, 7);
    assert.deepEqual(revoked, []);
    presenter.synchronizeLiveTabs([{ logicalTabId: "tab-one", firefoxTabId: 11 }]);
    assert.deepEqual(revoked, [], "the authoritative view-contract identity retains the exact icon");
    presenter.synchronizeLiveTabs([]);
    assert.deepEqual(revoked, ["blob:one"]);
    presenter.destroy();
    assert.deepEqual(revoked, ["blob:one"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

test("private presentation keeps deterministic fallbacks without sending cache lookups", () => {
  let lookupCount = 0;
  const presenter = new FaviconPresenter({
    root: { querySelector: () => null, querySelectorAll: () => [] },
    lookupEnabled: () => false,
    sendMessage() {
      lookupCount += 1;
      throw new Error("private presentation must not contact the normal cache");
    },
    createObjectURL() {
      throw new Error("private presentation must not allocate cached favicon URLs");
    }
  });
  presenter.synchronizeLiveTabs([{ logicalTabId: "tab-one", firefoxTabId: 11 }]);
  presenter.present({ activeTabs: [{ logicalId: "tab-one", firefoxId: 11 }] }, 8);
  presenter.refresh("icons");
  assert.equal(lookupCount, 0);
  presenter.destroy();
});

test("affected-tab cache notifications revalidate only matching live identities", async () => {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const dom = fakeDom();
  globalThis.document = dom.document;
  globalThis.CSS = { escape: (value) => value };
  const requests = [];
  try {
    const presenter = new FaviconPresenter({
      root: dom.root,
      sendMessage(message) {
        requests.push(message.tabs);
        return Promise.resolve({ ok: true, result: { icons: [] } });
      },
      createObjectURL: () => "blob:unused",
      revokeObjectURL() {}
    });
    presenter.present({ activeTabs: [
      { logicalId: "tab-one", firefoxId: 11 },
      { logicalId: "tab-two", firefoxId: 12 }
    ] }, 7);
    await Promise.resolve();
    requests.length = 0;

    presenter.refresh("icons", [12]);
    assert.deepEqual(requests, [[{ logicalId: "tab-two", firefoxTabId: 12 }]]);
    presenter.destroy();
  } finally {
    globalThis.document = previousDocument;
    globalThis.CSS = previousCss;
  }
});

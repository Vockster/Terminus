import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVICON_ERROR_CODES,
  FAVICON_MESSAGE_TYPES
} from "../../src/contracts/favicon-messages.js";
import { createStoragePanel, formatStorageBytes } from "../../src/settings/storage-panel.js";

function createNode(tagName = "div") {
  const listeners = new Map();
  const attributes = new Map();
  return {
    tagName: tagName.toUpperCase(),
    dataset: {},
    children: [],
    disabled: false,
    hidden: false,
    textContent: "",
    title: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    append(...children) { this.children.push(...children); },
    close() {},
    focus() {},
    querySelectorAll() { return []; },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    showModal() {},
    listener(type) { return listeners.get(type); }
  };
}

function createDocumentHarness() {
  const selectors = [
    "#storage-favicon-count",
    "#storage-favicon-bytes",
    "#storage-icon-gallery",
    "#storage-icon-gallery-empty",
    "#storage-status",
    "#storage-access-section",
    "#storage-access-list",
    "#storage-remove-unused",
    "#storage-clear-favicons",
    "#storage-clear-dialog",
    "#storage-clear-form",
    "#storage-clear-cancel",
    "#storage-clear-submit"
  ];
  const nodes = new Map(selectors.map((selector) => [selector, createNode()]));
  return {
    nodes,
    document: {
      querySelector(selector) { return nodes.get(selector) ?? null; },
      createElement(tagName) { return createNode(tagName); }
    }
  };
}

function overviewFixture() {
  return {
    favicon: { available: true, iconCount: 2, byteCount: 3_072 },
    access: { available: true, hosts: [] }
  };
}

function icon(origin, byte = 1) {
  return {
    origin,
    mime: "image/png",
    bytes: new Uint8Array([byte, byte + 1]),
    byteCount: 2,
    updatedAt: 1
  };
}

function installDom(t) {
  const originalDocument = globalThis.document;
  const originalBrowser = globalThis.browser;
  const harness = createDocumentHarness();
  let runtimeListener;
  globalThis.document = harness.document;
  globalThis.browser = {
    runtime: {
      onMessage: {
        addListener(listener) { runtimeListener = listener; },
        removeListener(listener) {
          if (runtimeListener === listener) runtimeListener = undefined;
        }
      }
    }
  };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalBrowser === undefined) delete globalThis.browser;
    else globalThis.browser = originalBrowser;
  });
  return { ...harness, runtimeListener: () => runtimeListener };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("storage formats exact cache bytes without quota or allowance helpers", () => {
  assert.equal(formatStorageBytes(0), "0 B");
  assert.equal(formatStorageBytes(9_728), "9.50 KiB");
  assert.equal(formatStorageBytes(2 * 1024 ** 2), "2.00 MiB");
  assert.equal(formatStorageBytes(-1), "Unavailable");
});

test("storage loads every cache page and revokes each gallery URL on replacement and teardown", async (t) => {
  const { nodes } = installDom(t);
  const cursors = [];
  const created = [];
  const revoked = [];
  const client = {
    async overview() { return overviewFixture(); },
    async list(cursor) {
      cursors.push(structuredClone(cursor));
      return cursor === null
        ? { icons: [icon("https://alpha.example")], nextCursor: { revision: 4, offset: 1 } }
        : { icons: [icon("https://beta.example", 3)], nextCursor: null };
    }
  };
  const panel = createStoragePanel({
    client,
    createObjectURL(blob) {
      const url = `blob:test-${created.length + 1}`;
      created.push([url, blob.type, blob.size]);
      return url;
    },
    revokeObjectURL(url) { revoked.push(url); }
  });

  await panel.refresh({ quiet: true });
  assert.deepEqual(cursors, [null, { revision: 4, offset: 1 }]);
  assert.equal(nodes.get("#storage-favicon-count").textContent, "2 icons");
  assert.equal(nodes.get("#storage-favicon-bytes").textContent, "3.00 KiB");
  assert.equal(nodes.get("#storage-icon-gallery").children.length, 2);
  assert.deepEqual(
    nodes.get("#storage-icon-gallery").children.map((tile) => tile.children[1].textContent),
    ["alpha.example", "beta.example"]
  );
  assert.deepEqual(created.map(([url]) => url), ["blob:test-1", "blob:test-2"]);
  assert.deepEqual(revoked, []);

  await panel.refresh({ quiet: true });
  assert.deepEqual(revoked, ["blob:test-1", "blob:test-2"]);
  panel.destroy();
  assert.deepEqual(revoked, ["blob:test-1", "blob:test-2", "blob:test-3", "blob:test-4"]);
});

test("a stale gallery page restarts from page one", async (t) => {
  installDom(t);
  const cursors = [];
  let failed = false;
  const panel = createStoragePanel({
    client: {
      async overview() { return overviewFixture(); },
      async list(cursor) {
        cursors.push(structuredClone(cursor));
        if (cursor !== null && !failed) {
          failed = true;
          const error = new Error("changed");
          error.code = FAVICON_ERROR_CODES.STALE_GENERATION;
          throw error;
        }
        return cursor === null
          ? { icons: [icon("https://alpha.example")], nextCursor: { revision: failed ? 5 : 4, offset: 1 } }
          : { icons: [icon("https://beta.example")], nextCursor: null };
      }
    },
    createObjectURL: () => "blob:test",
    revokeObjectURL: () => undefined
  });

  await panel.refresh({ quiet: true });
  assert.deepEqual(cursors, [
    null,
    { revision: 4, offset: 1 },
    null,
    { revision: 5, offset: 1 }
  ]);
  panel.destroy();
});

test("favicon change events refresh the active panel and defer while inactive", async (t) => {
  const dom = installDom(t);
  let overviewCalls = 0;
  const panel = createStoragePanel({
    client: {
      async overview() { overviewCalls += 1; return overviewFixture(); },
      async list() { return { icons: [], nextCursor: null }; }
    }
  });

  panel.setActive(true);
  await tick();
  assert.equal(overviewCalls, 1);
  dom.runtimeListener()({ type: FAVICON_MESSAGE_TYPES.CHANGED });
  dom.runtimeListener()({ type: FAVICON_MESSAGE_TYPES.CHANGED });
  await tick();
  assert.equal(overviewCalls, 2);

  panel.setActive(false);
  dom.runtimeListener()({ type: FAVICON_MESSAGE_TYPES.CHANGED });
  await tick();
  assert.equal(overviewCalls, 2);
  panel.setActive(true);
  await tick();
  assert.equal(overviewCalls, 3);
  panel.destroy();
  assert.equal(dom.runtimeListener(), undefined);
});

test("private Settings renders an unavailable state without calling the cache client", async (t) => {
  const { nodes } = installDom(t);
  const client = new Proxy({}, {
    get() { assert.fail("private Settings must not call the normal cache client"); }
  });
  const panel = createStoragePanel({ client, privateContext: true });

  await panel.refresh({ quiet: true });
  assert.equal(nodes.get("#storage-favicon-count").textContent, "Unavailable in private windows");
  assert.equal(
    nodes.get("#storage-icon-gallery-empty").textContent,
    "Open Settings in a normal window to view cached website icons."
  );
  assert.equal(nodes.get("#storage-remove-unused").disabled, true);
  assert.equal(nodes.get("#storage-clear-favicons").disabled, true);
  panel.destroy();
});

import test from "node:test";
import assert from "node:assert/strict";

import { FAVICON_ERROR_CODES, digestFaviconSource } from "../../src/contracts/favicon-cache.js";
import {
  DEFAULT_SEARCH_ICON_REFRESH_ALARM_NAME,
  DEFAULT_SEARCH_ICON_REFRESH_MINUTES,
  FirefoxFaviconBrowser
} from "../../src/platform/firefox/favicon-browser.js";

function event() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
    get size() { return listeners.size; }
  };
}

function tabsApi(tabs = new Map()) {
  return {
    onCreated: event(), onUpdated: event(), onActivated: event(), onReplaced: event(), onRemoved: event(),
    async get(id) {
      if (!tabs.has(id)) throw new Error("missing");
      return tabs.get(id);
    },
    async query() { return [...tabs.values()]; }
  };
}

test("favicon observation registers synchronously and private tabs never reach callbacks", async () => {
  const tabs = tabsApi(new Map([
    [1, { id: 1, windowId: 7, incognito: false, url: "https://one.invalid/page", favIconUrl: "https://one.invalid/icon.png" }],
    [2, { id: 2, windowId: 8, incognito: true, url: "https://private.invalid/", favIconUrl: "https://private.invalid/icon.png" }],
    [3, { id: 3, windowId: 9, url: "https://unknown.invalid/", favIconUrl: "https://unknown.invalid/icon.png" }]
  ]));
  const observed = [];
  const cancelled = [];
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs } });
  adapter.observe({ onObserve: (id) => observed.push(id), onCancel: (id) => cancelled.push(id) });
  assert.equal(tabs.onCreated.size, 1);
  tabs.onCreated.emit(await tabs.get(1));
  tabs.onCreated.emit(await tabs.get(2));
  tabs.onCreated.emit(await tabs.get(3));
  tabs.onUpdated.emit(1, { status: "complete" }, await tabs.get(1));
  tabs.onUpdated.emit(1, { favIconUrl: "https://cdn.invalid/late.png" }, {
    ...await tabs.get(1),
    favIconUrl: "https://cdn.invalid/late.png"
  });
  tabs.onUpdated.emit(2, { favIconUrl: "changed" }, await tabs.get(2));
  tabs.onActivated.emit({ tabId: 2, windowId: 8 });
  tabs.onRemoved.emit(2, { windowId: 8 });
  tabs.onRemoved.emit(1, { windowId: 7 });
  await Promise.resolve();
  assert.deepEqual(observed, [1, 1, 1]);
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(await adapter.resolveTabReferences(8, [{ logicalId: "tab-private", firefoxTabId: 2 }]), []);
  assert.equal(await adapter.resolveTab(3), null);
  adapter.unsubscribe();
  assert.equal(tabs.onCreated.size, 0);
});

test("Firefox New Tab and Home resolve to the current default search icon and a supported refresh alarm", async () => {
  const tabRecords = new Map([
    [1, { id: 1, windowId: 7, incognito: false, url: "about:newtab", favIconUrl: "chrome://branding/content/icon32.png" }],
    [2, { id: 2, windowId: 7, incognito: false, url: "about:home", favIconUrl: "chrome://branding/content/icon32.png" }],
    [3, { id: 3, windowId: 7, incognito: false, url: "https://custom-new-tab.invalid/start", favIconUrl: "https://custom-new-tab.invalid/icon.png" }],
    [4, { id: 4, windowId: 8, incognito: true, url: "about:newtab", favIconUrl: "chrome://branding/content/icon32.png" }]
  ]);
  const tabs = tabsApi(tabRecords);
  const alarmEvent = event();
  const alarms = [];
  let refreshes = 0;
  let searchReads = 0;
  const adapter = new FirefoxFaviconBrowser({
    browser: {
      tabs,
      search: {
        async get() {
          searchReads += 1;
          return [
            { name: "Other", isDefault: false, favIconUrl: "data:image/png;base64,AAAA" },
            { name: "Current", isDefault: true, favIconUrl: "data:image/png;base64,iVBORw0KGgo=" }
          ];
        }
      },
      alarms: {
        onAlarm: alarmEvent,
        create(name, options) { alarms.push({ name, options }); }
      }
    }
  });
  adapter.observe({ onDefaultSearchRefresh: () => { refreshes += 1; } });
  assert.deepEqual(alarms, [{
    name: DEFAULT_SEARCH_ICON_REFRESH_ALARM_NAME,
    options: {
      delayInMinutes: DEFAULT_SEARCH_ICON_REFRESH_MINUTES,
      periodInMinutes: DEFAULT_SEARCH_ICON_REFRESH_MINUTES
    }
  }]);
  alarmEvent.emit({ name: "unrelated" });
  alarmEvent.emit({ name: DEFAULT_SEARCH_ICON_REFRESH_ALARM_NAME });
  assert.equal(refreshes, 1);
  assert.equal(await adapter.getDefaultSearchIconSource(), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(searchReads, 1);
  assert.equal(await adapter.hasNormalDefaultSearchPage(), true);

  assert.deepEqual(await adapter.resolveTabReferences(7, [
    { logicalId: "tab-new", firefoxTabId: 1 },
    { logicalId: "tab-home", firefoxTabId: 2 },
    { logicalId: "tab-custom", firefoxTabId: 3 }
  ]), [
    { logicalId: "tab-new", firefoxTabId: 1, source: "default-search" },
    { logicalId: "tab-home", firefoxTabId: 2, source: "default-search" },
    {
      logicalId: "tab-custom",
      firefoxTabId: 3,
      source: "website",
      origin: "https://custom-new-tab.invalid",
      sourceDigest: await digestFaviconSource("https://custom-new-tab.invalid/icon.png")
    }
  ]);
  assert.deepEqual(await adapter.resolveTabReferences(8, [
    { logicalId: "tab-private", firefoxTabId: 4 }
  ]), []);

  tabRecords.set(1, {
    id: 1,
    windowId: 7,
    incognito: false,
    url: "https://navigated.invalid/page",
    favIconUrl: "https://navigated.invalid/icon.png"
  });
  assert.deepEqual(await adapter.resolveTabReferences(7, [
    { logicalId: "tab-new", firefoxTabId: 1 }
  ]), [{
    logicalId: "tab-new",
    firefoxTabId: 1,
    source: "website",
    origin: "https://navigated.invalid",
    sourceDigest: await digestFaviconSource("https://navigated.invalid/icon.png")
  }]);
  adapter.unsubscribe();
  assert.equal(alarmEvent.size, 0);
});

test("lookup references include the exact current source digest and reject missing or unsafe candidates", async () => {
  const tabRecords = new Map([
    [1, { id: 1, windowId: 7, incognito: false, url: "https://one.invalid/page", favIconUrl: "https://one.invalid/a.png" }],
    [2, { id: 2, windowId: 7, incognito: false, url: "https://two.invalid/page" }],
    [3, { id: 3, windowId: 7, incognito: false, url: "https://three.invalid/page", favIconUrl: "javascript:alert(1)" }]
  ]);
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs: tabsApi(tabRecords) } });
  const first = await adapter.resolveTabReferences(7, [
    { logicalId: "tab-one", firefoxTabId: 1 },
    { logicalId: "tab-two", firefoxTabId: 2 },
    { logicalId: "tab-three", firefoxTabId: 3 }
  ]);
  assert.deepEqual(first, [{
    logicalId: "tab-one",
    firefoxTabId: 1,
    source: "website",
    origin: "https://one.invalid",
    sourceDigest: await digestFaviconSource("https://one.invalid/a.png")
  }, {
    // Never loaded, so there is no icon URL to match a record against. The
    // origin alone still lets a record already on disk stand in, and the
    // absent digest is what keeps it out of the exact-match and acquisition
    // paths.
    logicalId: "tab-two",
    firefoxTabId: 2,
    source: "website",
    origin: "https://two.invalid"
  }]);
  // An unsafe declared candidate stays excluded outright: the tab named an
  // icon, and that answer is rejected rather than quietly substituted.
  assert.equal(first.some(({ firefoxTabId }) => firefoxTabId === 3), false);

  tabRecords.set(1, { ...tabRecords.get(1), favIconUrl: "https://one.invalid/b.png" });
  const [changed] = await adapter.resolveTabReferences(7, [{ logicalId: "tab-one", firefoxTabId: 1 }]);
  assert.notEqual(changed.sourceDigest, first[0].sourceDigest);
});

test("contextual identities derive distinct opaque favicon partitions", async () => {
  const tabRecords = new Map([
    [1, { id: 1, windowId: 7, incognito: false, cookieStoreId: "firefox-default", url: "https://same.invalid/a", favIconUrl: "https://same.invalid/icon.png" }],
    [2, { id: 2, windowId: 7, incognito: false, cookieStoreId: "firefox-container-1", url: "https://same.invalid/b", favIconUrl: "https://same.invalid/icon.png" }],
    [3, { id: 3, windowId: 7, incognito: false, cookieStoreId: "firefox-container-2", url: "https://same.invalid/c", favIconUrl: "https://same.invalid/icon.png" }]
  ]);
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs: tabsApi(tabRecords) } });
  const resolved = await adapter.resolveTabReferences(7, [1, 2, 3].map((id) => ({
    logicalId: `tab-${id}`,
    firefoxTabId: id
  })));

  assert.equal(Object.hasOwn(resolved[0], "partition"), false);
  assert.match(resolved[1].partition, /^[a-f0-9]{64}$/);
  assert.match(resolved[2].partition, /^[a-f0-9]{64}$/);
  assert.notEqual(resolved[1].partition, resolved[2].partition);
  assert.equal(JSON.stringify(resolved).includes("firefox-container"), false);
});

function lookupTabRecords() {
  const records = new Map([
    [1, { id: 1, windowId: 7, incognito: false, status: "loading", url: "https://one.invalid/next" }],
    [2, { id: 2, windowId: 7, incognito: false, status: "complete", url: "https://two.invalid/page" }],
    [3, { id: 3, windowId: 7, incognito: false, status: "loading", url: "about:blank" }],
    [4, { id: 4, windowId: 8, incognito: false, status: "complete", url: "https://four.invalid/", favIconUrl: "https://four.invalid/icon.png" }],
    [5, { id: 5, windowId: 7, incognito: false, status: "complete", url: "https://five.invalid/", favIconUrl: "https://five.invalid/icon.png" }]
  ]);
  for (let id = 6; id <= 10; id += 1) {
    records.set(id, { id, windowId: 7, incognito: false, status: "complete", url: "about:blank" });
  }
  return records;
}

test("many lookup references use one window query and report loading pages without an icon as pending", async () => {
  const queries = [];
  const tabRecords = lookupTabRecords();
  const tabs = tabsApi(tabRecords);
  tabs.get = async () => assert.fail("a large lookup must not fetch tabs one at a time");
  tabs.query = async (filter) => {
    queries.push(filter);
    return [...tabRecords.values()];
  };
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs } });
  const references = [...tabRecords.keys()].map((id) => ({ logicalId: `tab-${id}`, firefoxTabId: id }));
  assert.ok(references.length > 8);

  const resolved = await adapter.resolveTabReferences(7, references);
  assert.deepEqual(queries, [{ windowId: 7 }]);
  assert.deepEqual(resolved.map(({ logicalId, source }) => [logicalId, source]), [
    ["tab-1", "pending"],
    ["tab-2", "website"],
    ["tab-5", "website"]
  ]);
  // tab-2 completed without declaring an icon, so it carries an origin and no
  // digest. about:blank tabs still resolve to nothing: no origin, no record.
  assert.equal(resolved[1].origin, "https://two.invalid");
  assert.equal(Object.hasOwn(resolved[1], "sourceDigest"), false);
  assert.equal(resolved[2].sourceDigest, await digestFaviconSource("https://five.invalid/icon.png"));
  const again = await adapter.resolveTabReferences(7, references);
  assert.deepEqual(again, resolved);
});

test("a failed window query fails the lookup instead of reporting that no tab has an icon", async () => {
  const tabs = tabsApi(lookupTabRecords());
  tabs.query = async () => { throw new Error("window is closing"); };
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs } });
  const references = [...lookupTabRecords().keys()].map((id) => ({ logicalId: `tab-${id}`, firefoxTabId: id }));
  await assert.rejects(
    adapter.resolveTabReferences(7, references),
    (error) => error.code === FAVICON_ERROR_CODES.UNAVAILABLE
  );
});

test("a few lookup references fetch only those tabs instead of the whole window", async () => {
  const fetched = [];
  const tabRecords = lookupTabRecords();
  const tabs = tabsApi(tabRecords);
  const get = tabs.get;
  tabs.get = async (id) => {
    fetched.push(id);
    return get(id);
  };
  tabs.query = async () => assert.fail("a small lookup must not list the whole window");
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs } });
  const references = [1, 4, 5, 99].map((id) => ({ logicalId: `tab-${id}`, firefoxTabId: id }));

  const resolved = await adapter.resolveTabReferences(7, references);
  assert.deepEqual(fetched.sort((left, right) => left - right), [1, 4, 5, 99]);
  assert.deepEqual(resolved.map(({ logicalId, source }) => [logicalId, source]), [
    ["tab-1", "pending"],
    ["tab-5", "website"]
  ], "another window's tab and a closed tab resolve to nothing");
});

test("direct website fetch omits credentials/referrer/cache and bounds streamed bytes", async () => {
  const calls = [];
  const adapter = new FirefoxFaviconBrowser({
    browser: { tabs: tabsApi() },
    async fetch(url, options) {
      calls.push({ url, options });
      return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        status: 200,
        headers: { "content-type": "image/png" }
      });
    }
  });
  const result = await adapter.fetchBytes("https://example.invalid/icon.png");
  assert.equal(result.bytes.byteLength, 8);
  assert.deepEqual(
    Object.fromEntries(["mode", "credentials", "referrerPolicy", "redirect", "cache"].map((key) => [key, calls[0].options[key]])),
    { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "manual", cache: "no-store" }
  );

  const genericMime = new FirefoxFaviconBrowser({
    browser: { tabs: tabsApi() },
    async fetch() {
      return new Response(result.bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      });
    }
  });
  assert.equal((await genericMime.fetchBytes("https://example.invalid/favicon.ico")).mime, null);

  const oversized = new FirefoxFaviconBrowser({
    browser: { tabs: tabsApi() },
    async fetch() {
      return new Response(new Uint8Array(1024 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "image/png" }
      });
    }
  });
  await assert.rejects(() => oversized.fetchBytes("https://example.invalid/large.png"), {
    code: FAVICON_ERROR_CODES.TOO_LARGE
  });
});

test("host access is checked for one exact HTTPS origin and redirects remain blocked", async () => {
  const permissionCalls = [];
  const adapter = new FirefoxFaviconBrowser({
    browser: {
      tabs: tabsApi(),
      permissions: {
        async contains(request) {
          permissionCalls.push(request);
          return request.origins[0] === "https://cdn.example.invalid/*";
        }
      }
    },
    async fetch() {
      return new Response(null, {
        status: 302,
        headers: { location: "https://other.invalid/icon.png" }
      });
    }
  });
  assert.equal(await adapter.hasHostAccess("https://cdn.example.invalid"), true);
  assert.equal(await adapter.hasHostAccess("http://cdn.example.invalid"), false);
  assert.deepEqual(permissionCalls, [{ origins: ["https://cdn.example.invalid/*"] }]);
  await assert.rejects(() => adapter.fetchBytes("https://cdn.example.invalid/icon.png"), {
    code: FAVICON_ERROR_CODES.REDIRECT_REJECTED
  });
});

test("decoded images enforce dimensions and normalize to bounded PNG", async () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let closed = false;
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { clearRect() {}, drawImage() {} }; }
    async convertToBlob() { return new Blob([PNG], { type: "image/png" }); }
  }
  const adapter = new FirefoxFaviconBrowser({
    browser: { tabs: tabsApi() },
    createImageBitmap: async () => ({ width: 512, height: 256, close() { closed = true; } }),
    OffscreenCanvas: Canvas
  });
  const blob = await adapter.normalizeRaster(PNG, "image/png");
  assert.equal(blob.type, "image/png");
  assert.equal(closed, true);

  const tooLarge = new FirefoxFaviconBrowser({
    browser: { tabs: tabsApi() },
    createImageBitmap: async () => ({ width: 1025, height: 16, close() {} }),
    OffscreenCanvas: Canvas
  });
  await assert.rejects(() => tooLarge.normalizeRaster(PNG, "image/png"), {
    code: FAVICON_ERROR_CODES.DECODE,
    diagnosticReason: "dimensions-rejected"
  });

  const bitmapFailure = new FirefoxFaviconBrowser({
    browser: { tabs: tabsApi() },
    createImageBitmap: async () => { throw new Error("synthetic decoder failure"); },
    OffscreenCanvas: Canvas
  });
  await assert.rejects(() => bitmapFailure.normalizeRaster(PNG, "image/png"), {
    code: FAVICON_ERROR_CODES.DECODE,
    diagnosticReason: "bitmap-decode-failed"
  });
});

test("browser-native image decoding keeps the Firefox global receiver", async () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let receiver;
  class Canvas {
    getContext() { return { clearRect() {}, drawImage() {} }; }
    async convertToBlob() { return new Blob([PNG], { type: "image/png" }); }
  }
  try {
    globalThis.createImageBitmap = function () {
      receiver = this;
      return Promise.resolve({ width: 32, height: 32, close() {} });
    };
    const adapter = new FirefoxFaviconBrowser({
      browser: { tabs: tabsApi() },
      OffscreenCanvas: Canvas
    });
    await adapter.normalizeRaster(PNG, "image/png");
    assert.equal(receiver, globalThis);
  } finally {
    if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test("the periodic default-search check answers from tracked events after one seeding query", async () => {
  const tabMap = new Map([
    [1, { id: 1, windowId: 7, incognito: false, url: "about:newtab" }],
    [2, { id: 2, windowId: 7, incognito: false, url: "https://site.invalid/" }]
  ]);
  const tabs = tabsApi(tabMap);
  let queries = 0;
  const baseQuery = tabs.query;
  tabs.query = async (...args) => { queries += 1; return baseQuery(...args); };
  const adapter = new FirefoxFaviconBrowser({ browser: { tabs } });
  adapter.observe({});

  assert.equal(await adapter.hasNormalDefaultSearchPage(), true);
  assert.equal(queries, 1, "the first check seeds from one query");
  assert.equal(await adapter.hasNormalDefaultSearchPage(), true);
  assert.equal(queries, 1, "later checks answer from tracked tabs without querying");

  const navigated = { id: 1, windowId: 7, incognito: false, url: "https://left.invalid/" };
  tabMap.set(1, navigated);
  tabs.onUpdated.emit(1, { url: navigated.url }, navigated);
  assert.equal(await adapter.hasNormalDefaultSearchPage(), false);

  const created = { id: 3, windowId: 7, incognito: false, url: "about:home" };
  tabMap.set(3, created);
  tabs.onCreated.emit(created);
  assert.equal(await adapter.hasNormalDefaultSearchPage(), true);

  tabMap.delete(3);
  tabs.onRemoved.emit(3, { windowId: 7 });
  assert.equal(await adapter.hasNormalDefaultSearchPage(), false);
  assert.equal(queries, 1, "event-driven changes never re-query");

  adapter.unsubscribe();
  assert.equal(await adapter.hasNormalDefaultSearchPage(), false);
  assert.equal(queries, 2, "without listeners the check falls back to a direct query");
});

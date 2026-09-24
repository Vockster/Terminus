import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVICON_CACHE_LIMITS,
  FAVICON_ERROR_CODES,
  FaviconError,
  digestFaviconSource,
  faviconSourceKey
} from "../../src/contracts/favicon-cache.js";
import { FaviconAcquisitionCoordinator } from "../../src/core/favicon-acquisition-coordinator.js";
import { FaviconCacheService } from "../../src/core/favicon-cache-service.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_ICON = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

function iconRecord(origin, digestCharacter, { bytes = PNG, updatedAt = 0, byteCount = bytes.byteLength, lastAccessedAt = 0 } = {}) {
  return {
    origin,
    blob: new Blob([bytes], { type: "image/png" }),
    mime: "image/png",
    byteCount,
    updatedAt,
    lastAccessedAt,
    sourceDigest: digestCharacter.length === 64 ? digestCharacter : digestCharacter.repeat(64)
  };
}

function memoryStorage() {
  const icons = new Map();
  const failures = new Map();
  let generation = 0;
  const calls = { reads: 0, puts: 0, failures: 0, failureClears: 0, touches: 0, clears: 0 };
  const removeWhere = (map, predicate) => {
    let removedCount = 0;
    let removedBytes = 0;
    for (const [key, record] of [...map]) {
      if (!predicate(record)) continue;
      map.delete(key);
      removedCount += 1;
      removedBytes += record.byteCount ?? 0;
    }
    return { removedCount, removedBytes };
  };
  return {
    calls,
    icons,
    failures,
    seedIcon(record) { icons.set(faviconSourceKey(record.origin, record.sourceDigest), record); },
    seedFailure(record) { failures.set(faviconSourceKey(record.origin, record.sourceDigest), record); },
    hasOrigin(origin) { return [...icons.values()].some((record) => record.origin === origin); },
    failureFor(origin) { return [...failures.values()].find((record) => record.origin === origin) ?? null; },
    async getIconsForOrigins(origins) {
      calls.reads += 1;
      return [...icons.values()].filter((record) => origins.includes(record.origin));
    },
    async getIcon(origin, sourceDigest) { calls.reads += 1; return icons.get(faviconSourceKey(origin, sourceDigest)) ?? null; },
    async getFailure(origin, sourceDigest) { calls.reads += 1; return failures.get(faviconSourceKey(origin, sourceDigest)) ?? null; },
    async listAccessNeeds() { return [...failures.values()].filter(({ accessOrigin }) => accessOrigin); },
    async clearFailure(origin, sourceDigest) { calls.failureClears += 1; failures.delete(faviconSourceKey(origin, sourceDigest)); },
    async clearFailuresForAccessOrigin(accessOrigin) {
      return { clearedCount: removeWhere(failures, (failure) => failure.accessOrigin === accessOrigin).removedCount };
    },
    async getGeneration() { calls.reads += 1; return generation; },
    async putIcon(record, expected) {
      if (expected !== generation) throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      calls.puts += 1;
      const key = faviconSourceKey(record.origin, record.sourceDigest);
      icons.set(key, record);
      failures.delete(key);
      return { record, evictedCount: 0 };
    },
    async putFailure(record, expected) {
      if (expected !== generation) throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      calls.failures += 1;
      failures.set(faviconSourceKey(record.origin, record.sourceDigest), record);
    },
    async touchAccess() { calls.touches += 1; },
    async listLru() { return [...icons.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt); },
    async removeOrigins(origins, expected = null) {
      if (expected !== null && expected !== generation) {
        throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      }
      const { removedCount, removedBytes } = removeWhere(icons, (record) => origins.includes(record.origin));
      removeWhere(failures, (record) => origins.includes(record.origin));
      if (removedCount) generation += 1;
      return { removedCount, removedBytes, generation };
    },
    async invalidate(origin) { return this.removeOrigins([origin]); },
    async clear() {
      calls.clears += 1;
      const result = { removedCount: icons.size, removedBytes: [...icons.values()].reduce((sum, item) => sum + item.byteCount, 0), generation: ++generation };
      icons.clear(); failures.clear(); return result;
    },
    async stats() { return { iconCount: icons.size, byteCount: [...icons.values()].reduce((sum, item) => sum + item.byteCount, 0), generation }; },
    close() {}
  };
}

function normalTab(candidateUrl = DATA_ICON) {
  return {
    tabId: 11,
    windowId: 7,
    pageUrl: "https://example.invalid/page",
    candidateUrl,
    origin: "https://example.invalid"
  };
}

test("cache lookup returns source-matched copied bytes without acquisition and private lookup is zero-touch", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://example.invalid", "a"));
  let acquired = 0;
  const browser = {
    async resolveTabReferences(windowId) {
      return windowId === 7 ? [{
        logicalId: "tab-one",
        firefoxTabId: 11,
        source: "website",
        origin: "https://example.invalid",
        sourceDigest: "a".repeat(64)
      }] : [];
    },
    async resolveTab() { acquired += 1; return null; },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  const result = await service.getForTabs(7, [{ logicalId: "tab-one", firefoxTabId: 11 }]);
  assert.deepEqual([...result.icons[0].bytes], [...PNG]);
  assert.deepEqual(
    Object.keys(result.icons[0]).sort(),
    ["bytes", "firefoxTabId", "logicalId", "mime", "substitute"].sort()
  );
  assert.equal(result.icons[0].substitute, false);
  assert.equal(acquired, 0);
  const reads = storage.calls.reads;
  assert.deepEqual(await service.getForTabs(8, [{ logicalId: "tab-private", firefoxTabId: 12 }]), { icons: [] });
  assert.equal(storage.calls.reads, reads);
});

test("tabs on one site with different icon sources each keep their own cached image", async () => {
  const storage = memoryStorage();
  const oldBuild = Uint8Array.of(...PNG, 1);
  const newBuild = Uint8Array.of(...PNG, 2);
  storage.seedIcon(iconRecord("https://video.invalid", "a", { bytes: oldBuild, updatedAt: 1 }));
  storage.seedIcon(iconRecord("https://video.invalid", "b", { bytes: newBuild, updatedAt: 2 }));
  let observed = 0;
  const browser = {
    async resolveTabReferences() {
      return [
        { logicalId: "tab-restored", firefoxTabId: 11, source: "website", origin: "https://video.invalid", sourceDigest: "a".repeat(64) },
        { logicalId: "tab-loaded", firefoxTabId: 12, source: "website", origin: "https://video.invalid", sourceDigest: "b".repeat(64) }
      ];
    },
    async resolveTab() { observed += 1; return null; },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  const references = [
    { logicalId: "tab-restored", firefoxTabId: 11 },
    { logicalId: "tab-loaded", firefoxTabId: 12 }
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    const { icons } = await service.getForTabs(7, references);
    assert.deepEqual(icons.map(({ logicalId, bytes }) => [logicalId, bytes.at(-1)]), [
      ["tab-restored", 1],
      ["tab-loaded", 2]
    ]);
  }
  assert.equal(observed, 0, "a lookup never starts a download or a refetch loop");
  assert.equal(storage.calls.puts, 0);
});

test("an uncached source shows the same site's newest icon without downloading from a lookup", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://example.invalid", "a", { bytes: Uint8Array.of(...PNG, 1), updatedAt: 5 }));
  storage.seedIcon(iconRecord("https://example.invalid", "c", { bytes: Uint8Array.of(...PNG, 3), updatedAt: 9 }));
  storage.seedIcon(iconRecord("https://other.invalid", "d", { bytes: Uint8Array.of(...PNG, 4), updatedAt: 99 }));
  let reacquisitions = 0;
  const browser = {
    async resolveTabReferences() {
      return [
        { logicalId: "tab-one", firefoxTabId: 11, source: "website", origin: "https://example.invalid", sourceDigest: "b".repeat(64) },
        { logicalId: "tab-unknown", firefoxTabId: 12, source: "website", origin: "https://unknown.invalid", sourceDigest: "e".repeat(64) },
        { logicalId: "tab-loading", firefoxTabId: 13, source: "pending" }
      ];
    },
    async resolveTab() { reacquisitions += 1; return null; },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  const result = await service.getForTabs(7, [
    { logicalId: "tab-one", firefoxTabId: 11 },
    { logicalId: "tab-unknown", firefoxTabId: 12 },
    { logicalId: "tab-loading", firefoxTabId: 13 }
  ]);
  assert.deepEqual(
    result.icons.map(({ logicalId, bytes, substitute }) => [logicalId, bytes.at(-1), substitute]),
    [["tab-one", 3, true]],
    "the stand-in is marked so the sidebar never trades a shown icon for it"
  );
  assert.deepEqual(result.pending, [{ logicalId: "tab-loading", firefoxTabId: 13 }]);
  assert.equal(storage.calls.touches, 0, "a fallback is not an access of the exact source");
  assert.equal(reacquisitions, 0);
});

test("a tab whose load starts or finishes during a lookup is reported settling, not iconless", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://example.invalid", "a"));
  const website = (logicalId, firefoxTabId) => ({
    logicalId, firefoxTabId, source: "website", origin: "https://example.invalid", sourceDigest: "a".repeat(64)
  });
  const loading = (logicalId, firefoxTabId) => ({ logicalId, firefoxTabId, source: "pending" });
  let resolution = 0;
  const browser = {
    async resolveTabReferences() {
      resolution += 1;
      // Tab 11 starts navigating and tab 12 receives its icon between reads.
      return resolution === 1
        ? [website("tab-starting", 11), loading("tab-finishing", 12)]
        : [loading("tab-starting", 11), website("tab-finishing", 12)];
    },
    async resolveTab() { return null; },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  const result = await service.getForTabs(7, [
    { logicalId: "tab-starting", firefoxTabId: 11 },
    { logicalId: "tab-finishing", firefoxTabId: 12 }
  ]);
  assert.deepEqual(result.icons, [], "no image is attached from a read that straddled a change");
  assert.deepEqual(result.pending, [
    { logicalId: "tab-starting", firefoxTabId: 11 },
    { logicalId: "tab-finishing", firefoxTabId: 12 }
  ]);
});

test("cache lookup fails closed when a live source changes during its IndexedDB read", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://example.invalid", "a"));
  let resolution = 0;
  let reacquisitions = 0;
  const browser = {
    async resolveTabReferences() {
      resolution += 1;
      return [{
        logicalId: "tab-one",
        firefoxTabId: 11,
        source: "website",
        origin: "https://example.invalid",
        sourceDigest: (resolution === 1 ? "a" : "b").repeat(64)
      }];
    },
    async resolveTab() { reacquisitions += 1; return null; },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  assert.deepEqual(
    await service.getForTabs(7, [{ logicalId: "tab-one", firefoxTabId: 11 }]),
    { icons: [], pending: [{ logicalId: "tab-one", firefoxTabId: 11 }] },
    "the stale image is withheld, and the tab keeps what it shows until its change settles"
  );
  assert.equal(resolution, 2);
  assert.equal(storage.calls.touches, 0);
  assert.equal(reacquisitions, 1);
});

test("New Tab uses the browser-provided default search icon while website navigation keeps website cache handling", async () => {
  const storage = memoryStorage();
  const websiteBytes = Uint8Array.from([1, 2, 3]);
  storage.seedIcon(iconRecord("https://custom-new-tab.invalid", "a", { bytes: websiteBytes }));
  let references = [{ logicalId: "tab-new", firefoxTabId: 11, source: "default-search" }];
  let searchReads = 0;
  const browser = {
    async resolveTabReferences() { return references; },
    async getDefaultSearchIconSource() { searchReads += 1; return DATA_ICON; },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  let result = await service.getForTabs(7, [{ logicalId: "tab-new", firefoxTabId: 11 }]);
  assert.deepEqual([...result.icons[0].bytes], [...PNG]);
  assert.deepEqual(
    Object.keys(result.icons[0]).sort(),
    ["bytes", "firefoxTabId", "logicalId", "mime", "substitute"].sort()
  );
  assert.equal(result.icons[0].substitute, false);
  assert.equal(storage.calls.reads, 0);
  assert.equal(searchReads, 1);

  references = [{
    logicalId: "tab-new",
    firefoxTabId: 11,
    source: "website",
    origin: "https://custom-new-tab.invalid",
    sourceDigest: "a".repeat(64)
  }];
  result = await service.getForTabs(7, [{ logicalId: "tab-new", firefoxTabId: 11 }]);
  assert.deepEqual([...result.icons[0].bytes], [...websiteBytes]);
  assert.deepEqual(
    Object.keys(result.icons[0]).sort(),
    ["bytes", "firefoxTabId", "logicalId", "mime", "substitute"].sort()
  );
  assert.equal(result.icons[0].substitute, false);
  assert.equal(searchReads, 1);
});

test("a missing or non-local browser search icon keeps the fallback without website storage or network", async () => {
  const storage = memoryStorage();
  let normalized = 0;
  const browser = {
    async resolveTabReferences() {
      return [{ logicalId: "tab-new", firefoxTabId: 11, source: "default-search" }];
    },
    async getDefaultSearchIconSource() { return "https://search.invalid/favicon.png"; },
    async normalizeRaster() { normalized += 1; },
    async fetchBytes() { throw new Error("default search icons must not fetch"); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  assert.deepEqual(await service.getForTabs(7, [{ logicalId: "tab-new", firefoxTabId: 11 }]), { icons: [], pending: [] });
  assert.equal(normalized, 0);
  assert.equal(storage.calls.reads, 0);
  assert.equal(storage.calls.puts, 0);
});

test("default search changes refresh open New Tab icons without persisting or fetching them", async () => {
  const storage = memoryStorage();
  const notifications = [];
  let source = DATA_ICON;
  let hasOpenPage = true;
  let searchReads = 0;
  const browser = {
    async resolveTab() { return { tabId: 11, windowId: 7, defaultSearchPage: true }; },
    async hasNormalDefaultSearchPage() { return hasOpenPage; },
    async getDefaultSearchIconSource() { searchReads += 1; return source; },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    onChanged: (change) => notifications.push(change)
  });
  await service.observeTab(11);
  assert.deepEqual(notifications, ["default-search"]);
  assert.equal(storage.calls.reads, 0);
  assert.equal(storage.calls.puts, 0);

  assert.deepEqual(await service.refreshDefaultSearchIconForOpenTabs(), {
    refreshed: true,
    changed: false,
    available: true
  });
  source = null;
  assert.deepEqual(await service.refreshDefaultSearchIconForOpenTabs(), {
    refreshed: true,
    changed: true,
    available: false
  });
  assert.deepEqual(notifications, ["default-search", "default-search"]);

  hasOpenPage = false;
  const readsBeforeSkip = searchReads;
  assert.deepEqual(await service.refreshDefaultSearchIconForOpenTabs(), {
    refreshed: false,
    changed: false
  });
  assert.equal(searchReads, readsBeforeSkip);
});

test("eligible event acquisition commits normalized PNG and durable retry suppresses failures", async () => {
  const storage = memoryStorage();
  const notifications = [];
  let current = normalTab();
  const browser = {
    async resolveTab() { return current; },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async fetchBytes() { throw new FaviconError(FAVICON_ERROR_CODES.NETWORK); },
    async hasHostAccess() { return true; },
    async listNormalOrigins() { return new Set(["https://example.invalid"]); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    onChanged: (change) => notifications.push(change),
    now: () => 1000
  });
  await service.observeTab(11);
  assert.equal(storage.calls.puts, 1);
  assert.deepEqual(notifications, ["icons"]);

  storage.icons.clear();
  current = normalTab("https://example.invalid/icon.png");
  await assert.rejects(() => service.observeTab(11), { code: FAVICON_ERROR_CODES.NETWORK });
  assert.equal(storage.calls.failures, 1);
  const reads = storage.calls.reads;
  await service.observeTab(11);
  assert.equal(storage.calls.failures, 1);
  assert.ok(storage.calls.reads > reads);
});

test("missing, granted, and revoked CDN access use one pending host and retry on site use", async () => {
  const storage = memoryStorage();
  const diagnostics = [];
  let accessGranted = false;
  let candidateUrl = "https://cdn.example.invalid/icon.png";
  let fetchSucceeds = false;
  const browser = {
    async resolveTab() { return normalTab(candidateUrl); },
    async hasHostAccess() { return accessGranted; },
    async fetchBytes() {
      if (!fetchSucceeds) throw new FaviconError(FAVICON_ERROR_CODES.NETWORK);
      return { bytes: PNG, mime: "image/png" };
    },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(["https://example.invalid"]); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    onDiagnostic: (reason) => diagnostics.push(reason),
    now: () => 1000
  });

  await assert.rejects(() => service.observeTab(11), { code: FAVICON_ERROR_CODES.MISSING_ACCESS });
  assert.equal(storage.failureFor("https://example.invalid").accessOrigin, "https://cdn.example.invalid");
  assert.deepEqual((await service.overview()).access.hosts, [{
    origin: "https://cdn.example.invalid",
    host: "cdn.example.invalid"
  }]);

  accessGranted = true;
  assert.deepEqual(await service.confirmHostAccess("https://cdn.example.invalid"), {
    origin: "https://cdn.example.invalid",
    clearedCount: 1
  });
  fetchSucceeds = true;
  await service.observeTab(11);
  assert.equal(storage.hasOrigin("https://example.invalid"), true);

  storage.icons.clear();
  accessGranted = false;
  fetchSucceeds = false;
  candidateUrl = "https://cdn.example.invalid/icon-v2.png";
  await assert.rejects(() => service.observeTab(11), { code: FAVICON_ERROR_CODES.MISSING_ACCESS });
  assert.deepEqual(diagnostics, ["missing-access", "saved", "missing-access"]);
});

test("storage overview reports only website icon totals and access needs", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://example.invalid", "a", { byteCount: 100 }));
  const service = new FaviconCacheService({
    storage,
    browser: { unsubscribe() {} },
    coordinator: new FaviconAcquisitionCoordinator()
  });

  const overview = await service.overview();
  assert.deepEqual(overview, {
    favicon: { available: true, iconCount: 1, byteCount: 100 },
    access: { available: true, hosts: [] }
  });
  assert.equal(Object.hasOwn(overview, "customIcons"), false);
  assert.equal(Object.hasOwn(overview, "approximateTotalBytes"), false);
});

test("gallery pages copy icon bytes and keep the cache revision cursor", async () => {
  const original = Uint8Array.of(...PNG, 7);
  const calls = [];
  const service = new FaviconCacheService({
    storage: {
      async listPage(request) {
        calls.push(request);
        return {
          records: [{
            ...iconRecord("https://example.invalid", "a", {
              bytes: original,
              updatedAt: 123
            }),
            partition: "private-container-key",
            candidateUrl: "https://secret.invalid/icon.png"
          }],
          revision: 9,
          nextOffset: 64
        };
      }
    },
    browser: { unsubscribe() {} },
    coordinator: new FaviconAcquisitionCoordinator()
  });

  const page = await service.listCachedIcons({ revision: 9, offset: 0 }, 64);
  assert.deepEqual(calls, [{ offset: 0, expectedRevision: 9, limit: 64 }]);
  assert.deepEqual(Object.keys(page.icons[0]).sort(), [
    "byteCount", "bytes", "mime", "origin", "updatedAt"
  ]);
  assert.deepEqual(page.nextCursor, { revision: 9, offset: 64 });
  assert.deepEqual(page.icons[0].bytes, original);
  assert.notStrictEqual(page.icons[0].bytes, original);
});

test("a host grant made outside Storage invalidates missing-access backoff on the next event", async () => {
  const storage = memoryStorage();
  let accessGranted = false;
  let fetchSucceeds = false;
  const browser = {
    async resolveTab() { return normalTab("https://cdn.example.invalid/icon.png"); },
    async hasHostAccess() { return accessGranted; },
    async fetchBytes() {
      if (!fetchSucceeds) throw new FaviconError(FAVICON_ERROR_CODES.NETWORK);
      return { bytes: PNG, mime: "image/png" };
    },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    now: () => 1000
  });
  await assert.rejects(() => service.observeTab(11), { code: FAVICON_ERROR_CODES.MISSING_ACCESS });
  accessGranted = true;
  fetchSucceeds = true;
  await service.observeTab(11);
  assert.equal(storage.calls.failureClears, 1);
  assert.equal(storage.hasOrigin("https://example.invalid"), true);
});

test("a pre-CDN policy backoff is removed on the next eligible event", async () => {
  const storage = memoryStorage();
  storage.seedFailure({
    origin: "https://example.invalid",
    sourceDigest: await digestFaviconSource("https://cdn.example.invalid/icon.png"),
    attemptedAt: 1,
    retryAt: Number.MAX_SAFE_INTEGER,
    failureClass: FAVICON_ERROR_CODES.NETWORK,
    policyVersion: 1,
    accessOrigin: null
  });
  const browser = {
    async resolveTab() { return normalTab("https://cdn.example.invalid/icon.png"); },
    async hasHostAccess() { return true; },
    async fetchBytes() { return { bytes: PNG, mime: "image/png" }; },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    now: () => 1000
  });
  await service.observeTab(11);
  assert.equal(storage.calls.failureClears, 1);
  assert.equal(storage.hasOrigin("https://example.invalid"), true);
});

test("policy retry migration preserves unrelated size backoff", async () => {
  const storage = memoryStorage();
  storage.seedFailure({
    origin: "https://example.invalid",
    sourceDigest: await digestFaviconSource("https://cdn.example.invalid/icon.png"),
    attemptedAt: 1,
    retryAt: Number.MAX_SAFE_INTEGER,
    failureClass: FAVICON_ERROR_CODES.TOO_LARGE,
    policyVersion: 1,
    accessOrigin: null
  });
  let fetches = 0;
  const browser = {
    async resolveTab() { return normalTab("https://cdn.example.invalid/icon.png"); },
    async fetchBytes() { fetches += 1; },
    async listNormalOrigins() { return new Set(); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    now: () => 1000
  });
  await service.observeTab(11);
  assert.equal(storage.calls.failureClears, 0);
  assert.equal(fetches, 0);
});

test("the bound-image-decoder policy retries an earlier decode failure", async () => {
  const storage = memoryStorage();
  storage.seedFailure({
    origin: "https://example.invalid",
    sourceDigest: await digestFaviconSource("https://cdn.example.invalid/icon.png"),
    attemptedAt: 1,
    retryAt: Number.MAX_SAFE_INTEGER,
    failureClass: FAVICON_ERROR_CODES.DECODE,
    policyVersion: 2,
    accessOrigin: null
  });
  const browser = {
    async resolveTab() { return normalTab("https://cdn.example.invalid/icon.png"); },
    async hasHostAccess() { return true; },
    async fetchBytes() { return { bytes: PNG, mime: "image/png" }; },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    now: () => 1000
  });
  await service.observeTab(11);
  assert.equal(storage.calls.failureClears, 1);
  assert.equal(storage.hasOrigin("https://example.invalid"), true);
});

test("one failing icon source never holds back a different source on the same site", async () => {
  const storage = memoryStorage();
  storage.seedFailure({
    origin: "https://example.invalid",
    sourceDigest: await digestFaviconSource("https://example.invalid/old-build/icon.png"),
    attemptedAt: 999,
    retryAt: Number.MAX_SAFE_INTEGER,
    failureClass: FAVICON_ERROR_CODES.NETWORK,
    policyVersion: 3,
    accessOrigin: null
  });
  let fetches = 0;
  const browser = {
    async resolveTab() { return normalTab("https://example.invalid/new-build/icon.png"); },
    async hasHostAccess() { return true; },
    async fetchBytes() { fetches += 1; return { bytes: PNG, mime: "image/png" }; },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    now: () => 1000
  });
  await service.observeTab(11);
  assert.equal(fetches, 1);
  assert.equal(storage.icons.size, 1);
  assert.equal(storage.failures.size, 1, "the unrelated source keeps its own backoff");
});

test("clear aborts in-flight work and generation prevents post-clear refill", async () => {
  const storage = memoryStorage();
  let release;
  let started;
  const startedGate = new Promise((resolve) => { started = resolve; });
  const decodeGate = new Promise((resolve) => { release = resolve; });
  const browser = {
    async resolveTab() { return normalTab(); },
    async normalizeRaster() { started(); await decodeGate; return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(); },
    unsubscribe() {}
  };
  const notifications = [];
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    onChanged: (change) => notifications.push(change)
  });
  const acquisition = service.observeTab(11);
  await startedGate;
  await service.clearAll();
  release();
  await assert.rejects(acquisition, { code: FAVICON_ERROR_CODES.NOT_RELEVANT });
  assert.equal(storage.calls.puts, 0);
  assert.equal(storage.icons.size, 0);
  assert.deepEqual(notifications, ["clear"]);
});

test("budget pressure removes only unprotected least-recently-used icons", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://old.invalid", "a", { byteCount: FAVICON_CACHE_LIMITS.softBudgetBytes, lastAccessedAt: 1 }));
  storage.seedIcon(iconRecord("https://protected.invalid", "a", { byteCount: 1, lastAccessedAt: 2 }));
  const browser = {
    async resolveTab() { return normalTab(); },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(["https://protected.invalid"]); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  await service.observeTab(11);
  assert.equal(storage.hasOrigin("https://old.invalid"), false);
  assert.equal(storage.hasOrigin("https://protected.invalid"), true);
  assert.equal(storage.hasOrigin("https://example.invalid"), true);
});

test("a committed pressure eviction notifies views even when admission later fails", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://old.invalid", "a", {
    byteCount: FAVICON_CACHE_LIMITS.softBudgetBytes,
    lastAccessedAt: 1,
    updatedAt: 1
  }));
  storage.putIcon = async () => {
    throw new FaviconError(FAVICON_ERROR_CODES.QUOTA);
  };
  const notifications = [];
  const browser = {
    async resolveTab() { return normalTab(); },
    async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
    async listNormalOrigins() { return new Set(["https://example.invalid"]); },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({
    storage,
    browser,
    coordinator: new FaviconAcquisitionCoordinator(),
    onChanged: (change) => notifications.push(change)
  });
  await assert.rejects(() => service.observeTab(11), { code: FAVICON_ERROR_CODES.QUOTA });
  assert.equal(storage.hasOrigin("https://old.invalid"), false);
  assert.deepEqual(notifications, ["icons"]);
});

test("independent acquisitions batch persistence and one affected-tab notification", async () => {
  const storage = memoryStorage();
  const putIcon = storage.putIcon.bind(storage);
  const batches = [];
  storage.putIcons = async (records, generation) => {
    batches.push(records.length);
    return Promise.all(records.map((record) => putIcon(record, generation)));
  };
  const tabs = new Map([
    [11, { ...normalTab(), tabId: 11 }],
    [12, {
      ...normalTab(),
      tabId: 12,
      pageUrl: "https://second.invalid/page",
      origin: "https://second.invalid"
    }]
  ]);
  const notifications = [];
  const service = new FaviconCacheService({
    storage,
    browser: {
      async resolveTab(tabId) { return tabs.get(tabId); },
      async normalizeRaster() { return new Blob([PNG], { type: "image/png" }); },
      async listNormalOrigins() { return new Set(); },
      unsubscribe() {}
    },
    coordinator: new FaviconAcquisitionCoordinator(),
    onChanged: (change, firefoxTabIds) => notifications.push({ change, firefoxTabIds })
  });

  await Promise.all([
    service.observeTab(11, { navigationChanged: true }),
    service.observeTab(12, { navigationChanged: true })
  ]);
  assert.deepEqual(batches, [2]);
  assert.deepEqual(notifications, [{ change: "icons", firefoxTabIds: [11, 12] }]);
});

test("a removed tab generation rejects late decoding before persistence", async () => {
  const storage = memoryStorage();
  let releaseDecode;
  let markDecodeStarted;
  const decodeStarted = new Promise((resolve) => { markDecodeStarted = resolve; });
  const decodeGate = new Promise((resolve) => { releaseDecode = resolve; });
  const service = new FaviconCacheService({
    storage,
    browser: {
      async resolveTab() { return normalTab(); },
      async normalizeRaster() {
        markDecodeStarted();
        await decodeGate;
        return new Blob([PNG], { type: "image/png" });
      },
      unsubscribe() {}
    },
    coordinator: new FaviconAcquisitionCoordinator()
  });

  const acquisition = service.observeTab(11, { navigationChanged: true });
  await decodeStarted;
  service.cancelTab(11);
  releaseDecode();
  await assert.rejects(acquisition, { code: FAVICON_ERROR_CODES.NOT_RELEVANT });
  assert.equal(storage.calls.puts, 0);
});

// A tab restored from a snapshot or created by bookmark import has never
// loaded, so it declares no icon URL and carries no digest. Its origin is still
// known, and the site's icon is often already on disk from another tab, so the
// row shows that image instead of a letter tile. This costs nothing: the bytes
// are already local and no request leaves the browser.
test("a never-loaded tab shows the stored icon for its origin without downloading", async () => {
  const storage = memoryStorage();
  storage.seedIcon(iconRecord("https://example.invalid", "a", { bytes: Uint8Array.of(...PNG, 1), updatedAt: 5 }));
  storage.seedIcon(iconRecord("https://example.invalid", "c", { bytes: Uint8Array.of(...PNG, 3), updatedAt: 9 }));
  let reacquisitions = 0;
  const browser = {
    async resolveTabReferences() {
      return [
        // Unloaded, origin known, no declared icon.
        { logicalId: "tab-imported", firefoxTabId: 21, source: "website", origin: "https://example.invalid" },
        // Same shape, but nothing stored for that site.
        { logicalId: "tab-unseen", firefoxTabId: 22, source: "website", origin: "https://unseen.invalid" }
      ];
    },
    async resolveTab() { reacquisitions += 1; return null; },
    unsubscribe() {}
  };
  const service = new FaviconCacheService({ storage, browser, coordinator: new FaviconAcquisitionCoordinator() });
  const result = await service.getForTabs(7, [
    { logicalId: "tab-imported", firefoxTabId: 21 },
    { logicalId: "tab-unseen", firefoxTabId: 22 }
  ]);

  assert.deepEqual(
    result.icons.map(({ logicalId, bytes, substitute }) => [logicalId, bytes.at(-1), substitute]),
    [["tab-imported", 3, true]],
    "the newest stored icon for the origin stands in, marked as a substitute"
  );
  // A site with nothing stored keeps its letter tile rather than inventing one.
  assert.equal(result.icons.some(({ logicalId }) => logicalId === "tab-unseen"), false);
  assert.deepEqual(result.pending, []);
  assert.equal(storage.calls.touches, 0, "a stand-in is not an access of an exact source");
  assert.equal(storage.calls.puts, 0);
  assert.equal(reacquisitions, 0, "nothing here reaches the network");
});

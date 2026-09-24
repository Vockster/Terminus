import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVICON_CACHE_LIMITS,
  FAVICON_ERROR_CODES,
  FAVICON_POLICY_VERSION
} from "../../src/contracts/favicon-cache.js";
import { FirefoxFaviconCacheStorage } from "../../src/platform/firefox/favicon-cache-storage.js";
import { FakeIndexedDBFactory } from "../helpers/fake-indexeddb.js";

function icon(origin, bytes, digestCharacter = "a", at = 100) {
  const blob = new Blob([Uint8Array.from({ length: bytes }, () => 1)], { type: "image/png" });
  return {
    origin,
    blob,
    mime: "image/png",
    byteCount: blob.size,
    updatedAt: at,
    lastAccessedAt: at,
    sourceDigest: digestCharacter.repeat(64)
  };
}

function failure(origin, digestCharacter, overrides = {}) {
  return {
    origin,
    sourceDigest: digestCharacter.repeat(64),
    attemptedAt: 300,
    retryAt: 400,
    failureClass: FAVICON_ERROR_CODES.NETWORK,
    policyVersion: FAVICON_POLICY_VERSION,
    accessOrigin: null,
    ...overrides
  };
}

test("IndexedDB favicon storage keeps count, bytes, failures, and generation atomic", async () => {
  const storage = new FirefoxFaviconCacheStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: "storage-accounting"
  });
  await storage.open();
  assert.deepEqual(await storage.stats(), {
    iconCount: 0,
    byteCount: 0,
    generation: 0,
    contentRevision: 0
  });
  await storage.putIcon(icon("https://one.invalid", 10), 0);
  await storage.putIcon(icon("https://two.invalid", 20, "b", 50), 0);
  await storage.putIcon(icon("https://one.invalid", 15, "a", 200), 0);
  assert.deepEqual(await storage.stats(), {
    iconCount: 2,
    byteCount: 35,
    generation: 0,
    contentRevision: 3
  });
  assert.deepEqual((await storage.listLru()).map(({ origin }) => origin), [
    "https://two.invalid", "https://one.invalid"
  ]);

  await storage.putFailure({
    origin: "https://two.invalid",
    sourceDigest: "d".repeat(64),
    attemptedAt: 300,
    retryAt: 400,
    failureClass: FAVICON_ERROR_CODES.NETWORK
  }, 0);
  assert.equal((await storage.getFailure("https://two.invalid", "d".repeat(64))).retryAt, 400);
  assert.equal(await storage.getFailure("https://two.invalid", "b".repeat(64)), null);

  await storage.putFailure(failure("https://three.invalid", "e", {
    failureClass: FAVICON_ERROR_CODES.MISSING_ACCESS,
    accessOrigin: "https://cdn.invalid"
  }), 0);
  assert.deepEqual((await storage.listAccessNeeds()).map(({ accessOrigin }) => accessOrigin), [
    "https://cdn.invalid"
  ]);
  assert.deepEqual(await storage.clearFailuresForAccessOrigin("https://cdn.invalid"), {
    clearedCount: 1
  });
  assert.equal(await storage.getFailure("https://three.invalid", "e".repeat(64)), null);

  const removed = await storage.invalidate("https://two.invalid");
  assert.deepEqual(removed, { removedCount: 1, removedBytes: 20, generation: 1 });
  assert.equal(await storage.getFailure("https://two.invalid", "d".repeat(64)), null);
  await assert.rejects(() => storage.putIcon(icon("https://three.invalid", 5), 0), {
    code: FAVICON_ERROR_CODES.STALE_GENERATION
  });
  assert.deepEqual(await storage.stats(), {
    iconCount: 1,
    byteCount: 15,
    generation: 1,
    contentRevision: 4
  });
  await assert.rejects(
    () => storage.removeOrigins(["https://one.invalid"], 0),
    { code: FAVICON_ERROR_CODES.STALE_GENERATION }
  );

  const absent = await storage.invalidate("https://absent.invalid");
  assert.deepEqual(absent, { removedCount: 0, removedBytes: 0, generation: 2 });

  const cleared = await storage.clear();
  assert.deepEqual(cleared, { removedCount: 1, removedBytes: 15, generation: 3 });
  assert.deepEqual(await storage.stats(), {
    iconCount: 0,
    byteCount: 0,
    generation: 3,
    contentRevision: 5
  });
  storage.close();
});

test("different icon sources on one site coexist and are removed together", async () => {
  const storage = new FirefoxFaviconCacheStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: "storage-sources"
  });
  await storage.putIcon(icon("https://video.invalid", 10, "a", 100), 0);
  await storage.putIcon(icon("https://video.invalid", 12, "b", 200), 0);
  await storage.putIcon(icon("https://other.invalid", 7, "a", 150), 0);
  await storage.putFailure(failure("https://video.invalid", "c"), 0);

  assert.deepEqual(
    (await storage.getIconsForOrigins(["https://video.invalid"])).map(({ sourceDigest }) => sourceDigest[0]).sort(),
    ["a", "b"]
  );
  assert.equal((await storage.getIcon("https://video.invalid", "b".repeat(64))).byteCount, 12);
  assert.equal(await storage.getIcon("https://video.invalid", "c".repeat(64)), null);
  assert.deepEqual(await storage.stats(), {
    iconCount: 3,
    byteCount: 29,
    generation: 0,
    contentRevision: 3
  });

  await storage.touchAccess([{ origin: "https://video.invalid", sourceDigest: "a".repeat(64) }], 900);
  assert.deepEqual((await storage.listLru()).map(({ origin, sourceDigest }) => `${origin}#${sourceDigest[0]}`), [
    "https://other.invalid#a", "https://video.invalid#b", "https://video.invalid#a"
  ]);

  assert.deepEqual(await storage.removeOrigins(["https://video.invalid"], 0), {
    removedCount: 2,
    removedBytes: 22,
    generation: 1
  });
  assert.equal(await storage.getFailure("https://video.invalid", "c".repeat(64)), null);
  assert.deepEqual(await storage.stats(), {
    iconCount: 1,
    byteCount: 7,
    generation: 1,
    contentRevision: 4
  });
  storage.close();
});

test("a site keeps a bounded number of icon sources and evicts its least recently used", async () => {
  const storage = new FirefoxFaviconCacheStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: "storage-origin-bound"
  });
  const limit = FAVICON_CACHE_LIMITS.maximumSourcesPerOrigin;
  const digit = (index) => index.toString(16).padStart(2, "0");
  for (let index = 0; index < limit; index += 1) {
    const record = icon("https://busy.invalid", 1, "a", 100 + index);
    record.sourceDigest = digit(index).repeat(32);
    await storage.putIcon(record, 0);
  }
  await storage.putIcon(icon("https://calm.invalid", 1, "f", 1), 0);
  const newest = icon("https://busy.invalid", 1, "a", 999);
  newest.sourceDigest = "ff".repeat(32);
  const { evictedCount } = await storage.putIcon(newest, 0);

  assert.equal(evictedCount, 1);
  const kept = await storage.getIconsForOrigins(["https://busy.invalid"]);
  assert.equal(kept.length, limit);
  assert.equal(kept.some(({ sourceDigest }) => sourceDigest === digit(0).repeat(32)), false);
  assert.equal((await storage.getIconsForOrigins(["https://calm.invalid"])).length, 1);
  assert.deepEqual(await storage.stats(), {
    iconCount: limit + 1,
    byteCount: limit + 1,
    generation: 0,
    contentRevision: limit + 2
  });
  storage.close();
});

test("upgrading a version-1 cache keeps its icons and failures under their exact sources", async () => {
  const factory = new FakeIndexedDBFactory();
  const legacy = await new Promise((resolve) => {
    const request = factory.open("storage-upgrade", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const icons = database.createObjectStore("icons", { keyPath: "origin" });
      icons.createIndex("lastAccessedAt", "lastAccessedAt");
      icons.put(icon("https://kept.invalid", 9, "a", 5));
      icons.put({ origin: "https://corrupt.invalid", blob: "not a blob" });
      database.createObjectStore("failures", { keyPath: "origin" }).put({
        origin: "https://failed.invalid",
        sourceDigest: "b".repeat(64),
        attemptedAt: 1,
        retryAt: 2,
        failureClass: FAVICON_ERROR_CODES.NETWORK
      });
      database.createObjectStore("meta", { keyPath: "key" }).put({
        key: "state", schemaVersion: 1, iconCount: 2, byteCount: 99, generation: 4
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
  legacy.close();

  const storage = new FirefoxFaviconCacheStorage({ indexedDB: factory, databaseName: "storage-upgrade" });
  await storage.open();
  const [kept] = await storage.getIconsForOrigins(["https://kept.invalid"]);
  assert.equal(kept.sourceDigest, "a".repeat(64));
  assert.equal(kept.byteCount, 9);
  assert.equal((await storage.getFailure("https://failed.invalid", "b".repeat(64))).policyVersion, 1);
  assert.deepEqual(await storage.stats(), {
    iconCount: 1,
    byteCount: 9,
    generation: 4,
    contentRevision: 0
  });
  await storage.putIcon(icon("https://kept.invalid", 3, "c", 6), 4);
  assert.equal((await storage.getIconsForOrigins(["https://kept.invalid"])).length, 2);
  storage.close();
});

test("the same source stays isolated across contextual-identity partitions", async () => {
  const storage = new FirefoxFaviconCacheStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: "storage-partitions"
  });
  const red = { ...icon("https://same.invalid", 10, "a"), partition: "1".repeat(64) };
  const blue = { ...icon("https://same.invalid", 20, "a"), partition: "2".repeat(64) };
  await storage.putIcons([red, blue], 0);

  assert.equal((await storage.getIcon(
    red.origin,
    red.sourceDigest,
    red.partition
  )).byteCount, 10);
  assert.equal((await storage.getIcon(
    blue.origin,
    blue.sourceDigest,
    blue.partition
  )).byteCount, 20);
  assert.deepEqual((await storage.getIconsForOrigins([
    { partition: red.partition, origin: red.origin }
  ])).map(({ byteCount }) => byteCount), [10]);
  assert.deepEqual(await storage.stats(), {
    iconCount: 2,
    byteCount: 30,
    generation: 0,
    contentRevision: 1
  });
});

test("gallery pages stay deterministic and reject a stale content revision", async () => {
  const storage = new FirefoxFaviconCacheStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: "storage-gallery-pages"
  });
  await storage.putIcon(icon("https://three.invalid", 3, "c", 30), 0);
  await storage.putIcon(icon("https://one.invalid", 1, "a", 10), 0);
  await storage.putIcon(icon("https://two.invalid", 2, "b", 20), 0);

  const first = await storage.listPage({ offset: 0, limit: 2 });
  assert.deepEqual(first.records.map(({ origin }) => origin), [
    "https://one.invalid",
    "https://three.invalid"
  ]);
  assert.equal(first.revision, 3);
  assert.equal(first.nextOffset, 2);

  const second = await storage.listPage({
    offset: first.nextOffset,
    limit: 2,
    expectedRevision: first.revision
  });
  assert.deepEqual(second.records.map(({ origin }) => origin), ["https://two.invalid"]);
  assert.equal(second.nextOffset, null);

  await storage.putIcon(icon("https://four.invalid", 4, "d", 40), 0);
  await assert.rejects(
    () => storage.listPage({ offset: 2, limit: 2, expectedRevision: first.revision }),
    { code: FAVICON_ERROR_CODES.STALE_GENERATION }
  );
  storage.close();
});

test("upgrading version 2 assigns unpartitioned rows only to the default identity", async () => {
  const factory = new FakeIndexedDBFactory();
  const legacy = await new Promise((resolve) => {
    const request = factory.open("storage-v2-upgrade", 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      const sources = database.createObjectStore("sources", { keyPath: "key" });
      sources.createIndex("origin", "origin");
      const record = icon("https://kept.invalid", 9, "a", 5);
      sources.put({ key: `${record.origin} ${record.sourceDigest}`, ...record });
      const failures = database.createObjectStore("sourceFailures", { keyPath: "key" });
      failures.createIndex("origin", "origin");
      const failed = failure("https://failed.invalid", "b");
      failures.put({ key: `${failed.origin} ${failed.sourceDigest}`, ...failed });
      database.createObjectStore("meta", { keyPath: "key" }).put({
        key: "state", schemaVersion: 1, iconCount: 1, byteCount: 9, generation: 2
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
  legacy.close();

  const storage = new FirefoxFaviconCacheStorage({
    indexedDB: factory,
    databaseName: "storage-v2-upgrade"
  });
  const [kept] = await storage.getIconsForOrigins(["https://kept.invalid"]);
  assert.equal(kept.partition, "default");
  assert.equal((await storage.getFailure(
    "https://failed.invalid",
    "b".repeat(64)
  )).partition, "default");
  assert.equal(await storage.getIcon(
    "https://kept.invalid",
    "a".repeat(64),
    "3".repeat(64)
  ), null);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_ICON_DATABASE_VERSION,
  CUSTOM_ICON_ERROR_CODES
} from "../../src/contracts/custom-icons.js";
import { FirefoxCustomIconStorage } from "../../src/platform/firefox/custom-icon-storage.js";
import { FakeIndexedDBFactory } from "../helpers/fake-indexeddb.js";
import { customIconRecord } from "../helpers/custom-icon-fixture.js";

const DATABASE_NAME = "custom-icons-test";

function openRaw(factory, version = CUSTOM_ICON_DATABASE_VERSION, onUpgrade = null) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, version);
    request.onupgradeneeded = () => onUpgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rawPut(factory, value) {
  const database = await openRaw(factory);
  const transaction = database.transaction("icons", "readwrite");
  await new Promise((resolve, reject) => {
    const request = transaction.objectStore("icons").put(value);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

test("icons round-trip through IndexedDB with their bytes and list in creation order", async () => {
  const storage = new FirefoxCustomIconStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: DATABASE_NAME
  });
  const later = customIconRecord({ seed: 2 });
  const earlier = customIconRecord({ seed: 1 });
  await storage.put(later);
  await storage.put(earlier);

  const loaded = await storage.get(earlier.id);
  assert.ok(loaded.bytes instanceof Uint8Array);
  assert.deepEqual(loaded.bytes, earlier.bytes);
  assert.deepEqual((await storage.list()).map(({ id }) => id), [earlier.id, later.id]);
  assert.deepEqual(await storage.stats(), {
    iconCount: 2,
    byteCount: earlier.byteLength + later.byteLength
  });

  await storage.remove(earlier.id);
  assert.equal(await storage.get(earlier.id), null);
  assert.deepEqual((await storage.list()).map(({ id }) => id), [later.id]);
  storage.close();
});

test("version one icon rows survive the compatibility-store migration", async () => {
  const factory = new FakeIndexedDBFactory();
  const database = await openRaw(factory, 1, (upgrading) => {
    upgrading.createObjectStore("icons", { keyPath: "id" });
  });
  const record = customIconRecord({ seed: 7 });
  const transaction = database.transaction("icons", "readwrite");
  await new Promise((resolve, reject) => {
    const request = transaction.objectStore("icons").put(record);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  database.close();

  const storage = new FirefoxCustomIconStorage({ indexedDB: factory, databaseName: DATABASE_NAME });
  assert.equal((await storage.get(record.id)).digest, record.digest);
  assert.deepEqual(await storage.listCompatibility(), []);
  storage.close();
});

test("an invalid record is rejected before it is written", async () => {
  const storage = new FirefoxCustomIconStorage({
    indexedDB: new FakeIndexedDBFactory(),
    databaseName: DATABASE_NAME
  });
  const record = customIconRecord();
  await assert.rejects(
    storage.put({ ...record, byteLength: 1 }),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(await storage.list(), []);
});

test("an unreadable stored row is left out instead of failing the whole library", async () => {
  const factory = new FakeIndexedDBFactory();
  const storage = new FirefoxCustomIconStorage({ indexedDB: factory, databaseName: DATABASE_NAME });
  const valid = customIconRecord({ seed: 1 });
  await storage.put(valid);
  const corrupt = customIconRecord({ seed: 2 });
  await rawPut(factory, { ...corrupt, label: "" });

  assert.deepEqual((await storage.list()).map(({ id }) => id), [valid.id]);
  assert.equal(await storage.get(corrupt.id), null);
  assert.deepEqual(await storage.stats(), { iconCount: 1, byteCount: valid.byteLength });
});

test("a damaged optional original is discarded while its normalized PNG remains usable", async () => {
  const factory = new FakeIndexedDBFactory();
  const storage = new FirefoxCustomIconStorage({ indexedDB: factory, databaseName: DATABASE_NAME });
  const record = customIconRecord({ seed: 3 });
  await storage.put(record);
  await rawPut(factory, {
    ...record,
    source: {
      mimeType: "image/svg+xml",
      byteLength: 99,
      bytes: new Uint8Array([1, 2, 3])
    }
  });

  const loaded = await storage.get(record.id);
  assert.equal(loaded.id, record.id);
  assert.equal(loaded.source, null);
  assert.deepEqual(await storage.stats(), {
    iconCount: 1,
    byteCount: record.byteLength
  });
});

test("usage includes retained originals and compatibility mappings are pruned atomically", async () => {
  const factory = new FakeIndexedDBFactory();
  const storage = new FirefoxCustomIconStorage({ indexedDB: factory, databaseName: DATABASE_NAME });
  const source = customIconRecord({ seed: 4 });
  const targetBase = customIconRecord({ seed: 5 });
  const original = new Uint8Array([60, 115, 118, 103, 62]);
  const target = {
    ...targetBase,
    source: {
      mimeType: "image/svg+xml",
      byteLength: original.byteLength,
      bytes: original
    }
  };
  await storage.put(source);
  await storage.put(target);
  await storage.putCompatibility({
    sourceId: source.id,
    mappings: [{ digest: target.digest, targetId: target.id }]
  });

  assert.deepEqual(await storage.stats(), {
    iconCount: 2,
    byteCount: source.byteLength + target.byteLength + original.byteLength
  });
  assert.equal((await storage.getCompatibility(source.id)).mappings[0].targetId, target.id);

  await storage.remove(target.id);
  assert.deepEqual(await storage.getCompatibility(source.id), {
    sourceId: source.id,
    mappings: []
  });
  await storage.remove(source.id);
  assert.equal(await storage.getCompatibility(source.id), null);
});

test("a missing IndexedDB factory reports storage as unavailable", async () => {
  const storage = new FirefoxCustomIconStorage({ indexedDB: null });
  await assert.rejects(
    storage.list(),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE
  );
});

import {
  FAVICON_CACHE_DATABASE_NAME,
  FAVICON_CACHE_DATABASE_VERSION,
  FAVICON_DEFAULT_PARTITION,
  FAVICON_CACHE_LIMITS,
  FAVICON_ERROR_CODES,
  FaviconError,
  faviconSourceKey,
  parseFaviconFailureRecord,
  parseFaviconIconRecord
} from "../../contracts/favicon-cache.js";

// Version 1 kept one icon and one failure per origin. Tabs on one site that
// reported different icon URLs then replaced each other's record on every
// save, which made their rows flicker and refetch indefinitely.
const LEGACY_ICONS_STORE = "icons";
const LEGACY_FAILURES_STORE = "failures";
const SOURCES_STORE = "sources";
const SOURCE_FAILURES_STORE = "sourceFailures";
const ORIGIN_INDEX = "origin";
const PARTITION_ORIGIN_INDEX = "partitionOrigin";
const META_STORE = "meta";
const META_KEY = "state";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function translateStorageError(error) {
  if (error instanceof FaviconError) return error;
  const name = error?.name;
  if (name === "QuotaExceededError") return new FaviconError(FAVICON_ERROR_CODES.QUOTA, { cause: error });
  return new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE, { cause: error });
}

function defaultMeta() {
  return {
    key: META_KEY,
    schemaVersion: 1,
    iconCount: 0,
    byteCount: 0,
    generation: 0,
    contentRevision: 0
  };
}

function parseMeta(value) {
  if (
    value?.key !== META_KEY ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.iconCount) || value.iconCount < 0 ||
    !Number.isSafeInteger(value.byteCount) || value.byteCount < 0 ||
    !Number.isSafeInteger(value.generation) || value.generation < 0 ||
    (value.contentRevision !== undefined &&
      (!Number.isSafeInteger(value.contentRevision) || value.contentRevision < 0))
  ) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  return { ...value, contentRevision: value.contentRevision ?? 0 };
}

function storedIcon(record) {
  return {
    key: faviconSourceKey(record.partition, record.origin, record.sourceDigest),
    partitionOrigin: `${record.partition} ${record.origin}`,
    ...record
  };
}

function storedFailure(record) {
  return {
    key: faviconSourceKey(record.partition, record.origin, record.sourceDigest),
    partitionOrigin: `${record.partition} ${record.origin}`,
    ...record
  };
}

function tryParse(parse, value) {
  try {
    return parse(value);
  } catch {
    return null;
  }
}

async function runTransaction(database, stores, mode, operation) {
  const transaction = database.transaction(stores, mode);
  const done = transactionDone(transaction);
  try {
    const result = await operation(transaction);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // It may already have completed or aborted.
    }
    try {
      await done;
    } catch {
      // Preserve the policy error from the operation when one exists.
    }
    throw translateStorageError(error);
  }
}

function ensureStore(database, transaction, name) {
  const store = database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath: "key" });
  if (!store.indexNames.contains(ORIGIN_INDEX)) {
    store.createIndex(ORIGIN_INDEX, ORIGIN_INDEX, { unique: false });
  }
  if (!store.indexNames.contains(PARTITION_ORIGIN_INDEX)) {
    store.createIndex(PARTITION_ORIGIN_INDEX, PARTITION_ORIGIN_INDEX, { unique: false });
  }
  return store;
}

function migrateUnpartitionedSourceStores(sources, failures) {
  const migrate = (store, parse, stored) => {
    const request = store.getAll();
    request.onsuccess = () => {
      for (const value of request.result ?? []) {
        if (typeof value?.partition === "string") continue;
        const { key, partitionOrigin: _partitionOrigin, ...record } = value;
        const parsed = tryParse(parse, { ...record, partition: FAVICON_DEFAULT_PARTITION });
        if (key !== undefined) store.delete(key);
        if (parsed) store.put(stored(parsed));
      }
    };
  };
  migrate(sources, parseFaviconIconRecord, storedIcon);
  migrate(failures, parseFaviconFailureRecord, storedFailure);
}

// Copies version-1 rows into the per-source stores inside the upgrade
// transaction, then removes the legacy stores. Unreadable legacy rows are
// dropped: the cache is disposable, and the meta totals are recounted from
// what was actually kept.
function migrateLegacyStores(database, transaction, sources, failures, meta) {
  const hasIcons = database.objectStoreNames.contains(LEGACY_ICONS_STORE);
  const hasFailures = database.objectStoreNames.contains(LEGACY_FAILURES_STORE);
  if (!hasIcons && !hasFailures) return;
  const finishIcons = (values) => {
    let iconCount = 0;
    let byteCount = 0;
    for (const value of values) {
      const record = tryParse(parseFaviconIconRecord, value);
      if (!record) continue;
      sources.put(storedIcon(record));
      iconCount += 1;
      byteCount += record.byteCount;
    }
    const metaRequest = meta.get(META_KEY);
    metaRequest.onsuccess = () => {
      const current = tryParse(parseMeta, metaRequest.result) ?? defaultMeta();
      meta.put({ ...current, iconCount, byteCount });
    };
    database.deleteObjectStore(LEGACY_ICONS_STORE);
  };
  const finishFailures = (values) => {
    for (const value of values) {
      const record = tryParse(parseFaviconFailureRecord, value);
      if (record) failures.put(storedFailure(record));
    }
    database.deleteObjectStore(LEGACY_FAILURES_STORE);
  };
  if (hasIcons) {
    const request = transaction.objectStore(LEGACY_ICONS_STORE).getAll();
    request.onsuccess = () => finishIcons(request.result ?? []);
  }
  if (hasFailures) {
    const request = transaction.objectStore(LEGACY_FAILURES_STORE).getAll();
    request.onsuccess = () => finishFailures(request.result ?? []);
  }
}

export class FirefoxFaviconCacheStorage {
  #factory;
  #databaseName;
  #databasePromise = null;
  #database = null;

  constructor({ indexedDB = globalThis.indexedDB, databaseName = FAVICON_CACHE_DATABASE_NAME } = {}) {
    this.#factory = indexedDB;
    this.#databaseName = databaseName;
  }

  async open() {
    if (!this.#factory?.open) throw new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE);
    if (this.#databasePromise) return this.#databasePromise;
    this.#databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      try {
        request = this.#factory.open(this.#databaseName, FAVICON_CACHE_DATABASE_VERSION);
      } catch (error) {
        reject(translateStorageError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;
        const sources = ensureStore(database, transaction, SOURCES_STORE);
        const failures = ensureStore(database, transaction, SOURCE_FAILURES_STORE);
        const hasMetaStore = database.objectStoreNames.contains(META_STORE);
        const meta = hasMetaStore
          ? transaction.objectStore(META_STORE)
          : database.createObjectStore(META_STORE, { keyPath: "key" });
        if (!hasMetaStore) meta.put(defaultMeta());
        migrateLegacyStores(database, transaction, sources, failures, meta);
        migrateUnpartitionedSourceStores(sources, failures);
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          reject(new FaviconError(FAVICON_ERROR_CODES.BLOCKED));
        }
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(translateStorageError(request.error));
        }
      };
      request.onsuccess = async () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          if (this.#database === database) {
            this.#database = null;
            this.#databasePromise = null;
          }
        };
        try {
          await this.#verifyOrInitializeMeta(database);
          this.#database = database;
          settled = true;
          resolve(database);
        } catch (error) {
          database.close();
          settled = true;
          reject(translateStorageError(error));
        }
      };
    }).catch((error) => {
      this.#databasePromise = null;
      throw error;
    });
    return this.#databasePromise;
  }

  async #verifyOrInitializeMeta(database) {
    const transaction = database.transaction(META_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(META_STORE);
    const existing = await requestResult(store.get(META_KEY));
    if (existing === undefined) store.put(defaultMeta());
    else parseMeta(existing);
    await done;
  }

  async #databaseHandle() {
    return this.#database ?? this.open();
  }

  // Every cached source for each requested origin, so a lookup can serve an
  // exact source and fall back to that site's newest icon.
  async getIconsForOrigins(origins) {
    const unique = [...new Map(origins.map((value) => {
      const request = typeof value === "string"
        ? { partition: FAVICON_DEFAULT_PARTITION, origin: value }
        : value;
      return [`${request.partition} ${request.origin}`, request];
    })).values()];
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCES_STORE, "readonly", async (transaction) => {
      const index = transaction.objectStore(SOURCES_STORE).index(PARTITION_ORIGIN_INDEX);
      const groups = await Promise.all(unique.map(({ partition, origin }) =>
        requestResult(index.getAll(`${partition} ${origin}`))
      ));
      return groups.flat().map(parseFaviconIconRecord);
    });
  }

  async getIcon(origin, sourceDigest, partition = FAVICON_DEFAULT_PARTITION) {
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCES_STORE, "readonly", async (transaction) => {
      const value = await requestResult(
        transaction.objectStore(SOURCES_STORE).get(faviconSourceKey(partition, origin, sourceDigest))
      );
      return value === undefined ? null : parseFaviconIconRecord(value);
    });
  }

  async getFailure(origin, sourceDigest, partition = FAVICON_DEFAULT_PARTITION) {
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCE_FAILURES_STORE, "readonly", async (transaction) => {
      const value = await requestResult(
        transaction.objectStore(SOURCE_FAILURES_STORE).get(
          faviconSourceKey(partition, origin, sourceDigest)
        )
      );
      return value === undefined ? null : parseFaviconFailureRecord(value);
    });
  }

  async listAccessNeeds() {
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCE_FAILURES_STORE, "readonly", async (transaction) => {
      const values = await requestResult(transaction.objectStore(SOURCE_FAILURES_STORE).getAll());
      return values
        .map(parseFaviconFailureRecord)
        .filter(({ accessOrigin }) => accessOrigin !== null);
    });
  }

  async clearFailure(origin, sourceDigest, partition = FAVICON_DEFAULT_PARTITION) {
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCE_FAILURES_STORE, "readwrite", async (transaction) => {
      transaction.objectStore(SOURCE_FAILURES_STORE).delete(
        faviconSourceKey(partition, origin, sourceDigest)
      );
    });
  }

  async clearFailuresForAccessOrigin(accessOrigin) {
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCE_FAILURES_STORE, "readwrite", async (transaction) => {
      const store = transaction.objectStore(SOURCE_FAILURES_STORE);
      const values = await requestResult(store.getAll());
      let clearedCount = 0;
      for (const value of values) {
        const record = parseFaviconFailureRecord(value);
        if (record.accessOrigin !== accessOrigin) continue;
        store.delete(faviconSourceKey(record.partition, record.origin, record.sourceDigest));
        clearedCount += 1;
      }
      return { clearedCount };
    });
  }

  async getGeneration() {
    const database = await this.#databaseHandle();
    return runTransaction(database, META_STORE, "readonly", async (transaction) => {
      const meta = parseMeta(await requestResult(transaction.objectStore(META_STORE).get(META_KEY)));
      return meta.generation;
    });
  }

  async putIcon(record, expectedGeneration) {
    return (await this.putIcons([record], expectedGeneration))[0];
  }

  async putIcons(records, expectedGeneration) {
    const parsedRecords = records.map(parseFaviconIconRecord);
    if (parsedRecords.length === 0) return [];
    const database = await this.#databaseHandle();
    return runTransaction(database, [SOURCES_STORE, SOURCE_FAILURES_STORE, META_STORE], "readwrite", async (transaction) => {
      const sources = transaction.objectStore(SOURCES_STORE);
      const metaStore = transaction.objectStore(META_STORE);
      const meta = parseMeta(await requestResult(metaStore.get(META_KEY)));
      if (meta.generation !== expectedGeneration) throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      const results = [];
      for (const parsed of parsedRecords) {
        const key = faviconSourceKey(parsed.partition, parsed.origin, parsed.sourceDigest);
        const siblings = (await requestResult(
          sources.index(PARTITION_ORIGIN_INDEX).getAll(`${parsed.partition} ${parsed.origin}`)
        )).filter((value) => value.key !== key);
        const previous = await requestResult(sources.get(key));
        sources.put(storedIcon(parsed));
        transaction.objectStore(SOURCE_FAILURES_STORE).delete(key);
        meta.iconCount += previous ? 0 : 1;
        meta.byteCount += parsed.byteCount - (previous?.byteCount ?? 0);
        // Least recently used sources beyond the per-partition origin bound
        // are evicted without invalidating unrelated in-flight saves.
        const overflow = siblings.length + 1 - FAVICON_CACHE_LIMITS.maximumSourcesPerOrigin;
        let evictedCount = 0;
        if (overflow > 0) {
          const evicted = siblings
            .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)
            .slice(0, overflow);
          for (const value of evicted) {
            sources.delete(value.key);
            meta.iconCount -= 1;
            meta.byteCount -= value.byteCount;
            evictedCount += 1;
          }
        }
        results.push({ record: parseFaviconIconRecord(parsed), evictedCount });
      }
      meta.contentRevision += 1;
      metaStore.put(meta);
      return results;
    });
  }

  async putFailure(record, expectedGeneration) {
    const parsed = parseFaviconFailureRecord(record);
    const database = await this.#databaseHandle();
    return runTransaction(database, [SOURCE_FAILURES_STORE, META_STORE], "readwrite", async (transaction) => {
      const meta = parseMeta(await requestResult(transaction.objectStore(META_STORE).get(META_KEY)));
      if (meta.generation !== expectedGeneration) throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      transaction.objectStore(SOURCE_FAILURES_STORE).put(storedFailure(parsed));
      return parsed;
    });
  }

  async touchAccess(sources, at) {
    if (sources.length === 0) return;
    const keys = new Set(sources.map(({ partition = FAVICON_DEFAULT_PARTITION, origin, sourceDigest }) =>
      faviconSourceKey(partition, origin, sourceDigest)
    ));
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCES_STORE, "readwrite", async (transaction) => {
      const store = transaction.objectStore(SOURCES_STORE);
      for (const key of keys) {
        const value = await requestResult(store.get(key));
        if (value) store.put({ ...value, lastAccessedAt: at });
      }
    });
  }

  async listLru() {
    const database = await this.#databaseHandle();
    return runTransaction(database, SOURCES_STORE, "readonly", async (transaction) => {
      const values = await requestResult(transaction.objectStore(SOURCES_STORE).getAll());
      return values.map(parseFaviconIconRecord).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    });
  }

  async listPage({ offset, limit, expectedRevision = null }) {
    const database = await this.#databaseHandle();
    return runTransaction(database, [SOURCES_STORE, META_STORE], "readonly", async (transaction) => {
      const meta = parseMeta(await requestResult(transaction.objectStore(META_STORE).get(META_KEY)));
      if (expectedRevision !== null && meta.contentRevision !== expectedRevision) {
        throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      }
      const values = await requestResult(transaction.objectStore(SOURCES_STORE).getAll());
      const records = values.map(parseFaviconIconRecord).sort((left, right) =>
        left.origin.localeCompare(right.origin) ||
        left.partition.localeCompare(right.partition) ||
        left.sourceDigest.localeCompare(right.sourceDigest)
      );
      const page = records.slice(offset, offset + limit);
      return {
        records: page,
        revision: meta.contentRevision,
        nextOffset: offset + page.length < records.length ? offset + page.length : null
      };
    });
  }

  async #removeOriginRows(transaction, origins) {
    const sources = transaction.objectStore(SOURCES_STORE);
    const failures = transaction.objectStore(SOURCE_FAILURES_STORE);
    let removedCount = 0;
    let removedBytes = 0;
    for (const origin of origins) {
      for (const value of await requestResult(sources.index(ORIGIN_INDEX).getAll(origin))) {
        sources.delete(value.key);
        removedCount += 1;
        removedBytes += value.byteCount;
      }
      for (const value of await requestResult(failures.index(ORIGIN_INDEX).getAll(origin))) {
        failures.delete(value.key);
      }
    }
    return { removedCount, removedBytes };
  }

  async removeOrigins(origins, expectedGeneration = null) {
    const requested = [...new Set(origins)];
    if (requested.length === 0) return { removedCount: 0, removedBytes: 0, generation: await this.getGeneration() };
    const database = await this.#databaseHandle();
    return runTransaction(database, [SOURCES_STORE, SOURCE_FAILURES_STORE, META_STORE], "readwrite", async (transaction) => {
      const metaStore = transaction.objectStore(META_STORE);
      const meta = parseMeta(await requestResult(metaStore.get(META_KEY)));
      if (expectedGeneration !== null && meta.generation !== expectedGeneration) {
        throw new FaviconError(FAVICON_ERROR_CODES.STALE_GENERATION);
      }
      const { removedCount, removedBytes } = await this.#removeOriginRows(transaction, requested);
      meta.iconCount -= removedCount;
      meta.byteCount -= removedBytes;
      if (removedCount > 0) {
        meta.generation += 1;
        meta.contentRevision += 1;
      }
      metaStore.put(meta);
      return { removedCount, removedBytes, generation: meta.generation };
    });
  }

  async invalidate(origin) {
    const database = await this.#databaseHandle();
    return runTransaction(database, [SOURCES_STORE, SOURCE_FAILURES_STORE, META_STORE], "readwrite", async (transaction) => {
      const metaStore = transaction.objectStore(META_STORE);
      const meta = parseMeta(await requestResult(metaStore.get(META_KEY)));
      const { removedCount, removedBytes } = await this.#removeOriginRows(transaction, [origin]);
      meta.iconCount -= removedCount;
      meta.byteCount -= removedBytes;
      meta.generation += 1;
      if (removedCount > 0) meta.contentRevision += 1;
      metaStore.put(meta);
      return { removedCount, removedBytes, generation: meta.generation };
    });
  }

  async clear() {
    const database = await this.#databaseHandle();
    return runTransaction(database, [SOURCES_STORE, SOURCE_FAILURES_STORE, META_STORE], "readwrite", async (transaction) => {
      const metaStore = transaction.objectStore(META_STORE);
      const previous = parseMeta(await requestResult(metaStore.get(META_KEY)));
      transaction.objectStore(SOURCES_STORE).clear();
      transaction.objectStore(SOURCE_FAILURES_STORE).clear();
      const next = {
        ...defaultMeta(),
        generation: previous.generation + 1,
        contentRevision: previous.contentRevision + 1
      };
      metaStore.put(next);
      return { removedCount: previous.iconCount, removedBytes: previous.byteCount, generation: next.generation };
    });
  }

  async stats() {
    const database = await this.#databaseHandle();
    return runTransaction(database, META_STORE, "readonly", async (transaction) => {
      const meta = parseMeta(await requestResult(transaction.objectStore(META_STORE).get(META_KEY)));
      return {
        iconCount: meta.iconCount,
        byteCount: meta.byteCount,
        generation: meta.generation,
        contentRevision: meta.contentRevision
      };
    });
  }

  close() {
    this.#database?.close();
    this.#database = null;
    this.#databasePromise = null;
  }
}

export function createFirefoxFaviconCacheStorage(options) {
  return new FirefoxFaviconCacheStorage(options);
}

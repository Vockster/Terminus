import {
  CUSTOM_ICON_DATABASE_NAME,
  CUSTOM_ICON_DATABASE_VERSION,
  CUSTOM_ICON_ERROR_CODES,
  CustomIconError,
  parseCustomIconCompatibilityRecord,
  parseStoredCustomIconRecord,
  parseCustomIconRecord
} from "../../contracts/custom-icons.js";

const ICONS_STORE = "icons";
const COMPATIBILITY_STORE = "compatibility";

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

function storageError(error) {
  if (error instanceof CustomIconError) return error;
  return new CustomIconError(CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE, { cause: error });
}

function byCreation(left, right) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class FirefoxCustomIconStorage {
  #factory;
  #databaseName;
  #databasePromise = null;
  #database = null;

  constructor({ indexedDB = globalThis.indexedDB, databaseName = CUSTOM_ICON_DATABASE_NAME } = {}) {
    this.#factory = indexedDB;
    this.#databaseName = databaseName;
  }

  async open() {
    if (!this.#factory?.open) throw storageError();
    if (this.#databasePromise) return this.#databasePromise;
    this.#databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      try {
        request = this.#factory.open(this.#databaseName, CUSTOM_ICON_DATABASE_VERSION);
      } catch (error) {
        settled = true;
        reject(storageError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ICONS_STORE)) {
          database.createObjectStore(ICONS_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(COMPATIBILITY_STORE)) {
          database.createObjectStore(COMPATIBILITY_STORE, { keyPath: "sourceId" });
        }
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          reject(storageError());
        }
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(storageError(request.error));
        }
      };
      request.onsuccess = () => {
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
        this.#database = database;
        settled = true;
        resolve(database);
      };
    }).catch((error) => {
      this.#databasePromise = null;
      throw error;
    });
    return this.#databasePromise;
  }

  async #run(storeNames, mode, operation) {
    const database = this.#database ?? await this.open();
    const transaction = database.transaction(storeNames, mode);
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction);
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed or aborted.
      }
      try {
        await done;
      } catch {
        // Preserve the original request or policy failure.
      }
      throw error;
    }
  }

  async get(id) {
    let value;
    try {
      value = await this.#run(ICONS_STORE, "readonly", (transaction) =>
        requestResult(transaction.objectStore(ICONS_STORE).get(id))
      );
    } catch (error) {
      throw storageError(error);
    }
    if (value === undefined) return null;
    try {
      return parseStoredCustomIconRecord(value);
    } catch {
      return null;
    }
  }

  // Rows that no longer parse cannot be drawn, so they are left out rather
  // than making the whole library unavailable.
  async list() {
    let values;
    try {
      values = await this.#run(ICONS_STORE, "readonly", (transaction) =>
        requestResult(transaction.objectStore(ICONS_STORE).getAll())
      );
    } catch (error) {
      throw storageError(error);
    }
    const icons = [];
    for (const value of values) {
      try {
        icons.push(parseStoredCustomIconRecord(value));
      } catch {
        // Skip an unreadable row.
      }
    }
    return icons.sort(byCreation);
  }

  async put(value) {
    const parsed = parseCustomIconRecord(value);
    try {
      await this.#run(ICONS_STORE, "readwrite", (transaction) =>
        requestResult(transaction.objectStore(ICONS_STORE).put({
          ...parsed,
          bytes: new Uint8Array(parsed.bytes),
          ...(parsed.source === null ? {} : {
            source: {
              mimeType: parsed.source.mimeType,
              byteLength: parsed.source.byteLength,
              bytes: new Uint8Array(parsed.source.bytes)
            }
          })
        }))
      );
    } catch (error) {
      throw storageError(error);
    }
    return parsed;
  }

  async remove(id) {
    try {
      await this.#run(
        [ICONS_STORE, COMPATIBILITY_STORE],
        "readwrite",
        async (transaction) => {
          const iconStore = transaction.objectStore(ICONS_STORE);
          const compatibilityStore = transaction.objectStore(COMPATIBILITY_STORE);
          const [rawIcons, rawCompatibility] = await Promise.all([
            requestResult(iconStore.getAll()),
            requestResult(compatibilityStore.getAll())
          ]);
          const liveIds = new Set();
          for (const value of rawIcons) {
            try {
              const icon = parseStoredCustomIconRecord(value);
              if (icon.id !== id) liveIds.add(icon.id);
            } catch {
              // An unreadable icon cannot make a compatibility target live.
            }
          }
          await requestResult(iconStore.delete(id));
          for (const value of rawCompatibility) {
            let record;
            try {
              record = parseCustomIconCompatibilityRecord(value);
            } catch {
              continue;
            }
            const mappings = record.mappings.filter(({ targetId }) => liveIds.has(targetId));
            if (!liveIds.has(record.sourceId) && mappings.length === 0) {
              await requestResult(compatibilityStore.delete(record.sourceId));
            } else if (mappings.length !== record.mappings.length) {
              await requestResult(compatibilityStore.put({
                sourceId: record.sourceId,
                mappings
              }));
            }
          }
        }
      );
    } catch (error) {
      throw storageError(error);
    }
  }

  async getCompatibility(sourceId) {
    let value;
    try {
      value = await this.#run(COMPATIBILITY_STORE, "readonly", (transaction) =>
        requestResult(transaction.objectStore(COMPATIBILITY_STORE).get(sourceId))
      );
    } catch (error) {
      throw storageError(error);
    }
    if (value === undefined) return null;
    try {
      return parseCustomIconCompatibilityRecord(value);
    } catch {
      return null;
    }
  }

  async listCompatibility() {
    let values;
    try {
      values = await this.#run(COMPATIBILITY_STORE, "readonly", (transaction) =>
        requestResult(transaction.objectStore(COMPATIBILITY_STORE).getAll())
      );
    } catch (error) {
      throw storageError(error);
    }
    const records = [];
    for (const value of values) {
      try {
        records.push(parseCustomIconCompatibilityRecord(value));
      } catch {
        // Corrupt compatibility metadata can only make a legacy icon fall
        // back to House; it never makes the icon library unavailable.
      }
    }
    return records.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  }

  async putCompatibility(value) {
    const parsed = parseCustomIconCompatibilityRecord(value);
    try {
      await this.#run(COMPATIBILITY_STORE, "readwrite", (transaction) =>
        requestResult(transaction.objectStore(COMPATIBILITY_STORE).put(parsed))
      );
    } catch (error) {
      throw storageError(error);
    }
    return parsed;
  }

  async removeCompatibility(sourceId) {
    try {
      await this.#run(COMPATIBILITY_STORE, "readwrite", (transaction) =>
        requestResult(transaction.objectStore(COMPATIBILITY_STORE).delete(sourceId))
      );
    } catch (error) {
      throw storageError(error);
    }
  }

  async stats() {
    const icons = await this.list();
    return {
      iconCount: icons.length,
      byteCount: icons.reduce(
        (total, icon) => total + icon.byteLength + (icon.source?.byteLength ?? 0),
        0
      )
    };
  }

  close() {
    this.#database?.close();
    this.#database = null;
    this.#databasePromise = null;
  }
}

export function createFirefoxCustomIconStorage(options) {
  return new FirefoxCustomIconStorage(options);
}

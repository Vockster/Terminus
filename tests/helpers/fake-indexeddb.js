function names(values) {
  return Object.freeze({
    contains(value) {
      return values.has(value);
    }
  });
}

class FakeRequest {
  result;
  error = null;
  onsuccess = null;
  onerror = null;
}

class FakeTransaction {
  #database;
  #pending = 0;
  #settled = false;
  oncomplete = null;
  onabort = null;
  onerror = null;
  error = null;

  constructor(database) {
    this.#database = database;
    this.#scheduleCompletion();
  }

  // IndexedDB keeps a transaction active while promise continuations of a
  // request's success place further requests; completing in a microtask
  // would drop those requests, so completion waits for the next macrotask.
  #scheduleCompletion() {
    setImmediate(() => this.#completeIfIdle());
  }

  objectStore(name) {
    const state = this.#database.stores.get(name);
    if (!state) throw Object.assign(new Error("Missing object store."), { name: "NotFoundError" });
    return new FakeObjectStore(state, this);
  }

  request(operation) {
    const request = new FakeRequest();
    this.#pending += 1;
    queueMicrotask(() => {
      if (this.#settled) return;
      try {
        request.result = operation();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        this.error = error;
        request.onerror?.();
        this.onerror?.();
      } finally {
        this.#pending -= 1;
        this.#scheduleCompletion();
      }
    });
    return request;
  }

  abort() {
    if (this.#settled) throw Object.assign(new Error("Transaction is inactive."), { name: "InvalidStateError" });
    this.#settled = true;
    this.onabort?.();
  }

  #completeIfIdle() {
    if (!this.#settled && this.#pending === 0) {
      this.#settled = true;
      this.oncomplete?.();
    }
  }
}

class FakeObjectStore {
  #state;
  #transaction;

  constructor(state, transaction) {
    this.#state = state;
    this.#transaction = transaction;
  }

  get indexNames() {
    return names(new Set(this.#state.indexes.keys()));
  }

  createIndex(name, keyPath = name) {
    this.#state.indexes.set(name, keyPath);
  }

  index(name) {
    const keyPath = this.#state.indexes.get(name);
    if (keyPath === undefined) throw Object.assign(new Error("Missing index."), { name: "NotFoundError" });
    return {
      getAll: (query) => this.#transaction.request(() => [...this.#state.records.values()]
        .filter((value) => value[keyPath] === query)
        .map((value) => structuredClone(value)))
    };
  }

  get(key) {
    return this.#transaction.request(() => {
      const value = this.#state.records.get(key);
      return value === undefined ? undefined : structuredClone(value);
    });
  }

  getAll() {
    return this.#transaction.request(() => [...this.#state.records.values()].map((value) => structuredClone(value)));
  }

  put(value) {
    return this.#transaction.request(() => {
      const key = value[this.#state.keyPath];
      this.#state.records.set(key, structuredClone(value));
      return key;
    });
  }

  delete(key) {
    return this.#transaction.request(() => this.#state.records.delete(key));
  }

  clear() {
    return this.#transaction.request(() => this.#state.records.clear());
  }
}

class FakeDatabase {
  constructor(state) {
    this.state = state;
    this.stores = state.stores;
    this.onversionchange = null;
  }

  get objectStoreNames() {
    return names(new Set(this.stores.keys()));
  }

  createObjectStore(name, { keyPath }) {
    const state = { keyPath, records: new Map(), indexes: new Map() };
    this.stores.set(name, state);
    return new FakeObjectStore(state, this.state.upgradeTransaction);
  }

  deleteObjectStore(name) {
    if (!this.stores.delete(name)) {
      throw Object.assign(new Error("Missing object store."), { name: "NotFoundError" });
    }
  }

  transaction(storeNames) {
    const requested = Array.isArray(storeNames) ? storeNames : [storeNames];
    if (requested.some((name) => !this.stores.has(name))) {
      throw Object.assign(new Error("Missing object store."), { name: "NotFoundError" });
    }
    return new FakeTransaction(this);
  }

  close() {}
}

export class FakeIndexedDBFactory {
  #databases = new Map();

  open(name, version) {
    const request = new FakeRequest();
    request.transaction = null;
    request.onupgradeneeded = null;
    request.onblocked = null;
    queueMicrotask(() => {
      let state = this.#databases.get(name);
      if (state && version < state.version) {
        request.error = Object.assign(new Error("Future database."), { name: "VersionError" });
        request.onerror?.();
        return;
      }
      const upgrading = !state || version > state.version;
      if (!state) {
        state = { version: 0, stores: new Map(), upgradeTransaction: null };
        this.#databases.set(name, state);
      }
      const database = new FakeDatabase(state);
      request.result = database;
      if (upgrading) {
        state.version = version;
        state.upgradeTransaction = new FakeTransaction(database);
        request.transaction = state.upgradeTransaction;
        // As in IndexedDB, success follows the whole upgrade transaction,
        // including requests queued from inside its callbacks.
        state.upgradeTransaction.oncomplete = () => request.onsuccess?.();
        request.onupgradeneeded?.();
        return;
      }
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }
}

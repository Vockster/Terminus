import { FAVICON_CACHE_LIMITS, faviconSourceKey } from "../contracts/favicon-cache.js";

export class FaviconAcquisitionCoordinator {
  #maximum;
  #sourceChangeRetryMs;
  #now;
  #setTimer;
  #clearTimer;
  #running = 0;
  #queue = [];
  #bySource = new Map();
  #trailingByTab = new Map();
  #lastEnqueuedAtByTab = new Map();

  constructor({
    maximum = FAVICON_CACHE_LIMITS.maximumConcurrentAcquisitions,
    sourceChangeRetryMs = FAVICON_CACHE_LIMITS.sourceChangeRetryMs,
    now = Date.now,
    setTimer = (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer = (timer) => clearTimeout(timer)
  } = {}) {
    this.#maximum = maximum;
    this.#sourceChangeRetryMs = sourceChangeRetryMs;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  // Work is coalesced per exact source. Different tabs on one site may need
  // different icons, so one tab's source never suppresses another tab's.
  enqueue({ partition = "default", origin, sourceDigest, tabId, run }) {
    const request = { partition, origin, sourceDigest, tabId, run };
    const key = faviconSourceKey(partition, origin, sourceDigest);
    const trailing = this.#trailingByTab.get(tabId);
    if (trailing) {
      trailing.request = request;
      return trailing.promise;
    }
    const current = this.#bySource.get(key);
    if (current) {
      this.#detachTab(tabId, key);
      current.tabIds.add(tabId);
      this.#lastEnqueuedAtByTab.set(tabId, this.#now());
      return current.promise;
    }

    const lastEnqueuedAt = this.#lastEnqueuedAtByTab.get(tabId);
    if (
      lastEnqueuedAt !== undefined &&
      this.#now() - lastEnqueuedAt < this.#sourceChangeRetryMs
    ) {
      return this.#scheduleTrailing(request, lastEnqueuedAt + this.#sourceChangeRetryMs);
    }
    return this.#enqueueImmediate(request);
  }

  #enqueueImmediate({ partition, origin, sourceDigest, tabId, run }) {
    const key = faviconSourceKey(partition, origin, sourceDigest);
    const current = this.#bySource.get(key);
    if (current) {
      this.#detachTab(tabId, key);
      current.tabIds.add(tabId);
      this.#lastEnqueuedAtByTab.set(tabId, this.#now());
      return current.promise;
    }
    this.#detachTab(tabId, key);

    const controller = new AbortController();
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const task = {
      key,
      partition,
      origin,
      sourceDigest,
      tabIds: new Set([tabId]),
      run,
      controller,
      promise,
      resolve,
      reject,
      started: false
    };
    this.#bySource.set(key, task);
    this.#lastEnqueuedAtByTab.set(tabId, this.#now());
    this.#queue.push(task);
    this.#drain();
    return promise;
  }

  cancelTab(tabId) {
    this.#cancelTrailing(tabId, "tab-removed");
    this.#lastEnqueuedAtByTab.delete(tabId);
    for (const task of this.#bySource.values()) {
      task.tabIds.delete(tabId);
      if (task.tabIds.size === 0) task.controller.abort("tab-removed");
    }
  }

  invalidateOrigin(origin) {
    for (const [tabId, trailing] of this.#trailingByTab) {
      if (trailing.request.origin === origin) this.#cancelTrailing(tabId, "origin-invalidated");
    }
    for (const task of this.#bySource.values()) {
      if (task.origin === origin) task.controller.abort("origin-invalidated");
    }
  }

  invalidateAll() {
    for (const tabId of [...this.#trailingByTab.keys()]) {
      this.#cancelTrailing(tabId, "cache-cleared");
    }
    this.#lastEnqueuedAtByTab.clear();
    for (const task of this.#bySource.values()) task.controller.abort("cache-cleared");
  }

  close() {
    this.invalidateAll();
    this.#drain();
  }

  get activeCount() {
    return this.#running;
  }

  get pendingCount() {
    return this.#queue.filter(({ started }) => !started).length;
  }

  #scheduleTrailing(request, dueAt) {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const trailing = { request, promise, resolve, reject, timer: null };
    trailing.timer = this.#setTimer(() => {
      if (this.#trailingByTab.get(request.tabId) !== trailing) return;
      this.#trailingByTab.delete(request.tabId);
      Promise.resolve(this.#enqueueImmediate(trailing.request)).then(resolve, reject);
    }, Math.max(0, dueAt - this.#now()));
    this.#trailingByTab.set(request.tabId, trailing);
    return promise;
  }

  #cancelTrailing(tabId, reason) {
    const trailing = this.#trailingByTab.get(tabId);
    if (!trailing) return;
    this.#trailingByTab.delete(tabId);
    this.#clearTimer(trailing.timer);
    trailing.reject(reason);
  }

  #detachTab(tabId, keepKey) {
    for (const task of [...this.#bySource.values()]) {
      if (task.key === keepKey || !task.tabIds.delete(tabId)) continue;
      if (task.tabIds.size === 0) {
        task.controller.abort("source-changed");
        this.#bySource.delete(task.key);
      }
    }
  }

  #drain() {
    while (this.#running < this.#maximum) {
      const task = this.#queue.shift();
      if (!task) return;
      if (task.controller.signal.aborted || this.#bySource.get(task.key) !== task) {
        task.reject(task.controller.signal.reason ?? new Error("Acquisition cancelled."));
        continue;
      }
      task.started = true;
      this.#running += 1;
      Promise.resolve()
        .then(() => {
          if (task.controller.signal.aborted) throw task.controller.signal.reason;
          return task.run(task.controller.signal);
        })
        .then(task.resolve, task.reject)
        .finally(() => {
          this.#running -= 1;
          if (this.#bySource.get(task.key) === task) this.#bySource.delete(task.key);
          this.#drain();
        });
    }
  }
}

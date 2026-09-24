import {
  FAVICON_CACHE_LIMITS,
  FAVICON_DEFAULT_PARTITION,
  FAVICON_DIAGNOSTIC_REASONS,
  FAVICON_ERROR_CODES,
  FAVICON_MIME_TYPES,
  FAVICON_POLICY_VERSION,
  FaviconError,
  canonicalizeFaviconHostOrigin,
  canonicalizePageOrigin,
  classifyFaviconCandidate,
  decodeBase64RasterData,
  digestFaviconSource,
  faviconSourceKey,
  isExpectedFaviconFailure,
  parseLocalRasterDataUrl
} from "../contracts/favicon-cache.js";

function asFaviconError(error) {
  if (error instanceof FaviconError) return error;
  if (error === "tab-removed" || error === "cache-cleared" || error === "origin-invalidated" || error === "source-changed") {
    return new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
  }
  return new FaviconError(FAVICON_ERROR_CODES.INTERNAL_ERROR, { cause: error });
}

function referenceKey({ logicalId, firefoxTabId }) {
  return `${logicalId}\u0000${firefoxTabId}`;
}

function sameReferenceSource(left, right) {
  if (!left || !right || left.source !== right.source) return false;
  if (left.source === "default-search") return true;
  return (left.partition ?? FAVICON_DEFAULT_PARTITION) ===
      (right.partition ?? FAVICON_DEFAULT_PARTITION) &&
    left.origin === right.origin && left.sourceDigest === right.sourceDigest;
}

const FAVICON_MEMORY_STAGE_LIMIT = 128;
const FAVICON_PERSIST_BATCH_LIMIT = 16;
const FAVICON_PERSIST_BATCH_DELAY_MILLISECONDS = 10;

export class FaviconCacheService {
  #storage;
  #browser;
  #coordinator;
  #snapshotReferenceProvider;
  #onChanged;
  #onDiagnostic;
  #now;
  #setTimer;
  #clearTimer;
  #navigationGenerations = new Map();
  #recentIcons = new Map();
  #pendingIconWrites = [];
  #writeTimer = null;
  #writeRunning = false;
  #changedTabIds = new Set();
  #changeAll = false;
  #changeWaiters = [];
  #changeTimer = null;
  #defaultSearchIconState = Object.freeze({ initialized: false, sourceDigest: null, blob: null });
  #defaultSearchIconRefresh = null;

  constructor({
    storage,
    browser,
    coordinator,
    snapshotReferenceProvider = async () => new Set(),
    onChanged = () => {},
    onDiagnostic = () => {},
    now = Date.now,
    setTimer = (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer = (timer) => clearTimeout(timer)
  }) {
    this.#storage = storage;
    this.#browser = browser;
    this.#coordinator = coordinator;
    this.#snapshotReferenceProvider = snapshotReferenceProvider;
    this.#onChanged = onChanged;
    this.#onDiagnostic = onDiagnostic;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  #diagnose(reason) {
    try {
      this.#onDiagnostic(reason);
    } catch {
      // Diagnostics never affect acquisition or storage behavior.
    }
  }

  async getForTabs(windowId, references) {
    const before = await this.#browser.resolveTabReferences(windowId, references);
    if (before.length === 0) return { icons: [] };
    // A reference without a digest is a tab that has never loaded. It still
    // names an origin, so its stored record is read and can stand in.
    const beforeWebsites = before.filter(({ source, origin }) => source === "website" && origin);
    const needsDefaultSearch = before.some(({ source }) => source === "default-search");
    const [storedRecords, defaultSearch] = await Promise.all([
      beforeWebsites.length > 0
        ? this.#storage.getIconsForOrigins([...new Map(beforeWebsites.map((reference) => {
            const partition = reference.partition ?? FAVICON_DEFAULT_PARTITION;
            return [
              `${partition} ${reference.origin}`,
              partition === FAVICON_DEFAULT_PARTITION
                ? reference.origin
                : { partition, origin: reference.origin }
            ];
          })).values()])
        : [],
      needsDefaultSearch ? this.#resolveDefaultSearchIcon() : null
    ]);
    const recordsBySource = new Map(storedRecords.map((record) => [
      faviconSourceKey(
        record.partition ?? FAVICON_DEFAULT_PARTITION,
        record.origin,
        record.sourceDigest
      ),
      record
    ]));
    for (const reference of beforeWebsites) {
      if (typeof reference.sourceDigest !== "string") continue;
      const key = faviconSourceKey(
        reference.partition ?? FAVICON_DEFAULT_PARTITION,
        reference.origin,
        reference.sourceDigest
      );
      const recent = this.#recentIcons.get(key);
      if (recent) recordsBySource.set(key, recent);
    }
    const records = [...recordsBySource.values()];

    // A tabs.get() result and an IndexedDB read are not atomic. Resolve every
    // exact identity again after the cache read and never attach an image to a
    // tab whose live source changed in between. Such a tab is still settling,
    // not iconless: the change that moved it (a load starting or finishing, or
    // a new icon) brings its own lookup, so the sidebar keeps what it shows
    // rather than flashing the fallback letter until then.
    const after = await this.#browser.resolveTabReferences(windowId, references);
    const beforeByIdentity = new Map(before.map((reference) => [referenceKey(reference), reference]));
    const stable = [];
    const settling = [];
    const reacquire = new Set();
    for (const reference of after) {
      if (!sameReferenceSource(beforeByIdentity.get(referenceKey(reference)), reference)) {
        settling.push(reference);
        reacquire.add(reference.firefoxTabId);
        continue;
      }
      stable.push(reference);
    }

    const websiteReferences = stable.filter(({ source }) => source === "website");
    const defaultSearchReferences = stable.filter(({ source }) => source === "default-search");
    const exactBySource = new Map();
    const newestByOrigin = new Map();
    for (const record of records) {
      const partition = record.partition ?? FAVICON_DEFAULT_PARTITION;
      exactBySource.set(faviconSourceKey(partition, record.origin, record.sourceDigest), record);
      const partitionOrigin = `${partition} ${record.origin}`;
      const newest = newestByOrigin.get(partitionOrigin);
      if (!newest || record.updatedAt > newest.updatedAt) {
        newestByOrigin.set(partitionOrigin, record);
      }
    }
    const bytesBySource = new Map();
    const icons = [];
    const touched = new Map();
    for (const reference of websiteReferences) {
      const partition = reference.partition ?? FAVICON_DEFAULT_PARTITION;
      // faviconSourceKey treats a missing third argument as its two-argument
      // form, so a digest-less reference must never be passed through it.
      const key = typeof reference.sourceDigest === "string"
        ? faviconSourceKey(partition, reference.origin, reference.sourceDigest)
        : null;
      const exact = key === null ? undefined : exactBySource.get(key);
      // A source not cached yet shows the same site's newest icon rather than
      // a letter. Sites usually reuse one image under several URLs, and an
      // exact save later replaces the fallback when its bytes differ. Lookup
      // itself never downloads: acquisition stays with tab events.
      const record = exact ?? newestByOrigin.get(`${partition} ${reference.origin}`);
      if (!record) continue;
      const recordKey = faviconSourceKey(
        record.partition ?? FAVICON_DEFAULT_PARTITION,
        record.origin,
        record.sourceDigest
      );
      if (!bytesBySource.has(recordKey)) {
        bytesBySource.set(recordKey, new Uint8Array(await record.blob.arrayBuffer()));
      }
      icons.push({
        logicalId: reference.logicalId,
        firefoxTabId: reference.firefoxTabId,
        mime: record.mime,
        bytes: new Uint8Array(bytesBySource.get(recordKey)),
        substitute: !exact
      });
      if (exact && key !== null) touched.set(key, {
        partition: exact.partition ?? FAVICON_DEFAULT_PARTITION,
        origin: exact.origin,
        sourceDigest: exact.sourceDigest
      });
    }
    if (defaultSearchReferences.length > 0 && defaultSearch?.icon) {
      const bytes = new Uint8Array(await defaultSearch.icon.arrayBuffer());
      if (defaultSearch.sourceDigest) {
        for (const reference of defaultSearchReferences) {
          icons.push({
            logicalId: reference.logicalId,
            firefoxTabId: reference.firefoxTabId,
            mime: FAVICON_MIME_TYPES.PNG,
            bytes: new Uint8Array(bytes),
            substitute: false
          });
        }
      }
    }
    if (touched.size > 0) {
      void this.#storage.touchAccess([...touched.values()], this.#now()).catch(() => {});
    }
    for (const tabId of reacquire) {
      void this.observeTab(tabId).catch(() => undefined);
    }
    const pending = [...stable.filter(({ source }) => source === "pending"), ...settling]
      .map(({ logicalId, firefoxTabId }) => ({ logicalId, firefoxTabId }));
    return { icons, pending };
  }

  async observeTab(tabId, { navigationChanged = false } = {}) {
    try {
      if (navigationChanged) {
        this.#advanceNavigation(tabId);
        this.#coordinator.cancelTab(tabId);
      }
      const navigationGeneration = this.#navigationGeneration(tabId);
      const tab = await this.#browser.resolveTab(tabId);
      if (tab?.defaultSearchPage) {
        await this.refreshDefaultSearchIcon();
        return;
      }
      if (!tab?.candidateUrl) {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.MISSING_CANDIDATE);
        return;
      }
      const candidate = classifyFaviconCandidate({ pageUrl: tab.pageUrl, candidateUrl: tab.candidateUrl });
      if (candidate.kind === "rejected") {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.DENIED_POLICY);
        return;
      }
      const sourceDigest = await digestFaviconSource(
        candidate.kind === "local-data"
          ? `data:${candidate.mime};${candidate.encodedData}`
          : candidate.url
      );
      if (navigationGeneration !== this.#navigationGeneration(tabId)) return;
      const partition = tab.partition ?? FAVICON_DEFAULT_PARTITION;
      const now = this.#now();
      const existing = await this.#storage.getIcon(candidate.origin, sourceDigest, partition);
      if (existing && now - existing.updatedAt < FAVICON_CACHE_LIMITS.freshnessMs) {
        return;
      }
      // Failures belong to one exact source, so a broken icon URL never holds
      // back a different working one on the same site.
      let failure = await this.#storage.getFailure(candidate.origin, sourceDigest, partition);
      const obsoleteNetworkPolicy =
        failure?.policyVersion < 2 && failure.failureClass === FAVICON_ERROR_CODES.NETWORK;
      const obsoleteBitmapPolicy =
        failure?.policyVersion < 3 && failure.failureClass === FAVICON_ERROR_CODES.DECODE;
      if (obsoleteNetworkPolicy || obsoleteBitmapPolicy) {
        await this.#storage.clearFailure(candidate.origin, sourceDigest, partition);
        failure = null;
      }
      if (
        failure?.failureClass === FAVICON_ERROR_CODES.MISSING_ACCESS &&
        failure.accessOrigin &&
        typeof this.#browser.hasHostAccess === "function" &&
        await this.#browser.hasHostAccess(failure.accessOrigin)
      ) {
        await this.#storage.clearFailure(candidate.origin, sourceDigest, partition);
        failure = null;
      }
      if (failure && failure.retryAt > now) {
        return;
      }
      const generation = await this.#storage.getGeneration();
      return this.#coordinator.enqueue({
        partition,
        origin: candidate.origin,
        sourceDigest,
        tabId,
        run: (signal) => this.#acquire({
          tab,
          candidate,
          partition,
          sourceDigest,
          generation,
          navigationGeneration,
          signal
        })
      });
    } catch (error) {
      if ([
        FAVICON_ERROR_CODES.UNAVAILABLE,
        FAVICON_ERROR_CODES.BLOCKED,
        FAVICON_ERROR_CODES.INVALID_DATA,
        FAVICON_ERROR_CODES.STALE_GENERATION
      ].includes(error?.code)) {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.DATABASE_FAILED);
      }
      throw error;
    }
  }

  cancelTab(tabId) {
    this.#advanceNavigation(tabId);
    this.#coordinator.cancelTab(tabId);
  }

  #navigationGeneration(tabId) {
    return this.#navigationGenerations.get(tabId) ?? 0;
  }

  #advanceNavigation(tabId) {
    this.#navigationGenerations.set(tabId, this.#navigationGeneration(tabId) + 1);
    if (this.#navigationGenerations.size > 4096) {
      this.#navigationGenerations.delete(this.#navigationGenerations.keys().next().value);
    }
  }

  async #resolveDefaultSearchIcon() {
    if (!this.#defaultSearchIconRefresh) {
      this.#defaultSearchIconRefresh = this.#readDefaultSearchIcon()
        .finally(() => {
          this.#defaultSearchIconRefresh = null;
        });
    }
    return this.#defaultSearchIconRefresh;
  }

  async #readDefaultSearchIcon() {
    const previous = this.#defaultSearchIconState;
    let source;
    try {
      source = await this.#browser.getDefaultSearchIconSource();
    } catch {
      return { icon: previous.blob, sourceDigest: previous.sourceDigest, changed: false };
    }

    const localData = parseLocalRasterDataUrl(source);
    let sourceDigest = null;
    let blob = null;
    if (typeof source === "string") {
      try {
        sourceDigest = await digestFaviconSource(source);
      } catch {
        return { icon: previous.blob, sourceDigest: previous.sourceDigest, changed: false };
      }
    }
    if (previous.initialized && previous.sourceDigest === sourceDigest) {
      return { icon: previous.blob, sourceDigest: previous.sourceDigest, changed: false };
    }
    if (localData) {
      try {
        const bytes = decodeBase64RasterData(localData.encodedData);
        blob = await this.#browser.normalizeRaster(bytes, localData.mime);
      } catch {
        // Missing or unusable browser-provided artwork leaves the local fallback.
      }
    }
    const changed = previous.initialized
      ? previous.sourceDigest !== sourceDigest || Boolean(previous.blob) !== Boolean(blob)
      : Boolean(blob);
    this.#defaultSearchIconState = Object.freeze({ initialized: true, sourceDigest, blob });
    return { icon: blob, sourceDigest, changed };
  }

  async refreshDefaultSearchIcon() {
    const result = await this.#resolveDefaultSearchIcon();
    if (result.changed) await this.#onChanged("default-search");
    return { changed: result.changed, available: Boolean(result.icon) };
  }

  async refreshDefaultSearchIconForOpenTabs() {
    if (
      typeof this.#browser.hasNormalDefaultSearchPage !== "function" ||
      !(await this.#browser.hasNormalDefaultSearchPage())
    ) {
      return { refreshed: false, changed: false };
    }
    const result = await this.refreshDefaultSearchIcon();
    return { refreshed: true, ...result };
  }

  #stageRecentIcon(record) {
    const key = faviconSourceKey(record.partition, record.origin, record.sourceDigest);
    this.#recentIcons.delete(key);
    this.#recentIcons.set(key, record);
    while (this.#recentIcons.size > FAVICON_MEMORY_STAGE_LIMIT) {
      this.#recentIcons.delete(this.#recentIcons.keys().next().value);
    }
  }

  #removeRecentIcon(record) {
    const key = faviconSourceKey(record.partition, record.origin, record.sourceDigest);
    if (this.#recentIcons.get(key) === record) this.#recentIcons.delete(key);
  }

  #notifyChangedTab(tabId) {
    if (Number.isInteger(tabId)) this.#changedTabIds.add(tabId);
    else this.#changeAll = true;
    const notified = new Promise((resolve) => this.#changeWaiters.push(resolve));
    if (this.#changeTimer !== null) return notified;
    this.#changeTimer = this.#setTimer(async () => {
      this.#changeTimer = null;
      const tabIds = this.#changeAll ? null : [...this.#changedTabIds];
      this.#changedTabIds.clear();
      this.#changeAll = false;
      await Promise.resolve(this.#onChanged("icons", tabIds)).catch(() => undefined);
      for (const resolve of this.#changeWaiters.splice(0)) resolve();
    }, FAVICON_PERSIST_BATCH_DELAY_MILLISECONDS);
    return notified;
  }

  #queueIconWrite(record, expectedGeneration, tabId, navigationGeneration) {
    return new Promise((resolve, reject) => {
      this.#pendingIconWrites.push({
        record,
        expectedGeneration,
        tabId,
        navigationGeneration,
        resolve,
        reject
      });
      if (this.#pendingIconWrites.length >= FAVICON_PERSIST_BATCH_LIMIT) {
        if (this.#writeTimer !== null) this.#clearTimer(this.#writeTimer);
        this.#writeTimer = null;
        queueMicrotask(() => { void this.#flushIconWrites(); });
      } else if (this.#writeTimer === null) {
        this.#writeTimer = this.#setTimer(() => {
          this.#writeTimer = null;
          void this.#flushIconWrites();
        }, FAVICON_PERSIST_BATCH_DELAY_MILLISECONDS);
      }
    });
  }

  async #flushIconWrites() {
    if (this.#writeRunning) return;
    this.#writeRunning = true;
    try {
      while (this.#pendingIconWrites.length > 0) {
        const expectedGeneration = this.#pendingIconWrites[0].expectedGeneration;
        const batch = [];
        while (
          batch.length < FAVICON_PERSIST_BATCH_LIMIT &&
          this.#pendingIconWrites[0]?.expectedGeneration === expectedGeneration
        ) {
          batch.push(this.#pendingIconWrites.shift());
        }
        const current = batch.filter((item) =>
          item.navigationGeneration === this.#navigationGeneration(item.tabId)
        );
        for (const stale of batch.filter((item) => !current.includes(item))) {
          stale.reject(new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT));
        }
        if (current.length === 0) continue;
        try {
          const records = current.map(({ record }) => record);
          const results = typeof this.#storage.putIcons === "function"
            ? await this.#storage.putIcons(records, expectedGeneration)
            : await Promise.all(records.map((record) =>
                this.#storage.putIcon(record, expectedGeneration)
              ));
          current.forEach((item, index) => item.resolve(results[index]));
        } catch (error) {
          current.forEach((item) => item.reject(error));
        }
      }
    } finally {
      this.#writeRunning = false;
      if (this.#pendingIconWrites.length > 0) void this.#flushIconWrites();
    }
  }

  #cancelPendingIconWrites(reason, origin = null) {
    const kept = [];
    for (const item of this.#pendingIconWrites) {
      if (origin !== null && item.record.origin !== origin) {
        kept.push(item);
        continue;
      }
      item.reject(new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT, { cause: reason }));
    }
    this.#pendingIconWrites = kept;
    if (kept.length === 0 && this.#writeTimer !== null) {
      this.#clearTimer(this.#writeTimer);
      this.#writeTimer = null;
    }
  }

  #clearRecentIcons(origin = null) {
    for (const [key, record] of this.#recentIcons) {
      if (origin === null || record.origin === origin) this.#recentIcons.delete(key);
    }
  }

  #clearTargetedNotification() {
    if (this.#changeTimer !== null) this.#clearTimer(this.#changeTimer);
    this.#changeTimer = null;
    this.#changedTabIds.clear();
    this.#changeAll = false;
    for (const resolve of this.#changeWaiters.splice(0)) resolve();
  }

  async #acquire({
    tab,
    candidate,
    partition,
    sourceDigest,
    generation,
    navigationGeneration,
    signal
  }) {
    let commitGeneration = generation;
    let phase = candidate.kind === "local-data" ? "decode" : "fetch";
    try {
      let source;
      if (candidate.kind === "local-data") {
        source = { bytes: decodeBase64RasterData(candidate.encodedData), mime: candidate.mime };
      } else {
        try {
          source = await this.#browser.fetchBytes(candidate.url, signal);
        } catch (error) {
          if (error?.code === FAVICON_ERROR_CODES.NETWORK) {
            const hasHostAccess = typeof this.#browser.hasHostAccess === "function"
              ? await this.#browser.hasHostAccess(candidate.candidateOrigin)
              : false;
            if (!hasHostAccess) {
              throw new FaviconError(FAVICON_ERROR_CODES.MISSING_ACCESS, { cause: error });
            }
          }
          throw error;
        }
      }
      if (signal.aborted) throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
      phase = "decode";
      const normalized = await this.#browser.normalizeRaster(source.bytes, source.mime);
      if (navigationGeneration !== this.#navigationGeneration(tab.tabId)) {
        throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
      }
      const current = await this.#browser.resolveTab(tab.tabId, tab.windowId);
      if (
        !current?.candidateUrl ||
        current.origin !== candidate.origin ||
        (current.partition ?? FAVICON_DEFAULT_PARTITION) !== partition
      ) {
        throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
      }
      const currentCandidate = classifyFaviconCandidate({
        pageUrl: current.pageUrl,
        candidateUrl: current.candidateUrl
      });
      if (currentCandidate.kind === "rejected") throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
      const currentDigest = await digestFaviconSource(
        currentCandidate.kind === "local-data"
          ? `data:${currentCandidate.mime};${currentCandidate.encodedData}`
          : currentCandidate.url
      );
      if (
        currentDigest !== sourceDigest ||
        signal.aborted ||
        navigationGeneration !== this.#navigationGeneration(tab.tabId)
      ) {
        throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
      }

      phase = "database";
      commitGeneration = await this.#makeCapacity(
        normalized.size,
        candidate.origin,
        sourceDigest,
        partition,
        commitGeneration
      );
      const at = this.#now();
      const record = {
        partition,
        origin: candidate.origin,
        blob: normalized,
        mime: FAVICON_MIME_TYPES.PNG,
        byteCount: normalized.size,
        updatedAt: at,
        lastAccessedAt: at,
        sourceDigest
      };
      this.#stageRecentIcon(record);
      this.#notifyChangedTab(tab.tabId);
      try {
        await this.#queueIconWrite(
          record,
          commitGeneration,
          tab.tabId,
          navigationGeneration
        );
      } catch (error) {
        try {
          if (error?.code !== FAVICON_ERROR_CODES.QUOTA) throw error;
          commitGeneration = await this.#removeUnprotectedForBytes(
            normalized.size,
            candidate.origin,
            commitGeneration
          );
          await this.#queueIconWrite(
            record,
            commitGeneration,
            tab.tabId,
            navigationGeneration
          );
        } catch (retryError) {
          this.#removeRecentIcon(record);
          this.#notifyChangedTab(tab.tabId);
          throw retryError;
        }
      }
      this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.SAVED);
    } catch (rawError) {
      const error = asFaviconError(rawError);
      if (error.code === FAVICON_ERROR_CODES.MISSING_ACCESS) {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.MISSING_ACCESS);
      } else if (error.code === FAVICON_ERROR_CODES.REDIRECT_REJECTED) {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.REDIRECT_REJECTED);
      } else if (phase === "fetch") {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.FETCH_FAILED);
      } else if (phase === "decode") {
        this.#diagnose(error.diagnosticReason ?? FAVICON_DIAGNOSTIC_REASONS.DECODE_FAILED);
      } else if (phase === "database") {
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.DATABASE_FAILED);
      }
      if (isExpectedFaviconFailure(error) && error.code !== FAVICON_ERROR_CODES.NOT_RELEVANT) {
        const attemptedAt = this.#now();
        try {
          await this.#storage.putFailure({
            partition,
            origin: candidate.origin,
            sourceDigest,
            attemptedAt,
            retryAt: attemptedAt + FAVICON_CACHE_LIMITS.failureRetryMs,
            failureClass: error.code,
            policyVersion: FAVICON_POLICY_VERSION,
            accessOrigin: error.code === FAVICON_ERROR_CODES.MISSING_ACCESS
              ? candidate.candidateOrigin
              : null
          }, commitGeneration);
        } catch {
          // A concurrent clear or unavailable cache intentionally wins.
        }
      }
      throw error;
    }
  }

  async #protectedOrigins() {
    const live = await this.#browser.listNormalOrigins();
    let snapshots = new Set();
    try {
      snapshots = await this.#snapshotReferenceProvider();
    } catch {
      // Snapshot availability cannot make the website cache destructive.
    }
    return new Set([...live, ...snapshots]);
  }

  async #makeCapacity(
    incomingBytes,
    replacingOrigin,
    sourceDigest,
    partition,
    expectedGeneration
  ) {
    const [stats, existing] = await Promise.all([
      this.#storage.stats(),
      this.#storage.getIcon(replacingOrigin, sourceDigest, partition)
    ]);
    const projected = stats.byteCount - (existing?.byteCount ?? 0) + incomingBytes;
    if (projected <= FAVICON_CACHE_LIMITS.softBudgetBytes) return expectedGeneration;
    return this.#removeUnprotectedForBytes(
      projected - FAVICON_CACHE_LIMITS.softBudgetBytes,
      replacingOrigin,
      expectedGeneration
    );
  }

  async #removeUnprotectedForBytes(requiredBytes, replacingOrigin, expectedGeneration) {
    const [protectedOrigins, records] = await Promise.all([
      this.#protectedOrigins(),
      this.#storage.listLru()
    ]);
    protectedOrigins.add(replacingOrigin);
    const bytesByOrigin = new Map();
    for (const record of records) {
      bytesByOrigin.set(record.origin, (bytesByOrigin.get(record.origin) ?? 0) + record.byteCount);
    }
    // Removal is per site, so every source of a removed origin is counted.
    const removals = [];
    let recovered = 0;
    for (const record of records) {
      if (protectedOrigins.has(record.origin) || removals.includes(record.origin)) continue;
      removals.push(record.origin);
      recovered += bytesByOrigin.get(record.origin);
      if (recovered >= requiredBytes) break;
    }
    if (recovered < requiredBytes) throw new FaviconError(FAVICON_ERROR_CODES.QUOTA);
    const result = await this.#storage.removeOrigins(removals, expectedGeneration);
    if (result.removedCount > 0) void this.#notifyChangedTab(null);
    return result.generation;
  }

  async removeUnused() {
    const [protectedOrigins, records] = await Promise.all([
      this.#protectedOrigins(),
      this.#storage.listLru()
    ]);
    const removals = records.filter(({ origin }) => !protectedOrigins.has(origin)).map(({ origin }) => origin);
    const result = await this.#storage.removeOrigins(removals);
    if (result.removedCount > 0) await this.#notifyChangedTab(null);
    return result;
  }

  async clearAll() {
    this.#coordinator.invalidateAll();
    this.#cancelPendingIconWrites("cache-cleared");
    this.#clearRecentIcons();
    this.#clearTargetedNotification();
    const result = await this.#storage.clear();
    await this.#onChanged("clear");
    return result;
  }

  async clearOne(originValue) {
    const origin = canonicalizePageOrigin(originValue);
    if (!origin || origin !== originValue) throw new FaviconError(FAVICON_ERROR_CODES.INVALID_REQUEST);
    this.#coordinator.invalidateOrigin(origin);
    this.#cancelPendingIconWrites("origin-invalidated", origin);
    this.#clearRecentIcons(origin);
    const result = await this.#storage.invalidate(origin);
    if (result.removedCount > 0) await this.#notifyChangedTab(null);
    return result;
  }

  async overview() {
    const [favicon, access] = await Promise.all([
      this.#storage.stats()
        .then(({ iconCount, byteCount }) => ({ available: true, iconCount, byteCount }))
        .catch(() => ({ available: false, iconCount: null, byteCount: null })),
      this.#accessOverview()
    ]);
    return { favicon, access };
  }

  async listCachedIcons(cursor, pageSize) {
    const page = await this.#storage.listPage({
      offset: cursor?.offset ?? 0,
      expectedRevision: cursor?.revision ?? null,
      limit: pageSize
    });
    const icons = await Promise.all(page.records.map(async (record) => ({
      origin: record.origin,
      mime: record.mime,
      bytes: new Uint8Array(await record.blob.arrayBuffer()),
      byteCount: record.byteCount,
      updatedAt: record.updatedAt
    })));
    return {
      icons,
      nextCursor: page.nextOffset === null
        ? null
        : { revision: page.revision, offset: page.nextOffset }
    };
  }

  async #accessOverview() {
    if (typeof this.#storage.listAccessNeeds !== "function") {
      return { available: true, hosts: [] };
    }
    try {
      const records = await this.#storage.listAccessNeeds();
      const origins = [...new Set(records.map(({ accessOrigin }) => accessOrigin).filter(Boolean))];
      const hosts = [];
      for (const origin of origins) {
        if (typeof this.#browser.hasHostAccess === "function" && await this.#browser.hasHostAccess(origin)) continue;
        hosts.push({ origin, host: new URL(origin).host });
      }
      hosts.sort((left, right) => left.host.localeCompare(right.host));
      return { available: true, hosts };
    } catch {
      this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.DATABASE_FAILED);
      return { available: false, hosts: [] };
    }
  }

  async confirmHostAccess(originValue) {
    const origin = canonicalizeFaviconHostOrigin(originValue);
    if (!origin || origin !== originValue) {
      throw new FaviconError(FAVICON_ERROR_CODES.INVALID_REQUEST);
    }
    const pending = await this.#storage.listAccessNeeds();
    if (!pending.some(({ accessOrigin }) => accessOrigin === origin)) {
      throw new FaviconError(FAVICON_ERROR_CODES.INVALID_REQUEST);
    }
    if (typeof this.#browser.hasHostAccess !== "function" || !(await this.#browser.hasHostAccess(origin))) {
      throw new FaviconError(FAVICON_ERROR_CODES.MISSING_ACCESS);
    }
    const result = await this.#storage.clearFailuresForAccessOrigin(origin);
    await this.#onChanged("access");
    return { origin, ...result };
  }

  close() {
    this.#coordinator.close();
    this.#cancelPendingIconWrites("cache-cleared");
    this.#clearRecentIcons();
    this.#clearTargetedNotification();
    this.#navigationGenerations.clear();
    this.#browser.unsubscribe();
    this.#storage.close();
    this.#defaultSearchIconState = Object.freeze({ initialized: false, sourceDigest: null, blob: null });
  }
}

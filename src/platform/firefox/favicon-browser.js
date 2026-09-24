import {
  FAVICON_CACHE_LIMITS,
  FAVICON_DEFAULT_PARTITION,
  FAVICON_DIAGNOSTIC_REASONS,
  FAVICON_ERROR_CODES,
  FAVICON_MIME_TYPES,
  FaviconError,
  canonicalizePageOrigin,
  classifyFaviconCandidate,
  digestFaviconSource,
  faviconHostPermissionPattern,
  normalizeRasterMime,
  validateRasterBytes
} from "../../contracts/favicon-cache.js";

export const DEFAULT_SEARCH_ICON_REFRESH_ALARM_NAME = "sidebars-default-search-icon-refresh";
export const DEFAULT_SEARCH_ICON_REFRESH_MINUTES = 1;
const SOURCE_DIGEST_MEMO_MAX_ENTRIES = 2048;
const SOURCE_DIGEST_MEMO_MAX_LENGTH = 8192;
const DIRECT_TAB_LOOKUP_MAX = 8;

function isDefaultSearchPageUrl(value) {
  return value === "about:newtab" || value === "about:home";
}

function isNormalTab(tab, expectedWindowId = null) {
  return (
    tab &&
    Number.isInteger(tab.id) &&
    Number.isInteger(tab.windowId) &&
    tab.incognito === false &&
    (expectedWindowId === null || tab.windowId === expectedWindowId)
  );
}

function sourceMime(response) {
  const raw = response.headers?.get?.("content-type")?.split(";", 1)[0]?.trim()?.toLowerCase();
  if (!raw || ["application/octet-stream", "binary/octet-stream"].includes(raw)) return null;
  return normalizeRasterMime(raw);
}

export class FirefoxFaviconBrowser {
  #browser;
  #fetch;
  #createImageBitmap;
  #document;
  #offscreenCanvas;
  #subscriptions = [];
  #normalTabIds = new Set();
  // Tracks open about:newtab/about:home tabs from the observe listeners so the
  // periodic default-search refresh can skip its all-tab query when none is
  // open. Seeded from one query per event-page lifetime; only meaningful while
  // subscriptions are active.
  #defaultSearchTabIds = new Set();
  #defaultSearchSeeded = false;
  #digestMemo = new Map();
  #partitionMemo = new Map();

  constructor({
    browser,
    fetch: fetchImplementation,
    createImageBitmap: bitmapFactory,
    document: documentObject = globalThis.document,
    OffscreenCanvas: offscreenCanvas = globalThis.OffscreenCanvas
  }) {
    this.#browser = browser;
    this.#fetch = fetchImplementation ?? globalThis.fetch?.bind(globalThis);
    this.#createImageBitmap = bitmapFactory ?? globalThis.createImageBitmap?.bind(globalThis);
    this.#document = documentObject;
    this.#offscreenCanvas = offscreenCanvas;
  }

  observe({ onObserve, onCancel, onDefaultSearchRefresh } = {}) {
    const listen = (event, listener) => {
      if (!event?.addListener) return;
      event.addListener(listener);
      this.#subscriptions.push(() => event.removeListener(listener));
    };
    const trackDefaultSearchTab = (tab) => {
      if (!isNormalTab(tab)) return;
      if (isDefaultSearchPageUrl(tab.url)) {
        this.#defaultSearchTabIds.add(tab.id);
      } else {
        this.#defaultSearchTabIds.delete(tab.id);
      }
    };
    const observeTab = (tab, options = {}) => {
      if (isNormalTab(tab)) {
        trackDefaultSearchTab(tab);
        this.#normalTabIds.add(tab.id);
        onObserve?.(tab.id, options);
      }
    };
    listen(this.#browser.tabs.onCreated, (tab) => observeTab(tab, { navigationChanged: true }));
    listen(this.#browser.tabs.onUpdated, (tabId, changeInfo, tab) => {
      if (
        isNormalTab(tab) && tab.id === tabId &&
        (Object.hasOwn(changeInfo, "url") || Object.hasOwn(changeInfo, "favIconUrl") || changeInfo.status === "complete")
      ) {
        observeTab(tab, { navigationChanged: Object.hasOwn(changeInfo, "url") });
      }
    });
    listen(this.#browser.tabs.onActivated, ({ tabId }) => {
      void this.resolveTab(tabId).then((tab) => {
        if (tab) onObserve?.(tabId, { navigationChanged: false });
      });
    });
    listen(this.#browser.tabs.onReplaced, (addedTabId, removedTabId) => {
      this.#defaultSearchTabIds.delete(removedTabId);
      if (this.#normalTabIds.delete(removedTabId)) onCancel?.(removedTabId);
      void this.resolveTab(addedTabId).then((tab) => {
        if (tab) {
          trackDefaultSearchTab(tab);
          onObserve?.(addedTabId, { navigationChanged: true });
        }
      });
    });
    listen(this.#browser.tabs.onRemoved, (tabId) => {
      this.#defaultSearchTabIds.delete(tabId);
      if (this.#normalTabIds.delete(tabId)) onCancel?.(tabId);
    });
    listen(this.#browser.alarms?.onAlarm, (alarm) => {
      if (alarm?.name === DEFAULT_SEARCH_ICON_REFRESH_ALARM_NAME) {
        onDefaultSearchRefresh?.();
      }
    });
    try {
      const scheduled = this.#browser.alarms?.create?.(DEFAULT_SEARCH_ICON_REFRESH_ALARM_NAME, {
        delayInMinutes: DEFAULT_SEARCH_ICON_REFRESH_MINUTES,
        periodInMinutes: DEFAULT_SEARCH_ICON_REFRESH_MINUTES
      });
      scheduled?.catch?.(() => undefined);
    } catch {
      // A missing alarm leaves event and cache-lookup refreshes available.
    }
    return () => this.unsubscribe();
  }

  unsubscribe() {
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe();
    this.#normalTabIds.clear();
    this.#defaultSearchTabIds.clear();
    this.#defaultSearchSeeded = false;
  }

  async resolveTab(tabId, expectedWindowId = null) {
    let tab;
    try {
      tab = await this.#browser.tabs.get(tabId);
    } catch {
      return null;
    }
    if (!isNormalTab(tab, expectedWindowId)) return null;
    this.#normalTabIds.add(tab.id);
    if (isDefaultSearchPageUrl(tab.url)) {
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        defaultSearchPage: true
      };
    }
    const origin = canonicalizePageOrigin(tab.url);
    if (!origin) return null;
    const partition = await this.#partitionFor(tab.cookieStoreId);
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      ...(partition === FAVICON_DEFAULT_PARTITION ? {} : { partition }),
      pageUrl: tab.url,
      candidateUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : null,
      origin
    };
  }

  // A lookup for many rows uses one window query instead of a Firefox round
  // trip per tab; a lookup for a few tabs, such as one tab's icon change,
  // fetches only those tabs rather than every tab in a large window. A tab
  // that cannot be fetched is gone; a window query that fails says nothing
  // about any tab, so it fails the lookup instead of reporting no icons.
  async resolveTabReferences(windowId, references) {
    let tabs;
    try {
      tabs = references.length > DIRECT_TAB_LOOKUP_MAX
        ? await this.#browser.tabs.query({ windowId })
        : (await Promise.all(references.map(({ firefoxTabId }) =>
            this.#browser.tabs.get(firefoxTabId).catch(() => null)
          ))).filter(Boolean);
    } catch (error) {
      throw new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE, { cause: error });
    }
    const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
    const resolved = await Promise.all(references.map(async ({ logicalId, firefoxTabId }) => {
      const tab = tabById.get(firefoxTabId);
      if (!isNormalTab(tab, windowId)) return null;
      this.#normalTabIds.add(tab.id);
      if (isDefaultSearchPageUrl(tab.url)) {
        return { logicalId, firefoxTabId, source: "default-search" };
      }
      if (typeof tab.favIconUrl !== "string" || tab.favIconUrl.length === 0) {
        const pageOrigin = canonicalizePageOrigin(tab.url);
        if (!pageOrigin) return null;
        // Firefox reports no icon while a page loads, before the new page
        // declares one. That is not evidence the icon is gone.
        if (tab.status === "loading") {
          return { logicalId, firefoxTabId, source: "pending" };
        }
        // A tab that has never loaded declares no icon URL, so there is nothing
        // to match a cached record against exactly. Its origin is still known,
        // and the site's icon is often already on disk from another tab, so the
        // reference carries the origin alone and the stored record stands in.
        // No digest means no exact match and no acquisition: this reaches the
        // cache only, never the network.
        const storedPartition = await this.#partitionFor(tab.cookieStoreId);
        return {
          logicalId,
          firefoxTabId,
          source: "website",
          ...(storedPartition === FAVICON_DEFAULT_PARTITION ? {} : { partition: storedPartition }),
          origin: pageOrigin
        };
      }
      const candidate = classifyFaviconCandidate({
        pageUrl: tab.url,
        candidateUrl: tab.favIconUrl
      });
      if (candidate.kind === "rejected") return null;
      const sourceDigest = await this.#sourceDigest(
        candidate.kind === "local-data"
          ? `data:${candidate.mime};${candidate.encodedData}`
          : candidate.url
      );
      const partition = await this.#partitionFor(tab.cookieStoreId);
      return {
        logicalId,
        firefoxTabId,
        source: "website",
        ...(partition === FAVICON_DEFAULT_PARTITION ? {} : { partition }),
        origin: candidate.origin,
        sourceDigest
      };
    }));
    return resolved.filter(Boolean);
  }

  // Remote icon URLs repeat across lookups; data URLs are skipped because
  // holding their text would cost more than hashing it again.
  async #sourceDigest(value) {
    if (value.length > SOURCE_DIGEST_MEMO_MAX_LENGTH) return digestFaviconSource(value);
    const known = this.#digestMemo.get(value);
    if (known) return known;
    const digest = await digestFaviconSource(value);
    this.#digestMemo.set(value, digest);
    if (this.#digestMemo.size > SOURCE_DIGEST_MEMO_MAX_ENTRIES) {
      this.#digestMemo.delete(this.#digestMemo.keys().next().value);
    }
    return digest;
  }

  async #partitionFor(cookieStoreId) {
    if (!cookieStoreId || cookieStoreId === "firefox-default") {
      return FAVICON_DEFAULT_PARTITION;
    }
    let partition = this.#partitionMemo.get(cookieStoreId);
    if (!partition) {
      partition = await digestFaviconSource(`container:${cookieStoreId}`);
      this.#partitionMemo.set(cookieStoreId, partition);
    }
    return partition;
  }

  async listNormalOrigins() {
    let tabs;
    try {
      tabs = await this.#browser.tabs.query({});
    } catch {
      return new Set();
    }
    return new Set(tabs.filter(isNormalTab).map((tab) => canonicalizePageOrigin(tab.url)).filter(Boolean));
  }

  async hasNormalDefaultSearchPage() {
    if (this.#subscriptions.length === 0) {
      // Without observe listeners the tracked set cannot stay current, so
      // answer from a direct query as before.
      let tabs;
      try {
        tabs = await this.#browser.tabs.query({});
      } catch {
        return false;
      }
      return tabs.some((tab) => isNormalTab(tab) && isDefaultSearchPageUrl(tab.url));
    }
    if (!this.#defaultSearchSeeded) {
      let tabs;
      try {
        tabs = await this.#browser.tabs.query({});
      } catch {
        return false;
      }
      this.#defaultSearchTabIds = new Set(
        tabs
          .filter((tab) => isNormalTab(tab) && isDefaultSearchPageUrl(tab.url))
          .map((tab) => tab.id)
      );
      this.#defaultSearchSeeded = true;
    }
    return this.#defaultSearchTabIds.size > 0;
  }

  async getDefaultSearchIconSource() {
    const engines = await this.#browser.search.get();
    if (!Array.isArray(engines)) return null;
    const defaultEngine = engines.find((engine) => engine?.isDefault === true);
    return typeof defaultEngine?.favIconUrl === "string" && defaultEngine.favIconUrl.length > 0
      ? defaultEngine.favIconUrl
      : null;
  }

  async hasHostAccess(origin) {
    const pattern = faviconHostPermissionPattern(origin);
    if (!pattern || typeof this.#browser.permissions?.contains !== "function") return false;
    try {
      return await this.#browser.permissions.contains({ origins: [pattern] });
    } catch {
      return false;
    }
  }

  async fetchBytes(url, parentSignal) {
    if (typeof this.#fetch !== "function") throw new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE);
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort("timeout"), FAVICON_CACHE_LIMITS.requestTimeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal
      });
      if (
        response.type === "opaqueredirect" ||
        response.redirected === true ||
        (Number.isInteger(response.status) && response.status >= 300 && response.status < 400)
      ) {
        await response.body?.cancel?.();
        throw new FaviconError(FAVICON_ERROR_CODES.REDIRECT_REJECTED);
      }
      if (!response.ok) throw new FaviconError(FAVICON_ERROR_CODES.NETWORK);
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > FAVICON_CACHE_LIMITS.maximumSourceBytes) {
        await response.body?.cancel?.();
        throw new FaviconError(FAVICON_ERROR_CODES.TOO_LARGE);
      }
      const mime = sourceMime(response);
      if (mime !== null && (!mime.startsWith("image/") || mime === "image/svg+xml")) {
        await response.body?.cancel?.();
        throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
      }
      if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > FAVICON_CACHE_LIMITS.maximumSourceBytes) throw new FaviconError(FAVICON_ERROR_CODES.TOO_LARGE);
        return { bytes, mime };
      }
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > FAVICON_CACHE_LIMITS.maximumSourceBytes) {
          await reader.cancel();
          throw new FaviconError(FAVICON_ERROR_CODES.TOO_LARGE);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, mime };
    } catch (error) {
      if (error instanceof FaviconError) throw error;
      if (controller.signal.aborted && !parentSignal?.aborted) throw new FaviconError(FAVICON_ERROR_CODES.TIMEOUT, { cause: error });
      if (parentSignal?.aborted) throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT, { cause: error });
      throw new FaviconError(FAVICON_ERROR_CODES.NETWORK, { cause: error });
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
  }

  async normalizeRaster(bytes, declaredMime) {
    let validated;
    try {
      validated = validateRasterBytes(bytes, declaredMime);
    } catch (error) {
      throw new FaviconError(error?.code ?? FAVICON_ERROR_CODES.INVALID_DATA, {
        cause: error,
        diagnosticReason: FAVICON_DIAGNOSTIC_REASONS.RASTER_VALIDATION_FAILED
      });
    }
    if (typeof this.#createImageBitmap !== "function") throw new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE);
    let bitmap;
    let diagnosticReason = FAVICON_DIAGNOSTIC_REASONS.BITMAP_DECODE_FAILED;
    try {
      bitmap = await this.#createImageBitmap(new Blob([validated.bytes], { type: validated.mime }));
      if (
        !Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) ||
        bitmap.width < 1 || bitmap.height < 1 ||
        bitmap.width > FAVICON_CACHE_LIMITS.maximumDecodedDimension ||
        bitmap.height > FAVICON_CACHE_LIMITS.maximumDecodedDimension
      ) {
        throw new FaviconError(FAVICON_ERROR_CODES.DECODE, {
          diagnosticReason: FAVICON_DIAGNOSTIC_REASONS.DIMENSIONS_REJECTED
        });
      }
      const scale = Math.min(1, FAVICON_CACHE_LIMITS.maximumRasterDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      diagnosticReason = FAVICON_DIAGNOSTIC_REASONS.RASTER_CONTEXT_FAILED;
      const canvas = this.#offscreenCanvas
        ? new this.#offscreenCanvas(width, height)
        : this.#document?.createElement?.("canvas");
      if (!canvas) {
        throw new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE, { diagnosticReason });
      }
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new FaviconError(FAVICON_ERROR_CODES.DECODE, { diagnosticReason });
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      diagnosticReason = FAVICON_DIAGNOSTIC_REASONS.RASTER_ENCODE_FAILED;
      const blob = typeof canvas.convertToBlob === "function"
        ? await canvas.convertToBlob({ type: FAVICON_MIME_TYPES.PNG })
        : await new Promise((resolve) => canvas.toBlob(resolve, FAVICON_MIME_TYPES.PNG));
      if (!(blob instanceof Blob) || blob.type !== FAVICON_MIME_TYPES.PNG || blob.size === 0) {
        throw new FaviconError(FAVICON_ERROR_CODES.DECODE, { diagnosticReason });
      }
      return blob.slice(0, blob.size, FAVICON_MIME_TYPES.PNG);
    } catch (error) {
      if (error instanceof FaviconError) throw error;
      throw new FaviconError(FAVICON_ERROR_CODES.DECODE, { cause: error, diagnosticReason });
    } finally {
      bitmap?.close?.();
    }
  }
}

export function createFirefoxFaviconBrowser(options) {
  return new FirefoxFaviconBrowser(options);
}

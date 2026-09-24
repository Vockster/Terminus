import {
  FAVICON_CACHE_LIMITS,
  FAVICON_ERROR_CODES,
  FAVICON_ERROR_MESSAGES,
  FAVICON_MIME_TYPES,
  FaviconError,
  canonicalizePageOrigin,
  sanitizeFaviconError
} from "./favicon-cache.js";

export const FAVICON_MESSAGE_TYPES = Object.freeze({
  LOOKUP: "favicon-cache/lookup",
  OVERVIEW: "favicon-cache/overview",
  LIST: "favicon-cache/list",
  CLEAR_ALL: "favicon-cache/clear-all",
  CLEAR_ONE: "favicon-cache/clear-one",
  REMOVE_UNUSED: "favicon-cache/remove-unused",
  ACCESS_GRANTED: "favicon-cache/access-granted",
  CHANGED: "favicon-cache/changed"
});
export const FAVICON_LOOKUP_MAX_TABS = 500;
export const FAVICON_GALLERY_PAGE_SIZE = 64;
const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function invalid() {
  throw new FaviconError(FAVICON_ERROR_CODES.INVALID_REQUEST);
}

function copiedLookupBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return null;
}

function publicLookupResult(value) {
  const icons = [];
  const seen = new Set();
  for (const icon of Array.isArray(value?.icons) ? value.icons.slice(0, FAVICON_LOOKUP_MAX_TABS) : []) {
    const bytes = copiedLookupBytes(icon?.bytes);
    const key = `${icon?.logicalId}\u0000${icon?.firefoxTabId}`;
    if (
      !LOGICAL_TAB_ID_PATTERN.test(icon?.logicalId) ||
      !Number.isInteger(icon?.firefoxTabId) ||
      icon.firefoxTabId < 0 ||
      icon.mime !== FAVICON_MIME_TYPES.PNG ||
      !bytes?.byteLength ||
      bytes.byteLength > FAVICON_CACHE_LIMITS.maximumSourceBytes ||
      typeof icon.substitute !== "boolean" ||
      seen.has(key)
    ) continue;
    seen.add(key);
    // A substitute is the same site's newest icon standing in for a source
    // not cached yet, so the sidebar never trades a shown icon for one.
    icons.push(Object.freeze({
      logicalId: icon.logicalId,
      firefoxTabId: icon.firefoxTabId,
      mime: icon.mime,
      bytes,
      substitute: icon.substitute
    }));
  }
  // Tabs whose page is still loading and has not declared an icon yet. The
  // sidebar keeps what it shows instead of treating them as omitted.
  const pending = [];
  for (const entry of Array.isArray(value?.pending) ? value.pending.slice(0, FAVICON_LOOKUP_MAX_TABS) : []) {
    const key = `${entry?.logicalId}\u0000${entry?.firefoxTabId}`;
    if (
      !LOGICAL_TAB_ID_PATTERN.test(entry?.logicalId) ||
      !Number.isInteger(entry?.firefoxTabId) ||
      entry.firefoxTabId < 0 ||
      seen.has(key)
    ) continue;
    seen.add(key);
    pending.push(Object.freeze({ logicalId: entry.logicalId, firefoxTabId: entry.firefoxTabId }));
  }
  return Object.freeze({ icons: Object.freeze(icons), pending: Object.freeze(pending) });
}

function publicGalleryResult(value) {
  const icons = [];
  for (const icon of Array.isArray(value?.icons) ? value.icons.slice(0, FAVICON_GALLERY_PAGE_SIZE) : []) {
    const bytes = copiedLookupBytes(icon?.bytes);
    if (
      canonicalizePageOrigin(icon?.origin) !== icon?.origin ||
      icon.mime !== FAVICON_MIME_TYPES.PNG ||
      !bytes?.byteLength ||
      bytes.byteLength > FAVICON_CACHE_LIMITS.maximumSourceBytes ||
      icon.byteCount !== bytes.byteLength ||
      !Number.isSafeInteger(icon.updatedAt) ||
      icon.updatedAt < 0
    ) continue;
    icons.push(Object.freeze({
      origin: icon.origin,
      mime: icon.mime,
      bytes,
      byteCount: icon.byteCount,
      updatedAt: icon.updatedAt
    }));
  }
  let nextCursor = null;
  if (value?.nextCursor !== null) {
    if (
      !exactKeys(value?.nextCursor, ["revision", "offset"]) ||
      !Number.isSafeInteger(value.nextCursor.revision) ||
      value.nextCursor.revision < 0 ||
      !Number.isSafeInteger(value.nextCursor.offset) ||
      value.nextCursor.offset < 1
    ) invalid();
    nextCursor = Object.freeze({
      revision: value.nextCursor.revision,
      offset: value.nextCursor.offset
    });
  }
  return Object.freeze({ icons: Object.freeze(icons), nextCursor });
}

export function parseFaviconRequest(value) {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === FAVICON_MESSAGE_TYPES.LOOKUP) {
    if (!exactKeys(value, ["type", "windowId", "tabs"]) || !Number.isInteger(value.windowId) || value.windowId < 0 || !Array.isArray(value.tabs) || value.tabs.length > FAVICON_LOOKUP_MAX_TABS) invalid();
    const tabs = value.tabs.map((tab) => {
      if (!exactKeys(tab, ["logicalId", "firefoxTabId"]) || !LOGICAL_TAB_ID_PATTERN.test(tab.logicalId) || !Number.isInteger(tab.firefoxTabId) || tab.firefoxTabId < 0) invalid();
      return { logicalId: tab.logicalId, firefoxTabId: tab.firefoxTabId };
    });
    if (new Set(tabs.map(({ logicalId }) => logicalId)).size !== tabs.length) invalid();
    if (new Set(tabs.map(({ firefoxTabId }) => firefoxTabId)).size !== tabs.length) invalid();
    return { type: value.type, windowId: value.windowId, tabs };
  }
  if (value.type === FAVICON_MESSAGE_TYPES.LIST) {
    if (!exactKeys(value, ["type", "cursor"])) invalid();
    if (value.cursor === null) return { type: value.type, cursor: null };
    if (
      !exactKeys(value.cursor, ["revision", "offset"]) ||
      !Number.isSafeInteger(value.cursor.revision) ||
      value.cursor.revision < 0 ||
      !Number.isSafeInteger(value.cursor.offset) ||
      value.cursor.offset < 1
    ) invalid();
    return { type: value.type, cursor: { ...value.cursor } };
  }
  if ([FAVICON_MESSAGE_TYPES.OVERVIEW, FAVICON_MESSAGE_TYPES.CLEAR_ALL, FAVICON_MESSAGE_TYPES.REMOVE_UNUSED].includes(value.type)) {
    if (!exactKeys(value, ["type"])) invalid();
    return { type: value.type };
  }
  if ([FAVICON_MESSAGE_TYPES.CLEAR_ONE, FAVICON_MESSAGE_TYPES.ACCESS_GRANTED].includes(value.type)) {
    if (!exactKeys(value, ["type", "origin"]) || typeof value.origin !== "string") invalid();
    return { type: value.type, origin: value.origin };
  }
  return null;
}

export function faviconSuccess(type, result) {
  return Object.freeze({
    ok: true,
    type,
    result: type === FAVICON_MESSAGE_TYPES.LOOKUP
      ? publicLookupResult(result)
      : type === FAVICON_MESSAGE_TYPES.LIST
        ? publicGalleryResult(result)
        : result
  });
}

export function faviconFailure(type, error) {
  return Object.freeze({ ok: false, type, error: sanitizeFaviconError(error) });
}

export function faviconChanged(change = "icons", firefoxTabIds = null) {
  const affected = Array.isArray(firefoxTabIds)
    ? Object.freeze([...new Set(firefoxTabIds.filter((id) => Number.isInteger(id) && id >= 0))])
    : null;
  return Object.freeze({
    type: FAVICON_MESSAGE_TYPES.CHANGED,
    change,
    firefoxTabIds: affected
  });
}

export { FAVICON_ERROR_CODES, FAVICON_ERROR_MESSAGES };

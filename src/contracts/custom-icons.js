import { sniffRasterMime } from "./favicon-cache.js";

export const CUSTOM_ICON_DATABASE_NAME = "sidebars-custom-icons";
export const CUSTOM_ICON_DATABASE_VERSION = 2;
export const CUSTOM_ICON_MIME_TYPE = "image/png";
export const CUSTOM_ICON_DEFAULT_LABEL = "Custom icon";
export const CUSTOM_ICON_LIMITS = Object.freeze({
  maxIcons: 100,
  maxInputBytes: 5 * 1024 * 1024,
  size: 128,
  maxStoredBytes: 256 * 1024,
  // An icon keeps the file the user supplied only while it stays small. This
  // bounds a workspace package, which carries originals, against the far larger
  // maxInputBytes a picker will accept.
  maxSourceBytes: 256 * 1024,
  maxLabelLength: 80
});

// The original is stored and handed back as bytes, never rendered by Terminus,
// which draws only the normalized PNG. The list mirrors the picker's accepted
// image types.
export const CUSTOM_ICON_SOURCE_MIME_TYPES = Object.freeze([
  "image/png", "image/apng", "image/jpeg", "image/gif", "image/webp",
  "image/avif", "image/svg+xml", "image/bmp", "image/vnd.microsoft.icon",
  "image/x-icon"
]);

export const CUSTOM_ICON_SOURCE_EXTENSIONS = Object.freeze({
  "image/png": ".png",
  "image/apng": ".apng",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/vnd.microsoft.icon": ".ico",
  "image/x-icon": ".ico"
});

// A picker hint only: successful decoding in Firefox decides acceptance.
export const CUSTOM_ICON_FILE_ACCEPT = [
  ".png", ".apng", ".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp", ".gif", ".webp", ".avif",
  ".svg", ".bmp", ".ico",
  "image/png", "image/apng", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "image/svg+xml", "image/bmp", "image/vnd.microsoft.icon", "image/x-icon"
].join(",");

export const CUSTOM_ICON_MESSAGE_TYPES = Object.freeze({
  LIST: "custom-icons/list",
  ADD: "custom-icons/add",
  REMOVE: "custom-icons/remove",
  CHANGED: "custom-icons/changed"
});

export const CUSTOM_ICON_CHANGES = Object.freeze({
  ADDED: "added",
  UPDATED: "updated",
  REMOVED: "removed"
});

export const CUSTOM_ICON_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  UNREADABLE_IMAGE: "UNREADABLE_IMAGE",
  TOO_LARGE: "TOO_LARGE",
  LIMIT_REACHED: "LIMIT_REACHED",
  NOT_FOUND: "NOT_FOUND",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const CUSTOM_ICON_ERROR_MESSAGES = Object.freeze({
  [CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST]: "The custom icon request is invalid.",
  [CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE]: "Firefox could not read this image.",
  [CUSTOM_ICON_ERROR_CODES.TOO_LARGE]: "This image is too large. Use a file up to 5 MB.",
  [CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED]:
    "You already have 100 custom icons. Remove one to add another.",
  [CUSTOM_ICON_ERROR_CODES.NOT_FOUND]: "This custom icon no longer exists.",
  [CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE]: "Custom icon storage is unavailable.",
  [CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR]: "The custom icon could not be processed."
});

const CUSTOM_ICON_ID_PATTERN = /^custom-[0-9a-f]{32}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const RECORD_KEYS = ["id", "label", "digest", "createdAt", "byteLength", "bytes"];
const SUMMARY_KEYS = ["id", "label", "digest", "createdAt", "bytes"];
const COMPATIBILITY_KEYS = ["sourceId", "mappings"];
const COMPATIBILITY_MAPPING_KEYS = ["digest", "targetId"];
// `source` is genuinely optional: an icon stored before originals were kept,
// or one whose file was too large or of an unlisted type, has none. Requiring
// it would make every older row unreadable, and unreadable rows are skipped.
const SOURCE_KEYS = ["mimeType", "byteLength", "bytes"];

export class CustomIconError extends Error {
  constructor(code, options = {}) {
    super(
      CUSTOM_ICON_ERROR_MESSAGES[code] ??
        CUSTOM_ICON_ERROR_MESSAGES[CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR],
      options
    );
    this.name = "CustomIconError";
    this.code = CUSTOM_ICON_ERROR_MESSAGES[code] ? code : CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR;
  }
}

export function sanitizeCustomIconError(error) {
  const code = error instanceof CustomIconError && CUSTOM_ICON_ERROR_MESSAGES[error.code]
    ? error.code
    : CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR;
  return Object.freeze({ code, message: CUSTOM_ICON_ERROR_MESSAGES[code] });
}

function invalidRequest() {
  return new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isCustomIconId(value) {
  return typeof value === "string" && CUSTOM_ICON_ID_PATTERN.test(value);
}

export function createCustomIconId(randomUUID = () => globalThis.crypto.randomUUID()) {
  const id = `custom-${String(randomUUID()).replaceAll("-", "").toLowerCase()}`;
  if (!isCustomIconId(id)) throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);
  return id;
}

function sanitizeLabel(value) {
  const cleaned = value.replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, CUSTOM_ICON_LIMITS.maxLabelLength).join("").trim();
}

export function customIconLabelFromFileName(fileName) {
  const withoutExtension = typeof fileName === "string" ? fileName.replace(/\.[^.]*$/, "") : "";
  return sanitizeLabel(withoutExtension) || CUSTOM_ICON_DEFAULT_LABEL;
}

export function parseCustomIconLabel(value) {
  if (typeof value !== "string") throw invalidRequest();
  const label = sanitizeLabel(value);
  if (label.length === 0 || label !== value) throw invalidRequest();
  return label;
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

// PNG places the IHDR chunk first, directly after the 8-byte signature.
export function readPngDimensions(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 24 ||
    sniffRasterMime(bytes) !== CUSTOM_ICON_MIME_TYPE ||
    readUint32(bytes, 8) !== 13 ||
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR"
  ) {
    return null;
  }
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

export function validateCustomIconPng(bytes) {
  if (!(bytes instanceof Uint8Array)) throw invalidRequest();
  if (bytes.byteLength > CUSTOM_ICON_LIMITS.maxStoredBytes) {
    throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.TOO_LARGE);
  }
  const dimensions = readPngDimensions(bytes);
  if (
    dimensions === null ||
    dimensions.width !== CUSTOM_ICON_LIMITS.size ||
    dimensions.height !== CUSTOM_ICON_LIMITS.size
  ) {
    throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE);
  }
  return new Uint8Array(bytes);
}

export async function digestCustomIconBytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseCustomIconSource(value) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasExactKeys(value, SOURCE_KEYS)) throw invalidRequest();
  if (!CUSTOM_ICON_SOURCE_MIME_TYPES.includes(value.mimeType)) throw invalidRequest();
  const bytes = value.bytes instanceof Uint8Array ? value.bytes : null;
  if (
    bytes === null ||
    bytes.byteLength === 0 ||
    bytes.byteLength > CUSTOM_ICON_LIMITS.maxSourceBytes ||
    value.byteLength !== bytes.byteLength
  ) {
    throw invalidRequest();
  }
  return Object.freeze({
    mimeType: value.mimeType,
    byteLength: bytes.byteLength,
    bytes: new Uint8Array(bytes)
  });
}

function parseIconFields(value, keys, { allowSource = false, tolerateInvalidSource = false } = {}) {
  if (!isRecord(value)) throw invalidRequest();
  const validShape = allowSource
    ? hasExactKeys(value, keys) || hasExactKeys(value, [...keys, "source"])
    : hasExactKeys(value, keys);
  if (!validShape) {
    throw invalidRequest();
  }
  if (
    !isCustomIconId(value.id) ||
    typeof value.digest !== "string" ||
    !DIGEST_PATTERN.test(value.digest) ||
    !isIsoTimestamp(value.createdAt)
  ) {
    throw invalidRequest();
  }
  const parsed = {
    id: value.id,
    label: parseCustomIconLabel(value.label),
    digest: value.digest,
    createdAt: value.createdAt,
    bytes: validateCustomIconPng(value.bytes)
  };
  if (!allowSource) return parsed;
  try {
    return { ...parsed, source: parseCustomIconSource(value.source ?? null) };
  } catch (error) {
    if (!tolerateInvalidSource) throw error;
    return { ...parsed, source: null };
  }
}

export function parseCustomIconRecord(value) {
  const parsed = parseIconFields(value, RECORD_KEYS, { allowSource: true });
  if (value.byteLength !== parsed.bytes.byteLength) throw invalidRequest();
  return Object.freeze({ ...parsed, byteLength: parsed.bytes.byteLength });
}

// IndexedDB rows created by older or interrupted builds can contain a broken
// optional original. The normalized PNG remains independently valid and is
// the only image Terminus renders, so storage reads retain it and discard only
// the unusable original.
export function parseStoredCustomIconRecord(value) {
  const parsed = parseIconFields(value, RECORD_KEYS, {
    allowSource: true,
    tolerateInvalidSource: true
  });
  if (value.byteLength !== parsed.bytes.byteLength) throw invalidRequest();
  return Object.freeze({ ...parsed, byteLength: parsed.bytes.byteLength });
}

export function customIconSummary(record) {
  return Object.freeze({
    id: record.id,
    label: record.label,
    digest: record.digest,
    createdAt: record.createdAt,
    bytes: new Uint8Array(record.bytes)
  });
}

export function parseCustomIconCompatibilityRecord(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, COMPATIBILITY_KEYS) ||
    !isCustomIconId(value.sourceId) ||
    !Array.isArray(value.mappings) ||
    value.mappings.length > CUSTOM_ICON_LIMITS.maxIcons
  ) {
    throw invalidRequest();
  }
  const mappings = value.mappings.map((mapping) => {
    if (
      !isRecord(mapping) ||
      !hasExactKeys(mapping, COMPATIBILITY_MAPPING_KEYS) ||
      typeof mapping.digest !== "string" ||
      !DIGEST_PATTERN.test(mapping.digest) ||
      !isCustomIconId(mapping.targetId) ||
      mapping.targetId === value.sourceId
    ) {
      throw invalidRequest();
    }
    return Object.freeze({ digest: mapping.digest, targetId: mapping.targetId });
  });
  if (
    new Set(mappings.map(({ digest }) => digest)).size !== mappings.length ||
    new Set(mappings.map(({ targetId }) => targetId)).size !== mappings.length
  ) {
    throw invalidRequest();
  }
  return Object.freeze({ sourceId: value.sourceId, mappings: Object.freeze(mappings) });
}

function parseUsage(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["iconCount", "byteCount"]) ||
    !Number.isSafeInteger(value.iconCount) ||
    value.iconCount < 0 ||
    !Number.isSafeInteger(value.byteCount) ||
    value.byteCount < 0
  ) {
    throw invalidRequest();
  }
  return Object.freeze({ iconCount: value.iconCount, byteCount: value.byteCount });
}

export function parseCustomIconList(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["icons", "usage"]) ||
    !Array.isArray(value.icons) ||
    value.icons.length > CUSTOM_ICON_LIMITS.maxIcons
  ) {
    throw invalidRequest();
  }
  const icons = value.icons.map((icon) => Object.freeze(parseIconFields(icon, SUMMARY_KEYS)));
  if (new Set(icons.map(({ id }) => id)).size !== icons.length) throw invalidRequest();
  return Object.freeze({ icons: Object.freeze(icons), usage: parseUsage(value.usage) });
}

export function parseCustomIconRequest(value) {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === CUSTOM_ICON_MESSAGE_TYPES.LIST) {
    if (!hasExactKeys(value, ["type"])) throw invalidRequest();
    return { type: value.type };
  }
  if (value.type === CUSTOM_ICON_MESSAGE_TYPES.ADD) {
    // `source` is optional so an older Settings page, or a file too large or
    // of an unlisted type, still adds an icon with its normalized PNG alone.
    const hasSource = hasExactKeys(value, ["type", "label", "bytes", "source"]);
    if (
      !(hasExactKeys(value, ["type", "label", "bytes"]) || hasSource) ||
      !(value.bytes instanceof Uint8Array)
    ) {
      throw invalidRequest();
    }
    if (value.bytes.byteLength > CUSTOM_ICON_LIMITS.maxStoredBytes) {
      throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.TOO_LARGE);
    }
    return {
      type: value.type,
      label: parseCustomIconLabel(value.label),
      bytes: value.bytes,
      source: parseCustomIconSource(hasSource ? value.source : null)
    };
  }
  if (value.type === CUSTOM_ICON_MESSAGE_TYPES.REMOVE) {
    if (!hasExactKeys(value, ["type", "id"]) || !isCustomIconId(value.id)) throw invalidRequest();
    return { type: value.type, id: value.id };
  }
  return null;
}

export function customIconSuccess(type, result) {
  return Object.freeze({ ok: true, type, result });
}

export function customIconFailure(type, error) {
  return Object.freeze({ ok: false, type, error: sanitizeCustomIconError(error) });
}

export function customIconChanged(change) {
  return Object.freeze({ type: CUSTOM_ICON_MESSAGE_TYPES.CHANGED, change });
}

export const FAVICON_CACHE_DATABASE_NAME = "sidebars-favicon-cache";
// Version 3 partitions exact-source rows by Firefox contextual identity.
export const FAVICON_CACHE_DATABASE_VERSION = 3;
export const FAVICON_POLICY_VERSION = 3;
export const FAVICON_DEFAULT_PARTITION = "default";

export const FAVICON_CACHE_LIMITS = Object.freeze({
  freshnessMs: 30 * 24 * 60 * 60 * 1000,
  failureRetryMs: 24 * 60 * 60 * 1000,
  sourceChangeRetryMs: 1000,
  requestTimeoutMs: 10 * 1000,
  maximumConcurrentAcquisitions: 4,
  maximumSourceBytes: 1024 * 1024,
  maximumDecodedDimension: 1024,
  maximumRasterDimension: 128,
  // Sites such as YouTube or Google Docs report different icon URLs on one
  // origin. Each source keeps its own image, bounded per origin.
  maximumSourcesPerOrigin: 16,
  softBudgetBytes: 50 * 1024 * 1024
});

// One cached image per exact Firefox-reported source on one page origin.
export function faviconSourceKey(partitionOrOrigin, originOrDigest, sourceDigest = undefined) {
  const partition = sourceDigest === undefined ? FAVICON_DEFAULT_PARTITION : partitionOrOrigin;
  const origin = sourceDigest === undefined ? partitionOrOrigin : originOrDigest;
  const digest = sourceDigest === undefined ? originOrDigest : sourceDigest;
  return `${partition} ${origin} ${digest}`;
}

export const FAVICON_MIME_TYPES = Object.freeze({
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
  ICO: "image/x-icon"
});

export const FAVICON_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_DATA: "INVALID_DATA",
  UNAVAILABLE: "UNAVAILABLE",
  BLOCKED: "BLOCKED",
  QUOTA: "QUOTA",
  STALE_GENERATION: "STALE_GENERATION",
  NETWORK: "NETWORK",
  TIMEOUT: "TIMEOUT",
  TOO_LARGE: "TOO_LARGE",
  DECODE: "DECODE",
  NOT_RELEVANT: "NOT_RELEVANT",
  MISSING_ACCESS: "MISSING_ACCESS",
  REDIRECT_REJECTED: "REDIRECT_REJECTED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const FAVICON_ERROR_MESSAGES = Object.freeze({
  [FAVICON_ERROR_CODES.INVALID_REQUEST]: "The website icon request is invalid.",
  [FAVICON_ERROR_CODES.INVALID_DATA]: "The website icon data is invalid.",
  [FAVICON_ERROR_CODES.UNAVAILABLE]: "Website icon storage is unavailable.",
  [FAVICON_ERROR_CODES.BLOCKED]: "Website icon storage is blocked by another extension page.",
  [FAVICON_ERROR_CODES.QUOTA]: "There is not enough local space for this website icon.",
  [FAVICON_ERROR_CODES.STALE_GENERATION]: "The website icon changed while it was being saved.",
  [FAVICON_ERROR_CODES.NETWORK]: "The website icon could not be downloaded directly from the website.",
  [FAVICON_ERROR_CODES.TIMEOUT]: "The website icon request timed out.",
  [FAVICON_ERROR_CODES.TOO_LARGE]: "The website icon is too large.",
  [FAVICON_ERROR_CODES.DECODE]: "The website icon could not be decoded safely.",
  [FAVICON_ERROR_CODES.NOT_RELEVANT]: "The website icon is no longer relevant.",
  [FAVICON_ERROR_CODES.MISSING_ACCESS]: "Firefox needs permission to download this website icon.",
  [FAVICON_ERROR_CODES.REDIRECT_REJECTED]: "The website icon request redirected and was blocked.",
  [FAVICON_ERROR_CODES.INTERNAL_ERROR]: "The website icon could not be processed."
});

export const FAVICON_DIAGNOSTIC_REASONS = Object.freeze({
  MISSING_CANDIDATE: "missing-candidate",
  DENIED_POLICY: "denied-policy",
  MISSING_ACCESS: "missing-access",
  REDIRECT_REJECTED: "redirect-rejected",
  FETCH_FAILED: "fetch-failed",
  DECODE_FAILED: "decode-failed",
  RASTER_VALIDATION_FAILED: "raster-validation-failed",
  BITMAP_DECODE_FAILED: "bitmap-decode-failed",
  DIMENSIONS_REJECTED: "dimensions-rejected",
  RASTER_CONTEXT_FAILED: "raster-context-failed",
  RASTER_ENCODE_FAILED: "raster-encode-failed",
  DATABASE_FAILED: "database-failed",
  SAVED: "saved",
  DISPLAYED: "displayed",
  DISPLAY_FAILED: "display-failed"
});

const FAVICON_DIAGNOSTIC_REASON_VALUES = new Set(Object.values(FAVICON_DIAGNOSTIC_REASONS));

export class FaviconError extends Error {
  constructor(code, options = {}) {
    super(FAVICON_ERROR_MESSAGES[code] ?? FAVICON_ERROR_MESSAGES.INTERNAL_ERROR, options);
    this.name = "FaviconError";
    this.code = FAVICON_ERROR_MESSAGES[code] ? code : FAVICON_ERROR_CODES.INTERNAL_ERROR;
    this.diagnosticReason = FAVICON_DIAGNOSTIC_REASON_VALUES.has(options.diagnosticReason)
      ? options.diagnosticReason
      : null;
  }
}

const LOCAL_DATA_MIME_TYPES = new Set(Object.values(FAVICON_MIME_TYPES));
const MIME_ALIASES = new Map([
  ["image/vnd.microsoft.icon", FAVICON_MIME_TYPES.ICO],
  ["image/ico", FAVICON_MIME_TYPES.ICO]
]);
const EXPECTED_FAILURE_CODES = new Set([
  FAVICON_ERROR_CODES.INVALID_DATA,
  FAVICON_ERROR_CODES.NETWORK,
  FAVICON_ERROR_CODES.TIMEOUT,
  FAVICON_ERROR_CODES.TOO_LARGE,
  FAVICON_ERROR_CODES.DECODE,
  FAVICON_ERROR_CODES.QUOTA,
  FAVICON_ERROR_CODES.NOT_RELEVANT,
  FAVICON_ERROR_CODES.MISSING_ACCESS,
  FAVICON_ERROR_CODES.REDIRECT_REJECTED
]);

const KNOWN_LOOKUP_ENDPOINTS = Object.freeze([
  { hostname: "www.google.com", path: /^\/s2\/favicons(?:\/|$)/i },
  { hostname: "google.com", path: /^\/s2\/favicons(?:\/|$)/i },
  { hostnamePattern: /^t[0-3]\.gstatic\.com$/i, path: /^\/faviconv2(?:\/|$)/i },
  { hostname: "icons.duckduckgo.com", path: /^\/ip[23](?:\/|$)/i },
  { hostname: "logo.clearbit.com", path: /^\// },
  { hostname: "icon.horse", path: /^\/icon(?:\/|$)/i }
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "::" ||
    host === "::1" ||
    host.startsWith("::ffff:") ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89abcdef]/.test(host) ||
    host.startsWith("ff")
  );
}

export function isLocalOrPrivateHostname(hostname) {
  const host = typeof hostname === "string" ? hostname.toLowerCase().replace(/\.$/, "") : "";
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host)
  );
}

export function canonicalizePageOrigin(value) {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname ||
      isLocalOrPrivateHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function canonicalizeFaviconHostOrigin(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname ||
      isLocalOrPrivateHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function faviconHostPermissionPattern(value) {
  const origin = canonicalizeFaviconHostOrigin(value);
  if (!origin) return null;
  const parsed = new URL(origin);
  return `https://${parsed.hostname}/*`;
}

export function isKnownFaviconLookupEndpoint(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return KNOWN_LOOKUP_ENDPOINTS.some((endpoint) =>
    (endpoint.hostname === hostname || endpoint.hostnamePattern?.test(hostname)) &&
    endpoint.path.test(parsed.pathname)
  );
}

export function classifyFaviconCandidate({ pageUrl, candidateUrl } = {}) {
  const origin = canonicalizePageOrigin(pageUrl);
  if (
    !origin ||
    typeof candidateUrl !== "string" ||
    candidateUrl.length === 0 ||
    candidateUrl.length > FAVICON_CACHE_LIMITS.maximumSourceBytes * 2 + 128
  ) {
    return Object.freeze({ kind: "rejected", reason: "ineligible" });
  }

  const localData = parseLocalRasterDataUrl(candidateUrl);
  if (localData) {
    return Object.freeze({ kind: "local-data", origin, ...localData });
  }
  if (/^data:/i.test(candidateUrl)) {
    return Object.freeze({ kind: "rejected", reason: "unsupported-data-type" });
  }

  if (candidateUrl.length > 8192) {
    return Object.freeze({ kind: "rejected", reason: "remote-boundary" });
  }

  try {
    const page = new URL(pageUrl);
    const candidate = new URL(candidateUrl, page);
    if (
      page.protocol !== "https:" ||
      candidate.protocol !== "https:" ||
      candidate.username ||
      candidate.password ||
      isLocalOrPrivateHostname(candidate.hostname) ||
      candidate.pathname.toLowerCase().endsWith(".svg") ||
      isKnownFaviconLookupEndpoint(candidate)
    ) {
      return Object.freeze({
        kind: "rejected",
        reason: isKnownFaviconLookupEndpoint(candidate) ? "lookup-provider" : "remote-boundary"
      });
    }
    return Object.freeze({
      kind: "remote",
      origin,
      candidateOrigin: candidate.origin,
      crossOrigin: candidate.origin !== origin,
      url: candidate.href
    });
  } catch {
    return Object.freeze({ kind: "rejected", reason: "malformed" });
  }
}

export function parseLocalRasterDataUrl(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FAVICON_CACHE_LIMITS.maximumSourceBytes * 2 + 128
  ) {
    return null;
  }
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  const mime = normalizeRasterMime(match[1]);
  if (!LOCAL_DATA_MIME_TYPES.has(mime)) return null;
  return Object.freeze({ mime, encodedData: match[2].replace(/\s/g, "") });
}

export function normalizeRasterMime(value) {
  if (typeof value !== "string") return null;
  const mime = value.trim().toLowerCase();
  return MIME_ALIASES.get(mime) ?? mime;
}

export function decodeBase64RasterData(encoded, maximumBytes = FAVICON_CACHE_LIMITS.maximumSourceBytes) {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > maximumBytes * 2) {
    throw new FaviconError(FAVICON_ERROR_CODES.TOO_LARGE);
  }
  let binary;
  try {
    binary = atob(encoded.replace(/\s/g, ""));
  } catch {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  if (binary.length > maximumBytes) {
    throw new FaviconError(FAVICON_ERROR_CODES.TOO_LARGE);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function sniffRasterMime(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (value.length >= 8 && value[0] === 0x89 && value[1] === 0x50 && value[2] === 0x4e && value[3] === 0x47 && value[4] === 0x0d && value[5] === 0x0a && value[6] === 0x1a && value[7] === 0x0a) {
    return FAVICON_MIME_TYPES.PNG;
  }
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) {
    return FAVICON_MIME_TYPES.JPEG;
  }
  if (value.length >= 6 && new TextDecoder("ascii").decode(value.slice(0, 6)).startsWith("GIF8")) {
    return FAVICON_MIME_TYPES.GIF;
  }
  if (value.length >= 12 && new TextDecoder("ascii").decode(value.slice(0, 4)) === "RIFF" && new TextDecoder("ascii").decode(value.slice(8, 12)) === "WEBP") {
    return FAVICON_MIME_TYPES.WEBP;
  }
  if (value.length >= 4 && value[0] === 0x00 && value[1] === 0x00 && value[2] === 0x01 && value[3] === 0x00) {
    return FAVICON_MIME_TYPES.ICO;
  }
  return null;
}

export function validateRasterBytes(bytes, declaredMime = null) {
  const copy = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes ?? []);
  if (copy.byteLength === 0 || copy.byteLength > FAVICON_CACHE_LIMITS.maximumSourceBytes) {
    throw new FaviconError(copy.byteLength > 0 ? FAVICON_ERROR_CODES.TOO_LARGE : FAVICON_ERROR_CODES.INVALID_DATA);
  }
  const mime = sniffRasterMime(copy);
  if (!mime || (declaredMime && normalizeRasterMime(declaredMime) !== mime)) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  return Object.freeze({ bytes: copy, mime });
}

export async function digestFaviconSource(value, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle || typeof value !== "string") {
    throw new FaviconError(FAVICON_ERROR_CODES.UNAVAILABLE);
  }
  const digest = await cryptoObject.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA, { cause: new Error(`${label} is invalid.`) });
  }
  return value;
}

const PARTITION_PATTERN = /^(?:default|[a-f0-9]{64})$/;
const ICON_RECORD_KEYS = ["partition", "origin", "blob", "mime", "byteCount", "updatedAt", "lastAccessedAt", "sourceDigest"];

// Stored rows add their derived store key; parsed records never carry it.
function withoutStoredKey(value, fields) {
  if (!isRecord(value) || !Object.hasOwn(value, "key")) return value;
  const storedFields = Object.hasOwn(value, "partitionOrigin")
    ? ["key", "partitionOrigin", ...fields]
    : ["key", ...fields];
  if (
    !exactKeys(value, storedFields) ||
    value.key !== faviconSourceKey(value.partition, value.origin, value.sourceDigest) ||
    (Object.hasOwn(value, "partitionOrigin") && value.partitionOrigin !== `${value.partition} ${value.origin}`)
  ) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  const { key: _key, partitionOrigin: _partitionOrigin, ...rest } = value;
  return rest;
}

export function parseFaviconIconRecord(input) {
  const compatible = isRecord(input) && !Object.hasOwn(input, "partition")
    ? { ...input, partition: FAVICON_DEFAULT_PARTITION }
    : input;
  const value = withoutStoredKey(compatible, ICON_RECORD_KEYS);
  if (!exactKeys(value, ICON_RECORD_KEYS)) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  if (
    !PARTITION_PATTERN.test(value.partition) ||
    canonicalizePageOrigin(value.origin) !== value.origin ||
    !(value.blob instanceof Blob) ||
    value.mime !== FAVICON_MIME_TYPES.PNG ||
    value.blob.type !== FAVICON_MIME_TYPES.PNG ||
    value.blob.size !== value.byteCount ||
    typeof value.sourceDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceDigest)
  ) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  return {
    partition: value.partition,
    origin: value.origin,
    blob: value.blob.slice(0, value.blob.size, value.blob.type),
    mime: value.mime,
    byteCount: safeInteger(value.byteCount, "byteCount"),
    updatedAt: safeInteger(value.updatedAt, "updatedAt"),
    lastAccessedAt: safeInteger(value.lastAccessedAt, "lastAccessedAt"),
    sourceDigest: value.sourceDigest
  };
}

const FAILURE_RECORD_KEYS = [
  "partition", "origin", "sourceDigest", "attemptedAt", "retryAt", "failureClass", "policyVersion", "accessOrigin"
];

export function parseFaviconFailureRecord(input) {
  const compatible = isRecord(input) && !Object.hasOwn(input, "partition")
    ? { ...input, partition: FAVICON_DEFAULT_PARTITION }
    : input;
  const value = withoutStoredKey(compatible, FAILURE_RECORD_KEYS);
  const legacy = exactKeys(value, ["partition", "origin", "sourceDigest", "attemptedAt", "retryAt", "failureClass"]);
  const current = exactKeys(value, FAILURE_RECORD_KEYS);
  if (!legacy && !current) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  const policyVersion = legacy ? 1 : value.policyVersion;
  const accessOrigin = legacy ? null : value.accessOrigin;
  if (
    !PARTITION_PATTERN.test(value.partition) ||
    canonicalizePageOrigin(value.origin) !== value.origin ||
    typeof value.sourceDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceDigest) ||
    typeof value.failureClass !== "string" ||
    !EXPECTED_FAILURE_CODES.has(value.failureClass) ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion < 1 ||
    policyVersion > FAVICON_POLICY_VERSION ||
    (accessOrigin !== null && canonicalizeFaviconHostOrigin(accessOrigin) !== accessOrigin) ||
    (value.failureClass === FAVICON_ERROR_CODES.MISSING_ACCESS) !== (accessOrigin !== null)
  ) {
    throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  }
  const attemptedAt = safeInteger(value.attemptedAt, "attemptedAt");
  const retryAt = safeInteger(value.retryAt, "retryAt");
  if (retryAt < attemptedAt) throw new FaviconError(FAVICON_ERROR_CODES.INVALID_DATA);
  return {
    partition: value.partition,
    origin: value.origin,
    sourceDigest: value.sourceDigest,
    attemptedAt,
    retryAt,
    failureClass: value.failureClass,
    policyVersion,
    accessOrigin
  };
}

export function isExpectedFaviconFailure(error) {
  return error instanceof FaviconError && EXPECTED_FAILURE_CODES.has(error.code);
}

export function sanitizeFaviconError(error) {
  const code = error instanceof FaviconError && FAVICON_ERROR_MESSAGES[error.code]
    ? error.code
    : FAVICON_ERROR_CODES.INTERNAL_ERROR;
  return Object.freeze({ code, message: FAVICON_ERROR_MESSAGES[code] });
}

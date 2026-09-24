import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVICON_CACHE_LIMITS,
  FAVICON_ERROR_CODES,
  FAVICON_POLICY_VERSION,
  canonicalizePageOrigin,
  classifyFaviconCandidate,
  decodeBase64RasterData,
  digestFaviconSource,
  faviconHostPermissionPattern,
  isKnownFaviconLookupEndpoint,
  parseFaviconFailureRecord,
  sanitizeFaviconError,
  validateRasterBytes
} from "../../src/contracts/favicon-cache.js";
import {
  FAVICON_MESSAGE_TYPES,
  parseFaviconRequest
} from "../../src/contracts/favicon-messages.js";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);

test("favicon origins preserve security boundaries and normalize URL identity", () => {
  assert.equal(canonicalizePageOrigin("https://EXAMPLE.invalid:443/path?q=1"), "https://example.invalid");
  assert.equal(canonicalizePageOrigin("http://example.invalid:80/"), "http://example.invalid");
  assert.equal(canonicalizePageOrigin("https://example.invalid:8443/"), "https://example.invalid:8443");
  assert.equal(canonicalizePageOrigin("https://www.example.invalid/"), "https://www.example.invalid");
  assert.equal(canonicalizePageOrigin("https://bücher.invalid/"), "https://xn--bcher-kva.invalid");
  for (const value of [
    "https://user@example.invalid/", "file:///tmp/a", "about:config", "moz-extension://id/a",
    "https://localhost/", "https://127.0.0.1/", "https://10.1.2.3/", "https://192.168.1.2/",
    "https://100.64.0.1/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "not a url"
  ]) assert.equal(canonicalizePageOrigin(value), null);
});

test("candidate policy admits reported HTTPS CDN and relative URLs but rejects lookup services", () => {
  const pageUrl = "https://example.invalid/page";
  assert.equal(classifyFaviconCandidate({ pageUrl, candidateUrl: "https://example.invalid/favicon.ico" }).kind, "remote");
  assert.deepEqual(classifyFaviconCandidate({
    pageUrl: "https://example.invalid/a/page",
    candidateUrl: "../favicon.png"
  }), {
    kind: "remote",
    origin: "https://example.invalid",
    candidateOrigin: "https://example.invalid",
    crossOrigin: false,
    url: "https://example.invalid/favicon.png"
  });
  assert.deepEqual(classifyFaviconCandidate({
    pageUrl,
    candidateUrl: "https://cdn.assets.invalid/favicon.ico"
  }), {
    kind: "remote",
    origin: "https://example.invalid",
    candidateOrigin: "https://cdn.assets.invalid",
    crossOrigin: true,
    url: "https://cdn.assets.invalid/favicon.ico"
  });
  assert.equal(
    classifyFaviconCandidate({ pageUrl, candidateUrl: "https://fonts.gstatic.com/icon.png" }).kind,
    "remote"
  );
  assert.equal(classifyFaviconCandidate({ pageUrl, candidateUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}` }).kind, "local-data");
  for (const candidateUrl of [
    "http://example.invalid/favicon.ico",
    "https://example.invalid/favicon.svg",
    "blob:https://example.invalid/id",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "https://www.google.com/s2/favicons?domain=example.invalid",
    "https://t2.gstatic.com/faviconV2?client=SOCIAL",
    "https://icons.duckduckgo.com/ip3/example.invalid.ico",
    "https://logo.clearbit.com/example.invalid",
    "https://icon.horse/icon/example.invalid"
  ]) assert.equal(classifyFaviconCandidate({ pageUrl, candidateUrl }).kind, "rejected");
  assert.equal(classifyFaviconCandidate({
    pageUrl: "http://example.invalid/page",
    candidateUrl: "https://cdn.assets.invalid/favicon.ico"
  }).kind, "rejected");
  assert.equal(isKnownFaviconLookupEndpoint("https://www.google.com/images/logo.png"), false);
  assert.equal(faviconHostPermissionPattern("https://CDN.assets.invalid:443/path"), "https://cdn.assets.invalid/*");
  assert.equal(faviconHostPermissionPattern("https://cdn.assets.invalid:8443/path"), "https://cdn.assets.invalid/*");
  assert.equal(faviconHostPermissionPattern("http://cdn.assets.invalid/"), null);
});

test("legacy favicon failures remain readable and are marked for policy retry", () => {
  assert.deepEqual(parseFaviconFailureRecord({
    origin: "https://example.invalid",
    sourceDigest: "a".repeat(64),
    attemptedAt: 10,
    retryAt: 20,
    failureClass: FAVICON_ERROR_CODES.NETWORK
  }), {
    partition: "default",
    origin: "https://example.invalid",
    sourceDigest: "a".repeat(64),
    attemptedAt: 10,
    retryAt: 20,
    failureClass: FAVICON_ERROR_CODES.NETWORK,
    policyVersion: 1,
    accessOrigin: null
  });
  assert.equal(FAVICON_POLICY_VERSION, 3);
});

test("local raster decoding is bounded and signature checked", () => {
  const encoded = Buffer.from(PNG_BYTES).toString("base64");
  assert.deepEqual(decodeBase64RasterData(encoded), PNG_BYTES);
  assert.equal(validateRasterBytes(PNG_BYTES, "image/png").mime, "image/png");
  assert.throws(() => validateRasterBytes(PNG_BYTES, "image/jpeg"), { code: FAVICON_ERROR_CODES.INVALID_DATA });
  assert.throws(() => decodeBase64RasterData("%%%"), { code: FAVICON_ERROR_CODES.INVALID_DATA });
  assert.throws(
    () => decodeBase64RasterData("a".repeat(FAVICON_CACHE_LIMITS.maximumSourceBytes * 2 + 1)),
    { code: FAVICON_ERROR_CODES.TOO_LARGE }
  );
});

test("digests and public failures expose no source URL", async () => {
  const digest = await digestFaviconSource("https://secret.invalid/private/path");
  assert.match(digest, /^[a-f0-9]{64}$/);
  const safe = sanitizeFaviconError(new Error("https://secret.invalid/private/path"));
  assert.deepEqual(safe, {
    code: FAVICON_ERROR_CODES.INTERNAL_ERROR,
    message: "The website icon could not be processed."
  });
  assert.doesNotMatch(JSON.stringify(safe), /secret|private\/path/);
});

test("favicon messages are exact and URL-free except explicit origin invalidation", () => {
  assert.deepEqual(parseFaviconRequest({
    type: FAVICON_MESSAGE_TYPES.LOOKUP,
    windowId: 7,
    tabs: [{ logicalId: "tab-alpha", firefoxTabId: 11 }]
  }).tabs, [{ logicalId: "tab-alpha", firefoxTabId: 11 }]);
  assert.throws(() => parseFaviconRequest({
    type: FAVICON_MESSAGE_TYPES.LOOKUP,
    windowId: 7,
    tabs: [],
    url: "https://example.invalid/"
  }), { code: FAVICON_ERROR_CODES.INVALID_REQUEST });
  assert.deepEqual(parseFaviconRequest({ type: FAVICON_MESSAGE_TYPES.CLEAR_ALL }), {
    type: FAVICON_MESSAGE_TYPES.CLEAR_ALL
  });
  assert.deepEqual(parseFaviconRequest({
    type: FAVICON_MESSAGE_TYPES.ACCESS_GRANTED,
    origin: "https://cdn.example.invalid"
  }), {
    type: FAVICON_MESSAGE_TYPES.ACCESS_GRANTED,
    origin: "https://cdn.example.invalid"
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_FILE_ACCEPT,
  CUSTOM_ICON_LIMITS,
  CUSTOM_ICON_MESSAGE_TYPES,
  CustomIconError,
  createCustomIconId,
  customIconChanged,
  customIconFailure,
  customIconLabelFromFileName,
  customIconSummary,
  digestCustomIconBytes,
  isCustomIconId,
  parseCustomIconLabel,
  parseCustomIconCompatibilityRecord,
  parseCustomIconList,
  parseCustomIconRecord,
  parseStoredCustomIconRecord,
  parseCustomIconRequest,
  readPngDimensions,
  sanitizeCustomIconError,
  validateCustomIconPng
} from "../../src/contracts/custom-icons.js";
import { customIconRecord, pngBytes, sha256Hex } from "../helpers/custom-icon-fixture.js";

function rejectsWith(code) {
  return (error) => error instanceof CustomIconError && error.code === code;
}

test("custom icon IDs are generated from a UUID and recognized only in their exact shape", () => {
  const id = createCustomIconId(() => "0123ABCD-4567-89ab-cdef-0123456789AB");
  assert.equal(id, "custom-0123abcd456789abcdef0123456789ab");
  assert.equal(isCustomIconId(id), true);
  assert.throws(() => createCustomIconId(() => "not-a-uuid"), rejectsWith(CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR));
  for (const value of [null, 7, "custom-", `custom-${"a".repeat(31)}`, `Custom-${"a".repeat(32)}`, "house"]) {
    assert.equal(isCustomIconId(value), false, String(value));
  }
});

test("labels come from the file name without its last extension and stay plain text", () => {
  assert.equal(customIconLabelFromFileName("Team Logo.png"), "Team Logo");
  assert.equal(customIconLabelFromFileName("trip.final.jpeg"), "trip.final");
  assert.equal(customIconLabelFromFileName("  spaced\t name  .svg"), "spaced name");
  assert.equal(customIconLabelFromFileName(`bell${String.fromCharCode(7)}ring.gif`), "bellring");
  assert.equal(customIconLabelFromFileName(".png"), "Custom icon");
  assert.equal(customIconLabelFromFileName(undefined), "Custom icon");
  assert.equal([...customIconLabelFromFileName(`${"x".repeat(200)}.png`)].length, CUSTOM_ICON_LIMITS.maxLabelLength);

  assert.equal(parseCustomIconLabel("Team Logo"), "Team Logo");
  for (const invalid of ["", " padded", "a  b", "x".repeat(81), `bad${String.fromCharCode(0)}`, 4]) {
    assert.throws(() => parseCustomIconLabel(invalid), rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST));
  }
});

test("stored images must be a 128 by 128 PNG within the byte cap", () => {
  assert.deepEqual(readPngDimensions(pngBytes({ width: 64, height: 32 })), { width: 64, height: 32 });
  assert.equal(readPngDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(readPngDimensions(pngBytes().slice(0, 20)), null);

  const original = pngBytes();
  const copy = validateCustomIconPng(original);
  assert.deepEqual(copy, original);
  assert.notStrictEqual(copy, original);

  assert.throws(() => validateCustomIconPng([1, 2, 3]), rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST));
  assert.throws(
    () => validateCustomIconPng(pngBytes({ length: CUSTOM_ICON_LIMITS.maxStoredBytes + 1 })),
    rejectsWith(CUSTOM_ICON_ERROR_CODES.TOO_LARGE)
  );
  assert.throws(() => validateCustomIconPng(pngBytes({ width: 127 })), rejectsWith(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE));
  assert.throws(
    () => validateCustomIconPng(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    rejectsWith(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE)
  );
});

test("digests are lowercase SHA-256 hex of the stored bytes", async () => {
  const bytes = pngBytes({ fill: 9 });
  assert.equal(await digestCustomIconBytes(bytes), sha256Hex(bytes));
});

test("records and list responses validate every field before use", () => {
  const record = customIconRecord();
  const parsed = parseCustomIconRecord(record);
  assert.equal(parsed.byteLength, record.bytes.byteLength);
  // A record stored before originals were retained reads back with no source,
  // which is what every pre-existing row looks like.
  assert.deepEqual(customIconSummary(parsed), {
    id: record.id,
    label: record.label,
    digest: record.digest,
    createdAt: record.createdAt,
    bytes: record.bytes
  });
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const withSource = parseCustomIconRecord({
    ...record,
    source: { mimeType: "image/svg+xml", byteLength: svg.byteLength, bytes: svg }
  });
  assert.equal(withSource.source.mimeType, "image/svg+xml");
  assert.deepEqual(withSource.source.bytes, svg);
  assert.equal(Object.hasOwn(customIconSummary(withSource), "source"), false);

  const corruptOptionalSource = {
    ...record,
    source: { mimeType: "image/svg+xml", byteLength: 2, bytes: new Uint8Array([1]) }
  };
  assert.equal(parseStoredCustomIconRecord(corruptOptionalSource).source, null);
  assert.deepEqual(parseStoredCustomIconRecord(corruptOptionalSource).bytes, record.bytes);

  for (const invalid of [
    { ...record, byteLength: record.byteLength + 1 },
    { ...record, extra: true },
    { ...record, createdAt: "2026-09-11" },
    { ...record, digest: "A".repeat(64) },
    { ...record, id: "custom-1" },
    { ...record, source: { mimeType: "text/html", byteLength: 2, bytes: new Uint8Array([1, 2]) } },
    { ...record, source: { mimeType: "image/svg+xml", byteLength: 3, bytes: new Uint8Array([1, 2]) } },
    { ...record, source: { mimeType: "image/svg+xml", byteLength: 0, bytes: new Uint8Array(0) } },
    { ...record, source: { mimeType: "image/svg+xml", bytes: new Uint8Array([1]) } },
    {
      ...record,
      source: {
        mimeType: "image/png",
        byteLength: CUSTOM_ICON_LIMITS.maxSourceBytes + 1,
        bytes: new Uint8Array(CUSTOM_ICON_LIMITS.maxSourceBytes + 1)
      }
    }
  ]) {
    assert.throws(() => parseCustomIconRecord(invalid), rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST));
  }

  const summary = customIconSummary(parsed);
  const list = parseCustomIconList({ icons: [summary], usage: { iconCount: 1, byteCount: 64 } });
  assert.equal(list.icons[0].id, record.id);
  for (const invalid of [
    { icons: [summary, summary], usage: { iconCount: 2, byteCount: 128 } },
    { icons: Array.from({ length: CUSTOM_ICON_LIMITS.maxIcons + 1 }, () => summary), usage: { iconCount: 0, byteCount: 0 } },
    { icons: [], usage: { iconCount: -1, byteCount: 0 } },
    { icons: [] }
  ]) {
    assert.throws(() => parseCustomIconList(invalid), rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST));
  }
});

test("legacy custom-icon compatibility records are exact, bounded mappings", () => {
  const sourceId = `custom-${"a".repeat(32)}`;
  const targetId = `custom-${"b".repeat(32)}`;
  const record = parseCustomIconCompatibilityRecord({
    sourceId,
    mappings: [{ digest: "c".repeat(64), targetId }]
  });
  assert.deepEqual(record, {
    sourceId,
    mappings: [{ digest: "c".repeat(64), targetId }]
  });
  for (const invalid of [
    { sourceId, mappings: [{ digest: "c".repeat(64), targetId: sourceId }] },
    { sourceId, mappings: [record.mappings[0], record.mappings[0]] },
    { sourceId, mappings: [{ digest: "C".repeat(64), targetId }] },
    { sourceId: "house", mappings: [] }
  ]) {
    assert.throws(
      () => parseCustomIconCompatibilityRecord(invalid),
      rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST)
    );
  }
});

test("requests parse exact shapes and ignore other message families", () => {
  const bytes = pngBytes();
  assert.deepEqual(parseCustomIconRequest({ type: CUSTOM_ICON_MESSAGE_TYPES.LIST }), { type: CUSTOM_ICON_MESSAGE_TYPES.LIST });
  // An add without a source still parses; the original is optional.
  assert.deepEqual(
    parseCustomIconRequest({ type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label: "Logo", bytes }),
    { type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label: "Logo", bytes, source: null }
  );
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  assert.deepEqual(
    parseCustomIconRequest({
      type: CUSTOM_ICON_MESSAGE_TYPES.ADD,
      label: "Logo",
      bytes,
      source: { mimeType: "image/svg+xml", byteLength: svg.byteLength, bytes: svg }
    }),
    {
      type: CUSTOM_ICON_MESSAGE_TYPES.ADD,
      label: "Logo",
      bytes,
      source: { mimeType: "image/svg+xml", byteLength: svg.byteLength, bytes: svg }
    }
  );
  const id = customIconRecord().id;
  assert.deepEqual(
    parseCustomIconRequest({ type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE, id }),
    { type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE, id }
  );
  assert.equal(parseCustomIconRequest({ type: "favicon-cache/overview" }), null);
  assert.equal(parseCustomIconRequest(customIconChanged("added")), null);
  assert.equal(parseCustomIconRequest("custom-icons/list"), null);

  assert.throws(
    () => parseCustomIconRequest({ type: CUSTOM_ICON_MESSAGE_TYPES.LIST, extra: 1 }),
    rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST)
  );
  assert.throws(
    () => parseCustomIconRequest({ type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label: "Logo", bytes: [...bytes] }),
    rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST)
  );
  assert.throws(
    () => parseCustomIconRequest({
      type: CUSTOM_ICON_MESSAGE_TYPES.ADD,
      label: "Logo",
      bytes: new Uint8Array(CUSTOM_ICON_LIMITS.maxStoredBytes + 1)
    }),
    rejectsWith(CUSTOM_ICON_ERROR_CODES.TOO_LARGE)
  );
  assert.throws(
    () => parseCustomIconRequest({ type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE, id: "house" }),
    rejectsWith(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST)
  );
});

test("errors leave only a known code and plain message", () => {
  assert.deepEqual(sanitizeCustomIconError(new Error("secret path")), {
    code: CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR,
    message: "The custom icon could not be processed."
  });
  assert.equal(new CustomIconError("NOPE").code, CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);
  assert.deepEqual(
    customIconFailure(CUSTOM_ICON_MESSAGE_TYPES.ADD, new CustomIconError(CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED)),
    {
      ok: false,
      type: CUSTOM_ICON_MESSAGE_TYPES.ADD,
      error: {
        code: CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED,
        message: "You already have 100 custom icons. Remove one to add another."
      }
    }
  );
});

test("the file picker hint lists every still-image format Firefox decodes and nothing else", () => {
  const accepted = CUSTOM_ICON_FILE_ACCEPT.split(",");
  for (const entry of [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp", ".ico", "image/avif", "image/svg+xml", "image/x-icon"]) {
    assert.ok(accepted.includes(entry), entry);
  }
  for (const entry of [".tif", ".tiff", "image/tiff", ".jxl", "image/jxl"]) {
    assert.equal(accepted.includes(entry), false, entry);
  }
});

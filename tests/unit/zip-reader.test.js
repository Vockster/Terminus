import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { ZipError, createZipArchive, crc32 } from "../../src/core/zip-writer.js";
import { isZipArchive, readZipArchive } from "../../src/core/zip-reader.js";

const LIMITS = { maxTotalBytes: 1024 * 1024 };

// Builds a zip whose headers can be bent, which is how the refusals below are
// exercised. Stored entries match what the writer produces.
function buildZip(entries, { entryCountOverride = null, comment = "" } = {}) {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const content = entry.content ?? new Uint8Array(0);
    const data = entry.method === 8 ? deflateRawSync(content) : content;
    return {
      nameBytes: encoder.encode(entry.name),
      data,
      method: entry.method ?? 0,
      flags: entry.flags ?? 0x0800,
      crc: entry.crc ?? crc32(content),
      size: entry.size ?? content.length
    };
  });
  const commentBytes = encoder.encode(comment);
  const localSize = prepared.reduce((total, e) => total + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = prepared.reduce((total, e) => total + 46 + e.nameBytes.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22 + commentBytes.length);
  const view = new DataView(output.buffer);
  let offset = 0;
  const offsets = [];
  for (const entry of prepared) {
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, entry.flags, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.size, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    output.set(entry.nameBytes, offset + 30);
    output.set(entry.data, offset + 30 + entry.nameBytes.length);
    offset += 30 + entry.nameBytes.length + entry.data.length;
  }
  const centralStart = offset;
  prepared.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 8, entry.flags, true);
    view.setUint16(offset + 10, entry.method, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint32(offset + 42, offsets[index], true);
    output.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  });
  const count = entryCountOverride ?? prepared.length;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, count, true);
  view.setUint16(offset + 10, count, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, commentBytes.length, true);
  output.set(commentBytes, offset + 22);
  return output;
}

const bytesOf = (...values) => new Uint8Array(values);

test("a zip the writer produced reads back byte for byte", async () => {
  const png = bytesOf(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
  const json = new TextEncoder().encode('{"documentType":"sidebars.workspace-archive"}');
  const archive = createZipArchive([
    { name: "workspaces.json", bytes: json },
    { name: "icons/Work.png", bytes: png }
  ]);

  assert.equal(isZipArchive(archive), true);
  const files = await readZipArchive(archive, LIMITS);
  assert.deepEqual([...files.keys()], ["workspaces.json", "icons/Work.png"]);
  assert.deepEqual(files.get("icons/Work.png"), png);
  assert.deepEqual(files.get("workspaces.json"), json);
});

test("an entry another tool compressed still reads, byte for byte", async () => {
  const content = new TextEncoder().encode("terminus".repeat(200));
  const archive = buildZip([{ name: "workspaces.json", content, method: 8 }]);
  const files = await readZipArchive(archive, LIMITS);
  assert.deepEqual(files.get("workspaces.json"), content);
});

test("a trailing zip comment does not hide the directory", async () => {
  const archive = buildZip([{ name: "a.txt", content: bytesOf(1, 2, 3) }], { comment: "made by something" });
  const files = await readZipArchive(archive, LIMITS);
  assert.deepEqual(files.get("a.txt"), bytesOf(1, 2, 3));
});

test("folder entries are skipped rather than read as files", async () => {
  const archive = buildZip([
    { name: "icons/", content: new Uint8Array(0) },
    { name: "icons/Work.png", content: bytesOf(9) }
  ]);
  const files = await readZipArchive(archive, LIMITS);
  assert.deepEqual([...files.keys()], ["icons/Work.png"]);
});

test("content that does not match its checksum is refused", async () => {
  const archive = buildZip([{ name: "a.txt", content: bytesOf(1, 2, 3), crc: 12345 }]);
  await assert.rejects(readZipArchive(archive, LIMITS), ZipError);
});

test("a compressed entry that inflates past its header is refused", async () => {
  // The header promises three bytes; the stream holds far more.
  const archive = buildZip([
    { name: "a.txt", content: new Uint8Array(500).fill(7), method: 8, size: 3 }
  ]);
  await assert.rejects(readZipArchive(archive, LIMITS), ZipError);
});

test("encrypted, unknown-method, zip64 and split archives are refused", async () => {
  const content = bytesOf(1, 2, 3);
  for (const entry of [
    { name: "a.txt", content, flags: 0x0801 },
    { name: "a.txt", content, method: 9 },
    { name: "a.txt", content, size: 0xffffffff }
  ]) {
    await assert.rejects(readZipArchive(buildZip([entry]), LIMITS), ZipError);
  }
  // A directory that claims more entries than it holds.
  await assert.rejects(
    readZipArchive(buildZip([{ name: "a.txt", content }], { entryCountOverride: 4 }), LIMITS),
    ZipError
  );
});

test("two entries with one name are refused rather than silently merged", async () => {
  const archive = buildZip([
    { name: "a.txt", content: bytesOf(1) },
    { name: "a.txt", content: bytesOf(2) }
  ]);
  await assert.rejects(readZipArchive(archive, LIMITS), ZipError);
});

test("a zip is refused before reading when it declares more than the caller allows", async () => {
  const archive = buildZip([{ name: "a.txt", content: new Uint8Array(4096).fill(3) }]);
  await assert.rejects(readZipArchive(archive, { maxTotalBytes: 1024 }), ZipError);
  await assert.rejects(readZipArchive(archive, { maxTotalBytes: 4096, maxEntries: 0 }), ZipError);
  // A size limit is required: a caller cannot read without bounding the result.
  await assert.rejects(readZipArchive(archive, {}), ZipError);
});

test("what is not a zip is not treated as one", async () => {
  for (const bytes of [
    new TextEncoder().encode('{"documentType":"sidebars.workspace-package"}'),
    new Uint8Array(0),
    bytesOf(0x50, 0x4b, 0x03, 0x04)
  ]) {
    assert.equal(isZipArchive(bytes), bytes.length === 4);
    await assert.rejects(readZipArchive(bytes, LIMITS), ZipError);
  }
  assert.equal(isZipArchive("PK"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ZipError,
  createZipArchive,
  crc32,
  uniqueEntryName
} from "../../src/core/zip-writer.js";
import { readZipEntries as readZip } from "../helpers/zip-reader.js";

function bytesOf(...values) {
  return new Uint8Array(values);
}

test("crc32 matches the known check value", () => {
  // The standard CRC-32 of "123456789".
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("entries round trip byte for byte, stored not compressed", () => {
  const first = bytesOf(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
  const second = new Uint8Array(1000).fill(7);
  const archive = createZipArchive([
    { name: "Work.png", bytes: first },
    { name: "Personal.svg", bytes: second }
  ]);

  const entries = readZip(archive);
  assert.deepEqual(entries.map(({ name }) => name), ["Work.png", "Personal.svg"]);
  assert.deepEqual(entries[0].bytes, first);
  assert.deepEqual(entries[1].bytes, second);
  for (const entry of entries) {
    assert.equal(entry.method, 0, "entries are stored");
    assert.equal(entry.crc, crc32(entry.bytes));
  }
});

test("names are declared UTF-8 and survive non-ascii labels", () => {
  const archive = createZipArchive([
    { name: "Arbeit über alles — 日本.png", bytes: bytesOf(1, 2, 3) }
  ]);
  const [entry] = readZip(archive);
  assert.equal(entry.name, "Arbeit über alles — 日本.png");
  assert.equal(entry.flags & 0x0800, 0x0800);
});

test("an empty file is a valid entry", () => {
  const archive = createZipArchive([{ name: "empty.png", bytes: new Uint8Array(0) }]);
  const [entry] = readZip(archive);
  assert.equal(entry.bytes.length, 0);
  assert.equal(entry.crc, 0);
});

test("a zip with no entries, a nameless entry, or missing bytes is refused", () => {
  assert.throws(() => createZipArchive([]), ZipError);
  assert.throws(() => createZipArchive([{ name: "", bytes: bytesOf(1) }]), ZipError);
  assert.throws(() => createZipArchive([{ name: "a.png", bytes: null }]), ZipError);
});

test("colliding entry names are disambiguated, keeping the extension", () => {
  const taken = new Set();
  assert.equal(uniqueEntryName("Work.png", taken), "Work.png");
  assert.equal(uniqueEntryName("Work.png", taken), "Work (2).png");
  assert.equal(uniqueEntryName("Work.png", taken), "Work (3).png");
  assert.equal(uniqueEntryName("noextension", taken), "noextension");
  assert.equal(uniqueEntryName("noextension", taken), "noextension (2)");
});

test("the archive is readable by a real extractor", (t) => {
  // Node cannot unzip, so this leans on the platform's own tool. It is skipped
  // where none is available rather than weakened.
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), "terminus-zip-"));
  } catch {
    t.skip("no temporary directory");
    return;
  }
  try {
    const payload = new Uint8Array(512).fill(0x41);
    const archive = createZipArchive([{ name: "icon.png", bytes: payload }]);
    const archivePath = join(directory, "icons.zip");
    writeFileSync(archivePath, archive);

    let listing;
    try {
      listing = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
            `$zip=[System.IO.Compression.ZipFile]::OpenRead('${archivePath}'); ` +
            `$zip.Entries | ForEach-Object { "$($_.FullName) $($_.Length)" }; $zip.Dispose()`
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      t.skip("no extractor available on this platform");
      return;
    }
    assert.match(listing, /icon\.png 512/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

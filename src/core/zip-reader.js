// A minimal ZIP reader for archives Terminus itself writes, which also accepts
// the same archive re-saved by another tool with deflate. It reads the central
// directory, as extractors do, and verifies every entry's size and CRC. Nothing
// is extracted to disk: callers look entries up by exact name.

import { ZipError, crc32 } from "./zip-writer.js";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

export function isZipArchive(bytes) {
  return bytes instanceof Uint8Array &&
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function findEndRecord(view, length) {
  const lowest = Math.max(0, length - END_RECORD_SIZE - MAX_COMMENT_LENGTH);
  for (let offset = length - END_RECORD_SIZE; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new ZipError("The file has no zip directory.");
}

// Output is capped at the size the directory declared, so a hostile entry
// cannot inflate past the limit its header promised.
async function inflate(data, expectedSize) {
  if (typeof DecompressionStream !== "function") {
    throw new ZipError("Compressed zip entries cannot be read here.");
  }
  const reader = new Blob([data]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const output = new Uint8Array(expectedSize);
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.length > expectedSize) {
        throw new ZipError("A zip entry is larger than its header says.");
      }
      output.set(value, written);
      written += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof ZipError ? error : new ZipError("A zip entry could not be decompressed.");
  }
  if (written !== expectedSize) throw new ZipError("A zip entry is shorter than its header says.");
  return output;
}

// Returns a Map from entry name to bytes. Directory entries are skipped.
export async function readZipArchive(bytes, { maxEntries = 512, maxTotalBytes } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < END_RECORD_SIZE) {
    throw new ZipError("The file is not a zip.");
  }
  if (!Number.isInteger(maxTotalBytes) || maxTotalBytes <= 0) {
    throw new ZipError("A zip read needs a size limit.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view, bytes.length);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count
  ) {
    throw new ZipError("Split zips are not supported.");
  }
  if (count === ZIP64_MARKER_16 || directoryOffset === ZIP64_MARKER_32) {
    throw new ZipError("Zip64 archives are not supported.");
  }
  if (count > maxEntries) throw new ZipError("The zip holds too many files.");
  if (directoryOffset + directorySize > end) throw new ZipError("The zip directory is damaged.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const planned = [];
  let declaredTotal = 0;
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipError("The zip directory is damaged.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    let name;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw new ZipError("A zip entry has an unreadable name.");
    }
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & FLAG_ENCRYPTED) throw new ZipError("Encrypted zips are not supported.");
    if (compressedSize === ZIP64_MARKER_32 || size === ZIP64_MARKER_32 || localOffset === ZIP64_MARKER_32) {
      throw new ZipError("Zip64 archives are not supported.");
    }
    if (name.endsWith("/")) continue;
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      throw new ZipError("The zip uses a compression Terminus cannot read.");
    }
    declaredTotal += size;
    if (declaredTotal > maxTotalBytes) throw new ZipError("The zip is too large.");
    planned.push({ name, flags, method, crc, compressedSize, size, localOffset });
  }

  const entries = new Map();
  for (const entry of planned) {
    if (entries.has(entry.name)) throw new ZipError("The zip holds two files with one name.");
    const local = entry.localOffset;
    if (local + 30 > directoryOffset || view.getUint32(local, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new ZipError("A zip entry is damaged.");
    }
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > directoryOffset) throw new ZipError("A zip entry is damaged.");
    const data = bytes.subarray(dataStart, dataEnd);
    let content;
    if (entry.method === METHOD_STORE) {
      if (entry.compressedSize !== entry.size) throw new ZipError("A zip entry is damaged.");
      content = new Uint8Array(data);
    } else {
      content = await inflate(data, entry.size);
    }
    if (crc32(content) !== entry.crc) throw new ZipError("A zip entry failed its checksum.");
    entries.set(entry.name, content);
  }
  return entries;
}

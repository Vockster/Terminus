import assert from "node:assert/strict";

// A zip is a reversible contract, so the writer is proved by reading it back.
// This parses the central directory rather than trusting local headers, which
// is what a real extractor does.
export function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, "no end-of-central-directory record");

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "bad central header");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, "bad local header");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + extraLength;
    entries.push({
      name,
      flags,
      method,
      crc,
      bytes: bytes.subarray(dataStart, dataStart + size)
    });
    offset += 46 + nameLength;
  }
  return entries;
}

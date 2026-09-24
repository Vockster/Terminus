// A minimal store-only ZIP writer. Terminus has no runtime dependencies, and
// the only archive it produces holds already-compressed images, so deflate
// would add a compressor for almost no saving. Entries are stored verbatim.

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
const METHOD_STORE = 0;
// Bit 11 promises UTF-8 entry names, which icon labels need.
const FLAG_UTF8_NAMES = 0x0800;
const MAX_ENTRIES = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS packed date and time, which is what the format stores. Seconds have
// two-second resolution and the epoch is 1980.
function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function encodeName(name) {
  return new TextEncoder().encode(name);
}

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

// Entries are {name, bytes}. Names are used exactly as given; the caller owns
// uniqueness and any path segments.
export function createZipArchive(entries, { modifiedAt = new Date() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ZipError("A zip needs at least one entry.");
  }
  if (entries.length > MAX_ENTRIES) {
    throw new ZipError(`A zip holds at most ${MAX_ENTRIES} entries.`);
  }

  const { time, date } = dosDateTime(modifiedAt);
  const prepared = entries.map(({ name, bytes }) => {
    if (typeof name !== "string" || name.length === 0) {
      throw new ZipError("Every zip entry needs a name.");
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new ZipError(`Entry "${name}" has no bytes.`);
    }
    return { nameBytes: encodeName(name), bytes, crc: crc32(bytes) };
  });

  const localSize = prepared.reduce(
    (total, { nameBytes, bytes }) => total + 30 + nameBytes.length + bytes.length,
    0
  );
  const centralSize = prepared.reduce(
    (total, { nameBytes }) => total + 46 + nameBytes.length,
    0
  );
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;

  const offsets = [];
  for (const { nameBytes, bytes, crc } of prepared) {
    offsets.push(offset);
    view.setUint32(offset, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, FLAG_UTF8_NAMES, true);
    view.setUint16(offset + 8, METHOD_STORE, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, bytes.length, true);
    view.setUint32(offset + 22, bytes.length, true);
    view.setUint16(offset + 26, nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(nameBytes, offset + 30);
    output.set(bytes, offset + 30 + nameBytes.length);
    offset += 30 + nameBytes.length + bytes.length;
  }

  const centralStart = offset;
  prepared.forEach(({ nameBytes, bytes, crc }, index) => {
    view.setUint32(offset, CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, VERSION_NEEDED, true);
    view.setUint16(offset + 8, FLAG_UTF8_NAMES, true);
    view.setUint16(offset + 10, METHOD_STORE, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, crc, true);
    view.setUint32(offset + 20, bytes.length, true);
    view.setUint32(offset + 24, bytes.length, true);
    view.setUint16(offset + 28, nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, offsets[index], true);
    output.set(nameBytes, offset + 46);
    offset += 46 + nameBytes.length;
  });

  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);

  return output;
}

// Keeps one archive's entry names distinct without surprising the reader: the
// second "Work.png" becomes "Work (2).png".
export function uniqueEntryName(name, taken) {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${stem} (${suffix})${extension}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new ZipError("Too many entries share one name.");
}

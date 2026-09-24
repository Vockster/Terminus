import { createHash } from "node:crypto";

// A PNG header large enough for structural checks. Only the signature and the
// IHDR dimensions matter; decoding is always replaced by a test double.
export function pngBytes({ width = 128, height = 128, length = 64, fill = 0 } = {}) {
  const bytes = new Uint8Array(length).fill(fill);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function customIconId(seed) {
  return `custom-${seed.toString(16).padStart(32, "0")}`;
}

export function customIconRecord({
  seed = 1,
  label = `Icon ${seed}`,
  createdAt = new Date(Date.UTC(2026, 8, 11, 0, 0, seed)).toISOString(),
  bytes = pngBytes({ fill: seed % 256 })
} = {}) {
  return {
    id: customIconId(seed),
    label,
    digest: sha256Hex(bytes),
    createdAt,
    byteLength: bytes.byteLength,
    bytes
  };
}

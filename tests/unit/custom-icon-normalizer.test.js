import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOM_ICON_ERROR_CODES, CUSTOM_ICON_LIMITS } from "../../src/contracts/custom-icons.js";
import {
  containRect,
  createCustomIconNormalizer
} from "../../src/settings/custom-icon-normalizer.js";

function createHarness({
  naturalWidth = 256,
  naturalHeight = 128,
  decode = async () => undefined,
  toBlob = (callback, type) => callback(new Blob([new Uint8Array([1, 2, 3])], { type })),
  drawImage = () => undefined
} = {}) {
  const calls = { created: [], revoked: [], drawn: [], toBlobTypes: [] };
  const documentRef = {
    createElement(tag) {
      if (tag === "img") {
        return { naturalWidth, naturalHeight, src: "", decode };
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage(...args) {
            calls.drawn.push(args.slice(1));
            drawImage();
          }
        }),
        toBlob(callback, type) {
          calls.toBlobTypes.push(type);
          toBlob(callback, type);
        }
      };
    }
  };
  const normalizer = createCustomIconNormalizer({
    documentRef,
    createObjectURL: (file) => {
      calls.created.push(file);
      return "blob:source";
    },
    revokeObjectURL: (url) => calls.revoked.push(url)
  });
  return { normalizer, calls };
}

test("images are fitted inside the square without cropping", () => {
  assert.deepEqual(containRect(256, 128), { x: 0, y: 32, width: 128, height: 64 });
  assert.deepEqual(containRect(50, 100), { x: 32, y: 0, width: 64, height: 128 });
  assert.deepEqual(containRect(0, 0), { x: 0, y: 0, width: 128, height: 128 });
  assert.deepEqual(containRect(Number.NaN, 20), { x: 0, y: 0, width: 128, height: 128 });
});

test("a decodable image becomes a PNG drawn inside a 128 by 128 canvas", async () => {
  const { normalizer, calls } = createHarness();
  const bytes = await normalizer.normalize({ size: 1_000, name: "wide.jpg" });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.deepEqual(calls.drawn, [[0, 32, 128, 64]]);
  assert.deepEqual(calls.toBlobTypes, ["image/png"]);
  assert.deepEqual(calls.revoked, ["blob:source"]);
});

test("oversized files are rejected before they are read", async () => {
  const { normalizer, calls } = createHarness();
  await assert.rejects(
    normalizer.normalize({ size: CUSTOM_ICON_LIMITS.maxInputBytes + 1 }),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.TOO_LARGE
  );
  assert.deepEqual(calls.created, []);
  await assert.rejects(
    normalizer.normalize(null),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST
  );
});

test("undecodable, undrawable, and unexportable images are unreadable and always release the URL", async () => {
  for (const options of [
    { decode: async () => { throw new Error("EncodingError"); } },
    { drawImage: () => { throw new Error("InvalidStateError"); } },
    { toBlob: () => { throw new Error("SecurityError"); } },
    { toBlob: (callback) => callback(null) }
  ]) {
    const { normalizer, calls } = createHarness(options);
    await assert.rejects(
      normalizer.normalize({ size: 10 }),
      (error) => error.code === CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE
    );
    assert.deepEqual(calls.revoked, ["blob:source"]);
  }
});

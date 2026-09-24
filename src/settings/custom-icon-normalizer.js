import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_LIMITS,
  CUSTOM_ICON_MIME_TYPE,
  CustomIconError
} from "../contracts/custom-icons.js";

const SIZE = CUSTOM_ICON_LIMITS.size;

// Fits the image inside the square without cropping and centers it. An image
// without an intrinsic size, such as some SVGs, fills the square.
export function containRect(width, height, size = SIZE) {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: size, height: size };
  const scale = Math.min(size / width, size / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    x: (size - drawWidth) / 2,
    y: (size - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight
  };
}

function unreadable(cause) {
  return new CustomIconError(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE, { cause });
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(unreadable())),
        CUSTOM_ICON_MIME_TYPE
      );
    } catch (error) {
      reject(unreadable(error));
    }
  });
}

// Decoding goes through an image element, so an SVG runs no script and
// fetches nothing. Redrawing on a canvas keeps only the first frame's pixels:
// metadata, animation, and SVG markup never reach storage.
export function createCustomIconNormalizer({
  documentRef = globalThis.document,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url)
} = {}) {
  async function normalize(file) {
    if (!file || typeof file.size !== "number") {
      throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST);
    }
    if (file.size > CUSTOM_ICON_LIMITS.maxInputBytes) {
      throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.TOO_LARGE);
    }
    const url = createObjectURL(file);
    try {
      const image = documentRef.createElement("img");
      image.src = url;
      try {
        await image.decode();
      } catch (error) {
        throw unreadable(error);
      }
      const canvas = documentRef.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);
      const { x, y, width, height } = containRect(image.naturalWidth, image.naturalHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      try {
        context.drawImage(image, x, y, width, height);
      } catch (error) {
        throw unreadable(error);
      }
      const blob = await canvasPng(canvas);
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      revokeObjectURL(url);
    }
  }

  return Object.freeze({ normalize });
}

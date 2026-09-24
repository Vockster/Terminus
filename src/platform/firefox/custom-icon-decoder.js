import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_MIME_TYPE,
  CustomIconError
} from "../../contracts/custom-icons.js";

// createImageBitmap is always invoked as a method of its global: a detached
// copy loses the native receiver in Firefox and fails to decode.
export function createFirefoxCustomIconDecoder({ scope = globalThis } = {}) {
  return Object.freeze({
    async measure(bytes) {
      if (typeof scope.createImageBitmap !== "function") {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR);
      }
      let bitmap;
      try {
        bitmap = await scope.createImageBitmap(new Blob([bytes], { type: CUSTOM_ICON_MIME_TYPE }));
      } catch (error) {
        throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE, { cause: error });
      }
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close?.();
      }
    }
  });
}

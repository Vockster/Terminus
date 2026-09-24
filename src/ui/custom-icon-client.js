import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_ERROR_MESSAGES,
  CUSTOM_ICON_MESSAGE_TYPES,
  CustomIconError,
  parseCustomIconList
} from "../contracts/custom-icons.js";

function unwrap(response) {
  if (response?.ok === true) return response.result;
  const code = response?.error?.code;
  throw new CustomIconError(
    CUSTOM_ICON_ERROR_MESSAGES[code] ? code : CUSTOM_ICON_ERROR_CODES.INTERNAL_ERROR
  );
}

export function createCustomIconClient(
  sendMessage = (message) => browser.runtime.sendMessage(message)
) {
  async function send(message) {
    let response;
    try {
      response = await sendMessage(message);
    } catch (error) {
      throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE, { cause: error });
    }
    return unwrap(response);
  }

  return Object.freeze({
    async list() {
      return parseCustomIconList(await send({ type: CUSTOM_ICON_MESSAGE_TYPES.LIST }));
    },
    add(label, bytes, source = null) {
      return send(
        source === null
          ? { type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label, bytes }
          : { type: CUSTOM_ICON_MESSAGE_TYPES.ADD, label, bytes, source }
      );
    },
    remove(id) {
      return send({ type: CUSTOM_ICON_MESSAGE_TYPES.REMOVE, id });
    }
  });
}

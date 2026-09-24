import {
  CUSTOM_ICON_MESSAGE_TYPES,
  customIconFailure,
  customIconSuccess,
  parseCustomIconRequest
} from "../contracts/custom-icons.js";

export function createCustomIconMessageHandler({ service }) {
  return function handleCustomIconMessage(message) {
    let request;
    try {
      request = parseCustomIconRequest(message);
    } catch (error) {
      return Promise.resolve(customIconFailure(message?.type, error));
    }
    if (request === null) return undefined;

    return (async () => {
      try {
        let result;
        if (request.type === CUSTOM_ICON_MESSAGE_TYPES.LIST) {
          result = await service.list();
        } else if (request.type === CUSTOM_ICON_MESSAGE_TYPES.ADD) {
          result = await service.add(request.label, request.bytes, request.source);
        } else {
          result = await service.remove(request.id);
        }
        return customIconSuccess(request.type, result);
      } catch (error) {
        return customIconFailure(request.type, error);
      }
    })();
  };
}

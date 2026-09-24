import {
  FAVICON_MESSAGE_TYPES,
  FAVICON_GALLERY_PAGE_SIZE,
  faviconFailure,
  faviconSuccess,
  parseFaviconRequest
} from "../contracts/favicon-messages.js";
import { WORKSPACE_SCOPES } from "../contracts/workspace-scope.js";
import { FAVICON_ERROR_CODES, FaviconError } from "../contracts/favicon-cache.js";

export function createFaviconMessageHandler({ service, resolveWindowScope }) {
  return function handleFaviconMessage(message, sender) {
    let request;
    try {
      request = parseFaviconRequest(message);
    } catch (error) {
      return Promise.resolve(faviconFailure(message?.type, error));
    }
    if (request === null) return undefined;

    return (async () => {
      try {
        let result;
        if (request.type === FAVICON_MESSAGE_TYPES.LOOKUP) {
          const scope = await resolveWindowScope(request.windowId);
          result = scope === WORKSPACE_SCOPES.NORMAL
            ? await service.getForTabs(request.windowId, request.tabs)
            : { icons: [] };
        } else if (sender?.tab?.incognito === true) {
          throw new FaviconError(FAVICON_ERROR_CODES.NOT_RELEVANT);
        } else if (request.type === FAVICON_MESSAGE_TYPES.OVERVIEW) {
          result = await service.overview();
        } else if (request.type === FAVICON_MESSAGE_TYPES.LIST) {
          result = await service.listCachedIcons(request.cursor, FAVICON_GALLERY_PAGE_SIZE);
        } else if (request.type === FAVICON_MESSAGE_TYPES.CLEAR_ALL) {
          result = await service.clearAll();
        } else if (request.type === FAVICON_MESSAGE_TYPES.CLEAR_ONE) {
          result = await service.clearOne(request.origin);
        } else if (request.type === FAVICON_MESSAGE_TYPES.ACCESS_GRANTED) {
          result = await service.confirmHostAccess(request.origin);
        } else {
          result = await service.removeUnused();
        }
        return faviconSuccess(request.type, result);
      } catch (error) {
        return faviconFailure(request.type, error);
      }
    })();
  };
}

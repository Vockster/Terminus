import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_IMPORT_MESSAGE_TYPES,
  BookmarkImportError,
  bookmarkImportFailure,
  bookmarkImportSuccess
} from "../contracts/bookmark-import.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function failWith(code) {
  return Promise.resolve(bookmarkImportFailure(new BookmarkImportError(code)));
}

function invalidRequest() {
  return failWith(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
}

const MESSAGE_TYPES = new Set(Object.values(BOOKMARK_IMPORT_MESSAGE_TYPES));

export function createBookmarkImportMessageHandler({ service, onImported = null }) {
  return function handleBookmarkImportMessage(message, sender) {
    if (!isRecord(message) || !MESSAGE_TYPES.has(message.type)) {
      return undefined;
    }
    // Bookmark import is normal-scope only, and a private Settings tab is
    // refused here as well as being disabled in the page.
    if (sender?.tab?.incognito === true) {
      return failWith(BOOKMARK_IMPORT_ERROR_CODES.PRIVATE_WINDOW);
    }
    const respond = (operation) =>
      Promise.resolve(operation).then(bookmarkImportSuccess, bookmarkImportFailure);

    if (message.type === BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FIREFOX) {
      return hasExactKeys(message, ["type"]) ? respond(service.readFirefox()) : invalidRequest();
    }
    if (message.type === BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE) {
      if (
        !hasExactKeys(message, ["type", "name", "text"]) ||
        typeof message.name !== "string" ||
        typeof message.text !== "string"
      ) {
        return invalidRequest();
      }
      // Settings checks the file size first; this is the boundary guard that
      // does not depend on the page.
      if (message.text.length > BOOKMARK_IMPORT_LIMITS.maxFileUnits) {
        return failWith(BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE);
      }
      return respond(service.readFile(message.name, message.text));
    }
    if (message.type === BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE) {
      if (
        !hasExactKeys(message, ["type", "source", "tickedBookmarkIds"]) ||
        !isRecord(message.source) ||
        !Array.isArray(message.tickedBookmarkIds)
      ) {
        return invalidRequest();
      }
      const windowId = sender?.tab?.windowId;
      if (!Number.isInteger(windowId)) {
        return invalidRequest();
      }
      return respond(
        service.create(windowId, message.source, message.tickedBookmarkIds).then((outcome) => {
          onImported?.(windowId);
          return outcome;
        })
      );
    }
    // Progress is broadcast by the background and never requested.
    return invalidRequest();
  };
}

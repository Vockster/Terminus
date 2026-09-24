import { MAX_GROUP_TITLE_LENGTH } from "./workspace-runtime.js";

// One lossless tree represents both sources. Readers preserve folders,
// separators, duplicates, unopenable links, and order exactly as read; every
// skip, merge, and dedupe decision belongs to the mapping layer instead.
export const BOOKMARK_NODE_TYPES = Object.freeze({
  FOLDER: "folder",
  BOOKMARK: "bookmark",
  SEPARATOR: "separator"
});

export const BOOKMARK_SOURCE_KINDS = Object.freeze({
  FIREFOX: "firefox",
  FILE: "file"
});

export const BOOKMARK_FOLDER_ROLES = Object.freeze({
  ROOT: "root",
  MENU: "menu",
  TOOLBAR: "toolbar",
  UNFILED: "unfiled",
  MOBILE: "mobile"
});

export const BOOKMARK_IMPORT_LIMITS = Object.freeze({
  maxNodes: 1_000_000,
  maxFolderDepth: 256,
  maxNodeIdLength: 128,
  maxSourceNameLength: 256,
  maxFileUnits: 67_108_864,
  maxTabTitleLength: 4_096,
  maxGroupTitleLength: MAX_GROUP_TITLE_LENGTH,
  largeImportTabs: 500,
  untestedImportTabs: 2_500
});

export const BOOKMARK_IMPORT_WARNINGS = Object.freeze({
  NONE: "none",
  LARGE: "large",
  UNTESTED: "untested"
});

export const BOOKMARK_IMPORT_WORKSPACE = Object.freeze({
  name: "Imported bookmarks",
  icon: "book-bookmark"
});

export const BOOKMARK_IMPORT_MESSAGE_TYPES = Object.freeze({
  READ_FIREFOX: "bookmarkImport.readFirefox",
  READ_FILE: "bookmarkImport.readFile",
  CREATE: "bookmarkImport.create",
  PROGRESS: "bookmarkImport.progress"
});

export const BOOKMARK_IMPORT_ERROR_CODES = Object.freeze({
  PERMISSION_REQUIRED: "PERMISSION_REQUIRED",
  NOT_BOOKMARKS_FILE: "NOT_BOOKMARKS_FILE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  SOURCE_TOO_LARGE: "SOURCE_TOO_LARGE",
  INVALID_SOURCE: "INVALID_SOURCE",
  NOTHING_TO_IMPORT: "NOTHING_TO_IMPORT",
  WORKSPACE_LIMIT: "WORKSPACE_LIMIT",
  PRIVATE_WINDOW: "PRIVATE_WINDOW",
  INVALID_REQUEST: "INVALID_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const BOOKMARK_IMPORT_ERROR_MESSAGES = Object.freeze({
  [BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED]:
    "Bookmark access is not available. Nothing was imported.",
  [BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE]:
    "This file can't be read as a bookmarks file.",
  [BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE]:
    "That file is too large to import (limit 64 MiB).",
  [BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE]:
    "This bookmark source is too large to import.",
  [BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE]:
    "This file can't be read as a bookmarks file.",
  [BOOKMARK_IMPORT_ERROR_CODES.NOTHING_TO_IMPORT]: "Nothing selected to import.",
  [BOOKMARK_IMPORT_ERROR_CODES.WORKSPACE_LIMIT]:
    "Terminus already has the maximum of 100 workspaces.",
  [BOOKMARK_IMPORT_ERROR_CODES.PRIVATE_WINDOW]:
    "Bookmark import is available in normal windows.",
  [BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST]: "The bookmark import request is invalid.",
  [BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR]: "The bookmark import could not be completed."
});

export class BookmarkImportError extends Error {
  constructor(code, options = {}) {
    super(BOOKMARK_IMPORT_ERROR_MESSAGES[code] ?? BOOKMARK_IMPORT_ERROR_MESSAGES.INTERNAL_ERROR, options);
    this.name = "BookmarkImportError";
    this.code = BOOKMARK_IMPORT_ERROR_MESSAGES[code]
      ? code
      : BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR;
  }
}

const NODE_TYPE_VALUES = new Set(Object.values(BOOKMARK_NODE_TYPES));
const ROLE_VALUES = new Set(Object.values(BOOKMARK_FOLDER_ROLES));
const SOURCE_KIND_VALUES = new Set(Object.values(BOOKMARK_SOURCE_KINDS));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidSource() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE);
}

function sourceTooLarge() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE);
}

function parseNodeId(value, seenIds) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > BOOKMARK_IMPORT_LIMITS.maxNodeIdLength ||
    seenIds.has(value)
  ) {
    throw invalidSource();
  }
  seenIds.add(value);
  return value;
}

function parseDateAdded(value) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw invalidSource();
  }
  return value;
}

function parseNode(value, depth, counter, seenIds) {
  if (!isRecord(value) || !NODE_TYPE_VALUES.has(value.type)) {
    throw invalidSource();
  }
  counter.nodes += 1;
  if (counter.nodes > BOOKMARK_IMPORT_LIMITS.maxNodes) {
    throw sourceTooLarge();
  }
  if (value.type === BOOKMARK_NODE_TYPES.SEPARATOR) {
    if (!hasExactKeys(value, ["type", "id"])) throw invalidSource();
    return { type: BOOKMARK_NODE_TYPES.SEPARATOR, id: parseNodeId(value.id, seenIds) };
  }
  if (value.type === BOOKMARK_NODE_TYPES.BOOKMARK) {
    if (
      !hasExactKeys(value, ["type", "id", "title", "url", "dateAdded"]) ||
      typeof value.title !== "string" ||
      typeof value.url !== "string"
    ) {
      throw invalidSource();
    }
    return {
      type: BOOKMARK_NODE_TYPES.BOOKMARK,
      id: parseNodeId(value.id, seenIds),
      title: value.title,
      url: value.url,
      dateAdded: parseDateAdded(value.dateAdded)
    };
  }
  return parseFolder(value, depth, counter, seenIds);
}

function parseFolder(value, depth, counter, seenIds) {
  if (
    !hasExactKeys(value, ["type", "id", "title", "role", "dateAdded", "children"]) ||
    typeof value.title !== "string" ||
    !(value.role === null || ROLE_VALUES.has(value.role)) ||
    !Array.isArray(value.children)
  ) {
    throw invalidSource();
  }
  if (depth > BOOKMARK_IMPORT_LIMITS.maxFolderDepth) {
    throw sourceTooLarge();
  }
  const id = parseNodeId(value.id, seenIds);
  const dateAdded = parseDateAdded(value.dateAdded);
  const children = value.children.map((child) => parseNode(child, depth + 1, counter, seenIds));
  return { type: BOOKMARK_NODE_TYPES.FOLDER, id, title: value.title, role: value.role, dateAdded, children };
}

// Validates a whole source, including one supplied by Settings on create: the
// preview holds untrusted parsed data that must not reach creation unchecked.
export function parseBookmarkSource(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "name", "root"]) ||
    !SOURCE_KIND_VALUES.has(value.kind) ||
    typeof value.name !== "string" ||
    value.name.length > BOOKMARK_IMPORT_LIMITS.maxSourceNameLength ||
    !isRecord(value.root) ||
    value.root.type !== BOOKMARK_NODE_TYPES.FOLDER
  ) {
    throw invalidSource();
  }
  const counter = { nodes: 0 };
  return {
    kind: value.kind,
    name: value.name,
    root: parseFolder(value.root, 0, counter, new Set())
  };
}

export function bookmarkImportWarning(tabCount) {
  if (tabCount > BOOKMARK_IMPORT_LIMITS.untestedImportTabs) {
    return BOOKMARK_IMPORT_WARNINGS.UNTESTED;
  }
  return tabCount > BOOKMARK_IMPORT_LIMITS.largeImportTabs
    ? BOOKMARK_IMPORT_WARNINGS.LARGE
    : BOOKMARK_IMPORT_WARNINGS.NONE;
}

export function clipBookmarkTabTitle(title, url) {
  const chosen = typeof title === "string" && title.length > 0 ? title : url;
  return chosen.slice(0, BOOKMARK_IMPORT_LIMITS.maxTabTitleLength);
}

export function clipBookmarkGroupTitle(title) {
  return title.slice(0, BOOKMARK_IMPORT_LIMITS.maxGroupTitleLength);
}

function parseCount(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

// An outcome carries counts and the created workspace only: never a URL, a
// bookmark title, or a native Firefox ID.
export function parseBookmarkImportOutcome(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "workspaceId", "workspaceName", "requested", "created", "unsupported", "duplicate", "failed"
    ]) ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length === 0 ||
    typeof value.workspaceName !== "string"
  ) {
    throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  }
  const outcome = {
    workspaceId: value.workspaceId,
    workspaceName: value.workspaceName,
    requested: parseCount(value.requested),
    created: parseCount(value.created),
    unsupported: parseCount(value.unsupported),
    duplicate: parseCount(value.duplicate),
    failed: parseCount(value.failed)
  };
  if (outcome.created + outcome.failed !== outcome.requested) {
    throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  }
  return outcome;
}

export function bookmarkImportSuccess(result) {
  return { ok: true, result };
}

export function bookmarkImportFailure(error) {
  const code = error instanceof BookmarkImportError
    ? error.code
    : BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR;
  return { ok: false, error: { code, message: BOOKMARK_IMPORT_ERROR_MESSAGES[code] } };
}

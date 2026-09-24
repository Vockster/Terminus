import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_IMPORT_WARNINGS,
  BookmarkImportError,
  bookmarkImportFailure,
  bookmarkImportWarning,
  clipBookmarkGroupTitle,
  clipBookmarkTabTitle,
  parseBookmarkImportOutcome,
  parseBookmarkSource
} from "../../src/contracts/bookmark-import.js";

function folder(id, children = [], overrides = {}) {
  return {
    type: "folder",
    id,
    title: id,
    role: null,
    dateAdded: null,
    children,
    ...overrides
  };
}

function bookmark(id, url = `https://${id}.invalid/`, overrides = {}) {
  return { type: "bookmark", id, title: id, url, dateAdded: null, ...overrides };
}

function code(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof BookmarkImportError, "a contract failure must be typed");
    return error.code;
  }
  return null;
}

test("a source keeps folders, separators, duplicates, and unopenable links exactly as read", () => {
  const source = parseBookmarkSource({
    kind: "file",
    name: "export.html",
    root: folder("file:0", [
      bookmark("file:1", "https://one.invalid/"),
      { type: "separator", id: "file:2" },
      bookmark("file:3", "https://one.invalid/"),
      bookmark("file:4", "javascript:void(0)", { title: "" }),
      folder("file:5", [], { role: "toolbar", dateAdded: 1_700_000_000_000 })
    ], { role: "root", title: "Bookmarks" })
  });

  assert.equal(source.root.children.length, 5);
  assert.deepEqual(source.root.children.map(({ type }) => type), [
    "bookmark", "separator", "bookmark", "bookmark", "folder"
  ]);
  assert.equal(source.root.children[0].url, source.root.children[2].url);
  assert.equal(source.root.children[3].title, "");
  assert.equal(source.root.children[4].role, "toolbar");
  assert.equal(source.root.children[4].dateAdded, 1_700_000_000_000);
  assert.deepEqual(Object.keys(source.root.children[1]).sort(), ["id", "type"]);
});

test("a source rejects unknown keys, bad roles, duplicate IDs, and invalid dates", () => {
  const withRoot = (root) => () => parseBookmarkSource({ kind: "file", name: "e", root });
  assert.equal(
    code(withRoot(folder("a", [{ ...bookmark("b"), icon: "data:image/png;base64,AA" }]))),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(withRoot(folder("a", [], { role: "favorites" }))),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(withRoot(folder("a", [bookmark("dup"), bookmark("dup")]))),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(withRoot(folder("a", [bookmark("b", "https://b.invalid/", { dateAdded: -1 })]))),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(withRoot(folder("a", [bookmark("b", 7)]))),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(withRoot(folder("a".repeat(BOOKMARK_IMPORT_LIMITS.maxNodeIdLength + 1)))),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(() => parseBookmarkSource({ kind: "opera", name: "e", root: folder("a") })),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(() => parseBookmarkSource({ kind: "file", name: "e", root: bookmark("a") })),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    code(() => parseBookmarkSource({
      kind: "file",
      name: "n".repeat(BOOKMARK_IMPORT_LIMITS.maxSourceNameLength + 1),
      root: folder("a")
    })),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
});

test("a source refuses more folder depth than the contract allows", () => {
  const nest = (depth) => {
    let node = folder(`file:${depth}`);
    for (let level = depth - 1; level >= 0; level -= 1) {
      node = folder(`file:${level}`, [node]);
    }
    return node;
  };
  assert.ok(parseBookmarkSource({
    kind: "file",
    name: "e",
    root: nest(BOOKMARK_IMPORT_LIMITS.maxFolderDepth)
  }));
  assert.equal(
    code(() => parseBookmarkSource({
      kind: "file",
      name: "e",
      root: nest(BOOKMARK_IMPORT_LIMITS.maxFolderDepth + 1)
    })),
    BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE
  );
});

test("warnings mark the large and untested scales at their exact thresholds", () => {
  assert.equal(bookmarkImportWarning(0), BOOKMARK_IMPORT_WARNINGS.NONE);
  assert.equal(bookmarkImportWarning(500), BOOKMARK_IMPORT_WARNINGS.NONE);
  assert.equal(bookmarkImportWarning(501), BOOKMARK_IMPORT_WARNINGS.LARGE);
  assert.equal(bookmarkImportWarning(2_500), BOOKMARK_IMPORT_WARNINGS.LARGE);
  assert.equal(bookmarkImportWarning(2_501), BOOKMARK_IMPORT_WARNINGS.UNTESTED);
});

test("titles clip to their owners' limits and fall back to the address", () => {
  const long = "t".repeat(BOOKMARK_IMPORT_LIMITS.maxTabTitleLength + 10);
  assert.equal(
    clipBookmarkTabTitle(long, "https://x.invalid/").length,
    BOOKMARK_IMPORT_LIMITS.maxTabTitleLength
  );
  assert.equal(clipBookmarkTabTitle("", "https://x.invalid/"), "https://x.invalid/");
  assert.equal(
    clipBookmarkGroupTitle("g".repeat(400)).length,
    BOOKMARK_IMPORT_LIMITS.maxGroupTitleLength
  );
});

test("an outcome carries counts only and must add up", () => {
  const outcome = parseBookmarkImportOutcome({
    workspaceId: "ws-1",
    workspaceName: "Imported bookmarks",
    requested: 5,
    created: 4,
    unsupported: 2,
    duplicate: 1,
    failed: 1
  });
  assert.deepEqual(Object.keys(outcome).sort(), [
    "created", "duplicate", "failed", "requested", "unsupported", "workspaceId", "workspaceName"
  ]);
  assert.equal(
    code(() => parseBookmarkImportOutcome({
      workspaceId: "ws-1",
      workspaceName: "Imported bookmarks",
      requested: 5,
      created: 4,
      unsupported: 0,
      duplicate: 0,
      failed: 0
    })),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST
  );
  assert.equal(
    code(() => parseBookmarkImportOutcome({
      workspaceId: "ws-1",
      workspaceName: "Imported bookmarks",
      requested: 1,
      created: 1,
      unsupported: 0,
      duplicate: 0,
      failed: 0,
      url: "https://leak.invalid/"
    })),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST
  );
});

test("a failure envelope reduces an unknown error to the internal code and message", () => {
  const failure = bookmarkImportFailure(new Error("raw adapter detail"));
  assert.deepEqual(failure, {
    ok: false,
    error: {
      code: BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR,
      message: "The bookmark import could not be completed."
    }
  });
  assert.equal(
    bookmarkImportFailure(
      new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED)
    ).error.message,
    "Bookmark access is not available. Nothing was imported."
  );
});

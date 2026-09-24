import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_IMPORT_WARNINGS,
  parseBookmarkSource
} from "../../src/contracts/bookmark-import.js";
import {
  bookmarkImportTabDescriptors,
  countImportableBeneath,
  isImportableBookmarkUrl,
  mapBookmarkImport
} from "../../src/core/bookmark-import-mapping.js";

function folder(id, title, children, role = null) {
  return { type: "folder", id, title, role, dateAdded: null, children };
}

function bookmark(id, title, url) {
  return { type: "bookmark", id, title, url, dateAdded: null };
}

function separator(id) {
  return { type: "separator", id };
}

// Work
//  |- Docs
//  |   |- Guide, Old/Legacy
//  |- Loose, separator, Bookmarklet
// Personal
//  |- Recipes/Soup
const SOURCE = parseBookmarkSource({
  kind: "file",
  name: "export.html",
  root: folder("r", "Bookmarks", [
    folder("work", "Work", [
      folder("docs", "Docs", [
        bookmark("guide", "Guide", "https://docs.invalid/guide"),
        folder("old", "Old", [bookmark("legacy", "Legacy", "https://docs.invalid/legacy")])
      ]),
      bookmark("loose", "Loose", "https://work.invalid/loose"),
      separator("sep"),
      bookmark("script", "Bookmarklet", "javascript:void(0)")
    ]),
    folder("personal", "Personal", [
      folder("recipes", "Recipes", [bookmark("soup", "Soup", "https://food.invalid/soup")])
    ])
  ], "root")
});

function shape(mapping) {
  return mapping.entries.map((entry) => entry.kind === "group"
    ? [entry.kind, entry.title, entry.tabs.map(({ title }) => title)]
    : [entry.kind, entry.title]);
}

test("only http and https bookmarks are importable", () => {
  for (const url of ["https://a.invalid/", "http://a.invalid/"]) {
    assert.equal(isImportableBookmarkUrl(url), true, url);
  }
  for (const url of [
    "javascript:void(0)",
    "place:type=6",
    "about:reader?url=x",
    "file:///tmp/notes.html",
    "data:text/html,<p>x</p>",
    "ftp://files.invalid/pub",
    "not a url",
    ""
  ]) {
    assert.equal(isImportableBookmarkUrl(url), false, url);
  }
});

test("a pick inside one folder starts there, so its subfolders become groups", () => {
  const mapping = mapBookmarkImport(SOURCE, ["guide", "legacy", "loose"]);
  assert.equal(mapping.startFolderId, "work");
  assert.deepEqual(shape(mapping), [
    ["group", "Docs", ["Guide", "Legacy"]],
    ["tab", "Loose"]
  ]);
  assert.deepEqual(mapping.counts, { ticked: 3, create: 3, unsupported: 0, duplicate: 0 });
  assert.equal(mapping.warning, BOOKMARK_IMPORT_WARNINGS.NONE);
});

test("a deep folder merges into the group its start folder names", () => {
  const mapping = mapBookmarkImport(SOURCE, ["legacy"]);
  assert.equal(mapping.startFolderId, "old", "a single bookmark starts at its own parent");
  assert.deepEqual(shape(mapping), [["tab", "Legacy"]]);

  const fromDocs = mapBookmarkImport(SOURCE, ["guide", "legacy"]);
  assert.equal(fromDocs.startFolderId, "docs");
  assert.deepEqual(shape(fromDocs), [["tab", "Guide"], ["group", "Old", ["Legacy"]]]);
});

test("a pick spanning two source roots turns those roots into groups", () => {
  const mapping = mapBookmarkImport(SOURCE, ["guide", "soup"]);
  assert.equal(mapping.startFolderId, "r");
  assert.deepEqual(shape(mapping), [
    ["group", "Work", ["Guide"]],
    ["group", "Personal", ["Soup"]]
  ]);
});

test("unticked siblings, separators, and empty groups never reach the mapping", () => {
  const mapping = mapBookmarkImport(SOURCE, ["loose"]);
  assert.equal(mapping.startFolderId, "work");
  assert.deepEqual(shape(mapping), [["tab", "Loose"]]);
  assert.deepEqual(mapBookmarkImport(SOURCE, []).entries, []);
  assert.deepEqual(mapBookmarkImport(SOURCE, []).counts, {
    ticked: 0, create: 0, unsupported: 0, duplicate: 0
  });
});

test("an unopenable bookmark is counted as skipped rather than created", () => {
  const mapping = mapBookmarkImport(SOURCE, ["loose", "script"]);
  assert.deepEqual(shape(mapping), [["tab", "Loose"]]);
  assert.deepEqual(mapping.counts, { ticked: 2, create: 1, unsupported: 1, duplicate: 0 });
});

test("a duplicate address keeps its first walk position", () => {
  const source = parseBookmarkSource({
    kind: "file",
    name: "export.html",
    root: folder("r", "Bookmarks", [
      folder("a", "A", [bookmark("a1", "First", "https://same.invalid/page")]),
      bookmark("loose", "Loose", "https://same.invalid/page"),
      folder("b", "B", [
        bookmark("b1", "Third", "https://same.invalid/page"),
        bookmark("b2", "Fragment", "https://same.invalid/page#notes")
      ])
    ], "root")
  });
  const mapping = mapBookmarkImport(source, ["a1", "loose", "b1", "b2"]);
  assert.deepEqual(shape(mapping), [
    ["group", "A", ["First"]],
    ["group", "B", ["Fragment"]]
  ], "a fragment is part of the address, so it is a different page");
  assert.deepEqual(mapping.counts, { ticked: 4, create: 2, unsupported: 0, duplicate: 2 });
});

test("a title-less bookmark opens under its address and long titles clip", () => {
  const longTitle = "t".repeat(BOOKMARK_IMPORT_LIMITS.maxTabTitleLength + 50);
  const longFolder = "f".repeat(BOOKMARK_IMPORT_LIMITS.maxGroupTitleLength + 50);
  const source = parseBookmarkSource({
    kind: "file",
    name: "export.html",
    root: folder("r", "Bookmarks", [
      folder("g", longFolder, [
        bookmark("empty", "", "https://empty.invalid/page"),
        bookmark("long", longTitle, "https://long.invalid/page")
      ]),
      bookmark("outside", "Outside", "https://outside.invalid/page")
    ], "root")
  });
  const [group, loose] = mapBookmarkImport(source, ["empty", "long", "outside"]).entries;
  assert.equal(group.title.length, BOOKMARK_IMPORT_LIMITS.maxGroupTitleLength);
  assert.equal(group.tabs[0].title, "https://empty.invalid/page");
  assert.equal(group.tabs[1].title.length, BOOKMARK_IMPORT_LIMITS.maxTabTitleLength);
  assert.equal(loose.title, "Outside");
});

test("warning thresholds follow the created count, not the ticked count", () => {
  const build = (count) => parseBookmarkSource({
    kind: "file",
    name: "export.html",
    root: folder("r", "Bookmarks", Array.from({ length: count }, (_, index) =>
      bookmark(`b${index}`, `B${index}`, `https://host.invalid/${index}`)), "root")
  });
  const warningFor = (count) => {
    const source = build(count);
    const ids = source.root.children.map(({ id }) => id);
    return mapBookmarkImport(source, ids).warning;
  };
  assert.equal(warningFor(500), BOOKMARK_IMPORT_WARNINGS.NONE);
  assert.equal(warningFor(501), BOOKMARK_IMPORT_WARNINGS.LARGE);
  assert.equal(warningFor(2_500), BOOKMARK_IMPORT_WARNINGS.LARGE);
  assert.equal(warningFor(2_501), BOOKMARK_IMPORT_WARNINGS.UNTESTED);
});

test("the same tree maps identically whichever source read it", () => {
  const tree = (prefix) => folder(`${prefix}:r`, "Bookmarks", [
    folder(`${prefix}:g`, "Docs", [
      bookmark(`${prefix}:1`, "Guide", "https://docs.invalid/guide"),
      bookmark(`${prefix}:2`, "Skip", "place:type=6")
    ]),
    bookmark(`${prefix}:3`, "Loose", "https://work.invalid/loose")
  ], "root");
  const fromFile = parseBookmarkSource({ kind: "file", name: "e.html", root: tree("file") });
  const fromFirefox = parseBookmarkSource({
    kind: "firefox",
    name: "Firefox bookmarks",
    root: tree("firefox")
  });
  const fileMapping = mapBookmarkImport(fromFile, ["file:1", "file:2", "file:3"]);
  const firefoxMapping = mapBookmarkImport(fromFirefox, ["firefox:1", "firefox:2", "firefox:3"]);
  assert.deepEqual(fileMapping.entries, firefoxMapping.entries);
  assert.deepEqual(fileMapping.counts, firefoxMapping.counts);
});

test("a ticked ID must name a bookmark that exists in the source", () => {
  const codeOf = (ids) => {
    try {
      mapBookmarkImport(SOURCE, ids);
    } catch (error) {
      return error.code;
    }
    return null;
  };
  assert.equal(codeOf(["missing"]), BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  assert.equal(codeOf(["docs"]), BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  assert.equal(codeOf(["sep"]), BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  assert.equal(codeOf([7]), BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  assert.equal(codeOf("guide"), BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
});

test("preview counts and creation descriptors agree with the mapping", () => {
  assert.equal(countImportableBeneath(SOURCE.root), 4);
  const [work] = SOURCE.root.children;
  assert.equal(countImportableBeneath(work), 3, "the bookmarklet is never counted");
  const mapping = mapBookmarkImport(SOURCE, ["guide", "legacy", "loose", "script"]);
  assert.deepEqual(bookmarkImportTabDescriptors(mapping), [
    { url: "https://docs.invalid/guide", title: "Guide", entryIndex: 0 },
    { url: "https://docs.invalid/legacy", title: "Legacy", entryIndex: 0 },
    { url: "https://work.invalid/loose", title: "Loose", entryIndex: 1 }
  ]);
});

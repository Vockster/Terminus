import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS
} from "../../src/contracts/bookmark-import.js";
import { decodeBookmarkText, parseBookmarkFile } from "../../src/core/bookmark-html-parser.js";

const DOCTYPE = "<!DOCTYPE NETSCAPE-Bookmark-file-1>";

function fixture(name) {
  return readFile(new URL(`../fixtures/bookmarks/${name}.html`, import.meta.url), "utf8");
}

function outline(node, depth = 0) {
  const pad = "  ".repeat(depth);
  if (node.type === "folder") {
    return [
      `${pad}folder ${JSON.stringify(node.title)} role=${node.role}`,
      ...node.children.flatMap((child) => outline(child, depth + 1))
    ];
  }
  return node.type === "separator"
    ? [`${pad}separator`]
    : [`${pad}bookmark ${JSON.stringify(node.title)} ${node.url}`];
}

function failureCode(operation) {
  try {
    operation();
  } catch (error) {
    return error.code;
  }
  return null;
}

test("a Chromium export keeps its toolbar folder, nesting, separator, and duplicate", async () => {
  const source = parseBookmarkFile("chrome-export.html", await fixture("chrome-export"));
  assert.equal(source.kind, "file");
  assert.equal(source.name, "chrome-export.html");
  assert.deepEqual(outline(source.root), [
    'folder "Bookmarks" role=root',
    '  folder "Bookmarks bar" role=toolbar',
    '    bookmark "Dashboard & Reports" https://work.invalid/dashboard',
    '    folder "Docs" role=null',
    '      bookmark "Guide" https://docs.invalid/guide',
    '      folder "Old" role=null',
    '        bookmark "Legacy notes" https://docs.invalid/legacy',
    "    separator",
    '    bookmark "Bookmarklet" javascript:void(0)',
    '    folder "Empty" role=null',
    '  bookmark "Dashboard copy" https://work.invalid/dashboard'
  ]);
  const [toolbar] = source.root.children;
  assert.equal(toolbar.dateAdded, 1_700_000_000_000);
  assert.deepEqual(toolbar.children.at(-1).children, [], "an H3 with no list is an empty folder");
});

test("a Firefox export ignores icons, tags, and descriptions and keeps unfiled and place: entries", async () => {
  const source = parseBookmarkFile("firefox-export.html", await fixture("firefox-export"));
  assert.deepEqual(outline(source.root), [
    'folder "Bookmarks Menu" role=root',
    '  bookmark "Café & Cie" https://news.invalid/daily',
    '  folder "Bookmarks Toolbar" role=toolbar',
    '    bookmark "Mail &bogus; Archive" https://mail.invalid/inbox',
    '    bookmark "Calendar" https://calendar.invalid/today',
    "    separator",
    '    bookmark "Mail again" https://mail.invalid/inbox',
    '  folder "Other Bookmarks" role=unfiled',
    '    bookmark "Recent Tags" place:type=6&sort=14&maxResults=10',
    '    bookmark "Paper <draft>" https://research.invalid/paper?q=1&r=2',
    '    bookmark "" https://research.invalid/untitled'
  ]);
  const [firstBookmark, toolbar] = source.root.children;
  assert.equal(firstBookmark.dateAdded, 1_700_001_000_000);
  assert.equal(toolbar.children[0].dateAdded, 1_700_001_300_000, "an unquoted ADD_DATE is read");
  assert.equal(toolbar.children[1].dateAdded, null, "a non-numeric ADD_DATE is unknown");
  assert.equal(
    toolbar.children[1].url,
    "https://calendar.invalid/today",
    "a single-quoted HREF is read"
  );
  for (const node of [firstBookmark, ...toolbar.children]) {
    assert.deepEqual(
      Object.keys(node).sort(),
      node.type === "separator" ? ["id", "type"] : ["dateAdded", "id", "title", "type", "url"]
    );
  }
});

test("a Safari export nests a folder opened before the first list and closes unclosed lists", async () => {
  const source = parseBookmarkFile("safari-export.html", await fixture("safari-export"));
  assert.deepEqual(outline(source.root), [
    'folder "Bookmarks" role=root',
    '  folder "Favorites" role=null',
    '    bookmark "Store" https://store.invalid/',
    '    folder "Reading list" role=null',
    '      bookmark "One" https://reading.invalid/one',
    '      bookmark "Local notes" file:///Users/example/notes.html'
  ]);
});

test("node IDs are unique, source-scoped, and follow document order", async () => {
  const source = parseBookmarkFile("chrome-export.html", await fixture("chrome-export"));
  const ids = [];
  const visit = (node) => {
    ids.push(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  visit(source.root);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ids.map((_, index) => `file:${index}`));
});

test("uppercase, lowercase, and unknown tags parse the same way", () => {
  const upper = parseBookmarkFile("e.html", `${DOCTYPE}<H1>B</H1><DL><P><DT><A HREF="https://a.invalid/">A</A></DL>`);
  const lower = parseBookmarkFile("e.html", `${DOCTYPE}<h1>B</h1><dl><p><dt><a href="https://a.invalid/">A</a></dl>`);
  const noisy = parseBookmarkFile("e.html", `${DOCTYPE}<meta charset="utf-8"><h1>B</h1><dl><p><dt><a href="https://a.invalid/">A</a><dd>note<span>x</span></dl>`);
  assert.deepEqual(outline(upper.root), outline(lower.root));
  assert.deepEqual(outline(noisy.root), outline(lower.root));
});

test("character references decode, and an unknown or malformed one stays literal", () => {
  assert.equal(
    decodeBookmarkText("&amp;&lt;&gt;&quot;&apos;&#39;&#x41;&#66;&nbsp;"),
    `&<>"''AB `
  );
  assert.equal(decodeBookmarkText("&eacute; &#xZZ; &# 39; &amp"), "&eacute; &#xZZ; &# 39; &amp");
  assert.equal(decodeBookmarkText("&#xD800;&#1114112;"), "&#xD800;&#1114112;");
});

test("a comment never leaks into a title and an attribute may hold a bracket", () => {
  const source = parseBookmarkFile("e.html", [
    DOCTYPE,
    "<H1>Root</H1>",
    "<DL><P>",
    "<!-- <DT><A HREF=\"https://ignored.invalid/\">Ignored</A> -->",
    "<DT><A HREF=\"https://a.invalid/?q=a%3Eb\" TAGS=\"x>y\">Real</A>",
    "</DL>"
  ].join("\n"));
  assert.deepEqual(outline(source.root), [
    'folder "Root" role=root',
    '  bookmark "Real" https://a.invalid/?q=a%3Eb'
  ]);
});

test("a document without the doctype or without any list is not a bookmarks file", () => {
  assert.equal(
    failureCode(() => parseBookmarkFile("e.html", "<html><body>hello</body></html>")),
    BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE
  );
  assert.equal(
    failureCode(() => parseBookmarkFile("e.html", `${DOCTYPE}<H1>Bookmarks</H1>`)),
    BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE
  );
  assert.equal(
    failureCode(() => parseBookmarkFile("e.html", '{"schemaVersion":3}')),
    BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE
  );
  assert.equal(failureCode(() => parseBookmarkFile("e.html", 42)), BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE);
  assert.ok(parseBookmarkFile("e.html", `﻿\n  ${DOCTYPE.toLowerCase()}\n<DL><P></DL>`));
});

test("oversized depth and node counts stop the scan instead of building the tree", () => {
  const nested = (depth) => [
    DOCTYPE,
    "<H1>Root</H1>",
    "<DL><P>",
    ...Array.from({ length: depth }, (_, level) => `<DT><H3>F${level}</H3><DL><P>`),
    ...Array.from({ length: depth }, () => "</DL>"),
    "</DL>"
  ].join("");
  assert.ok(parseBookmarkFile("e.html", nested(BOOKMARK_IMPORT_LIMITS.maxFolderDepth)));
  assert.equal(
    failureCode(() => parseBookmarkFile("e.html", nested(BOOKMARK_IMPORT_LIMITS.maxFolderDepth + 1))),
    BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE
  );

  const separators = (count) =>
    `${DOCTYPE}<H1>Root</H1><DL><P>${"<DT><HR>".repeat(count)}</DL>`;
  assert.equal(
    parseBookmarkFile("e.html", separators(BOOKMARK_IMPORT_LIMITS.maxNodes - 1)).root.children.length,
    BOOKMARK_IMPORT_LIMITS.maxNodes - 1
  );
  assert.equal(
    failureCode(() => parseBookmarkFile("e.html", separators(BOOKMARK_IMPORT_LIMITS.maxNodes))),
    BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE
  );
});

test("the source name is clipped and committed fixtures stay synthetic", async () => {
  const source = parseBookmarkFile(
    `${"n".repeat(BOOKMARK_IMPORT_LIMITS.maxSourceNameLength + 40)}.html`,
    `${DOCTYPE}<DL><P></DL>`
  );
  assert.equal(source.name.length, BOOKMARK_IMPORT_LIMITS.maxSourceNameLength);
  for (const name of ["chrome-export", "firefox-export", "safari-export"]) {
    const text = await fixture(name);
    for (const [url] of text.matchAll(/https?:\/\/[^"']+/g)) {
      assert.match(url, /\.invalid(?:[/?#]|$)/, `${name} must use synthetic hosts`);
    }
  }
});

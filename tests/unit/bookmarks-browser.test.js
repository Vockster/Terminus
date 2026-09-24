import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import { BOOKMARK_IMPORT_ERROR_CODES } from "../../src/contracts/bookmark-import.js";
import {
  BOOKMARK_OPTIONAL_PERMISSIONS,
  convertFirefoxBookmarkTree,
  createFirefoxBookmarksBrowser
} from "../../src/platform/firefox/bookmarks-browser.js";

const FIREFOX_TREE = {
  id: "root________",
  title: "",
  type: "folder",
  children: [
    {
      id: "menu________",
      title: "Bookmarks Menu",
      index: 0,
      type: "folder",
      dateAdded: 1_700_000_000_000,
      children: [
        { id: "b2", title: "Second", url: "https://two.invalid/", index: 1 },
        { id: "b1", title: "First", url: "https://one.invalid/", index: 0 },
        { id: "s1", type: "separator", index: 2 },
        {
          id: "f1",
          title: "Nested",
          index: 3,
          children: [{ id: "b3", title: "Third", url: "https://three.invalid/", index: 0 }]
        }
      ]
    },
    { id: "toolbar_____", title: "Bookmarks Toolbar", index: 1, children: [] },
    { id: "unfiled_____", title: "Other Bookmarks", index: 2, children: [] },
    { id: "mobile______", title: "Mobile Bookmarks", index: 3, children: [] }
  ]
};

function createBrowserApi({ granted = true, tree = [FIREFOX_TREE], getTree = null } = {}) {
  const calls = [];
  return {
    calls,
    permissions: {
      async contains(request) {
        calls.push(["contains", request]);
        return granted;
      }
    },
    bookmarks: {
      async getTree() {
        calls.push(["getTree"]);
        if (getTree) return getTree();
        return tree;
      }
    }
  };
}

test("the Firefox tree converts with roles, index order, inferred types, and dates", async () => {
  const browserApi = createBrowserApi();
  const source = await createFirefoxBookmarksBrowser(browserApi).readTree();

  assert.equal(source.kind, "firefox");
  assert.equal(source.name, "Firefox bookmarks");
  assert.deepEqual(browserApi.calls, [
    ["contains", { permissions: BOOKMARK_OPTIONAL_PERMISSIONS }],
    ["getTree"]
  ]);
  assert.deepEqual(
    source.root.children.map(({ id, role }) => [id, role]),
    [
      ["firefox:menu________", "menu"],
      ["firefox:toolbar_____", "toolbar"],
      ["firefox:unfiled_____", "unfiled"],
      ["firefox:mobile______", "mobile"]
    ]
  );
  assert.equal(source.root.role, "root");
  const [menu] = source.root.children;
  assert.equal(menu.dateAdded, 1_700_000_000_000);
  assert.deepEqual(menu.children.map(({ id, type }) => [id, type]), [
    ["firefox:b1", "bookmark"],
    ["firefox:b2", "bookmark"],
    ["firefox:s1", "separator"],
    ["firefox:f1", "folder"]
  ]);
  assert.equal(menu.children[3].children[0].url, "https://three.invalid/");
  assert.deepEqual(Object.keys(menu.children[2]).sort(), ["id", "type"]);
});

test("a node without a type is a bookmark when it has a URL and a folder otherwise", () => {
  const root = convertFirefoxBookmarkTree({
    id: "root________",
    title: "",
    children: [
      { id: "a", title: "Has URL", url: "https://a.invalid/" },
      { id: "b", title: "No URL", children: [] },
      { id: "c", title: "Empty leaf" }
    ]
  });
  assert.deepEqual(root.children.map(({ type }) => type), ["bookmark", "folder", "folder"]);
  assert.deepEqual(root.children[2].children, []);
});

test("children keep array order when Firefox omits an index", () => {
  const root = convertFirefoxBookmarkTree({
    id: "root________",
    title: "",
    children: [
      { id: "z", title: "Z", url: "https://z.invalid/" },
      { id: "a", title: "A", url: "https://a.invalid/", index: 0 }
    ]
  });
  assert.deepEqual(root.children.map(({ id }) => id), ["firefox:z", "firefox:a"]);
});

test("a missing permission, missing API, or failed read reports that access is unavailable", async () => {
  const codeOf = async (browserApi) => {
    try {
      await createFirefoxBookmarksBrowser(browserApi).readTree();
    } catch (error) {
      return error.code;
    }
    return null;
  };
  assert.equal(
    await codeOf(createBrowserApi({ granted: false })),
    BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED
  );
  assert.equal(
    await codeOf({ permissions: { async contains() { return true; } }, bookmarks: {} }),
    BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED
  );
  assert.equal(
    await codeOf({
      permissions: { async contains() { throw new Error("revoked"); } },
      bookmarks: { async getTree() { return [FIREFOX_TREE]; } }
    }),
    BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED
  );
  assert.equal(
    await codeOf(createBrowserApi({ getTree: () => { throw new Error("no access"); } })),
    BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED
  );
  assert.equal(
    await codeOf(createBrowserApi({ tree: [] })),
    BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED
  );
});

test("no product source calls a mutating bookmarks method", async () => {
  const sourceFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) files.push(...await sourceFiles(url));
      else if (entry.name.endsWith(".js")) files.push(url);
    }
    return files;
  };
  const files = await sourceFiles(new URL("../../src/", import.meta.url));
  assert.ok(files.length > 0);
  let readOnlyCalls = 0;
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(
      content,
      /bookmarks\s*(?:\?\.)?\.?\s*(?:create|update|move|remove|removeTree)\b/,
      `${file.pathname} must not mutate bookmarks`
    );
    readOnlyCalls += [...content.matchAll(/bookmarks\.getTree\b/g)].length;
  }
  assert.equal(readOnlyCalls, 1, "only the bookmarks adapter reads the tree");
});

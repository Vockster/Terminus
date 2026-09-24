import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS
} from "../../src/contracts/bookmark-import.js";
import { BookmarkImportService } from "../../src/core/bookmark-import-service.js";

const DOCTYPE = "<!DOCTYPE NETSCAPE-Bookmark-file-1>";
const EXPORT = [
  DOCTYPE,
  "<H1>Bookmarks</H1>",
  "<DL><P>",
  '<DT><H3>Docs</H3>',
  "<DL><P>",
  '<DT><A HREF="https://docs.invalid/guide">Guide</A>',
  '<DT><A HREF="place:type=6">Recent</A>',
  "</DL><P>",
  '<DT><A HREF="https://work.invalid/loose">Loose</A>',
  "</DL>"
].join("\n");

const FIREFOX_TREE = {
  kind: "firefox",
  name: "Firefox bookmarks",
  root: {
    type: "folder",
    id: "firefox:root________",
    title: "",
    role: "root",
    dateAdded: null,
    children: [
      {
        type: "bookmark",
        id: "firefox:b1",
        title: "One",
        url: "https://one.invalid/",
        dateAdded: null
      }
    ]
  }
};

function createService({
  settings = { snapshots: { restoreBatchSize: 4 } },
  readTree = async () => FIREFOX_TREE,
  importBookmarkWorkspace = null,
  onProgress = null
} = {}) {
  const calls = [];
  const service = new BookmarkImportService({
    bookmarksBrowser: { readTree },
    workspaceController: {
      async importBookmarkWorkspace(windowId, mapping, batchSize, progress) {
        calls.push({ windowId, mapping, batchSize });
        if (importBookmarkWorkspace) return importBookmarkWorkspace(progress);
        progress?.({ created: mapping.counts.create, total: mapping.counts.create });
        return {
          workspaceId: "ws-imported",
          workspaceName: "Imported bookmarks",
          requested: mapping.counts.create,
          created: mapping.counts.create,
          unsupported: mapping.counts.unsupported,
          duplicate: mapping.counts.duplicate,
          failed: 0
        };
      }
    },
    settingsService: {
      async getOrInitialize() {
        if (settings instanceof Error) throw settings;
        return settings;
      }
    },
    onProgress,
    createUuid: () => "fixed-uuid"
  });
  return { service, calls };
}

async function codeOf(operation) {
  try {
    await operation();
  } catch (error) {
    return error.code;
  }
  return null;
}

test("reading Firefox bookmarks validates what the adapter returned", async () => {
  const { service } = createService();
  const source = await service.readFirefox();
  assert.equal(source.kind, "firefox");
  assert.equal(source.root.children[0].url, "https://one.invalid/");

  const tampered = createService({
    readTree: async () => ({ ...FIREFOX_TREE, root: { ...FIREFOX_TREE.root, role: "favorites" } })
  });
  assert.equal(
    await codeOf(() => tampered.service.readFirefox()),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
});

test("reading a file parses it, clips its name, and refuses an oversized text", async () => {
  const { service } = createService();
  const source = await service.readFile("export.html", EXPORT);
  assert.equal(source.kind, "file");
  assert.equal(source.name, "export.html");
  assert.deepEqual(source.root.children.map(({ type }) => type), ["folder", "bookmark"]);

  const long = await service.readFile(`${"n".repeat(400)}.html`, EXPORT);
  assert.equal(long.name.length, BOOKMARK_IMPORT_LIMITS.maxSourceNameLength);

  assert.equal(
    await codeOf(() => service.readFile("big.html", "x".repeat(BOOKMARK_IMPORT_LIMITS.maxFileUnits + 1))),
    BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE
  );
  assert.equal(
    await codeOf(() => service.readFile("notes.txt", "plain text")),
    BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE
  );
  assert.equal(
    await codeOf(() => service.readFile(7, EXPORT)),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST
  );
});

test("creating revalidates the source Settings sent back before anything is created", async () => {
  const { service, calls } = createService();
  const source = await service.readFile("export.html", EXPORT);
  assert.equal(
    await codeOf(() => service.create(7, { ...source, kind: "opera" }, ["file:4"])),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_SOURCE
  );
  assert.equal(
    await codeOf(() => service.create(7, source, ["file:99"])),
    BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(calls, []);
});

test("creating maps the pick, applies the restore batch size, and reports progress", async () => {
  const progress = [];
  const { service, calls } = createService({ onProgress: (update) => progress.push(update) });
  const source = await service.readFile("export.html", EXPORT);
  const guide = source.root.children[0].children[0].id;
  const loose = source.root.children[1].id;

  const outcome = await service.create(7, source, [guide, loose]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].windowId, 7);
  assert.equal(calls[0].batchSize, 4);
  assert.deepEqual(calls[0].mapping.entries.map(({ kind }) => kind), ["group", "tab"]);
  assert.equal(outcome.workspaceName, "Imported bookmarks");
  assert.deepEqual(progress, [
    { importId: "bookmark-import-fixed-uuid", created: 2, total: 2 }
  ]);
});

test("a pick with nothing openable never reaches the controller", async () => {
  const { service, calls } = createService();
  const source = await service.readFile("export.html", EXPORT);
  const unsupported = source.root.children[0].children[1].id;
  assert.equal(
    await codeOf(() => service.create(7, source, [unsupported])),
    BOOKMARK_IMPORT_ERROR_CODES.NOTHING_TO_IMPORT
  );
  assert.equal(
    await codeOf(() => service.create(7, source, [])),
    BOOKMARK_IMPORT_ERROR_CODES.NOTHING_TO_IMPORT
  );
  assert.deepEqual(calls, []);
});

test("an unreadable settings document falls back to the default batch size", async () => {
  const { service, calls } = createService({ settings: new Error("storage unavailable") });
  const source = await service.readFile("export.html", EXPORT);
  await service.create(7, source, [source.root.children[1].id]);
  assert.equal(calls[0].batchSize, 10);
});

test("a controller failure reaches the caller unchanged", async () => {
  const { service } = createService({
    importBookmarkWorkspace: () => {
      const error = new Error("nope");
      error.code = BOOKMARK_IMPORT_ERROR_CODES.WORKSPACE_LIMIT;
      throw error;
    }
  });
  const source = await service.readFile("export.html", EXPORT);
  assert.equal(
    await codeOf(() => service.create(7, source, [source.root.children[1].id])),
    BOOKMARK_IMPORT_ERROR_CODES.WORKSPACE_LIMIT
  );
});

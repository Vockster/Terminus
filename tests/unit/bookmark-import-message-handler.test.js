import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_ERROR_MESSAGES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_IMPORT_MESSAGE_TYPES,
  BookmarkImportError
} from "../../src/contracts/bookmark-import.js";
import {
  createBookmarkImportMessageHandler
} from "../../src/background/bookmark-import-message-handler.js";

const SOURCE = { kind: "file", name: "export.html", root: { type: "folder", children: [] } };
const OUTCOME = {
  workspaceId: "ws-imported",
  workspaceName: "Imported bookmarks",
  requested: 1,
  created: 1,
  unsupported: 0,
  duplicate: 0,
  failed: 0
};
const SENDER = { tab: { windowId: 7, incognito: false } };

function createHandler({ createResult = OUTCOME } = {}) {
  const calls = [];
  const imported = [];
  const service = {
    async readFirefox() {
      calls.push(["readFirefox"]);
      return SOURCE;
    },
    async readFile(name, text) {
      calls.push(["readFile", name, text.length]);
      return SOURCE;
    },
    async create(windowId, source, ticked) {
      calls.push(["create", windowId, source, ticked]);
      if (createResult instanceof Error) throw createResult;
      return createResult;
    }
  };
  return {
    calls,
    imported,
    handle: createBookmarkImportMessageHandler({
      service,
      onImported: (windowId) => imported.push(windowId)
    })
  };
}

test("messages the bookmark handler does not own are left for other handlers", () => {
  const { handle } = createHandler();
  for (const message of [null, "text", { type: "snapshots.overview" }, {}]) {
    assert.equal(handle(message, SENDER), undefined);
  }
});

test("a read from Settings returns the parsed source", async () => {
  const { handle, calls } = createHandler();
  assert.deepEqual(
    await handle({ type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FIREFOX }, SENDER),
    { ok: true, result: SOURCE }
  );
  assert.deepEqual(
    await handle(
      { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE, name: "export.html", text: "<DL>" },
      SENDER
    ),
    { ok: true, result: SOURCE }
  );
  assert.deepEqual(calls, [["readFirefox"], ["readFile", "export.html", 4]]);
});

test("every request is checked for exact keys and types", async () => {
  const { handle, calls } = createHandler();
  const invalid = {
    ok: false,
    error: {
      code: BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST,
      message: BOOKMARK_IMPORT_ERROR_MESSAGES[BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST]
    }
  };
  for (const message of [
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FIREFOX, extra: 1 },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE, name: "e.html" },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE, name: 7, text: "<DL>" },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE, name: "e.html", text: "<DL>", extra: 1 },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: "x", tickedBookmarkIds: [] },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE, tickedBookmarkIds: "a" },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.PROGRESS, importId: "x", created: 1, total: 2 }
  ]) {
    assert.deepEqual(await handle(message, SENDER), invalid, JSON.stringify(message));
  }
  assert.deepEqual(calls, []);
});

test("a create without a sender tab window is invalid and never reaches the service", async () => {
  const { handle, calls, imported } = createHandler();
  for (const sender of [undefined, {}, { tab: {} }, { tab: { windowId: "7" } }]) {
    const response = await handle(
      { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE, tickedBookmarkIds: ["a"] },
      sender
    );
    assert.equal(response.error.code, BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(imported, []);
});

test("a create from a normal window imports and then refreshes that window's sidebar", async () => {
  const { handle, calls, imported } = createHandler();
  assert.deepEqual(
    await handle(
      { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE, tickedBookmarkIds: ["a"] },
      SENDER
    ),
    { ok: true, result: OUTCOME }
  );
  assert.deepEqual(calls, [["create", 7, SOURCE, ["a"]]]);
  assert.deepEqual(imported, [7]);
});

test("a private Settings tab is refused before any bookmark is read", async () => {
  const { handle, calls } = createHandler();
  const privateSender = { tab: { windowId: 9, incognito: true } };
  for (const message of [
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FIREFOX },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE, name: "e.html", text: "<DL>" },
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE, tickedBookmarkIds: ["a"] }
  ]) {
    assert.deepEqual(await handle(message, privateSender), {
      ok: false,
      error: {
        code: BOOKMARK_IMPORT_ERROR_CODES.PRIVATE_WINDOW,
        message: "Bookmark import is available in normal windows."
      }
    });
  }
  assert.deepEqual(calls, []);
});

test("an oversized file is refused at the boundary as well as in the page", async () => {
  const { handle, calls } = createHandler();
  const response = await handle({
    type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE,
    name: "big.html",
    text: "x".repeat(BOOKMARK_IMPORT_LIMITS.maxFileUnits + 1)
  }, SENDER);
  assert.deepEqual(response, {
    ok: false,
    error: {
      code: BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE,
      message: "That file is too large to import (limit 64 MiB)."
    }
  });
  assert.deepEqual(calls, []);
});

test("a typed service failure keeps its code and an unknown one becomes an internal error", async () => {
  const typed = createHandler({
    createResult: new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.WORKSPACE_LIMIT)
  });
  assert.deepEqual(
    await typed.handle(
      { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE, tickedBookmarkIds: ["a"] },
      SENDER
    ),
    {
      ok: false,
      error: {
        code: BOOKMARK_IMPORT_ERROR_CODES.WORKSPACE_LIMIT,
        message: "Terminus already has the maximum of 100 workspaces."
      }
    }
  );
  assert.deepEqual(typed.imported, [], "a refused import never refreshes a sidebar");

  const raw = createHandler({ createResult: new Error("Firefox said: https://private.invalid/") });
  const response = await raw.handle(
    { type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE, source: SOURCE, tickedBookmarkIds: ["a"] },
    SENDER
  );
  assert.deepEqual(response, {
    ok: false,
    error: {
      code: BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR,
      message: "The bookmark import could not be completed."
    }
  });
  assert.doesNotMatch(JSON.stringify(response), /private\.invalid/);
});

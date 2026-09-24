import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVICON_GALLERY_PAGE_SIZE,
  FAVICON_MESSAGE_TYPES
} from "../../src/contracts/favicon-messages.js";
import { WORKSPACE_SCOPES } from "../../src/contracts/workspace-scope.js";
import { createFaviconMessageHandler } from "../../src/background/favicon-message-handler.js";

test("favicon messages delegate exact actions and private lookup returns no data", async () => {
  const calls = [];
  const handler = createFaviconMessageHandler({
    service: {
      async getForTabs(windowId, tabs) {
        calls.push(["lookup", windowId, tabs]);
        return { icons: [{
          logicalId: "tab-one",
          firefoxTabId: 11,
          mime: "image/png",
          bytes: Uint8Array.of(1),
          substitute: false,
          pageUrl: "https://secret.invalid/private/path",
          candidateUrl: "https://secret.invalid/icon.png",
          origin: "https://secret.invalid",
          sourceDigest: "a".repeat(64)
        }] };
      },
      async overview() { calls.push(["overview"]); return { favicon: {} }; },
      async listCachedIcons(cursor, pageSize) {
        calls.push(["list", cursor, pageSize]);
        return {
          icons: [{
            origin: "https://example.invalid",
            mime: "image/png",
            bytes: Uint8Array.of(1),
            byteCount: 1,
            updatedAt: 2,
            partition: "secret-partition",
            sourceDigest: "a".repeat(64),
            candidateUrl: "https://secret.invalid/icon.png"
          }],
          nextCursor: { revision: 3, offset: 64 }
        };
      },
      async clearAll() { calls.push(["clear"]); return { removedCount: 1 }; },
      async clearOne(origin) { calls.push(["one", origin]); return { removedCount: 1 }; },
      async confirmHostAccess(origin) { calls.push(["access", origin]); return { clearedCount: 1 }; },
      async removeUnused() { calls.push(["unused"]); return { removedCount: 1 }; }
    },
    resolveWindowScope: async (windowId) => windowId === 8 ? WORKSPACE_SCOPES.PRIVATE : WORKSPACE_SCOPES.NORMAL
  });
  const request = (windowId) => ({
    type: FAVICON_MESSAGE_TYPES.LOOKUP,
    windowId,
    tabs: [{ logicalId: "tab-one", firefoxTabId: 11 }]
  });
  const lookup = await handler(request(7));
  assert.deepEqual(
    Object.keys(lookup.result.icons[0]).sort(),
    ["bytes", "firefoxTabId", "logicalId", "mime", "substitute"].sort()
  );
  assert.equal(lookup.result.icons[0].substitute, false);
  assert.doesNotMatch(JSON.stringify(lookup), /secret|pageUrl|candidateUrl|origin|sourceDigest/);
  assert.deepEqual((await handler(request(8))).result, { icons: [], pending: [] });
  assert.equal(calls.filter(([kind]) => kind === "lookup").length, 1);
  const gallery = await handler({ type: FAVICON_MESSAGE_TYPES.LIST, cursor: null });
  assert.deepEqual(calls.find(([kind]) => kind === "list"), ["list", null, FAVICON_GALLERY_PAGE_SIZE]);
  assert.deepEqual(Object.keys(gallery.result.icons[0]).sort(), [
    "byteCount", "bytes", "mime", "origin", "updatedAt"
  ]);
  assert.doesNotMatch(JSON.stringify(gallery), /secret|partition|sourceDigest|candidateUrl/);
  assert.deepEqual(gallery.result.nextCursor, { revision: 3, offset: 64 });
  assert.equal((await handler({ type: FAVICON_MESSAGE_TYPES.CLEAR_ALL })).result.removedCount, 1);
  assert.equal((await handler({ type: FAVICON_MESSAGE_TYPES.REMOVE_UNUSED })).result.removedCount, 1);
  assert.equal((await handler({
    type: FAVICON_MESSAGE_TYPES.ACCESS_GRANTED,
    origin: "https://cdn.example.invalid"
  })).result.clearedCount, 1);
  assert.deepEqual(calls.at(-1), ["access", "https://cdn.example.invalid"]);
  assert.equal(handler({ type: "unrelated" }), undefined);
});

test("private Settings cannot read or mutate the normal website-icon cache", async () => {
  let calls = 0;
  const service = new Proxy({}, {
    get() {
      return async () => { calls += 1; return {}; };
    }
  });
  const handler = createFaviconMessageHandler({
    service,
    resolveWindowScope: async () => WORKSPACE_SCOPES.PRIVATE
  });
  const sender = { tab: { incognito: true } };
  const requests = [
    { type: FAVICON_MESSAGE_TYPES.OVERVIEW },
    { type: FAVICON_MESSAGE_TYPES.LIST, cursor: null },
    { type: FAVICON_MESSAGE_TYPES.CLEAR_ALL },
    { type: FAVICON_MESSAGE_TYPES.CLEAR_ONE, origin: "https://example.invalid" },
    { type: FAVICON_MESSAGE_TYPES.REMOVE_UNUSED },
    { type: FAVICON_MESSAGE_TYPES.ACCESS_GRANTED, origin: "https://cdn.example.invalid" }
  ];
  for (const request of requests) {
    const result = await handler(request, sender);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "NOT_RELEVANT");
  }
  assert.equal(calls, 0);
});

test("malformed known favicon requests return only bounded errors", async () => {
  const handler = createFaviconMessageHandler({ service: {}, resolveWindowScope() {} });
  const result = await handler({ type: FAVICON_MESSAGE_TYPES.LOOKUP, windowId: 7, tabs: [], url: "https://secret.invalid/path" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_REQUEST");
  assert.doesNotMatch(JSON.stringify(result), /secret|path/);
});

test("a lookup icon must say whether it is the tab's own icon or a same-site substitute", async () => {
  const icon = (logicalId, firefoxTabId, extra) => ({
    logicalId, firefoxTabId, mime: "image/png", bytes: Uint8Array.of(1), ...extra
  });
  const handler = createFaviconMessageHandler({
    service: {
      async getForTabs() {
        return { icons: [
          icon("tab-own", 11, { substitute: false }),
          icon("tab-stand-in", 12, { substitute: true }),
          icon("tab-unmarked", 13, {})
        ] };
      }
    },
    resolveWindowScope: async () => WORKSPACE_SCOPES.NORMAL
  });
  const lookup = await handler({
    type: FAVICON_MESSAGE_TYPES.LOOKUP,
    windowId: 7,
    tabs: [
      { logicalId: "tab-own", firefoxTabId: 11 },
      { logicalId: "tab-stand-in", firefoxTabId: 12 },
      { logicalId: "tab-unmarked", firefoxTabId: 13 }
    ]
  });
  assert.deepEqual(
    lookup.result.icons.map(({ logicalId, substitute }) => [logicalId, substitute]),
    [["tab-own", false], ["tab-stand-in", true]]
  );
});

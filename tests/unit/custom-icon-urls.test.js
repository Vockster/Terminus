import test from "node:test";
import assert from "node:assert/strict";

import { CustomIconUrlCache } from "../../src/ui/custom-icon-urls.js";
import { pngBytes } from "../helpers/custom-icon-fixture.js";

function createCache() {
  const created = [];
  const revoked = [];
  let counter = 0;
  const cache = new CustomIconUrlCache({
    createObjectURL: (blob) => {
      assert.equal(blob.type, "image/png");
      const url = `blob:test/${(counter += 1)}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => revoked.push(url)
  });
  return { cache, created, revoked };
}

function icon(id, digest, label = id) {
  return { id, label, digest, bytes: pngBytes() };
}

test("unchanged images keep their URL, and replaced or removed ones are revoked", () => {
  const { cache, created, revoked } = createCache();
  cache.replace([icon("a", "1"), icon("b", "2")]);
  assert.deepEqual(created, ["blob:test/1", "blob:test/2"]);
  assert.deepEqual(cache.list().map(({ id }) => id), ["a", "b"]);

  cache.replace([icon("a", "1", "Renamed"), icon("b", "3")]);
  assert.equal(cache.get("a").url, "blob:test/1");
  assert.equal(cache.get("a").label, "Renamed");
  assert.equal(cache.get("b").url, "blob:test/3");
  assert.deepEqual(revoked, ["blob:test/2"]);

  cache.replace([icon("b", "3")]);
  assert.equal(cache.get("a"), null);
  assert.deepEqual(revoked, ["blob:test/2", "blob:test/1"]);

  cache.dispose();
  assert.deepEqual(revoked, ["blob:test/2", "blob:test/1", "blob:test/3"]);
  assert.deepEqual(cache.list(), []);
});

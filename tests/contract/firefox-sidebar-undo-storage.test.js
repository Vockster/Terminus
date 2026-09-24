import test from "node:test";
import assert from "node:assert/strict";

import {
  SIDEBAR_UNDO_STORAGE_KEYS,
  createEmptySidebarUndoDocument
} from "../../src/contracts/sidebar-undo.js";
import { createFirefoxSidebarUndoStorage } from "../../src/platform/firefox/sidebar-undo-storage.js";

test("Firefox sidebar Undo storage keeps normal and private session documents separate", async () => {
  const values = {};
  const calls = [];
  const storage = createFirefoxSidebarUndoStorage({ storage: { session: {
    async get(key) { calls.push(["get", key]); return { [key]: values[key] }; },
    async set(update) { calls.push(["set", Object.keys(update)[0]]); Object.assign(values, update); },
    async remove(key) { calls.push(["remove", key]); delete values[key]; }
  } } });

  const normal = { ...createEmptySidebarUndoDocument(), sequence: 1 };
  const privateDocument = { ...createEmptySidebarUndoDocument(), sequence: 2 };
  await storage.write("normal", normal);
  await storage.write("private", privateDocument);

  assert.deepEqual(await storage.read("normal"), normal);
  assert.deepEqual(await storage.read("private"), privateDocument);
  assert.notEqual(SIDEBAR_UNDO_STORAGE_KEYS.normal, SIDEBAR_UNDO_STORAGE_KEYS.private);
  assert.ok(calls.every(([, key]) => key.includes("sidebarUndo")));
});

test("Firefox sidebar Undo storage ignores an older sequence", async () => {
  const values = {};
  const storage = createFirefoxSidebarUndoStorage({ storage: { session: {
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); },
    async remove(key) { delete values[key]; }
  } } });
  assert.equal(await storage.write("normal", {
    ...createEmptySidebarUndoDocument(), sequence: 4
  }), true);
  assert.equal(await storage.write("normal", {
    ...createEmptySidebarUndoDocument(), sequence: 3
  }), false);
  assert.equal((await storage.read("normal")).sequence, 4);
});

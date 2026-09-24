import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY,
  WORKSPACE_RUNTIME_STORAGE_KEY,
  createEmptyWorkspaceRuntime
} from "../../src/contracts/workspace-runtime.js";
import { createFirefoxWorkspaceRuntimeStorage } from "../../src/platform/firefox/workspace-runtime-storage.js";

test("Firefox runtime storage owns only its canonical and journal keys", async () => {
  const runtime = createEmptyWorkspaceRuntime();
  const journal = { schemaVersion: 1, sourceVersion: 1, targetVersion: 2 };
  const calls = { get: [], set: [], remove: [] };
  let stored = { unrelated: true };
  const adapter = createFirefoxWorkspaceRuntimeStorage({
    storage: {
      local: {
        async get(key) {
          calls.get.push(key);
          return Object.prototype.hasOwnProperty.call(stored, key) ? { [key]: stored[key] } : {};
        },
        async set(value) {
          calls.set.push(value);
          stored = { ...stored, ...value };
        },
        async remove(key) {
          calls.remove.push(key);
          delete stored[key];
        }
      }
    }
  });

  assert.equal(await adapter.read(), undefined);
  assert.equal(await adapter.readMigration(), undefined);
  await adapter.write(runtime);
  await adapter.writeMigration(journal);
  assert.deepEqual(await adapter.read(), runtime);
  assert.deepEqual(await adapter.readMigration(), journal);
  await adapter.removeMigration();

  assert.deepEqual(calls.get, [
    WORKSPACE_RUNTIME_STORAGE_KEY,
    WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY,
    WORKSPACE_RUNTIME_STORAGE_KEY,
    WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY
  ]);
  assert.deepEqual(calls.set, [
    { [WORKSPACE_RUNTIME_STORAGE_KEY]: runtime },
    { [WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY]: journal }
  ]);
  assert.deepEqual(calls.remove, [WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY]);
  assert.equal(stored.unrelated, true);
  assert.equal(stored[WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY], undefined);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_STATE_MIGRATION_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY
} from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { createFirefoxWorkspaceStorage } from "../../src/platform/firefox/workspace-storage.js";

test("Firefox workspace storage owns only its canonical and journal keys", async () => {
  const state = createDefaultWorkspaceState();
  const journal = { schemaVersion: 1, sourceVersion: 1, targetVersion: 2 };
  const calls = { get: [], set: [], remove: [] };
  let stored = { unrelated: true };
  const browserApi = {
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
  };
  const adapter = createFirefoxWorkspaceStorage(browserApi);

  assert.equal(await adapter.read(), undefined);
  assert.equal(await adapter.readMigration(), undefined);
  await adapter.write(state);
  await adapter.writeMigration(journal);
  assert.deepEqual(await adapter.read(), state);
  assert.deepEqual(await adapter.readMigration(), journal);
  await adapter.removeMigration();

  assert.deepEqual(calls.get, [
    WORKSPACE_STATE_STORAGE_KEY,
    WORKSPACE_STATE_MIGRATION_STORAGE_KEY,
    WORKSPACE_STATE_STORAGE_KEY,
    WORKSPACE_STATE_MIGRATION_STORAGE_KEY
  ]);
  assert.deepEqual(calls.set, [
    { [WORKSPACE_STATE_STORAGE_KEY]: state },
    { [WORKSPACE_STATE_MIGRATION_STORAGE_KEY]: journal }
  ]);
  assert.deepEqual(calls.remove, [WORKSPACE_STATE_MIGRATION_STORAGE_KEY]);
  assert.equal(stored.unrelated, true);
  assert.equal(stored[WORKSPACE_STATE_MIGRATION_STORAGE_KEY], undefined);
});

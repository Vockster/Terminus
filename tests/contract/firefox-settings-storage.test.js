import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_STATE_MIGRATION_STORAGE_KEY,
  SETTINGS_STATE_STORAGE_KEY,
  createDefaultSettingsState
} from "../../src/contracts/settings-state.js";
import { createFirefoxSettingsStorage } from "../../src/platform/firefox/settings-storage.js";

test("Firefox settings storage owns only its canonical and migration keys", async () => {
  const calls = { get: [], set: [], remove: [] };
  const stored = { unrelated: true };
  const browserApi = {
    storage: {
      local: {
        async get(key) { calls.get.push(key); return Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {}; },
        async set(value) { calls.set.push(structuredClone(value)); Object.assign(stored, structuredClone(value)); },
        async remove(key) { calls.remove.push(key); delete stored[key]; }
      }
    }
  };
  const adapter = createFirefoxSettingsStorage(browserApi);
  const settings = createDefaultSettingsState();
  const journal = { schemaVersion: 1, sourceVersion: 1, targetVersion: 2 };

  assert.equal(await adapter.read(), undefined);
  assert.equal(await adapter.readMigration(), undefined);
  await adapter.write(settings);
  await adapter.writeMigration(journal);
  assert.deepEqual(await adapter.read(), settings);
  assert.deepEqual(await adapter.readMigration(), journal);
  await adapter.removeMigration();
  assert.deepEqual(calls.get, [
    SETTINGS_STATE_STORAGE_KEY,
    SETTINGS_STATE_MIGRATION_STORAGE_KEY,
    SETTINGS_STATE_STORAGE_KEY,
    SETTINGS_STATE_MIGRATION_STORAGE_KEY
  ]);
  assert.deepEqual(calls.remove, [SETTINGS_STATE_MIGRATION_STORAGE_KEY]);
  assert.equal(stored.unrelated, true);
});

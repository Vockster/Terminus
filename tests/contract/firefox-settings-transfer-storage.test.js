import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY } from "../../src/contracts/settings-transfer.js";
import { createFirefoxSettingsTransferStorage } from "../../src/platform/firefox/settings-transfer-storage.js";

test("Firefox settings transfer storage owns only the legacy local journal key", async () => {
  const values = new Map();
  const calls = [];
  const browserApi = {
    storage: {
      local: {
        async get(key) {
          calls.push(["get", key]);
          return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {};
        },
        async set(update) {
          calls.push(["set", Object.keys(update)]);
          for (const [key, value] of Object.entries(update)) values.set(key, structuredClone(value));
        },
        async remove(key) {
          calls.push(["remove", key]);
          values.delete(key);
        }
      },
      sync: new Proxy({}, {
        get() { assert.fail("settings transfer must never touch storage.sync"); }
      })
    }
  };
  const storage = createFirefoxSettingsTransferStorage(browserApi);
  const journal = { schemaVersion: 1, marker: "test" };

  assert.equal(await storage.readJournal(), undefined);
  await storage.writeJournal(journal);
  assert.deepEqual(await storage.readJournal(), journal);
  await storage.removeJournal();
  assert.equal(await storage.readJournal(), undefined);
  assert.deepEqual(calls.map((call) => call[1]), [
    SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY,
    [SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY],
    SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY,
    SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY,
    SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY,
  SETTINGS_BACKUP_RECORD_STORAGE_PREFIX,
  SNAPSHOT_CAPTURE_ALARM_NAME,
  SNAPSHOT_CLEANUP_ALARM_NAME,
  SNAPSHOT_INDEX_STORAGE_KEY,
  SNAPSHOT_MASTER_STORAGE_KEY,
  SNAPSHOT_RECORD_STORAGE_PREFIX
} from "../../src/contracts/snapshots.js";
import { createFirefoxSnapshotAlarms } from "../../src/platform/firefox/snapshot-alarms.js";
import { createFirefoxSnapshotBrowser } from "../../src/platform/firefox/snapshot-browser.js";
import { createFirefoxSnapshotDownloads } from "../../src/platform/firefox/snapshot-downloads.js";
import { createFirefoxSnapshotStorage } from "../../src/platform/firefox/snapshot-storage.js";

test("Firefox snapshot storage owns only its namespaced keys", async () => {
  const values = { unrelated: "keep" };
  const removed = [];
  const local = {
    async get(key) {
      if (key === null) {
        return structuredClone(values);
      }
      return Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {};
    },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(key) { removed.push(key); delete values[key]; },
    async getBytesInUse(key) { assert.equal(key, null); return 4096; }
  };
  const storage = createFirefoxSnapshotStorage({ storage: { local } });
  await storage.writeIndex({ schemaVersion: 1, entries: [], tombstones: [] });
  await storage.writeRecord({ id: "snapshot-one", payload: {} });
  values[SNAPSHOT_MASTER_STORAGE_KEY] = { id: "snapshot-master" };
  await storage.writeLastSettingsRestoreReport({ scope: "settings" });
  await storage.writeSettingsBackup("settings-backup-one", { documentType: "sidebars.settings" });

  assert.ok(Object.hasOwn(values, SNAPSHOT_INDEX_STORAGE_KEY));
  assert.ok(Object.hasOwn(values, `${SNAPSHOT_RECORD_STORAGE_PREFIX}snapshot-one`));
  assert.ok(Object.hasOwn(values, SNAPSHOT_MASTER_STORAGE_KEY));
  assert.ok(Object.hasOwn(values, SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY));
  assert.ok(Object.hasOwn(values, `${SETTINGS_BACKUP_RECORD_STORAGE_PREFIX}settings-backup-one`));
  assert.equal(values.unrelated, "keep");
  assert.deepEqual((await storage.listRecords()).map(({ id }) => id), ["snapshot-one"]);
  assert.deepEqual((await storage.listSettingsBackups()).map(({ id }) => id), [
    "settings-backup-one"
  ]);
  assert.equal(await storage.bytesInUse(), 4096);
  assert.deepEqual(await storage.readMaster(), { id: "snapshot-master" });
  await storage.removeMaster();
  await storage.removeRecord("snapshot-one");
  await storage.removeSettingsBackup("settings-backup-one");
  assert.deepEqual(removed, [
    SNAPSHOT_MASTER_STORAGE_KEY,
    `${SNAPSHOT_RECORD_STORAGE_PREFIX}snapshot-one`,
    `${SETTINGS_BACKUP_RECORD_STORAGE_PREFIX}settings-backup-one`
  ]);
});

test("Downloads cleanup uses only the exact extension-recorded download ID", async () => {
  const calls = [];
  const revoked = [];
  let downloadListener = null;
  class TestBlob {
    constructor(parts, options) {
      calls.push(["blob", parts, options]);
    }
  }
  const downloads = createFirefoxSnapshotDownloads(
    {
      permissions: { async contains(value) { calls.push(["permission", value]); return true; } },
      downloads: {
        onChanged: { addListener(listener) { downloadListener = listener; } },
        async search(query) {
          calls.push(["search", query]);
          return [{ id: query.id, state: "complete", exists: true }];
        },
        async removeFile(id) { calls.push(["remove", id]); },
        async download(options) { calls.push(["download", options]); return 23; },
        async show(id) { calls.push(["show", id]); return true; },
        showDefaultFolder() { calls.push(["show-default"]); }
      }
    },
    {
      BlobType: TestBlob,
      urlApi: {
        createObjectURL() { return "blob:sidebars-test"; },
        revokeObjectURL(value) { revoked.push(value); }
      }
    }
  );
  const downloadId = await downloads.downloadJson({
    text: "{\"ok\":true}",
    filename: "Workplace saves/test.json",
    saveAs: true
  });
  const cleanup = await downloads.removeOwnedFile(downloadId);
  const opened = await downloads.openFileLocation([downloadId]);

  assert.equal(downloadId, 23);
  assert.equal(cleanup.removed, true);
  assert.deepEqual(opened, { opened: "snapshot-folder" });
  assert.deepEqual(calls.find(([kind]) => kind === "show"), ["show", 23]);
  assert.deepEqual(calls.find(([kind]) => kind === "search"), ["search", { id: 23 }]);
  assert.deepEqual(calls.find(([kind]) => kind === "remove"), ["remove", 23]);
  const options = calls.find(([kind]) => kind === "download")[1];
  assert.equal(options.filename, "Workplace saves/test.json");
  assert.equal(options.url, "blob:sidebars-test");
  assert.equal(options.conflictAction, "uniquify");
  assert.equal(options.saveAs, true);
  assert.deepEqual(calls.find(([kind]) => kind === "blob"), [
    "blob",
    ["{\"ok\":true}"],
    { type: "application/json" }
  ]);
  downloadListener({ id: 23, state: { current: "complete" } });
  assert.deepEqual(revoked, ["blob:sidebars-test"]);
});

test("a download that finishes before its ID resolves still releases its blob URL", async () => {
  const revoked = [];
  let downloadListener = null;
  const downloads = createFirefoxSnapshotDownloads(
    {
      permissions: { async contains() { return true; } },
      downloads: {
        onChanged: { addListener(listener) { downloadListener = listener; } },
        async download() {
          downloadListener({ id: 47, state: { current: "complete" } });
          return 47;
        }
      }
    },
    {
      urlApi: {
        createObjectURL() { return "blob:finished-before-resolution"; },
        revokeObjectURL(value) { revoked.push(value); }
      }
    }
  );

  assert.equal(await downloads.downloadJson({ text: "{}", filename: "test.json" }), 47);
  assert.deepEqual(revoked, ["blob:finished-before-resolution"]);
});

test("snapshot downloads do not touch the optional API before permission is granted", async () => {
  const downloads = createFirefoxSnapshotDownloads({
    permissions: { async contains() { return false; } }
  });
  await assert.rejects(
    downloads.downloadJson({ text: "{}", filename: "Workplace saves/test.json" }),
    (error) => error.code === "PERMISSION_REQUIRED"
  );
  await assert.rejects(
    downloads.openFileLocation([23]),
    (error) => error.code === "PERMISSION_REQUIRED"
  );
});

test("file location falls back to the default Downloads folder without a tracked file", async () => {
  const calls = [];
  const downloads = createFirefoxSnapshotDownloads({
    permissions: { async contains() { return true; } },
    downloads: {
      showDefaultFolder() { calls.push("show-default"); }
    }
  });
  assert.deepEqual(await downloads.openFileLocation([]), { opened: "downloads-folder" });
  assert.deepEqual(calls, ["show-default"]);
});

test("file location skips a stale ID and shows an older tracked snapshot", async () => {
  const calls = [];
  const downloads = createFirefoxSnapshotDownloads({
    permissions: { async contains() { return true; } },
    downloads: {
      async search({ id }) {
        calls.push(["search", id]);
        return id === 31 ? [] : [{ id, state: "complete", exists: true }];
      },
      async show(id) { calls.push(["show", id]); return true; },
      showDefaultFolder() { calls.push(["show-default"]); }
    }
  });
  assert.deepEqual(await downloads.openFileLocation([31, 30]), {
    opened: "snapshot-folder"
  });
  assert.deepEqual(calls, [["search", 31], ["search", 30], ["show", 30]]);
});

test("file location opens Downloads when every tracked snapshot file is unavailable", async () => {
  const calls = [];
  const downloads = createFirefoxSnapshotDownloads({
    permissions: { async contains() { return true; } },
    downloads: {
      async search({ id }) {
        calls.push(["search", id]);
        return [{ id, state: "complete", exists: true }];
      },
      async show(id) { calls.push(["show", id]); return false; },
      showDefaultFolder() { calls.push(["show-default"]); }
    }
  });
  assert.deepEqual(await downloads.openFileLocation([41]), {
    opened: "downloads-folder"
  });
  assert.deepEqual(calls, [["search", 41], ["show", 41], ["show-default"]]);
});

test("snapshot browser substitutes protected URLs and alarm adapter filters unrelated alarms", async () => {
  const calls = [];
  let alarmListener = null;
  const browserApi = {
    windows: {
      async create(options) {
        calls.push(["window", options]);
        return { id: 8, tabs: [{ id: 80, cookieStoreId: "firefox-default" }] };
      },
      async remove(windowId) { calls.push(["remove-window", windowId]); }
    },
    tabs: {
      async create(options) { calls.push(["tab", options]); return { id: 81 }; }
    },
    alarms: {
      create(name, options) { calls.push(["alarm", name, options]); },
      async clear(name) { calls.push(["clear", name]); return true; },
      async get(name) { calls.push(["get", name]); return null; },
      onAlarm: {
        addListener(listener) { alarmListener = listener; },
        removeListener(listener) { assert.equal(listener, alarmListener); }
      }
    }
  };
  const snapshotBrowser = createFirefoxSnapshotBrowser(browserApi);
  const created = await snapshotBrowser.createWindow("about:config", null);
  assert.equal(created.urlSupported, false);
  assert.deepEqual(calls[0], ["window", { url: "about:blank" }]);
  await snapshotBrowser.removeWindow(8);
  assert.deepEqual(calls[1], ["remove-window", 8]);

  const alarms = createFirefoxSnapshotAlarms(browserApi);
  let fired = 0;
  const unsubscribe = alarms.subscribe(() => { fired += 1; });
  alarms.create(SNAPSHOT_CAPTURE_ALARM_NAME, 1000, 15);
  alarmListener({ name: "unrelated" });
  alarmListener({ name: SNAPSHOT_CAPTURE_ALARM_NAME });
  alarmListener({ name: SNAPSHOT_CLEANUP_ALARM_NAME });
  unsubscribe();
  assert.equal(fired, 2);
  assert.deepEqual(calls.at(-1), ["alarm", SNAPSHOT_CAPTURE_ALARM_NAME, { when: 1000, periodInMinutes: 15 }]);
});

test("snapshot materialization removes only operation-created container mismatches", async () => {
  const calls = [];
  const snapshotBrowser = createFirefoxSnapshotBrowser({
    windows: {
      async create() {
        return {
          id: 8,
          incognito: false,
          tabs: [{ id: 80, cookieStoreId: "firefox-container-wrong" }]
        };
      },
      async remove(windowId) { calls.push(["remove-window", windowId]); }
    },
    tabs: {
      async create() {
        return { id: 81, cookieStoreId: "firefox-container-wrong" };
      },
      async remove(tabId) { calls.push(["remove-tab", tabId]); }
    }
  });

  await assert.rejects(
    snapshotBrowser.createWindow("https://example.com/", null, {
      cookieStoreId: "firefox-container-requested"
    }),
    (error) => error.containerMismatch === true
  );
  await assert.rejects(
    snapshotBrowser.createTab(7, "https://example.com/", {
      cookieStoreId: "firefox-container-requested"
    }),
    (error) => error.containerMismatch === true
  );
  assert.deepEqual(calls, [["remove-window", 8], ["remove-tab", 81]]);
});

test("snapshot tabs are created unloaded with their title only where Firefox allows it", async () => {
  const created = [];
  const snapshotBrowser = createFirefoxSnapshotBrowser({
    tabs: {
      async create(options) {
        created.push(options);
        return { id: 90 + created.length, cookieStoreId: "firefox-default" };
      }
    }
  });

  const unloaded = await snapshotBrowser.createTab(7, "https://docs.invalid/guide", {
    discarded: true,
    title: "T".repeat(5000)
  });
  assert.equal(unloaded.discarded, true);
  assert.deepEqual(
    { ...created[0], title: created[0].title.length },
    { windowId: 7, url: "https://docs.invalid/guide", active: false, discarded: true, title: 4096 }
  );

  const placeholder = await snapshotBrowser.createTab(7, "about:config", { discarded: true, title: "Config" });
  assert.equal(placeholder.urlSupported, false);
  assert.equal(placeholder.discarded, false);
  assert.deepEqual(created[1], { windowId: 7, url: "about:blank", active: false });

  const active = await snapshotBrowser.createTab(7, "https://docs.invalid/", { active: true, discarded: true });
  assert.equal(active.discarded, false);
  assert.deepEqual(created[2], { windowId: 7, url: "https://docs.invalid/", active: true });

  const untitled = await snapshotBrowser.createTab(7, "https://docs.invalid/other", { discarded: true });
  assert.deepEqual(created[3], { windowId: 7, url: "https://docs.invalid/other", active: false, discarded: true });
  assert.equal(untitled.discarded, true);
});

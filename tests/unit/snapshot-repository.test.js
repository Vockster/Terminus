import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  SETTINGS_BACKUP_KINDS,
  SNAPSHOT_KINDS,
  createSnapshotRecord,
  finalizeSettingsBackup
} from "../../src/contracts/snapshots.js";
import { SnapshotRepository } from "../../src/core/snapshot-repository.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

function memoryStorage() {
  let index;
  let master;
  let schedule;
  let journal;
  let report;
  let settingsReport;
  const records = new Map();
  const settingsBackups = new Map();
  return {
    records,
    settingsBackups,
    seedMaster(value) { master = structuredClone(value); },
    storage: {
      async readIndex() { return structuredClone(index); },
      async writeIndex(value) { index = structuredClone(value); },
      async readRecord(id) { return structuredClone(records.get(id)); },
      async writeRecord(value) { records.set(value.id, structuredClone(value)); },
      async removeRecord(id) { records.delete(id); },
      async listRecords() { return [...records].map(([id, value]) => ({ id, value: structuredClone(value) })); },
      async readSettingsBackup(id) { return structuredClone(settingsBackups.get(id)); },
      async writeSettingsBackup(id, value) { settingsBackups.set(id, structuredClone(value)); },
      async removeSettingsBackup(id) { settingsBackups.delete(id); },
      async listSettingsBackups() {
        return [...settingsBackups].map(([id, value]) => ({ id, value: structuredClone(value) }));
      },
      async readMaster() { return structuredClone(master); },
      async writeMaster(value) { master = structuredClone(value); },
      async removeMaster() { master = undefined; },
      async readScheduleState() { return structuredClone(schedule); },
      async writeScheduleState(value) { schedule = structuredClone(value); },
      async readRestoreJournal() { return structuredClone(journal); },
      async writeRestoreJournal(value) { journal = structuredClone(value); },
      async removeRestoreJournal() { journal = undefined; },
      async readLastRestoreReport() { return structuredClone(report); },
      async writeLastRestoreReport(value) { report = structuredClone(value); },
      async readLastSettingsRestoreReport() { return structuredClone(settingsReport); },
      async writeLastSettingsRestoreReport(value) { settingsReport = structuredClone(value); },
      async bytesInUse() { return 2048; }
    }
  };
}

async function record(id, kind, createdAt) {
  return createSnapshotRecord({
    id,
    kind,
    createdAt,
    payload: createSnapshotPayloadFixture()
  });
}

test("repository writes records before index publication and retains manual saves", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  await repository.save(await record("snapshot-old", SNAPSHOT_KINDS.AUTOMATIC, "2026-08-01T00:00:00.000Z"));
  await repository.save(await record("snapshot-new", SNAPSHOT_KINDS.AUTOMATIC, "2026-09-05T00:00:00.000Z"));
  await repository.save(await record("snapshot-manual", SNAPSHOT_KINDS.MANUAL, "2026-01-01T00:00:00.000Z"));
  await repository.save(await record("snapshot-safety", SNAPSHOT_KINDS.SAFETY, "2026-01-01T00:00:00.000Z"));
  await repository.addDownloadId("snapshot-old", 17);
  const rule = { count: 1, maxAgeMilliseconds: 30 * 24 * 60 * 60 * 1000 };
  const now = new Date("2026-09-06T00:00:00.000Z");
  assert.equal(await repository.previewAutomaticRetention(rule, now), 1);
  assert.equal(memory.records.has("snapshot-old"), true);
  const removed = await repository.applyAutomaticRetention(rule, now);
  assert.deepEqual(removed.map(({ id }) => id), ["snapshot-old"]);
  assert.equal(await repository.previewAutomaticRetention(rule, now), 0);
  assert.equal(memory.records.has("snapshot-old"), false);
  assert.deepEqual((await repository.list()).records.map(({ id }) => id), [
    "snapshot-new",
    "snapshot-safety",
    "snapshot-manual"
  ]);
});

test("settings backup history retains manual records and prunes automatic records separately", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  const backup = (createdAt, kind) => finalizeSettingsBackup({
    createdAt,
    kind,
    settings: createDefaultSettingsState()
  });
  await repository.saveSettingsBackup(
    "settings-backup-manual",
    await backup("2026-01-01T00:00:00.000Z", SETTINGS_BACKUP_KINDS.MANUAL)
  );
  await repository.saveSettingsBackup(
    "settings-backup-old",
    await backup("2026-08-01T00:00:00.000Z", SETTINGS_BACKUP_KINDS.AUTOMATIC)
  );
  await repository.saveSettingsBackup(
    "settings-backup-new",
    await backup("2026-09-05T00:00:00.000Z", SETTINGS_BACKUP_KINDS.AUTOMATIC)
  );
  const rule = { count: 1, maxAgeMilliseconds: 30 * 24 * 60 * 60 * 1000 };
  const now = new Date("2026-09-06T00:00:00.000Z");
  assert.equal(await repository.previewAutomaticSettingsRetention(rule, now), 1);
  assert.equal(memory.settingsBackups.has("settings-backup-old"), true);
  const removed = await repository.applyAutomaticSettingsRetention(rule, now);
  assert.deepEqual(removed.map(({ id }) => id), ["settings-backup-old"]);
  assert.deepEqual((await repository.listSettingsBackups()).map(({ id }) => id), [
    "settings-backup-new",
    "settings-backup-manual"
  ]);
});

test("a legacy master is preserved as a manual snapshot and removed from legacy storage", async () => {
  const memory = memoryStorage();
  memory.seedMaster(
    await record("snapshot-master-one", SNAPSHOT_KINDS.MASTER, "2026-09-05T00:00:00.000Z")
  );
  const repository = new SnapshotRepository(memory.storage);
  const listed = await repository.list();
  assert.deepEqual(listed.records.map(({ id, kind }) => ({ id, kind })), [
    { id: "snapshot-master-one", kind: SNAPSHOT_KINDS.MANUAL }
  ]);
  assert.equal(await memory.storage.readMaster(), undefined);
  await repository.applyAutomaticRetention(
    { count: 1, maxAgeMilliseconds: 24 * 60 * 60 * 1000 },
    new Date("2027-01-01T00:00:00.000Z")
  );
  assert.equal((await repository.list()).records[0].id, "snapshot-master-one");
});

test("without an age limit the maximum keeps the newest automatic saves of any age", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  for (const [id, createdAt] of [
    ["snapshot-a", "2020-01-01T00:00:00.000Z"],
    ["snapshot-b", "2021-01-01T00:00:00.000Z"],
    ["snapshot-c", "2022-01-01T00:00:00.000Z"]
  ]) {
    await repository.save(await record(id, SNAPSHOT_KINDS.AUTOMATIC, createdAt));
  }
  const now = new Date("2026-09-06T00:00:00.000Z");
  assert.equal(await repository.previewAutomaticRetention({ count: 3, maxAgeMilliseconds: null }, now), 0);
  const removed = await repository.applyAutomaticRetention({ count: 2, maxAgeMilliseconds: null }, now);
  assert.deepEqual(removed.map(({ id }) => id), ["snapshot-a"]);
  assert.deepEqual((await repository.list()).records.map(({ id }) => id), ["snapshot-c", "snapshot-b"]);
});

test("repository returns tracked downloads newest-first for each snapshot kind", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  await repository.save(await record("snapshot-manual-old", SNAPSHOT_KINDS.MANUAL, "2026-09-01T00:00:00.000Z"));
  await repository.save(await record("snapshot-manual-new", SNAPSHOT_KINDS.MANUAL, "2026-09-05T00:00:00.000Z"));
  await repository.addDownloadId("snapshot-manual-old", 17);
  await repository.addDownloadId("snapshot-manual-new", 23);
  await repository.addDownloadId("snapshot-manual-new", 24);

  assert.deepEqual(await repository.downloadIds(SNAPSHOT_KINDS.MANUAL), [24, 23, 17]);
  assert.deepEqual(await repository.downloadIds(SNAPSHOT_KINDS.AUTOMATIC), []);
});

test("clearing the viewer removes manual and automatic records while preserving safety snapshots", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  await repository.save(await record("snapshot-manual", SNAPSHOT_KINDS.MANUAL, "2026-09-05T12:00:00.000Z"));
  await repository.save(await record("snapshot-automatic", SNAPSHOT_KINDS.AUTOMATIC, "2026-09-05T11:00:00.000Z"));
  await repository.save(await record("snapshot-safety", SNAPSHOT_KINDS.SAFETY, "2026-09-05T10:00:00.000Z"));
  await repository.addDownloadId("snapshot-manual", 17);
  await repository.addDownloadId("snapshot-automatic", 23);

  const removed = await repository.clearViewerRecords();

  assert.deepEqual(removed.map(({ id, kind, hasExport }) => ({ id, kind, hasExport })), [
    { id: "snapshot-manual", kind: SNAPSHOT_KINDS.MANUAL, hasExport: true },
    { id: "snapshot-automatic", kind: SNAPSHOT_KINDS.AUTOMATIC, hasExport: true }
  ]);
  assert.deepEqual((await repository.list()).records.map(({ id, kind }) => ({ id, kind })), [
    { id: "snapshot-safety", kind: SNAPSHOT_KINDS.SAFETY }
  ]);
  assert.deepEqual([...memory.records.keys()], ["snapshot-safety"]);
});

test("startup protection keeps exactly one pre-startup automatic snapshot outside retention", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  await repository.save(await record(
    "snapshot-old",
    SNAPSHOT_KINDS.AUTOMATIC,
    "2026-09-01T00:00:00.000Z"
  ));
  await repository.save(await record(
    "snapshot-startup",
    SNAPSHOT_KINDS.AUTOMATIC,
    "2026-09-02T00:00:00.000Z"
  ));

  assert.deepEqual(await repository.ensureStartupProtection(
    new Date("2026-09-03T00:00:00.000Z")
  ), {
    snapshotId: "snapshot-startup",
    protectedAt: "2026-09-03T00:00:00.000Z",
    created: true
  });
  await repository.save(await record(
    "snapshot-after-startup",
    SNAPSHOT_KINDS.AUTOMATIC,
    "2026-09-03T01:00:00.000Z"
  ));
  assert.equal((await repository.ensureStartupProtection(
    new Date("2026-09-03T02:00:00.000Z")
  )).snapshotId, "snapshot-startup");

  const removed = await repository.applyAutomaticRetention(
    { count: 1, maxAgeMilliseconds: null },
    new Date("2026-09-04T00:00:00.000Z")
  );
  assert.deepEqual(removed.map(({ id }) => id), ["snapshot-old"]);
  assert.deepEqual((await repository.list()).records.map(({ id, protected: isProtected }) => ({
    id,
    protected: isProtected
  })), [
    { id: "snapshot-after-startup", protected: false },
    { id: "snapshot-startup", protected: true }
  ]);

  await repository.delete("snapshot-startup");
  assert.deepEqual((await repository.readScheduleState()).startupProtection, {
    snapshotId: null,
    protectedAt: null
  });
});

test("clearing viewer history deliberately clears startup protection", async () => {
  const memory = memoryStorage();
  const repository = new SnapshotRepository(memory.storage);
  await repository.save(await record(
    "snapshot-startup",
    SNAPSHOT_KINDS.AUTOMATIC,
    "2026-09-02T00:00:00.000Z"
  ));
  await repository.ensureStartupProtection(new Date("2026-09-03T00:00:00.000Z"));

  await repository.clearViewerRecords();
  assert.deepEqual((await repository.readScheduleState()).startupProtection, {
    snapshotId: null,
    protectedAt: null
  });
});

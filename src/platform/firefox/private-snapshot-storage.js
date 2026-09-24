import {
  PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY,
  PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY,
  PRIVATE_RECOVERY_STORAGE_KEY,
  PRIVATE_RESTORE_JOURNAL_STORAGE_KEY,
  PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX
} from "../../contracts/private-snapshots.js";

function ownedValue(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

export function createFirefoxPrivateSnapshotStorage(browserApi) {
  const storage = browserApi.storage.local;
  const snapshotKey = (id) => `${PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX}${id}`;
  return Object.freeze({
    async readRecovery() {
      return ownedValue(await storage.get(PRIVATE_RECOVERY_STORAGE_KEY), PRIVATE_RECOVERY_STORAGE_KEY);
    },
    async writeRecovery(document) {
      await storage.set({ [PRIVATE_RECOVERY_STORAGE_KEY]: document });
    },
    async removeRecovery() {
      await storage.remove(PRIVATE_RECOVERY_STORAGE_KEY);
    },
    async quarantineRecovery(entry) {
      await storage.set({ [PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY]: entry });
      await storage.remove(PRIVATE_RECOVERY_STORAGE_KEY);
    },
    async readSnapshotRecord(id) {
      const key = snapshotKey(id);
      return ownedValue(await storage.get(key), key);
    },
    async writeSnapshotRecord(record) {
      await storage.set({ [snapshotKey(record.id)]: record });
    },
    async removeSnapshotRecord(id) {
      await storage.remove(snapshotKey(id));
    },
    async listSnapshotRecords() {
      const all = await storage.get(null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith(PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX))
        .map(([key, value]) => ({
          id: key.slice(PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX.length),
          value
        }));
    },
    async bytesInUse() {
      const all = await storage.get(null);
      const owned = Object.fromEntries(Object.entries(all).filter(([key]) =>
        key.startsWith(PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX)
      ));
      return new TextEncoder().encode(JSON.stringify(owned)).byteLength;
    },
    async readRestoreJournal() {
      return ownedValue(
        await storage.get(PRIVATE_RESTORE_JOURNAL_STORAGE_KEY),
        PRIVATE_RESTORE_JOURNAL_STORAGE_KEY
      );
    },
    async writeRestoreJournal(journal) {
      await storage.set({ [PRIVATE_RESTORE_JOURNAL_STORAGE_KEY]: journal });
    },
    async removeRestoreJournal() {
      await storage.remove(PRIVATE_RESTORE_JOURNAL_STORAGE_KEY);
    },
    async clearRestoreJournal() {
      await storage.remove(PRIVATE_RESTORE_JOURNAL_STORAGE_KEY);
    },
    async readLastRestoreReport() {
      return ownedValue(
        await storage.get(PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY),
        PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY
      );
    },
    async writeLastRestoreReport(report) {
      await storage.set({ [PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY]: report });
    }
  });
}

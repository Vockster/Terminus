import {
  SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY,
  SETTINGS_BACKUP_RECORD_STORAGE_PREFIX,
  SNAPSHOT_INDEX_STORAGE_KEY,
  SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY,
  SNAPSHOT_MASTER_STORAGE_KEY,
  SNAPSHOT_RECORD_STORAGE_PREFIX,
  SNAPSHOT_RESTORE_JOURNAL_STORAGE_KEY,
  SNAPSHOT_SCHEDULE_STORAGE_KEY
} from "../../contracts/snapshots.js";

function ownedValue(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

function recordKey(id) {
  return `${SNAPSHOT_RECORD_STORAGE_PREFIX}${id}`;
}

function settingsBackupKey(id) {
  return `${SETTINGS_BACKUP_RECORD_STORAGE_PREFIX}${id}`;
}

export function createFirefoxSnapshotStorage(browserApi) {
  const storageArea = browserApi.storage.local;

  return Object.freeze({
    async readIndex() {
      return ownedValue(await storageArea.get(SNAPSHOT_INDEX_STORAGE_KEY), SNAPSHOT_INDEX_STORAGE_KEY);
    },

    async writeIndex(index) {
      await storageArea.set({ [SNAPSHOT_INDEX_STORAGE_KEY]: index });
    },

    async readRecord(id) {
      const key = recordKey(id);
      return ownedValue(await storageArea.get(key), key);
    },

    async writeRecord(record) {
      await storageArea.set({ [recordKey(record.id)]: record });
    },

    async removeRecord(id) {
      await storageArea.remove(recordKey(id));
    },

    async listRecords() {
      const all = await storageArea.get(null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith(SNAPSHOT_RECORD_STORAGE_PREFIX))
        .map(([key, value]) => ({ id: key.slice(SNAPSHOT_RECORD_STORAGE_PREFIX.length), value }));
    },

    async readSettingsBackup(id) {
      const key = settingsBackupKey(id);
      return ownedValue(await storageArea.get(key), key);
    },

    async writeSettingsBackup(id, backup) {
      await storageArea.set({ [settingsBackupKey(id)]: backup });
    },

    async removeSettingsBackup(id) {
      await storageArea.remove(settingsBackupKey(id));
    },

    async listSettingsBackups() {
      const all = await storageArea.get(null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith(SETTINGS_BACKUP_RECORD_STORAGE_PREFIX))
        .map(([key, value]) => ({
          id: key.slice(SETTINGS_BACKUP_RECORD_STORAGE_PREFIX.length),
          value
        }));
    },

    async readMaster() {
      return ownedValue(await storageArea.get(SNAPSHOT_MASTER_STORAGE_KEY), SNAPSHOT_MASTER_STORAGE_KEY);
    },

    async removeMaster() {
      await storageArea.remove(SNAPSHOT_MASTER_STORAGE_KEY);
    },

    async readScheduleState() {
      return ownedValue(await storageArea.get(SNAPSHOT_SCHEDULE_STORAGE_KEY), SNAPSHOT_SCHEDULE_STORAGE_KEY);
    },

    async writeScheduleState(state) {
      await storageArea.set({ [SNAPSHOT_SCHEDULE_STORAGE_KEY]: state });
    },

    async readRestoreJournal() {
      return ownedValue(
        await storageArea.get(SNAPSHOT_RESTORE_JOURNAL_STORAGE_KEY),
        SNAPSHOT_RESTORE_JOURNAL_STORAGE_KEY
      );
    },

    async writeRestoreJournal(journal) {
      await storageArea.set({ [SNAPSHOT_RESTORE_JOURNAL_STORAGE_KEY]: journal });
    },

    async removeRestoreJournal() {
      await storageArea.remove(SNAPSHOT_RESTORE_JOURNAL_STORAGE_KEY);
    },

    async readLastRestoreReport() {
      return ownedValue(
        await storageArea.get(SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY),
        SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY
      );
    },

    async writeLastRestoreReport(report) {
      await storageArea.set({ [SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY]: report });
    },

    async readLastSettingsRestoreReport() {
      return ownedValue(
        await storageArea.get(SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY),
        SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY
      );
    },

    async writeLastSettingsRestoreReport(report) {
      await storageArea.set({ [SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY]: report });
    },

    async bytesInUse() {
      if (typeof storageArea.getBytesInUse !== "function") {
        return null;
      }
      return storageArea.getBytesInUse(null);
    }
  });
}

import {
  SETTINGS_STATE_MIGRATION_STORAGE_KEY,
  SETTINGS_STATE_STORAGE_KEY,
  SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY
} from "../../contracts/settings-state.js";

function readOwnedValue(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

export function createFirefoxSettingsStorage(browserApi) {
  const storageArea = browserApi.storage.local;

  return Object.freeze({
    async read() {
      return readOwnedValue(
        await storageArea.get(SETTINGS_STATE_STORAGE_KEY),
        SETTINGS_STATE_STORAGE_KEY
      );
    },

    async write(settings) {
      await storageArea.set({ [SETTINGS_STATE_STORAGE_KEY]: settings });
    },

    async readMigration() {
      return readOwnedValue(
        await storageArea.get(SETTINGS_STATE_MIGRATION_STORAGE_KEY),
        SETTINGS_STATE_MIGRATION_STORAGE_KEY
      );
    },

    async writeMigration(journal) {
      await storageArea.set({ [SETTINGS_STATE_MIGRATION_STORAGE_KEY]: journal });
    },

    async removeMigration() {
      await storageArea.remove(SETTINGS_STATE_MIGRATION_STORAGE_KEY);
    },

    async readUnsupportedBackup() {
      return readOwnedValue(
        await storageArea.get(SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY),
        SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY
      );
    },

    async writeUnsupportedBackup(document) {
      await storageArea.set({ [SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY]: document });
    }
  });
}

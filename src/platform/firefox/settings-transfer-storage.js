import { SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY } from "../../contracts/settings-transfer.js";

function owned(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

export function createFirefoxSettingsTransferStorage(browserApi) {
  const local = browserApi.storage.local;
  return Object.freeze({
    async readJournal() {
      return owned(
        await local.get(SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY),
        SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY
      );
    },
    async writeJournal(journal) {
      await local.set({ [SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY]: journal });
    },
    async removeJournal() {
      await local.remove(SETTINGS_TRANSFER_JOURNAL_STORAGE_KEY);
    }
  });
}

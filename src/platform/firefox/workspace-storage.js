import {
  WORKSPACE_STATE_MIGRATION_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY
} from "../../contracts/workspace-state.js";

function readOwnedValue(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

export function createFirefoxWorkspaceStorage(browserApi) {
  const storageArea = browserApi.storage.local;

  return Object.freeze({
    async read() {
      return readOwnedValue(await storageArea.get(WORKSPACE_STATE_STORAGE_KEY), WORKSPACE_STATE_STORAGE_KEY);
    },

    async write(state) {
      await storageArea.set({ [WORKSPACE_STATE_STORAGE_KEY]: state });
    },

    async readMigration() {
      return readOwnedValue(
        await storageArea.get(WORKSPACE_STATE_MIGRATION_STORAGE_KEY),
        WORKSPACE_STATE_MIGRATION_STORAGE_KEY
      );
    },

    async writeMigration(journal) {
      await storageArea.set({ [WORKSPACE_STATE_MIGRATION_STORAGE_KEY]: journal });
    },

    async removeMigration() {
      await storageArea.remove(WORKSPACE_STATE_MIGRATION_STORAGE_KEY);
    }
  });
}

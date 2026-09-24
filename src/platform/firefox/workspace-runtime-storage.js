import {
  WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY,
  WORKSPACE_RUNTIME_STORAGE_KEY
} from "../../contracts/workspace-runtime.js";

export const PRIVATE_WORKSPACE_RUNTIME_STORAGE_KEY = "privateWorkspaceRuntime";
export const PRIVATE_WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY =
  "privateWorkspaceRuntimeMigration";

function readOwnedValue(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

export function createFirefoxWorkspaceRuntimeStorage(
  browserApi,
  {
    areaName = "local",
    storageKey = WORKSPACE_RUNTIME_STORAGE_KEY,
    migrationKey = WORKSPACE_RUNTIME_MIGRATION_STORAGE_KEY
  } = {}
) {
  const storageArea = browserApi.storage[areaName];
  if (!storageArea) {
    throw new TypeError(`Firefox storage.${areaName} is unavailable.`);
  }

  return Object.freeze({
    async read() {
      return readOwnedValue(await storageArea.get(storageKey), storageKey);
    },

    async write(runtime) {
      await storageArea.set({ [storageKey]: runtime });
    },

    async readMigration() {
      return readOwnedValue(
        await storageArea.get(migrationKey),
        migrationKey
      );
    },

    async writeMigration(journal) {
      await storageArea.set({ [migrationKey]: journal });
    },

    async removeMigration() {
      await storageArea.remove(migrationKey);
    },

    async clear() {
      await storageArea.remove([storageKey, migrationKey]);
    }
  });
}

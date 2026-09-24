import { CONTAINER_STATE_STORAGE_KEY } from "../../contracts/containers.js";

function readOwnedValue(result, key) {
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
}

export function createFirefoxContainerStorage(browserApi) {
  const storageArea = browserApi.storage.local;
  return Object.freeze({
    async read() {
      return readOwnedValue(
        await storageArea.get(CONTAINER_STATE_STORAGE_KEY),
        CONTAINER_STATE_STORAGE_KEY
      );
    },
    async write(state) {
      await storageArea.set({ [CONTAINER_STATE_STORAGE_KEY]: state });
    }
  });
}

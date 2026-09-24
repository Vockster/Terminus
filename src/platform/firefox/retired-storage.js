// Removes storage left behind by retired features. Nothing reads these entries,
// so failures are ignored and the cleanup simply repeats at the next start.

// Unloading is fixed to Middle Mouse, and Firefox Sync no longer has a product
// surface. The legacy settings-transfer journal is intentionally not here: it
// is recovered before this cleanup step and remains the restore crash guard.
export const RETIRED_LOCAL_STORAGE_KEYS = Object.freeze([
  "inputBindingsState",
  "configurationSyncState",
  "snapshotSyncState",
  "configurationSyncSafetyAcknowledgement",
  "terminusDeviceIdentity"
]);

// Custom fonts are no longer supported, so the uploaded-font database has no reader.
export const RETIRED_FONT_DATABASE_NAME = "sidebars-font-assets";

export function removeRetiredLocalStorage(browserApi) {
  return Promise.resolve()
    .then(() => browserApi.storage.local.remove([...RETIRED_LOCAL_STORAGE_KEYS]))
    .then(() => "removed", () => "failed");
}

// Resolves as soon as Firefox accepts, blocks, or refuses the request; a
// blocked deletion still completes once any other connection closes.
export function deleteRetiredFontDatabase(indexedDBFactory = globalThis.indexedDB) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDBFactory?.deleteDatabase?.(RETIRED_FONT_DATABASE_NAME);
    } catch {
      resolve("failed");
      return;
    }
    if (!request) {
      resolve("unavailable");
      return;
    }
    request.onsuccess = () => resolve("deleted");
    request.onerror = () => resolve("failed");
    request.onblocked = () => resolve("blocked");
  });
}

export function removeRetiredStorage({ browserApi, indexedDBFactory = globalThis.indexedDB }) {
  return Promise.all([
    removeRetiredLocalStorage(browserApi),
    deleteRetiredFontDatabase(indexedDBFactory)
  ]);
}

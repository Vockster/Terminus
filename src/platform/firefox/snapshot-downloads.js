import { SNAPSHOT_ERROR_CODES, SnapshotError } from "../../contracts/snapshots.js";

const DOWNLOADS_PERMISSION = Object.freeze({ permissions: ["downloads"] });

export function createFirefoxSnapshotDownloads(
  browserApi,
  { BlobType = globalThis.Blob, urlApi = globalThis.URL } = {}
) {
  const objectUrlsByDownloadId = new Map();
  const earlyTerminalDownloadIds = new Set();
  let completionListenerRegistered = false;
  let pendingDownloadCount = 0;

  function revokeDownloadUrl(downloadId) {
    const objectUrl = objectUrlsByDownloadId.get(downloadId);
    if (!objectUrl) {
      return;
    }
    objectUrlsByDownloadId.delete(downloadId);
    urlApi.revokeObjectURL(objectUrl);
  }

  function ensureCompletionListener() {
    if (completionListenerRegistered) {
      return;
    }
    browserApi.downloads.onChanged.addListener((change) => {
      if (
        Number.isInteger(change?.id) &&
        ["complete", "interrupted"].includes(change.state?.current)
      ) {
        if (objectUrlsByDownloadId.has(change.id)) {
          revokeDownloadUrl(change.id);
        } else if (pendingDownloadCount > 0) {
          // A small blob can finish before downloads.download() resolves with
          // its ID. Remember terminal IDs only while registration is pending.
          earlyTerminalDownloadIds.add(change.id);
        }
      }
    });
    completionListenerRegistered = true;
  }

  async function startDownload(objectUrl, options) {
    pendingDownloadCount += 1;
    try {
      const downloadId = await browserApi.downloads.download(options);
      objectUrlsByDownloadId.set(downloadId, objectUrl);
      if (earlyTerminalDownloadIds.delete(downloadId)) {
        revokeDownloadUrl(downloadId);
      }
      return downloadId;
    } catch (error) {
      urlApi.revokeObjectURL(objectUrl);
      throw error;
    } finally {
      pendingDownloadCount -= 1;
      if (pendingDownloadCount === 0) {
        earlyTerminalDownloadIds.clear();
      }
    }
  }

  return Object.freeze({
    hasPermission() {
      return browserApi.permissions.contains(DOWNLOADS_PERMISSION);
    },

    async downloadBytes({ bytes, mimeType, filename, saveAs = false, incognito = false }) {
      if (!(await browserApi.permissions.contains(DOWNLOADS_PERMISSION))) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.PERMISSION_REQUIRED);
      }
      ensureCompletionListener();
      const objectUrl = urlApi.createObjectURL(new BlobType([bytes], { type: mimeType }));
      return startDownload(objectUrl, {
        url: objectUrl,
        filename,
        conflictAction: "uniquify",
        saveAs,
        ...(incognito ? { incognito: true } : {})
      });
    },

    async downloadJson({ text, filename, saveAs = false, incognito = false }) {
      if (!(await browserApi.permissions.contains(DOWNLOADS_PERMISSION))) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.PERMISSION_REQUIRED);
      }
      ensureCompletionListener();
      const objectUrl = urlApi.createObjectURL(
        new BlobType([text], { type: "application/json" })
      );
      return startDownload(objectUrl, {
        url: objectUrl,
        filename,
        conflictAction: "uniquify",
        saveAs,
        ...(incognito ? { incognito: true } : {})
      });
    },

    async openFileLocation(downloadIds = []) {
      if (!(await browserApi.permissions.contains(DOWNLOADS_PERMISSION))) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.PERMISSION_REQUIRED);
      }
      for (const downloadId of downloadIds) {
        try {
          const matches = await browserApi.downloads.search({ id: downloadId });
          const item = matches.find(({ id }) => id === downloadId);
          if (
            item?.state === "complete" &&
            item.exists !== false &&
            await browserApi.downloads.show(downloadId)
          ) {
            return { opened: "snapshot-folder" };
          }
        } catch {
          // Try an older tracked snapshot file before falling back to Downloads.
        }
      }
      browserApi.downloads.showDefaultFolder();
      return { opened: "downloads-folder" };
    },

    async removeOwnedFile(downloadId) {
      if (!(await browserApi.permissions.contains(DOWNLOADS_PERMISSION))) {
        return { removed: false, reason: "permission-missing" };
      }
      const matches = await browserApi.downloads.search({ id: downloadId });
      if (!matches.some(({ id }) => id === downloadId)) {
        return { removed: false, reason: "missing" };
      }
      try {
        await browserApi.downloads.removeFile(downloadId);
        return { removed: true, reason: null };
      } catch {
        return { removed: false, reason: "remove-failed" };
      }
    }
  });
}

import { SETTINGS_MESSAGE_TYPES } from "../contracts/settings-messages.js";
import { SNAPSHOT_MESSAGE_TYPES } from "../contracts/snapshot-messages.js";
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_ERROR_MESSAGES
} from "../contracts/snapshots.js";
import {
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_ERROR_MESSAGES
} from "../contracts/settings-state.js";
import { WORKSPACE_MESSAGE_TYPES } from "../contracts/workspace-messages.js";
import {
  SIDEBAR_UNDO_MESSAGE_TYPES,
  parseSidebarUndoOutcome,
  parseSidebarUndoSummary
} from "../contracts/sidebar-undo.js";
import {
  MAX_WORKSPACE_PACKAGE_BYTES,
  WORKSPACE_PACKAGE_ERROR_CODES,
  WORKSPACE_PACKAGE_ERROR_MESSAGES,
  WORKSPACE_PACKAGE_MESSAGE_TYPES
} from "../contracts/workspace-package.js";
import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES
} from "../contracts/workspace-state.js";
import { PRIVATE_MESSAGE_TYPES } from "../contracts/private-messages.js";
import {
  FAVICON_ERROR_CODES,
  FAVICON_ERROR_MESSAGES,
  FAVICON_MESSAGE_TYPES
} from "../contracts/favicon-messages.js";
import { faviconHostPermissionPattern } from "../contracts/favicon-cache.js";
import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_ERROR_MESSAGES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_IMPORT_MESSAGE_TYPES
} from "../contracts/bookmark-import.js";
import { BOOKMARK_OPTIONAL_PERMISSIONS } from "../platform/firefox/bookmarks-browser.js";
import { CONTAINER_MESSAGE_TYPES } from "../contracts/container-messages.js";
import {
  CONTAINER_ERROR_CODES,
  CONTAINER_ERROR_MESSAGES
} from "../contracts/containers.js";
import { CONTAINER_OPTIONAL_PERMISSIONS } from "../platform/firefox/container-browser.js";

async function send(message, messages, internalCode) {
  let response;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch {
    response = undefined;
  }
  if (!response || response.ok !== true) {
    const code = messages[response?.error?.code] ? response.error.code : internalCode;
    const error = new Error(
      typeof response?.error?.message === "string" && response.error.message.length > 0
        ? response.error.message
        : messages[code]
    );
    error.code = code;
    if (response?.error?.details && typeof response.error.details === "object") {
      error.details = response.error.details;
    }
    throw error;
  }
  return response;
}

function sendSettings(message) {
  return send(message, SETTINGS_STATE_ERROR_MESSAGES, SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR);
}

function sendWorkspace(message) {
  return send(message, WORKSPACE_STATE_ERROR_MESSAGES, WORKSPACE_STATE_ERROR_CODES.INTERNAL_ERROR);
}

function sendSnapshot(message) {
  return send(message, SNAPSHOT_ERROR_MESSAGES, SNAPSHOT_ERROR_CODES.INTERNAL_ERROR);
}

function sendPrivate(message) {
  return send(message, SNAPSHOT_ERROR_MESSAGES, SNAPSHOT_ERROR_CODES.INTERNAL_ERROR);
}

function sendFavicon(message) {
  return send(message, FAVICON_ERROR_MESSAGES, FAVICON_ERROR_CODES.INTERNAL_ERROR);
}

function sendContainer(message) {
  return send(message, CONTAINER_ERROR_MESSAGES, CONTAINER_ERROR_CODES.INTERNAL_ERROR);
}

function sendWorkspacePackage(message) {
  return send(
    message,
    WORKSPACE_PACKAGE_ERROR_MESSAGES,
    WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR
  );
}

function sendBookmarkImport(message) {
  return send(
    message,
    BOOKMARK_IMPORT_ERROR_MESSAGES,
    BOOKMARK_IMPORT_ERROR_CODES.INTERNAL_ERROR
  );
}

export const settingsClient = Object.freeze({
  async get() {
    return (await sendSettings({ type: SETTINGS_MESSAGE_TYPES.GET })).settings;
  },
  async update(patch) {
    return (await sendSettings({ type: SETTINGS_MESSAGE_TYPES.UPDATE, patch })).settings;
  },
  async resetSection(section) {
    return (await sendSettings({ type: SETTINGS_MESSAGE_TYPES.RESET_SECTION, section })).settings;
  },
  async reset() {
    return (await sendSettings({ type: SETTINGS_MESSAGE_TYPES.RESET })).settings;
  }
});

export const storageClient = Object.freeze({
  async overview() {
    return (await sendFavicon({ type: FAVICON_MESSAGE_TYPES.OVERVIEW })).result;
  },
  async list(cursor = null) {
    return (await sendFavicon({ type: FAVICON_MESSAGE_TYPES.LIST, cursor })).result;
  },
  async clearAll() {
    return (await sendFavicon({ type: FAVICON_MESSAGE_TYPES.CLEAR_ALL })).result;
  },
  async clearOne(origin) {
    return (await sendFavicon({ type: FAVICON_MESSAGE_TYPES.CLEAR_ONE, origin })).result;
  },
  async removeUnused() {
    return (await sendFavicon({ type: FAVICON_MESSAGE_TYPES.REMOVE_UNUSED })).result;
  },
  requestHostAccess(origin) {
    const pattern = faviconHostPermissionPattern(origin);
    if (!pattern) return Promise.resolve(false);
    return browser.permissions.request({ origins: [pattern] });
  },
  async confirmHostAccess(origin) {
    return (await sendFavicon({ type: FAVICON_MESSAGE_TYPES.ACCESS_GRANTED, origin })).result;
  }
});

export const containerClient = Object.freeze({
  async overview() {
    return (await sendContainer({ type: CONTAINER_MESSAGE_TYPES.OVERVIEW })).result;
  },
  async enable() {
    const granted = await browser.permissions.request({
      permissions: [...CONTAINER_OPTIONAL_PERMISSIONS]
    });
    if (!granted) {
      const error = new Error(CONTAINER_ERROR_MESSAGES[CONTAINER_ERROR_CODES.PERMISSION_DENIED]);
      error.code = CONTAINER_ERROR_CODES.PERMISSION_DENIED;
      throw error;
    }
    return (await sendContainer({ type: CONTAINER_MESSAGE_TYPES.ENABLE })).result;
  },
  async create(descriptor) {
    return (await sendContainer({ type: CONTAINER_MESSAGE_TYPES.CREATE, descriptor })).result;
  },
  async recreate(refId, descriptor) {
    return (await sendContainer({
      type: CONTAINER_MESSAGE_TYPES.RECREATE,
      refId,
      descriptor
    })).result;
  },
  async setWorkspaceDefault(workspaceId, refId) {
    return (await sendContainer({
      type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULT,
      workspaceId,
      refId
    })).result;
  },
  async setWorkspaceDefaults(workspaceIds, refId) {
    return (await sendContainer({
      type: CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS,
      workspaceIds: [...workspaceIds],
      refId
    })).result;
  }
});

export const workspaceClient = Object.freeze({
  async get() {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.GET_STATE })).state;
  },
  async create(workspace) {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.CREATE, workspace })).state;
  },
  async update(workspaceId, changes) {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.UPDATE, workspaceId, changes })).state;
  },
  // One call for the whole selection, so it is one Undo entry in this
  // window's slot. The answer carries that entry's summary.
  async removeWorkspaces(workspaceIds, decorations) {
    const currentWindow = await browser.windows.getCurrent();
    const response = await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.REMOVE_MANY,
      windowId: currentWindow.id,
      workspaceIds,
      decorations
    });
    return { state: response.state, undo: parseSidebarUndoSummary(response.undo) };
  },
  async undoRemoval(undoId) {
    const currentWindow = await browser.windows.getCurrent();
    const response = await sendWorkspace({
      type: SIDEBAR_UNDO_MESSAGE_TYPES.EXECUTE,
      windowId: currentWindow.id,
      undoId
    });
    return parseSidebarUndoOutcome(response.outcome);
  },
  async move(entry, direction) {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.MOVE_RAIL_ENTRY, entry, direction })).state;
  },
  async place(entry, target, position) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRY,
      entry,
      target,
      position
    })).state;
  },
  async addDivider() {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.ADD_DIVIDER })).state;
  },
  async resizeDivider(dividerId, size) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.RESIZE_DIVIDER,
      dividerId,
      size
    })).state;
  },
  async removeDivider(dividerId) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.REMOVE_DIVIDER,
      dividerId
    })).state;
  },
  async addSpace() {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.ADD_SPACE })).state;
  },
  async removeSpace(spaceId) {
    return (await sendWorkspace({ type: WORKSPACE_MESSAGE_TYPES.REMOVE_SPACE, spaceId })).state;
  },
  async updateMany(workspaceIds, changes) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.UPDATE_MANY,
      workspaceIds,
      changes
    })).state;
  },
  async placeMany(entries, target, position) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.PLACE_RAIL_ENTRIES,
      entries,
      target,
      position
    })).state;
  },
  async insertMany(insertions) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.INSERT_RAIL_ENTRIES,
      insertions
    })).state;
  },
  async removeMany(entries) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.REMOVE_RAIL_ENTRIES,
      entries
    })).state;
  },
  async duplicateMany(workspaceIds, target, position) {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.DUPLICATE_WORKSPACES,
      workspaceIds,
      target,
      position
    })).state;
  },
  async ensureSettingsCompanion() {
    return (await sendWorkspace({
      type: WORKSPACE_MESSAGE_TYPES.ENSURE_SETTINGS_COMPANION
    })).companionCreated;
  }
});

export const snapshotClient = Object.freeze({
  async overview() {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.OVERVIEW })).result;
  },
  async previewCleanup(snapshots) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots })).result;
  },
  async get(id) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.GET, id })).result;
  },
  async create() {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.CREATE })).result;
  },
  async testAutomatic() {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.TEST_AUTOMATIC })).result;
  },
  async saveSettings() {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.SAVE_SETTINGS })).result;
  },
  async getSettings(id) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.GET_SETTINGS, id })).result;
  },
  async importSettings(text) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.IMPORT_SETTINGS, text })).result;
  },
  async exportSettings(id) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.EXPORT_SETTINGS, id })).result;
  },
  async deleteSettings(id) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.DELETE_SETTINGS, id })).result;
  },
  async export(id) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.EXPORT, id })).result;
  },
  async openFileLocation(kind) {
    return (await sendSnapshot({
      type: SNAPSHOT_MESSAGE_TYPES.OPEN_FILE_LOCATION,
      kind
    })).result;
  },
  async delete(id) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.DELETE, id })).result;
  },
  async clearViewer() {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.CLEAR_VIEWER })).result;
  },
  async preview(text) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.PREVIEW, text })).result;
  },
  async containerPreflight(source, request) {
    return (await sendSnapshot({
      type: SNAPSHOT_MESSAGE_TYPES.CONTAINER_PREFLIGHT,
      source,
      request
    })).result;
  },
  async import(text) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.IMPORT, text })).result;
  },
  async restore(source, request) {
    return (await sendSnapshot({ type: SNAPSHOT_MESSAGE_TYPES.RESTORE, source, request })).result;
  },
  async restoreSettings(text, sections) {
    return (await sendSnapshot({
      type: SNAPSHOT_MESSAGE_TYPES.RESTORE_SETTINGS,
      text,
      sections
    })).result;
  },
  async restoreStoredSettings(id, sections) {
    return (await sendSnapshot({
      type: SNAPSHOT_MESSAGE_TYPES.RESTORE_STORED_SETTINGS,
      id,
      sections
    })).result;
  },
  requestDownloadsPermission() {
    return browser.permissions.request({ permissions: ["downloads"] });
  }
});

export const privateClient = Object.freeze({
  async overview() {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.OVERVIEW })).result;
  },
  async setPersistence(enabled) {
    return (await sendPrivate({
      type: PRIVATE_MESSAGE_TYPES.SET_PERSISTENCE,
      enabled
    })).result;
  },
  async setAutomaticSnapshots(enabled) {
    return (await sendPrivate({
      type: PRIVATE_MESSAGE_TYPES.SET_AUTOMATIC_SNAPSHOTS,
      enabled
    })).result;
  },
  async create() {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.CREATE })).result;
  },
  async testAutomatic() {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.TEST_AUTOMATIC })).result;
  },
  async get(id) {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.GET, id })).result;
  },
  async delete(id) {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.DELETE, id })).result;
  },
  async clearViewer() {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.CLEAR_VIEWER })).result;
  },
  async clearRecovery() {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.CLEAR_RECOVERY })).result;
  },
  async export(id) {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.EXPORT_STORED, id })).result;
  },
  async preview(text) {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.PREVIEW, text })).result;
  },
  async previewCleanup(snapshots) {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP, snapshots })).result;
  },
  async import(text) {
    return (await sendPrivate({ type: PRIVATE_MESSAGE_TYPES.IMPORT, text })).result;
  },
  async restore(source, request) {
    return (await sendPrivate({
      type: PRIVATE_MESSAGE_TYPES.RESTORE_VIEWER,
      source,
      request
    })).result;
  },
  requestDownloadsPermission() {
    return browser.permissions.request({ permissions: ["downloads"] });
  }
});

export const workspacePackageClient = Object.freeze({
  async exportSetup() {
    return (await sendWorkspacePackage({
      type: WORKSPACE_PACKAGE_MESSAGE_TYPES.EXPORT
    })).result;
  },
  async readFile(file) {
    // Refused before the file is read, so an oversized file never reaches this
    // page's memory or a message to the background.
    if (file.size > MAX_WORKSPACE_PACKAGE_BYTES) {
      const error = new Error(
        WORKSPACE_PACKAGE_ERROR_MESSAGES[WORKSPACE_PACKAGE_ERROR_CODES.FILE_TOO_LARGE]
      );
      error.code = WORKSPACE_PACKAGE_ERROR_CODES.FILE_TOO_LARGE;
      throw error;
    }
    // Raw bytes, because the file is usually a zip; the background tells a
    // zip from an older JSON package by its contents.
    return (await sendWorkspacePackage({
      type: WORKSPACE_PACKAGE_MESSAGE_TYPES.READ_FILE,
      bytes: new Uint8Array(await file.arrayBuffer())
    })).result;
  },
  async importSetup(workspacePackage, mode) {
    return (await sendWorkspacePackage({
      type: WORKSPACE_PACKAGE_MESSAGE_TYPES.IMPORT,
      package: workspacePackage,
      mode
    })).result;
  },
  requestDownloadsPermission() {
    return browser.permissions.request({ permissions: ["downloads"] });
  }
});

export const bookmarkImportClient = Object.freeze({
  requestPermission() {
    return browser.permissions.request({ permissions: BOOKMARK_OPTIONAL_PERMISSIONS });
  },
  async readFirefox() {
    return (await sendBookmarkImport({
      type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FIREFOX
    })).result;
  },
  async readFile(file) {
    // Refused before the file is read, so an oversized export never becomes a
    // string in this page or a message to the background.
    if (file.size > BOOKMARK_IMPORT_LIMITS.maxFileUnits) {
      const error = new Error(
        BOOKMARK_IMPORT_ERROR_MESSAGES[BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE]
      );
      error.code = BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE;
      throw error;
    }
    return (await sendBookmarkImport({
      type: BOOKMARK_IMPORT_MESSAGE_TYPES.READ_FILE,
      name: file.name,
      text: await file.text()
    })).result;
  },
  async create(source, tickedBookmarkIds) {
    return (await sendBookmarkImport({
      type: BOOKMARK_IMPORT_MESSAGE_TYPES.CREATE,
      source,
      tickedBookmarkIds
    })).result;
  },
  subscribeProgress(listener) {
    const handler = (message) => {
      if (message?.type === BOOKMARK_IMPORT_MESSAGE_TYPES.PROGRESS) {
        listener({ importId: message.importId, created: message.created, total: message.total });
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }
});

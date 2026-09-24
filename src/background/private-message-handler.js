import {
  PRIVATE_MESSAGE_TYPES,
  privateFailure,
  privateSuccess
} from "../contracts/private-messages.js";
import { SNAPSHOT_ERROR_CODES, SnapshotError } from "../contracts/snapshots.js";
import { cleanupPreviewSettings } from "../contracts/snapshot-messages.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidRequest() {
  return Promise.resolve(privateFailure(new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST)));
}

export function createPrivateMessageHandler({
  service,
  browserApi,
  scheduleService = null,
  settingsService = null,
  settingsUrl = browserApi.runtime.getURL("src/settings/index.html")
}) {
  function verifiedPrivateSettingsSender(sender) {
    return sender?.tab?.incognito === true && sender?.tab?.url === settingsUrl;
  }

  async function overview(sender) {
    const privateAccessAllowed = await browserApi.extension.isAllowedIncognitoAccess();
    return service.overview({
      privateAccessAllowed,
      privateContext: verifiedPrivateSettingsSender(sender)
    });
  }

  return function handlePrivateMessage(message, sender) {
    if (!isRecord(message)) {
      return undefined;
    }
    const respond = (operation) => Promise.resolve(operation).then(privateSuccess, privateFailure);
    if (message.type === PRIVATE_MESSAGE_TYPES.OVERVIEW) {
      return hasExactKeys(message, ["type"]) ? respond(overview(sender)) : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.SET_PERSISTENCE) {
      if (!hasExactKeys(message, ["type", "enabled"]) || typeof message.enabled !== "boolean") {
        return invalidRequest();
      }
      return respond(service.setPersistence(
        message.enabled,
        verifiedPrivateSettingsSender(sender) ? sender.tab.windowId : null
      ));
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.SET_AUTOMATIC_SNAPSHOTS) {
      if (!hasExactKeys(message, ["type", "enabled"]) || typeof message.enabled !== "boolean") {
        return invalidRequest();
      }
      return respond(service.setAutomaticSnapshots(message.enabled));
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.CLEAR_RECOVERY) {
      return hasExactKeys(message, ["type"]) ? respond(service.clearRecovery()) : invalidRequest();
    }
    // Answered for any sender; the service withholds the count unless the
    // sender is Settings in a private window.
    if (message.type === PRIVATE_MESSAGE_TYPES.PREVIEW_CLEANUP) {
      return hasExactKeys(message, ["type", "snapshots"]) && settingsService
        ? respond(
            settingsService.getOrInitialize().then((settings) =>
              service.previewCleanup(cleanupPreviewSettings(settings, message.snapshots), {
                privateContext: verifiedPrivateSettingsSender(sender)
              })
            )
          )
        : invalidRequest();
    }
    if (!verifiedPrivateSettingsSender(sender)) {
      if (Object.values(PRIVATE_MESSAGE_TYPES).includes(message.type)) {
        return invalidRequest();
      }
      return undefined;
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.CREATE) {
      return hasExactKeys(message, ["type"])
        ? respond(service.createStored(sender.tab.windowId))
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.TEST_AUTOMATIC) {
      return hasExactKeys(message, ["type"]) && scheduleService
        ? respond(scheduleService.schedulePrivateAutomaticTest())
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.GET) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(service.getStored(message.id))
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.DELETE) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(service.deleteStored(message.id))
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.CLEAR_VIEWER) {
      return hasExactKeys(message, ["type"])
        ? respond(service.clearStored())
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.EXPORT_STORED) {
      return hasExactKeys(message, ["type", "id"]) && typeof message.id === "string"
        ? respond(service.exportStored(message.id))
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.PREVIEW) {
      return hasExactKeys(message, ["type", "text"]) && typeof message.text === "string"
        ? respond(service.previewText(message.text))
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.IMPORT) {
      return hasExactKeys(message, ["type", "text"]) && typeof message.text === "string"
        ? respond(service.importSnapshotText(message.text))
        : invalidRequest();
    }
    if (message.type === PRIVATE_MESSAGE_TYPES.RESTORE_VIEWER) {
      if (
        !hasExactKeys(message, ["type", "source", "request"]) ||
        !isRecord(message.source) ||
        !isRecord(message.request)
      ) {
        return invalidRequest();
      }
      const validSource =
        (hasExactKeys(message.source, ["id"]) && typeof message.source.id === "string") ||
        (hasExactKeys(message.source, ["text"]) && typeof message.source.text === "string");
      return validSource
        ? respond(service.restoreViewer({
            source: message.source,
            request: message.request,
            windowId: sender.tab.windowId
          }))
        : invalidRequest();
    }
    return undefined;
  };
}

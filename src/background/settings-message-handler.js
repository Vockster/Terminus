import {
  SETTINGS_MESSAGE_TYPES,
  settingsStateFailure,
  settingsStateSuccess
} from "../contracts/settings-messages.js";
import {
  SETTINGS_STATE_ERROR_CODES,
  SettingsStateError
} from "../contracts/settings-state.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function invalidRequest() {
  return Promise.resolve(
    settingsStateFailure(new SettingsStateError(SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST))
  );
}

export function createSettingsMessageHandler(
  settingsStateService,
  { resetWithSafety = null, beforeReset = null } = {}
) {
  return function handleSettingsMessage(message, sender) {
    if (!isRecord(message)) {
      return undefined;
    }

    if (message.type === SETTINGS_MESSAGE_TYPES.GET) {
      if (!hasExactKeys(message, ["type"])) {
        return invalidRequest();
      }
      return settingsStateService
        .getOrInitialize()
        .then(settingsStateSuccess, settingsStateFailure);
    }
    if (message.type === SETTINGS_MESSAGE_TYPES.UPDATE) {
      if (!hasExactKeys(message, ["type", "patch"])) {
        return invalidRequest();
      }
      return settingsStateService.update(message.patch).then(settingsStateSuccess, settingsStateFailure);
    }
    if (message.type === SETTINGS_MESSAGE_TYPES.RESET_SECTION) {
      if (!hasExactKeys(message, ["type", "section"])) {
        return invalidRequest();
      }
      return settingsStateService
        .resetSection(message.section)
        .then(settingsStateSuccess, settingsStateFailure);
    }
    if (message.type === SETTINGS_MESSAGE_TYPES.RESET) {
      if (!hasExactKeys(message, ["type"])) {
        return invalidRequest();
      }
      if (typeof resetWithSafety === "function" && !Number.isInteger(sender?.tab?.windowId)) {
        return invalidRequest();
      }
      // beforeReset clears device-local state that a reset must relock. It
      // runs first so its failure leaves every setting untouched.
      return Promise.resolve()
        .then(() => (typeof beforeReset === "function" ? beforeReset() : undefined))
        .then(() => (typeof resetWithSafety === "function"
          ? resetWithSafety(sender.tab.windowId)
          : settingsStateService.reset()))
        .then(settingsStateSuccess, settingsStateFailure);
    }
    return undefined;
  };
}

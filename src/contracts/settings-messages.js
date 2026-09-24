import {
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_ERROR_MESSAGES,
  SettingsStateError
} from "./settings-state.js";

export const SETTINGS_MESSAGE_TYPES = Object.freeze({
  GET: "settings.get",
  UPDATE: "settings.update",
  RESET_SECTION: "settings.resetSection",
  RESET: "settings.reset"
});

export function settingsStateSuccess(settings) {
  return { ok: true, settings };
}

export function settingsStateFailure(error) {
  const code =
    error instanceof SettingsStateError && SETTINGS_STATE_ERROR_MESSAGES[error.code]
      ? error.code
      : SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR;

  return {
    ok: false,
    error: {
      code,
      message: SETTINGS_STATE_ERROR_MESSAGES[code]
    }
  };
}

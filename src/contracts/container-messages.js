import {
  CONTAINER_ERROR_CODES,
  CONTAINER_ERROR_MESSAGES,
  ContainerError
} from "./containers.js";

export const CONTAINER_MESSAGE_TYPES = Object.freeze({
  OVERVIEW: "container.overview",
  ENABLE: "container.enable",
  REFRESH: "container.refresh",
  CHANGED: "container.changed",
  CREATE: "container.create",
  RECREATE: "container.recreate",
  SET_WORKSPACE_DEFAULT: "container.workspace.setDefault",
  SET_WORKSPACE_DEFAULTS: "container.workspace.setDefaults",
  CREATE_WORKSPACE_TAB: "container.workspace.createTab",
  COPY_TAB: "container.tab.copy"
});

export function containerSuccess(result) {
  return { ok: true, result };
}

export function containerFailure(error) {
  const code =
    error instanceof ContainerError && CONTAINER_ERROR_MESSAGES[error.code]
      ? error.code
      : CONTAINER_ERROR_CODES.INTERNAL_ERROR;
  return { ok: false, error: { code, message: CONTAINER_ERROR_MESSAGES[code] } };
}

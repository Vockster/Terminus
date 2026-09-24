export const WORKSPACE_SCOPES = Object.freeze({
  NORMAL: "normal",
  PRIVATE: "private"
});

export function parseWorkspaceScope(value) {
  if (!Object.values(WORKSPACE_SCOPES).includes(value)) {
    throw new TypeError("The workspace scope is invalid.");
  }
  return value;
}

export function workspaceScopeFromIncognito(incognito) {
  if (typeof incognito !== "boolean") {
    return null;
  }
  return incognito ? WORKSPACE_SCOPES.PRIVATE : WORKSPACE_SCOPES.NORMAL;
}

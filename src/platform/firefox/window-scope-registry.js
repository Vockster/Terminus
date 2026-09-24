import {
  parseWorkspaceScope,
  workspaceScopeFromIncognito
} from "../../contracts/workspace-scope.js";

export function createFirefoxWindowScopeRegistry(browserApi) {
  const scopeByWindowId = new Map();
  let started = false;

  function observeWindow(window) {
    if (!Number.isInteger(window?.id)) {
      return null;
    }
    const scope = workspaceScopeFromIncognito(window.incognito);
    if (!scope) {
      return null;
    }
    scopeByWindowId.set(window.id, scope);
    return scope;
  }

  function scopeForWindow(windowId, incognitoHint) {
    const hintedScope = workspaceScopeFromIncognito(incognitoHint);
    if (hintedScope && Number.isInteger(windowId)) {
      scopeByWindowId.set(windowId, hintedScope);
      return hintedScope;
    }
    return scopeByWindowId.get(windowId) ?? null;
  }

  async function resolveScope(windowId) {
    if (!Number.isInteger(windowId)) {
      return null;
    }
    try {
      return observeWindow(await browserApi.windows.get(windowId));
    } catch {
      return null;
    }
  }

  async function initialize() {
    const windows = await browserApi.windows.getAll({ windowTypes: ["normal"] });
    for (const window of windows) {
      observeWindow(window);
    }
    return new Map(scopeByWindowId);
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    browserApi.windows?.onCreated?.addListener(observeWindow);
    browserApi.windows?.onRemoved?.addListener((windowId) => {
      queueMicrotask(() => scopeByWindowId.delete(windowId));
    });
  }

  function matches(scope, windowId, incognitoHint) {
    return scopeForWindow(windowId, incognitoHint) === parseWorkspaceScope(scope);
  }

  async function resolveMatches(scope, windowId) {
    return (await resolveScope(windowId)) === parseWorkspaceScope(scope);
  }

  return Object.freeze({
    initialize,
    matches,
    observeWindow,
    resolveMatches,
    resolveScope,
    scopeForWindow,
    start
  });
}

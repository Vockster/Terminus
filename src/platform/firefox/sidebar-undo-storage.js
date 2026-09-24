import {
  SIDEBAR_UNDO_STORAGE_KEYS,
  createEmptySidebarUndoDocument,
  parseSidebarUndoDocument
} from "../../contracts/sidebar-undo.js";
import { parseWorkspaceScope } from "../../contracts/workspace-scope.js";

export function createFirefoxSidebarUndoStorage(browserApi) {
  const session = browserApi?.storage?.session;
  if (!session) {
    throw new TypeError("Firefox session storage is required for sidebar Undo.");
  }
  const lastSequence = new Map();

  return Object.freeze({
    async read(scope) {
      const parsedScope = parseWorkspaceScope(scope);
      const key = SIDEBAR_UNDO_STORAGE_KEYS[parsedScope];
      const result = await session.get(key);
      const document = result?.[key] === undefined
        ? createEmptySidebarUndoDocument()
        : parseSidebarUndoDocument(result[key], parsedScope);
      lastSequence.set(parsedScope, Math.max(lastSequence.get(parsedScope) ?? 0, document.sequence));
      return document;
    },

    async write(scope, rawDocument) {
      const parsedScope = parseWorkspaceScope(scope);
      const document = parseSidebarUndoDocument(rawDocument, parsedScope);
      if (document.sequence < (lastSequence.get(parsedScope) ?? 0)) {
        return false;
      }
      await session.set({ [SIDEBAR_UNDO_STORAGE_KEYS[parsedScope]]: document });
      lastSequence.set(parsedScope, document.sequence);
      return true;
    },

    async clear(scope) {
      const parsedScope = parseWorkspaceScope(scope);
      await session.remove(SIDEBAR_UNDO_STORAGE_KEYS[parsedScope]);
      lastSequence.delete(parsedScope);
    }
  });
}

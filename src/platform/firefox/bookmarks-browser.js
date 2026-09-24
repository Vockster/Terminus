import {
  BOOKMARK_FOLDER_ROLES,
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_NODE_TYPES,
  BOOKMARK_SOURCE_KINDS,
  BookmarkImportError
} from "../../contracts/bookmark-import.js";

export const BOOKMARK_OPTIONAL_PERMISSIONS = Object.freeze(["bookmarks"]);

// Terminus reads bookmarks and never writes them. This adapter therefore
// references `getTree` only; a source test asserts that no mutating bookmarks
// method appears anywhere under `src/`.
const FIREFOX_ROOT_ROLES = Object.freeze({
  root________: BOOKMARK_FOLDER_ROLES.ROOT,
  menu________: BOOKMARK_FOLDER_ROLES.MENU,
  toolbar_____: BOOKMARK_FOLDER_ROLES.TOOLBAR,
  unfiled_____: BOOKMARK_FOLDER_ROLES.UNFILED,
  mobile______: BOOKMARK_FOLDER_ROLES.MOBILE
});

function permissionRequired() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.PERMISSION_REQUIRED);
}

function sourceTooLarge() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE);
}

function nodeId(value) {
  const id = typeof value === "string" ? value : "";
  return `firefox:${id}`.slice(0, BOOKMARK_IMPORT_LIMITS.maxNodeIdLength);
}

function nodeTitle(value) {
  return typeof value?.title === "string" ? value.title : "";
}

function nodeDateAdded(value) {
  return Number.isInteger(value?.dateAdded) && value.dateAdded >= 0 ? value.dateAdded : null;
}

// `type` is optional on older profiles, so a node with a URL is a bookmark and
// everything else with children is a folder.
function nodeType(value) {
  if (value?.type === BOOKMARK_NODE_TYPES.SEPARATOR) return BOOKMARK_NODE_TYPES.SEPARATOR;
  if (value?.type === BOOKMARK_NODE_TYPES.BOOKMARK) return BOOKMARK_NODE_TYPES.BOOKMARK;
  if (value?.type === BOOKMARK_NODE_TYPES.FOLDER) return BOOKMARK_NODE_TYPES.FOLDER;
  return typeof value?.url === "string" ? BOOKMARK_NODE_TYPES.BOOKMARK : BOOKMARK_NODE_TYPES.FOLDER;
}

function orderedChildren(value) {
  const children = Array.isArray(value?.children) ? [...value.children] : [];
  return children.every((child) => Number.isInteger(child?.index))
    ? children.sort((left, right) => left.index - right.index)
    : children;
}

export function convertFirefoxBookmarkTree(rootNode) {
  const counter = { nodes: 0 };
  const convert = (value, depth) => {
    counter.nodes += 1;
    if (counter.nodes > BOOKMARK_IMPORT_LIMITS.maxNodes) throw sourceTooLarge();
    const type = nodeType(value);
    if (type === BOOKMARK_NODE_TYPES.SEPARATOR) {
      return { type, id: nodeId(value?.id) };
    }
    if (type === BOOKMARK_NODE_TYPES.BOOKMARK) {
      return {
        type,
        id: nodeId(value?.id),
        title: nodeTitle(value),
        url: typeof value?.url === "string" ? value.url : "",
        dateAdded: nodeDateAdded(value)
      };
    }
    if (depth > BOOKMARK_IMPORT_LIMITS.maxFolderDepth) throw sourceTooLarge();
    return {
      type,
      id: nodeId(value?.id),
      title: nodeTitle(value),
      role: FIREFOX_ROOT_ROLES[value?.id] ?? null,
      dateAdded: nodeDateAdded(value),
      children: orderedChildren(value).map((child) => convert(child, depth + 1))
    };
  };
  const root = convert(rootNode, 0);
  if (root.type !== BOOKMARK_NODE_TYPES.FOLDER) throw permissionRequired();
  return root;
}

export function createFirefoxBookmarksBrowser(browserApi = globalThis.browser) {
  return {
    async readTree() {
      let granted = false;
      try {
        granted = await browserApi.permissions.contains({
          permissions: BOOKMARK_OPTIONAL_PERMISSIONS
        });
      } catch {
        granted = false;
      }
      if (granted !== true || !browserApi.bookmarks?.getTree) throw permissionRequired();
      let tree;
      try {
        tree = await browserApi.bookmarks.getTree();
      } catch (error) {
        // A revoked permission and a missing API are the same story to the
        // user: Terminus cannot read bookmarks right now.
        if (error instanceof BookmarkImportError) throw error;
        throw permissionRequired();
      }
      const [rootNode] = Array.isArray(tree) ? tree : [];
      if (!rootNode) throw permissionRequired();
      return {
        kind: BOOKMARK_SOURCE_KINDS.FIREFOX,
        name: "Firefox bookmarks",
        root: convertFirefoxBookmarkTree(rootNode)
      };
    }
  };
}

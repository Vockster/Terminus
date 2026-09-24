import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_NODE_TYPES,
  BookmarkImportError,
  bookmarkImportWarning,
  clipBookmarkGroupTitle,
  clipBookmarkTabTitle
} from "../contracts/bookmark-import.js";

// The readers keep both sources lossless, so every skip, grouping, dedupe, and
// warning decision lives here and is tested against source-independent trees.
export const BOOKMARK_IMPORT_ENTRY_KINDS = Object.freeze({
  TAB: "tab",
  GROUP: "group"
});

function invalidRequest() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
}

// Firefox extensions can open ordinary web pages only. `javascript:`, `place:`,
// `about:`, `file:`, `data:`, and `ftp:` bookmarks stay visible in the preview
// but are never opened, so they are reported as skipped instead of failing.
export function isImportableBookmarkUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function importableKey(url) {
  return new URL(url).href;
}

export function countImportableBeneath(folder) {
  let total = 0;
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type === BOOKMARK_NODE_TYPES.FOLDER) visit(child);
      else if (child.type === BOOKMARK_NODE_TYPES.BOOKMARK && isImportableBookmarkUrl(child.url)) {
        total += 1;
      }
    }
  };
  visit(folder);
  return total;
}

export function indexBookmarkSource(source) {
  const nodeById = new Map();
  const parentById = new Map();
  const visit = (node, parentId) => {
    nodeById.set(node.id, node);
    parentById.set(node.id, parentId);
    if (node.type === BOOKMARK_NODE_TYPES.FOLDER) {
      for (const child of node.children) visit(child, node.id);
    }
  };
  visit(source.root, null);
  return { nodeById, parentById };
}

function folderChain(id, parentById) {
  const chain = [];
  for (let current = parentById.get(id) ?? null; current !== null; current = parentById.get(current) ?? null) {
    chain.unshift(current);
  }
  return chain;
}

// The start folder is the smallest folder containing every ticked bookmark, so
// a pick inside one folder groups by its subfolders and a pick spanning two
// source roots turns those roots into groups.
function startFolderId(tickedIds, parentById, rootId) {
  if (tickedIds.length === 0) return rootId;
  let common = folderChain(tickedIds[0], parentById);
  for (const id of tickedIds.slice(1)) {
    const chain = folderChain(id, parentById);
    let shared = 0;
    while (shared < common.length && shared < chain.length && common[shared] === chain[shared]) {
      shared += 1;
    }
    common = common.slice(0, shared);
  }
  return common.length > 0 ? common[common.length - 1] : rootId;
}

function tickedBookmarksBeneath(folder, ticked) {
  const found = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type === BOOKMARK_NODE_TYPES.FOLDER) visit(child);
      else if (child.type === BOOKMARK_NODE_TYPES.BOOKMARK && ticked.has(child.id)) {
        found.push(child);
      }
    }
  };
  visit(folder);
  return found;
}

// The preview recomputes totals on every tick, so it passes the index it built
// once for the source instead of rebuilding it per keystroke.
export function mapBookmarkImport(source, tickedBookmarkIds, index = indexBookmarkSource(source)) {
  if (!Array.isArray(tickedBookmarkIds)) throw invalidRequest();
  const { nodeById, parentById } = index;
  const ticked = new Set();
  for (const id of tickedBookmarkIds) {
    const node = nodeById.get(id);
    if (typeof id !== "string" || node?.type !== BOOKMARK_NODE_TYPES.BOOKMARK) {
      throw invalidRequest();
    }
    ticked.add(id);
  }
  const startId = startFolderId([...ticked], parentById, source.root.id);
  const startFolder = nodeById.get(startId) ?? source.root;

  const counts = { ticked: ticked.size, create: 0, unsupported: 0, duplicate: 0 };
  const seenUrls = new Set();
  const entries = [];

  const tabEntry = (bookmark) => {
    if (!isImportableBookmarkUrl(bookmark.url)) {
      counts.unsupported += 1;
      return null;
    }
    const key = importableKey(bookmark.url);
    if (seenUrls.has(key)) {
      counts.duplicate += 1;
      return null;
    }
    seenUrls.add(key);
    counts.create += 1;
    return { url: bookmark.url, title: clipBookmarkTabTitle(bookmark.title, key) };
  };

  for (const child of startFolder.children) {
    if (child.type === BOOKMARK_NODE_TYPES.SEPARATOR) continue;
    if (child.type === BOOKMARK_NODE_TYPES.BOOKMARK) {
      if (!ticked.has(child.id)) continue;
      const tab = tabEntry(child);
      if (tab) entries.push({ kind: BOOKMARK_IMPORT_ENTRY_KINDS.TAB, ...tab });
      continue;
    }
    const tabs = tickedBookmarksBeneath(child, ticked)
      .map(tabEntry)
      .filter((tab) => tab !== null);
    if (tabs.length > 0) {
      entries.push({
        kind: BOOKMARK_IMPORT_ENTRY_KINDS.GROUP,
        title: clipBookmarkGroupTitle(child.title),
        tabs
      });
    }
  }

  return {
    startFolderId: startFolder.id,
    entries,
    counts,
    warning: bookmarkImportWarning(counts.create)
  };
}

export function bookmarkImportTabDescriptors(mapping) {
  return mapping.entries.flatMap((entry, index) =>
    entry.kind === BOOKMARK_IMPORT_ENTRY_KINDS.TAB
      ? [{ url: entry.url, title: entry.title, entryIndex: index }]
      : entry.tabs.map((tab) => ({ url: tab.url, title: tab.title, entryIndex: index }))
  );
}

import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_NODE_TYPES,
  BOOKMARK_FOLDER_ROLES,
  BOOKMARK_SOURCE_KINDS,
  BookmarkImportError
} from "../contracts/bookmark-import.js";

// Chromium, Safari, and Firefox all export the Netscape bookmark file, so one
// tokenizer serves every file source. It is deliberately DOM-free: the
// background has no document, and untrusted markup must never be parsed into
// one. Nothing here decides what is importable; it only reproduces the file.
const DOCTYPE_PATTERN = /^<!DOCTYPE\s+NETSCAPE-Bookmark-file-1\s*>/i;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: "\u00a0"
});

function notBookmarksFile() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.NOT_BOOKMARKS_FILE);
}

function sourceTooLarge() {
  return new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.SOURCE_TOO_LARGE);
}

function decodeCharacterReference(body) {
  if (body.startsWith("#")) {
    const hexadecimal = body[1] === "x" || body[1] === "X";
    const digits = hexadecimal ? body.slice(2) : body.slice(1);
    if (!(hexadecimal ? /^[0-9a-f]+$/i : /^[0-9]+$/).test(digits)) return null;
    const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
    // Lone surrogates and out-of-range code points are not characters, so the
    // reference stays literal rather than becoming a replacement character.
    if (!Number.isInteger(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return null;
    }
    return String.fromCodePoint(code);
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? null;
}

export function decodeBookmarkText(text) {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) =>
    decodeCharacterReference(body) ?? match
  );
}

function parseAttributes(raw) {
  const attributes = new Map();
  ATTRIBUTE_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, decodeBookmarkText(match[2] ?? match[3] ?? match[4] ?? ""));
    }
  }
  return attributes;
}

// Netscape exports store ADD_DATE as whole seconds. Anything else, including
// the empty attribute some exporters emit, becomes an unknown date.
function parseAddDate(value) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const milliseconds = Number.parseInt(value, 10) * 1000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function isTrue(value) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function folderRole(attributes) {
  if (isTrue(attributes.get("personal_toolbar_folder"))) return BOOKMARK_FOLDER_ROLES.TOOLBAR;
  if (isTrue(attributes.get("unfiled_bookmarks_folder"))) return BOOKMARK_FOLDER_ROLES.UNFILED;
  return null;
}

function findTagEnd(text, start) {
  let quote = null;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

export function parseBookmarkFile(name, text) {
  if (typeof text !== "string") throw notBookmarksFile();
  const document = text.replace(/^\ufeff/, "").replace(/^\s+/, "");
  if (!DOCTYPE_PATTERN.test(document)) throw notBookmarksFile();

  let nodeCount = 0;
  // One counter owns both identity and the node bound, so document order is
  // the ID and an oversized file stops at the node that exceeds the limit.
  const claimNodeId = () => {
    nodeCount += 1;
    if (nodeCount > BOOKMARK_IMPORT_LIMITS.maxNodes) throw sourceTooLarge();
    return `file:${nodeCount - 1}`;
  };

  const root = {
    type: BOOKMARK_NODE_TYPES.FOLDER,
    id: claimNodeId(),
    title: "",
    role: BOOKMARK_FOLDER_ROLES.ROOT,
    dateAdded: null,
    children: []
  };

  const openLists = [];
  let pending = null;
  let capture = null;
  let sawList = false;

  const current = () => openLists[openLists.length - 1] ?? { folder: root, depth: 0 };

  function startCapture(kind, node) {
    capture = { kind, node, text: "" };
  }

  function finishCapture(kind) {
    if (capture?.kind !== kind) return;
    const title = decodeBookmarkText(capture.text).trim();
    if (kind === "h1") root.title = title;
    else capture.node.title = title;
    capture = null;
  }

  function openTag(name, attributeText) {
    const attributes = name === "a" || name === "h3" ? parseAttributes(attributeText) : null;
    if (name === "dl") {
      sawList = true;
      if (pending) {
        openLists.push(pending);
        pending = null;
      } else if (openLists.length === 0) {
        openLists.push({ folder: root, depth: 0 });
      } else {
        // A list with no folder header of its own continues the folder it sits
        // in, so its close still balances.
        openLists.push(current());
      }
      return;
    }
    if (name === "dt") {
      pending = null;
      return;
    }
    if (name === "hr") {
      current().folder.children.push({
        type: BOOKMARK_NODE_TYPES.SEPARATOR,
        id: claimNodeId()
      });
      return;
    }
    if (name === "h1") {
      startCapture("h1", root);
      return;
    }
    if (name === "h3") {
      const parent = current();
      const depth = parent.depth + 1;
      if (depth > BOOKMARK_IMPORT_LIMITS.maxFolderDepth) throw sourceTooLarge();
      const folder = {
        type: BOOKMARK_NODE_TYPES.FOLDER,
        id: claimNodeId(),
        title: "",
        role: folderRole(attributes),
        dateAdded: parseAddDate(attributes.get("add_date")),
        children: []
      };
      parent.folder.children.push(folder);
      pending = { folder, depth };
      startCapture("h3", folder);
      return;
    }
    if (name === "a") {
      const bookmark = {
        type: BOOKMARK_NODE_TYPES.BOOKMARK,
        id: claimNodeId(),
        title: "",
        url: attributes.get("href") ?? "",
        dateAdded: parseAddDate(attributes.get("add_date"))
      };
      current().folder.children.push(bookmark);
      startCapture("a", bookmark);
    }
  }

  function closeTag(name) {
    if (name === "dl") {
      pending = null;
      capture = null;
      if (openLists.length > 0) openLists.pop();
      return;
    }
    if (name === "h1" || name === "h3" || name === "a") {
      finishCapture(name);
    }
  }

  let index = 0;
  while (index < document.length) {
    const start = document.indexOf("<", index);
    if (start < 0) {
      if (capture) capture.text += document.slice(index);
      break;
    }
    if (capture) capture.text += document.slice(index, start);
    if (document.startsWith("<!--", start)) {
      const end = document.indexOf("-->", start + 4);
      index = end < 0 ? document.length : end + 3;
      continue;
    }
    if (document.startsWith("<!", start) || document.startsWith("<?", start)) {
      const end = document.indexOf(">", start + 2);
      index = end < 0 ? document.length : end + 1;
      continue;
    }
    const end = findTagEnd(document, start);
    if (end < 0) break;
    const inner = document.slice(start + 1, end);
    const closing = inner.startsWith("/");
    const match = /^[a-zA-Z0-9]+/.exec(closing ? inner.slice(1) : inner);
    if (match) {
      const name = match[0].toLowerCase();
      if (closing) closeTag(name);
      else openTag(name, inner.slice(match[0].length));
    }
    index = end + 1;
  }

  if (!sawList) throw notBookmarksFile();
  return {
    kind: BOOKMARK_SOURCE_KINDS.FILE,
    name: name.slice(0, BOOKMARK_IMPORT_LIMITS.maxSourceNameLength),
    root
  };
}

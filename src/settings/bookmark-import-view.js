import {
  BOOKMARK_IMPORT_WARNINGS,
  BOOKMARK_NODE_TYPES,
  BOOKMARK_SOURCE_KINDS
} from "../contracts/bookmark-import.js";
import {
  countImportableBeneath,
  indexBookmarkSource,
  isImportableBookmarkUrl,
  mapBookmarkImport
} from "../core/bookmark-import-mapping.js";

export const BOOKMARK_IMPORT_TEXT = Object.freeze({
  heading: "Import bookmarks",
  firefoxSource: "Firefox bookmarks",
  permissionDenied: "Bookmark access was not granted. Nothing was imported.",
  noFile: "No file was chosen. Nothing was imported.",
  emptySource: "This source has no bookmarks to import.",
  nothingSelected: "Nothing selected to import.",
  unsupportedBookmark: "Can't open",
  untitledFolder: "Untitled folder",
  large: "Large import: Firefox may slow down while tabs are created.",
  untested: "This is larger than Terminus has been tested with (2,500 tabs)."
});

export function bookmarkImportTotalsText({ counts, warning }) {
  const skipped = counts.unsupported + counts.duplicate;
  const parts = [`${counts.create} tabs will be created, ${skipped} skipped`];
  if (warning !== BOOKMARK_IMPORT_WARNINGS.NONE) parts.push(BOOKMARK_IMPORT_TEXT.large);
  if (warning === BOOKMARK_IMPORT_WARNINGS.UNTESTED) parts.push(BOOKMARK_IMPORT_TEXT.untested);
  return parts.join(" ");
}

export function bookmarkImportResultText(outcome) {
  const skipped = outcome.unsupported + outcome.duplicate;
  const failed = outcome.failed > 0 ? `, ${outcome.failed} failed` : "";
  return `Created workspace ${outcome.workspaceName}: ${outcome.created} tabs, ${skipped} skipped${failed}.`;
}

export function bookmarkImportProgressText({ created, total }) {
  return `Importing ${created} of ${total} tabs…`;
}

// A title-less bookmark shows the address it will open, which is exactly the
// title its imported tab receives.
function bookmarkLabel(node) {
  return node.title.length > 0 ? node.title : node.url;
}

function folderLabel(node) {
  return node.title.length > 0 ? node.title : BOOKMARK_IMPORT_TEXT.untitledFolder;
}

function hasAnyBookmark(folder) {
  for (const child of folder.children) {
    if (child.type === BOOKMARK_NODE_TYPES.BOOKMARK) return true;
    if (child.type === BOOKMARK_NODE_TYPES.FOLDER && hasAnyBookmark(child)) return true;
  }
  return false;
}

export function createBookmarkImportView({
  document,
  client,
  importButton,
  privateNote,
  dialog,
  form,
  firefoxChoice,
  fileChoice,
  dialogCancel,
  fileInput,
  viewerTitle,
  viewerMeta,
  viewerActions,
  viewerTree,
  importActions,
  importTotals,
  createButton,
  cancelButton,
  setStatus,
  onEnter = () => undefined,
  onExit = () => undefined
}) {
  let source = null;
  let index = null;
  let sourceHasBookmarks = false;
  let ticked = new Set();
  const expanded = new Set();
  const descendantCache = new Map();
  let busy = false;
  let privateContext = false;
  let unsubscribeProgress = null;
  let pendingImportId = null;
  let readGeneration = 0;

  function active() {
    return source !== null;
  }

  function descendantBookmarkIds(folder) {
    const cached = descendantCache.get(folder.id);
    if (cached) return cached;
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.type === BOOKMARK_NODE_TYPES.FOLDER) visit(child);
        else if (child.type === BOOKMARK_NODE_TYPES.BOOKMARK) found.push(child.id);
      }
    };
    visit(folder);
    descendantCache.set(folder.id, found);
    return found;
  }

  function updateTotals() {
    if (!active()) return;
    const mapping = mapBookmarkImport(source, [...ticked], index);
    importTotals.textContent = !sourceHasBookmarks
      ? BOOKMARK_IMPORT_TEXT.emptySource
      : mapping.counts.create === 0
        ? BOOKMARK_IMPORT_TEXT.nothingSelected
        : bookmarkImportTotalsText(mapping);
    createButton.disabled = busy || mapping.counts.create === 0;
    cancelButton.disabled = busy;
  }

  function setFolderCheckboxState(checkbox, folder) {
    const descendants = descendantBookmarkIds(folder);
    const tickedCount = descendants.filter((id) => ticked.has(id)).length;
    checkbox.checked = descendants.length > 0 && tickedCount === descendants.length;
    checkbox.indeterminate = tickedCount > 0 && tickedCount < descendants.length;
  }

  // Every rendered folder above and below a change can shift between the three
  // tick states, so the visible rows are refreshed from the ticked set.
  const folderCheckboxes = new Map();
  const bookmarkCheckboxes = new Map();

  function refreshCheckboxes() {
    for (const [folder, checkbox] of folderCheckboxes) setFolderCheckboxState(checkbox, folder);
    for (const [id, checkbox] of bookmarkCheckboxes) checkbox.checked = ticked.has(id);
  }

  function bookmarkRow(node) {
    const row = document.createElement("label");
    row.className = "bookmark-import-row bookmark-import-row--bookmark";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = ticked.has(node.id);
    const importable = isImportableBookmarkUrl(node.url);
    if (!importable) {
      // An unopenable bookmark can still be swept in by a folder tick; it is
      // always reported as skipped instead of silently disappearing.
      checkbox.disabled = true;
      row.dataset.unsupported = "true";
    }
    checkbox.setAttribute("aria-label", `Select ${bookmarkLabel(node)}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) ticked.add(node.id);
      else ticked.delete(node.id);
      refreshCheckboxes();
      updateTotals();
    });
    const title = document.createElement("span");
    title.className = "bookmark-import-title";
    title.textContent = bookmarkLabel(node);
    row.append(checkbox, title);
    if (!importable) {
      const note = document.createElement("span");
      note.className = "bookmark-import-unsupported";
      note.textContent = BOOKMARK_IMPORT_TEXT.unsupportedBookmark;
      row.append(note);
    }
    bookmarkCheckboxes.set(node.id, checkbox);
    return row;
  }

  function renderChildren(folder, container) {
    container.replaceChildren(
      ...folder.children
        .filter(({ type }) => type !== BOOKMARK_NODE_TYPES.SEPARATOR)
        .map((child) => child.type === BOOKMARK_NODE_TYPES.FOLDER
          ? folderNode(child)
          : bookmarkRow(child))
    );
  }

  function folderNode(folder) {
    const node = document.createElement("div");
    node.className = "bookmark-import-node";
    const row = document.createElement("div");
    row.className = "bookmark-import-row bookmark-import-row--folder";
    const children = document.createElement("div");
    children.className = "bookmark-import-children";
    children.hidden = !expanded.has(folder.id);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bookmark-import-toggle";
    toggle.setAttribute("aria-expanded", String(expanded.has(folder.id)));
    toggle.setAttribute("aria-label", folderLabel(folder));
    toggle.addEventListener("click", () => {
      const open = !expanded.has(folder.id);
      if (open) expanded.add(folder.id);
      else expanded.delete(folder.id);
      toggle.setAttribute("aria-expanded", String(open));
      children.hidden = !open;
      // Children are built the first time a folder opens, so a large library
      // renders only the rows the user has actually asked to see.
      if (open && children.children.length === 0) {
        renderChildren(folder, children);
        refreshCheckboxes();
      }
    });

    const label = document.createElement("label");
    label.className = "bookmark-import-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      const descendants = descendantBookmarkIds(folder);
      if (checkbox.checked) for (const id of descendants) ticked.add(id);
      else for (const id of descendants) ticked.delete(id);
      refreshCheckboxes();
      updateTotals();
    });
    const title = document.createElement("span");
    title.className = "bookmark-import-title";
    title.textContent = `${folderLabel(folder)} — ${countImportableBeneath(folder)}`;
    label.append(checkbox, title);
    row.append(toggle, label);
    node.append(row, children);
    folderCheckboxes.set(folder, checkbox);
    setFolderCheckboxState(checkbox, folder);
    if (expanded.has(folder.id)) renderChildren(folder, children);
    return node;
  }

  function renderTree() {
    folderCheckboxes.clear();
    bookmarkCheckboxes.clear();
    const list = document.createElement("div");
    list.className = "bookmark-import-tree";
    renderChildren(source.root, list);
    viewerTree.replaceChildren(list);
    refreshCheckboxes();
  }

  function enter(nextSource) {
    source = nextSource;
    index = indexBookmarkSource(nextSource);
    sourceHasBookmarks = hasAnyBookmark(nextSource.root);
    ticked = new Set();
    expanded.clear();
    descendantCache.clear();
    viewerTitle.textContent = BOOKMARK_IMPORT_TEXT.heading;
    delete viewerTitle.dataset.provenance;
    viewerMeta.textContent = nextSource.kind === BOOKMARK_SOURCE_KINDS.FIREFOX
      ? BOOKMARK_IMPORT_TEXT.firefoxSource
      : nextSource.name;
    viewerActions.hidden = true;
    importActions.hidden = false;
    onEnter();
    renderTree();
    updateTotals();
  }

  // `restore` is false when the caller is already about to redraw the Viewer,
  // so leaving import mode does not queue a second refresh.
  function exit({ restore = true } = {}) {
    if (!active() || busy) return;
    readGeneration += 1;
    source = null;
    index = null;
    ticked = new Set();
    expanded.clear();
    descendantCache.clear();
    folderCheckboxes.clear();
    bookmarkCheckboxes.clear();
    importActions.hidden = true;
    importTotals.textContent = "";
    fileInput.value = "";
    viewerTree.replaceChildren();
    if (restore) onExit();
  }

  async function read(operation, generation = ++readGeneration) {
    setStatus("Reading bookmarks…");
    try {
      const nextSource = await operation();
      if (generation !== readGeneration || privateContext || busy) return;
      enter(nextSource);
      setStatus(importTotals.textContent);
    } catch (error) {
      if (generation !== readGeneration) return;
      setStatus(error.message, "error");
    }
  }

  importButton.addEventListener("click", () => {
    if (privateContext || busy) return;
    if (!dialog.open) dialog.showModal();
  });
  dialogCancel.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => event.preventDefault());

  firefoxChoice.addEventListener("click", () => {
    dialog.close();
    const generation = ++readGeneration;
    // `permissions.request` must run inside the click that asked for it.
    void (async () => {
      let granted = false;
      try {
        granted = await client.requestPermission();
      } catch {
        granted = false;
      }
      if (generation !== readGeneration) return;
      if (!granted) {
        setStatus(BOOKMARK_IMPORT_TEXT.permissionDenied, "error");
        return;
      }
      await read(() => client.readFirefox(), generation);
    })();
  });

  fileChoice.addEventListener("click", () => {
    dialog.close();
    readGeneration += 1;
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const generation = ++readGeneration;
    const file = fileInput.files?.[0];
    if (!file) {
      setStatus(BOOKMARK_IMPORT_TEXT.noFile, "error");
      return;
    }
    void read(() => client.readFile(file), generation);
  });

  cancelButton.addEventListener("click", () => exit());

  createButton.addEventListener("click", () => {
    if (!active() || busy) return;
    busy = true;
    createButton.disabled = true;
    cancelButton.disabled = true;
    importButton.disabled = true;
    pendingImportId = null;
    unsubscribeProgress = client.subscribeProgress((progress) => {
      pendingImportId ??= progress.importId;
      if (progress.importId === pendingImportId) {
        setStatus(bookmarkImportProgressText(progress));
      }
    });
    void (async () => {
      try {
        const outcome = await client.create(source, [...ticked]);
        busy = false;
        exit();
        setStatus(bookmarkImportResultText(outcome));
      } catch (error) {
        // Nothing was created, so the picked tree stays open for another try.
        busy = false;
        setStatus(error.message, "error");
        updateTotals();
      } finally {
        unsubscribeProgress?.();
        unsubscribeProgress = null;
        pendingImportId = null;
        importButton.disabled = privateContext;
      }
    })();
  });

  function configureScope(nextPrivateContext) {
    privateContext = nextPrivateContext === true;
    if (privateContext) readGeneration += 1;
    importButton.disabled = privateContext || busy;
    privateNote.hidden = !privateContext;
    if (privateContext) {
      busy = false;
      exit({ restore: false });
    }
  }

  return Object.freeze({
    enter,
    exit,
    isActive: active,
    configureScope,
    tickedBookmarkIds: () => [...ticked]
  });
}

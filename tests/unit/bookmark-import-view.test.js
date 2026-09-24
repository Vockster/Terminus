import test from "node:test";
import assert from "node:assert/strict";

import { createEvent, createFakeDocument, element } from "../helpers/fake-dom.js";
import { parseBookmarkSource } from "../../src/contracts/bookmark-import.js";
import {
  BOOKMARK_IMPORT_TEXT,
  bookmarkImportProgressText,
  bookmarkImportResultText,
  bookmarkImportTotalsText,
  createBookmarkImportView
} from "../../src/settings/bookmark-import-view.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function folder(id, title, children) {
  return { type: "folder", id, title, role: null, dateAdded: null, children };
}

function bookmark(id, title, url) {
  return { type: "bookmark", id, title, url, dateAdded: null };
}

function source(children, kind = "file", name = "export.html") {
  return parseBookmarkSource({
    kind,
    name,
    root: { ...folder("r", "Bookmarks", children), role: "root" }
  });
}

const SOURCE = source([
  folder("docs", "Docs", [
    bookmark("guide", "Guide", "https://docs.invalid/guide"),
    bookmark("script", "Bookmarklet", "javascript:void(0)")
  ]),
  bookmark("loose", "Loose", "https://work.invalid/loose")
]);

const OUTCOME = {
  workspaceId: "ws-imported",
  workspaceName: "Imported bookmarks",
  requested: 2,
  created: 2,
  unsupported: 1,
  duplicate: 0,
  failed: 0
};

function createHarness({
  granted = true,
  read = async () => SOURCE,
  create = async () => OUTCOME
} = {}) {
  const document = createFakeDocument();
  const dialog = element(document, "dialog");
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(createEvent("close"));
  };
  const parts = {
    importButton: element(document, "button"),
    privateNote: element(document, "p", { hidden: true }),
    dialog,
    form: element(document, "form"),
    firefoxChoice: element(document, "button"),
    fileChoice: element(document, "button"),
    dialogCancel: element(document, "button"),
    fileInput: element(document, "input"),
    viewerTitle: element(document, "h2"),
    viewerMeta: element(document, "p"),
    viewerActions: element(document, "div"),
    viewerTree: element(document, "div"),
    importActions: element(document, "div", { hidden: true }),
    importTotals: element(document, "p"),
    createButton: element(document, "button"),
    cancelButton: element(document, "button")
  };
  document.body.append(...Object.values(parts).filter((node) => node !== dialog), dialog);
  const status = [];
  const progressListeners = [];
  const events = [];
  const client = {
    async requestPermission() {
      events.push("request-permission");
      if (granted instanceof Error) throw granted;
      return granted;
    },
    async readFirefox() {
      events.push("read-firefox");
      return read();
    },
    async readFile(file) {
      events.push(["read-file", file.name]);
      return read(file);
    },
    async create(chosenSource, ticked) {
      events.push(["create", ticked]);
      return create(chosenSource, ticked);
    },
    subscribeProgress(listener) {
      progressListeners.push(listener);
      return () => {
        progressListeners.splice(progressListeners.indexOf(listener), 1);
      };
    }
  };
  const view = createBookmarkImportView({
    document,
    client,
    ...parts,
    setStatus: (message, variant = "quiet") => status.push([message, variant]),
    onEnter: () => events.push("enter"),
    onExit: () => events.push("exit")
  });
  return { ...parts, document, view, status, events, progressListeners };
}

function rows(harness) {
  return harness.viewerTree.querySelectorAll(".bookmark-import-row");
}

function checkboxOf(row) {
  const direct = row.children.find(({ tagName }) => tagName === "INPUT");
  if (direct) return direct;
  const label = row.children.find(({ tagName }) => tagName === "LABEL");
  return label.children.find(({ tagName }) => tagName === "INPUT");
}

function titleOf(row) {
  const [title] = row.querySelectorAll(".bookmark-import-title");
  return title.textContent;
}

function toggleOf(row) {
  return row.children.find(({ className }) => className === "bookmark-import-toggle");
}

function setChecked(checkbox, checked) {
  checkbox.checked = checked;
  checkbox.dispatchEvent(createEvent("change"));
}

test("the running total and result text follow the mapping counts exactly", () => {
  assert.equal(
    bookmarkImportTotalsText({
      counts: { ticked: 5, create: 3, unsupported: 1, duplicate: 1 },
      warning: "none"
    }),
    "3 tabs will be created, 2 skipped"
  );
  assert.equal(
    bookmarkImportTotalsText({
      counts: { ticked: 600, create: 600, unsupported: 0, duplicate: 0 },
      warning: "large"
    }),
    `600 tabs will be created, 0 skipped ${BOOKMARK_IMPORT_TEXT.large}`
  );
  assert.equal(
    bookmarkImportTotalsText({
      counts: { ticked: 3000, create: 3000, unsupported: 0, duplicate: 0 },
      warning: "untested"
    }),
    `3000 tabs will be created, 0 skipped ${BOOKMARK_IMPORT_TEXT.large} ${BOOKMARK_IMPORT_TEXT.untested}`
  );
  assert.equal(
    bookmarkImportResultText(OUTCOME),
    "Created workspace Imported bookmarks: 2 tabs, 1 skipped."
  );
  assert.equal(
    bookmarkImportResultText({ ...OUTCOME, created: 1, failed: 1 }),
    "Created workspace Imported bookmarks: 1 tabs, 1 skipped, 1 failed."
  );
  assert.equal(bookmarkImportProgressText({ created: 4, total: 9 }), "Importing 4 of 9 tabs…");
});

test("a read shows the source, its top level, and a collapsed folder with its importable count", async () => {
  const harness = createHarness();
  harness.importButton.click();
  assert.equal(harness.dialog.open, true);
  harness.firefoxChoice.click();
  await flush();

  assert.equal(harness.dialog.open, false);
  assert.equal(harness.viewerTitle.textContent, BOOKMARK_IMPORT_TEXT.heading);
  assert.equal(harness.viewerMeta.textContent, "export.html");
  assert.equal(harness.viewerActions.hidden, true);
  assert.equal(harness.importActions.hidden, false);
  assert.deepEqual(harness.events, ["request-permission", "read-firefox", "enter"]);

  assert.deepEqual(rows(harness).map(titleOf), ["Docs — 1", "Loose"]);
  assert.equal(harness.importTotals.textContent, BOOKMARK_IMPORT_TEXT.nothingSelected);
  assert.equal(harness.createButton.disabled, true);
});

test("a folder tick sweeps the bookmarks beneath it, including ones Terminus cannot open", async () => {
  const harness = createHarness();
  harness.firefoxChoice.click();
  await flush();

  const [docsRow] = rows(harness);
  setChecked(checkboxOf(docsRow), true);
  assert.equal(harness.importTotals.textContent, "1 tabs will be created, 1 skipped");
  assert.equal(harness.createButton.disabled, false);
  assert.deepEqual(harness.view.tickedBookmarkIds().sort(), ["guide", "script"]);

  toggleOf(docsRow).click();
  assert.equal(toggleOf(docsRow).getAttribute("aria-expanded"), "true");
  const [, guideRow, scriptRow] = rows(harness);
  assert.equal(titleOf(guideRow), "Guide");
  assert.equal(checkboxOf(guideRow).checked, true);
  assert.equal(checkboxOf(scriptRow).checked, true);
  assert.equal(checkboxOf(scriptRow).disabled, true, "an unopenable bookmark cannot be ticked alone");
  assert.equal(scriptRow.dataset.unsupported, "true");
  assert.equal(
    scriptRow.querySelectorAll(".bookmark-import-unsupported")[0].textContent,
    BOOKMARK_IMPORT_TEXT.unsupportedBookmark
  );

  setChecked(checkboxOf(guideRow), false);
  assert.equal(checkboxOf(docsRow).checked, false);
  assert.equal(checkboxOf(docsRow).indeterminate, true, "one remaining tick leaves a mixed folder");
  assert.equal(harness.importTotals.textContent, BOOKMARK_IMPORT_TEXT.nothingSelected);
  assert.equal(harness.createButton.disabled, true);

  setChecked(checkboxOf(docsRow), false);
  assert.deepEqual(harness.view.tickedBookmarkIds(), []);
  assert.equal(checkboxOf(docsRow).indeterminate, false);
});

test("a source with no bookmarks says so and cannot create a workspace", async () => {
  const harness = createHarness({ read: async () => source([folder("empty", "Empty", [])]) });
  harness.fileChoice.click();
  harness.fileInput.files = [{ name: "export.html" }];
  harness.fileInput.dispatchEvent(createEvent("change"));
  await flush();

  assert.equal(harness.importTotals.textContent, BOOKMARK_IMPORT_TEXT.emptySource);
  assert.equal(harness.createButton.disabled, true);
  assert.deepEqual(rows(harness).map(titleOf), ["Empty — 0"]);
});

test("a slower bookmark read cannot replace the source chosen afterward", async () => {
  const pending = new Map();
  const harness = createHarness({
    read: (file) => new Promise((resolve) => pending.set(file.name, resolve))
  });
  harness.fileInput.files = [{ name: "older.html" }];
  harness.fileInput.dispatchEvent(createEvent("change"));
  harness.fileInput.files = [{ name: "newer.html" }];
  harness.fileInput.dispatchEvent(createEvent("change"));

  pending.get("newer.html")(
    source([bookmark("new", "New", "https://new.invalid")], "file", "newer.html")
  );
  await flush();
  pending.get("older.html")(
    source([bookmark("old", "Old", "https://old.invalid")], "file", "older.html")
  );
  await flush();

  assert.equal(harness.viewerMeta.textContent, "newer.html");
  assert.deepEqual(rows(harness).map(titleOf), ["New"]);
});

test("Cancel discards the picked tree and hands the Viewer back", async () => {
  const harness = createHarness();
  harness.firefoxChoice.click();
  await flush();
  assert.equal(harness.view.isActive(), true);

  harness.cancelButton.click();
  assert.equal(harness.view.isActive(), false);
  assert.equal(harness.importActions.hidden, true);
  assert.equal(harness.importTotals.textContent, "");
  assert.deepEqual(harness.viewerTree.children, []);
  assert.deepEqual(harness.events.at(-1), "exit");
});

test("a denied permission and a cancelled picker both report that nothing was imported", async () => {
  const denied = createHarness({ granted: false });
  denied.firefoxChoice.click();
  await flush();
  assert.deepEqual(denied.status.at(-1), [BOOKMARK_IMPORT_TEXT.permissionDenied, "error"]);
  assert.equal(denied.view.isActive(), false);
  assert.deepEqual(denied.events, ["request-permission"]);

  const throwing = createHarness({ granted: new Error("prompt failed") });
  throwing.firefoxChoice.click();
  await flush();
  assert.deepEqual(throwing.status.at(-1), [BOOKMARK_IMPORT_TEXT.permissionDenied, "error"]);

  const cancelled = createHarness();
  cancelled.fileChoice.click();
  cancelled.fileInput.dispatchEvent(createEvent("change"));
  await flush();
  assert.deepEqual(cancelled.status.at(-1), [BOOKMARK_IMPORT_TEXT.noFile, "error"]);
  assert.equal(cancelled.view.isActive(), false);
  assert.deepEqual(cancelled.events, []);
});

test("an unreadable file reports its own error and leaves the Viewer alone", async () => {
  const harness = createHarness({
    read: async () => {
      throw new Error("This file can't be read as a bookmarks file.");
    }
  });
  harness.fileChoice.click();
  harness.fileInput.files = [{ name: "notes.txt" }];
  harness.fileInput.dispatchEvent(createEvent("change"));
  await flush();
  assert.deepEqual(harness.status.at(-1), ["This file can't be read as a bookmarks file.", "error"]);
  assert.equal(harness.view.isActive(), false);
  assert.equal(harness.importActions.hidden, true);
});

test("creating reports progress, then the outcome, and leaves import mode", async () => {
  const harness = createHarness({
    async create() {
      for (const listener of harness.progressListeners) {
        listener({ importId: "import-1", created: 1, total: 2 });
        listener({ importId: "other", created: 99, total: 99 });
      }
      return OUTCOME;
    }
  });
  harness.firefoxChoice.click();
  await flush();
  setChecked(checkboxOf(rows(harness)[0]), true);

  harness.createButton.click();
  assert.equal(harness.createButton.disabled, true, "controls lock while the import runs");
  assert.equal(harness.cancelButton.disabled, true);
  assert.equal(harness.importButton.disabled, true);
  await flush();

  assert.deepEqual(harness.status.slice(-2), [
    [bookmarkImportProgressText({ created: 1, total: 2 }), "quiet"],
    [bookmarkImportResultText(OUTCOME), "quiet"]
  ]);
  assert.equal(harness.view.isActive(), false);
  assert.equal(harness.importButton.disabled, false);
  assert.deepEqual(harness.progressListeners, [], "the progress subscription is released");
  assert.deepEqual(harness.events.at(-2), ["create", ["guide", "script"]]);
});

test("a refused import keeps the picked tree open with its error", async () => {
  const harness = createHarness({
    async create() {
      throw new Error("Terminus already has the maximum of 100 workspaces.");
    }
  });
  harness.firefoxChoice.click();
  await flush();
  setChecked(checkboxOf(rows(harness)[0]), true);

  harness.createButton.click();
  await flush();

  assert.deepEqual(harness.status.at(-1), [
    "Terminus already has the maximum of 100 workspaces.",
    "error"
  ]);
  assert.equal(harness.view.isActive(), true);
  assert.equal(harness.importActions.hidden, false);
  assert.equal(harness.createButton.disabled, false, "the pick can be tried again");
  assert.deepEqual(harness.progressListeners, []);
});

test("a private Settings window disables the button, shows its note, and closes import mode", async () => {
  const harness = createHarness();
  harness.firefoxChoice.click();
  await flush();
  assert.equal(harness.view.isActive(), true);

  harness.view.configureScope(true);
  assert.equal(harness.importButton.disabled, true);
  assert.equal(harness.privateNote.hidden, false);
  assert.equal(harness.view.isActive(), false);
  harness.importButton.click();
  assert.equal(harness.dialog.open, false, "a disabled button never opens the chooser");

  harness.view.configureScope(false);
  assert.equal(harness.importButton.disabled, false);
  assert.equal(harness.privateNote.hidden, true);
});

test("untrusted titles and addresses are rendered as text, never as markup", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const harness = createHarness({
    read: async () => source([
      folder("f", hostile, [bookmark("b", "", "https://x.invalid/<script>")])
    ])
  });
  harness.firefoxChoice.click();
  await flush();

  const [folderRow] = rows(harness);
  assert.equal(titleOf(folderRow), `${hostile} — 1`);
  toggleOf(folderRow).click();
  assert.equal(titleOf(rows(harness)[1]), "https://x.invalid/<script>");
  assert.equal(
    checkboxOf(rows(harness)[1]).getAttribute("aria-label"),
    "Select https://x.invalid/<script>"
  );
});

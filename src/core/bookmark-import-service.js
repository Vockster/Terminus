import {
  BOOKMARK_IMPORT_ERROR_CODES,
  BOOKMARK_IMPORT_LIMITS,
  BOOKMARK_SOURCE_KINDS,
  BookmarkImportError,
  parseBookmarkSource
} from "../contracts/bookmark-import.js";
import { SNAPSHOT_SETTINGS_LIMITS } from "../contracts/settings-state.js";
import { parseBookmarkFile } from "./bookmark-html-parser.js";
import { mapBookmarkImport } from "./bookmark-import-mapping.js";

// Reading a source and creating a workspace are separate steps because the
// user picks bookmarks in between. The source travels back through Settings, so
// creation revalidates it instead of trusting the returned preview.
export class BookmarkImportService {
  #bookmarksBrowser;
  #workspaceController;
  #settingsService;
  #onProgress;
  #createUuid;

  constructor({
    bookmarksBrowser,
    workspaceController,
    settingsService,
    onProgress = null,
    createUuid = null
  }) {
    this.#bookmarksBrowser = bookmarksBrowser;
    this.#workspaceController = workspaceController;
    this.#settingsService = settingsService;
    this.#onProgress = onProgress;
    this.#createUuid = createUuid ?? (() => globalThis.crypto.randomUUID());
  }

  async readFirefox() {
    return parseBookmarkSource(await this.#bookmarksBrowser.readTree());
  }

  async readFile(name, text) {
    if (typeof name !== "string" || typeof text !== "string") {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.INVALID_REQUEST);
    }
    if (text.length > BOOKMARK_IMPORT_LIMITS.maxFileUnits) {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.FILE_TOO_LARGE);
    }
    const source = parseBookmarkFile(name, text);
    return parseBookmarkSource({
      kind: BOOKMARK_SOURCE_KINDS.FILE,
      name: source.name.slice(0, BOOKMARK_IMPORT_LIMITS.maxSourceNameLength),
      root: source.root
    });
  }

  async #restoreBatchSize() {
    try {
      const settings = await this.#settingsService.getOrInitialize();
      const size = settings?.snapshots?.restoreBatchSize;
      return Number.isInteger(size) ? size : SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue;
    } catch {
      return SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue;
    }
  }

  async create(windowId, rawSource, tickedBookmarkIds) {
    const source = parseBookmarkSource(rawSource);
    const mapping = mapBookmarkImport(source, tickedBookmarkIds);
    if (mapping.counts.create === 0) {
      throw new BookmarkImportError(BOOKMARK_IMPORT_ERROR_CODES.NOTHING_TO_IMPORT);
    }
    const importId = `bookmark-import-${this.#createUuid()}`;
    const batchSize = await this.#restoreBatchSize();
    return this.#workspaceController.importBookmarkWorkspace(
      windowId,
      mapping,
      batchSize,
      ({ created, total }) => this.#onProgress?.({ importId, created, total })
    );
  }
}

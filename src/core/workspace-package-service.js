import {
  digestCustomIconBytes,
  parseCustomIconSource,
  validateCustomIconPng,
  CUSTOM_ICON_LIMITS,
  CUSTOM_ICON_SOURCE_EXTENSIONS
} from "../contracts/custom-icons.js";
import {
  MAX_RAIL_ENTRIES,
  MAX_WORKSPACES,
  WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceState
} from "../contracts/workspace-state.js";
import { FALLBACK_WORKSPACE_ICON } from "../contracts/workspace-icons.js";
import {
  MAX_WORKSPACE_PACKAGE_BYTES,
  WORKSPACE_ARCHIVE_MANIFEST_NAME,
  WORKSPACE_PACKAGE_ERROR_CODES,
  WORKSPACE_PACKAGE_IMPORT_MODES,
  WorkspacePackageError,
  createWorkspaceArchiveManifest,
  createWorkspacePackage,
  decodeWorkspacePackageBytes,
  encodeWorkspacePackageBytes,
  parseWorkspacePackage,
  workspacePackageFromArchive
} from "../contracts/workspace-package.js";
import { workspacePackageExportFilename } from "./export-filenames.js";
import { ZipError, createZipArchive, uniqueEntryName } from "./zip-writer.js";
import { isZipArchive, readZipArchive } from "./zip-reader.js";
import { createSerialOperationExecutor } from "./serial-operation-executor.js";
import {
  WORKSPACE_IMPORT_BEHAVIORS,
  WORKSPACE_IMPORT_ERROR_CODES,
  WorkspaceImportError,
  normalizeImportedWorkspaces,
  validateWorkspaceAssociationMap
} from "./workspace-import-policy.js";

const CUSTOM_ICON_ID_PATTERN = /^custom-[0-9a-f]{32}$/;
const ICON_FOLDER = "icons";
const ORIGINAL_FOLDER = "originals";

function isCustomIconReference(iconId) {
  return CUSTOM_ICON_ID_PATTERN.test(iconId);
}

function fail(code) {
  return new WorkspacePackageError(code);
}

// Labels are user text and become file names inside the archive.
function safeEntryStem(label) {
  const cleaned = label
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length === 0 ? "icon" : cleaned.slice(0, 60);
}

function referencedIconIds(workspaces) {
  const ids = new Set();
  for (const { icon } of workspaces) {
    if (isCustomIconReference(icon)) ids.add(icon);
  }
  return ids;
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export class WorkspacePackageService {
  #workspaceStateService;
  #customIconService;
  #decoder;
  #clock;
  #normalController;
  #privateController;
  #captureSafetySnapshot;
  #operationExecutor;

  constructor({
    workspaceStateService,
    customIconService,
    decoder,
    normalController,
    privateController = null,
    captureSafetySnapshot = async () => undefined,
    clock = () => new Date(),
    operationExecutor = createSerialOperationExecutor()
  }) {
    this.#workspaceStateService = workspaceStateService;
    this.#customIconService = customIconService;
    this.#decoder = decoder;
    this.#normalController = normalController;
    this.#privateController = privateController;
    this.#captureSafetySnapshot = captureSafetySnapshot;
    this.#clock = clock;
    this.#operationExecutor = operationExecutor;
  }

  // One zip holds the whole setup: every workspace, the rail's order with its
  // dividers and spaces, and the entire custom icon library, including icons
  // no workspace uses, so importing it restores everything.
  export() {
    return this.#operationExecutor.runExclusive((executorLease) => this.#export(executorLease));
  }

  async #export(_executorLease) {
    const state = await this.#workspaceStateService.getOrInitialize();
    const { icons: stored } = await this.#customIconService.listForExport();
    const storedIds = new Set(stored.map(({ id }) => id));

    // Built through the package parser first, so a produced zip and an
    // imported one are held to exactly one contract.
    const document = createWorkspacePackage({
      workspaces: state.workspaces.map(({ id, name, icon, color }) => ({
        id,
        name,
        icon: isCustomIconReference(icon) && !storedIds.has(icon)
          ? FALLBACK_WORKSPACE_ICON.id
          : icon,
        color
      })),
      rail: state.rail,
      icons: stored.map((icon) => ({
        id: icon.id,
        label: icon.label,
        digest: icon.digest,
        byteLength: icon.bytes.byteLength,
        dataBase64: encodeWorkspacePackageBytes(icon.bytes),
        // Present only for icons stored after originals began to be retained.
        source: icon.source === null || icon.source === undefined
          ? null
          : {
            mimeType: icon.source.mimeType,
            byteLength: icon.source.byteLength,
            dataBase64: encodeWorkspacePackageBytes(icon.source.bytes)
          }
      })),
      createdAt: this.#clock().toISOString()
    });

    const taken = new Set([WORKSPACE_ARCHIVE_MANIFEST_NAME]);
    const fileNames = new Map();
    const files = [];
    for (const icon of stored) {
      const stem = safeEntryStem(icon.label);
      const file = uniqueEntryName(`${ICON_FOLDER}/${stem}.png`, taken);
      files.push({ name: file, bytes: icon.bytes });
      let sourceFile = null;
      if (icon.source) {
        const extension = CUSTOM_ICON_SOURCE_EXTENSIONS[icon.source.mimeType] ?? ".png";
        sourceFile = uniqueEntryName(`${ORIGINAL_FOLDER}/${stem}${extension}`, taken);
        files.push({ name: sourceFile, bytes: icon.source.bytes });
      }
      fileNames.set(icon.id, { file, sourceFile });
    }
    const manifest = createWorkspaceArchiveManifest(document, fileNames);
    const bytes = createZipArchive(
      [
        {
          name: WORKSPACE_ARCHIVE_MANIFEST_NAME,
          bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
        },
        ...files
      ],
      { modifiedAt: new Date(document.createdAt) }
    );
    // Checked before the file exists: an oversized export would otherwise
    // produce a file that can never be imported.
    if (bytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.PACKAGE_TOO_LARGE);
    }

    return {
      document,
      bytes,
      filename: workspacePackageExportFilename({ createdAt: document.createdAt })
    };
  }

  // Reads a setup zip, or a JSON package from before the zip existed.
  async readFile(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_REQUEST);
    }
    if (bytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.FILE_TOO_LARGE);
    }
    const { document, damagedOriginals } = isZipArchive(bytes)
      ? await this.#readArchive(bytes)
      : this.#readJson(bytes);
    const preflight = await this.#preflight(document);
    const originalsById = new Map([
      ...damagedOriginals,
      ...preflight.preview.icons.damagedOriginals
    ].map((item) => [item.id, item]));
    return {
      document,
      preview: {
        ...preflight.preview,
        icons: {
          ...preflight.preview.icons,
          damagedOriginals: [...originalsById.values()]
        }
      }
    };
  }

  async #readArchive(bytes) {
    let files;
    try {
      files = await readZipArchive(bytes, { maxTotalBytes: MAX_WORKSPACE_PACKAGE_BYTES });
    } catch (error) {
      if (error instanceof ZipError) throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE);
      throw error;
    }
    const manifestBytes = files.get(WORKSPACE_ARCHIVE_MANIFEST_NAME);
    // Any other zip, such as a folder of pictures, is simply not a setup.
    if (!manifestBytes) throw fail(WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE);
    let manifest;
    try {
      manifest = JSON.parse(decodeUtf8(manifestBytes));
    } catch {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE);
    }
    const damagedOriginals = [];
    const document = workspacePackageFromArchive(manifest, files, {
      onDamagedSource: (icon) => damagedOriginals.push(icon)
    });
    return { document, damagedOriginals };
  }

  #readJson(bytes) {
    let value;
    try {
      value = JSON.parse(decodeUtf8(bytes));
    } catch {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE);
    }
    return { document: parseWorkspacePackage(value), damagedOriginals: [] };
  }

  import(windowId, rawDocument, rawMode) {
    return this.#operationExecutor.runExclusive((executorLease) =>
      this.#import(windowId, rawDocument, rawMode, executorLease)
    );
  }

  async #import(windowId, rawDocument, rawMode, executorLease) {
    const mode = Object.values(WORKSPACE_PACKAGE_IMPORT_MODES).includes(rawMode)
      ? rawMode
      : null;
    if (mode === null) throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_REQUEST);

    // The page is never trusted: the document is parsed and preflighted again
    // here, whatever the preview said.
    const document = parseWorkspacePackage(rawDocument);
    const { preview, iconRemap, iconOperations } = await this.#preflight(
      document,
      mode,
      executorLease
    );
    const current = await this.#workspaceStateService.getOrInitialize();
    const destinationPlan = this.#createDestinationPlan(document, current, mode);

    // Preflight has refused everything it can. Writing starts here, and each
    // step below is undone in reverse if a later one fails.
    const iconMutations = await this.#writeIcons(iconOperations, executorLease);
    try {
      for (const [sourceId, targetId] of iconMutations.remap) {
        iconRemap.set(sourceId, targetId);
      }
      const nextState = this.#composeNextState(
        document,
        current,
        mode,
        iconRemap,
        destinationPlan
      );
      if (mode === WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE) {
        await this.#captureSafetySnapshot(executorLease);
      }
      await this.#applyState(
        windowId,
        current,
        nextState,
        mode === WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE
          ? destinationPlan.runtimeWorkspaceIdMap
          : null,
        executorLease
      );
    } catch (error) {
      await this.#rollbackIconWrites(iconMutations, executorLease);
      throw error;
    }

    return {
      mode,
      workspaceCount: document.payload.workspaces.workspaces.length,
      matchedWorkspaceCount: destinationPlan.matchedWorkspaceCount,
      retainedWorkspaceCount: destinationPlan.retainedWorkspaces.length,
      icons: preview.icons
    };
  }

  async #validatedIcon(icon) {
    const bytes = decodeWorkspacePackageBytes(icon.dataBase64);
    if (bytes.byteLength !== icon.byteLength) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE);
    }
    validateCustomIconPng(bytes);
    const { width, height } = await this.#decoder.measure(bytes);
    if (width !== CUSTOM_ICON_LIMITS.size || height !== CUSTOM_ICON_LIMITS.size) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE);
    }
    // Recomputed from the bytes: a package cannot assert its own identity.
    let source = null;
    let sourceDamaged = false;
    if (icon.source !== null) {
      try {
        const sourceBytes = decodeWorkspacePackageBytes(icon.source.dataBase64);
        source = parseCustomIconSource({
          mimeType: icon.source.mimeType,
          byteLength: icon.source.byteLength,
          bytes: sourceBytes
        });
      } catch {
        sourceDamaged = true;
      }
    }
    return {
      bytes,
      digest: await digestCustomIconBytes(bytes),
      source,
      sourceDamaged
    };
  }

  // Everything that can refuse the import happens here, before any write.
  async #preflight(document, mode = null, executorLease = null) {
    const packaged = new Map(
      document.payload.icons.map((icon) => [icon.id, icon])
    );
    const referenced = referencedIconIds(document.payload.workspaces.workspaces);
    const { icons: stored } = await this.#customIconService.listForExport();
    const digestToStoredId = new Map(stored.map(({ id, digest }) => [digest, id]));

    const iconRemap = new Map();
    const candidates = [];
    const damaged = [];
    const damagedOriginals = [];
    let reusableCount = 0;

    // Icons a workspace uses come first; the rest of the library follows, so
    // a setup zip brings back icons no workspace happens to use as well.
    const order = [
      ...referenced,
      ...[...packaged.keys()].filter((id) => !referenced.has(id))
    ];
    for (const sourceId of order) {
      const icon = packaged.get(sourceId);
      if (!icon) {
        // Referenced but absent: the rail still imports, wearing House.
        damaged.push({ id: sourceId, label: null });
        continue;
      }
      let validated;
      try {
        validated = await this.#validatedIcon(icon);
      } catch {
        damaged.push({ id: sourceId, label: icon.label });
        continue;
      }
      const existingId = digestToStoredId.get(validated.digest);
      if (existingId) {
        reusableCount += 1;
        iconRemap.set(sourceId, existingId);
      }
      if (validated.sourceDamaged) {
        damagedOriginals.push({ id: sourceId, label: icon.label });
      }
      candidates.push({
        sourceIds: [sourceId],
        label: icon.label,
        existingId: existingId ?? null,
        ...validated
      });
    }

    // Two packaged icons can hold identical content under different IDs; the
    // second one reuses the first rather than consuming another slot.
    const digestToOperationIndex = new Map();
    const iconOperations = [];
    for (const candidate of candidates) {
      const seen = digestToOperationIndex.get(candidate.digest);
      if (seen !== undefined) {
        const operation = iconOperations[seen];
        operation.sourceIds.push(...candidate.sourceIds);
        if (operation.source === null && candidate.source !== null) {
          operation.source = candidate.source;
        }
        continue;
      }
      digestToOperationIndex.set(candidate.digest, iconOperations.length);
      iconOperations.push(candidate);
    }

    const newIconCount = iconOperations.filter(({ existingId }) => existingId === null).length;
    if (stored.length + newIconCount > CUSTOM_ICON_LIMITS.maxIcons) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.ICON_LIMIT);
    }

    const packageWorkspaces = document.payload.workspaces.workspaces;
    if (packageWorkspaces.length === 0) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.NOTHING_TO_IMPORT);
    }

    if (mode !== null) {
      await this.#checkCapacity(document, mode, executorLease);
    }

    return {
      iconRemap,
      iconOperations,
      preview: {
        workspaceCount: packageWorkspaces.length,
        icons: {
          reusable: reusableCount,
          new: newIconCount,
          damaged,
          damagedOriginals
        }
      }
    };
  }

  async #checkCapacity(document, mode, executorLease = null) {
    const packaged = document.payload.workspaces;
    if (mode === WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE) {
      if (packaged.workspaces.length > MAX_WORKSPACES) {
        throw fail(WORKSPACE_PACKAGE_ERROR_CODES.WORKSPACE_LIMIT);
      }
      if (packaged.rail.length > MAX_RAIL_ENTRIES) {
        throw fail(WORKSPACE_PACKAGE_ERROR_CODES.RAIL_LIMIT);
      }
      await this.#refuseSplitViewHolders(executorLease);
      return;
    }
    const current = await this.#workspaceStateService.getOrInitialize();
    if (current.workspaces.length + packaged.workspaces.length > MAX_WORKSPACES) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.WORKSPACE_LIMIT);
    }
    if (current.rail.length + packaged.rail.length > MAX_RAIL_ENTRIES) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.RAIL_LIMIT);
    }
  }

  async #refuseSplitViewHolders(executorLease) {
    const holders = await this.#normalController.listSplitViewWorkspaceIds(
      null,
      executorLease
    );
    if (holders.length > 0) {
      throw fail(WORKSPACE_PACKAGE_ERROR_CODES.SPLIT_VIEW_ACTIVE);
    }
  }

  #createDestinationPlan(document, current, mode) {
    // Replacement can retain unmatched current workspaces, so imported IDs
    // must be fresh relative to the live state in both modes.
    const used = new Set(current.workspaces.map(({ id }) => id));
    const usedRailIds = new Set(
      current.rail.flatMap((entry) => (entry.kind === "workspace" ? [] : [entry.id]))
    );

    const workspaceIdMap = new Map();
    for (const workspace of document.payload.workspaces.workspaces) {
      const id = this.#mintId("ws", used);
      workspaceIdMap.set(workspace.id, id);
    }
    const railIdMap = new Map();
    for (const entry of document.payload.workspaces.rail) {
      if (entry.kind === "workspace") continue;
      railIdMap.set(
        entry.id,
        this.#mintId(entry.kind === "divider" ? "divider" : "space", usedRailIds)
      );
    }
    const runtimeWorkspaceIdMap = new Map();
    const retainedWorkspaces = [];
    let retainedRail = [];
    let matchedWorkspaceCount = 0;
    if (mode === WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE) {
      const sourceById = new Map(
        document.payload.workspaces.workspaces.map((workspace) => [workspace.id, workspace])
      );
      for (const currentWorkspace of current.workspaces) {
        const source = sourceById.get(currentWorkspace.id);
        // A stable ID plus the portable identity fields is enough to reconnect
        // a setup to its snapshot while keeping a coincidental/shared ID apart.
        const matches = source?.name === currentWorkspace.name &&
          source?.color === currentWorkspace.color;
        if (matches) {
          runtimeWorkspaceIdMap.set(currentWorkspace.id, workspaceIdMap.get(source.id));
          matchedWorkspaceCount += 1;
        } else {
          runtimeWorkspaceIdMap.set(currentWorkspace.id, currentWorkspace.id);
          retainedWorkspaces.push(currentWorkspace);
        }
      }
      const retainedIds = new Set(retainedWorkspaces.map(({ id }) => id));
      retainedRail = current.rail.filter(
        (entry) => entry.kind === "workspace" && retainedIds.has(entry.workspaceId)
      );
      const targetIds = [
        ...workspaceIdMap.values(),
        ...retainedWorkspaces.map(({ id }) => id)
      ];
      try {
        validateWorkspaceAssociationMap({
          sourceWorkspaceIds: current.workspaces.map(({ id }) => id),
          targetWorkspaceIds: targetIds,
          workspaceIdMap: runtimeWorkspaceIdMap
        });
      } catch (error) {
        if (error instanceof WorkspaceImportError) {
          throw fail(WORKSPACE_PACKAGE_ERROR_CODES.UNRESOLVED_ASSOCIATIONS);
        }
        throw error;
      }
      if (targetIds.length > MAX_WORKSPACES) {
        throw fail(WORKSPACE_PACKAGE_ERROR_CODES.WORKSPACE_LIMIT);
      }
      if (document.payload.workspaces.rail.length + retainedWorkspaces.length > MAX_RAIL_ENTRIES) {
        throw fail(WORKSPACE_PACKAGE_ERROR_CODES.RAIL_LIMIT);
      }
    }
    return {
      workspaceIdMap,
      railIdMap,
      runtimeWorkspaceIdMap,
      retainedWorkspaces,
      retainedRail,
      matchedWorkspaceCount
    };
  }

  #composeNextState(document, current, mode, iconRemap, destinationPlan) {
    const imported = normalizeImportedWorkspaces({
      sourceWorkspaces: document.payload.workspaces.workspaces,
      currentWorkspaces: current.workspaces,
      workspaceIdMap: destinationPlan.workspaceIdMap,
      behavior: mode === WORKSPACE_PACKAGE_IMPORT_MODES.ADD
        ? WORKSPACE_IMPORT_BEHAVIORS.MERGE
        : WORKSPACE_IMPORT_BEHAVIORS.REPLACE,
      resolveIcon: (iconId) => isCustomIconReference(iconId)
        ? iconRemap.get(iconId) ?? null
        : iconId
    });

    const importedRail = document.payload.workspaces.rail.map((entry) => {
      if (entry.kind === "workspace") {
        return {
          kind: "workspace",
          workspaceId: destinationPlan.workspaceIdMap.get(entry.workspaceId)
        };
      }
      const id = destinationPlan.railIdMap.get(entry.id);
      return entry.kind === "divider"
        ? { kind: "divider", id, size: entry.size }
        : { kind: "space", id };
    });

    return parseWorkspaceState(mode === WORKSPACE_PACKAGE_IMPORT_MODES.ADD
      ? {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [...current.workspaces, ...imported],
        rail: [...current.rail, ...importedRail]
      }
      : {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [...imported, ...destinationPlan.retainedWorkspaces],
        rail: [...importedRail, ...destinationPlan.retainedRail]
      });
  }

  async #writeIcons(iconOperations, executorLease) {
    const mutations = {
      remap: new Map(),
      iconRollbackTokens: [],
      compatibilityRollbackTokens: []
    };
    try {
      for (const operation of iconOperations) {
        const result = await this.#customIconService.importIcon(
          operation.label,
          operation.bytes,
          operation.source,
          { preferredId: operation.sourceIds[0], executorLease }
        );
        if (result.rollbackToken) {
          mutations.iconRollbackTokens.push(result.rollbackToken);
        }
        for (const sourceId of operation.sourceIds) {
          mutations.remap.set(sourceId, result.icon.id);
          if (result.icon.id !== sourceId) {
            mutations.compatibilityRollbackTokens.push(
              await this.#customIconService.recordLegacyReference(
                sourceId,
                result.icon.id,
                operation.digest,
                { executorLease }
              )
            );
          }
        }
      }
      return mutations;
    } catch (error) {
      await this.#rollbackIconWrites(mutations, executorLease);
      throw error;
    }
  }

  async #rollbackIconWrites(mutations, executorLease) {
    for (const token of [...mutations.compatibilityRollbackTokens].reverse()) {
      await this.#customIconService
        .restoreLegacyReference(token, { executorLease })
        .catch(() => undefined);
    }
    for (const token of [...mutations.iconRollbackTokens].reverse()) {
      await this.#customIconService
        .rollbackImportIcon(token, { executorLease })
        .catch(() => undefined);
    }
  }

  // Both modes take the same path. Add simply removes no workspace, so the
  // runtime preparation only ensures layouts for the new ones.
  async #applyState(
    windowId,
    previousState,
    nextState,
    workspaceIdMap = null,
    executorLease = null
  ) {
    const controllers = [this.#normalController, this.#privateController].filter(Boolean);
    const tokens = [];
    try {
      for (const controller of controllers) {
        tokens.push({
          controller,
          token: await controller.prepareWorkspaceStateReplacement(
            nextState,
            workspaceIdMap === null ? undefined : { workspaceIdMap },
            executorLease
          )
        });
      }
      await this.#workspaceStateService.replaceForRestore(nextState);
    } catch (error) {
      let stateRollback = null;
      try {
        stateRollback = await this.#workspaceStateService.replaceForRestoreIfCurrent(
          nextState,
          previousState
        );
      } catch {
        // Runtime rollback is still safer when the definition read itself is
        // unavailable; the shared executor prevents another ordinary
        // workspace mutation from interleaving here.
      }
      const canRestoreRuntime = stateRollback === null ||
        JSON.stringify(stateRollback.state) === JSON.stringify(previousState);
      if (canRestoreRuntime) {
        for (const { controller, token } of tokens) {
          await controller
            .restorePreparedWorkspaceState(token, executorLease)
            .catch(() => undefined);
        }
      }
      if (
        error instanceof WorkspaceImportError &&
        error.code === WORKSPACE_IMPORT_ERROR_CODES.UNRESOLVED_ASSOCIATION
      ) {
        throw fail(WORKSPACE_PACKAGE_ERROR_CODES.UNRESOLVED_ASSOCIATIONS);
      }
      throw error instanceof WorkspacePackageError
        ? error
        : fail(WORKSPACE_PACKAGE_ERROR_CODES.STORAGE_UNAVAILABLE);
    }
    await this.#normalController
      .reconcileWindow(windowId, undefined, executorLease)
      .catch(() => undefined);
  }

  #mintId(prefix, used) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = `${prefix}-${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw fail(WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR);
  }
}

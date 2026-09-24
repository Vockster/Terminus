import {
  CUSTOM_ICON_LIMITS,
  CUSTOM_ICON_SOURCE_MIME_TYPES,
  isCustomIconId,
  parseCustomIconLabel
} from "./custom-icons.js";
import {
  WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceStateWithoutContainers
} from "./workspace-state.js";

// A workspace package moves a rail setup between profiles: workspace
// definitions and the custom icon images they reference, and nothing else.
// Tabs stay with snapshots and preferences stay with settings backups, so this
// document deliberately carries neither, nor any container assignment.
export const WORKSPACE_PACKAGE_DOCUMENT_TYPE = "sidebars.workspace-package";
export const WORKSPACE_PACKAGE_SCHEMA_VERSION = 1;

// A setup is exported as one zip: this manifest plus the icon files it names.
// The manifest is the package document with each icon's bytes replaced by the
// name of the file that holds them, so the zip carries raw images rather than
// base64 text, and reading it yields exactly the package a JSON file does.
export const WORKSPACE_ARCHIVE_DOCUMENT_TYPE = "sidebars.workspace-archive";
export const WORKSPACE_ARCHIVE_SCHEMA_VERSION = 1;
export const WORKSPACE_ARCHIVE_MANIFEST_NAME = "workspaces.json";

// Matches the existing export ceiling so every Terminus file obeys one limit.
export const MAX_WORKSPACE_PACKAGE_BYTES = 16 * 1024 * 1024;

export const WORKSPACE_PACKAGE_IMPORT_MODES = Object.freeze({
  ADD: "add",
  REPLACE: "replace"
});

export const WORKSPACE_PACKAGE_MESSAGE_TYPES = Object.freeze({
  EXPORT: "workspacePackage.export",
  READ_FILE: "workspacePackage.readFile",
  IMPORT: "workspacePackage.import"
});

// How one packaged icon resolves against the target profile's library.
export const WORKSPACE_PACKAGE_ICON_STATES = Object.freeze({
  REUSABLE: "reusable",
  NEW: "new",
  DAMAGED: "damaged"
});

export const WORKSPACE_PACKAGE_ERROR_CODES = Object.freeze({
  PERMISSION_REQUIRED: "PERMISSION_REQUIRED",
  NOT_PACKAGE_FILE: "NOT_PACKAGE_FILE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  PACKAGE_TOO_LARGE: "PACKAGE_TOO_LARGE",
  INVALID_PACKAGE: "INVALID_PACKAGE",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  NOTHING_TO_IMPORT: "NOTHING_TO_IMPORT",
  WORKSPACE_LIMIT: "WORKSPACE_LIMIT",
  RAIL_LIMIT: "RAIL_LIMIT",
  ICON_LIMIT: "ICON_LIMIT",
  SPLIT_VIEW_ACTIVE: "SPLIT_VIEW_ACTIVE",
  UNRESOLVED_ASSOCIATIONS: "UNRESOLVED_ASSOCIATIONS",
  PRIVATE_WINDOW: "PRIVATE_WINDOW",
  INVALID_REQUEST: "INVALID_REQUEST",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const WORKSPACE_PACKAGE_ERROR_MESSAGES = Object.freeze({
  [WORKSPACE_PACKAGE_ERROR_CODES.PERMISSION_REQUIRED]:
    "Saving files is not available. Nothing was exported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE]:
    "This file can't be read as a workspace package.",
  [WORKSPACE_PACKAGE_ERROR_CODES.FILE_TOO_LARGE]:
    "That file is too large to import (limit 16 MiB).",
  [WORKSPACE_PACKAGE_ERROR_CODES.PACKAGE_TOO_LARGE]:
    "These workspaces and icons are too large to export (limit 16 MiB). Remove some custom icons and try again.",
  [WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE]:
    "This workspace package is damaged and was not imported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]:
    "This workspace package was made by a newer version of Terminus.",
  [WORKSPACE_PACKAGE_ERROR_CODES.NOTHING_TO_IMPORT]:
    "This workspace package contains no workspaces.",
  [WORKSPACE_PACKAGE_ERROR_CODES.WORKSPACE_LIMIT]:
    "Importing these workspaces would pass the maximum of 100. Nothing was imported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.RAIL_LIMIT]:
    "Importing these rail entries would pass the maximum of 200. Nothing was imported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.ICON_LIMIT]:
    "Importing these icons would pass the maximum of 100 custom icons. Nothing was imported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.SPLIT_VIEW_ACTIVE]:
    "A workspace is showing a Split View. Switch away from it and try again. Nothing was imported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.UNRESOLVED_ASSOCIATIONS]:
    "Current tabs belong to workspaces this setup cannot match one-to-one. Nothing was imported. Use Add to keep both setups.",
  [WORKSPACE_PACKAGE_ERROR_CODES.PRIVATE_WINDOW]:
    "Workspace packages are available in normal windows.",
  [WORKSPACE_PACKAGE_ERROR_CODES.INVALID_REQUEST]:
    "The workspace package request is invalid.",
  [WORKSPACE_PACKAGE_ERROR_CODES.STORAGE_UNAVAILABLE]:
    "Workspace storage is unavailable. Nothing was imported.",
  [WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR]:
    "The workspace package could not be completed."
});

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_PATTERN = /^[a-z0-9+/]*={0,2}$/i;
const DOCUMENT_KEYS = ["documentType", "schemaVersion", "createdAt", "payload"];
const PAYLOAD_KEYS = ["workspaces", "icons"];
const ICON_KEYS = ["id", "label", "digest", "byteLength", "dataBase64"];
// The file the user originally supplied, when the icon kept one. Optional
// because an icon added before originals were retained genuinely has none.
const ICON_SOURCE_KEYS = ["mimeType", "byteLength", "dataBase64"];
const ARCHIVE_ICON_KEYS = ["id", "label", "digest", "byteLength", "file", "source"];
const ARCHIVE_SOURCE_KEYS = ["mimeType", "byteLength", "file"];
const MAX_ARCHIVE_FILE_NAME_LENGTH = 200;

// base64 grows by 4/3; the cap keeps a hostile string from being decoded.
const MAX_ICON_BASE64_LENGTH = Math.ceil(CUSTOM_ICON_LIMITS.maxStoredBytes / 3) * 4;
const MAX_SOURCE_BASE64_LENGTH = Math.ceil(CUSTOM_ICON_LIMITS.maxSourceBytes / 3) * 4;

export class WorkspacePackageError extends Error {
  constructor(code, options = {}) {
    super(
      WORKSPACE_PACKAGE_ERROR_MESSAGES[code] ??
        WORKSPACE_PACKAGE_ERROR_MESSAGES[WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR],
      options
    );
    this.name = "WorkspacePackageError";
    this.code = WORKSPACE_PACKAGE_ERROR_MESSAGES[code]
      ? code
      : WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR;
  }
}

export function workspacePackageSuccess(result) {
  return { ok: true, result };
}

export function workspacePackageFailure(error) {
  // Neighbouring subsystems raise their own error types, and several of their
  // codes are ones this contract also defines - a refused downloads permission
  // above all. Keeping a code this contract owns stops a precise cause from
  // decaying into "could not be completed"; anything else is still internal.
  const code = error instanceof WorkspacePackageError || WORKSPACE_PACKAGE_ERROR_MESSAGES[error?.code]
    ? error.code
    : WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR;
  return { ok: false, error: { code, message: WORKSPACE_PACKAGE_ERROR_MESSAGES[code] } };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidPackage() {
  return new WorkspacePackageError(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE);
}

export function encodeWorkspacePackageBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw invalidPackage();
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function decodeWorkspacePackageBytes(encoded) {
  if (
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > MAX_ICON_BASE64_LENGTH ||
    !BASE64_PATTERN.test(encoded)
  ) {
    throw invalidPackage();
  }
  let binary;
  try {
    binary = atob(encoded);
  } catch {
    throw invalidPackage();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parsePackagedIconSource(value) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasExactKeys(value, ICON_SOURCE_KEYS)) throw invalidPackage();
  // A package can carry an arbitrary user file, so the type is held to the
  // same allowlist the picker uses and Terminus never renders it.
  if (!CUSTOM_ICON_SOURCE_MIME_TYPES.includes(value.mimeType)) throw invalidPackage();
  if (
    !Number.isInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    value.byteLength > CUSTOM_ICON_LIMITS.maxSourceBytes
  ) {
    throw invalidPackage();
  }
  if (
    typeof value.dataBase64 !== "string" ||
    value.dataBase64.length === 0 ||
    value.dataBase64.length > MAX_SOURCE_BASE64_LENGTH ||
    !BASE64_PATTERN.test(value.dataBase64)
  ) {
    throw invalidPackage();
  }
  return Object.freeze({
    mimeType: value.mimeType,
    byteLength: value.byteLength,
    dataBase64: value.dataBase64
  });
}

function parsePackagedIcon(value) {
  const withSource = [...ICON_KEYS, "source"];
  if (!isRecord(value) || !(hasExactKeys(value, ICON_KEYS) || hasExactKeys(value, withSource))) {
    throw invalidPackage();
  }
  if (!isCustomIconId(value.id)) throw invalidPackage();
  // The declared digest is a hint only; the import recomputes it from bytes.
  if (typeof value.digest !== "string" || !DIGEST_PATTERN.test(value.digest)) {
    throw invalidPackage();
  }
  if (
    !Number.isInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    value.byteLength > CUSTOM_ICON_LIMITS.maxStoredBytes
  ) {
    throw invalidPackage();
  }
  if (
    typeof value.dataBase64 !== "string" ||
    value.dataBase64.length === 0 ||
    value.dataBase64.length > MAX_ICON_BASE64_LENGTH ||
    !BASE64_PATTERN.test(value.dataBase64)
  ) {
    throw invalidPackage();
  }
  let label;
  try {
    label = parseCustomIconLabel(value.label);
  } catch {
    throw invalidPackage();
  }
  return Object.freeze({
    id: value.id,
    label,
    digest: value.digest,
    byteLength: value.byteLength,
    dataBase64: value.dataBase64,
    source: parsePackagedIconSource(value.source ?? null)
  });
}

function parseCreatedAt(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 40) {
    throw invalidPackage();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw invalidPackage();
  return value;
}

export function parseWorkspacePackage(value) {
  if (!isRecord(value) || !hasExactKeys(value, DOCUMENT_KEYS)) {
    throw new WorkspacePackageError(WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE);
  }
  if (value.documentType !== WORKSPACE_PACKAGE_DOCUMENT_TYPE) {
    throw new WorkspacePackageError(WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE);
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidPackage();
  }
  if (value.schemaVersion > WORKSPACE_PACKAGE_SCHEMA_VERSION) {
    throw new WorkspacePackageError(
      WORKSPACE_PACKAGE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
    );
  }
  const createdAt = parseCreatedAt(value.createdAt);
  if (!isRecord(value.payload) || !hasExactKeys(value.payload, PAYLOAD_KEYS)) {
    throw invalidPackage();
  }

  let workspaces;
  try {
    workspaces = parseWorkspaceStateWithoutContainers(value.payload.workspaces);
  } catch {
    throw invalidPackage();
  }

  if (!Array.isArray(value.payload.icons)) throw invalidPackage();
  if (value.payload.icons.length > CUSTOM_ICON_LIMITS.maxIcons) throw invalidPackage();
  const icons = value.payload.icons.map((icon) => parsePackagedIcon(icon));
  if (new Set(icons.map(({ id }) => id)).size !== icons.length) throw invalidPackage();

  return Object.freeze({
    documentType: WORKSPACE_PACKAGE_DOCUMENT_TYPE,
    schemaVersion: value.schemaVersion,
    createdAt,
    payload: Object.freeze({
      workspaces,
      icons: Object.freeze(icons)
    })
  });
}

export function createWorkspacePackage({ workspaces, rail, icons, createdAt }) {
  const document = {
    documentType: WORKSPACE_PACKAGE_DOCUMENT_TYPE,
    schemaVersion: WORKSPACE_PACKAGE_SCHEMA_VERSION,
    createdAt,
    payload: {
      workspaces: {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces,
        rail
      },
      icons
    }
  };
  // Building through the parser keeps a produced file and an imported file
  // held to exactly one contract.
  return parseWorkspacePackage(document);
}

// Builds the manifest for a parsed package. `fileNames` maps each icon id to
// the archive entries holding its PNG and, where one was kept, its original.
export function createWorkspaceArchiveManifest(document, fileNames) {
  return {
    documentType: WORKSPACE_ARCHIVE_DOCUMENT_TYPE,
    schemaVersion: WORKSPACE_ARCHIVE_SCHEMA_VERSION,
    createdAt: document.createdAt,
    payload: {
      workspaces: document.payload.workspaces,
      icons: document.payload.icons.map((icon) => {
        const names = fileNames.get(icon.id);
        return {
          id: icon.id,
          label: icon.label,
          digest: icon.digest,
          byteLength: icon.byteLength,
          file: names.file,
          source: icon.source === null
            ? null
            : {
              mimeType: icon.source.mimeType,
              byteLength: icon.source.byteLength,
              file: names.sourceFile
            }
        };
      })
    }
  };
}

function archiveFileBytes(files, name, byteLength, maxBytes) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_ARCHIVE_FILE_NAME_LENGTH ||
    name === WORKSPACE_ARCHIVE_MANIFEST_NAME ||
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > maxBytes
  ) {
    throw invalidPackage();
  }
  const bytes = files.get(name);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== byteLength) throw invalidPackage();
  return bytes;
}

// Reads a manifest and the archive files it names into a package document.
// Every field then passes the same parser a JSON package does.
export function workspacePackageFromArchive(
  manifest,
  files,
  { onDamagedSource = null } = {}
) {
  if (
    !isRecord(manifest) ||
    !hasExactKeys(manifest, DOCUMENT_KEYS) ||
    manifest.documentType !== WORKSPACE_ARCHIVE_DOCUMENT_TYPE
  ) {
    throw new WorkspacePackageError(WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE);
  }
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
    throw invalidPackage();
  }
  if (manifest.schemaVersion > WORKSPACE_ARCHIVE_SCHEMA_VERSION) {
    throw new WorkspacePackageError(WORKSPACE_PACKAGE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION);
  }
  if (!(files instanceof Map)) throw invalidPackage();
  if (
    !isRecord(manifest.payload) ||
    !hasExactKeys(manifest.payload, PAYLOAD_KEYS) ||
    !Array.isArray(manifest.payload.icons) ||
    manifest.payload.icons.length > CUSTOM_ICON_LIMITS.maxIcons
  ) {
    throw invalidPackage();
  }

  const icons = manifest.payload.icons.map((icon) => {
    if (!isRecord(icon) || !hasExactKeys(icon, ARCHIVE_ICON_KEYS)) throw invalidPackage();
    const bytes = archiveFileBytes(
      files,
      icon.file,
      icon.byteLength,
      CUSTOM_ICON_LIMITS.maxStoredBytes
    );
    let source = null;
    if (icon.source !== null) {
      try {
        if (!isRecord(icon.source) || !hasExactKeys(icon.source, ARCHIVE_SOURCE_KEYS)) {
          throw invalidPackage();
        }
        if (!CUSTOM_ICON_SOURCE_MIME_TYPES.includes(icon.source.mimeType)) {
          throw invalidPackage();
        }
        const sourceBytes = archiveFileBytes(
          files,
          icon.source.file,
          icon.source.byteLength,
          CUSTOM_ICON_LIMITS.maxSourceBytes
        );
        source = {
          mimeType: icon.source.mimeType,
          byteLength: icon.source.byteLength,
          dataBase64: encodeWorkspacePackageBytes(sourceBytes)
        };
      } catch {
        onDamagedSource?.({ id: icon.id, label: icon.label });
      }
    }
    return {
      id: icon.id,
      label: icon.label,
      digest: icon.digest,
      byteLength: icon.byteLength,
      dataBase64: encodeWorkspacePackageBytes(bytes),
      source
    };
  });

  return parseWorkspacePackage({
    documentType: WORKSPACE_PACKAGE_DOCUMENT_TYPE,
    schemaVersion: WORKSPACE_PACKAGE_SCHEMA_VERSION,
    createdAt: manifest.createdAt,
    payload: { workspaces: manifest.payload.workspaces, icons }
  });
}

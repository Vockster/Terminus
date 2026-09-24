import { errorDetail } from "./public-error-detail.js";
import {
  createDefaultSettingsState,
  createDefaultSettingsStateV26,
  createDefaultSettingsStateV27,
  createDefaultSettingsStateV28,
  createDefaultSettingsStateV29,
  createDefaultSettingsStateV30,
  createDefaultSettingsStateV31,
  createDefaultSettingsStateV32,
  createDefaultSettingsStateV33,
  SETTINGS_STATE_V14_SCHEMA_VERSION,
  SETTINGS_STATE_V16_SCHEMA_VERSION,
  SETTINGS_STATE_V17_SCHEMA_VERSION,
  SETTINGS_STATE_V19_SCHEMA_VERSION,
  SETTINGS_STATE_V20_SCHEMA_VERSION,
  SETTINGS_STATE_V21_SCHEMA_VERSION,
  SETTINGS_STATE_V22_SCHEMA_VERSION,
  SETTINGS_STATE_V23_SCHEMA_VERSION,
  SETTINGS_STATE_V24_SCHEMA_VERSION,
  SETTINGS_STATE_V25_SCHEMA_VERSION,
  SETTINGS_STATE_V26_SCHEMA_VERSION,
  SETTINGS_STATE_V27_SCHEMA_VERSION,
  SETTINGS_STATE_V28_SCHEMA_VERSION,
  SETTINGS_STATE_V29_SCHEMA_VERSION,
  SETTINGS_STATE_V30_SCHEMA_VERSION,
  SETTINGS_STATE_V31_SCHEMA_VERSION,
  SETTINGS_STATE_V32_SCHEMA_VERSION,
  SETTINGS_STATE_V33_SCHEMA_VERSION,
  migrateSettingsStateV7,
  migrateSettingsStateV8,
  migrateSettingsStateV9,
  migrateSettingsStateV10,
  migrateSettingsStateV11,
  migrateSettingsStateV12,
  migrateSettingsStateV13,
  migrateSettingsStateV14,
  migrateSettingsStateV15,
  migrateSettingsStateV16,
  migrateSettingsStateV17,
  migrateSettingsStateV18,
  migrateSettingsStateV19,
  migrateSettingsStateV20,
  migrateSettingsStateV21,
  migrateSettingsStateV22,
  migrateSettingsStateV23,
  migrateSettingsStateV24,
  migrateSettingsStateV25,
  migrateSettingsStateV26,
  migrateSettingsStateV27,
  migrateSettingsStateV28,
  migrateSettingsStateV29,
  migrateSettingsStateV30,
  migrateSettingsStateV31,
  migrateSettingsStateV32,
  migrateSettingsStateV33,
  parseSettingsState,
  parseSettingsStateV7,
  parseSettingsStateV8,
  parseSettingsStateV9,
  parseSettingsStateV10,
  parseSettingsStateV11,
  parseSettingsStateV12,
  parseSettingsStateV13,
  parseSettingsStateV14,
  parseSettingsStateV16,
  parseSettingsStateV17,
  parseSettingsStateV19,
  parseSettingsStateV20,
  parseSettingsStateV21,
  parseSettingsStateV22,
  parseSettingsStateV23,
  parseSettingsStateV24,
  parseSettingsStateV25,
  parseSettingsStateV26,
  parseSettingsStateV27,
  parseSettingsStateV28,
  parseSettingsStateV29,
  parseSettingsStateV30,
  parseSettingsStateV31,
  parseSettingsStateV32,
  parseSettingsStateV33
} from "./settings-state.js";
import { WORKSPACE_RUNTIME_SCHEMA_VERSION, parseWorkspaceRuntime } from "./workspace-runtime.js";
import {
  migrateWorkspaceStateV4,
  parseWorkspaceState,
  parseWorkspaceStateV4
} from "./workspace-state.js";
import {
  noContainerAssignment,
  parseContainerAssignment,
  parseContainerCatalog
} from "./containers.js";

export const SNAPSHOT_LEGACY_SCHEMA_VERSION = 1;
export const SNAPSHOT_PREVIOUS_SCHEMA_VERSION = 2;
export const SNAPSHOT_SCHEMA_VERSION = 3;
export const SNAPSHOT_INDEX_SCHEMA_VERSION = 1;
export const SETTINGS_BACKUP_LEGACY_SCHEMA_VERSION = 1;
export const SETTINGS_BACKUP_V2_SCHEMA_VERSION = 2;
export const SETTINGS_BACKUP_PREVIOUS_SCHEMA_VERSION = 3;
export const SETTINGS_BACKUP_V4_SCHEMA_VERSION = 4;
export const SETTINGS_BACKUP_V5_SCHEMA_VERSION = 5;
export const SETTINGS_BACKUP_V6_SCHEMA_VERSION = 6;
export const SETTINGS_BACKUP_V7_SCHEMA_VERSION = 7;
export const SETTINGS_BACKUP_V8_SCHEMA_VERSION = 8;
export const SETTINGS_BACKUP_V9_SCHEMA_VERSION = 9;
export const SETTINGS_BACKUP_V10_SCHEMA_VERSION = 10;
export const SETTINGS_BACKUP_V11_SCHEMA_VERSION = 11;
export const SETTINGS_BACKUP_V12_SCHEMA_VERSION = 12;
export const SETTINGS_BACKUP_V13_SCHEMA_VERSION = 13;
export const SETTINGS_BACKUP_V14_SCHEMA_VERSION = 14;
export const SETTINGS_BACKUP_V15_SCHEMA_VERSION = 15;
export const SETTINGS_BACKUP_V16_SCHEMA_VERSION = 16;
export const SETTINGS_BACKUP_V17_SCHEMA_VERSION = 17;
export const SETTINGS_BACKUP_V18_SCHEMA_VERSION = 18;
export const SETTINGS_BACKUP_V19_SCHEMA_VERSION = 19;
export const SETTINGS_BACKUP_V20_SCHEMA_VERSION = 20;
export const SETTINGS_BACKUP_V21_SCHEMA_VERSION = 21;
export const SETTINGS_BACKUP_V22_SCHEMA_VERSION = 22;
export const SETTINGS_BACKUP_V23_SCHEMA_VERSION = 23;
export const SETTINGS_BACKUP_V24_SCHEMA_VERSION = 24;
export const SETTINGS_BACKUP_V25_SCHEMA_VERSION = 25;
export const SETTINGS_BACKUP_V26_SCHEMA_VERSION = 26;
export const SETTINGS_BACKUP_SCHEMA_VERSION = 27;
export const SNAPSHOT_SCHEDULE_SCHEMA_VERSION = 3;
export const RESTORE_JOURNAL_SCHEMA_VERSION = 1;

export const SNAPSHOT_DOCUMENT_TYPE = "sidebars.snapshot";
export const SETTINGS_BACKUP_DOCUMENT_TYPE = "sidebars.settings";
export const SNAPSHOT_MASTER_STORAGE_KEY = "snapshotMaster";
export const SNAPSHOT_INDEX_STORAGE_KEY = "snapshotIndex";
export const SNAPSHOT_RECORD_STORAGE_PREFIX = "snapshotRecord:";
export const SNAPSHOT_SCHEDULE_STORAGE_KEY = "snapshotScheduleState";
export const SNAPSHOT_RESTORE_JOURNAL_STORAGE_KEY = "snapshotRestoreJournal";
export const SNAPSHOT_LAST_RESTORE_REPORT_STORAGE_KEY = "snapshotLastRestoreReport";
export const SETTINGS_BACKUP_LAST_RESTORE_REPORT_STORAGE_KEY = "settingsBackupLastRestoreReport";
export const SETTINGS_BACKUP_RECORD_STORAGE_PREFIX = "settingsBackupRecord:";
export const SNAPSHOT_CAPTURE_ALARM_NAME = "sidebars.snapshot.capture";
export const SNAPSHOT_CLEANUP_ALARM_NAME = "sidebars.snapshot.cleanup";
export const SNAPSHOT_TEST_ALARM_NAME = "sidebars.snapshot.test";
export const SNAPSHOT_PRIVATE_TEST_ALARM_NAME = "sidebars.snapshot.private-test";

export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

export const SNAPSHOT_KINDS = Object.freeze({
  AUTOMATIC: "automatic",
  MANUAL: "manual",
  SAFETY: "safety",
  MASTER: "master"
});

export const SNAPSHOT_AUTOMATIC_LIBRARIES = Object.freeze({
  SIDEBAR: "sidebar",
  SETTINGS: "settings",
  PRIVATE: "private"
});

export const SETTINGS_BACKUP_KINDS = Object.freeze({
  AUTOMATIC: "automatic",
  MANUAL: "manual"
});

export const SETTINGS_BACKUP_REASONS = Object.freeze({
  FIREFOX_SYNC_IMPORT: "firefox-sync-import"
});

export const SNAPSHOT_RESTORE_MODES = Object.freeze({
  OVERWRITE: "overwrite",
  REUSE_WORKSPACES: "reuse-workspaces",
  DUPLICATE_WORKSPACES: "duplicate-workspaces",
  COPY: "copy",
  REPLACE: "replace"
});

export const SNAPSHOT_RESTORE_SCOPES = Object.freeze({
  ALL: "all",
  WINDOW: "window",
  WORKSPACE: "workspace",
  TABS: "tabs",
  SETTINGS: "settings"
});

export const SNAPSHOT_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_BACKUP: "INVALID_BACKUP",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
  NOT_FOUND: "NOT_FOUND",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  PERMISSION_REQUIRED: "PERMISSION_REQUIRED",
  CONTAINER_RESOLUTION_REQUIRED: "CONTAINER_RESOLUTION_REQUIRED",
  CONTAINER_UNAVAILABLE: "CONTAINER_UNAVAILABLE",
  CONTAINER_MISMATCH: "CONTAINER_MISMATCH",
  RESTORE_BLOCKED: "RESTORE_BLOCKED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const SNAPSHOT_ERROR_MESSAGES = Object.freeze({
  [SNAPSHOT_ERROR_CODES.INVALID_REQUEST]: "The snapshot request is invalid.",
  [SNAPSHOT_ERROR_CODES.INVALID_BACKUP]: "The backup file is invalid and was not applied.",
  [SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]:
    "The backup uses an unsupported schema version and was not applied.",
  [SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED]:
    "The backup integrity check failed and no changes were made.",
  [SNAPSHOT_ERROR_CODES.NOT_FOUND]: "The requested snapshot could not be found.",
  [SNAPSHOT_ERROR_CODES.STORAGE_UNAVAILABLE]:
    "Snapshot storage is unavailable. No destructive changes were made.",
  [SNAPSHOT_ERROR_CODES.PERMISSION_REQUIRED]:
    "Firefox Downloads permission is required for this file operation.",
  [SNAPSHOT_ERROR_CODES.CONTAINER_RESOLUTION_REQUIRED]:
    "Choose how the snapshot's Firefox containers should be restored.",
  [SNAPSHOT_ERROR_CODES.CONTAINER_UNAVAILABLE]:
    "A Firefox container selected for restore is unavailable. Refresh the mapping and try again.",
  [SNAPSHOT_ERROR_CODES.CONTAINER_MISMATCH]:
    "Firefox did not create a restored tab in the selected container. Original tabs were retained.",
  [SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED]:
    "The snapshot cannot be restored while another workspace operation is unfinished.",
  [SNAPSHOT_ERROR_CODES.INTERNAL_ERROR]: "The snapshot operation could not be completed."
});

const LOGICAL_ID_PATTERN = /^(?:tab|window|group|split)-[a-z0-9][a-z0-9-]{0,127}$/;
const SNAPSHOT_ID_PATTERN = /^snapshot-[a-z0-9][a-z0-9-]{0,127}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const WINDOW_STATES = new Set(["normal", "minimized", "maximized", "fullscreen"]);
const KIND_VALUES = new Set(Object.values(SNAPSHOT_KINDS));

function migrateSettingsStateV14ToV25(value) {
  return migrateSettingsStateV24(migrateSettingsStateV23(migrateSettingsStateV22(migrateSettingsStateV21(migrateSettingsStateV20(migrateSettingsStateV19(migrateSettingsStateV18(migrateSettingsStateV17(
    migrateSettingsStateV16(migrateSettingsStateV15(migrateSettingsStateV14(value)))
  ))))))));
}

function migrateSettingsStateV25ToCurrent(value) {
  return migrateSettingsStateV32ToCurrent(migrateSettingsStateV31(migrateSettingsStateV30(migrateSettingsStateV29(migrateSettingsStateV28(
    migrateSettingsStateV27(migrateSettingsStateV26(migrateSettingsStateV25(value)))
  )))));
}

function migrateSettingsStateV32ToCurrent(value) {
  return migrateSettingsStateV33(migrateSettingsStateV32(value));
}

function migrateSettingsStateV14ToCurrent(value) {
  return migrateSettingsStateV25ToCurrent(migrateSettingsStateV14ToV25(value));
}

function migrateSettingsStateV21ToCurrent(value) {
  return migrateSettingsStateV25ToCurrent(
    migrateSettingsStateV24(migrateSettingsStateV23(migrateSettingsStateV22(migrateSettingsStateV21(value))))
  );
}

// Settings Backup schemas 14-18 could carry the selected uploaded font. Those
// records are only shape-checked so older digests still verify; the font is
// then discarded because custom fonts are no longer supported.
const LEGACY_FONT_KEYS = Object.freeze([
  "id", "digest", "family", "name", "format", "mimeType", "byteLength", "createdAt", "dataBase64"
]);
const LEGACY_FONT_ID_PATTERN = /^font-[a-f0-9]{64}$/;
const LEGACY_FONT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LEGACY_FONT_MAX_BYTES = 5 * 1024 * 1024;
const LEGACY_FONT_MAX_BASE64_LENGTH = Math.ceil(LEGACY_FONT_MAX_BYTES / 3) * 4;
const LEGACY_FONT_MIME_BY_FORMAT = Object.freeze({
  woff2: "font/woff2",
  woff: "font/woff",
  truetype: "font/ttf",
  opentype: "font/otf"
});

function parseLegacyPortableFontAsset(value) {
  if (!isRecord(value) || !hasExactKeys(value, LEGACY_FONT_KEYS)) {
    throw invalidBackup("A legacy font record has an invalid shape.");
  }
  if (
    typeof value.id !== "string" || !LEGACY_FONT_ID_PATTERN.test(value.id) ||
    typeof value.digest !== "string" || !DIGEST_PATTERN.test(value.digest) ||
    value.id !== `font-${value.digest}` ||
    // Retired records carry the name they were written with. This must keep
    // the former spelling after the rename to Terminus, or previously
    // exported backups stop validating.
    value.family !== `Sidebars Uploaded ${value.digest.slice(0, 12).toUpperCase()}` ||
    typeof value.name !== "string" || value.name.length < 1 || value.name.length > 120 ||
    !Object.hasOwn(LEGACY_FONT_MIME_BY_FORMAT, value.format) ||
    value.mimeType !== LEGACY_FONT_MIME_BY_FORMAT[value.format] ||
    !Number.isInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > LEGACY_FONT_MAX_BYTES ||
    typeof value.createdAt !== "string" || !LEGACY_FONT_DATE_PATTERN.test(value.createdAt) ||
    (value.dataBase64 !== null && (
      typeof value.dataBase64 !== "string" ||
      value.dataBase64.length > LEGACY_FONT_MAX_BASE64_LENGTH ||
      !/^[a-z0-9+/]*={0,2}$/i.test(value.dataBase64)
    ))
  ) {
    throw invalidBackup("A legacy font record is invalid.");
  }
  return { ...value };
}

export class SnapshotError extends Error {
  constructor(code, message = SNAPSHOT_ERROR_MESSAGES[code], options = {}) {
    super(message, options);
    this.name = "SnapshotError";
    this.code = code;
    this.detail = errorDetail(options);
  }
}

function invalidBackup(reason) {
  return new SnapshotError(
    SNAPSHOT_ERROR_CODES.INVALID_BACKUP,
    `${SNAPSHOT_ERROR_MESSAGES[SNAPSHOT_ERROR_CODES.INVALID_BACKUP]} ${reason}`,
    { detail: String(reason) }
  );
}

function unsupportedVersion() {
  return new SnapshotError(
    SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
    SNAPSHOT_ERROR_MESSAGES[SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actualKeys.length === expected.length && actualKeys.every((key, index) => key === expected[index]);
}

function parseIsoDate(value, label, { nullable = false } = {}) {
  if (nullable && value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw invalidBackup(`${label} is not a valid timestamp.`);
  }
  return new Date(value).toISOString();
}

function parseLogicalId(value, kind, label) {
  if (
    typeof value !== "string" ||
    !LOGICAL_ID_PATTERN.test(value) ||
    !value.startsWith(`${kind}-`)
  ) {
    throw invalidBackup(`${label} has an invalid logical ID.`);
  }
  return value;
}

function parseGeometry(value, label) {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, ["left", "top", "width", "height", "state"])) {
    throw invalidBackup(`${label} has invalid geometry.`);
  }
  for (const key of ["left", "top", "width", "height"]) {
    if (!Number.isInteger(value[key])) {
      throw invalidBackup(`${label} geometry ${key} must be an integer.`);
    }
  }
  if (value.width < 100 || value.height < 100 || !WINDOW_STATES.has(value.state)) {
    throw invalidBackup(`${label} geometry is outside the supported range.`);
  }
  return {
    left: value.left,
    top: value.top,
    width: value.width,
    height: value.height,
    state: value.state
  };
}

function parseSnapshotTabV2(value, label) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "url", "title", "active", "highlighted", "discarded"])
  ) {
    throw invalidBackup(`${label} has an invalid shape.`);
  }
  const id = parseLogicalId(value.id, "tab", label);
  if (typeof value.url !== "string" || value.url.length === 0 || value.url.length > 16384) {
    throw invalidBackup(`${label} has an invalid URL.`);
  }
  if (typeof value.title !== "string" || value.title.length > 4096) {
    throw invalidBackup(`${label} has an invalid title.`);
  }
  for (const key of ["active", "highlighted", "discarded"]) {
    if (typeof value[key] !== "boolean") {
      throw invalidBackup(`${label} ${key} state must be a boolean.`);
    }
  }
  return {
    id,
    url: value.url,
    title: value.title,
    active: value.active,
    highlighted: value.highlighted,
    discarded: value.discarded
  };
}

function parseSnapshotTab(value, label) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "url",
      "title",
      "active",
      "highlighted",
      "discarded",
      "container"
    ])
  ) {
    throw invalidBackup(`${label} has an invalid shape.`);
  }
  const parsed = parseSnapshotTabV2(
    {
      id: value.id,
      url: value.url,
      title: value.title,
      active: value.active,
      highlighted: value.highlighted,
      discarded: value.discarded
    },
    label
  );
  try {
    return { ...parsed, container: parseContainerAssignment(value.container, invalidBackup) };
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw invalidBackup(`${label} has an invalid container assignment.`);
  }
}

function parseSnapshotLayout(value, label, tabParser = parseSnapshotTab) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "workspaceId",
      "tabs",
      "pinnedTabIds",
      "groups",
      "tree",
      "splitViews"
    ])
  ) {
    throw invalidBackup(`${label} has an invalid shape.`);
  }
  if (!Array.isArray(value.tabs)) {
    throw invalidBackup(`${label} tabs must be an array.`);
  }
  const tabs = value.tabs.map((tab, index) => tabParser(tab, `${label} tab ${index}`));
  const ids = new Set(tabs.map(({ id }) => id));
  if (ids.size !== tabs.length) {
    throw invalidBackup(`${label} contains duplicate tabs.`);
  }
  return {
    workspaceId: value.workspaceId,
    tabs,
    pinnedTabIds: structuredClone(value.pinnedTabIds),
    groups: structuredClone(value.groups),
    tree: structuredClone(value.tree),
    splitViews: structuredClone(value.splitViews)
  };
}

function runtimeFromSnapshotWindows(windows) {
  const tabs = [];
  const runtimeWindows = [];
  for (const window of windows) {
    const workspaceLayouts = window.workspaceLayouts.map((layout) => {
      for (const tab of layout.tabs) {
        tabs.push({ id: tab.id, workspaceId: layout.workspaceId });
      }
      return {
        workspaceId: layout.workspaceId,
        tabIds: layout.tabs.map(({ id }) => id),
        pinnedTabIds: layout.pinnedTabIds,
        groups: layout.groups,
        tree: layout.tree,
        splitViews: layout.splitViews
      };
    });
    runtimeWindows.push({
      id: window.id,
      activeWorkspaceId: window.activeWorkspaceId,
      selectedTabs: window.selectedTabs,
      workspaceLayouts,
      pendingOperation: null
    });
  }
  return { schemaVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION, tabs, windows: runtimeWindows };
}

function parseSnapshotWindows(value, workspaceState, tabParser = parseSnapshotTab) {
  if (!Array.isArray(value)) {
    throw invalidBackup("Snapshot windows must be an array.");
  }
  const windowIds = new Set();
  const tabIds = new Set();
  const windows = value.map((entry, windowIndex) => {
    const label = `Snapshot window ${windowIndex}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "id",
        "geometry",
        "activeWorkspaceId",
        "selectedTabs",
        "workspaceLayouts"
      ])
    ) {
      throw invalidBackup(`${label} has an invalid shape.`);
    }
    const id = parseLogicalId(entry.id, "window", label);
    if (windowIds.has(id)) {
      throw invalidBackup("Snapshot window IDs must be unique.");
    }
    windowIds.add(id);
    if (!Array.isArray(entry.selectedTabs) || !Array.isArray(entry.workspaceLayouts)) {
      throw invalidBackup(`${label} selections and layouts must be arrays.`);
    }
    const workspaceLayouts = entry.workspaceLayouts.map((layout, layoutIndex) =>
      parseSnapshotLayout(layout, `${label} layout ${layoutIndex}`, tabParser)
    );
    for (const layout of workspaceLayouts) {
      for (const tab of layout.tabs) {
        if (tabIds.has(tab.id)) {
          throw invalidBackup("A snapshot tab can appear in only one saved window.");
        }
        tabIds.add(tab.id);
      }
    }
    return {
      id,
      geometry: parseGeometry(entry.geometry, label),
      activeWorkspaceId: entry.activeWorkspaceId,
      selectedTabs: structuredClone(entry.selectedTabs),
      workspaceLayouts
    };
  });

  try {
    parseWorkspaceRuntime(
      runtimeFromSnapshotWindows(windows),
      workspaceState.workspaces.map(({ id }) => id)
    );
  } catch (error) {
    throw invalidBackup(`The snapshot layout is inconsistent. ${error.message}`);
  }
  return windows;
}

export function parseSnapshotPayload(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["workspaceState", "windows", "containerCatalog"])
  ) {
    throw invalidBackup("The snapshot payload has an invalid shape.");
  }
  const workspaceState = parseWorkspaceState(value.workspaceState);
  const windows = parseSnapshotWindows(value.windows, workspaceState);
  let containerCatalog;
  try {
    containerCatalog = parseContainerCatalog(value.containerCatalog, invalidBackup);
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw invalidBackup("The snapshot container catalog is invalid.");
  }
  const referenced = new Set([
    ...workspaceState.workspaces.flatMap(({ defaultContainerRef }) =>
      defaultContainerRef === null ? [] : [defaultContainerRef]
    ),
    ...windows.flatMap(({ workspaceLayouts }) => workspaceLayouts.flatMap(({ tabs }) =>
      tabs.flatMap(({ container }) => container.kind === "container" ? [container.refId] : [])
    ))
  ]);
  const catalogRefs = new Set(containerCatalog.map(({ refId }) => refId));
  if (
    referenced.size !== catalogRefs.size ||
    [...referenced].some((refId) => !catalogRefs.has(refId))
  ) {
    throw invalidBackup("The snapshot container catalog does not match its references.");
  }
  return {
    workspaceState,
    windows,
    containerCatalog
  };
}

function parsePreviousSnapshotPayload(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["workspaceState", "windows"])) {
    throw invalidBackup("The previous snapshot payload has an invalid shape.");
  }
  const workspaceState = parseWorkspaceStateV4(value.workspaceState);
  return {
    workspaceState,
    windows: parseSnapshotWindows(value.windows, workspaceState, parseSnapshotTabV2)
  };
}

export function parsePrivateSnapshotPayload(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["workspaceState", "windows"])) {
    throw invalidBackup("The private snapshot payload has an invalid shape.");
  }
  const workspaceState = parseWorkspaceState(value.workspaceState);
  if (workspaceState.workspaces.some(({ defaultContainerRef }) => defaultContainerRef !== null)) {
    throw invalidBackup("Private snapshots cannot contain container defaults.");
  }
  return {
    workspaceState,
    windows: parseSnapshotWindows(value.windows, workspaceState, parseSnapshotTabV2)
  };
}

// Adopts an ordinary snapshot payload into private scope, which has no
// containers: parsePrivateSnapshotPayload refuses a workspace default, and a
// private tab carries no container key at all. This direction only. A private
// payload is never widened into a normal one, because that would turn private
// browsing into durable normal storage.
export function toPrivateSnapshotPayload(value) {
  const payload = parseSnapshotPayload(value);
  return parsePrivateSnapshotPayload({
    workspaceState: {
      ...payload.workspaceState,
      workspaces: payload.workspaceState.workspaces.map((workspace) => ({
        ...workspace,
        defaultContainerRef: null
      }))
    },
    windows: payload.windows.map((window) => ({
      ...window,
      workspaceLayouts: window.workspaceLayouts.map((layout) => ({
        ...layout,
        // Named rather than spread: a private tab is an exact key set, so a new
        // normal-only field has to be considered here instead of silently
        // failing the parser it is handed to.
        tabs: layout.tabs.map(({ id, url, title, active, highlighted, discarded }) => ({
          id,
          url,
          title,
          active,
          highlighted,
          discarded
        }))
      }))
    }))
  });
}

function parseLegacySnapshotPayload(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["workspaceState", "settings", "windows"])) {
    throw invalidBackup("The legacy snapshot payload has an invalid shape.");
  }
  const workspaceState = parseWorkspaceStateV4(value.workspaceState);
  return {
    workspaceState,
    settings: parseSettingsStateV7(value.settings),
    windows: parseSnapshotWindows(value.windows, workspaceState, parseSnapshotTabV2)
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function digestSnapshotPayload(payload) {
  const bytes = new TextEncoder().encode(canonicalJson(parseSnapshotPayload(payload)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestPrivateSnapshotPayload(payload) {
  return digestJsonPayload(parsePrivateSnapshotPayload(payload));
}

function migrateSnapshotPayloadV2(payload) {
  const previous = parsePreviousSnapshotPayload(payload);
  return parseSnapshotPayload({
    workspaceState: migrateWorkspaceStateV4(previous.workspaceState),
    windows: previous.windows.map((window) => ({
      ...window,
      workspaceLayouts: window.workspaceLayouts.map((layout) => ({
        ...layout,
        tabs: layout.tabs.map((tab) => ({
          ...tab,
          container: noContainerAssignment()
        }))
      }))
    })),
    containerCatalog: []
  });
}

function parseSnapshotRecordVersion(value, schemaVersion, payloadParser) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "documentType",
      "schemaVersion",
      "id",
      "kind",
      "createdAt",
      "reason",
      "payloadDigest",
      "payload"
    ])
  ) {
    throw invalidBackup("The snapshot document has an invalid shape.");
  }
  if (value.documentType !== SNAPSHOT_DOCUMENT_TYPE) {
    throw invalidBackup("The document is not a Terminus snapshot.");
  }
  if (value.schemaVersion !== schemaVersion) {
    throw invalidBackup("The snapshot schema version is invalid.");
  }
  if (typeof value.id !== "string" || !SNAPSHOT_ID_PATTERN.test(value.id)) {
    throw invalidBackup("The snapshot ID is invalid.");
  }
  if (!KIND_VALUES.has(value.kind)) {
    throw invalidBackup("The snapshot kind is invalid.");
  }
  if (
    value.reason !== null &&
    (typeof value.reason !== "string" || value.reason.length === 0 || value.reason.length > 160)
  ) {
    throw invalidBackup("The snapshot reason is invalid.");
  }
  if (typeof value.payloadDigest !== "string" || !DIGEST_PATTERN.test(value.payloadDigest)) {
    throw invalidBackup("The snapshot digest is invalid.");
  }
  return {
    documentType: SNAPSHOT_DOCUMENT_TYPE,
    schemaVersion,
    id: value.id,
    kind: value.kind,
    createdAt: parseIsoDate(value.createdAt, "Snapshot creation time"),
    reason: value.reason,
    payloadDigest: value.payloadDigest,
    payload: payloadParser(value.payload)
  };
}

export function parseSnapshotRecord(value) {
  if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > SNAPSHOT_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  return parseSnapshotRecordVersion(value, SNAPSHOT_SCHEMA_VERSION, parseSnapshotPayload);
}

function parseLegacySnapshotRecord(value) {
  return parseSnapshotRecordVersion(
    value,
    SNAPSHOT_LEGACY_SCHEMA_VERSION,
    parseLegacySnapshotPayload
  );
}

function parsePreviousSnapshotRecord(value) {
  return parseSnapshotRecordVersion(
    value,
    SNAPSHOT_PREVIOUS_SCHEMA_VERSION,
    parsePreviousSnapshotPayload
  );
}

export async function verifySnapshotRecord(value) {
  const isLegacy = value?.schemaVersion === SNAPSHOT_LEGACY_SCHEMA_VERSION;
  const isPrevious = value?.schemaVersion === SNAPSHOT_PREVIOUS_SCHEMA_VERSION;
  const record = isLegacy
    ? parseLegacySnapshotRecord(value)
    : isPrevious
      ? parsePreviousSnapshotRecord(value)
      : parseSnapshotRecord(value);
  const verifiedDigest = isLegacy || isPrevious
    ? await digestJsonPayload(record.payload)
    : await digestSnapshotPayload(record.payload);
  if (verifiedDigest !== record.payloadDigest) {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED);
  }
  if (isLegacy || isPrevious) {
    return createSnapshotRecord({
      id: record.id,
      kind: record.kind,
      createdAt: record.createdAt,
      reason: record.reason,
      payload: migrateSnapshotPayloadV2({
        workspaceState: record.payload.workspaceState,
        windows: record.payload.windows
      })
    });
  }
  return record;
}

export async function createSnapshotRecord({ id, kind, createdAt, reason = null, payload }) {
  const parsedPayload = parseSnapshotPayload(payload);
  return parseSnapshotRecord({
    documentType: SNAPSHOT_DOCUMENT_TYPE,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    kind,
    createdAt,
    reason,
    payloadDigest: await digestSnapshotPayload(parsedPayload),
    payload: parsedPayload
  });
}

export function createDefaultSnapshotIndex() {
  return { schemaVersion: SNAPSHOT_INDEX_SCHEMA_VERSION, entries: [], tombstones: [] };
}

function parseDownloadIds(value, label) {
  if (!Array.isArray(value)) {
    throw invalidBackup(`${label} download IDs must be an array.`);
  }
  const ids = value.map((id) => {
    if (!Number.isInteger(id) || id < 0) {
      throw invalidBackup(`${label} contains an invalid download ID.`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw invalidBackup(`${label} contains duplicate download IDs.`);
  }
  return ids;
}

export function snapshotIndexEntry(record, { byteLength, downloadIds = [] } = {}) {
  const parsed = parseSnapshotRecord(record);
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > MAX_BACKUP_BYTES) {
    throw invalidBackup("The snapshot byte length is invalid.");
  }
  return {
    id: parsed.id,
    kind: parsed.kind,
    createdAt: parsed.createdAt,
    payloadDigest: parsed.payloadDigest,
    byteLength,
    downloadIds: parseDownloadIds(downloadIds, "Snapshot index entry")
  };
}

export function parseSnapshotIndex(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "entries", "tombstones"])
  ) {
    throw invalidBackup("The snapshot index has an invalid shape.");
  }
  if (value.schemaVersion !== SNAPSHOT_INDEX_SCHEMA_VERSION) {
    if (Number.isInteger(value.schemaVersion) && value.schemaVersion > SNAPSHOT_INDEX_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidBackup("The snapshot index version is invalid.");
  }
  if (!Array.isArray(value.entries) || !Array.isArray(value.tombstones)) {
    throw invalidBackup("The snapshot index collections must be arrays.");
  }
  const entryIds = new Set();
  const entries = value.entries.map((entry, index) => {
    const label = `Snapshot index entry ${index}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "id",
        "kind",
        "createdAt",
        "payloadDigest",
        "byteLength",
        "downloadIds"
      ])
    ) {
      throw invalidBackup(`${label} has an invalid shape.`);
    }
    if (typeof entry.id !== "string" || !SNAPSHOT_ID_PATTERN.test(entry.id) || entryIds.has(entry.id)) {
      throw invalidBackup(`${label} has an invalid or duplicate ID.`);
    }
    entryIds.add(entry.id);
    if (!KIND_VALUES.has(entry.kind) || entry.kind === SNAPSHOT_KINDS.MASTER) {
      throw invalidBackup(`${label} has an invalid kind.`);
    }
    if (typeof entry.payloadDigest !== "string" || !DIGEST_PATTERN.test(entry.payloadDigest)) {
      throw invalidBackup(`${label} has an invalid digest.`);
    }
    if (!Number.isInteger(entry.byteLength) || entry.byteLength < 1 || entry.byteLength > MAX_BACKUP_BYTES) {
      throw invalidBackup(`${label} has an invalid byte length.`);
    }
    return {
      id: entry.id,
      kind: entry.kind,
      createdAt: parseIsoDate(entry.createdAt, `${label} creation time`),
      payloadDigest: entry.payloadDigest,
      byteLength: entry.byteLength,
      downloadIds: parseDownloadIds(entry.downloadIds, label)
    };
  });
  const tombstones = value.tombstones.map((id) => {
    if (typeof id !== "string" || !SNAPSHOT_ID_PATTERN.test(id) || entryIds.has(id)) {
      throw invalidBackup("The snapshot index contains an invalid tombstone.");
    }
    return id;
  });
  if (new Set(tombstones).size !== tombstones.length) {
    throw invalidBackup("The snapshot index contains duplicate tombstones.");
  }
  return { schemaVersion: SNAPSHOT_INDEX_SCHEMA_VERSION, entries, tombstones };
}

export function createSettingsBackup({ createdAt, settings }) {
  return { createdAt, payload: { settings: createSettingsBackupProjection(settings) } };
}

export function createSettingsBackupProjection(settings) {
  const parsed = parseSettingsState(settings);
  return projectSettingsBackup(parsed);
}

function projectSettingsBackup(parsed) {
  return {
    sidebar: parsed.sidebar,
    appearance: parsed.appearance,
    snapshots: parsed.snapshots,
    navigation: parsed.navigation,
    privacy: parsed.privacy
  };
}

function projectLegacySettingsBackup(parsed) {
  const { privacy: _privacy, ...projection } = projectSettingsBackup(parsed);
  return projection;
}

function parseSettingsBackupProjectionV8(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  try {
    return projectLegacySettingsBackup(parseSettingsStateV14({
      ...defaults,
      privacy: { keepPrivateTabsBetweenSessions: false },
      schemaVersion: SETTINGS_STATE_V14_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV10(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  try {
    return projectLegacySettingsBackup(parseSettingsStateV16({
      ...defaults,
      schemaVersion: SETTINGS_STATE_V16_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV11(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  try {
    return projectLegacySettingsBackup(parseSettingsStateV17({
      ...defaults,
      schemaVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV12(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  try {
    return projectLegacySettingsBackup(parseSettingsStateV19({
      ...defaults,
      schemaVersion: SETTINGS_STATE_V19_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV13(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  try {
    return projectLegacySettingsBackup(parseSettingsStateV20({
      ...defaults,
      schemaVersion: SETTINGS_STATE_V20_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV14(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  try {
    return projectLegacySettingsBackup(parseSettingsStateV21({
      ...defaults,
      schemaVersion: SETTINGS_STATE_V21_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV15(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  const defaults = createDefaultSettingsStateV26();
  let parsed;
  try {
    const projected = {
      ...defaults,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    };
    parsed = Object.prototype.hasOwnProperty.call(value.sidebar, "railSize")
      ? migrateSettingsStateV22(parseSettingsStateV22({
          ...projected,
          schemaVersion: SETTINGS_STATE_V22_SCHEMA_VERSION
        }))
      : parseSettingsStateV23({
          ...projected,
          schemaVersion: SETTINGS_STATE_V23_SCHEMA_VERSION
        });
  } catch (error) {
    throw invalidBackup(error.message);
  }
  return projectSettingsBackup(parsed);
}

function parseSettingsBackupProjectionV16(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV24({
      ...createDefaultSettingsStateV26(),
      schemaVersion: SETTINGS_STATE_V24_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV25(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV25({
      ...createDefaultSettingsStateV26(),
      schemaVersion: SETTINGS_STATE_V25_SCHEMA_VERSION,
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV26(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV26({
      ...createDefaultSettingsStateV26(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV27(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV27({
      ...createDefaultSettingsStateV27(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV28(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV28({
      ...createDefaultSettingsStateV28(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV29(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV29({
      ...createDefaultSettingsStateV29(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV30(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV30({
      ...createDefaultSettingsStateV30(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV31(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV31({
      ...createDefaultSettingsStateV31(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV32(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV32({
      ...createDefaultSettingsStateV32(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjectionV33(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsStateV33({
      ...createDefaultSettingsStateV33(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function parseSettingsBackupProjection(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sidebar", "appearance", "snapshots", "navigation", "privacy"])
  ) {
    throw invalidBackup("The portable settings projection has an invalid shape.");
  }
  try {
    return projectSettingsBackup(parseSettingsState({
      ...createDefaultSettingsState(),
      sidebar: value.sidebar,
      appearance: value.appearance,
      snapshots: value.snapshots,
      navigation: value.navigation,
      privacy: value.privacy
    }));
  } catch (error) {
    throw invalidBackup(error.message);
  }
}

function addCurrentTypographyToSettingsProjection(projection) {
  const defaults = createDefaultSettingsStateV26();
  let settings = parseSettingsStateV17({
    ...defaults,
    ...projection,
    schemaVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
    appearance: {
      ...projection.appearance,
      typography: {
        customFontEnabled: false,
        fontFamily: "system-ui",
        fontSize: defaults.appearance.typography.fontSize
      }
    }
  });
  settings = migrateSettingsStateV17(settings);
  settings = migrateSettingsStateV18(settings);
  settings = migrateSettingsStateV19(settings);
  return migrateSettingsStateV21ToCurrent(migrateSettingsStateV20(settings));
}

export async function finalizeSettingsBackup({
  createdAt,
  settings,
  kind = SETTINGS_BACKUP_KINDS.MANUAL,
  reason = null
}) {
  if (!Object.values(SETTINGS_BACKUP_KINDS).includes(kind)) {
    throw invalidBackup("The settings backup kind is invalid.");
  }
  if (reason !== null && !Object.values(SETTINGS_BACKUP_REASONS).includes(reason)) {
    throw invalidBackup("The settings backup reason is invalid.");
  }
  const draft = createSettingsBackup({ createdAt, settings });
  const payloadDigest = await digestJsonPayload(draft.payload);
  return parseSettingsBackup({
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
    backupKind: kind,
    reason,
    createdAt,
    payloadDigest,
    payload: draft.payload
  });
}

async function digestJsonPayload(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value))
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSettingsBackupVersion(
  value,
  schemaVersion,
  settingsParser,
  {
    includeKind = false,
    includeReason = false,
    includeWorkspaceState = true,
    includeContainerCatalog = false,
    includeFontAssets = false,
    workspaceParser = parseWorkspaceStateV4
  } = {}
) {
  const expectedKeys = [
    "documentType",
    "schemaVersion",
    "createdAt",
    "payloadDigest",
    "payload"
  ];
  if (includeKind) {
    expectedKeys.push("backupKind");
  }
  if (includeReason) {
    expectedKeys.push("reason");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, expectedKeys)
  ) {
    throw invalidBackup("The settings backup has an invalid shape.");
  }
  if (value.documentType !== SETTINGS_BACKUP_DOCUMENT_TYPE) {
    throw invalidBackup("The document is not a Terminus settings backup.");
  }
  if (value.schemaVersion !== schemaVersion) {
    throw invalidBackup("The settings backup schema version is invalid.");
  }
  if (typeof value.payloadDigest !== "string" || !DIGEST_PATTERN.test(value.payloadDigest)) {
    throw invalidBackup("The settings backup digest is invalid.");
  }
  if (includeKind && !Object.values(SETTINGS_BACKUP_KINDS).includes(value.backupKind)) {
    throw invalidBackup("The settings backup kind is invalid.");
  }
  if (
    includeReason &&
    value.reason !== null &&
    !Object.values(SETTINGS_BACKUP_REASONS).includes(value.reason)
  ) {
    throw invalidBackup("The settings backup reason is invalid.");
  }
  const payloadKeys = ["settings"];
  if (includeWorkspaceState) payloadKeys.push("workspaceState");
  if (includeContainerCatalog) payloadKeys.push("containerCatalog");
  if (includeFontAssets) payloadKeys.push("fontAssets");
  if (!isRecord(value.payload) || !hasExactKeys(value.payload, payloadKeys)) {
    throw invalidBackup("The settings backup payload has an invalid shape.");
  }
  if (includeFontAssets && !Array.isArray(value.payload.fontAssets)) {
    throw invalidBackup("The settings backup font assets have an invalid shape.");
  }
  return {
    documentType: SETTINGS_BACKUP_DOCUMENT_TYPE,
    schemaVersion,
    ...(includeKind ? { backupKind: value.backupKind } : {}),
    ...(includeReason ? { reason: value.reason } : {}),
    createdAt: parseIsoDate(value.createdAt, "Settings backup creation time"),
    payloadDigest: value.payloadDigest,
    payload: {
      settings: settingsParser(value.payload.settings),
      ...(includeWorkspaceState
        ? { workspaceState: workspaceParser(value.payload.workspaceState) }
        : {}),
      ...(includeContainerCatalog
        ? { containerCatalog: parseContainerCatalog(value.payload.containerCatalog, invalidBackup) }
        : {}),
      ...(includeFontAssets
        ? {
            fontAssets: value.payload.fontAssets.map((asset) => {
              try {
                return parseLegacyPortableFontAsset(asset);
              } catch (error) {
                throw invalidBackup(error.message);
              }
            })
          }
        : {})
    }
  };
}

export function parseSettingsBackup(value) {
  if (
    Number.isInteger(value?.schemaVersion) &&
    value.schemaVersion > SETTINGS_BACKUP_SCHEMA_VERSION
  ) {
    throw unsupportedVersion();
  }
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_SCHEMA_VERSION,
    parseSettingsBackupProjection,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV19(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V19_SCHEMA_VERSION,
    parseSettingsBackupProjectionV26,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV20(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V20_SCHEMA_VERSION,
    parseSettingsBackupProjectionV27,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV21(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V21_SCHEMA_VERSION,
    parseSettingsBackupProjectionV28,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV25(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V25_SCHEMA_VERSION,
    parseSettingsBackupProjectionV32,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV26(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V26_SCHEMA_VERSION,
    parseSettingsBackupProjectionV33,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV24(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V24_SCHEMA_VERSION,
    parseSettingsBackupProjectionV31,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV23(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V23_SCHEMA_VERSION,
    parseSettingsBackupProjectionV30,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV22(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V22_SCHEMA_VERSION,
    parseSettingsBackupProjectionV29,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false
    }
  );
}

function parseSettingsBackupV18(value) {
  const backup = parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V18_SCHEMA_VERSION,
    parseSettingsBackupProjectionV25,
    {
      includeKind: true,
      includeReason: true,
      includeWorkspaceState: false,
      includeFontAssets: true
    }
  );
  const selectedFontId = backup.payload.settings.appearance.typography.fontAssetId;
  if (
    backup.payload.fontAssets.length !== (selectedFontId === null ? 0 : 1) ||
    (selectedFontId !== null && backup.payload.fontAssets[0]?.id !== selectedFontId)
  ) {
    throw invalidBackup("The settings backup font asset does not match the selected font.");
  }
  return backup;
}

function parseLegacySettingsBackup(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_LEGACY_SCHEMA_VERSION,
    parseSettingsStateV7
  );
}

function parsePreviousSettingsBackup(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_PREVIOUS_SCHEMA_VERSION,
    parseSettingsStateV9
  );
}

function parseSettingsBackupV2(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V2_SCHEMA_VERSION,
    parseSettingsStateV8
  );
}

function parseSettingsBackupV4(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V4_SCHEMA_VERSION,
    parseSettingsStateV10
  );
}

function parseSettingsBackupV5(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V5_SCHEMA_VERSION,
    parseSettingsStateV11
  );
}

function parseSettingsBackupV6(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V6_SCHEMA_VERSION,
    parseSettingsStateV12
  );
}

function parseSettingsBackupV7(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V7_SCHEMA_VERSION,
    parseSettingsStateV13
  );
}

function parseSettingsBackupV8(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V8_SCHEMA_VERSION,
    parseSettingsBackupProjectionV8
  );
}

function parseSettingsBackupV9(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V9_SCHEMA_VERSION,
    parseSettingsBackupProjectionV10
  );
}

function parseSettingsBackupV10(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V10_SCHEMA_VERSION,
    parseSettingsBackupProjectionV10,
    { includeKind: true }
  );
}

function parseSettingsBackupV11(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V11_SCHEMA_VERSION,
    parseSettingsBackupProjectionV11,
    { includeKind: true }
  );
}

function parseSettingsBackupV12(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V12_SCHEMA_VERSION,
    parseSettingsBackupProjectionV12,
    { includeKind: true, includeReason: true }
  );
}

function parseSettingsBackupV13(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V13_SCHEMA_VERSION,
    parseSettingsBackupProjectionV13,
    {
      includeKind: true,
      includeReason: true,
      includeContainerCatalog: true,
      workspaceParser: parseWorkspaceState
    }
  );
}

function parseSettingsBackupV14(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V14_SCHEMA_VERSION,
    parseSettingsBackupProjectionV14,
    {
      includeKind: true,
      includeReason: true,
      includeContainerCatalog: true,
      includeFontAssets: true,
      workspaceParser: parseWorkspaceState
    }
  );
}

function parseSettingsBackupV15(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V15_SCHEMA_VERSION,
    parseSettingsBackupProjectionV15,
    {
      includeKind: true,
      includeReason: true,
      includeContainerCatalog: true,
      includeFontAssets: true,
      workspaceParser: parseWorkspaceState
    }
  );
}

function parseSettingsBackupV16(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V16_SCHEMA_VERSION,
    parseSettingsBackupProjectionV16,
    {
      includeKind: true,
      includeReason: true,
      includeContainerCatalog: true,
      includeFontAssets: true,
      workspaceParser: parseWorkspaceState
    }
  );
}

function parseSettingsBackupV17(value) {
  return parseSettingsBackupVersion(
    value,
    SETTINGS_BACKUP_V17_SCHEMA_VERSION,
    parseSettingsBackupProjectionV25,
    {
      includeKind: true,
      includeReason: true,
      includeContainerCatalog: true,
      includeFontAssets: true,
      workspaceParser: parseWorkspaceState
    }
  );
}

export async function verifySettingsBackup(value) {
  const isLegacy = value?.schemaVersion === SETTINGS_BACKUP_LEGACY_SCHEMA_VERSION;
  const isV2 = value?.schemaVersion === SETTINGS_BACKUP_V2_SCHEMA_VERSION;
  const isPrevious = value?.schemaVersion === SETTINGS_BACKUP_PREVIOUS_SCHEMA_VERSION;
  const isV4 = value?.schemaVersion === SETTINGS_BACKUP_V4_SCHEMA_VERSION;
  const isV5 = value?.schemaVersion === SETTINGS_BACKUP_V5_SCHEMA_VERSION;
  const isV6 = value?.schemaVersion === SETTINGS_BACKUP_V6_SCHEMA_VERSION;
  const isV7 = value?.schemaVersion === SETTINGS_BACKUP_V7_SCHEMA_VERSION;
  const isV8 = value?.schemaVersion === SETTINGS_BACKUP_V8_SCHEMA_VERSION;
  const isV9 = value?.schemaVersion === SETTINGS_BACKUP_V9_SCHEMA_VERSION;
  const isV10 = value?.schemaVersion === SETTINGS_BACKUP_V10_SCHEMA_VERSION;
  const isV11 = value?.schemaVersion === SETTINGS_BACKUP_V11_SCHEMA_VERSION;
  const isV12 = value?.schemaVersion === SETTINGS_BACKUP_V12_SCHEMA_VERSION;
  const isV13 = value?.schemaVersion === SETTINGS_BACKUP_V13_SCHEMA_VERSION;
  const isV14 = value?.schemaVersion === SETTINGS_BACKUP_V14_SCHEMA_VERSION;
  const isV15 = value?.schemaVersion === SETTINGS_BACKUP_V15_SCHEMA_VERSION;
  const isV16 = value?.schemaVersion === SETTINGS_BACKUP_V16_SCHEMA_VERSION;
  const isV17 = value?.schemaVersion === SETTINGS_BACKUP_V17_SCHEMA_VERSION;
  const isV18 = value?.schemaVersion === SETTINGS_BACKUP_V18_SCHEMA_VERSION;
  const isV19 = value?.schemaVersion === SETTINGS_BACKUP_V19_SCHEMA_VERSION;
  const isV20 = value?.schemaVersion === SETTINGS_BACKUP_V20_SCHEMA_VERSION;
  const isV21 = value?.schemaVersion === SETTINGS_BACKUP_V21_SCHEMA_VERSION;
  const isV22 = value?.schemaVersion === SETTINGS_BACKUP_V22_SCHEMA_VERSION;
  const isV23 = value?.schemaVersion === SETTINGS_BACKUP_V23_SCHEMA_VERSION;
  const isV24 = value?.schemaVersion === SETTINGS_BACKUP_V24_SCHEMA_VERSION;
  const isV25 = value?.schemaVersion === SETTINGS_BACKUP_V25_SCHEMA_VERSION;
  const isV26 = value?.schemaVersion === SETTINGS_BACKUP_V26_SCHEMA_VERSION;
  let backup;
  if (isLegacy) {
    backup = parseLegacySettingsBackup(value);
  } else if (isV2) {
    backup = parseSettingsBackupV2(value);
  } else if (isPrevious) {
    backup = parsePreviousSettingsBackup(value);
  } else if (isV4) {
    backup = parseSettingsBackupV4(value);
  } else if (isV5) {
    backup = parseSettingsBackupV5(value);
  } else if (isV6) {
    backup = parseSettingsBackupV6(value);
  } else if (isV7) {
    backup = parseSettingsBackupV7(value);
  } else if (isV8) {
    backup = parseSettingsBackupV8(value);
  } else if (isV9) {
    backup = parseSettingsBackupV9(value);
  } else if (isV10) {
    backup = parseSettingsBackupV10(value);
  } else if (isV11) {
    backup = parseSettingsBackupV11(value);
  } else if (isV12) {
    backup = parseSettingsBackupV12(value);
  } else if (isV13) {
    backup = parseSettingsBackupV13(value);
  } else if (isV14) {
    backup = parseSettingsBackupV14(value);
  } else if (isV15) {
    backup = parseSettingsBackupV15(value);
  } else if (isV16) {
    backup = parseSettingsBackupV16(value);
  } else if (isV17) {
    backup = parseSettingsBackupV17(value);
  } else if (isV18) {
    backup = parseSettingsBackupV18(value);
  } else if (isV19) {
    backup = parseSettingsBackupV19(value);
  } else if (isV20) {
    backup = parseSettingsBackupV20(value);
  } else if (isV21) {
    backup = parseSettingsBackupV21(value);
  } else if (isV22) {
    backup = parseSettingsBackupV22(value);
  } else if (isV23) {
    backup = parseSettingsBackupV23(value);
  } else if (isV24) {
    backup = parseSettingsBackupV24(value);
  } else if (isV25) {
    backup = parseSettingsBackupV25(value);
  } else if (isV26) {
    backup = parseSettingsBackupV26(value);
  } else {
    backup = parseSettingsBackup(value);
  }
  // The digest also covers any legacy font record, which every migration
  // below then drops without decoding.
  if ((await digestJsonPayload(backup.payload)) !== backup.payloadDigest) {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED);
  }
  if (isLegacy) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(migrateSettingsStateV12(
        migrateSettingsStateV11(
          migrateSettingsStateV10(
            migrateSettingsStateV9(
              migrateSettingsStateV8(migrateSettingsStateV7(backup.payload.settings))
            )
          )
        )
      )))
    });
  }
  if (isV2) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(migrateSettingsStateV12(
        migrateSettingsStateV11(
          migrateSettingsStateV10(
            migrateSettingsStateV9(migrateSettingsStateV8(backup.payload.settings))
          )
        )
      )))
    });
  }
  if (isPrevious) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(migrateSettingsStateV12(
        migrateSettingsStateV11(
          migrateSettingsStateV10(migrateSettingsStateV9(backup.payload.settings))
        )
      )))
    });
  }
  if (isV4) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(migrateSettingsStateV12(
        migrateSettingsStateV11(migrateSettingsStateV10(backup.payload.settings))
      )))
    });
  }
  if (isV5) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(
        migrateSettingsStateV12(migrateSettingsStateV11(backup.payload.settings))
      ))
    });
  }
  if (isV6) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(migrateSettingsStateV12(backup.payload.settings)))
    });
  }
  if (isV7) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent(migrateSettingsStateV13(backup.payload.settings))
    });
  }
  if (isV8) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV14ToCurrent({
        schemaVersion: SETTINGS_STATE_V14_SCHEMA_VERSION,
        ...backup.payload.settings,
        privacy: { keepPrivateTabsBetweenSessions: false }
      })
    });
  }
  if (isV9) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: addCurrentTypographyToSettingsProjection(backup.payload.settings),
      kind: SETTINGS_BACKUP_KINDS.MANUAL
    });
  }
  if (isV10) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: addCurrentTypographyToSettingsProjection(backup.payload.settings),
      kind: backup.backupKind
    });
  }
  if (isV11) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV21ToCurrent(migrateSettingsStateV20(migrateSettingsStateV19(migrateSettingsStateV18(migrateSettingsStateV17({
        ...createDefaultSettingsStateV26(),
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
        privacy: { keepPrivateTabsBetweenSessions: false, automaticSnapshotsEnabled: false }
      }))))),
      kind: backup.backupKind
    });
  }
  if (isV12) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV21ToCurrent(migrateSettingsStateV20(migrateSettingsStateV19({
        ...createDefaultSettingsStateV26(),
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V19_SCHEMA_VERSION
      }))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV13) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV21ToCurrent(migrateSettingsStateV20({
        ...createDefaultSettingsStateV26(),
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V20_SCHEMA_VERSION
      })),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV14) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV21ToCurrent({
        ...createDefaultSettingsStateV26(),
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V21_SCHEMA_VERSION,
        privacy: { keepPrivateTabsBetweenSessions: false, automaticSnapshotsEnabled: false }
      }),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV15) {
    const settings = parseSettingsStateV23({
      ...createDefaultSettingsStateV26(),
      ...backup.payload.settings,
      schemaVersion: SETTINGS_STATE_V23_SCHEMA_VERSION
    });
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV25ToCurrent(migrateSettingsStateV24(migrateSettingsStateV23(settings))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV16) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV25ToCurrent(migrateSettingsStateV24(parseSettingsStateV24({
        ...createDefaultSettingsStateV26(),
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V24_SCHEMA_VERSION
      }))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV17 || isV18) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV25ToCurrent({
        ...createDefaultSettingsStateV26(),
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V25_SCHEMA_VERSION
      }),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV19) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV32ToCurrent(migrateSettingsStateV31(migrateSettingsStateV30(migrateSettingsStateV29(migrateSettingsStateV28(
        migrateSettingsStateV27(migrateSettingsStateV26({
          ...backup.payload.settings,
          schemaVersion: SETTINGS_STATE_V26_SCHEMA_VERSION
        }))
      ))))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV20) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV32ToCurrent(migrateSettingsStateV31(migrateSettingsStateV30(migrateSettingsStateV29(migrateSettingsStateV28(
        migrateSettingsStateV27({
          ...backup.payload.settings,
          schemaVersion: SETTINGS_STATE_V27_SCHEMA_VERSION
        })
      ))))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV21) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV32ToCurrent(migrateSettingsStateV31(migrateSettingsStateV30(migrateSettingsStateV29(migrateSettingsStateV28({
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V28_SCHEMA_VERSION
      }))))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV22) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV32ToCurrent(migrateSettingsStateV31(migrateSettingsStateV30(migrateSettingsStateV29({
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V29_SCHEMA_VERSION
      })))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV23) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV32ToCurrent(migrateSettingsStateV31(migrateSettingsStateV30({
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V30_SCHEMA_VERSION
      }))),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV24) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV32ToCurrent(migrateSettingsStateV31({
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V31_SCHEMA_VERSION
      })),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV25) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV33(migrateSettingsStateV32({
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V32_SCHEMA_VERSION
      })),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  if (isV26) {
    return finalizeSettingsBackup({
      createdAt: backup.createdAt,
      settings: migrateSettingsStateV33({
        ...backup.payload.settings,
        schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION
      }),
      kind: backup.backupKind,
      reason: backup.reason
    });
  }
  return backup;
}

export async function parseBackupText(text) {
  if (typeof text !== "string") {
    throw invalidBackup("Backup content must be text.");
  }
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength < 2 || byteLength > MAX_BACKUP_BYTES) {
    throw invalidBackup(`Backup content must not exceed ${MAX_BACKUP_BYTES} bytes.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalidBackup("Backup content is not valid JSON.");
  }
  if (value?.documentType === SNAPSHOT_DOCUMENT_TYPE) {
    return { kind: "snapshot", document: await verifySnapshotRecord(value), byteLength };
  }
  if (value?.documentType === SETTINGS_BACKUP_DOCUMENT_TYPE) {
    return { kind: "settings", document: await verifySettingsBackup(value), byteLength };
  }
  throw invalidBackup("The selected file is not a supported Terminus backup.");
}

export function serializeBackup(document) {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw invalidBackup(`Backup content must not exceed ${MAX_BACKUP_BYTES} bytes.`);
  }
  return text;
}

export function createDefaultSnapshotScheduleState() {
  return {
    schemaVersion: SNAPSHOT_SCHEDULE_SCHEMA_VERSION,
    capture: createDefaultScheduleJob({ pending: true }),
    cleanup: createDefaultScheduleJob(),
    startupProtection: createDefaultStartupProtection()
  };
}

function createDefaultScheduleJob({ pending = false } = {}) {
  const job = {
    intervalMilliseconds: null,
    nextDueAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastResult: null
  };
  if (pending) {
    job.pendingLibraries = [];
    job.pendingSince = null;
  }
  return job;
}

function createDefaultStartupProtection() {
  return { snapshotId: null, protectedAt: null };
}

function parseScheduleJob(value, label, allowedResults, { pending = false } = {}) {
  const expectedKeys = [
    "intervalMilliseconds",
    "nextDueAt",
    "lastAttemptAt",
    "lastSuccessAt",
    "lastResult"
  ];
  if (pending) expectedKeys.push("pendingLibraries", "pendingSince");
  if (
    !isRecord(value) ||
    !hasExactKeys(value, expectedKeys)
  ) {
    throw invalidBackup(`${label} schedule has an invalid shape.`);
  }
  if (value.lastResult !== null && !allowedResults.includes(value.lastResult)) {
    throw invalidBackup(`${label} schedule result is invalid.`);
  }
  if (
    value.intervalMilliseconds !== null &&
    (!Number.isSafeInteger(value.intervalMilliseconds) || value.intervalMilliseconds < 1000)
  ) {
    throw invalidBackup(`${label} schedule interval is invalid.`);
  }
  const parsed = {
    intervalMilliseconds: value.intervalMilliseconds,
    nextDueAt: parseIsoDate(value.nextDueAt, `Next ${label.toLowerCase()} due time`, { nullable: true }),
    lastAttemptAt: parseIsoDate(value.lastAttemptAt, `Last ${label.toLowerCase()} attempt`, { nullable: true }),
    lastSuccessAt: parseIsoDate(value.lastSuccessAt, `Last ${label.toLowerCase()} success`, { nullable: true }),
    lastResult: value.lastResult
  };
  if (pending) {
    const allowedLibraries = new Set(Object.values(SNAPSHOT_AUTOMATIC_LIBRARIES));
    if (
      !Array.isArray(value.pendingLibraries) ||
      value.pendingLibraries.some((library) => !allowedLibraries.has(library)) ||
      new Set(value.pendingLibraries).size !== value.pendingLibraries.length
    ) {
      throw invalidBackup(`${label} pending libraries are invalid.`);
    }
    parsed.pendingLibraries = [...value.pendingLibraries];
    parsed.pendingSince = parseIsoDate(
      value.pendingSince,
      `Pending ${label.toLowerCase()} time`,
      { nullable: true }
    );
    if ((parsed.pendingLibraries.length === 0) !== (parsed.pendingSince === null)) {
      throw invalidBackup(`${label} pending metadata is inconsistent.`);
    }
  }
  return parsed;
}

function parseStartupProtection(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["snapshotId", "protectedAt"])) {
    throw invalidBackup("The startup snapshot protection has an invalid shape.");
  }
  if (
    value.snapshotId !== null &&
    (typeof value.snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(value.snapshotId))
  ) {
    throw invalidBackup("The protected startup snapshot ID is invalid.");
  }
  const protectedAt = parseIsoDate(value.protectedAt, "Startup snapshot protection time", {
    nullable: true
  });
  if ((value.snapshotId === null) !== (protectedAt === null)) {
    throw invalidBackup("The startup snapshot protection metadata is inconsistent.");
  }
  return { snapshotId: value.snapshotId, protectedAt };
}

export function parseSnapshotScheduleState(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "capture", "cleanup", "startupProtection"]) ||
    value.schemaVersion !== SNAPSHOT_SCHEDULE_SCHEMA_VERSION
  ) {
    if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > SNAPSHOT_SCHEDULE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidBackup("The snapshot schedule state has an invalid shape.");
  }
  return {
    schemaVersion: SNAPSHOT_SCHEDULE_SCHEMA_VERSION,
    capture: parseScheduleJob(
      value.capture,
      "Snapshot capture",
      ["created", "unchanged", "failed"],
      { pending: true }
    ),
    cleanup: parseScheduleJob(value.cleanup, "Snapshot cleanup", ["deleted", "unchanged", "failed"]),
    startupProtection: parseStartupProtection(value.startupProtection)
  };
}

function parsePreviousSnapshotScheduleState(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "capture", "cleanup"]) ||
    value.schemaVersion !== 2
  ) {
    throw invalidBackup("The previous snapshot schedule state has an invalid shape.");
  }
  return {
    schemaVersion: SNAPSHOT_SCHEDULE_SCHEMA_VERSION,
    capture: {
      ...parseScheduleJob(value.capture, "Snapshot capture", ["created", "unchanged", "failed"]),
      pendingLibraries: [],
      pendingSince: null
    },
    cleanup: parseScheduleJob(value.cleanup, "Snapshot cleanup", ["deleted", "unchanged", "failed"]),
    startupProtection: createDefaultStartupProtection()
  };
}

function parseLegacySnapshotScheduleState(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "intervalMinutes",
      "nextDueAt",
      "lastAttemptAt",
      "lastSuccessAt",
      "lastResult"
    ]) ||
    value.schemaVersion !== 1 ||
    (value.lastResult !== null && !["created", "unchanged", "failed"].includes(value.lastResult)) ||
    (value.intervalMinutes !== null &&
      (!Number.isFinite(value.intervalMinutes) || value.intervalMinutes < 1))
  ) {
    throw invalidBackup("The legacy snapshot schedule state has an invalid shape.");
  }
  return {
    schemaVersion: SNAPSHOT_SCHEDULE_SCHEMA_VERSION,
    capture: {
      ...parseScheduleJob(
        {
          intervalMilliseconds:
            value.intervalMinutes === null ? null : Math.round(value.intervalMinutes * 60 * 1000),
          nextDueAt: value.nextDueAt,
          lastAttemptAt: value.lastAttemptAt,
          lastSuccessAt: value.lastSuccessAt,
          lastResult: value.lastResult
        },
        "Snapshot capture",
        ["created", "unchanged", "failed"]
      ),
      pendingLibraries: [],
      pendingSince: null
    },
    cleanup: createDefaultScheduleJob(),
    startupProtection: createDefaultStartupProtection()
  };
}

export function migrateSnapshotScheduleState(value) {
  if (value?.schemaVersion === 1) return parseLegacySnapshotScheduleState(value);
  if (value?.schemaVersion === 2) return parsePreviousSnapshotScheduleState(value);
  return parseSnapshotScheduleState(value);
}

function parseReportCounts(value, keys, label) {
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw invalidBackup(`${label} has an invalid shape.`);
  }
  const parsed = {};
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw invalidBackup(`${label} contains an invalid count.`);
    }
    parsed[key] = value[key];
  }
  return parsed;
}

function parseReportEntries(value, label) {
  if (!Array.isArray(value) || value.length > 10000) {
    throw invalidBackup(`${label} must be a bounded array.`);
  }
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["kind", "count", "detail"]) ||
      typeof entry.kind !== "string" ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(entry.kind) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 1 ||
      !(entry.detail === null || (typeof entry.detail === "string" && entry.detail.length <= 160))
    ) {
      throw invalidBackup(`${label} entry ${index} is invalid.`);
    }
    return { kind: entry.kind, count: entry.count, detail: entry.detail };
  });
}

function parseSkippedReportEntries(value) {
  if (!Array.isArray(value) || value.length > 10000) {
    throw invalidBackup("Skipped restore items must be a bounded array.");
  }
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["kind", "title"]) ||
      entry.kind !== "protected-url" ||
      typeof entry.title !== "string" ||
      entry.title.length > 4096
    ) {
      throw invalidBackup(`Skipped restore item ${index} is invalid.`);
    }
    return { kind: entry.kind, title: entry.title };
  });
}

export function parseSnapshotRestoreReport(value) {
  if (!isRecord(value)) {
    throw invalidBackup("The restore report has an invalid shape.");
  }
  const isSettings = value.scope === SNAPSHOT_RESTORE_SCOPES.SETTINGS;
  const keys = [
    "id",
    "snapshotId",
    "status",
    "scope",
    "mode",
    "startedAt",
    "finishedAt",
    "created",
    "applied",
    "approximations",
    "skipped",
    "failures",
    ...(isSettings ? ["sections"] : [])
  ];
  if (
    !hasExactKeys(value, keys) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 160 ||
    !["running", "complete", "partial"].includes(value.status) ||
    !Object.values(SNAPSHOT_RESTORE_SCOPES).includes(value.scope) ||
    !Object.values(SNAPSHOT_RESTORE_MODES).includes(value.mode)
  ) {
    throw invalidBackup("The restore report has an invalid shape.");
  }
  if (
    (isSettings && value.snapshotId !== null) ||
    (!isSettings && (typeof value.snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(value.snapshotId))) ||
    (value.status === "running" && value.finishedAt !== null) ||
    (value.status !== "running" && value.finishedAt === null)
  ) {
    throw invalidBackup("The restore report lifecycle is invalid.");
  }
  let sections;
  if (isSettings) {
    // "navigation" is restored by every Settings Backup load; "workspaces"
    // remains readable from older reports. An empty list means the restored
    // sections are unknown, as for an unreadable interrupted-restore record.
    const allowed = new Set(["sidebar", "appearance", "navigation", "snapshots", "workspaces"]);
    if (
      !Array.isArray(value.sections) ||
      new Set(value.sections).size !== value.sections.length ||
      value.sections.some((section) => !allowed.has(section))
    ) {
      throw invalidBackup("The settings restore report sections are invalid.");
    }
    sections = [...value.sections];
  }
  const appliedKeys = isRecord(value.applied) &&
      (Object.hasOwn(value.applied, "closedTabs") || Object.hasOwn(value.applied, "closedWindows"))
    ? ["workspaces", "groups", "pins", "discarded", "replacedTabs", "closedTabs", "closedWindows"]
    : isRecord(value.applied) && Object.hasOwn(value.applied, "replacedTabs")
      ? ["workspaces", "groups", "pins", "discarded", "replacedTabs"]
    : isRecord(value.applied) && Object.hasOwn(value.applied, "workspaces")
      ? ["workspaces", "groups", "pins", "discarded"]
      : ["groups", "pins", "discarded"];
  const applied = parseReportCounts(value.applied, appliedKeys, "Applied restore counts");
  return {
    id: value.id,
    snapshotId: value.snapshotId,
    status: value.status,
    scope: value.scope,
    mode: value.mode,
    startedAt: parseIsoDate(value.startedAt, "Restore report start time"),
    finishedAt: parseIsoDate(value.finishedAt, "Restore report finish time", { nullable: true }),
    created: parseReportCounts(value.created, ["workspaces", "windows", "tabs"], "Created restore counts"),
    applied: {
      workspaces: 0,
      replacedTabs: 0,
      closedTabs: 0,
      closedWindows: 0,
      ...applied
    },
    approximations: parseReportEntries(value.approximations, "Restore approximation"),
    skipped: parseSkippedReportEntries(value.skipped),
    failures: parseReportEntries(value.failures, "Restore failure"),
    ...(isSettings ? { sections } : {})
  };
}

export function parseRestoreJournal(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "id",
      "snapshotId",
      "phase",
      "mode",
      "scope",
      "targetWindowId",
      "createdWindowIds",
      "createdTabIds",
      "originalWindowIds",
      "originalTabIds",
      "originalLogicalWindowIds",
      "originalLogicalTabIds",
      "replacementState",
      "startedAt",
      "report"
    ]) ||
    value.schemaVersion !== RESTORE_JOURNAL_SCHEMA_VERSION ||
    typeof value.id !== "string" ||
    typeof value.snapshotId !== "string" ||
    !["planned", "materializing", "persisting", "verifying", "cleanup", "partial"].includes(value.phase) ||
    !Object.values(SNAPSHOT_RESTORE_MODES).includes(value.mode) ||
    !Object.values(SNAPSHOT_RESTORE_SCOPES).includes(value.scope) ||
    !(value.targetWindowId === null || (Number.isInteger(value.targetWindowId) && value.targetWindowId >= 0))
  ) {
    throw invalidBackup("The restore journal has an invalid shape.");
  }
  const parseIds = (items, label) => {
    if (!Array.isArray(items) || items.some((id) => !Number.isInteger(id) || id < 0)) {
      throw invalidBackup(`${label} must contain Firefox IDs.`);
    }
    return [...new Set(items)];
  };
  const parseLogicalIds = (items, kind, label) => {
    if (!Array.isArray(items)) {
      throw invalidBackup(`${label} must be an array.`);
    }
    const parsed = items.map((id, index) => parseLogicalId(id, kind, `${label} ${index}`));
    if (new Set(parsed).size !== parsed.length) {
      throw invalidBackup(`${label} must not contain duplicate IDs.`);
    }
    return parsed;
  };
  const report = value.report === null ? null : parseSnapshotRestoreReport(value.report);
  const originalWindowIds = parseIds(value.originalWindowIds, "Original windows");
  const originalLogicalWindowIds = parseLogicalIds(
    value.originalLogicalWindowIds,
    "window",
    "Original logical windows"
  );
  if (originalWindowIds.length !== originalLogicalWindowIds.length) {
    throw invalidBackup("Original Firefox and logical window identities must align.");
  }
  return {
    schemaVersion: RESTORE_JOURNAL_SCHEMA_VERSION,
    id: value.id,
    snapshotId: value.snapshotId,
    phase: value.phase,
    mode: value.mode,
    scope: value.scope,
    targetWindowId: value.targetWindowId,
    createdWindowIds: parseIds(value.createdWindowIds, "Created windows"),
    createdTabIds: parseIds(value.createdTabIds, "Created tabs"),
    originalWindowIds,
    originalTabIds: parseIds(value.originalTabIds, "Original tabs"),
    originalLogicalWindowIds,
    originalLogicalTabIds: parseLogicalIds(
      value.originalLogicalTabIds,
      "tab",
      "Original logical tabs"
    ),
    replacementState:
      value.replacementState === null ? null : parseWorkspaceState(value.replacementState),
    startedAt: parseIsoDate(value.startedAt, "Restore start time"),
    report
  };
}

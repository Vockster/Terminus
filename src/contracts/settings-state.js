export const SETTINGS_STATE_LEGACY_SCHEMA_VERSION = 1;
export const SETTINGS_STATE_V2_SCHEMA_VERSION = 2;
export const SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION = 3;
export const SETTINGS_STATE_V4_SCHEMA_VERSION = 4;
export const SETTINGS_STATE_V5_SCHEMA_VERSION = 5;
export const SETTINGS_STATE_V6_SCHEMA_VERSION = 6;
export const SETTINGS_STATE_V7_SCHEMA_VERSION = 7;
export const SETTINGS_STATE_V8_SCHEMA_VERSION = 8;
export const SETTINGS_STATE_V9_SCHEMA_VERSION = 9;
export const SETTINGS_STATE_V10_SCHEMA_VERSION = 10;
export const SETTINGS_STATE_V11_SCHEMA_VERSION = 11;
export const SETTINGS_STATE_V12_SCHEMA_VERSION = 12;
export const SETTINGS_STATE_V13_SCHEMA_VERSION = 13;
export const SETTINGS_STATE_V14_SCHEMA_VERSION = 14;
export const SETTINGS_STATE_V15_SCHEMA_VERSION = 15;
export const SETTINGS_STATE_V16_SCHEMA_VERSION = 16;
export const SETTINGS_STATE_V17_SCHEMA_VERSION = 17;
export const SETTINGS_STATE_V18_SCHEMA_VERSION = 18;
export const SETTINGS_STATE_V19_SCHEMA_VERSION = 19;
export const SETTINGS_STATE_V20_SCHEMA_VERSION = 20;
export const SETTINGS_STATE_V21_SCHEMA_VERSION = 21;
export const SETTINGS_STATE_V22_SCHEMA_VERSION = 22;
export const SETTINGS_STATE_V23_SCHEMA_VERSION = 23;
export const SETTINGS_STATE_V24_SCHEMA_VERSION = 24;
export const SETTINGS_STATE_V25_SCHEMA_VERSION = 25;
export const SETTINGS_STATE_V26_SCHEMA_VERSION = 26;
export const SETTINGS_STATE_V27_SCHEMA_VERSION = 27;
export const SETTINGS_STATE_V28_SCHEMA_VERSION = 28;
export const SETTINGS_STATE_V29_SCHEMA_VERSION = 29;
export const SETTINGS_STATE_V30_SCHEMA_VERSION = 30;
export const SETTINGS_STATE_V31_SCHEMA_VERSION = 31;
export const SETTINGS_STATE_V32_SCHEMA_VERSION = 32;
export const SETTINGS_STATE_V33_SCHEMA_VERSION = 33;
export const SETTINGS_STATE_SCHEMA_VERSION = 34;
export const SETTINGS_STATE_STORAGE_KEY = "settingsState";
export const SETTINGS_STATE_MIGRATION_STORAGE_KEY = "settingsStateMigration";
// Holds a settings document written by a newer Terminus verbatim, so a
// downgrade can start from defaults without discarding the newer data.
export const SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY = "settingsStateUnsupportedBackup";

export const SIDEBAR_SIZE_LIMITS = Object.freeze({
  railSize: Object.freeze({ min: 48, max: 96, defaultValue: 48 }),
  iconSize: Object.freeze({ min: 20, max: 64, defaultValue: 30 }),
  dividerSize: Object.freeze({ min: 4, max: 64, defaultValue: 16 })
});

export const SIDEBAR_GEOMETRY_CONSTANTS = Object.freeze({
  railPadding: 8,
  iconClearance: 10
});

export const SIDEBAR_SIZE_PRESETS = Object.freeze({
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
  MASSIVE: "massive"
});

// Each glyph fills 62-70% of its tile. Below that a Lucide stroke icon reads as
// a speck floating in the button; the earlier table matched the Settings font
// scale instead, which left the two smallest presets at half the tile.
export const WORKSPACE_SIZE_GEOMETRY = Object.freeze({
  [SIDEBAR_SIZE_PRESETS.SMALL]: Object.freeze({ railSize: 40, buttonSize: 32, iconSize: 20 }),
  [SIDEBAR_SIZE_PRESETS.MEDIUM]: Object.freeze({ railSize: 46, buttonSize: 38, iconSize: 24 }),
  [SIDEBAR_SIZE_PRESETS.LARGE]: Object.freeze({ railSize: 56, buttonSize: 48, iconSize: 32 }),
  [SIDEBAR_SIZE_PRESETS.MASSIVE]: Object.freeze({ railSize: 68, buttonSize: 60, iconSize: 42 })
});

const V23_WORKSPACE_SIZE_GEOMETRY = Object.freeze({
  [SIDEBAR_SIZE_PRESETS.SMALL]: Object.freeze({ railSize: 40, buttonSize: 32, iconSize: 22 }),
  [SIDEBAR_SIZE_PRESETS.MEDIUM]: Object.freeze({ railSize: 48, buttonSize: 40, iconSize: 30 }),
  [SIDEBAR_SIZE_PRESETS.LARGE]: Object.freeze({ railSize: 60, buttonSize: 52, iconSize: 42 }),
  [SIDEBAR_SIZE_PRESETS.MASSIVE]: Object.freeze({ railSize: 72, buttonSize: 64, iconSize: 48 })
});

// Icon column matches the matching workspace rail so the two panes line up.
// Label sizes are unchanged: rows grew to carry the larger favicon instead.
export const TAB_SIZE_GEOMETRY = Object.freeze({
  [SIDEBAR_SIZE_PRESETS.SMALL]: Object.freeze({
    iconColumnSize: 40,
    tileSize: 32,
    rowSize: 34,
    faviconSize: 20,
    fontSize: 14
  }),
  [SIDEBAR_SIZE_PRESETS.MEDIUM]: Object.freeze({
    iconColumnSize: 46,
    tileSize: 38,
    rowSize: 38,
    faviconSize: 24,
    fontSize: 16
  }),
  [SIDEBAR_SIZE_PRESETS.LARGE]: Object.freeze({
    iconColumnSize: 56,
    tileSize: 48,
    rowSize: 46,
    faviconSize: 32,
    fontSize: 18
  }),
  [SIDEBAR_SIZE_PRESETS.MASSIVE]: Object.freeze({
    iconColumnSize: 68,
    tileSize: 60,
    rowSize: 58,
    faviconSize: 42,
    fontSize: 20
  })
});

export const SIDEBAR_SIZE_PRESET_ORDER = Object.freeze([
  SIDEBAR_SIZE_PRESETS.SMALL,
  SIDEBAR_SIZE_PRESETS.MEDIUM,
  SIDEBAR_SIZE_PRESETS.LARGE,
  SIDEBAR_SIZE_PRESETS.MASSIVE
]);

export const APPEARANCE_MODES = Object.freeze({
  DEFAULT: "default",
  FIREFOX: "firefox",
  SOLID: "solid",
  GRADIENT: "gradient"
});

const LEGACY_TRANSPARENT_APPEARANCE_MODE = "transparent";

export const APPEARANCE_CONTENT_MODES = Object.freeze({
  FULL: "full",
  ICONS: "icons"
});

export const TAB_SEARCH_POSITIONS = Object.freeze({
  TOP: "top",
  BOTTOM: "bottom"
});

const LEGACY_SIDEBAR_RIGHT_CLICK_BEHAVIORS = Object.freeze({
  UNLOAD: "unload",
  ACTIONS: "actions"
});

export const ACTIVE_TAB_HIGHLIGHT_MODES = Object.freeze({
  FIREFOX: "firefox",
  CUSTOM: "custom"
});

export const GRADIENT_LIMITS = Object.freeze({
  minStops: 2,
  maxStops: 6,
  minAngle: 0,
  maxAngle: 359
});

export const APPEARANCE_TYPOGRAPHY_LIMITS = Object.freeze({
  fontFamilyLength: Object.freeze({ min: 1, max: 80 }),
  fontSize: Object.freeze({ min: 16, max: 28, defaultValue: 16 })
});

export const SETTINGS_FONT_SIZE_PRESETS = Object.freeze({
  SMALL: 16,
  MEDIUM: 20,
  LARGE: 28
});

export const SETTINGS_FONT_SIZE_VALUES = Object.freeze(
  Object.values(SETTINGS_FONT_SIZE_PRESETS)
);

const LEGACY_SETTINGS_FONT_SIZE_LIMITS = Object.freeze({ min: 11, max: 20 });
const LEGACY_DEFAULT_CONTAINER_GLOW_ENABLED = true;

export const TYPOGRAPHY_SOURCES = Object.freeze({
  SYSTEM: "system",
  GENERIC: "generic",
  LEGACY: "legacy",
  UPLOADED: "uploaded"
});

// Schema 26 retired typed and uploaded font choices; only these remain.
const CURRENT_TYPOGRAPHY_SOURCES = Object.freeze([
  TYPOGRAPHY_SOURCES.SYSTEM,
  TYPOGRAPHY_SOURCES.GENERIC
]);

export const GENERIC_FONT_FAMILIES = Object.freeze([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy"
]);

const FONT_ASSET_ID_PATTERN = /^font-[a-f0-9]{64}$/;
const LEGACY_DEFAULT_TYPOGRAPHY = Object.freeze({
  customFontEnabled: false,
  fontFamily: "system-ui",
  fontSize: APPEARANCE_TYPOGRAPHY_LIMITS.fontSize.defaultValue
});

export const WORKSPACE_GLOW_MODES = Object.freeze({
  CONTAINER: "container",
  WORKSPACE: "workspace",
  OFF: "off"
});

export const DEFAULT_WORKSPACE_GLOW_MODE = WORKSPACE_GLOW_MODES.CONTAINER;

export const SETTINGS_SECTIONS = Object.freeze({
  SIDEBAR: "sidebar",
  APPEARANCE: "appearance",
  SNAPSHOTS: "snapshots",
  NAVIGATION: "navigation",
  PRIVACY: "privacy"
});

export const SETTINGS_PANEL_IDS_V18 = Object.freeze([
  "sidebar",
  "appearance",
  "workspaces",
  "snapshots",
  "snapshot-viewer",
  "privacy",
  "sync"
]);
export const SETTINGS_PANEL_IDS_V26 = Object.freeze([...SETTINGS_PANEL_IDS_V18, "storage"]);
export const SETTINGS_PANEL_IDS_V32 = Object.freeze([...SETTINGS_PANEL_IDS_V26, "overview"]);
// Schema 33 adds the Optional Firefox Styling tab. The list is the set of names
// a stored document may hold, not the order Settings draws them in.
export const SETTINGS_PANEL_IDS_V33 = Object.freeze([...SETTINGS_PANEL_IDS_V32, "firefox-styling"]);
export const SETTINGS_PANEL_IDS = Object.freeze(
  SETTINGS_PANEL_IDS_V33.filter((panelId) => panelId !== "sync")
);

export const DEFAULT_SETTINGS_NAVIGATION = Object.freeze({
  rememberLastPanel: true,
  lastPanel: "sidebar"
});

export const SNAPSHOT_INTERVAL_UNITS = Object.freeze({
  SECONDS: "seconds",
  MINUTES: "minutes",
  HOURS: "hours",
  DAYS: "days",
  WEEKS: "weeks",
  YEARS: "years"
});

export const SNAPSHOT_SCHEDULE_MODES = Object.freeze({
  INTERVAL: "interval",
  EXACT_TIME: "exact-time",
  EXACT_DAYS: "exact-days"
});

// Schema 27 limits automatic-save age to whole days or longer.
export const SNAPSHOT_AGE_UNITS = Object.freeze({
  DAYS: "days",
  WEEKS: "weeks",
  YEARS: "years"
});

export const SNAPSHOT_SETTINGS_LIMITS = Object.freeze({
  intervalValue: Object.freeze({ min: 1, secondsMin: 30, max: 999, defaultValue: 15 }),
  retentionCount: Object.freeze({ min: 1, max: 9999, defaultValue: 100 }),
  // How many restored tabs one snapshot restore creates concurrently. Schema 31
  // raised the ceiling from 100: at the top of the range a restore is
  // effectively unbatched, which is the user's choice to make.
  restoreBatchSize: Object.freeze({ min: 1, max: 9999, defaultValue: 10 })
});

// Schemas 27-30 also validated an automatic-save age limit and capped the
// restore batch at 100. Both stay here so those frozen parsers keep reading
// their own documents exactly as they were written.
export const SNAPSHOT_SETTINGS_LIMITS_V30 = Object.freeze({
  intervalValue: SNAPSHOT_SETTINGS_LIMITS.intervalValue,
  deleteAfterValue: Object.freeze({ min: 1, max: 999, defaultValue: 30 }),
  retentionCount: SNAPSHOT_SETTINGS_LIMITS.retentionCount,
  restoreBatchSize: Object.freeze({ min: 1, max: 100, defaultValue: 10 })
});

// Schemas 8-26 keep their original limits so older documents parse exactly as written.
export const SNAPSHOT_SETTINGS_LIMITS_V26 = Object.freeze({
  intervalValue: SNAPSHOT_SETTINGS_LIMITS.intervalValue,
  deleteAfterValue: Object.freeze({ min: 1, max: 999, defaultValue: 30 }),
  retentionCount: Object.freeze({ min: 1, max: 1000, defaultValue: 100 })
});

const LEGACY_SNAPSHOT_INTERVAL_UNITS = new Set(["minutes", "hours", "days"]);
const LEGACY_SNAPSHOT_SETTINGS_LIMITS = Object.freeze({
  intervalValue: Object.freeze({ min: 1, max: 999 }),
  retentionDays: Object.freeze({ min: 1, max: 3650 }),
  retentionCount: SNAPSHOT_SETTINGS_LIMITS_V26.retentionCount
});

export const DEFAULT_SNAPSHOT_SETTINGS_V31 = Object.freeze({
  automaticEnabled: false,
  scheduleMode: SNAPSHOT_SCHEDULE_MODES.INTERVAL,
  intervalValue: SNAPSHOT_SETTINGS_LIMITS.intervalValue.defaultValue,
  intervalUnit: SNAPSHOT_INTERVAL_UNITS.MINUTES,
  exactTime: "09:00",
  exactDays: Object.freeze([1, 2, 3, 4, 5]),
  retentionCount: SNAPSHOT_SETTINGS_LIMITS.retentionCount.defaultValue,
  automaticDownloads: false,
  warnBeforeSnapshotDeletion: true
});

export const DEFAULT_SNAPSHOT_SETTINGS = Object.freeze({
  automaticEnabled: false,
  intervalValue: SNAPSHOT_SETTINGS_LIMITS.intervalValue.defaultValue,
  intervalUnit: SNAPSHOT_INTERVAL_UNITS.MINUTES,
  retentionCount: SNAPSHOT_SETTINGS_LIMITS.retentionCount.defaultValue,
  automaticDownloads: false,
  warnBeforeSnapshotDeletion: true
});

// Schemas 27-30 kept automatic saves by count and, optionally, by age.
export const DEFAULT_SNAPSHOT_SETTINGS_V30 = Object.freeze({
  ...DEFAULT_SNAPSHOT_SETTINGS_V31,
  deleteOldAutomaticEnabled: false,
  deleteAfterValue: SNAPSHOT_SETTINGS_LIMITS_V30.deleteAfterValue.defaultValue,
  deleteAfterUnit: SNAPSHOT_AGE_UNITS.DAYS
});

export const DEFAULT_SNAPSHOT_SETTINGS_V26 = Object.freeze({
  automaticEnabled: false,
  scheduleMode: SNAPSHOT_SCHEDULE_MODES.INTERVAL,
  intervalValue: SNAPSHOT_SETTINGS_LIMITS_V26.intervalValue.defaultValue,
  intervalUnit: SNAPSHOT_INTERVAL_UNITS.MINUTES,
  exactTime: "09:00",
  exactDays: Object.freeze([1, 2, 3, 4, 5]),
  deleteAutomaticEnabled: false,
  deleteAfterValue: SNAPSHOT_SETTINGS_LIMITS_V26.deleteAfterValue.defaultValue,
  deleteAfterUnit: SNAPSHOT_INTERVAL_UNITS.DAYS,
  retentionCount: SNAPSHOT_SETTINGS_LIMITS_V26.retentionCount.defaultValue,
  automaticDownloads: false,
  warnBeforeSnapshotDeletion: true
});

export const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  keepPrivateTabsBetweenSessions: false,
  automaticSnapshotsEnabled: false
});

const LEGACY_DEFAULT_ACTIVE_TAB_HIGHLIGHT = Object.freeze({
  mode: ACTIVE_TAB_HIGHLIGHT_MODES.FIREFOX,
  color: "#0060df"
});

export const DEFAULT_APPEARANCE = Object.freeze({
  mode: APPEARANCE_MODES.DEFAULT,
  contentMode: APPEARANCE_CONTENT_MODES.FULL,
  solidColor: "#2b2a33",
  activeTabHighlight: Object.freeze({
    mode: ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM,
    color: "#ffffff"
  }),
  applyToSettings: false,
  settingsBackgroundColor: "#2b2a33",
  typography: Object.freeze({
    source: TYPOGRAPHY_SOURCES.SYSTEM,
    fontFamily: "system-ui",
    fontSize: SETTINGS_FONT_SIZE_PRESETS.MEDIUM
  }),
  workspaceGlowMode: DEFAULT_WORKSPACE_GLOW_MODE,
  gradient: Object.freeze({
    angle: 135,
    stops: Object.freeze([
      Object.freeze({ color: "#2563eb", position: 0 }),
      Object.freeze({ color: "#7c3aed", position: 100 })
    ])
  })
});

// Schema 33 starts fresh profiles at Medium text. Older schemas keep Small as
// their default; a stored size is never changed by an upgrade.
export const DEFAULT_APPEARANCE_V32 = Object.freeze({
  ...DEFAULT_APPEARANCE,
  typography: Object.freeze({
    ...DEFAULT_APPEARANCE.typography,
    fontSize: SETTINGS_FONT_SIZE_PRESETS.SMALL
  })
});

// Schema 31 moved the Settings surface to the sidebar's own color. Documents
// written before it keep the value they were written with.
export const DEFAULT_APPEARANCE_V30 = Object.freeze({
  ...DEFAULT_APPEARANCE_V32,
  settingsBackgroundColor: "#202022"
});

export const SETTINGS_STATE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_STATE: "INVALID_STATE",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const SETTINGS_STATE_ERROR_MESSAGES = Object.freeze({
  [SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST]: "The settings request is invalid.",
  [SETTINGS_STATE_ERROR_CODES.INVALID_STATE]:
    "Settings data is invalid and was not changed.",
  [SETTINGS_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]:
    "Settings data uses an unsupported schema version and was not changed.",
  [SETTINGS_STATE_ERROR_CODES.STORAGE_UNAVAILABLE]:
    "Settings storage is unavailable. Stored settings were not changed.",
  [SETTINGS_STATE_ERROR_CODES.INTERNAL_ERROR]: "Settings could not be loaded."
});

export class SettingsStateError extends Error {
  constructor(code, message = SETTINGS_STATE_ERROR_MESSAGES[code], options = {}) {
    super(message, options);
    this.name = "SettingsStateError";
    this.code = code;
  }
}

function invalidState(reason) {
  return new SettingsStateError(
    SETTINGS_STATE_ERROR_CODES.INVALID_STATE,
    `${SETTINGS_STATE_ERROR_MESSAGES[SETTINGS_STATE_ERROR_CODES.INVALID_STATE]} ${reason}`
  );
}

function invalidRequest(reason) {
  return new SettingsStateError(
    SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST,
    `${SETTINGS_STATE_ERROR_MESSAGES[SETTINGS_STATE_ERROR_CODES.INVALID_REQUEST]} ${reason}`
  );
}

function unsupportedVersion() {
  return new SettingsStateError(
    SETTINGS_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
    SETTINGS_STATE_ERROR_MESSAGES[SETTINGS_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function hasOnlyKeys(value, allowedKeys) {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => allowedKeys.includes(key));
}

function parseSize(value, key, label, errorFactory = invalidState) {
  const limits = SIDEBAR_SIZE_LIMITS[key];
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
    throw errorFactory(
      `${label} must be an integer from ${limits.min} through ${limits.max}.`
    );
  }
  return value;
}

function parseColor(value, label, errorFactory = invalidState) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw errorFactory(`${label} must be a six-digit hexadecimal color.`);
  }
  return value.toLowerCase();
}

function parseGradient(value, errorFactory = invalidState) {
  if (!isRecord(value) || !hasExactKeys(value, ["angle", "stops"])) {
    throw errorFactory("The gradient has an invalid shape.");
  }
  if (
    !Number.isInteger(value.angle) ||
    value.angle < GRADIENT_LIMITS.minAngle ||
    value.angle > GRADIENT_LIMITS.maxAngle
  ) {
    throw errorFactory("The gradient angle must be an integer from 0 through 359.");
  }
  if (
    !Array.isArray(value.stops) ||
    value.stops.length < GRADIENT_LIMITS.minStops ||
    value.stops.length > GRADIENT_LIMITS.maxStops
  ) {
    throw errorFactory("A gradient must contain from two through six stops.");
  }

  let previousPosition = -1;
  const stops = value.stops.map((stop, index) => {
    if (!isRecord(stop) || !hasExactKeys(stop, ["color", "position"])) {
      throw errorFactory(`Gradient stop ${index} has an invalid shape.`);
    }
    if (
      !Number.isInteger(stop.position) ||
      stop.position < 0 ||
      stop.position > 100 ||
      stop.position <= previousPosition
    ) {
      throw errorFactory("Gradient stop positions must be unique integers in ascending order.");
    }
    previousPosition = stop.position;
    return {
      color: parseColor(stop.color, `Gradient stop ${index} color`, errorFactory),
      position: stop.position
    };
  });
  return { angle: value.angle, stops };
}

function parsePrivacy(
  value,
  errorFactory = invalidState,
  { includeAutomaticSnapshots = true } = {}
) {
  const expectedKeys = ["keepPrivateTabsBetweenSessions"];
  if (includeAutomaticSnapshots) {
    expectedKeys.push("automaticSnapshotsEnabled");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, expectedKeys)
  ) {
    throw errorFactory("The private-browsing settings have an invalid shape.");
  }
  for (const key of expectedKeys) {
    if (typeof value[key] !== "boolean") {
      throw errorFactory(`Private setting ${key} must be a boolean.`);
    }
  }
  return {
    keepPrivateTabsBetweenSessions: value.keepPrivateTabsBetweenSessions,
    ...(includeAutomaticSnapshots
      ? { automaticSnapshotsEnabled: value.automaticSnapshotsEnabled }
      : {})
  };
}

function parseActiveTabHighlight(value, errorFactory = invalidState) {
  if (!isRecord(value) || !hasExactKeys(value, ["mode", "color"])) {
    throw errorFactory("The active-tab highlight has an invalid shape.");
  }
  if (!Object.values(ACTIVE_TAB_HIGHLIGHT_MODES).includes(value.mode)) {
    throw errorFactory("The active-tab highlight mode is unsupported.");
  }
  return {
    mode: value.mode,
    color: parseColor(value.color, "Active-tab highlight color", errorFactory)
  };
}

function parseNavigation(
  value,
  errorFactory = invalidState,
  supportedPanelIds = SETTINGS_PANEL_IDS_V18
) {
  if (!isRecord(value) || !hasExactKeys(value, ["rememberLastPanel", "lastPanel"])) {
    throw errorFactory("The Settings navigation state has an invalid shape.");
  }
  if (typeof value.rememberLastPanel !== "boolean") {
    throw errorFactory("The remember-last-Settings-tab preference must be a boolean.");
  }
  if (typeof value.lastPanel !== "string" || !supportedPanelIds.includes(value.lastPanel)) {
    throw errorFactory("The remembered Settings tab is unsupported.");
  }
  return {
    rememberLastPanel: value.rememberLastPanel,
    lastPanel: value.lastPanel
  };
}

function parseAppearance(
  value,
  errorFactory = invalidState,
  {
    includeContentMode = true,
    includeActiveTabHighlight = true,
    includeSettingsTheme = false,
    includeTypography = false,
    includeFontAssets = false,
    includeTypographySource = false,
    includeTransparent = false,
    includeContainerGlow = false,
    includeWorkspaceGlow = false,
    allowedFontSizes = null
  } = {}
) {
  const expectedKeys = ["mode", "solidColor", "gradient"];
  if (includeContentMode) {
    expectedKeys.push("contentMode");
  }
  if (includeActiveTabHighlight) {
    expectedKeys.push("activeTabHighlight");
  }
  if (includeSettingsTheme) {
    expectedKeys.push("applyToSettings", "settingsBackgroundColor");
  }
  if (includeTypography) {
    expectedKeys.push("typography");
  }
  if (includeContainerGlow) {
    expectedKeys.push("containerGlowEnabled");
  }
  if (includeWorkspaceGlow) {
    expectedKeys.push("workspaceGlowMode");
  }
  if (!isRecord(value) || !hasExactKeys(value, expectedKeys)) {
    throw errorFactory("The appearance settings have an invalid shape.");
  }
  const supportedModes = includeTransparent
    ? [...Object.values(APPEARANCE_MODES), LEGACY_TRANSPARENT_APPEARANCE_MODE]
    : Object.values(APPEARANCE_MODES);
  if (!supportedModes.includes(value.mode)) {
    throw errorFactory("The appearance mode is unsupported.");
  }
  if (
    includeContentMode &&
    !Object.values(APPEARANCE_CONTENT_MODES).includes(value.contentMode)
  ) {
    throw errorFactory("The appearance content mode is unsupported.");
  }
  const parsed = {
    mode: value.mode,
    solidColor: parseColor(value.solidColor, "Solid color", errorFactory),
    gradient: parseGradient(value.gradient, errorFactory)
  };
  if (includeContentMode) {
    parsed.contentMode = value.contentMode;
  }
  if (includeActiveTabHighlight) {
    parsed.activeTabHighlight = parseActiveTabHighlight(value.activeTabHighlight, errorFactory);
  }
  if (includeSettingsTheme) {
    if (typeof value.applyToSettings !== "boolean") {
      throw errorFactory("The Settings theme preference must be a boolean.");
    }
    parsed.applyToSettings = value.applyToSettings;
    parsed.settingsBackgroundColor = parseColor(
      value.settingsBackgroundColor,
      "Settings background color",
      errorFactory
    );
  }
  if (includeTypography) {
    const typographyKeys = includeTypographySource
      ? ["source", "fontFamily", "fontSize"]
      : includeFontAssets
        ? ["source", "fontFamily", "fontAssetId", "fontSize"]
        : ["customFontEnabled", "fontFamily", "fontSize"];
    if (
      !isRecord(value.typography) ||
      !hasExactKeys(value.typography, typographyKeys)
    ) {
      throw errorFactory("The typography settings have an invalid shape.");
    }
    const fontFamily = typeof value.typography.fontFamily === "string"
      ? value.typography.fontFamily.trim()
      : "";
    if (
      typeof value.typography.fontFamily !== "string" ||
      fontFamily.length < APPEARANCE_TYPOGRAPHY_LIMITS.fontFamilyLength.min ||
      fontFamily.length > APPEARANCE_TYPOGRAPHY_LIMITS.fontFamilyLength.max ||
      /[\u0000-\u001f\u007f;]/.test(fontFamily) ||
      !Number.isInteger(value.typography.fontSize) ||
      (allowedFontSizes
        ? !allowedFontSizes.includes(value.typography.fontSize)
        : value.typography.fontSize < LEGACY_SETTINGS_FONT_SIZE_LIMITS.min ||
          value.typography.fontSize > LEGACY_SETTINGS_FONT_SIZE_LIMITS.max)
    ) {
      throw errorFactory("The typography settings are invalid.");
    }
    if (includeTypographySource) {
      const source = value.typography.source;
      if (
        !CURRENT_TYPOGRAPHY_SOURCES.includes(source) ||
        (source === TYPOGRAPHY_SOURCES.SYSTEM && fontFamily !== "system-ui") ||
        (source === TYPOGRAPHY_SOURCES.GENERIC && !GENERIC_FONT_FAMILIES.includes(fontFamily))
      ) {
        throw errorFactory("The typography settings are invalid.");
      }
      parsed.typography = { source, fontFamily, fontSize: value.typography.fontSize };
    } else if (includeFontAssets) {
      const source = value.typography.source;
      const assetId = value.typography.fontAssetId;
      const validAsset = source === TYPOGRAPHY_SOURCES.UPLOADED
        ? typeof assetId === "string" && FONT_ASSET_ID_PATTERN.test(assetId)
        : assetId === null;
      // "Sidebars Uploaded" is the value legacy records were written with, not a
      // product reference. It keeps the former name through the rename to
      // Terminus because changing it would reject settings already on disk.
      const expectedUploadedFamily = typeof assetId === "string"
        ? `Sidebars Uploaded ${assetId.slice("font-".length, "font-".length + 12).toUpperCase()}`
        : null;
      if (
        !Object.values(TYPOGRAPHY_SOURCES).includes(source) ||
        !validAsset ||
        (source === TYPOGRAPHY_SOURCES.SYSTEM && fontFamily !== "system-ui") ||
        (source === TYPOGRAPHY_SOURCES.GENERIC && !GENERIC_FONT_FAMILIES.includes(fontFamily)) ||
        (source === TYPOGRAPHY_SOURCES.UPLOADED && fontFamily !== expectedUploadedFamily)
      ) {
        throw errorFactory("The typography settings are invalid.");
      }
      parsed.typography = {
        source,
        fontFamily,
        fontAssetId: assetId,
        fontSize: value.typography.fontSize
      };
    } else {
      if (typeof value.typography.customFontEnabled !== "boolean") {
        throw errorFactory("The typography settings are invalid.");
      }
      parsed.typography = {
        customFontEnabled: value.typography.customFontEnabled,
        fontFamily,
        fontSize: value.typography.fontSize
      };
    }
  }
  if (includeContainerGlow) {
    if (typeof value.containerGlowEnabled !== "boolean") {
      throw errorFactory("The container glow preference must be a boolean.");
    }
    parsed.containerGlowEnabled = value.containerGlowEnabled;
  }
  if (includeWorkspaceGlow) {
    if (!Object.values(WORKSPACE_GLOW_MODES).includes(value.workspaceGlowMode)) {
      throw errorFactory("The workspace glow mode is unsupported.");
    }
    parsed.workspaceGlowMode = value.workspaceGlowMode;
  }
  return parsed;
}

function parseSidebar(
  value,
  errorFactory = invalidState,
  {
    legacy = false,
    includeRearrangementLock = true,
    includeActionButtons = true,
    includeWorkspaceRemovalWarning = false,
    includeRightClickBehavior = false
  } = {}
) {
  const sizeKey = legacy ? "spacerSize" : "dividerSize";
  const expectedKeys = ["railSize", "iconSize", sizeKey];
  if (includeRearrangementLock) {
    expectedKeys.push("workspaceReorderingLocked");
  }
  if (includeActionButtons) {
    expectedKeys.push("showActionButtons");
  }
  if (includeWorkspaceRemovalWarning) {
    expectedKeys.push("warnBeforeWorkspaceRemoval");
  }
  if (includeRightClickBehavior) {
    expectedKeys.push("rightClickBehavior");
  }
  if (!isRecord(value) || !hasExactKeys(value, expectedKeys)) {
    throw errorFactory("The sidebar settings have an invalid shape.");
  }
  const railSize = parseSize(value.railSize, "railSize", "Rail size", errorFactory);
  const iconSize = parseSize(value.iconSize, "iconSize", "Icon size", errorFactory);
  const dividerSize = parseSize(
    value[sizeKey],
    "dividerSize",
    legacy ? "Spacer size" : "Divider size",
    errorFactory
  );
  const maximumIconSize = getMaximumIconSizeForRail(railSize, errorFactory);
  if (iconSize > maximumIconSize) {
    throw errorFactory(
      `Icon size cannot exceed ${maximumIconSize} at the selected rail size.`
    );
  }
  const parsed = legacy
    ? { railSize, iconSize, spacerSize: dividerSize }
    : { railSize, iconSize, dividerSize };
  if (includeRearrangementLock) {
    if (typeof value.workspaceReorderingLocked !== "boolean") {
      throw errorFactory("The workspace rearrangement lock must be a boolean.");
    }
    parsed.workspaceReorderingLocked = value.workspaceReorderingLocked;
  }
  if (includeActionButtons) {
    if (typeof value.showActionButtons !== "boolean") {
      throw errorFactory("The action-button visibility must be a boolean.");
    }
    parsed.showActionButtons = value.showActionButtons;
  }
  if (includeWorkspaceRemovalWarning) {
    if (typeof value.warnBeforeWorkspaceRemoval !== "boolean") {
      throw errorFactory("The workspace-removal warning preference must be a boolean.");
    }
    parsed.warnBeforeWorkspaceRemoval = value.warnBeforeWorkspaceRemoval;
  }
  if (includeRightClickBehavior) {
    if (!Object.values(LEGACY_SIDEBAR_RIGHT_CLICK_BEHAVIORS).includes(value.rightClickBehavior)) {
      throw errorFactory("The right-click behavior is unsupported.");
    }
    parsed.rightClickBehavior = value.rightClickBehavior;
  }
  return parsed;
}

function parseSizePreset(value, label, errorFactory = invalidState) {
  if (!SIDEBAR_SIZE_PRESET_ORDER.includes(value)) {
    throw errorFactory(`${label} is unsupported.`);
  }
  return value;
}

export function getWorkspaceSizeGeometry(value, errorFactory = invalidState) {
  return WORKSPACE_SIZE_GEOMETRY[
    parseSizePreset(value, "Workspace size", errorFactory)
  ];
}

export function getTabSizeGeometry(value, errorFactory = invalidState) {
  return TAB_SIZE_GEOMETRY[
    parseSizePreset(value, "Tab size", errorFactory)
  ];
}

export function getNearestWorkspaceSizePreset(railSize, iconSize, errorFactory = invalidState) {
  const parsedRailSize = parseSize(railSize, "railSize", "Rail size", errorFactory);
  const parsedIconSize = parseSize(iconSize, "iconSize", "Icon size", errorFactory);
  return SIDEBAR_SIZE_PRESET_ORDER.reduce((nearest, preset) => {
    const geometry = V23_WORKSPACE_SIZE_GEOMETRY[preset];
    const distance = Math.abs(parsedRailSize - geometry.railSize) +
      Math.abs(parsedIconSize - geometry.iconSize);
    return nearest === null || distance < nearest.distance
      ? { preset, distance }
      : nearest;
  }, null).preset;
}

function parsePresetSidebar(
  value,
  errorFactory = invalidState,
  {
    includeRightClickBehavior = true,
    includeAddWorkspaceButton = false,
    includeClosePreference = false,
    includeTabVisibilityAndSearchPreferences = false,
    includeRemovalWarning = true,
    includeLoadWarning = false
  } = {}
) {
  const expectedKeys = [
    "workspaceSize",
    "tabSize",
    "dividerSize",
    "workspaceReorderingLocked",
    "showActionButtons"
  ];
  if (includeRemovalWarning) expectedKeys.push("warnBeforeWorkspaceRemoval");
  if (includeLoadWarning) expectedKeys.push("warnBeforeLoadingManyTabs");
  if (includeRightClickBehavior) expectedKeys.push("rightClickBehavior");
  if (includeAddWorkspaceButton) expectedKeys.push("showAddWorkspaceButton");
  if (includeClosePreference) {
    expectedKeys.push("warnBeforeClosingMultipleTabs");
  }
  if (includeTabVisibilityAndSearchPreferences) {
    expectedKeys.push(
      "hideUnloadedTabsFromFirefox",
      "showTabSearch",
      "tabSearchPosition"
    );
  }
  if (!isRecord(value) || !hasExactKeys(value, expectedKeys)) {
    throw errorFactory("The sidebar settings have an invalid shape.");
  }
  if (includeAddWorkspaceButton && typeof value.showAddWorkspaceButton !== "boolean") {
    throw errorFactory("The add-workspace button visibility must be a boolean.");
  }
  if (
    includeClosePreference &&
    typeof value.warnBeforeClosingMultipleTabs !== "boolean"
  ) {
    throw errorFactory("The multiple-tab close warning preference must be a boolean.");
  }
  if (
    includeTabVisibilityAndSearchPreferences &&
    typeof value.hideUnloadedTabsFromFirefox !== "boolean"
  ) {
    throw errorFactory("The unloaded-tab visibility preference must be a boolean.");
  }
  if (
    includeTabVisibilityAndSearchPreferences &&
    typeof value.showTabSearch !== "boolean"
  ) {
    throw errorFactory("The tab-search visibility preference must be a boolean.");
  }
  if (
    includeTabVisibilityAndSearchPreferences &&
    !Object.values(TAB_SEARCH_POSITIONS).includes(value.tabSearchPosition)
  ) {
    throw errorFactory("The tab-search position is unsupported.");
  }
  if (typeof value.workspaceReorderingLocked !== "boolean") {
    throw errorFactory("The workspace rearrangement lock must be a boolean.");
  }
  if (typeof value.showActionButtons !== "boolean") {
    throw errorFactory("The action-button visibility must be a boolean.");
  }
  if (includeRemovalWarning && typeof value.warnBeforeWorkspaceRemoval !== "boolean") {
    throw errorFactory("The workspace-removal warning preference must be a boolean.");
  }
  if (includeLoadWarning && typeof value.warnBeforeLoadingManyTabs !== "boolean") {
    throw errorFactory("The many-tab load warning preference must be a boolean.");
  }
  if (
    includeRightClickBehavior &&
    !Object.values(LEGACY_SIDEBAR_RIGHT_CLICK_BEHAVIORS).includes(value.rightClickBehavior)
  ) {
    throw errorFactory("The right-click behavior is unsupported.");
  }
  return {
    workspaceSize: parseSizePreset(value.workspaceSize, "Workspace size", errorFactory),
    tabSize: parseSizePreset(value.tabSize, "Tab size", errorFactory),
    dividerSize: parseSize(value.dividerSize, "dividerSize", "Divider size", errorFactory),
    workspaceReorderingLocked: value.workspaceReorderingLocked,
    showActionButtons: value.showActionButtons,
    ...(includeRemovalWarning
      ? { warnBeforeWorkspaceRemoval: value.warnBeforeWorkspaceRemoval }
      : {}),
    ...(includeLoadWarning
      ? { warnBeforeLoadingManyTabs: value.warnBeforeLoadingManyTabs }
      : {}),
    ...(includeRightClickBehavior ? { rightClickBehavior: value.rightClickBehavior } : {}),
    ...(includeAddWorkspaceButton
      ? { showAddWorkspaceButton: value.showAddWorkspaceButton }
      : {}),
    ...(includeClosePreference
      ? { warnBeforeClosingMultipleTabs: value.warnBeforeClosingMultipleTabs }
      : {}),
    ...(includeTabVisibilityAndSearchPreferences
      ? {
          hideUnloadedTabsFromFirefox: value.hideUnloadedTabsFromFirefox,
          showTabSearch: value.showTabSearch,
          tabSearchPosition: value.tabSearchPosition
        }
      : {})
  };
}

function parseIntegerInRange(value, limits, label, errorFactory) {
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
    throw errorFactory(`${label} must be an integer from ${limits.min} through ${limits.max}.`);
  }
  return value;
}

function parseSnapshotDurationUnit(value, label, errorFactory) {
  if (!Object.values(SNAPSHOT_INTERVAL_UNITS).includes(value)) {
    throw errorFactory(`${label} unit is unsupported.`);
  }
  return value;
}

function parseSnapshotAgeUnit(value, label, errorFactory) {
  if (!Object.values(SNAPSHOT_AGE_UNITS).includes(value)) {
    throw errorFactory(`${label} unit is unsupported.`);
  }
  return value;
}

export function getSnapshotIntervalValueLimits(unit) {
  parseSnapshotDurationUnit(unit, "Snapshot interval", invalidRequest);
  return {
    min:
      unit === SNAPSHOT_INTERVAL_UNITS.SECONDS
        ? SNAPSHOT_SETTINGS_LIMITS.intervalValue.secondsMin
        : SNAPSHOT_SETTINGS_LIMITS.intervalValue.min,
    max: SNAPSHOT_SETTINGS_LIMITS.intervalValue.max
  };
}

export function snapshotDurationMilliseconds(value, unit) {
  const parsedUnit = parseSnapshotDurationUnit(unit, "Snapshot duration", invalidRequest);
  if (!Number.isSafeInteger(value) || value < 1 || value > 999) {
    throw invalidRequest("Snapshot duration must be an integer from 1 through 999.");
  }
  const multiplier = {
    [SNAPSHOT_INTERVAL_UNITS.SECONDS]: 1000,
    [SNAPSHOT_INTERVAL_UNITS.MINUTES]: 60 * 1000,
    [SNAPSHOT_INTERVAL_UNITS.HOURS]: 60 * 60 * 1000,
    [SNAPSHOT_INTERVAL_UNITS.DAYS]: 24 * 60 * 60 * 1000,
    [SNAPSHOT_INTERVAL_UNITS.WEEKS]: 7 * 24 * 60 * 60 * 1000,
    [SNAPSHOT_INTERVAL_UNITS.YEARS]: 365 * 24 * 60 * 60 * 1000
  }[parsedUnit];
  return value * multiplier;
}

function parseLegacySnapshotSettings(value, errorFactory = invalidState) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "automaticEnabled",
      "intervalValue",
      "intervalUnit",
      "retentionDays",
      "retentionCount",
      "automaticDownloads",
      "cleanupExportedFiles"
    ])
  ) {
    throw errorFactory("The snapshot settings have an invalid shape.");
  }
  for (const key of ["automaticEnabled", "automaticDownloads", "cleanupExportedFiles"]) {
    if (typeof value[key] !== "boolean") {
      throw errorFactory(`Snapshot setting ${key} must be a boolean.`);
    }
  }
  if (!LEGACY_SNAPSHOT_INTERVAL_UNITS.has(value.intervalUnit)) {
    throw errorFactory("The snapshot interval unit is unsupported.");
  }
  return {
    automaticEnabled: value.automaticEnabled,
    intervalValue: parseIntegerInRange(
      value.intervalValue,
      LEGACY_SNAPSHOT_SETTINGS_LIMITS.intervalValue,
      "Snapshot interval",
      errorFactory
    ),
    intervalUnit: value.intervalUnit,
    retentionDays: parseIntegerInRange(
      value.retentionDays,
      LEGACY_SNAPSHOT_SETTINGS_LIMITS.retentionDays,
      "Snapshot retention days",
      errorFactory
    ),
    retentionCount: parseIntegerInRange(
      value.retentionCount,
      LEGACY_SNAPSHOT_SETTINGS_LIMITS.retentionCount,
      "Snapshot retention count",
      errorFactory
    ),
    automaticDownloads: value.automaticDownloads,
    cleanupExportedFiles: value.cleanupExportedFiles
  };
}

// With `separateAgeLimit` (schema 27), `deleteOldAutomaticEnabled` gates only the
// age rule and the maximum always applies. Earlier schemas used one
// `deleteAutomaticEnabled` switch for both rules. Schema 31 removed the age
// rule outright (`includeAgeCleanup: false`), leaving the maximum as the only
// automatic-save limit.
function parseSnapshotSettings(
  value,
  errorFactory = invalidState,
  {
    includeDeletionWarning = false,
    includeSchedule = false,
    includeAutomaticSettingsBackups = false,
    separateAgeLimit = false,
    includeAgeCleanup = true,
    includeRestoreBatchSize = false
  } = {}
) {
  const cleanupKey = separateAgeLimit ? "deleteOldAutomaticEnabled" : "deleteAutomaticEnabled";
  const limits = !includeAgeCleanup
    ? SNAPSHOT_SETTINGS_LIMITS
    : separateAgeLimit
      ? SNAPSHOT_SETTINGS_LIMITS_V30
      : SNAPSHOT_SETTINGS_LIMITS_V26;
  const expectedKeys = [
    "automaticEnabled",
    "intervalValue",
    "intervalUnit",
    "retentionCount",
    "automaticDownloads"
  ];
  if (includeAgeCleanup) {
    expectedKeys.push(cleanupKey, "deleteAfterValue", "deleteAfterUnit");
  }
  if (includeAutomaticSettingsBackups) {
    expectedKeys.push("automaticSettingsBackupsEnabled");
  }
  if (includeSchedule) {
    expectedKeys.push("scheduleMode", "exactTime", "exactDays");
  }
  if (includeDeletionWarning) {
    expectedKeys.push("warnBeforeSnapshotDeletion");
  }
  if (includeRestoreBatchSize) {
    expectedKeys.push("restoreBatchSize");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, expectedKeys)
  ) {
    throw errorFactory("The snapshot settings have an invalid shape.");
  }
  const booleanKeys = ["automaticEnabled", "automaticDownloads"];
  if (includeAgeCleanup) {
    booleanKeys.push(cleanupKey);
  }
  if (includeAutomaticSettingsBackups) {
    booleanKeys.push("automaticSettingsBackupsEnabled");
  }
  if (includeDeletionWarning) {
    booleanKeys.push("warnBeforeSnapshotDeletion");
  }
  for (const key of booleanKeys) {
    if (typeof value[key] !== "boolean") {
      throw errorFactory(`Snapshot setting ${key} must be a boolean.`);
    }
  }
  const intervalUnit = parseSnapshotDurationUnit(
    value.intervalUnit,
    "Snapshot interval",
    errorFactory
  );
  const parsed = {
    automaticEnabled: value.automaticEnabled,
    intervalValue: parseIntegerInRange(
      value.intervalValue,
      getSnapshotIntervalValueLimits(intervalUnit),
      "Snapshot interval",
      errorFactory
    ),
    intervalUnit,
    retentionCount: parseIntegerInRange(
      value.retentionCount,
      limits.retentionCount,
      "Snapshot retention count",
      errorFactory
    ),
    automaticDownloads: value.automaticDownloads
  };
  if (includeAgeCleanup) {
    parsed[cleanupKey] = value[cleanupKey];
    parsed.deleteAfterValue = parseIntegerInRange(
      value.deleteAfterValue,
      limits.deleteAfterValue,
      "Automatic snapshot deletion age",
      errorFactory
    );
    parsed.deleteAfterUnit = (separateAgeLimit ? parseSnapshotAgeUnit : parseSnapshotDurationUnit)(
      value.deleteAfterUnit,
      "Automatic snapshot deletion",
      errorFactory
    );
  }
  if (includeAutomaticSettingsBackups) {
    parsed.automaticSettingsBackupsEnabled = value.automaticSettingsBackupsEnabled;
  }
  if (includeSchedule) {
    if (!Object.values(SNAPSHOT_SCHEDULE_MODES).includes(value.scheduleMode)) {
      throw errorFactory("The automatic snapshot schedule mode is unsupported.");
    }
    if (typeof value.exactTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.exactTime)) {
      throw errorFactory("The exact snapshot time must use 24-hour HH:MM format.");
    }
    if (
      !Array.isArray(value.exactDays) ||
      value.exactDays.length < 1 ||
      value.exactDays.length > 7 ||
      new Set(value.exactDays).size !== value.exactDays.length ||
      value.exactDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw errorFactory("Exact snapshot days must contain one or more unique weekdays.");
    }
    parsed.scheduleMode = value.scheduleMode;
    parsed.exactTime = value.exactTime;
    parsed.exactDays = [...value.exactDays].sort((left, right) => left - right);
  }
  if (includeDeletionWarning) {
    parsed.warnBeforeSnapshotDeletion = value.warnBeforeSnapshotDeletion;
  }
  if (includeRestoreBatchSize) {
    parsed.restoreBatchSize = parseIntegerInRange(
      value.restoreBatchSize,
      limits.restoreBatchSize,
      "Snapshot restore batch size",
      errorFactory
    );
  }
  return parsed;
}

export function getMaximumIconSizeForRail(railSize, errorFactory = invalidState) {
  const railLimits = SIDEBAR_SIZE_LIMITS.railSize;
  if (!Number.isInteger(railSize) || railSize < railLimits.min || railSize > railLimits.max) {
    throw errorFactory("The rail size cannot determine a safe icon limit.");
  }
  return Math.min(
    SIDEBAR_SIZE_LIMITS.iconSize.max,
    railSize - SIDEBAR_GEOMETRY_CONSTANTS.railPadding - SIDEBAR_GEOMETRY_CONSTANTS.iconClearance
  );
}

export function parseSettingsStateV1(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sidebar"])) {
    throw invalidState("The legacy root document has an invalid shape.");
  }
  if (value.schemaVersion !== SETTINGS_STATE_LEGACY_SCHEMA_VERSION) {
    if (Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState("The legacy schema version is invalid.");
  }
  return {
    schemaVersion: SETTINGS_STATE_LEGACY_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      legacy: true,
      includeRearrangementLock: false,
      includeActionButtons: false
    })
  };
}

export function parseSettingsStateV2(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V2_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V2_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V2_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      legacy: true,
      includeRearrangementLock: false,
      includeActionButtons: false
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeContentMode: false,
      includeActiveTabHighlight: false
    })
  };
}

export function parseSettingsStateV3(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeRearrangementLock: false,
      includeActionButtons: false
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeActiveTabHighlight: false
    })
  };
}

export function parseSettingsStateV4(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V4_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V4_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V4_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, { includeActionButtons: false }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeActiveTabHighlight: false
    })
  };
}

export function parseSettingsStateV5(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V5_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V5_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V5_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, { includeActionButtons: false }),
    appearance: parseAppearance(value.appearance)
  };
}

export function parseSettingsStateV6(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V6_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V6_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V6_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar),
    appearance: parseAppearance(value.appearance)
  };
}

export function parseSettingsStateV7(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V7_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V7_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V7_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar),
    appearance: parseAppearance(value.appearance),
    snapshots: parseLegacySnapshotSettings(value.snapshots)
  };
}

export function parseSettingsStateV8(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V8_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V8_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V8_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar),
    appearance: parseAppearance(value.appearance),
    snapshots: parseSnapshotSettings(value.snapshots)
  };
}

export function parseSettingsStateV9(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V9_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V9_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V9_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar),
    appearance: parseAppearance(value.appearance),
    snapshots: parseSnapshotSettings(value.snapshots)
  };
}

export function parseSettingsStateV10(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V10_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V10_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V10_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true
    })
  };
}

export function parseSettingsStateV11(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V11_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V11_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V11_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTransparent: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true
    })
  };
}

export function parseSettingsStateV12(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V12_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V12_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V12_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true
    })
  };
}

export function parseSettingsStateV13(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "sidebar", "appearance", "snapshots", "navigation"])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V13_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V13_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V13_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true
    }),
    navigation: parseNavigation(value.navigation)
  };
}

export function parseSettingsStateV14(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sidebar",
      "appearance",
      "snapshots",
      "navigation",
      "privacy"
    ])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V14_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V14_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V14_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true
    }),
    navigation: parseNavigation(value.navigation),
    privacy: parsePrivacy(value.privacy, invalidState, { includeAutomaticSnapshots: false })
  };
}

export function parseSettingsStateV16(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sidebar",
      "appearance",
      "snapshots",
      "navigation",
      "privacy"
    ])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V16_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V16_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V16_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true
    }),
    navigation: parseNavigation(value.navigation),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV17(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sidebar",
      "appearance",
      "snapshots",
      "navigation",
      "privacy"
    ])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V17_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V17_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true
    }),
    navigation: parseNavigation(value.navigation),
    privacy: parsePrivacy(value.privacy)
  };
}

function parseSettingsStateV18WithPanels(value, supportedPanelIds) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sidebar",
      "appearance",
      "snapshots",
      "navigation",
      "privacy"
    ])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V18_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V18_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V18_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, supportedPanelIds),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV18(value) {
  return parseSettingsStateV18WithPanels(value, SETTINGS_PANEL_IDS_V18);
}

export function parseSettingsStateV19(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V19_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V19_SCHEMA_VERSION}.`);
  }
  const parsed = parseSettingsStateV18WithPanels(
    { ...value, schemaVersion: SETTINGS_STATE_V18_SCHEMA_VERSION },
    SETTINGS_PANEL_IDS_V26
  );
  return {
    ...parsed,
    schemaVersion: SETTINGS_STATE_V19_SCHEMA_VERSION,
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26)
  };
}

export function parseSettingsStateV20(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V20_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V20_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V20_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeContainerGlow: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV21(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V21_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V21_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V21_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeFontAssets: true,
      includeContainerGlow: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV22(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V22_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V22_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V22_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true,
      includeRightClickBehavior: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeFontAssets: true,
      includeContainerGlow: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV23(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V23_SCHEMA_VERSION) {
    if (
      isRecord(value) &&
      Number.isInteger(value.schemaVersion) &&
      value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION
    ) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V23_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V23_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeFontAssets: true,
      includeContainerGlow: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV24(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V24_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V24_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V24_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeFontAssets: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV25(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V25_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V25_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V25_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeFontAssets: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV26(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V26_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V26_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V26_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V26),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV27(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V27_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V27_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V27_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V32),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV28(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V28_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V28_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V28_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true,
      includeClosePreference: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V32),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV29(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V29_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V29_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V29_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true,
      includeClosePreference: true,
      includeTabVisibilityAndSearchPreferences: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V32),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV30(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V30_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V30_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V30_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true,
      includeClosePreference: true,
      includeTabVisibilityAndSearchPreferences: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true,
      includeRestoreBatchSize: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V32),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV31(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V31_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V31_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V31_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true,
      includeClosePreference: true,
      includeTabVisibilityAndSearchPreferences: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true,
      includeAgeCleanup: false,
      includeRestoreBatchSize: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V32),
    privacy: parsePrivacy(value.privacy)
  };
}

export function parseSettingsStateV32(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V32_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V32_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V32_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true,
      includeClosePreference: true,
      includeTabVisibilityAndSearchPreferences: true,
      includeRemovalWarning: false,
      includeLoadWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: false,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true,
      includeAgeCleanup: false,
      includeRestoreBatchSize: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V32),
    privacy: parsePrivacy(value.privacy)
  };
}

// Schema 33 is schema 32 with one more name allowed in navigation.lastPanel,
// for the Optional Firefox Styling tab. No field is added and no stored value
// changes, so the 32 -> 33 edge only re-stamps the version; only a fresh
// profile's default text size differs (DEFAULT_APPEARANCE_V32).
export function parseSettingsStateV33(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_V33_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V33_SCHEMA_VERSION}.`);
  }
  if (!hasExactKeys(value, [
    "schemaVersion",
    "sidebar",
    "appearance",
    "snapshots",
    "navigation",
    "privacy"
  ])) {
    throw invalidState("The root document has an invalid shape.");
  }
  return {
    schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION,
    sidebar: parsePresetSidebar(value.sidebar, invalidState, {
      includeRightClickBehavior: false,
      includeAddWorkspaceButton: true,
      includeClosePreference: true,
      includeTabVisibilityAndSearchPreferences: true,
      includeRemovalWarning: false,
      includeLoadWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: false,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true,
      includeAgeCleanup: false,
      includeRestoreBatchSize: true
    }),
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS_V33),
    privacy: parsePrivacy(value.privacy)
  };
}

// Schema 34 removes Sync as a current Settings destination. Historical parsers
// still admit it so an upgrade can move a remembered Sync panel to Storage.
export function parseSettingsState(value) {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_STATE_SCHEMA_VERSION) {
    if (isRecord(value) && Number.isInteger(value.schemaVersion) && value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
      throw unsupportedVersion();
    }
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_SCHEMA_VERSION}.`);
  }
  return {
    ...parseSettingsStateV33({
      ...value,
      schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION,
      navigation: {
        ...value.navigation,
        lastPanel: value.navigation?.lastPanel === "sync" ? "storage" : value.navigation?.lastPanel
      }
    }),
    schemaVersion: SETTINGS_STATE_SCHEMA_VERSION,
    navigation: parseNavigation(value.navigation, invalidState, SETTINGS_PANEL_IDS)
  };
}

export function useSystemInterfaceTypography(rawSettings) {
  const settings = parseSettingsState(rawSettings);
  const typography = settings.appearance.typography;
  if (
    typography.source === TYPOGRAPHY_SOURCES.SYSTEM &&
    typography.fontFamily === "system-ui"
  ) {
    return settings;
  }
  return parseSettingsState({
    ...settings,
    appearance: {
      ...settings.appearance,
      typography: {
        source: TYPOGRAPHY_SOURCES.SYSTEM,
        fontFamily: "system-ui",
        fontSize: typography.fontSize
      }
    }
  });
}

export function parseSettingsStateV15(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sidebar",
      "appearance",
      "snapshots",
      "navigation",
      "privacy"
    ])
  ) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > SETTINGS_STATE_SCHEMA_VERSION) {
    throw unsupportedVersion();
  }
  if (value.schemaVersion !== SETTINGS_STATE_V15_SCHEMA_VERSION) {
    throw invalidState(`Expected settings schema version ${SETTINGS_STATE_V15_SCHEMA_VERSION}.`);
  }
  return {
    schemaVersion: SETTINGS_STATE_V15_SCHEMA_VERSION,
    sidebar: parseSidebar(value.sidebar, invalidState, {
      includeWorkspaceRemovalWarning: true
    }),
    appearance: parseAppearance(value.appearance, invalidState, {
      includeSettingsTheme: true
    }),
    snapshots: parseSnapshotSettings(value.snapshots, invalidState, {
      includeDeletionWarning: true,
      includeSchedule: true
    }),
    navigation: parseNavigation(value.navigation),
    privacy: parsePrivacy(value.privacy, invalidState, { includeAutomaticSnapshots: false })
  };
}

export function migrateSettingsStateV1ToV2(value) {
  const legacy = parseSettingsStateV1(value);
  return parseSettingsStateV2({
    schemaVersion: SETTINGS_STATE_V2_SCHEMA_VERSION,
    sidebar: legacy.sidebar,
    appearance: {
      mode: APPEARANCE_MODES.FIREFOX,
      solidColor: "#141414",
      gradient: DEFAULT_APPEARANCE.gradient
    }
  });
}

export function migrateSettingsStateV2(value) {
  const previous = parseSettingsStateV2(value);
  return parseSettingsStateV3({
    schemaVersion: SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION,
    sidebar: {
      railSize: previous.sidebar.railSize,
      iconSize: previous.sidebar.iconSize,
      dividerSize: previous.sidebar.spacerSize
    },
    appearance: {
      ...previous.appearance,
      contentMode: APPEARANCE_CONTENT_MODES.FULL
    }
  });
}

export function migrateSettingsStateV3(value) {
  const previous = parseSettingsStateV3(value);
  return parseSettingsStateV4({
    ...previous,
    schemaVersion: SETTINGS_STATE_V4_SCHEMA_VERSION,
    sidebar: {
      ...previous.sidebar,
      workspaceReorderingLocked: false
    }
  });
}

export function migrateSettingsStateV4(value) {
  const previous = parseSettingsStateV4(value);
  return parseSettingsStateV5({
    ...previous,
    schemaVersion: SETTINGS_STATE_V5_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      activeTabHighlight: LEGACY_DEFAULT_ACTIVE_TAB_HIGHLIGHT
    }
  });
}

export function migrateSettingsStateV5(value) {
  const previous = parseSettingsStateV5(value);
  return parseSettingsStateV6({
    ...previous,
    schemaVersion: SETTINGS_STATE_V6_SCHEMA_VERSION,
    sidebar: {
      ...previous.sidebar,
      showActionButtons: true
    }
  });
}

export function migrateSettingsStateV6(value) {
  const previous = parseSettingsStateV6(value);
  return parseSettingsStateV7({
    ...previous,
    schemaVersion: SETTINGS_STATE_V7_SCHEMA_VERSION,
    snapshots: {
      automaticEnabled: false,
      intervalValue: 15,
      intervalUnit: "minutes",
      retentionDays: 30,
      retentionCount: 100,
      automaticDownloads: false,
      cleanupExportedFiles: true
    }
  });
}

function legacyRetentionDuration(retentionDays) {
  if (retentionDays <= SNAPSHOT_SETTINGS_LIMITS_V26.deleteAfterValue.max) {
    return { value: retentionDays, unit: SNAPSHOT_INTERVAL_UNITS.DAYS };
  }
  return {
    value: Math.min(
      SNAPSHOT_SETTINGS_LIMITS_V26.deleteAfterValue.max,
      Math.ceil(retentionDays / 7)
    ),
    unit: SNAPSHOT_INTERVAL_UNITS.WEEKS
  };
}

export function migrateSettingsStateV7(value) {
  const previous = parseSettingsStateV7(value);
  const retention = legacyRetentionDuration(previous.snapshots.retentionDays);
  return parseSettingsStateV8({
    ...previous,
    schemaVersion: SETTINGS_STATE_V8_SCHEMA_VERSION,
    snapshots: {
      automaticEnabled: previous.snapshots.automaticEnabled,
      intervalValue: previous.snapshots.intervalValue,
      intervalUnit: previous.snapshots.intervalUnit,
      deleteAutomaticEnabled: previous.snapshots.cleanupExportedFiles,
      deleteAfterValue: retention.value,
      deleteAfterUnit: retention.unit,
      retentionCount: previous.snapshots.retentionCount,
      automaticDownloads: previous.snapshots.automaticDownloads
    }
  });
}

export function migrateSettingsStateV8(value) {
  const previous = parseSettingsStateV8(value);
  return parseSettingsStateV9({
    ...previous,
    schemaVersion: SETTINGS_STATE_V9_SCHEMA_VERSION,
    snapshots: {
      ...previous.snapshots,
      automaticEnabled: false,
      deleteAutomaticEnabled: false,
      automaticDownloads: false
    }
  });
}

export function migrateSettingsStateV9(value) {
  const previous = parseSettingsStateV9(value);
  return parseSettingsStateV10({
    ...previous,
    schemaVersion: SETTINGS_STATE_V10_SCHEMA_VERSION,
    sidebar: {
      ...previous.sidebar,
      warnBeforeWorkspaceRemoval: true
    },
    snapshots: {
      ...previous.snapshots,
      warnBeforeSnapshotDeletion: true
    }
  });
}

export function migrateSettingsStateV10(value) {
  const previous = parseSettingsStateV10(value);
  return parseSettingsStateV11({
    ...previous,
    schemaVersion: SETTINGS_STATE_V11_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      applyToSettings: false,
      settingsBackgroundColor: "#000000"
    }
  });
}

export function migrateSettingsStateV11(value) {
  const previous = parseSettingsStateV11(value);
  return parseSettingsStateV12({
    ...previous,
    schemaVersion: SETTINGS_STATE_V12_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      mode: previous.appearance.mode === LEGACY_TRANSPARENT_APPEARANCE_MODE
        ? APPEARANCE_MODES.FIREFOX
        : previous.appearance.mode
    }
  });
}

export function migrateSettingsStateV12(value) {
  const previous = parseSettingsStateV12(value);
  return parseSettingsStateV13({
    ...previous,
    schemaVersion: SETTINGS_STATE_V13_SCHEMA_VERSION,
    navigation: DEFAULT_SETTINGS_NAVIGATION
  });
}

export function migrateSettingsStateV13(value) {
  const previous = parseSettingsStateV13(value);
  return parseSettingsStateV14({
    ...previous,
    schemaVersion: SETTINGS_STATE_V14_SCHEMA_VERSION,
    privacy: { keepPrivateTabsBetweenSessions: false }
  });
}

export function migrateSettingsStateV14(value) {
  const previous = parseSettingsStateV14(value);
  return parseSettingsStateV15({
    ...previous,
    schemaVersion: SETTINGS_STATE_V15_SCHEMA_VERSION,
    snapshots: {
      ...previous.snapshots,
      scheduleMode: DEFAULT_SNAPSHOT_SETTINGS_V26.scheduleMode,
      exactTime: DEFAULT_SNAPSHOT_SETTINGS_V26.exactTime,
      exactDays: DEFAULT_SNAPSHOT_SETTINGS_V26.exactDays
    }
  });
}

export function migrateSettingsStateV15(value) {
  const previous = parseSettingsStateV15(value);
  return parseSettingsStateV16({
    ...previous,
    schemaVersion: SETTINGS_STATE_V16_SCHEMA_VERSION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function migrateSettingsStateV16(value) {
  const previous = parseSettingsStateV16(value);
  return parseSettingsStateV17({
    ...previous,
    schemaVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      typography: LEGACY_DEFAULT_TYPOGRAPHY
    }
  });
}

export function migrateSettingsStateV17(value) {
  const previous = parseSettingsStateV17(value);
  return parseSettingsStateV18({
    ...previous,
    schemaVersion: SETTINGS_STATE_V18_SCHEMA_VERSION,
    snapshots: {
      ...previous.snapshots,
      automaticSettingsBackupsEnabled: false
    }
  });
}

export function migrateSettingsStateV18(value) {
  const previous = parseSettingsStateV18(value);
  return parseSettingsStateV19({
    ...previous,
    schemaVersion: SETTINGS_STATE_V19_SCHEMA_VERSION
  });
}

export function migrateSettingsStateV19(value) {
  const previous = parseSettingsStateV19(value);
  return parseSettingsStateV20({
    ...previous,
    schemaVersion: SETTINGS_STATE_V20_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      containerGlowEnabled: LEGACY_DEFAULT_CONTAINER_GLOW_ENABLED
    }
  });
}

export function migrateSettingsStateV20(value) {
  const previous = parseSettingsStateV20(value);
  const legacy = previous.appearance.typography;
  const source = !legacy.customFontEnabled
    ? TYPOGRAPHY_SOURCES.SYSTEM
    : GENERIC_FONT_FAMILIES.includes(legacy.fontFamily)
      ? TYPOGRAPHY_SOURCES.GENERIC
      : TYPOGRAPHY_SOURCES.LEGACY;
  return parseSettingsStateV21({
    ...previous,
    schemaVersion: SETTINGS_STATE_V21_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      typography: {
        source,
        fontFamily: source === TYPOGRAPHY_SOURCES.SYSTEM ? "system-ui" : legacy.fontFamily,
        fontAssetId: null,
        fontSize: legacy.fontSize
      }
    }
  });
}

export function migrateSettingsStateV21(value) {
  const previous = parseSettingsStateV21(value);
  return parseSettingsStateV22({
    ...previous,
    schemaVersion: SETTINGS_STATE_V22_SCHEMA_VERSION,
    sidebar: {
      ...previous.sidebar,
      rightClickBehavior: LEGACY_SIDEBAR_RIGHT_CLICK_BEHAVIORS.UNLOAD
    }
  });
}

export function migrateSettingsStateV22(value) {
  const previous = parseSettingsStateV22(value);
  return parseSettingsStateV23({
    ...previous,
    schemaVersion: SETTINGS_STATE_V23_SCHEMA_VERSION,
    sidebar: {
      workspaceSize: getNearestWorkspaceSizePreset(
        previous.sidebar.railSize,
        previous.sidebar.iconSize
      ),
      tabSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
      dividerSize: previous.sidebar.dividerSize,
      workspaceReorderingLocked: previous.sidebar.workspaceReorderingLocked,
      showActionButtons: previous.sidebar.showActionButtons,
      warnBeforeWorkspaceRemoval: previous.sidebar.warnBeforeWorkspaceRemoval,
      rightClickBehavior: previous.sidebar.rightClickBehavior
    }
  });
}

export function getNearestSettingsFontSize(value, errorFactory = invalidState) {
  if (
    !Number.isInteger(value) ||
    value < LEGACY_SETTINGS_FONT_SIZE_LIMITS.min ||
    value > LEGACY_SETTINGS_FONT_SIZE_LIMITS.max
  ) {
    throw errorFactory("The legacy Settings font size is invalid.");
  }
  return SETTINGS_FONT_SIZE_VALUES.reduce((nearest, candidate) => {
    const distance = Math.abs(value - candidate);
    return nearest === null || distance < nearest.distance
      ? { value: candidate, distance }
      : nearest;
  }, null).value;
}

export function migrateSettingsStateV23(value) {
  const previous = parseSettingsStateV23(value);
  const { containerGlowEnabled, ...appearance } = previous.appearance;
  return parseSettingsStateV24({
    ...previous,
    schemaVersion: SETTINGS_STATE_V24_SCHEMA_VERSION,
    appearance: {
      ...appearance,
      typography: {
        ...appearance.typography,
        fontSize: getNearestSettingsFontSize(appearance.typography.fontSize)
      },
      workspaceGlowMode: containerGlowEnabled
        ? WORKSPACE_GLOW_MODES.CONTAINER
        : WORKSPACE_GLOW_MODES.OFF
    }
  });
}

export function migrateSettingsStateV24(value) {
  const previous = parseSettingsStateV24(value);
  const { rightClickBehavior: _rightClickBehavior, ...sidebar } = previous.sidebar;
  return parseSettingsStateV25({
    ...previous,
    schemaVersion: SETTINGS_STATE_V25_SCHEMA_VERSION,
    sidebar
  });
}

// Custom fonts are no longer supported: typed and uploaded font choices become
// the system font, and the uploaded-font reference is dropped.
export function migrateSettingsStateV25(value) {
  const previous = parseSettingsStateV25(value);
  const { source, fontFamily, fontSize } = previous.appearance.typography;
  const typography = CURRENT_TYPOGRAPHY_SOURCES.includes(source)
    ? { source, fontFamily, fontSize }
    : { source: TYPOGRAPHY_SOURCES.SYSTEM, fontFamily: "system-ui", fontSize };
  return parseSettingsStateV26({
    ...previous,
    schemaVersion: SETTINGS_STATE_V26_SCHEMA_VERSION,
    appearance: { ...previous.appearance, typography }
  });
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

// Schema 27 makes the automatic-save maximum always apply. Profiles that had
// cleanup off get the largest maximum so no existing save is removed on upgrade,
// and ages shorter than a day round up to whole days.
export function migrateSettingsStateV26(value) {
  const previous = parseSettingsStateV26(value);
  const { deleteAutomaticEnabled, ...snapshots } = previous.snapshots;
  const age = Object.values(SNAPSHOT_AGE_UNITS).includes(snapshots.deleteAfterUnit)
    ? { value: snapshots.deleteAfterValue, unit: snapshots.deleteAfterUnit }
    : {
        value: Math.max(
          1,
          Math.ceil(
            snapshotDurationMilliseconds(snapshots.deleteAfterValue, snapshots.deleteAfterUnit) /
              DAY_MILLISECONDS
          )
        ),
        unit: SNAPSHOT_AGE_UNITS.DAYS
      };
  return parseSettingsStateV27({
    ...previous,
    schemaVersion: SETTINGS_STATE_V27_SCHEMA_VERSION,
    sidebar: { ...previous.sidebar, showAddWorkspaceButton: true },
    snapshots: {
      ...snapshots,
      deleteOldAutomaticEnabled: deleteAutomaticEnabled,
      deleteAfterValue: age.value,
      deleteAfterUnit: age.unit,
      retentionCount: deleteAutomaticEnabled
        ? snapshots.retentionCount
        : SNAPSHOT_SETTINGS_LIMITS.retentionCount.max
    }
  });
}

export function migrateSettingsStateV27(value) {
  const previous = parseSettingsStateV27(value);
  return parseSettingsStateV28({
    ...previous,
    schemaVersion: SETTINGS_STATE_V28_SCHEMA_VERSION,
    sidebar: {
      ...previous.sidebar,
      warnBeforeClosingMultipleTabs: true
    }
  });
}

export function migrateSettingsStateV28(value) {
  const previous = parseSettingsStateV28(value);
  return parseSettingsStateV29({
    ...previous,
    schemaVersion: SETTINGS_STATE_V29_SCHEMA_VERSION,
    sidebar: {
      ...previous.sidebar,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    }
  });
}

export function migrateSettingsStateV29(value) {
  const previous = parseSettingsStateV29(value);
  return parseSettingsStateV30({
    ...previous,
    schemaVersion: SETTINGS_STATE_V30_SCHEMA_VERSION,
    snapshots: {
      ...previous.snapshots,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS_V30.restoreBatchSize.defaultValue
    }
  });
}

// Schema 31 removes the automatic-save age limit, so a profile that had it on
// simply keeps more of its own saves: the maximum still removes the oldest
// first. The Settings surface also moves to the sidebar's color, but only for a
// document still holding the old default - a color the user chose is theirs.
export function migrateSettingsStateV30(value) {
  const previous = parseSettingsStateV30(value);
  const {
    deleteOldAutomaticEnabled,
    deleteAfterValue,
    deleteAfterUnit,
    ...snapshots
  } = previous.snapshots;
  return parseSettingsStateV31({
    ...previous,
    schemaVersion: SETTINGS_STATE_V31_SCHEMA_VERSION,
    appearance: {
      ...previous.appearance,
      settingsBackgroundColor:
        previous.appearance.settingsBackgroundColor === DEFAULT_APPEARANCE_V30.settingsBackgroundColor
          ? DEFAULT_APPEARANCE.settingsBackgroundColor
          : previous.appearance.settingsBackgroundColor
    },
    snapshots
  });
}

// Schema 32 leaves one schedule, Save every, and one way to reverse a
// workspace removal: Undo, in place of the warning that used to precede it. A
// profile on a daily or selected-days schedule keeps the interval it already
// held, so automatic saves carry on without asking.
export function migrateSettingsStateV31(value) {
  const previous = parseSettingsStateV31(value);
  const { scheduleMode, exactTime, exactDays, ...snapshots } = previous.snapshots;
  const { warnBeforeWorkspaceRemoval, ...sidebar } = previous.sidebar;
  return parseSettingsStateV32({
    ...previous,
    schemaVersion: SETTINGS_STATE_V32_SCHEMA_VERSION,
    sidebar: { ...sidebar, warnBeforeLoadingManyTabs: true },
    snapshots
  });
}

export function migrateSettingsStateV32(value) {
  const previous = parseSettingsStateV32(value);
  return parseSettingsStateV33({
    ...previous,
    schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION
  });
}

export function migrateSettingsStateV33(value) {
  const previous = parseSettingsStateV33(value);
  return parseSettingsState({
    ...previous,
    schemaVersion: SETTINGS_STATE_SCHEMA_VERSION,
    navigation: {
      ...previous.navigation,
      lastPanel: previous.navigation.lastPanel === "sync" ? "storage" : previous.navigation.lastPanel
    }
  });
}

function migrateSettingsStateV1ToV25(value) {
  return migrateSettingsStateV24(migrateSettingsStateV23(migrateSettingsStateV22(migrateSettingsStateV21(migrateSettingsStateV20(migrateSettingsStateV19(migrateSettingsStateV18(migrateSettingsStateV17(migrateSettingsStateV16(migrateSettingsStateV15(migrateSettingsStateV14(migrateSettingsStateV13(migrateSettingsStateV12(
    migrateSettingsStateV11(
      migrateSettingsStateV10(
        migrateSettingsStateV9(
          migrateSettingsStateV8(
            migrateSettingsStateV7(
              migrateSettingsStateV6(
                migrateSettingsStateV5(
                  migrateSettingsStateV4(
                    migrateSettingsStateV3(migrateSettingsStateV2(migrateSettingsStateV1ToV2(value)))
                  )
                )
              )
            )
          )
        )
      )
    )
  )))))))))))));
}

export function migrateSettingsStateV1(value) {
  return migrateSettingsStateV33(migrateSettingsStateV32(migrateSettingsStateV31(
    migrateSettingsStateV30(
    migrateSettingsStateV29(
      migrateSettingsStateV28(
        migrateSettingsStateV27(
          migrateSettingsStateV26(migrateSettingsStateV25(migrateSettingsStateV1ToV25(value)))
        )
      )
    )
  )
  )));
}

export function parseSettingsPatch(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, Object.values(SETTINGS_SECTIONS))) {
    throw invalidRequest("The update must contain a supported settings section.");
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(value, SETTINGS_SECTIONS.SIDEBAR)) {
    if (
      !isRecord(value.sidebar) ||
      !hasOnlyKeys(value.sidebar, [
        "workspaceSize",
        "tabSize",
        "dividerSize",
        "workspaceReorderingLocked",
        "showActionButtons",
        "showAddWorkspaceButton",
        "warnBeforeClosingMultipleTabs",
        "warnBeforeLoadingManyTabs",
        "hideUnloadedTabsFromFirefox",
        "showTabSearch",
        "tabSearchPosition"
      ])
    ) {
      throw invalidRequest("The sidebar update has an invalid shape.");
    }
    patch.sidebar = {};
    for (const [key, label] of [
      ["workspaceSize", "Workspace size"],
      ["tabSize", "Tab size"]
    ]) {
      if (Object.prototype.hasOwnProperty.call(value.sidebar, key)) {
        patch.sidebar[key] = parseSizePreset(value.sidebar[key], label, invalidRequest);
      }
    }
    if (Object.prototype.hasOwnProperty.call(value.sidebar, "dividerSize")) {
      patch.sidebar.dividerSize = parseSize(
        value.sidebar.dividerSize,
        "dividerSize",
        "Divider size",
        invalidRequest
      );
    }
    if (Object.prototype.hasOwnProperty.call(value.sidebar, "workspaceReorderingLocked")) {
      if (typeof value.sidebar.workspaceReorderingLocked !== "boolean") {
        throw invalidRequest("The workspace rearrangement lock must be a boolean.");
      }
      patch.sidebar.workspaceReorderingLocked = value.sidebar.workspaceReorderingLocked;
    }
    if (Object.prototype.hasOwnProperty.call(value.sidebar, "showActionButtons")) {
      if (typeof value.sidebar.showActionButtons !== "boolean") {
        throw invalidRequest("The action-button visibility must be a boolean.");
      }
      patch.sidebar.showActionButtons = value.sidebar.showActionButtons;
    }
    if (Object.prototype.hasOwnProperty.call(value.sidebar, "showAddWorkspaceButton")) {
      if (typeof value.sidebar.showAddWorkspaceButton !== "boolean") {
        throw invalidRequest("The add-workspace button visibility must be a boolean.");
      }
      patch.sidebar.showAddWorkspaceButton = value.sidebar.showAddWorkspaceButton;
    }
    for (const [key, label] of [
      ["warnBeforeClosingMultipleTabs", "The multiple-tab close warning preference"],
      ["warnBeforeLoadingManyTabs", "The many-tab load warning preference"],
      ["hideUnloadedTabsFromFirefox", "The unloaded-tab visibility preference"],
      ["showTabSearch", "The tab-search visibility preference"]
    ]) {
      if (Object.prototype.hasOwnProperty.call(value.sidebar, key)) {
        if (typeof value.sidebar[key] !== "boolean") {
          throw invalidRequest(`${label} must be a boolean.`);
        }
        patch.sidebar[key] = value.sidebar[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(value.sidebar, "tabSearchPosition")) {
      if (!Object.values(TAB_SEARCH_POSITIONS).includes(value.sidebar.tabSearchPosition)) {
        throw invalidRequest("The tab-search position is unsupported.");
      }
      patch.sidebar.tabSearchPosition = value.sidebar.tabSearchPosition;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, SETTINGS_SECTIONS.APPEARANCE)) {
    if (
      !isRecord(value.appearance) ||
      !hasOnlyKeys(value.appearance, [
        "mode",
        "contentMode",
        "solidColor",
        "gradient",
        "activeTabHighlight",
        "applyToSettings",
        "settingsBackgroundColor",
        "typography",
        "workspaceGlowMode"
      ])
    ) {
      throw invalidRequest("The appearance update has an invalid shape.");
    }
    const defaultAppearance = DEFAULT_APPEARANCE;
    const candidate = {
      mode: value.appearance.mode ?? defaultAppearance.mode,
      contentMode: value.appearance.contentMode ?? defaultAppearance.contentMode,
      solidColor: value.appearance.solidColor ?? defaultAppearance.solidColor,
      gradient: value.appearance.gradient ?? defaultAppearance.gradient,
      activeTabHighlight:
        value.appearance.activeTabHighlight ?? defaultAppearance.activeTabHighlight,
      applyToSettings:
        value.appearance.applyToSettings ?? defaultAppearance.applyToSettings,
      settingsBackgroundColor:
        value.appearance.settingsBackgroundColor ?? defaultAppearance.settingsBackgroundColor,
      typography: value.appearance.typography ?? defaultAppearance.typography,
      workspaceGlowMode:
        value.appearance.workspaceGlowMode ?? defaultAppearance.workspaceGlowMode
    };
    const parsed = parseAppearance(candidate, invalidRequest, {
      includeSettingsTheme: true,
      includeTypography: true,
      includeTypographySource: true,
      includeWorkspaceGlow: true,
      allowedFontSizes: SETTINGS_FONT_SIZE_VALUES
    });
    patch.appearance = {};
    for (const key of Object.keys(value.appearance)) {
      patch.appearance[key] = parsed[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, SETTINGS_SECTIONS.SNAPSHOTS)) {
    if (
      !isRecord(value.snapshots) ||
      !hasOnlyKeys(value.snapshots, [
        "automaticEnabled",
        "automaticSettingsBackupsEnabled",
        "intervalValue",
        "intervalUnit",
        "retentionCount",
        "automaticDownloads",
        "warnBeforeSnapshotDeletion",
        "restoreBatchSize"
      ])
    ) {
      throw invalidRequest("The snapshot update has an invalid shape.");
    }
    const candidate = {
      ...DEFAULT_SNAPSHOT_SETTINGS,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue,
      ...value.snapshots
    };
    const parsed = parseSnapshotSettings(candidate, invalidRequest, {
      includeDeletionWarning: true,
      includeSchedule: false,
      includeAutomaticSettingsBackups: true,
      separateAgeLimit: true,
      includeAgeCleanup: false,
      includeRestoreBatchSize: true
    });
    patch.snapshots = {};
    for (const key of Object.keys(value.snapshots)) {
      patch.snapshots[key] = parsed[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, SETTINGS_SECTIONS.NAVIGATION)) {
    if (
      !isRecord(value.navigation) ||
      !hasOnlyKeys(value.navigation, ["rememberLastPanel", "lastPanel"])
    ) {
      throw invalidRequest("The Settings navigation update has an invalid shape.");
    }
    const candidate = { ...DEFAULT_SETTINGS_NAVIGATION, ...value.navigation };
    const parsed = parseNavigation(candidate, invalidRequest, SETTINGS_PANEL_IDS);
    patch.navigation = {};
    for (const key of Object.keys(value.navigation)) {
      patch.navigation[key] = parsed[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, SETTINGS_SECTIONS.PRIVACY)) {
    if (
      !isRecord(value.privacy) ||
      !hasOnlyKeys(value.privacy, [
        "keepPrivateTabsBetweenSessions",
        "automaticSnapshotsEnabled"
      ])
    ) {
      throw invalidRequest("The private-browsing update has an invalid shape.");
    }
    const parsed = parsePrivacy(
      { ...DEFAULT_PRIVACY_SETTINGS, ...value.privacy },
      invalidRequest
    );
    patch.privacy = {};
    for (const key of Object.keys(value.privacy)) {
      patch.privacy[key] = parsed[key];
    }
  }
  return patch;
}

export function applySettingsPatch(settings, rawPatch) {
  const current = parseSettingsState(settings);
  const patch = parseSettingsPatch(rawPatch);
  return parseSettingsState({
    ...current,
    sidebar: { ...current.sidebar, ...patch.sidebar },
    appearance: { ...current.appearance, ...patch.appearance },
    snapshots: { ...current.snapshots, ...patch.snapshots },
    navigation: { ...current.navigation, ...patch.navigation },
    privacy: { ...current.privacy, ...patch.privacy }
  });
}

export function resetSettingsSection(settings, section) {
  const current = parseSettingsState(settings);
  if (!Object.values(SETTINGS_SECTIONS).includes(section)) {
    throw invalidRequest("The reset section is unsupported.");
  }
  const defaults = createDefaultSettingsState();
  return parseSettingsState({ ...current, [section]: defaults[section] });
}

const DEFAULT_PRESET_SIDEBAR_V27 = Object.freeze({
  workspaceSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
  tabSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
  dividerSize: SIDEBAR_SIZE_LIMITS.dividerSize.defaultValue,
  workspaceReorderingLocked: false,
  showActionButtons: true,
  warnBeforeWorkspaceRemoval: true,
  showAddWorkspaceButton: true
});

export function createDefaultSettingsState() {
  const { warnBeforeWorkspaceRemoval, ...sidebar } = DEFAULT_PRESET_SIDEBAR_V27;
  return parseSettingsState({
    schemaVersion: SETTINGS_STATE_SCHEMA_VERSION,
    sidebar: {
      ...sidebar,
      warnBeforeClosingMultipleTabs: true,
      warnBeforeLoadingManyTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    },
    appearance: DEFAULT_APPEARANCE,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV33() {
  const { warnBeforeWorkspaceRemoval, ...sidebar } = DEFAULT_PRESET_SIDEBAR_V27;
  return parseSettingsStateV33({
    schemaVersion: SETTINGS_STATE_V33_SCHEMA_VERSION,
    sidebar: {
      ...sidebar,
      warnBeforeClosingMultipleTabs: true,
      warnBeforeLoadingManyTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    },
    appearance: DEFAULT_APPEARANCE,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV32() {
  const { warnBeforeWorkspaceRemoval, ...sidebar } = DEFAULT_PRESET_SIDEBAR_V27;
  return parseSettingsStateV32({
    schemaVersion: SETTINGS_STATE_V32_SCHEMA_VERSION,
    sidebar: {
      ...sidebar,
      warnBeforeClosingMultipleTabs: true,
      warnBeforeLoadingManyTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    },
    appearance: DEFAULT_APPEARANCE_V32,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV31() {
  return parseSettingsStateV31({
    schemaVersion: SETTINGS_STATE_V31_SCHEMA_VERSION,
    sidebar: {
      ...DEFAULT_PRESET_SIDEBAR_V27,
      warnBeforeClosingMultipleTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    },
    appearance: DEFAULT_APPEARANCE_V32,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS_V31,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS.restoreBatchSize.defaultValue
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV30() {
  return parseSettingsStateV30({
    schemaVersion: SETTINGS_STATE_V30_SCHEMA_VERSION,
    sidebar: {
      ...DEFAULT_PRESET_SIDEBAR_V27,
      warnBeforeClosingMultipleTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    },
    appearance: DEFAULT_APPEARANCE_V30,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS_V30,
      automaticSettingsBackupsEnabled: false,
      restoreBatchSize: SNAPSHOT_SETTINGS_LIMITS_V30.restoreBatchSize.defaultValue
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV29() {
  return parseSettingsStateV29({
    schemaVersion: SETTINGS_STATE_V29_SCHEMA_VERSION,
    sidebar: {
      ...DEFAULT_PRESET_SIDEBAR_V27,
      warnBeforeClosingMultipleTabs: true,
      hideUnloadedTabsFromFirefox: false,
      showTabSearch: true,
      tabSearchPosition: TAB_SEARCH_POSITIONS.TOP
    },
    appearance: DEFAULT_APPEARANCE_V30,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS_V30,
      automaticSettingsBackupsEnabled: false
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV28() {
  return parseSettingsStateV28({
    schemaVersion: SETTINGS_STATE_V28_SCHEMA_VERSION,
    sidebar: {
      ...DEFAULT_PRESET_SIDEBAR_V27,
      warnBeforeClosingMultipleTabs: true
    },
    appearance: DEFAULT_APPEARANCE_V30,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS_V30,
      automaticSettingsBackupsEnabled: false
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

export function createDefaultSettingsStateV27() {
  return parseSettingsStateV27({
    schemaVersion: SETTINGS_STATE_V27_SCHEMA_VERSION,
    sidebar: DEFAULT_PRESET_SIDEBAR_V27,
    appearance: DEFAULT_APPEARANCE_V30,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS_V30,
      automaticSettingsBackupsEnabled: false
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

// Builders of schema-26-or-older documents start from these values so older
// Settings Backup and older portable records never gain newer sidebar keys.
export function createDefaultSettingsStateV26() {
  const { showAddWorkspaceButton: _showAddWorkspaceButton, ...sidebar } =
    DEFAULT_PRESET_SIDEBAR_V27;
  return parseSettingsStateV26({
    schemaVersion: SETTINGS_STATE_V26_SCHEMA_VERSION,
    sidebar,
    appearance: DEFAULT_APPEARANCE_V32,
    snapshots: {
      ...DEFAULT_SNAPSHOT_SETTINGS_V26,
      automaticSettingsBackupsEnabled: false
    },
    navigation: DEFAULT_SETTINGS_NAVIGATION,
    privacy: DEFAULT_PRIVACY_SETTINGS
  });
}

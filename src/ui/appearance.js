import {
  ACTIVE_TAB_HIGHLIGHT_MODES,
  APPEARANCE_MODES,
  parseSettingsState
} from "../contracts/settings-state.js";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MAX_THEME_LAYERS = 8;
const MAX_THEME_VALUE_LENGTH = 4096;
export const DEFAULT_SIDEBAR_BACKGROUND_COLOR = "#2b2a33";
const DEFAULT_INTERFACE_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Settings' own dark surface uses the approved design's fixed palette:
// near-black cards on the page colour and a bright blue accent. A light
// Settings background, or Settings following the sidebar theme, still derives
// its palette so text stays readable on whatever the user chose.
export const SETTINGS_DARK_PALETTE = Object.freeze({
  foreground: "#ffffff",
  muted: "#b8b8b8",
  surface: "#0f0f10",
  raisedSurface: "#1c1c1c",
  field: "#121212",
  border: "#ffffff",
  accent: "#0a84ff"
});

function interfaceTypography(appearance) {
  return Object.freeze({
    family: DEFAULT_INTERFACE_FONT_STACK,
    size: `${appearance.typography.fontSize}px`
  });
}

export function readableForeground(background) {
  if (!HEX_COLOR_PATTERN.test(background)) {
    return "#ffffff";
  }
  const hex = background.slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = channels
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.38 ? "#111111" : "#ffffff";
}

function themeColor(theme, names, fallback) {
  const colors = theme && typeof theme === "object" ? theme.colors : undefined;
  if (!colors || typeof colors !== "object") {
    return fallback;
  }
  for (const name of names) {
    if (typeof colors[name] === "string" && colors[name].trim()) {
      return colors[name].trim().slice(0, 256);
    }
  }
  return fallback;
}

function safeThemeImage(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_THEME_VALUE_LENGTH || trimmed.includes(";")) {
    return null;
  }
  if (/^(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(/i.test(trimmed)) {
    return /url\s*\(/i.test(trimmed) ? null : trimmed;
  }
  if (!/^(?:moz-extension|resource|chrome|blob):|^data:image\//i.test(trimmed)) {
    return null;
  }
  const escaped = trimmed.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `url("${escaped}")`;
}

function propertyItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
}

function safeLayerProperty(value, fallback, pattern) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length <= 80 && pattern.test(trimmed) ? trimmed : fallback;
}

export function normalizeFirefoxThemeBackground(theme) {
  const images = theme && typeof theme === "object" && theme.images && typeof theme.images === "object"
    ? theme.images
    : {};
  const properties = theme && typeof theme === "object" && theme.properties && typeof theme.properties === "object"
    ? theme.properties
    : {};
  const additional = Array.isArray(images.additional_backgrounds)
    ? images.additional_backgrounds
    : [];
  const rawLayers = [...additional, images.theme_frame].slice(0, MAX_THEME_LAYERS);
  const layers = rawLayers.map(safeThemeImage).filter(Boolean);
  if (layers.length === 0) {
    return Object.freeze({
      image: "none",
      position: "top right",
      repeat: "no-repeat",
      size: "cover"
    });
  }

  const alignments = propertyItems(properties.additional_backgrounds_alignment);
  const tiling = propertyItems(properties.additional_backgrounds_tiling);
  const sizes = propertyItems(properties.additional_backgrounds_size);
  const extrasCount = Math.max(0, layers.length - (safeThemeImage(images.theme_frame) ? 1 : 0));
  const position = layers.map((_, index) => index < extrasCount
    ? safeLayerProperty(alignments[index], "top right", /^(?:left|center|right)(?:\s+(?:top|center|bottom))?$/)
    : "top right");
  const repeat = layers.map((_, index) => index < extrasCount
    ? safeLayerProperty(tiling[index], "no-repeat", /^(?:no-repeat|repeat|repeat-x|repeat-y)$/)
    : "no-repeat");
  const size = layers.map((_, index) => index < extrasCount
    ? safeLayerProperty(sizes[index], "auto", /^(?:auto|cover|contain|\d{1,4}(?:px|%)\s+(?:auto|\d{1,4}(?:px|%)))$/)
    : "cover");
  return Object.freeze({
    image: layers.join(", "),
    position: position.join(", "),
    repeat: repeat.join(", "),
    size: size.join(", ")
  });
}

export function createAppearanceBackground(appearance) {
  if (appearance.mode === APPEARANCE_MODES.DEFAULT) {
    return DEFAULT_SIDEBAR_BACKGROUND_COLOR;
  }
  if (appearance.mode === APPEARANCE_MODES.SOLID) {
    return appearance.solidColor;
  }
  if (appearance.mode === APPEARANCE_MODES.GRADIENT) {
    const stops = appearance.gradient.stops
      .map(({ color, position }) => `${color} ${position}%`)
      .join(", ");
    return `linear-gradient(${appearance.gradient.angle}deg, ${stops})`;
  }
  return "Canvas";
}

function derivePalette(settings, theme, { prefersDark = false, settingsTarget = false } = {}) {
  const fallbackBackground = prefersDark ? "#1c1b22" : "#ffffff";
  const fallbackForeground = prefersDark ? "#fbfbfe" : "#15141a";
  const settingsFallback = settings.appearance.settingsBackgroundColor;
  const followsSidebar = !settingsTarget || settings.appearance.applyToSettings;
  const mode = followsSidebar ? settings.appearance.mode : APPEARANCE_MODES.SOLID;
  let backgroundColor;
  let backgroundLayers = Object.freeze({
    image: "none",
    position: "top right",
    repeat: "no-repeat",
    size: "cover"
  });
  let representativeColor;
  let foreground;

  if (!followsSidebar) {
    backgroundColor = settingsFallback;
    representativeColor = settingsFallback;
    foreground = readableForeground(representativeColor);
  } else if (mode === APPEARANCE_MODES.FIREFOX) {
    backgroundColor = themeColor(theme, ["sidebar", "toolbar", "frame"], fallbackBackground);
    representativeColor = HEX_COLOR_PATTERN.test(backgroundColor) ? backgroundColor : fallbackBackground;
    foreground = themeColor(
      theme,
      ["sidebar_text", "toolbar_text", "tab_text", "textcolor"],
      fallbackForeground
    );
    backgroundLayers = normalizeFirefoxThemeBackground(theme);
  } else if (mode === APPEARANCE_MODES.GRADIENT) {
    backgroundColor = settings.appearance.gradient.stops[0].color;
    backgroundLayers = Object.freeze({
      image: createAppearanceBackground(settings.appearance),
      position: "center",
      repeat: "no-repeat",
      size: "cover"
    });
    representativeColor = settings.appearance.gradient.stops[
      Math.floor(settings.appearance.gradient.stops.length / 2)
    ].color;
    foreground = readableForeground(representativeColor);
  } else {
    backgroundColor = settings.appearance.solidColor;
    representativeColor = backgroundColor;
    foreground = readableForeground(representativeColor);
  }

  const paletteTheme = followsSidebar ? theme : {};
  const accent = themeColor(
    paletteTheme,
    ["sidebar_highlight", "icons_attention", "icons"],
    "AccentColor"
  );
  const activeTabHighlight =
    settings.appearance.activeTabHighlight.mode === ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM
      ? settings.appearance.activeTabHighlight.color
      : themeColor(
          paletteTheme,
          ["tab_selected", "toolbar", "frame", "sidebar_highlight", "tab_line"],
          accent
        );
  const border = themeColor(
    paletteTheme,
    ["sidebar_border", "toolbar_bottom_separator"],
    foreground
  );
  const surfaceBase = backgroundColor;
  return Object.freeze({
    mode,
    backgroundColor,
    backgroundImage: backgroundLayers.image,
    backgroundPosition: backgroundLayers.position,
    backgroundRepeat: backgroundLayers.repeat,
    backgroundSize: backgroundLayers.size,
    representativeColor,
    foreground,
    muted: `color-mix(in srgb, ${foreground} 68%, ${surfaceBase})`,
    surface: `color-mix(in srgb, ${foreground} 5%, ${surfaceBase})`,
    raisedSurface: `color-mix(in srgb, ${foreground} 9%, ${surfaceBase})`,
    field: `color-mix(in srgb, ${foreground} 7%, ${surfaceBase})`,
    border,
    accent,
    activeTabHighlight,
    colorScheme: readableForeground(representativeColor) === "#ffffff" ? "dark" : "light"
  });
}

export function deriveSidebarAppearance(rawSettings, theme = {}, options = {}) {
  const settings = parseSettingsState(rawSettings);
  const palette = derivePalette(settings, theme, options);
  const typography = interfaceTypography(settings.appearance);
  return Object.freeze({
    "--sidebar-background": palette.backgroundColor,
    "--sidebar-background-image": palette.backgroundImage,
    "--sidebar-background-position": palette.backgroundPosition,
    "--sidebar-background-repeat": palette.backgroundRepeat,
    "--sidebar-background-size": palette.backgroundSize,
    "--sidebar-surface-color": palette.representativeColor,
    "--sidebar-foreground": palette.foreground,
    "--sidebar-accent": palette.accent,
    "--sidebar-active-tab-highlight": palette.activeTabHighlight,
    "--sidebar-border-color": palette.border,
    "--sidebar-badge-background": palette.foreground,
    "--sidebar-badge-foreground": palette.representativeColor,
    "--sidebar-color-scheme": palette.colorScheme,
    "--sidebar-font-family": typography.family
  });
}

// Warning text that stays readable on the Settings surface: a light red on
// dark palettes and a dark red on light ones, each above 4.5:1 there.
export function settingsDangerText(colorScheme) {
  return colorScheme === "dark" ? "#ff8a8a" : "#b91c1c";
}

export function deriveSettingsAppearance(rawSettings, theme = {}, options = {}) {
  const settings = parseSettingsState(rawSettings);
  const derived = derivePalette(settings, theme, { ...options, settingsTarget: true });
  const ownDarkSurface = !settings.appearance.applyToSettings && derived.colorScheme === "dark";
  const palette = ownDarkSurface ? { ...derived, ...SETTINGS_DARK_PALETTE } : derived;
  const typography = interfaceTypography(settings.appearance);
  return Object.freeze({
    "--settings-background": palette.backgroundColor,
    "--settings-background-image": palette.backgroundImage,
    "--settings-background-position": palette.backgroundPosition,
    "--settings-background-repeat": palette.backgroundRepeat,
    "--settings-background-size": palette.backgroundSize,
    "--settings-text": palette.foreground,
    "--settings-muted": palette.muted,
    "--settings-surface": palette.surface,
    "--settings-surface-raised": palette.raisedSurface,
    "--settings-field": palette.field,
    "--settings-field-text": palette.foreground,
    "--settings-button": palette.raisedSurface,
    "--settings-button-text": palette.foreground,
    "--settings-border": palette.border,
    "--settings-accent": palette.accent,
    "--settings-danger-text": settingsDangerText(palette.colorScheme),
    "--settings-color-scheme": palette.colorScheme,
    "--settings-font-family": typography.family,
    "--settings-font-size": typography.size
  });
}

function applyVariables(root, variables) {
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  return variables;
}

export function applySidebarAppearance(root, settings, theme, options) {
  const parsed = parseSettingsState(settings);
  delete root.dataset.containerGlow;
  root.dataset.workspaceGlowMode = parsed.appearance.workspaceGlowMode;
  return applyVariables(root, deriveSidebarAppearance(parsed, theme, options));
}

export function applySettingsAppearance(root, settings, theme, options) {
  return applyVariables(root, deriveSettingsAppearance(settings, theme, options));
}

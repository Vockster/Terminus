import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  applySidebarAppearance,
  createAppearanceBackground,
  deriveSettingsAppearance,
  deriveSidebarAppearance,
  normalizeFirefoxThemeBackground
} from "../../src/ui/sidebar-appearance.js";

test("Follow Firefox uses per-window theme colors with deterministic fallbacks", () => {
  const settings = createDefaultSettingsState();
  settings.appearance.mode = "firefox";
  const themed = deriveSidebarAppearance(settings, {
    colors: { sidebar: "#123456", sidebar_text: "#fedcba", sidebar_highlight: "#abcdef" }
  });
  assert.equal(themed["--sidebar-background"], "#123456");
  assert.equal(themed["--sidebar-foreground"], "#fedcba");
  assert.equal(themed["--sidebar-accent"], "#abcdef");
  assert.equal(themed["--sidebar-active-tab-highlight"], "#ffffff");
  assert.equal(deriveSidebarAppearance(settings, {}, { prefersDark: true })["--sidebar-background"], "#1c1b22");
});

test("solid and gradient backgrounds derive from stored settings", () => {
  const solid = createDefaultSettingsState();
  solid.appearance.mode = "solid";
  solid.appearance.solidColor = "#ffffff";
  assert.equal(createAppearanceBackground(solid.appearance), "#ffffff");
  assert.equal(deriveSidebarAppearance(solid)["--sidebar-foreground"], "#111111");

  const gradient = createDefaultSettingsState();
  gradient.appearance.mode = "gradient";
  assert.equal(
    createAppearanceBackground(gradient.appearance),
    "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)"
  );
});

test("a custom current-tab highlight is independent from the Firefox accent", () => {
  const settings = createDefaultSettingsState();
  settings.appearance.activeTabHighlight = { mode: "custom", color: "#123456" };
  const appearance = deriveSidebarAppearance(settings, {
    colors: { sidebar_highlight: "#abcdef" }
  });
  assert.equal(appearance["--sidebar-accent"], "#abcdef");
  assert.equal(appearance["--sidebar-active-tab-highlight"], "#123456");
});

test("a Firefox current-tab highlight follows the theme selected-tab color", () => {
  const settings = createDefaultSettingsState();
  settings.appearance.activeTabHighlight.mode = "firefox";
  const appearance = deriveSidebarAppearance(settings, {
    colors: {
      tab_selected: "#765432",
      sidebar_highlight: "#abcdef"
    }
  });
  assert.equal(appearance["--sidebar-active-tab-highlight"], "#765432");
  assert.equal(appearance["--sidebar-accent"], "#abcdef");
});

test("Follow Firefox carries bounded theme artwork and ignores network images", () => {
  assert.deepEqual(normalizeFirefoxThemeBackground({
    images: {
      theme_frame: "moz-extension://theme/header.png",
      additional_backgrounds: ["linear-gradient(90deg, #000000, #ffffff)"]
    },
    properties: {
      additional_backgrounds_alignment: ["left top"],
      additional_backgrounds_tiling: ["repeat-x"]
    }
  }), {
    image: 'linear-gradient(90deg, #000000, #ffffff), url("moz-extension://theme/header.png")',
    position: "left top, top right",
    repeat: "repeat-x, no-repeat",
    size: "auto, cover"
  });
  assert.equal(
    normalizeFirefoxThemeBackground({ images: { theme_frame: "https://example.invalid/a.png" } }).image,
    "none"
  );
});

test("Settings defaults to Firefox dark blue and can follow the complete sidebar theme", () => {
  const settings = createDefaultSettingsState();
  const independent = deriveSettingsAppearance(settings, {
    colors: { sidebar: "#123456" },
    images: { theme_frame: "moz-extension://theme/header.png" }
  });
  assert.equal(independent["--settings-background"], "#2b2a33");
  assert.equal(independent["--settings-background-image"], "none");
  // Settings' own dark surface uses the approved design's fixed palette:
  // near-black cards and a bright blue accent, not the system accent.
  assert.equal(independent["--settings-accent"], "#0a84ff");
  assert.equal(independent["--settings-surface"], "#0f0f10");
  assert.equal(independent["--settings-field"], "#121212");
  assert.equal(independent["--settings-button"], "#1c1c1c");
  assert.equal(independent["--settings-muted"], "#b8b8b8");
  assert.equal(independent["--settings-text"], "#ffffff");

  // A light Settings background keeps a derived palette, so its text stays
  // readable instead of inheriting white-on-black values.
  const light = structuredClone(settings);
  light.appearance.settingsBackgroundColor = "#f4f4f5";
  const lightPalette = deriveSettingsAppearance(light, {});
  assert.equal(lightPalette["--settings-color-scheme"], "light");
  assert.notEqual(lightPalette["--settings-surface"], "#0f0f10");
  assert.notEqual(lightPalette["--settings-text"], "#ffffff");

  settings.appearance.applyToSettings = true;
  settings.appearance.mode = "firefox";
  const themed = deriveSettingsAppearance(settings, {
    colors: { sidebar: "#123456", sidebar_text: "#fedcba" },
    images: { theme_frame: "moz-extension://theme/header.png" }
  });
  assert.equal(themed["--settings-background"], "#123456");
  assert.match(themed["--settings-background-image"], /moz-extension:\/\/theme\/header\.png/);
  assert.equal(themed["--settings-text"], "#fedcba");

});

function relativeLuminance(hex) {
  const [red, green, blue] = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("Settings warning text stays readable on dark, light, and themed surfaces", () => {
  const cases = [
    ["default Settings surface", createDefaultSettingsState(), {}],
    ...[
      ["Follow Firefox light", { colors: { sidebar: "#ffffff", sidebar_text: "#15141a" } }],
      ["Follow Firefox dark", { colors: { sidebar: "#1c1b22", sidebar_text: "#fbfbfe" } }]
    ].map(([label, theme]) => {
      const settings = createDefaultSettingsState();
      settings.appearance.applyToSettings = true;
      settings.appearance.mode = "firefox";
      return [label, settings, theme];
    }),
    ...["#ffffff", "#000000"].map((color) => {
      const settings = createDefaultSettingsState();
      settings.appearance.applyToSettings = true;
      settings.appearance.mode = "solid";
      settings.appearance.solidColor = color;
      return [`solid ${color}`, settings, {}];
    })
  ];

  for (const [label, settings, theme] of cases) {
    const appearance = deriveSettingsAppearance(settings, theme);
    const background = appearance["--settings-background"];
    const danger = appearance["--settings-danger-text"];
    assert.match(background, /^#[0-9a-f]{6}$/i, label);
    assert.equal(
      danger,
      appearance["--settings-color-scheme"] === "dark" ? "#ff8a8a" : "#b91c1c",
      label
    );
    assert.ok(
      contrastRatio(danger, background) >= 4.5,
      `${label}: ${danger} on ${background} is ${contrastRatio(danger, background).toFixed(2)}:1`
    );
  }
});

test("a stored generic font family still renders the system font while retaining Settings size", () => {
  const settings = createDefaultSettingsState();
  settings.appearance.typography = {
    source: "generic",
    fontFamily: "serif",
    fontSize: 16
  };
  const sidebar = deriveSidebarAppearance(settings);
  const options = deriveSettingsAppearance(settings);
  assert.match(sidebar["--sidebar-font-family"], /^system-ui/);
  assert.equal(sidebar["--sidebar-font-size"], undefined);
  assert.match(options["--settings-font-family"], /^system-ui/);
  assert.equal(options["--settings-font-size"], "16px");
});

test("appearance application writes the complete CSS variable contract", () => {
  const values = new Map();
  const root = { dataset: {}, style: { setProperty(name, value) { values.set(name, value); } } };
  const variables = applySidebarAppearance(root, createDefaultSettingsState(), {});
  assert.deepEqual(Object.fromEntries(values), variables);
  assert.equal(root.dataset.workspaceGlowMode, "container");
  assert.equal(root.dataset.containerGlow, undefined);
  assert.deepEqual([...values.keys()].sort(), [
    "--sidebar-accent",
    "--sidebar-active-tab-highlight",
    "--sidebar-background",
    "--sidebar-background-image",
    "--sidebar-background-position",
    "--sidebar-background-repeat",
    "--sidebar-background-size",
    "--sidebar-badge-background",
    "--sidebar-badge-foreground",
    "--sidebar-border-color",
    "--sidebar-color-scheme",
    "--sidebar-font-family",
    "--sidebar-foreground",
    "--sidebar-surface-color"
  ]);
});

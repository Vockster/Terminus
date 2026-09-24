import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_STATE_V25_SCHEMA_VERSION,
  SETTINGS_STATE_V26_SCHEMA_VERSION,
  SettingsStateError,
  createDefaultSettingsState,
  createDefaultSettingsStateV26,
  migrateSettingsStateV25,
  parseSettingsStateV25,
  parseSettingsStateV26,
  useSystemInterfaceTypography
} from "../../src/contracts/settings-state.js";

function withTypography(settings, typography) {
  return { ...settings, appearance: { ...settings.appearance, typography } };
}

function v25Settings(typography) {
  return withTypography(
    { ...createDefaultSettingsStateV26(), schemaVersion: SETTINGS_STATE_V25_SCHEMA_VERSION },
    typography
  );
}

test("schema 26 typography has no uploaded-font field and only system or generic sources", () => {
  assert.equal(SETTINGS_STATE_V26_SCHEMA_VERSION, 26);
  const defaults = createDefaultSettingsStateV26();
  assert.deepEqual(defaults.appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 16
  });
  for (const typography of [
    { source: "system", fontFamily: "system-ui", fontAssetId: null, fontSize: 16 },
    { source: "legacy", fontFamily: "Arial", fontSize: 16 },
    { source: "uploaded", fontFamily: "Sidebars Uploaded ABC", fontSize: 16 },
    { source: "generic", fontFamily: "Arial", fontSize: 16 }
  ]) {
    assert.throws(() => parseSettingsStateV26(withTypography(defaults, typography)), SettingsStateError);
  }
  assert.deepEqual(
    parseSettingsStateV26(withTypography(defaults, { source: "generic", fontFamily: "serif", fontSize: 20 }))
      .appearance.typography,
    { source: "generic", fontFamily: "serif", fontSize: 20 }
  );
});

test("v25 typed and uploaded font choices migrate to the system font and nothing else changes", () => {
  const assetId = `font-${"ab".repeat(32)}`;
  const cases = [
    [
      { source: "uploaded", fontFamily: `Sidebars Uploaded ${"AB".repeat(6)}`, fontAssetId: assetId, fontSize: 20 },
      { source: "system", fontFamily: "system-ui", fontSize: 20 }
    ],
    [
      { source: "legacy", fontFamily: "Atkinson Hyperlegible", fontAssetId: null, fontSize: 28 },
      { source: "system", fontFamily: "system-ui", fontSize: 28 }
    ],
    [
      { source: "generic", fontFamily: "serif", fontAssetId: null, fontSize: 16 },
      { source: "generic", fontFamily: "serif", fontSize: 16 }
    ],
    [
      { source: "system", fontFamily: "system-ui", fontAssetId: null, fontSize: 16 },
      { source: "system", fontFamily: "system-ui", fontSize: 16 }
    ]
  ];
  for (const [before, after] of cases) {
    const previous = parseSettingsStateV25(v25Settings(before));
    const migrated = migrateSettingsStateV25(previous);
    assert.equal(migrated.schemaVersion, SETTINGS_STATE_V26_SCHEMA_VERSION);
    assert.deepEqual(migrated.appearance.typography, after);
    assert.deepEqual(
      withTypography(migrated, null),
      withTypography({ ...previous, schemaVersion: SETTINGS_STATE_V26_SCHEMA_VERSION }, null)
    );
  }
});

test("system typography normalization keeps the Settings font size", () => {
  const settings = withTypography(createDefaultSettingsState(), {
    source: "generic",
    fontFamily: "monospace",
    fontSize: 28
  });
  assert.deepEqual(useSystemInterfaceTypography(settings).appearance.typography, {
    source: "system",
    fontFamily: "system-ui",
    fontSize: 28
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  DESTRUCTIVE_WARNINGS,
  silencedWarnings,
  warningsStatusText
} from "../../src/settings/warnings-panel.js";

test("every destructive warning is listed once and starts on", () => {
  const settings = createDefaultSettingsState();
  for (const { section, key } of DESTRUCTIVE_WARNINGS) {
    assert.equal(settings[section][key], true, key);
  }
  assert.equal(
    new Set(DESTRUCTIVE_WARNINGS.map(({ key }) => key)).size,
    DESTRUCTIVE_WARNINGS.length
  );
  assert.deepEqual(silencedWarnings(settings), []);
  assert.equal(warningsStatusText([]), "Every warning is on.");
});

test("silenced warnings are counted and named in the order they are listed", () => {
  const settings = createDefaultSettingsState();
  settings.snapshots.warnBeforeSnapshotDeletion = false;
  const one = silencedWarnings(settings);
  assert.deepEqual(one.map(({ key }) => key), ["warnBeforeSnapshotDeletion"]);
  assert.equal(warningsStatusText(one), "One warning is off: deleting snapshots and tabs.");

  settings.sidebar.warnBeforeClosingMultipleTabs = false;
  settings.sidebar.warnBeforeLoadingManyTabs = false;
  const all = silencedWarnings(settings);
  assert.equal(all.length, DESTRUCTIVE_WARNINGS.length);
  assert.equal(
    warningsStatusText(all),
    "3 warnings are off: closing several tabs, loading a whole workspace and deleting snapshots and tabs."
  );
});

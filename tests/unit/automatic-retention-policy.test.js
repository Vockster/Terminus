import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultSettingsState,
  createDefaultSettingsStateV26
} from "../../src/contracts/settings-state.js";
import {
  automaticRetentionRule,
  ordinaryCleanupApplies,
  privateCleanupApplies,
  retentionRuleChanged,
  selectAutomaticRemovals
} from "../../src/core/automatic-retention-policy.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-10T00:00:00.000Z");

function entry(id, daysOld) {
  return { id, createdAt: new Date(NOW.getTime() - daysOld * DAY).toISOString() };
}

function ids(entries) {
  return entries.map(({ id }) => id);
}

test("the rule is the maximum, and a save's age never decides", () => {
  const settings = createDefaultSettingsState();
  assert.deepEqual(automaticRetentionRule(settings), { count: 100 });
  settings.snapshots.retentionCount = 5;
  assert.deepEqual(automaticRetentionRule(settings), { count: 5 });
});

test("count only keeps the newest saves of any age", () => {
  const entries = [entry("c", 1), entry("a", 900), entry("b", 400), entry("d", 0)];
  assert.deepEqual(ids(selectAutomaticRemovals(entries, { count: 2 }, NOW)), ["b", "a"]);
  assert.deepEqual(selectAutomaticRemovals(entries, { count: 4 }, NOW), []);
});

// Schema 31 removed the age limit: however old a save is, only the maximum
// can select it, so a library under its maximum loses nothing.
test("age alone never removes a save", () => {
  const entries = [entry("fresh", 0.5), entry("edge", 30), entry("ancient", 4000)];
  assert.deepEqual(selectAutomaticRemovals(entries, { count: 9999 }, NOW), []);
  assert.deepEqual(ids(selectAutomaticRemovals(entries, { count: 2 }, NOW)), ["ancient"]);
});

test("a full library at its maximum loses exactly its oldest save per new save", () => {
  const library = Array.from({ length: 100 }, (_, index) => entry(`s${index}`, index + 1));
  const withNew = [entry("new", 0), ...library];
  assert.deepEqual(
    ids(selectAutomaticRemovals(withNew, { count: 100 }, NOW)),
    ["s99"]
  );
  assert.deepEqual(selectAutomaticRemovals(withNew, { count: 9999 }, NOW), []);
});

test("ordinary and private cleanup follow their own automatic libraries", () => {
  const settings = createDefaultSettingsState();
  assert.equal(ordinaryCleanupApplies(settings), false);
  assert.equal(privateCleanupApplies(settings), false);
  settings.snapshots.automaticSettingsBackupsEnabled = true;
  assert.equal(ordinaryCleanupApplies(settings), true);
  settings.privacy.automaticSnapshotsEnabled = true;
  assert.equal(privateCleanupApplies(settings), true);
});

test("rule changes compare the effective count", () => {
  const before = createDefaultSettingsState();
  const same = structuredClone(before);
  same.sidebar.dividerSize = 28;
  assert.equal(retentionRuleChanged(before, same), false, "an unrelated change is not a rule change");

  const lower = structuredClone(before);
  lower.snapshots.retentionCount = 10;
  assert.equal(retentionRuleChanged(before, lower), true);

  const higher = structuredClone(before);
  higher.snapshots.retentionCount = 9999;
  assert.equal(retentionRuleChanged(before, higher), true, "raising it still reschedules a pass");

  assert.equal(retentionRuleChanged(undefined, before), true);
  assert.equal(retentionRuleChanged(createDefaultSettingsStateV26(), before), true);
  assert.equal(retentionRuleChanged(before, undefined), false);
  assert.equal(retentionRuleChanged(before, { schemaVersion: 27 }), false);
});

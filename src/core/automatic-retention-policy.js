import { parseSettingsState } from "../contracts/settings-state.js";

// The one rule for removing automatic saves. Each library (Sidebar Snapshots,
// Settings Backups, Private Snapshots) keeps at most `count` automatic saves and
// drops the oldest beyond it. Manual saves, safety snapshots, and exported files
// never reach this policy.
export function automaticRetentionRule(settings) {
  return { count: settings.snapshots.retentionCount };
}

// `entries` are one library's automatic saves as `{ id, createdAt }`.
export function selectAutomaticRemovals(entries, rule, now) {
  void now;
  return [...entries]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .filter((entry, index) => index >= rule.count);
}

export function ordinaryCleanupApplies(settings) {
  return settings.snapshots.automaticEnabled ||
    settings.snapshots.automaticSettingsBackupsEnabled;
}

export function privateCleanupApplies(settings) {
  return settings.privacy.automaticSnapshotsEnabled;
}

// Whether moving from one rule to another can remove a save that the previous
// rule kept. With the age limit gone that is exactly a smaller maximum;
// raising it removes nothing, so it never needs confirming.
//
// This exists because a normal window cannot count private automatic saves and
// so cannot preview them. It can still tell that the change would reach them,
// which is enough to ask before writing.
export function retentionRuleTightens(previousRule, nextRule) {
  return nextRule.count < previousRule.count;
}

// Compares the rules two stored settings documents describe. A missing or
// unreadable previous document (first write, or a migration from an older
// schema) counts as a change; an unreadable next document never does, because
// nothing valid can be applied from it.
export function retentionRuleChanged(previousValue, nextValue) {
  let next;
  try {
    next = automaticRetentionRule(parseSettingsState(nextValue));
  } catch {
    return false;
  }
  let previous;
  try {
    previous = automaticRetentionRule(parseSettingsState(previousValue));
  } catch {
    return true;
  }
  return previous.count !== next.count;
}

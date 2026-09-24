import { parseSettingsState } from "../contracts/settings-state.js";

// Every warning before a destructive action, and where its "Don't warn me
// again" box lives. Each one is on by default; this is the one place that
// turns a silenced warning back on.
export const DESTRUCTIVE_WARNINGS = Object.freeze([
  Object.freeze({
    section: "sidebar",
    key: "warnBeforeClosingMultipleTabs",
    label: "closing several tabs"
  }),
  Object.freeze({
    section: "sidebar",
    key: "warnBeforeLoadingManyTabs",
    label: "loading a whole workspace"
  }),
  Object.freeze({
    section: "snapshots",
    key: "warnBeforeSnapshotDeletion",
    label: "deleting snapshots and tabs"
  })
]);

export function silencedWarnings(settings) {
  return DESTRUCTIVE_WARNINGS.filter(({ section, key }) => settings[section][key] === false);
}

export function warningsStatusText(silenced) {
  if (silenced.length === 0) {
    return "Every warning is on.";
  }
  const labels = silenced.map(({ label }) => label);
  const listed = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `${labels.length === 1 ? "One warning is" : `${labels.length} warnings are`} off: ${listed}.`;
}

export function createWarningsPanel({ client, setStatus }) {
  const pill = document.querySelector("#overview-warnings-pill");
  const status = document.querySelector("#overview-warnings-status");
  const restoreButton = document.querySelector("#restore-warnings");
  // With nothing silenced there is nothing to bring back, so the control is
  // shown only once a warning has been turned off.
  const restoreFoot = restoreButton.closest(".card-foot");
  let silenced = [];

  function apply(rawSettings) {
    const settings = parseSettingsState(rawSettings);
    silenced = silencedWarnings(settings);
    pill.textContent = silenced.length === 0 ? "All on" : `${silenced.length} off`;
    pill.className = `state-pill ${silenced.length === 0 ? "is-good" : "is-warn"}`;
    status.textContent = warningsStatusText(silenced);
    restoreButton.disabled = silenced.length === 0;
    restoreFoot.hidden = silenced.length === 0;
  }

  restoreButton.addEventListener("click", async () => {
    if (silenced.length === 0) {
      return;
    }
    const patch = {};
    for (const { section, key } of silenced) {
      patch[section] = { ...patch[section], [key]: true };
    }
    restoreButton.disabled = true;
    setStatus("Turning warnings back on…");
    try {
      apply(await client.update(patch));
      setStatus("Every warning is on again.");
    } catch (error) {
      restoreButton.disabled = false;
      setStatus(error.message, "error");
    }
  });

  return Object.freeze({ apply });
}

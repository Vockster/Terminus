export const SETTINGS_DATA_STATES = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  UNAVAILABLE: "unavailable"
});

export const SETTINGS_UNAVAILABLE_MESSAGE =
  "Terminus couldn't read your saved settings. Nothing was changed.";
export const WORKSPACES_LOADING_MESSAGE = "Loading workspaces…";
export const WORKSPACES_UNAVAILABLE_MESSAGE =
  "Terminus couldn't read your saved workspaces. Nothing was changed.";

function applyRegion(region, state) {
  region.dataset.settingsData = state;
  region.setAttribute("aria-busy", String(state === SETTINGS_DATA_STATES.LOADING));
  if (state === SETTINGS_DATA_STATES.READY) {
    region.removeAttribute("inert");
  } else {
    region.setAttribute("inert", "");
  }
}

function combined(first, second) {
  if (first === SETTINGS_DATA_STATES.READY && second === SETTINGS_DATA_STATES.READY) {
    return SETTINGS_DATA_STATES.READY;
  }
  return first === SETTINGS_DATA_STATES.UNAVAILABLE || second === SETTINGS_DATA_STATES.UNAVAILABLE
    ? SETTINGS_DATA_STATES.UNAVAILABLE
    : SETTINGS_DATA_STATES.LOADING;
}

// Editors stay inert until their saved data has been read at least once, so a
// control can never show built-in defaults as saved data or save from them. A
// later failed reload keeps the last values that were actually read.
export function createSettingsDataGate({ root, settingsRegions, workspacesRegion }) {
  let settings = SETTINGS_DATA_STATES.LOADING;
  let workspaces = SETTINGS_DATA_STATES.LOADING;

  function render() {
    root.dataset.settingsData = settings;
    for (const region of settingsRegions) {
      applyRegion(region, settings);
    }
    // Workspaces edits its own definitions and one sidebar preference.
    applyRegion(workspacesRegion, combined(settings, workspaces));
    workspacesRegion.dataset.workspaceData = workspaces;
  }

  function fail(current) {
    return current === SETTINGS_DATA_STATES.READY ? current : SETTINGS_DATA_STATES.UNAVAILABLE;
  }

  render();
  return Object.freeze({
    settingsLoaded() {
      settings = SETTINGS_DATA_STATES.READY;
      render();
    },
    settingsFailed() {
      settings = fail(settings);
      render();
      return settings;
    },
    workspacesLoaded() {
      workspaces = SETTINGS_DATA_STATES.READY;
      render();
    },
    workspacesFailed() {
      workspaces = fail(workspaces);
      render();
      return workspaces;
    },
    get settingsState() {
      return settings;
    },
    get workspacesState() {
      return workspaces;
    }
  });
}

import {
  SETTINGS_SECTIONS,
  parseSettingsState
} from "../contracts/settings-state.js";

const SAVE_DELAY_MS = 120;

export function createSidebarPanel({ client, setStatus, saveDelayMs = SAVE_DELAY_MS }) {
  const panel = document.querySelector("#sidebar-panel");
  const workspaceSizeInputs = [...panel.querySelectorAll('input[name="workspaceSize"]')];
  const tabSizeInputs = [...panel.querySelectorAll('input[name="tabSize"]')];
  const reorderingLockInput = panel.querySelector("#workspace-reordering-locked");
  const addWorkspaceButtonInput = panel.querySelector("#show-add-workspace-button");
  const actionButtonsInput = panel.querySelector("#show-action-buttons");
  const hideUnloadedTabsInput = panel.querySelector("#hide-unloaded-tabs-from-firefox");
  const showTabSearchInput = panel.querySelector("#show-tab-search");
  const tabSearchPositionInput = panel.querySelector("#tab-search-position");
  const contentModeInputs = [...panel.querySelectorAll('input[name="content-mode"]')];
  const resetButton = panel.querySelector("#reset-sidebar");
  let saveTimer;
  let pendingSidebarPatch = {};
  let revision = 0;

  function apply(rawSettings) {
    const settings = parseSettingsState(rawSettings);
    for (const input of workspaceSizeInputs) {
      input.checked = input.value === settings.sidebar.workspaceSize;
    }
    for (const input of tabSizeInputs) {
      input.checked = input.value === settings.sidebar.tabSize;
    }
    reorderingLockInput.checked = settings.sidebar.workspaceReorderingLocked;
    addWorkspaceButtonInput.checked = settings.sidebar.showAddWorkspaceButton;
    actionButtonsInput.checked = settings.sidebar.showActionButtons;
    hideUnloadedTabsInput.checked = settings.sidebar.hideUnloadedTabsFromFirefox;
    showTabSearchInput.checked = settings.sidebar.showTabSearch;
    tabSearchPositionInput.value = settings.sidebar.tabSearchPosition;
    for (const input of contentModeInputs) {
      input.checked = input.value === settings.appearance.contentMode;
    }
    const iconsOnly = settings.appearance.contentMode === "icons";
    actionButtonsInput.disabled = iconsOnly;
    actionButtonsInput.closest(".setting-row")?.setAttribute("aria-disabled", String(iconsOnly));
    const searchPositionDisabled = !settings.sidebar.showTabSearch;
    tabSearchPositionInput.disabled = searchPositionDisabled;
    tabSearchPositionInput
      .closest(".setting-row")
      ?.setAttribute("aria-disabled", String(searchPositionDisabled));
  }

  async function save(patch, expectedRevision) {
    try {
      const settings = await client.update(patch);
      if (expectedRevision === revision) {
        apply(settings);
        setStatus("Sidebar settings saved.");
      }
    } catch (error) {
      if (expectedRevision !== revision) return;
      try {
        if (typeof client.get === "function") {
          const settings = await client.get();
          if (expectedRevision === revision) apply(settings);
        }
      } catch {
        // Keep the original write error; the next page refresh will retry the read.
      }
      if (expectedRevision === revision) setStatus(error.message, "error");
    }
  }

  function queueSave(input) {
    clearTimeout(saveTimer);
    pendingSidebarPatch = {
      ...pendingSidebarPatch,
      [input.name]: input.value
    };
    revision += 1;
    const expectedRevision = revision;
    setStatus("Saving sidebar settings...");
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const sidebar = pendingSidebarPatch;
      pendingSidebarPatch = {};
      void save({ sidebar }, expectedRevision);
    }, saveDelayMs);
  }

  function saveNow(patch) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const sidebar = {
      ...pendingSidebarPatch,
      ...(patch.sidebar ?? {})
    };
    pendingSidebarPatch = {};
    revision += 1;
    const expectedRevision = revision;
    setStatus("Saving sidebar settings...");
    void save({
      ...patch,
      ...(Object.keys(sidebar).length > 0 ? { sidebar } : {})
    }, expectedRevision);
  }

  for (const input of [...workspaceSizeInputs, ...tabSizeInputs]) {
    input.addEventListener("change", () => {
      if (input.checked) queueSave(input);
    });
  }

  for (const input of [
    reorderingLockInput,
    addWorkspaceButtonInput,
    actionButtonsInput,
    hideUnloadedTabsInput,
    showTabSearchInput
  ]) {
    input.addEventListener("change", () => {
      saveNow({ sidebar: { [input.name]: input.checked } });
    });
  }

  tabSearchPositionInput.addEventListener("change", () => {
    queueSave(tabSearchPositionInput);
  });

  for (const input of contentModeInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      saveNow({ appearance: { contentMode: input.value } });
    });
  }

  resetButton.addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingSidebarPatch = {};
    revision += 1;
    resetButton.disabled = true;
    setStatus("Resetting sidebar settings...");
    try {
      apply(await client.resetSection(SETTINGS_SECTIONS.SIDEBAR));
      setStatus("Sidebar settings reset.");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      resetButton.disabled = false;
    }
  });

  return Object.freeze({
    apply,
    destroy() {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      pendingSidebarPatch = {};
      revision += 1;
    }
  });
}

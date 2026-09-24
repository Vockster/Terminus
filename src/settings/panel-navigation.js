const DEFAULT_PANEL_ID = "sidebar";

export function initializePanelNavigation({ saveNavigation, reportError, onSelect } = {}) {
  const buttons = [...document.querySelectorAll("[data-panel]")];
  const panels = [...document.querySelectorAll("[data-panel-content]")];
  const select = document.querySelector("#settings-section");
  const rememberInput = document.querySelector("#settings-remember-last-panel");
  const panelIds = new Set(panels.map(({ dataset }) => dataset.panelContent));
  let currentPanelId = DEFAULT_PANEL_ID;
  let rememberLastPanel = true;
  let initialSettingsApplied = false;

  async function persist(patch) {
    if (typeof saveNavigation !== "function") {
      return;
    }
    try {
      await saveNavigation(patch);
    } catch (error) {
      reportError?.(error);
    }
  }

  function selectPanel(panelId, { focus = false, save = false } = {}) {
    const selectedPanelId = panelIds.has(panelId) ? panelId : DEFAULT_PANEL_ID;
    for (const button of buttons) {
      const selected = button.dataset.panel === selectedPanelId;
      button.setAttribute("aria-current", selected ? "page" : "false");
      if (selected && focus) {
        button.focus();
      }
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panelContent !== selectedPanelId;
    }
    select.value = selectedPanelId;
    currentPanelId = selectedPanelId;
    onSelect?.(selectedPanelId);
    if (save && rememberLastPanel) {
      void persist({ lastPanel: selectedPanelId });
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => selectPanel(button.dataset.panel, { save: true }));
  }
  // In-page links, such as the Overview card buttons, open another Settings tab.
  for (const opener of document.querySelectorAll("[data-open-panel]")) {
    opener.addEventListener("click", () =>
      selectPanel(opener.dataset.openPanel, { focus: true, save: true })
    );
  }
  select.addEventListener("change", () => selectPanel(select.value, { save: true }));
  rememberInput?.addEventListener("change", () => {
    rememberLastPanel = rememberInput.checked;
    void persist(
      rememberLastPanel
        ? { rememberLastPanel: true, lastPanel: currentPanelId }
        : { rememberLastPanel: false }
    );
  });

  function apply(navigation) {
    rememberLastPanel = navigation.rememberLastPanel;
    if (rememberInput) {
      rememberInput.checked = rememberLastPanel;
    }
    if (!initialSettingsApplied) {
      selectPanel(rememberLastPanel ? navigation.lastPanel : DEFAULT_PANEL_ID);
      initialSettingsApplied = true;
    }
  }

  selectPanel(select.value);
  return Object.freeze({ apply, selectPanel });
}

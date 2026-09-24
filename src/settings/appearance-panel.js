import {
  ACTIVE_TAB_HIGHLIGHT_MODES,
  APPEARANCE_MODES,
  GRADIENT_LIMITS,
  SETTINGS_SECTIONS,
  parseSettingsState
} from "../contracts/settings-state.js";
import {
  DEFAULT_SIDEBAR_BACKGROUND_COLOR,
  createAppearanceBackground,
  readableForeground
} from "../ui/appearance.js";

const SAVE_DELAY_MS = 140;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeHexDraft(value) {
  const digits = String(value).replace(/[^0-9a-f]/gi, "").slice(0, 6);
  return `#${digits.toUpperCase()}`;
}

function hexChannels(color) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

// A new stop takes the colour the gradient already shows where it lands, so
// adding one changes nothing until the user recolours it. Hex stops use CSS's
// legacy sRGB interpolation, which a per-channel blend reproduces.
export function gradientColorAtPosition(stops, position) {
  const ordered = [...stops].sort((left, right) => left.position - right.position);
  if (position <= ordered[0].position) {
    return ordered[0].color;
  }
  if (position >= ordered.at(-1).position) {
    return ordered.at(-1).color;
  }
  const rightIndex = ordered.findIndex((stop) => stop.position >= position);
  const left = ordered[rightIndex - 1];
  const right = ordered[rightIndex];
  const share = (position - left.position) / (right.position - left.position);
  const leftChannels = hexChannels(left.color);
  const rightChannels = hexChannels(right.color);
  return `#${leftChannels
    .map((channel, index) =>
      Math.round(channel + (rightChannels[index] - channel) * share)
        .toString(16)
        .padStart(2, "0"))
    .join("")}`;
}

export function gradientStopNote(index, count) {
  return `Selected stop ${index + 1} of ${count}. Drag a stop to move it.`;
}

function gradientRailFill(stops) {
  return `linear-gradient(90deg, ${stops
    .map(({ color, position }) => `${color} ${position}%`)
    .join(", ")})`;
}

function cloneAppearance(appearance) {
  return {
    mode: appearance.mode,
    contentMode: appearance.contentMode,
    solidColor: appearance.solidColor,
    activeTabHighlight: { ...appearance.activeTabHighlight },
    applyToSettings: appearance.applyToSettings,
    settingsBackgroundColor: appearance.settingsBackgroundColor,
    workspaceGlowMode: appearance.workspaceGlowMode,
    typography: { ...appearance.typography },
    gradient: {
      angle: appearance.gradient.angle,
      stops: appearance.gradient.stops.map((stop) => ({ ...stop }))
    }
  };
}

// The `background` shorthand would reset `background-origin` on the element,
// so each part is set on its own and the stylesheet keeps the border box.
function paintBackground(element, value) {
  const isImage = value.includes("gradient(");
  element.style.backgroundImage = isImage ? value : "none";
  element.style.backgroundColor = isImage ? "transparent" : value;
}

function previewInk(appearance) {
  if (appearance.mode === APPEARANCE_MODES.FIREFOX) {
    return "CanvasText";
  }
  if (appearance.mode === APPEARANCE_MODES.SOLID) {
    return readableForeground(appearance.solidColor);
  }
  if (appearance.mode === APPEARANCE_MODES.GRADIENT) {
    return readableForeground(gradientColorAtPosition(appearance.gradient.stops, 50));
  }
  return readableForeground(DEFAULT_SIDEBAR_BACKGROUND_COLOR);
}

function closestAvailablePosition(stops, selectedStop, requested) {
  const target = Math.max(0, Math.min(100, Math.round(requested)));
  const occupied = new Set(stops.filter((stop) => stop !== selectedStop).map(({ position }) => position));
  if (!occupied.has(target)) {
    return target;
  }
  for (let distance = 1; distance <= 100; distance += 1) {
    if (target - distance >= 0 && !occupied.has(target - distance)) {
      return target - distance;
    }
    if (target + distance <= 100 && !occupied.has(target + distance)) {
      return target + distance;
    }
  }
  return selectedStop.position;
}

export function createAppearancePanel({ client, setStatus, colorPanel }) {
  const panel = document.querySelector("#appearance-panel");
  const modeInputs = [...panel.querySelectorAll('input[name="appearance-mode"]')];
  const activeTabHighlightModeInputs = [
    ...panel.querySelectorAll('input[name="active-tab-highlight-mode"]')
  ];
  const workspaceGlowInputs = [...panel.querySelectorAll('input[name="workspace-glow-mode"]')];
  const solidControls = panel.querySelector("#solid-controls");
  const gradientControls = panel.querySelector("#gradient-controls");
  const activeTabHighlightControls = panel.querySelector("#active-tab-highlight-controls");
  const applyToSettings = panel.querySelector("#apply-theme-to-settings");
  const settingsFontSizeInputs = [
    ...panel.querySelectorAll('input[name="settingsFontSize"]')
  ];
  const gradientAngle = panel.querySelector("#gradient-angle");
  const gradientAngleOutput = panel.querySelector("#gradient-angle-output");
  const gradientRail = panel.querySelector("#gradient-rail");
  const selectedHex = panel.querySelector("#gradient-selected-hex");
  const selectedSwatch = panel.querySelector("#gradient-selected-swatch");
  const stopNote = panel.querySelector("#gradient-stop-note");
  const addStopButton = panel.querySelector("#add-gradient-stop");
  const removeStopButton = panel.querySelector("#remove-gradient-stop");
  const resetButton = panel.querySelector("#reset-appearance");
  const preview = panel.querySelector("#appearance-preview");
  const modeSwatches = [...panel.querySelectorAll("[data-appearance-swatch]")];
  let appearance;
  let selectedStop;
  let saveTimer;
  let revision = 0;
  let pendingLocalRevision = null;
  let railDrag = null;
  const markerByStop = new Map();

  // Each colour is a swatch, a hex field and, for the sidebar colour, a Pick a
  // color button. The swatch also opens the picker for a pointer user; the hex
  // field is the keyboard route, so the swatch stays out of the tab order.
  const colorFields = [
    {
      input: panel.querySelector("#solid-color-hex"),
      swatch: panel.querySelector("#solid-color-swatch"),
      picker: panel.querySelector("#solid-color"),
      title: "Choose sidebar color",
      read: () => appearance.solidColor,
      write: (color) => { appearance.solidColor = color; }
    },
    {
      input: panel.querySelector("#active-tab-highlight-color"),
      swatch: panel.querySelector("#active-tab-highlight-swatch"),
      title: "Choose current tab highlight",
      read: () => appearance.activeTabHighlight.color,
      write: (color) => { appearance.activeTabHighlight.color = color; }
    },
    {
      input: panel.querySelector("#settings-background-color"),
      swatch: panel.querySelector("#settings-background-swatch"),
      title: "Choose Settings background",
      read: () => appearance.settingsBackgroundColor,
      write: (color) => { appearance.settingsBackgroundColor = color; }
    },
    {
      input: selectedHex,
      swatch: selectedSwatch,
      title: "Choose stop color",
      read: () => selectedStop.color,
      write: (color) => { selectedStop.color = color; }
    }
  ];

  function renderColors() {
    for (const field of colorFields) {
      paintBackground(field.swatch, field.read());
    }
    for (const [stop, marker] of markerByStop) {
      marker.style.setProperty("--gradient-marker-color", stop.color);
    }
    gradientRail.style.setProperty(
      "--gradient-rail-fill",
      gradientRailFill(appearance.gradient.stops)
    );
    renderPreview();
  }

  function renderPreview() {
    paintBackground(preview, createAppearanceBackground(appearance));
    preview.style.setProperty("--preview-ink", previewInk(appearance));
    for (const swatch of modeSwatches) {
      paintBackground(swatch, createAppearanceBackground({
        ...appearance,
        mode: swatch.dataset.appearanceSwatch
      }));
    }
    preview.dataset.mode = appearance.mode;
    preview.dataset.contentMode = appearance.contentMode;
    preview.style.setProperty(
      "--preview-active-tab-highlight",
      appearance.activeTabHighlight.mode === ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM
        ? appearance.activeTabHighlight.color
        : "AccentColor"
    );
  }

  function renderMode() {
    for (const input of modeInputs) {
      input.checked = input.value === appearance.mode;
    }
    for (const input of activeTabHighlightModeInputs) {
      input.checked = input.value === appearance.activeTabHighlight.mode;
    }
    for (const input of workspaceGlowInputs) {
      input.checked = input.value === appearance.workspaceGlowMode;
    }
    solidControls.hidden = appearance.mode !== APPEARANCE_MODES.SOLID;
    gradientControls.hidden = appearance.mode !== APPEARANCE_MODES.GRADIENT;
    activeTabHighlightControls.hidden =
      appearance.activeTabHighlight.mode !== ACTIVE_TAB_HIGHLIGHT_MODES.CUSTOM;
    applyToSettings.checked = appearance.applyToSettings;
    for (const input of settingsFontSizeInputs) {
      input.checked = Number(input.value) === appearance.typography.fontSize;
    }
    document.documentElement.style.setProperty(
      "--settings-font-size",
      `${appearance.typography.fontSize}px`
    );
    renderPreview();
  }

  function selectStop(stop) {
    selectedStop = stop ?? appearance.gradient.stops[0];
    syncStopControls();
  }

  // Moving a stop never recolours it: its colour is its own.
  function updateStopPosition(stop, position, { save = true } = {}) {
    stop.position = closestAvailablePosition(
      appearance.gradient.stops,
      stop,
      position
    );
    appearance.gradient.stops.sort((left, right) => left.position - right.position);
    selectedStop = stop;
    syncStopControls();
    if (save) {
      queueSave();
    }
  }

  function positionFromPointer(event) {
    const bounds = gradientRail.getBoundingClientRect();
    if (bounds.width <= 0) {
      return railDrag?.stop?.position ?? selectedStop.position;
    }
    return ((event.clientX - bounds.left) / bounds.width) * 100;
  }

  function beginRailDrag(event, stop) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    selectStop(stop);
    railDrag = { pointerId: event.pointerId, stop };
    gradientRail.setPointerCapture?.(event.pointerId);
    updateStopPosition(stop, positionFromPointer(event), { save: false });
  }

  function syncStopControls() {
    const stops = appearance.gradient.stops;
    for (const [index, stop] of stops.entries()) {
      const marker = markerByStop.get(stop);
      if (!marker) {
        continue;
      }
      marker.style.left = `${stop.position}%`;
      marker.dataset.selected = String(stop === selectedStop);
      marker.setAttribute("aria-label", `Gradient stop ${index + 1} of ${stops.length}`);
      marker.setAttribute("aria-valuenow", String(stop.position));
      marker.setAttribute("aria-valuetext", `${stop.position}%`);
    }
    selectedHex.value = selectedStop.color.toUpperCase();
    stopNote.textContent = gradientStopNote(stops.indexOf(selectedStop), stops.length);
    addStopButton.disabled = stops.length >= GRADIENT_LIMITS.maxStops;
    removeStopButton.disabled = stops.length <= GRADIENT_LIMITS.minStops;
    removeStopButton.setAttribute(
      "aria-label",
      `Remove selected gradient stop at ${selectedStop.position}%`
    );
    renderColors();
  }

  function renderStops() {
    gradientRail.replaceChildren();
    markerByStop.clear();
    for (const stop of appearance.gradient.stops) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "gradient-marker";
      marker.setAttribute("role", "slider");
      marker.setAttribute("aria-valuemin", "0");
      marker.setAttribute("aria-valuemax", "100");
      marker.addEventListener("click", () => selectStop(stop));
      marker.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        beginRailDrag(event, stop);
      });
      marker.addEventListener("keydown", (event) => {
        const directions = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
        let nextPosition = stop.position;
        if (event.key in directions) {
          nextPosition += directions[event.key];
        } else if (event.key === "Home") {
          nextPosition = 0;
        } else if (event.key === "End") {
          nextPosition = 100;
        } else {
          return;
        }
        event.preventDefault();
        selectedStop = stop;
        updateStopPosition(stop, nextPosition);
        marker.focus();
      });
      markerByStop.set(stop, marker);
      gradientRail.append(marker);
    }
    syncStopControls();
  }

  function apply(rawSettings, { force = false } = {}) {
    if (!force && pendingLocalRevision !== null) {
      return;
    }
    const priorPosition = selectedStop?.position;
    const settings = parseSettingsState(rawSettings);
    appearance = cloneAppearance(settings.appearance);
    selectedStop = Number.isInteger(priorPosition)
      ? appearance.gradient.stops.reduce((nearest, stop) =>
        Math.abs(stop.position - priorPosition) < Math.abs(nearest.position - priorPosition)
          ? stop
          : nearest)
      : appearance.gradient.stops[0];
    for (const field of colorFields) {
      field.input.value = field.read().toUpperCase();
    }
    gradientAngle.value = String(appearance.gradient.angle);
    gradientAngleOutput.textContent = `${appearance.gradient.angle}°`;
    renderStops();
    renderMode();
  }

  async function save(expectedRevision, draft) {
    try {
      const settings = await client.update({ appearance: draft });
      if (expectedRevision === revision) {
        pendingLocalRevision = null;
        apply(settings, { force: true });
        setStatus("Appearance saved.");
      }
    } catch (error) {
      if (expectedRevision === revision) {
        pendingLocalRevision = null;
        setStatus(error.message, "error");
      }
    }
  }

  function queueSave() {
    clearTimeout(saveTimer);
    revision += 1;
    const expectedRevision = revision;
    const draft = cloneAppearance(appearance);
    pendingLocalRevision = expectedRevision;
    renderPreview();
    setStatus("Saving appearance…");
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void save(expectedRevision, draft);
    }, SAVE_DELAY_MS);
  }

  for (const field of colorFields) {
    const { input, swatch, picker, title, read, write } = field;
    const commit = (color) => {
      write(color);
      renderColors();
      queueSave();
    };
    const openPicker = () => {
      colorPanel.open({
        title,
        value: read(),
        onApply(color) {
          input.value = color.toUpperCase();
          commit(color);
        }
      });
    };
    input.addEventListener("input", () => {
      input.value = normalizeHexDraft(input.value);
      // Supersede any save that began before this draft so its response cannot
      // replace the field while the user is still typing.
      revision += 1;
      if (HEX_COLOR.test(input.value)) {
        commit(input.value.toLowerCase());
      }
    });
    input.addEventListener("change", () => {
      if (!HEX_COLOR.test(input.value.trim())) {
        input.value = read().toUpperCase();
        setStatus("Enter six hex digits after #, for example #2B2A33.", "error");
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    swatch.addEventListener("click", openPicker);
    picker?.addEventListener("click", openPicker);
  }

  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      if (input.checked) {
        appearance.mode = input.value;
        renderMode();
        queueSave();
      }
    });
  }
  for (const input of activeTabHighlightModeInputs) {
    input.addEventListener("change", () => {
      if (input.checked) {
        appearance.activeTabHighlight.mode = input.value;
        renderMode();
        queueSave();
      }
    });
  }
  for (const input of workspaceGlowInputs) {
    input.addEventListener("change", () => {
      if (input.checked) {
        appearance.workspaceGlowMode = input.value;
        queueSave();
      }
    });
  }
  applyToSettings.addEventListener("change", () => {
    appearance.applyToSettings = applyToSettings.checked;
    queueSave();
  });
  for (const input of settingsFontSizeInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) {
        return;
      }
      appearance.typography.fontSize = Number(input.value);
      renderMode();
      queueSave();
    });
  }
  gradientRail.addEventListener("pointerdown", (event) => beginRailDrag(event, selectedStop));
  gradientRail.addEventListener("pointermove", (event) => {
    if (railDrag?.pointerId === event.pointerId) {
      updateStopPosition(railDrag.stop, positionFromPointer(event), { save: false });
    }
  });
  const endRailDrag = (event) => {
    if (railDrag?.pointerId !== event.pointerId) {
      return;
    }
    const movedStop = railDrag.stop;
    railDrag = null;
    gradientRail.releasePointerCapture?.(event.pointerId);
    selectedStop = movedStop;
    queueSave();
  };
  gradientRail.addEventListener("pointerup", endRailDrag);
  gradientRail.addEventListener("pointercancel", endRailDrag);
  gradientAngle.addEventListener("input", () => {
    appearance.gradient.angle = Number(gradientAngle.value);
    gradientAngleOutput.textContent = `${gradientAngle.value}°`;
    queueSave();
  });
  addStopButton.addEventListener("click", () => {
    if (appearance.gradient.stops.length >= GRADIENT_LIMITS.maxStops) {
      return;
    }
    const stops = appearance.gradient.stops;
    const segments = [
      { start: 0, end: stops[0].position },
      ...stops.slice(0, -1).map((left, index) => ({
        start: left.position,
        end: stops[index + 1].position
      })),
      { start: stops.at(-1).position, end: 100 }
    ];
    const widest = segments.reduce((selected, segment) =>
      segment.end - segment.start > selected.end - selected.start ? segment : selected
    );
    const position = closestAvailablePosition(
      stops,
      null,
      Math.round((widest.start + widest.end) / 2)
    );
    const stop = {
      color: gradientColorAtPosition(stops, position),
      position
    };
    stops.push(stop);
    stops.sort((left, right) => left.position - right.position);
    selectedStop = stop;
    renderStops();
    queueSave();
  });
  removeStopButton.addEventListener("click", () => {
    if (appearance.gradient.stops.length <= GRADIENT_LIMITS.minStops) {
      return;
    }
    const index = appearance.gradient.stops.indexOf(selectedStop);
    appearance.gradient.stops.splice(index, 1);
    selectedStop = appearance.gradient.stops[Math.min(index, appearance.gradient.stops.length - 1)];
    renderStops();
    queueSave();
  });
  resetButton.addEventListener("click", async () => {
    clearTimeout(saveTimer);
    revision += 1;
    pendingLocalRevision = null;
    resetButton.disabled = true;
    setStatus("Resetting appearance…");
    try {
      apply(await client.resetSection(SETTINGS_SECTIONS.APPEARANCE), { force: true });
      setStatus("Appearance reset to its defaults.");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      resetButton.disabled = false;
    }
  });

  return Object.freeze({ apply });
}

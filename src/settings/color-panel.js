const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeHexColor(value) {
  const match = typeof value === "string" ? HEX_COLOR_PATTERN.exec(value.trim()) : null;
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToHsl(value) {
  const color = normalizeHexColor(value);
  if (!color) {
    throw new TypeError("Expected a six-digit hexadecimal color.");
  }
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (maximum === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (maximum === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return Object.freeze({
    hue: Math.round((hue + 360) % 360),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100)
  });
}

export function hslToHex(hue, saturation, lightness) {
  const normalizedHue = ((Number(hue) % 360) + 360) % 360;
  const normalizedSaturation = clamp(Number(saturation), 0, 100) / 100;
  const normalizedLightness = clamp(Number(lightness), 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const section = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [redPrime, greenPrime, bluePrime] = section < 1
    ? [chroma, secondary, 0]
    : section < 2
      ? [secondary, chroma, 0]
      : section < 3
        ? [0, chroma, secondary]
        : section < 4
          ? [0, secondary, chroma]
          : section < 5
            ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const match = normalizedLightness - chroma / 2;
  return `#${[redPrime, greenPrime, bluePrime]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function colorPanelChannelColors(hue, saturation, lightness) {
  return Object.freeze({
    selected: hslToHex(hue, saturation, lightness),
    hueThumb: hslToHex(hue, 100, 50),
    saturationStart: hslToHex(hue, 0, lightness),
    saturationEnd: hslToHex(hue, 100, lightness),
    lightnessMiddle: hslToHex(hue, saturation, 50)
  });
}

export function createColorPanel() {
  const dialog = document.querySelector("#color-panel");
  const form = dialog.querySelector("#color-panel-form");
  const heading = dialog.querySelector("#color-panel-heading");
  const palette = dialog.querySelector("#color-panel-palette");
  const preview = dialog.querySelector("#color-panel-preview");
  const hexInput = dialog.querySelector("#color-panel-hex");
  const cancelButton = dialog.querySelector("#color-panel-cancel");
  const applyButton = dialog.querySelector("#color-panel-apply");
  const customControls = [...dialog.querySelectorAll("[data-color-panel-custom]")];
  const ranges = {
    hue: dialog.querySelector("#color-panel-hue"),
    saturation: dialog.querySelector("#color-panel-saturation"),
    lightness: dialog.querySelector("#color-panel-lightness")
  };
  const outputs = {
    hue: dialog.querySelector("#color-panel-hue-output"),
    saturation: dialog.querySelector("#color-panel-saturation-output"),
    lightness: dialog.querySelector("#color-panel-lightness-output")
  };
  let applyColor = null;
  let paletteMode = false;

  function render(color, { updateRanges = true } = {}) {
    const normalized = normalizeHexColor(color);
    if (!normalized) {
      hexInput.setCustomValidity("Enter a six-digit hexadecimal color such as #2563eb.");
      return;
    }
    hexInput.setCustomValidity("");
    hexInput.value = normalized;
    preview.style.setProperty("--color-panel-value", normalized);
    if (updateRanges) {
      const hsl = hexToHsl(normalized);
      for (const key of Object.keys(ranges)) {
        ranges[key].value = String(hsl[key]);
      }
    }
    outputs.hue.textContent = `${ranges.hue.value}°`;
    const channelColors = colorPanelChannelColors(
      ranges.hue.value,
      ranges.saturation.value,
      ranges.lightness.value
    );
    dialog.style.setProperty("--color-panel-selected", channelColors.selected);
    dialog.style.setProperty("--color-panel-hue-thumb", channelColors.hueThumb);
    dialog.style.setProperty(
      "--color-panel-saturation-start",
      channelColors.saturationStart
    );
    dialog.style.setProperty(
      "--color-panel-saturation-end",
      channelColors.saturationEnd
    );
    dialog.style.setProperty(
      "--color-panel-lightness-middle",
      channelColors.lightnessMiddle
    );
    outputs.saturation.textContent = `${ranges.saturation.value}%`;
    outputs.lightness.textContent = `${ranges.lightness.value}%`;
  }

  for (const input of Object.values(ranges)) {
    input.addEventListener("input", () => {
      render(
        hslToHex(ranges.hue.value, ranges.saturation.value, ranges.lightness.value),
        { updateRanges: false }
      );
    });
  }
  hexInput.addEventListener("input", () => {
    const normalized = normalizeHexColor(hexInput.value);
    if (normalized) {
      render(normalized);
    } else {
      hexInput.setCustomValidity("Enter a six-digit hexadecimal color such as #2563eb.");
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (paletteMode) {
      return;
    }
    const color = normalizeHexColor(hexInput.value);
    if (!color) {
      hexInput.reportValidity();
      return;
    }
    const callback = applyColor;
    dialog.close();
    callback?.(color);
  });
  cancelButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    applyColor = null;
    palette.replaceChildren();
  });

  function setPaletteMode(enabled) {
    paletteMode = enabled;
    palette.hidden = !enabled;
    applyButton.hidden = enabled;
    for (const control of customControls) {
      control.hidden = enabled;
    }
  }

  function open({ title = "Choose color", value, onApply }) {
    if (dialog.open) {
      dialog.close();
    }
    heading.textContent = title;
    applyColor = onApply;
    setPaletteMode(false);
    render(value);
    dialog.showModal();
    hexInput.focus();
    hexInput.select();
  }

  function openPalette({ title = "Choose color", options, value, onApply }) {
    if (!Array.isArray(options) || options.length === 0) {
      throw new TypeError("At least one supported color is required.");
    }
    if (dialog.open) {
      dialog.close();
    }
    heading.textContent = title;
    applyColor = onApply;
    setPaletteMode(true);
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-panel-palette-choice";
      button.style.setProperty("--palette-color", option.color);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === value));
      button.setAttribute("aria-label", option.label);
      button.title = option.label;
      button.addEventListener("click", () => {
        const callback = applyColor;
        dialog.close();
        callback?.(option.value);
      });
      palette.append(button);
    }
    dialog.showModal();
    palette.querySelector('[aria-selected="true"]')?.focus();
    if (!palette.contains(document.activeElement)) {
      palette.querySelector("button")?.focus();
    }
  }

  return Object.freeze({ open, openPalette });
}

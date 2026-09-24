import test from "node:test";
import assert from "node:assert/strict";

import {
  colorPanelChannelColors,
  hexToHsl,
  hslToHex,
  normalizeHexColor
} from "../../src/settings/color-panel.js";

test("the custom color panel normalizes supported hex colors", () => {
  assert.equal(normalizeHexColor("#AbC123"), "#abc123");
  assert.equal(normalizeHexColor("abc123"), "#abc123");
  assert.equal(normalizeHexColor("red"), null);
  assert.equal(normalizeHexColor("#abcd"), null);
});

test("hex and HSL conversion preserve canonical colors", () => {
  for (const color of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"]) {
    const hsl = hexToHsl(color);
    assert.equal(hslToHex(hsl.hue, hsl.saturation, hsl.lightness), color);
  }
});

test("color-panel channel tracks follow the selected hue, saturation, and lightness", () => {
  assert.deepEqual(colorPanelChannelColors(120, 50, 40), {
    selected: "#339933",
    hueThumb: "#00ff00",
    saturationStart: "#666666",
    saturationEnd: "#00cc00",
    lightnessMiddle: "#40bf40"
  });
  assert.deepEqual(colorPanelChannelColors(0, 0, 50), {
    selected: "#808080",
    hueThumb: "#ff0000",
    saturationStart: "#808080",
    saturationEnd: "#ff0000",
    lightnessMiddle: "#808080"
  });
});

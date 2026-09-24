import test from "node:test";
import assert from "node:assert/strict";

import { createFirefoxThemeSource } from "../../src/platform/firefox/theme-source.js";

test("Firefox theme source reads and filters updates for its sidebar window", async () => {
  let listener;
  const calls = [];
  const browserApi = {
    theme: {
      async getCurrent(windowId) { calls.push(["getCurrent", windowId]); return { colors: { sidebar: "#123456" } }; },
      onUpdated: {
        addListener(value) { listener = value; },
        removeListener(value) { calls.push(["removeListener", value === listener]); }
      }
    }
  };
  const source = createFirefoxThemeSource(browserApi, 7);
  assert.deepEqual(await source.getCurrent(), { colors: { sidebar: "#123456" } });
  const themes = [];
  const unsubscribe = source.subscribe((theme) => themes.push(theme));
  listener({ windowId: 8, theme: { colors: { sidebar: "#888888" } } });
  listener({ windowId: 7, theme: { colors: { sidebar: "#777777" } } });
  listener({ theme: { colors: { sidebar: "#999999" } } });
  assert.deepEqual(themes, [
    { colors: { sidebar: "#777777" } },
    { colors: { sidebar: "#999999" } }
  ]);
  unsubscribe();
  assert.deepEqual(calls, [["getCurrent", 7], ["removeListener", true]]);
});

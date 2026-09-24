import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  customIconUsageText,
  removalWarning,
  summarizeCustomIconAdds
} from "../../src/settings/custom-icons-panel.js";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("the Custom icons box sits directly under the Containers box with the agreed copy", async () => {
  const html = await source("src/settings/index.html");
  const container = html.indexOf('id="container-support-card"');
  const custom = html.indexOf('id="custom-icon-card"');
  const editor = html.indexOf('id="workspace-editor"');
  assert.ok(container > 0 && container < custom && custom < editor);

  const card = html.slice(custom, editor);
  assert.match(card, /<h2 id="custom-icon-heading">Custom icons<\/h2>/);
  assert.match(card, />Your pictures are kept as 128px copies on this computer and left out of backups\.</);
  // One state line carries the count, the size and the tip.
  assert.match(card, /id="custom-icon-count" class="state-pill is-accent"/);
  assert.match(card, /id="custom-icon-usage" class="state-when"/);
  assert.equal(customIconUsageText(0, null), "Transparent backgrounds work best");
  assert.equal(customIconUsageText(6, 1_258_291), "1.20 MiB · transparent backgrounds work best");
  assert.match(card, /<button id="add-custom-icons" class="btn is-primary" type="button">Add Icons<\/button>/);
  assert.match(card, /<input id="custom-icon-file" type="file" multiple hidden \/>/);
  assert.match(card, /id="custom-icon-status" class="setting-help" role="status" aria-live="polite"/);
  assert.match(html, /<dialog id="remove-custom-icon-dialog"[\s\S]*?id="confirm-custom-icon-removal" class="btn is-danger" type="submit">Remove</);
  assert.match(html, /custom icons, native Firefox containers/);
});

test("Storage is limited to the website-icon cache", async () => {
  const html = await source("src/settings/index.html");
  const start = html.indexOf('id="storage-panel"');
  const panelHtml = html.slice(start, html.indexOf('id="firefox-styling-panel"'));
  assert.match(panelHtml, /id="storage-icon-gallery"/);
  assert.match(panelHtml, /id="storage-favicon-count"/);
  assert.doesNotMatch(panelHtml, /custom icons|legacy font|storage-font-bytes|allowance/i);
  const panel = await source("src/settings/storage-panel.js");
  assert.match(panel, /client\.list\(cursor\)/);
  assert.doesNotMatch(panel, /CUSTOM_ICON_MESSAGE_TYPES|overview\.fonts|uploaded font/);
});

test("the picker scrolls, the box takes its accept list from the contract, and images keep their colors", async () => {
  const css = await source("src/settings/styles.css");
  assert.match(css, /\.rail-shared-icons\s*\{[\s\S]*?max-block-size: 7rem;[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.custom-icon-library\s*\{[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.workspace-icon-preview--image,\s*\.snapshot-workspace-icon--image\s*\{\s*background: none;\s*mask: none;/);

  const panel = await source("src/settings/custom-icons-panel.js");
  assert.match(panel, /fileInput\.accept = CUSTOM_ICON_FILE_ACCEPT;/);
  assert.match(panel, /label\.textContent = icon\.label;/);
  assert.doesNotMatch(panel, /innerHTML/);

  const sidebarCss = await source("src/sidebar/styles.css");
  assert.match(sidebarCss, /\.workspace-icon--image\s*\{\s*background: none;\s*mask: none;/);
  assert.match(sidebarCss, /@media \(forced-colors: active\)[\s\S]*?\.workspace-icon--image\s*\{\s*background: none;\s*forced-color-adjust: none;/);

  const sidebarMain = await source("src/sidebar/main.js");
  assert.match(sidebarMain, /image\.draggable = false;/);
  assert.match(sidebarMain, /CUSTOM_ICON_MESSAGE_TYPES\.CHANGED[\s\S]*?loadCustomIcons\(\)\.then\(\(\) => scheduleRefresh\(\)\)/);
});

test("status and warning copy stays short and plain", () => {
  assert.equal(
    summarizeCustomIconAdds({ added: 2, duplicates: 1, rejected: [], limitReached: false }),
    "2 icons added. 1 icon was already added."
  );
  assert.equal(
    summarizeCustomIconAdds({
      added: 0,
      duplicates: 0,
      rejected: [{ name: "scan.tiff", message: "Firefox could not read this image." }],
      limitReached: true
    }),
    "Could not add “scan.tiff”: Firefox could not read this image. The limit of 100 custom icons was reached. Remove one to add another."
  );
  assert.equal(summarizeCustomIconAdds({ added: 0, duplicates: 0, rejected: [], limitReached: false }), "No icons were added.");
  assert.equal(removalWarning(1), "1 workspace uses this icon. It will switch to House.");
  assert.equal(removalWarning(3), "3 workspaces use this icon. They will switch to House.");
});

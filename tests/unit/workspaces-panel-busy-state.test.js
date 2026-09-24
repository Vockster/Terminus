import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A workspace mutation blanks out every control in the panel while it runs.
// The panel contains cards it does not own, so restoring a hand-written list of
// controls silently stranded the rest: assigning a container to a workspace left
// Add Icons + greyed out until the page was reloaded.
test("a workspace mutation restores exactly the controls it suspended", async () => {
  const panel = await readFile(
    new URL("../../src/settings/workspaces-panel.js", import.meta.url),
    "utf8"
  );

  const mutation = panel.match(/async function runMutation\([\s\S]*?\n  \}\n/);
  assert.ok(mutation, "the panel runs mutations through one guarded helper");
  const body = mutation[0];

  // Controls another panel already disabled stay disabled.
  assert.match(body, /\.filter\(\(control\) => !control\.disabled\)/);
  // What was suspended is what comes back.
  assert.match(body, /for \(const control of suspended\) \{\s*\n\s*control\.disabled = false;/);

  // No hand-maintained allowlist: that is the shape that caused the defect.
  for (const stranded of [
    "createButton.disabled = false",
    "addDividerButton.disabled = false",
    "addSpaceButton.disabled = false",
    "warnBeforeWorkspaceRemoval.disabled = false"
  ]) {
    assert.ok(!body.includes(stranded), `${stranded} re-introduces the allowlist`);
  }
});

// The reason the blanket disable reaches Add Icons + at all. If this card ever
// moves out of the panel the test above stops covering the original defect.
test("the custom icon card sits inside the workspaces panel", async () => {
  const html = await readFile(
    new URL("../../src/settings/index.html", import.meta.url),
    "utf8"
  );
  const panel = html.slice(html.indexOf('id="workspaces-panel"'));
  const end = panel.indexOf('id="snapshots-panel"');
  const within = end === -1 ? panel : panel.slice(0, end);
  assert.ok(within.includes('id="add-custom-icons"'), "Add Icons + is inside the workspaces panel");
});

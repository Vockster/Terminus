import test from "node:test";
import assert from "node:assert/strict";

import {
  presentWorkspaceIcon,
  workspaceIconLabel
} from "../../src/ui/workspace-icon-presentation.js";

const CUSTOM_ID = `custom-${"b".repeat(32)}`;
const MISSING_ID = `custom-${"c".repeat(32)}`;
const library = {
  get(id) {
    return id === CUSTOM_ID ? { id, label: "Team Logo", url: "blob:moz-extension://x/1" } : null;
  }
};

test("built-in and retired icons draw as tinted masks", () => {
  assert.deepEqual(presentWorkspaceIcon("house", library), {
    kind: "mask",
    path: "../assets/icons/workspace/house.svg",
    opticalScale: 1,
    label: "House"
  });
  assert.equal(presentWorkspaceIcon("briefcase").path, "../assets/icons/workspace/briefcase-business.svg");
});

test("stored custom images draw as images and missing ones fall back to House", () => {
  assert.deepEqual(presentWorkspaceIcon(CUSTOM_ID, library), {
    kind: "image",
    url: "blob:moz-extension://x/1",
    label: "Team Logo"
  });
  assert.equal(presentWorkspaceIcon(MISSING_ID, library).path, "../assets/icons/workspace/house.svg");
  assert.equal(presentWorkspaceIcon(CUSTOM_ID, null).kind, "mask");
  assert.equal(presentWorkspaceIcon("future-icon", library).label, "House");
});

test("labels name only icons that can still be drawn", () => {
  assert.equal(workspaceIconLabel("notebook-pen", library), "Notebook");
  assert.equal(workspaceIconLabel("tree", library), "Tree palm");
  assert.equal(workspaceIconLabel(CUSTOM_ID, library), "Team Logo");
  assert.equal(workspaceIconLabel(MISSING_ID, library), null);
  assert.equal(workspaceIconLabel("future-icon", library), null);
});

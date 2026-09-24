import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FALLBACK_WORKSPACE_ICON,
  WORKSPACE_ICON_CATALOG,
  isWorkspaceIconId,
  resolveWorkspaceIcon
} from "../../src/contracts/workspace-icons.js";

const CATALOG_ORDER = [
  "house", "user", "notebook-pen", "briefcase-business", "audio-lines", "book-a",
  "book-bookmark", "book-heart", "book-open", "book-open-text", "brick-wall-shield", "car",
  "circle-dollar-sign", "cross", "crown", "engine", "fingerprint-pattern", "gem", "glasses",
  "heart", "image", "library-big", "mail", "package", "paw-print", "shield-cog-corner",
  "shield-keyhole", "shopping-cart", "shopping-cart-minus", "shopping-cart-plus", "star",
  "summary", "tickets-plane", "tree-palm", "trophy", "users", "utensils-crossed", "van",
  "wallet", "wrench"
];

test("the catalog is exactly the supplied Lucide set in picker order", async () => {
  assert.deepEqual(WORKSPACE_ICON_CATALOG.map(({ id }) => id), CATALOG_ORDER);
  assert.equal(new Set(WORKSPACE_ICON_CATALOG.map(({ label }) => label)).size, CATALOG_ORDER.length);
  for (const icon of WORKSPACE_ICON_CATALOG) {
    assert.equal(icon.kind, "catalog");
    assert.equal(isWorkspaceIconId(icon.id), true);
    assert.equal(icon.path, `../assets/icons/workspace/${icon.id}.svg`);
    assert.equal(icon.opticalScale, 1);
    const source = await readFile(
      new URL(`../../src/assets/icons/workspace/${icon.id}.svg`, import.meta.url),
      "utf8"
    );
    assert.match(source, /<svg\b/);
    assert.match(source, /viewBox=/);
  }
});

test("unknown stored icons resolve to House without becoming selectable", () => {
  assert.equal(FALLBACK_WORKSPACE_ICON.id, "house");
  assert.equal(isWorkspaceIconId("future-icon"), false);
  assert.equal(resolveWorkspaceIcon("future-icon"), FALLBACK_WORKSPACE_ICON);
  assert.equal(resolveWorkspaceIcon(undefined), FALLBACK_WORKSPACE_ICON);
});

test("retired IDs keep rendering the icon that matches what they showed before", () => {
  const expected = {
    briefcase: "briefcase-business",
    books: "briefcase-business",
    folder: "briefcase-business",
    fingerprint: "fingerprint-pattern",
    home: "fingerprint-pattern",
    code: "fingerprint-pattern",
    dollar: "circle-dollar-sign",
    cart: "shopping-cart",
    circle: "star",
    app: "star",
    calendar: "star",
    gift: "package",
    vacation: "tickets-plane",
    food: "utensils-crossed",
    fruit: "utensils-crossed",
    pet: "paw-print",
    tree: "tree-palm",
    flask: "tree-palm",
    compass: "tree-palm",
    chill: "glasses",
    coffee: "glasses",
    gamepad: "glasses",
    fence: "brick-wall-shield"
  };
  for (const [retired, current] of Object.entries(expected)) {
    assert.equal(isWorkspaceIconId(retired), true, retired);
    assert.equal(resolveWorkspaceIcon(retired).id, current, retired);
  }
  assert.equal(resolveWorkspaceIcon("mail").label, "Mail");
  assert.equal(resolveWorkspaceIcon("star").label, "Star");
});

test("custom icon IDs are accepted by shape and resolve to a custom reference", () => {
  const id = `custom-${"0123456789abcdef".repeat(2)}`;
  assert.equal(isWorkspaceIconId(id), true);
  assert.deepEqual(resolveWorkspaceIcon(id), { kind: "custom", id });
  for (const malformed of [
    "custom-",
    `custom-${"a".repeat(31)}`,
    `custom-${"a".repeat(33)}`,
    `custom-${"A".repeat(32)}`,
    `custom-${"g".repeat(32)}`
  ]) {
    assert.equal(isWorkspaceIconId(malformed), false, malformed);
    assert.equal(resolveWorkspaceIcon(malformed), FALLBACK_WORKSPACE_ICON, malformed);
  }
});

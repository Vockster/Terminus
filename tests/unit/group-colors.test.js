import test from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_GROUP_COLORS } from "../../src/contracts/workspace-runtime.js";
import { groupColorToken } from "../../src/ui/group-colors.js";

test("every color Firefox can assign resolves to a color of its own", () => {
  const resolved = WORKSPACE_GROUP_COLORS.map(groupColorToken);
  assert.equal(new Set(resolved).size, WORKSPACE_GROUP_COLORS.length);
  for (const value of resolved) {
    assert.match(value, /^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  }
});

// Passing the name through to CSS picks the keyword palette instead of
// Firefox's, which is how `yellow` and `cyan` became unreadable on a light
// surface. No name may resolve to itself.
test("no group color resolves to the CSS keyword of the same name", () => {
  for (const name of WORKSPACE_GROUP_COLORS) {
    assert.doesNotMatch(groupColorToken(name), new RegExp(`\\b${name}\\b`));
  }
});

test("an unknown color falls back rather than leaving the property unset", () => {
  const fallback = groupColorToken("grey");
  assert.equal(groupColorToken("chartreuse"), fallback);
  assert.equal(groupColorToken(undefined), fallback);
  assert.equal(groupColorToken(null), fallback);
});

// Both schemes must stay distinguishable from each other, or the pair is
// carrying only one usable color.
test("each color differs between the light and dark surface", () => {
  for (const name of WORKSPACE_GROUP_COLORS) {
    const [, light, dark] = groupColorToken(name).match(/^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/);
    assert.notEqual(light, dark, `${name} uses one value for both schemes`);
  }
});

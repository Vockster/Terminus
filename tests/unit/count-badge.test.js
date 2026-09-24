import test from "node:test";
import assert from "node:assert/strict";

import {
  COUNT_BADGE_MAXIMUM,
  countBadgeText
} from "../../src/ui/count-badge.js";

test("count text uses one fixed 999+ boundary on every surface", () => {
  assert.equal(COUNT_BADGE_MAXIMUM, 999);
  assert.deepEqual(
    [0, 9, 10, 999, 1000].map(countBadgeText),
    ["0", "9", "10", "999", "999+"]
  );
  for (const count of [-1, 1.5, "1", undefined]) {
    assert.throws(() => countBadgeText(count), TypeError);
  }
});

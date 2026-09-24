import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_TAB_CONTAINER_MOVE_TABS,
  TAB_CONTAINER_MOVE_REASONS,
  containerMoveStatus,
  parseTabContainerMoveOutcome,
  parseTabContainerMoveRequest
} from "../../src/contracts/tab-container-move.js";

const ONE = { logicalTabId: "tab-one", firefoxTabId: 11 };
const TWO = { logicalTabId: "tab-two", firefoxTabId: 12 };

test("container move requests bind unique exact tabs and one logical assignment", () => {
  assert.deepEqual(
    parseTabContainerMoveRequest({ tabs: [ONE, TWO], assignment: { kind: "none" } }),
    { tabs: [ONE, TWO], assignment: { kind: "none" } }
  );
  assert.deepEqual(
    parseTabContainerMoveRequest({
      tabs: [ONE],
      assignment: { kind: "container", refId: "ctr-work" }
    }).assignment,
    { kind: "container", refId: "ctr-work" }
  );
  const many = Array.from({ length: MAX_TAB_CONTAINER_MOVE_TABS }, (_, index) => ({
    logicalTabId: `tab-${index}`,
    firefoxTabId: index
  }));
  assert.equal(
    parseTabContainerMoveRequest({ tabs: many, assignment: { kind: "none" } }).tabs.length,
    MAX_TAB_CONTAINER_MOVE_TABS
  );

  for (const invalid of [
    { tabs: [], assignment: { kind: "none" } },
    { tabs: [...many, { logicalTabId: "tab-extra", firefoxTabId: 99_999 }], assignment: { kind: "none" } },
    { tabs: [ONE, ONE], assignment: { kind: "none" } },
    { tabs: [ONE, { ...TWO, firefoxTabId: 11 }], assignment: { kind: "none" } },
    { tabs: [{ ...ONE, url: "https://example.invalid/" }], assignment: { kind: "none" } },
    { tabs: [{ ...ONE, logicalTabId: "one" }], assignment: { kind: "none" } },
    { tabs: [ONE], assignment: { kind: "container", refId: "firefox-container-1" } },
    { tabs: [ONE], assignment: { kind: "container", cookieStoreId: "firefox-container-1" } },
    { tabs: [ONE], assignment: { kind: "none" }, windowId: 7 }
  ]) {
    assert.throws(() => parseTabContainerMoveRequest(invalid), TypeError);
  }
});

test("container move outcomes keep counts, reasons, and status consistent", () => {
  const partial = {
    status: "partial",
    requestedCount: 5,
    movedCount: 2,
    skippedCount: 2,
    failedCount: 1,
    reasons: [
      { reason: "already-in-container", count: 1 },
      { reason: "close-refused", count: 1 },
      { reason: "browser-failure", count: 1 }
    ]
  };
  assert.deepEqual(parseTabContainerMoveOutcome(partial), partial);
  assert.equal(containerMoveStatus({ requestedCount: 2, movedCount: 2, failedCount: 0 }), "applied");
  assert.equal(containerMoveStatus({ requestedCount: 2, movedCount: 0, failedCount: 0 }), "skipped");
  assert.equal(containerMoveStatus({ requestedCount: 2, movedCount: 0, failedCount: 1 }), "failed");

  for (const invalid of [
    { ...partial, status: "applied" },
    { ...partial, movedCount: 3 },
    { ...partial, reasons: partial.reasons.slice(1) },
    { ...partial, reasons: [...partial.reasons.slice(0, 2), { reason: "stale-request", count: 1 }] },
    { ...partial, reasons: [...partial.reasons, { reason: "browser-failure", count: 1 }] },
    { ...partial, reasons: [{ reason: "unknown", count: 1 }, ...partial.reasons.slice(1)] },
    { ...partial, reasons: [{ reason: "already-in-container", count: 0 }, ...partial.reasons] },
    { ...partial, url: "https://example.invalid/" }
  ]) {
    assert.throws(() => parseTabContainerMoveOutcome(invalid), TypeError);
  }
});

// A tab that stays put is usually ordinary rather than broken, so the sidebar
// must say which reason applied. "1 skipped" on its own reads as a fault.
test("every container move reason has plain-language sidebar text", async () => {
  const main = await readFile(new URL("../../src/sidebar/main.js", import.meta.url), "utf8");
  const table = main.match(/const CONTAINER_MOVE_REASON_TEXT = Object\.freeze\(\{[\s\S]*?\n\}\);/);
  assert.ok(table, "the sidebar keeps a reason-to-text table");
  const described = new Set([...table[0].matchAll(/"([a-z-]+)":/g)].map(([, key]) => key));

  for (const reason of Object.values(TAB_CONTAINER_MOVE_REASONS)) {
    if (reason === TAB_CONTAINER_MOVE_REASONS.CLOSE_REFUSED) {
      // This one carries its own longer note about the copy left behind.
      assert.match(main, /asked to stay open/);
      continue;
    }
    assert.ok(described.has(reason), `${reason} needs sidebar wording`);
  }

  // The reason a user is most likely to hit names the cause, not just a count.
  assert.match(table[0], /cannot reopen in a container/);
  assert.match(main, /Nothing moved to \$\{containerName\}/);
});

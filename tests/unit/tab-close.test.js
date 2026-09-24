import test from "node:test";
import assert from "node:assert/strict";

import {
  TAB_CLOSE_TARGET_KINDS,
  parseTabCloseOutcome,
  parseTabClosePreflight,
  parseTabCloseTarget
} from "../../src/contracts/tab-close.js";
import {
  WORKSPACE_OPERATION_REASONS,
  WORKSPACE_OPERATION_STATUSES
} from "../../src/contracts/workspace-operation.js";

const TARGETS = [
  { kind: TAB_CLOSE_TARGET_KINDS.TAB, logicalTabId: "tab-one", firefoxTabId: 11 },
  { kind: TAB_CLOSE_TARGET_KINDS.BRANCH, logicalTabId: "tab-one", firefoxTabId: 11 },
  { kind: TAB_CLOSE_TARGET_KINDS.GROUP, logicalGroupId: "group-one" },
  { kind: TAB_CLOSE_TARGET_KINDS.WORKSPACE, workspaceId: "ws-default-work" }
];

test("tab close target union accepts only exact kind-specific identities", () => {
  for (const target of TARGETS) {
    assert.deepEqual(parseTabCloseTarget(target), target);
  }
  assert.throws(() => parseTabCloseTarget({ ...TARGETS[0], workspaceId: "work" }), TypeError);
  assert.throws(() => parseTabCloseTarget({ kind: "selection", logicalTabId: "tab-one" }), TypeError);
  assert.throws(
    () => parseTabCloseTarget({ kind: "tab", logicalTabId: "not-logical", firefoxTabId: 1 }),
    TypeError
  );
});

test("tab close preflight binds target, scope, count, and semantic fingerprint", () => {
  const preflight = {
    token: "close-warning-one",
    target: TARGETS[1],
    targetLabel: "Research branch",
    scope: "normal",
    tabCount: 3,
    fingerprint: "close-set-0123456789abcdef"
  };
  assert.deepEqual(parseTabClosePreflight(preflight), preflight);
  assert.throws(() => parseTabClosePreflight({ ...preflight, scope: "all" }), TypeError);
  assert.throws(() => parseTabClosePreflight({ ...preflight, fingerprint: "raw-tab-list" }), TypeError);
  assert.throws(() => parseTabClosePreflight({ ...preflight, urls: [] }), TypeError);
});

test("tab close outcomes validate exact totals and stale semantics", () => {
  const partial = {
    target: TARGETS[2],
    targetLabel: "Tasks",
    scope: "private",
    status: WORKSPACE_OPERATION_STATUSES.PARTIAL,
    requestedCount: 3,
    closedCount: 2,
    remainingCount: 1,
    replacementCount: 1,
    reasons: [
      { reason: WORKSPACE_OPERATION_REASONS.BROWSER_FAILURE, count: 1, retryable: true }
    ]
  };
  assert.deepEqual(parseTabCloseOutcome(partial), partial);
  assert.throws(() => parseTabCloseOutcome({ ...partial, closedCount: 3 }), TypeError);

  const stale = {
    ...partial,
    status: WORKSPACE_OPERATION_STATUSES.SKIPPED,
    closedCount: 0,
    remainingCount: 3,
    replacementCount: 0,
    reasons: [
      { reason: WORKSPACE_OPERATION_REASONS.STALE_REQUEST, count: 3, retryable: true }
    ]
  };
  assert.deepEqual(parseTabCloseOutcome(stale), stale);
  assert.throws(() => parseTabCloseOutcome({ ...stale, reasons: [] }), TypeError);
});

test("a selected-tabs close target binds 2 to 4,096 unique exact tab identities", () => {
  const selection = {
    kind: TAB_CLOSE_TARGET_KINDS.TABS,
    tabs: [
      { logicalTabId: "tab-one", firefoxTabId: 11 },
      { logicalTabId: "tab-two", firefoxTabId: 12 }
    ]
  };
  assert.deepEqual(parseTabCloseTarget(selection), selection);
  const many = Array.from({ length: 4_096 }, (_, index) => ({
    logicalTabId: `tab-${index}`,
    firefoxTabId: index
  }));
  assert.equal(parseTabCloseTarget({ kind: "tabs", tabs: many }).tabs.length, 4_096);

  for (const invalid of [
    { kind: "tabs", tabs: [selection.tabs[0]] },
    { kind: "tabs", tabs: [...many, { logicalTabId: "tab-extra", firefoxTabId: 9_999 }] },
    { kind: "tabs", tabs: [selection.tabs[0], selection.tabs[0]] },
    { kind: "tabs", tabs: [selection.tabs[0], { logicalTabId: "tab-two", firefoxTabId: 11 }] },
    { kind: "tabs", tabs: [selection.tabs[0], { logicalTabId: "tab-two", firefoxTabId: -1 }] },
    { kind: "tabs", tabs: [selection.tabs[0], { logicalTabId: "two", firefoxTabId: 12 }] },
    { kind: "tabs", tabs: [selection.tabs[0], { ...selection.tabs[1], title: "Two" }] },
    { ...selection, logicalTabId: "tab-one" },
    { kind: "tabs", tabs: "tab-one" }
  ]) {
    assert.throws(() => parseTabCloseTarget(invalid), TypeError);
  }
  assert.equal(
    parseTabClosePreflight({
      token: "close-selection",
      target: selection,
      targetLabel: "Selected tabs",
      scope: "normal",
      tabCount: 5,
      fingerprint: "close-set-0123456789abcdef"
    }).target.kind,
    "tabs"
  );
});

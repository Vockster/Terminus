import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_CONVERGENCE_CHECKS,
  WORKSPACE_NOTICE_SCHEMA_VERSION,
  WORKSPACE_NOTICE_SEVERITIES,
  WORKSPACE_OPERATION_REASONS,
  WORKSPACE_OPERATION_STATUSES,
  parseWorkspaceNotice,
  parseWorkspaceOperationOutcome
} from "../../src/contracts/workspace-operation.js";
import { WORKSPACE_PENDING_OPERATION_KINDS } from "../../src/contracts/workspace-runtime.js";

test("workspace operation outcomes validate exact sanitized counts", () => {
  const source = {
    operation: WORKSPACE_PENDING_OPERATION_KINDS.ACTIVATE,
    status: WORKSPACE_OPERATION_STATUSES.PARTIAL,
    requestedCount: 3,
    appliedCount: 1,
    skipped: [
      { reason: WORKSPACE_OPERATION_REASONS.SHARING, count: 1, retryable: true }
    ],
    failedCount: 1,
    observed: {
      tabCount: 3,
      hiddenCount: 1,
      visibleCount: 2,
      pinnedCount: 0,
      groupedTabCount: 0
    }
  };

  const parsed = parseWorkspaceOperationOutcome(source);
  assert.deepEqual(parsed, source);
  assert.notStrictEqual(parsed.skipped[0], source.skipped[0]);
  assert.notStrictEqual(parsed.observed, source.observed);
});

test("workspace notices reject browsing data, duplicates, and inconsistent retryability", () => {
  const source = {
    schemaVersion: 1,
    id: "notice-alpha",
    operation: WORKSPACE_PENDING_OPERATION_KINDS.MOVE_GROUP,
    severity: WORKSPACE_NOTICE_SEVERITIES.WARNING,
    retryable: true,
    reasons: [
      { reason: WORKSPACE_OPERATION_REASONS.INCOMPLETE, count: 2, retryable: true }
    ]
  };
  assert.deepEqual(parseWorkspaceNotice(source), {
    ...source,
    schemaVersion: WORKSPACE_NOTICE_SCHEMA_VERSION,
    convergenceCheck: null
  });
  assert.equal(parseWorkspaceNotice(null), null);

  assert.throws(() => parseWorkspaceNotice({ ...source, title: "private" }), TypeError);
  assert.throws(
    () => parseWorkspaceNotice({ ...source, retryable: false }),
    TypeError
  );
  assert.throws(
    () => parseWorkspaceNotice({ ...source, reasons: [...source.reasons, source.reasons[0]] }),
    TypeError
  );
});

test("schema-2 notices carry one known convergence check or none", () => {
  const source = {
    schemaVersion: WORKSPACE_NOTICE_SCHEMA_VERSION,
    id: "notice-beta",
    operation: WORKSPACE_PENDING_OPERATION_KINDS.ACTIVATE,
    severity: WORKSPACE_NOTICE_SEVERITIES.WARNING,
    retryable: true,
    reasons: [
      { reason: WORKSPACE_OPERATION_REASONS.INCOMPLETE, count: 1, retryable: true }
    ],
    convergenceCheck: WORKSPACE_CONVERGENCE_CHECKS.TAB_ORDER
  };
  assert.deepEqual(parseWorkspaceNotice(source), source);
  assert.deepEqual(
    parseWorkspaceNotice({ ...source, convergenceCheck: null }),
    { ...source, convergenceCheck: null }
  );
  for (const invalid of ["tab order", "https://sentinel.invalid/", 3, undefined]) {
    assert.throws(() => parseWorkspaceNotice({ ...source, convergenceCheck: invalid }), TypeError);
  }
  const { convergenceCheck: _omitted, ...withoutCheck } = source;
  assert.throws(() => parseWorkspaceNotice(withoutCheck), TypeError);
  assert.throws(() => parseWorkspaceNotice({ ...source, schemaVersion: 1 }), TypeError);
  assert.throws(() => parseWorkspaceNotice({ ...source, schemaVersion: 3 }), TypeError);
});

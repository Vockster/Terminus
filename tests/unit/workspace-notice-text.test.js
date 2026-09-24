import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  WORKSPACE_CONVERGENCE_CHECKS,
  WORKSPACE_OPERATION_REASONS
} from "../../src/contracts/workspace-operation.js";
import { workspaceNoticeText } from "../../src/sidebar/workspace-notice-text.js";

function notice(overrides = {}) {
  return {
    schemaVersion: 2,
    id: "notice-text",
    operation: "activate-workspace",
    severity: "warning",
    retryable: true,
    reasons: [{ reason: WORKSPACE_OPERATION_REASONS.INCOMPLETE, count: 1, retryable: true }],
    convergenceCheck: null,
    ...overrides
  };
}

test("an incomplete-convergence notice names the check that failed", () => {
  assert.equal(
    workspaceNoticeText(notice({ convergenceCheck: WORKSPACE_CONVERGENCE_CHECKS.TAB_ORDER })),
    "Workspace switch: 1 the browser state has not converged yet (tab order)."
  );
  assert.equal(
    workspaceNoticeText(notice()),
    "Workspace switch: 1 the browser state has not converged yet."
  );
  assert.equal(
    workspaceNoticeText(notice({
      convergenceCheck: WORKSPACE_CONVERGENCE_CHECKS.SUCCESSOR_CHAIN,
      reasons: [
        { reason: WORKSPACE_OPERATION_REASONS.ACTIVE, count: 2, retryable: true },
        { reason: WORKSPACE_OPERATION_REASONS.INCOMPLETE, count: 1, retryable: true }
      ]
    })),
    "Workspace switch: 2 active tabs are still protected; 1 the browser state has not converged yet (close order)."
  );
});

test("every convergence check has a plain-language label", async () => {
  const source = await readFile(new URL("../../src/sidebar/workspace-notice-text.js", import.meta.url), "utf8");
  for (const key of Object.keys(WORKSPACE_CONVERGENCE_CHECKS)) {
    assert.match(source, new RegExp(`\\[WORKSPACE_CONVERGENCE_CHECKS\\.${key}\\]: "`));
    const text = workspaceNoticeText(notice({ convergenceCheck: WORKSPACE_CONVERGENCE_CHECKS[key] }));
    assert.match(text, /\(.+\)\.$/);
    assert.equal(text.includes("-"), false, `${key} label leaks its identifier`);
  }
});

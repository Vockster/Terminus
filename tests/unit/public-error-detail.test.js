import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_ERROR_MESSAGE_MAX_LENGTH,
  errorDetail,
  publicMessageWithDetail
} from "../../src/contracts/public-error-detail.js";
import { createDefaultSettingsState } from "../../src/contracts/settings-state.js";
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_ERROR_MESSAGES,
  SNAPSHOT_KINDS,
  SnapshotError,
  createSnapshotRecord,
  finalizeSettingsBackup,
  parseBackupText,
  serializeBackup
} from "../../src/contracts/snapshots.js";
import { snapshotFailure } from "../../src/contracts/snapshot-messages.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

const SENTINEL_URL = "https://sentinel.invalid/secret";
const SENTINEL_TITLE = "SENTINEL-TITLE";

test("public messages append a trimmed, bounded detail only when one exists", () => {
  assert.equal(errorDetail({ detail: "  Reason.  " }), "Reason.");
  assert.equal(errorDetail({ detail: "   " }), null);
  assert.equal(errorDetail({}), null);
  assert.equal(errorDetail(undefined), null);
  assert.equal(publicMessageWithDetail("Invalid.", null), "Invalid.");
  assert.equal(publicMessageWithDetail("Invalid.", "Reason."), "Invalid. Reason.");
  const long = publicMessageWithDetail("Invalid.", "x".repeat(1000));
  assert.equal(long.length, PUBLIC_ERROR_MESSAGE_MAX_LENGTH);
  assert.ok(long.endsWith("…"));
});

test("backup failure envelopes show bounded validation reasons only", () => {
  const backupInvalid = snapshotFailure(
    new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_BACKUP, undefined, { detail: "Reason." })
  );
  assert.equal(backupInvalid.error.message, `${SNAPSHOT_ERROR_MESSAGES.INVALID_BACKUP} Reason.`);
  assert.equal(
    snapshotFailure(new SnapshotError(SNAPSHOT_ERROR_CODES.NOT_FOUND, undefined, { detail: "hidden" })).error.message,
    SNAPSHOT_ERROR_MESSAGES.NOT_FOUND
  );

});

test("validation factories record the specific reason as the error detail", async () => {
  await assert.rejects(parseBackupText("{x"), (error) =>
    error.detail === "Backup content is not valid JSON." &&
    snapshotFailure(error).error.message ===
      `${SNAPSHOT_ERROR_MESSAGES.INVALID_BACKUP} Backup content is not valid JSON.`
  );
});

function stringLeafPaths(value, path = []) {
  if (typeof value === "string") {
    return [path];
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => stringLeafPaths(child, [...path, key]));
  }
  return [];
}

function withLeaf(value, path, replacement) {
  const copy = structuredClone(value);
  let target = copy;
  for (const key of path.slice(0, -1)) {
    target = target[key];
  }
  target[path.at(-1)] = replacement;
  return copy;
}

function assertNoSentinel(message, label) {
  assert.equal(
    message.includes("sentinel.invalid") || message.includes(SENTINEL_TITLE),
    false,
    `${label} leaked stored text: ${message}`
  );
}

async function collectRejectedMessages(document, parse, envelope) {
  const messages = [];
  for (const path of stringLeafPaths(document)) {
    for (const sentinel of [SENTINEL_URL, SENTINEL_TITLE]) {
      try {
        await parse(withLeaf(document, path, sentinel));
      } catch (error) {
        messages.push([path.join("."), envelope(error).error.message]);
      }
    }
  }
  return messages;
}

test("public error reasons never repeat stored or imported text", async () => {
  const settings = createDefaultSettingsState();

  const backup = await finalizeSettingsBackup({ createdAt: "2026-09-13T12:00:00.000Z", settings });
  const backupMessages = await collectRejectedMessages(
    backup,
    (value) => parseBackupText(serializeBackup(value)),
    snapshotFailure
  );

  const snapshot = await createSnapshotRecord({
    id: "snapshot-sentinel",
    kind: SNAPSHOT_KINDS.MANUAL,
    createdAt: "2026-09-13T12:00:00.000Z",
    payload: createSnapshotPayloadFixture()
  });
  const snapshotMessages = await collectRejectedMessages(
    snapshot,
    (value) => parseBackupText(serializeBackup(value)),
    snapshotFailure
  );

  for (const [label, messages] of Object.entries({
    backupMessages,
    snapshotMessages
  })) {
    assert.ok(messages.length > 0, `${label} exercised no rejection`);
    for (const [path, message] of messages) {
      assertNoSentinel(message, `${label} ${path}`);
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIVATE_DOCUMENT_SCHEMA_VERSION,
  PRIVATE_RECOVERY_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_KINDS,
  PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE,
  createPrivateDocument,
  createPrivateSnapshotRecord,
  parsePrivateDocumentText,
  privateDocumentSummary,
  serializePrivateDocument,
  verifyPrivateDocument
} from "../../src/contracts/private-snapshots.js";
import {
  SNAPSHOT_ERROR_CODES,
  createSnapshotRecord,
  parseBackupText,
  parsePrivateSnapshotPayload,
  toPrivateSnapshotPayload
} from "../../src/contracts/snapshots.js";
import { createSnapshotPayloadFixture } from "../helpers/snapshot-fixture.js";

test("private snapshot and recovery documents are distinct, strict, and digest-bound", async () => {
  const payload = createSnapshotPayloadFixture({ containerAware: false });
  const snapshot = await createPrivateDocument({
    documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    createdAt: "2026-09-06T20:00:00.000Z",
    payload
  });
  assert.equal(snapshot.schemaVersion, PRIVATE_DOCUMENT_SCHEMA_VERSION);
  assert.deepEqual(privateDocumentSummary(snapshot), {
    documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    id: null,
    kind: PRIVATE_SNAPSHOT_KINDS.MANUAL,
    private: true,
    createdAt: "2026-09-06T20:00:00.000Z",
    workspaceCount: 1,
    windowCount: 1,
    tabCount: 3,
    byteLength: new TextEncoder().encode(serializePrivateDocument(snapshot)).byteLength,
    payloadDigest: snapshot.payloadDigest
  });
  assert.deepEqual(await parsePrivateDocumentText(serializePrivateDocument(snapshot)), snapshot);

  const stored = await createPrivateSnapshotRecord({
    id: "private-snapshot-one",
    kind: PRIVATE_SNAPSHOT_KINDS.AUTOMATIC,
    createdAt: "2026-09-06T20:00:00.000Z",
    payload
  });
  assert.equal(stored.documentType, PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE);
  assert.equal(privateDocumentSummary(stored).private, true);
  assert.equal(privateDocumentSummary(stored).kind, PRIVATE_SNAPSHOT_KINDS.AUTOMATIC);
  assert.deepEqual(await parsePrivateDocumentText(serializePrivateDocument(stored)), stored);

  const recovery = await createPrivateDocument({
    documentType: PRIVATE_RECOVERY_DOCUMENT_TYPE,
    generation: 4,
    createdAt: "2026-09-06T20:00:00.000Z",
    payload
  });
  assert.equal((await verifyPrivateDocument(recovery, PRIVATE_RECOVERY_DOCUMENT_TYPE)).generation, 4);
  await assert.rejects(
    parsePrivateDocumentText(serializePrivateDocument(recovery)),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP
  );

  const tampered = structuredClone(snapshot);
  tampered.payload.windows[0].workspaceLayouts[0].tabs[0].url = "https://tampered.invalid/";
  await assert.rejects(
    verifyPrivateDocument(tampered),
    (error) => error.code === SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED
  );
});

test("future private documents fail closed", async () => {
  const document = await createPrivateDocument({
    documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    createdAt: "2026-09-06T20:00:00.000Z",
    payload: createSnapshotPayloadFixture({ containerAware: false })
  });
  document.schemaVersion += 1;
  await assert.rejects(
    verifyPrivateDocument(document),
    (error) => error.code === SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
  );
});

// An ordinary snapshot can be opened in a private session. Private scope has no
// containers, so the copy is adopted rather than refused, and the crossing runs
// one way only.
test("an ordinary snapshot is adopted into private scope without its containers", async () => {
  const payload = createSnapshotPayloadFixture();
  payload.workspaceState.workspaces[0].defaultContainerRef = "ctr-work";
  payload.windows[0].workspaceLayouts[0].tabs[0].container = {
    kind: "container",
    refId: "ctr-work"
  };
  payload.containerCatalog = [{
    refId: "ctr-work",
    descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" }
  }];

  // The normal payload is refused as it stands: private snapshots carry no
  // container defaults, which is the reason the adoption exists.
  assert.throws(() => parsePrivateSnapshotPayload(payload));

  const adopted = toPrivateSnapshotPayload(payload);
  assert.equal("containerCatalog" in adopted, false);
  assert.equal(adopted.workspaceState.workspaces[0].defaultContainerRef, null);
  for (const layout of adopted.windows[0].workspaceLayouts) {
    for (const tab of layout.tabs) {
      assert.equal("container" in tab, false);
    }
  }
  // Everything that is not a container survives the crossing.
  const source = payload.windows[0].workspaceLayouts[0];
  const carried = adopted.windows[0].workspaceLayouts[0];
  assert.deepEqual(carried.tabs.map(({ id }) => id), source.tabs.map(({ id }) => id));
  assert.deepEqual(carried.pinnedTabIds, source.pinnedTabIds);
  assert.deepEqual(carried.groups, source.groups);
  assert.deepEqual(carried.tree, source.tree);
  assert.deepEqual(carried.splitViews, source.splitViews);
  assert.deepEqual(adopted.windows[0].geometry, payload.windows[0].geometry);
  // The adopted payload satisfies the parser it was converted for.
  assert.deepEqual(parsePrivateSnapshotPayload(adopted), adopted);
});

test("the private reader accepts an ordinary snapshot file and the normal reader never accepts a private one", async () => {
  const record = await createSnapshotRecord({
    id: "snapshot-ordinary",
    kind: "manual",
    createdAt: "2026-09-20T10:00:00.000Z",
    payload: createSnapshotPayloadFixture()
  });

  const adopted = await parsePrivateDocumentText(JSON.stringify(record));
  assert.equal(adopted.documentType, PRIVATE_SNAPSHOT_DOCUMENT_TYPE);
  assert.equal(adopted.createdAt, record.createdAt);
  // It lands as a manual private snapshot, whatever kind it arrived as.
  assert.equal(privateDocumentSummary(adopted).kind, PRIVATE_SNAPSHOT_KINDS.MANUAL);
  assert.equal(privateDocumentSummary(adopted).private, true);
  // Verified end to end: the adopted document carries its own payload digest.
  assert.deepEqual(await verifyPrivateDocument(adopted), adopted);

  // One way. The normal side reads files through parseBackupText, which knows
  // only the two ordinary document types, so no private record can re-enter
  // durable normal history.
  for (const documentType of [
    PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
    PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE,
    PRIVATE_RECOVERY_DOCUMENT_TYPE
  ]) {
    await assert.rejects(
      parseBackupText(JSON.stringify({ ...record, documentType })),
      (error) => error.code === SNAPSHOT_ERROR_CODES.INVALID_BACKUP,
      `${documentType} must not be readable as an ordinary backup`
    );
  }
});

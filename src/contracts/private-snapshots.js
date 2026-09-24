import {
  MAX_BACKUP_BYTES,
  SNAPSHOT_DOCUMENT_TYPE,
  SNAPSHOT_ERROR_CODES,
  SnapshotError,
  digestPrivateSnapshotPayload,
  parsePrivateSnapshotPayload,
  toPrivateSnapshotPayload,
  verifySnapshotRecord
} from "./snapshots.js";

export const PRIVATE_RECOVERY_DOCUMENT_TYPE = "sidebars.private-recovery";
export const PRIVATE_SNAPSHOT_DOCUMENT_TYPE = "sidebars.private-snapshot";
export const PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE = "sidebars.private-snapshot-record";
export const PRIVATE_DOCUMENT_SCHEMA_VERSION = 1;
export const PRIVATE_RECOVERY_STORAGE_KEY = "privateRecovery";
export const PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY = "privateRecoveryQuarantine";
export const PRIVATE_RESTORE_JOURNAL_STORAGE_KEY = "privateRestoreJournal";
export const PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY = "privateLastRestoreReport";
export const PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX = "privateSnapshotRecord:";

export const PRIVATE_SNAPSHOT_KINDS = Object.freeze({
  AUTOMATIC: "automatic",
  MANUAL: "manual"
});

const DOCUMENT_TYPES = new Set([
  PRIVATE_RECOVERY_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
  PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PRIVATE_SNAPSHOT_ID_PATTERN = /^private-snapshot-[a-z0-9][a-z0-9-]{0,127}$/;

function invalidBackup(message = "The private snapshot is invalid.") {
  return new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_BACKUP, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseCreatedAt(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw invalidBackup("The private snapshot creation time is invalid.");
  }
  return value;
}

export function parsePrivateDocument(value) {
  const recovery = value?.documentType === PRIVATE_RECOVERY_DOCUMENT_TYPE;
  const storedRecord = value?.documentType === PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE;
  const keys = recovery
    ? ["documentType", "schemaVersion", "generation", "createdAt", "payloadDigest", "payload"]
    : storedRecord
      ? ["documentType", "schemaVersion", "id", "kind", "createdAt", "payloadDigest", "payload"]
      : ["documentType", "schemaVersion", "createdAt", "payloadDigest", "payload"];
  if (!isRecord(value) || !hasExactKeys(value, keys) || !DOCUMENT_TYPES.has(value.documentType)) {
    throw invalidBackup();
  }
  if (value.schemaVersion > PRIVATE_DOCUMENT_SCHEMA_VERSION) {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION);
  }
  if (value.schemaVersion !== PRIVATE_DOCUMENT_SCHEMA_VERSION) {
    throw invalidBackup("The private snapshot version is invalid.");
  }
  if (recovery && (!Number.isSafeInteger(value.generation) || value.generation < 1)) {
    throw invalidBackup("The private recovery generation is invalid.");
  }
  if (
    storedRecord &&
    (
      typeof value.id !== "string" ||
      !PRIVATE_SNAPSHOT_ID_PATTERN.test(value.id) ||
      !Object.values(PRIVATE_SNAPSHOT_KINDS).includes(value.kind)
    )
  ) {
    throw invalidBackup("The stored private snapshot identity is invalid.");
  }
  if (typeof value.payloadDigest !== "string" || !DIGEST_PATTERN.test(value.payloadDigest)) {
    throw invalidBackup("The private snapshot digest is invalid.");
  }
  return {
    documentType: value.documentType,
    schemaVersion: PRIVATE_DOCUMENT_SCHEMA_VERSION,
    ...(recovery ? { generation: value.generation } : {}),
    ...(storedRecord ? { id: value.id, kind: value.kind } : {}),
    createdAt: parseCreatedAt(value.createdAt),
    payloadDigest: value.payloadDigest,
    payload: parsePrivateSnapshotPayload(value.payload)
  };
}

export async function createPrivateDocument({ documentType, generation, createdAt, payload }) {
  if (![PRIVATE_RECOVERY_DOCUMENT_TYPE, PRIVATE_SNAPSHOT_DOCUMENT_TYPE].includes(documentType)) {
    throw invalidBackup("The private snapshot type is invalid.");
  }
  const parsedPayload = parsePrivateSnapshotPayload(payload);
  return parsePrivateDocument({
    documentType,
    schemaVersion: PRIVATE_DOCUMENT_SCHEMA_VERSION,
    ...(documentType === PRIVATE_RECOVERY_DOCUMENT_TYPE ? { generation } : {}),
    createdAt,
    payloadDigest: await digestPrivateSnapshotPayload(parsedPayload),
    payload: parsedPayload
  });
}

export async function createPrivateSnapshotRecord({ id, kind, createdAt, payload }) {
  const parsedPayload = parsePrivateSnapshotPayload(payload);
  return parsePrivateDocument({
    documentType: PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE,
    schemaVersion: PRIVATE_DOCUMENT_SCHEMA_VERSION,
    id,
    kind,
    createdAt,
    payloadDigest: await digestPrivateSnapshotPayload(parsedPayload),
    payload: parsedPayload
  });
}

export async function verifyPrivateDocument(value, expectedType = null) {
  const document = parsePrivateDocument(value);
  if (expectedType && document.documentType !== expectedType) {
    throw invalidBackup("The selected file is not the requested private backup type.");
  }
  if ((await digestPrivateSnapshotPayload(document.payload)) !== document.payloadDigest) {
    throw new SnapshotError(SNAPSHOT_ERROR_CODES.INTEGRITY_FAILED);
  }
  return document;
}

export async function parsePrivateDocumentText(text) {
  if (typeof text !== "string") {
    throw invalidBackup("Private snapshot content must be text.");
  }
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength < 2 || byteLength > MAX_BACKUP_BYTES) {
    throw invalidBackup(`Private snapshot content must not exceed ${MAX_BACKUP_BYTES} bytes.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalidBackup("Private snapshot content is not valid JSON.");
  }
  // An ordinary snapshot is adopted into private scope instead of refused, so a
  // normal layout can be opened in a private session. This is the only crossing
  // and it runs one way: parseBackupText, which reads files on the normal side,
  // accepts no private document type, so nothing private becomes durable normal
  // history. The adopted copy is stripped of containers and, like every private
  // record, is discarded when the session ends.
  if (value?.documentType === SNAPSHOT_DOCUMENT_TYPE) {
    const record = await verifySnapshotRecord(value);
    return createPrivateDocument({
      documentType: PRIVATE_SNAPSHOT_DOCUMENT_TYPE,
      createdAt: record.createdAt,
      payload: toPrivateSnapshotPayload(record.payload)
    });
  }
  const document = await verifyPrivateDocument(value);
  if (![PRIVATE_SNAPSHOT_DOCUMENT_TYPE, PRIVATE_SNAPSHOT_RECORD_DOCUMENT_TYPE].includes(document.documentType)) {
    throw invalidBackup("The selected file is not a private snapshot or an ordinary Terminus snapshot.");
  }
  return document;
}

export function serializePrivateDocument(value) {
  const document = parsePrivateDocument(value);
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw invalidBackup(`Private snapshot content must not exceed ${MAX_BACKUP_BYTES} bytes.`);
  }
  return text;
}

export function privateDocumentSummary(value) {
  const document = parsePrivateDocument(value);
  const byteLength = new TextEncoder().encode(serializePrivateDocument(document)).byteLength;
  return {
    documentType: document.documentType,
    id: document.id ?? null,
    kind: document.kind ?? PRIVATE_SNAPSHOT_KINDS.MANUAL,
    private: true,
    createdAt: document.createdAt,
    workspaceCount: document.payload.workspaceState.workspaces.length,
    windowCount: document.payload.windows.length,
    tabCount: document.payload.windows.reduce(
      (total, window) => total + window.workspaceLayouts.reduce(
        (count, layout) => count + layout.tabs.length,
        0
      ),
      0
    ),
    byteLength,
    payloadDigest: document.payloadDigest
  };
}

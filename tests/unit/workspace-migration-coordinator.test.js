import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WorkspaceStateError,
  migrateWorkspaceStateV1ToV2,
  parseWorkspaceStateV1,
  parseWorkspaceStateV2
} from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { StorageMigrationCoordinator } from "../../src/core/storage-migration-coordinator.js";

function legacyState() {
  const current = createDefaultWorkspaceState();
  return {
    schemaVersion: 1,
    workspaces: current.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace),
    rail: current.rail
  };
}

function journalFor(source = legacyState()) {
  return {
    schemaVersion: 1,
    sourceVersion: 1,
    targetVersion: 2,
    source: parseWorkspaceStateV1(source),
    candidate: migrateWorkspaceStateV1ToV2(source)
  };
}

function createStorage({ live = legacyState(), journal, failAt } = {}) {
  const calls = [];
  const counts = new Map();
  let storedLive = structuredClone(live);
  let storedJournal = journal === undefined ? undefined : structuredClone(journal);

  function enter(name) {
    calls.push(name);
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    if (failAt === `${name}:${count}`) {
      throw new Error(`synthetic ${failAt}`);
    }
  }

  return {
    calls,
    snapshot() {
      return {
        live: structuredClone(storedLive),
        journal: storedJournal === undefined ? undefined : structuredClone(storedJournal)
      };
    },
    storage: {
      async read() {
        enter("read");
        return structuredClone(storedLive);
      },
      async write(value) {
        enter("write");
        storedLive = structuredClone(value);
      },
      async readMigration() {
        enter("readMigration");
        return storedJournal === undefined ? undefined : structuredClone(storedJournal);
      },
      async writeMigration(value) {
        enter("writeMigration");
        storedJournal = structuredClone(value);
      },
      async removeMigration() {
        enter("removeMigration");
        storedJournal = undefined;
      }
    }
  };
}

function createCoordinator(storage) {
  return new StorageMigrationCoordinator({
    storage,
    sourceVersion: 1,
    targetVersion: 2,
    parseSource: parseWorkspaceStateV1,
    parseTarget: parseWorkspaceStateV2,
    migrateSource: migrateWorkspaceStateV1ToV2,
    createInvalidError: (reason) => new WorkspaceStateError(
      WORKSPACE_STATE_ERROR_CODES.INVALID_STATE,
      `${WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.INVALID_STATE]} ${reason}`
    ),
    createStorageError: (cause) => new WorkspaceStateError(
      WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE,
      WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE],
      { cause }
    ),
    isDomainError: (error) => error instanceof WorkspaceStateError
  });
}

test("migration journals, writes, verifies, and clears a v1 document", async () => {
  const memory = createStorage();
  const migrated = await createCoordinator(memory.storage).load();

  assert.deepEqual(migrated, migrateWorkspaceStateV1ToV2(legacyState()));
  assert.deepEqual(memory.calls, [
    "readMigration",
    "read",
    "writeMigration",
    "write",
    "read",
    "removeMigration"
  ]);
  assert.equal(memory.snapshot().journal, undefined);
  assert.deepEqual(memory.snapshot().live, migrated);
});

test("restart with the journal source retries the candidate", async () => {
  const source = legacyState();
  const memory = createStorage({ live: source, journal: journalFor(source) });

  const migrated = await createCoordinator(memory.storage).load();
  assert.deepEqual(migrated, migrateWorkspaceStateV1ToV2(source));
  assert.deepEqual(memory.calls, ["readMigration", "read", "write", "read", "removeMigration"]);
  assert.equal(memory.snapshot().journal, undefined);
});

test("restart with the journal candidate verifies and clears without rewriting", async () => {
  const journal = journalFor();
  const memory = createStorage({ live: journal.candidate, journal });

  assert.deepEqual(await createCoordinator(memory.storage).load(), journal.candidate);
  assert.deepEqual(memory.calls, ["readMigration", "read", "removeMigration"]);
  assert.equal(memory.snapshot().journal, undefined);
});

test("conflicting live data and malformed journals reject without mutation", async () => {
  const conflict = journalFor();
  const conflictingLive = structuredClone(conflict.candidate);
  conflictingLive.workspaces[0].name = "Conflicting name";
  const conflictMemory = createStorage({ live: conflictingLive, journal: conflict });
  const conflictBefore = conflictMemory.snapshot();

  await assert.rejects(
    createCoordinator(conflictMemory.storage).load(),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.deepEqual(conflictMemory.snapshot(), conflictBefore);
  assert.deepEqual(conflictMemory.calls, ["readMigration", "read"]);

  const malformedMemory = createStorage({
    journal: { ...journalFor(), unexpected: true }
  });
  const malformedBefore = malformedMemory.snapshot();
  await assert.rejects(
    createCoordinator(malformedMemory.storage).load(),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.deepEqual(malformedMemory.snapshot(), malformedBefore);
  assert.deepEqual(malformedMemory.calls, ["readMigration"]);
});

test("every fresh-migration storage failure remains recoverable", async () => {
  const boundaries = [
    "readMigration:1",
    "read:1",
    "writeMigration:1",
    "write:1",
    "read:2",
    "removeMigration:1"
  ];

  for (const failAt of boundaries) {
    const memory = createStorage({ failAt });
    await assert.rejects(
      createCoordinator(memory.storage).load(),
      (error) => error.code === WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE,
      failAt
    );

    const snapshot = memory.snapshot();
    if (["write:1", "read:2", "removeMigration:1"].includes(failAt)) {
      assert.notEqual(snapshot.journal, undefined, failAt);
    }
    if (["read:2", "removeMigration:1"].includes(failAt)) {
      assert.equal(snapshot.live.schemaVersion, 2, failAt);
    }
  }
});

test("verification mismatch keeps the journal and rejects as recoverable invalid state", async () => {
  const memory = createStorage();
  const originalRead = memory.storage.read;
  let readCount = 0;
  memory.storage.read = async () => {
    readCount += 1;
    const value = await originalRead();
    if (readCount === 2) {
      value.workspaces[0].name = "Changed after write";
    }
    return value;
  };

  await assert.rejects(
    createCoordinator(memory.storage).load(),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_STATE
  );
  assert.notEqual(memory.snapshot().journal, undefined);
  assert.ok(!memory.calls.includes("removeMigration"));
});

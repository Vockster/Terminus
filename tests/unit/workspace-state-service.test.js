import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_SCHEMA_VERSION,
  WorkspaceStateError,
  migrateWorkspaceStateV1ToV2,
  parseWorkspaceStateV1
} from "../../src/contracts/workspace-state.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";
import { WorkspaceStateService } from "../../src/core/workspace-state-service.js";

function createLegacyDefaultState() {
  const current = createDefaultWorkspaceState();
  return {
    schemaVersion: 1,
    workspaces: current.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace),
    rail: current.rail
  };
}

function createMemoryStorage(initialValue, initialJournal) {
  let value = initialValue;
  let journal = initialJournal;
  const calls = { read: 0, write: 0, readMigration: 0, writeMigration: 0, removeMigration: 0 };

  return {
    calls,
    value: () => value,
    journal: () => journal,
    storage: {
      async read() {
        calls.read += 1;
        return value;
      },
      async write(nextValue) {
        calls.write += 1;
        value = nextValue;
      },
      async readMigration() {
        calls.readMigration += 1;
        return journal;
      },
      async writeMigration(nextJournal) {
        calls.writeMigration += 1;
        journal = nextJournal;
      },
      async removeMigration() {
        calls.removeMigration += 1;
        journal = undefined;
      }
    }
  };
}

test("missing state is initialized once and later reads do not rewrite it", async () => {
  const memory = createMemoryStorage(undefined);
  const service = new WorkspaceStateService(memory.storage);

  const initialized = await service.getOrInitialize();
  const loadedAgain = await service.getOrInitialize();

  assert.deepEqual(initialized, createDefaultWorkspaceState());
  assert.deepEqual(loadedAgain, initialized);
  assert.deepEqual(memory.calls, {
    read: 2,
    write: 1,
    readMigration: 2,
    writeMigration: 0,
    removeMigration: 0
  });
});

test("valid stored current state is returned without a write", async () => {
  const storedState = createDefaultWorkspaceState();
  const memory = createMemoryStorage(storedState);
  const service = new WorkspaceStateService(memory.storage);

  const loaded = await service.getOrInitialize();
  loaded.workspaces[0].name = "Changed result";

  assert.equal(storedState.workspaces[0].name, "Work");
  assert.equal(memory.calls.write, 0);
  assert.equal(memory.calls.writeMigration, 0);
});

test("workspace names may duplicate workspace and container labels", async () => {
  const memory = createMemoryStorage(createDefaultWorkspaceState());
  const service = new WorkspaceStateService(memory.storage, {
    idGenerator: () => "unique",
    containerNameProvider: async () => {
      throw new Error("Duplicate-name checks must not query containers.");
    }
  });

  const created = await service.createWorkspace({
    name: " Work ",
    icon: "briefcase",
    color: "#123456"
  });
  assert.equal(created.workspaces.filter(({ name }) => name === "Work").length, 2);
  const updated = await service.updateWorkspace("ws-default-personal", { name: "Work" });
  assert.equal(updated.workspaces.filter(({ name }) => name === "Work").length, 3);
});

test("deleted container references reset every affected workspace to No Container", async () => {
  const state = createDefaultWorkspaceState();
  state.workspaces[0].defaultContainerRef = "ctr-work";
  state.workspaces[1].defaultContainerRef = "ctr-work-alias";
  state.workspaces[2].defaultContainerRef = "ctr-personal";
  const memory = createMemoryStorage(state);
  const service = new WorkspaceStateService(memory.storage);

  const updated = await service.clearDefaultContainerRefs(["ctr-work", "ctr-work-alias"]);

  assert.deepEqual(
    updated.workspaces.map(({ defaultContainerRef }) => defaultContainerRef),
    [null, null, "ctr-personal"]
  );
  assert.equal(memory.calls.write, 1);
});

test("reset replaces customized definitions with the exact three-workspace default and clears migration state", async () => {
  const customized = createDefaultWorkspaceState();
  customized.workspaces[0].name = "Office";
  customized.workspaces.push({
    id: "ws-custom-project",
    name: "Project",
    icon: "folder",
    color: "#123456",
    defaultContainerRef: null
  });
  customized.rail.push(
    { kind: "divider", id: "divider-custom", size: 24 },
    { kind: "workspace", workspaceId: "ws-custom-project" }
  );
  const memory = createMemoryStorage(customized, { interrupted: true });
  const service = new WorkspaceStateService(memory.storage);

  const reset = await service.reset();

  assert.deepEqual(reset, createDefaultWorkspaceState());
  assert.deepEqual(memory.value(), createDefaultWorkspaceState());
  assert.equal(memory.journal(), undefined);
  assert.deepEqual(memory.calls, {
    read: 0,
    write: 1,
    readMigration: 0,
    writeMigration: 0,
    removeMigration: 1
  });
});

test("stored v1 state migrates through every edge to a verified v5 document", async () => {
  const memory = createMemoryStorage(createLegacyDefaultState());
  const service = new WorkspaceStateService(memory.storage);

  const loaded = await service.getOrInitialize();
  assert.equal(loaded.schemaVersion, 5);
  assert.deepEqual(
    loaded.workspaces.map(({ id }) => id),
    ["ws-default-work", "ws-default-personal", "ws-default-research"]
  );
  assert.equal(memory.value().schemaVersion, 5);
  assert.equal(memory.journal(), undefined);
  assert.deepEqual(memory.calls, {
    read: 5,
    write: 4,
    readMigration: 1,
    writeMigration: 4,
    removeMigration: 4
  });
});

test("stored v2 spacers migrate with global-size inheritance", async () => {
  const current = createDefaultWorkspaceState();
  const memory = createMemoryStorage({
    schemaVersion: 2,
    workspaces: current.workspaces.map(({ defaultContainerRef: _default, ...workspace }) => workspace),
    rail: [
      current.rail[0],
      { kind: "spacer", id: "spacer-primary" },
      ...current.rail.slice(1)
    ]
  });
  const service = new WorkspaceStateService(memory.storage);

  const loaded = await service.getOrInitialize();
  assert.deepEqual(loaded.rail[1], {
    kind: "divider",
    id: "spacer-primary",
    size: null
  });
  assert.equal(memory.value().schemaVersion, 5);
  assert.equal(memory.journal(), undefined);
});

test("an interrupted legacy v1-to-v2 journal resumes before later migrations", async () => {
  const source = createLegacyDefaultState();
  const candidate = migrateWorkspaceStateV1ToV2(source);
  const memory = createMemoryStorage(source, {
    schemaVersion: 1,
    sourceVersion: 1,
    targetVersion: 2,
    source: parseWorkspaceStateV1(source),
    candidate
  });
  const service = new WorkspaceStateService(memory.storage);

  const loaded = await service.getOrInitialize();
  assert.equal(loaded.schemaVersion, 5);
  assert.equal(memory.value().schemaVersion, 5);
  assert.equal(memory.journal(), undefined);
  assert.equal(memory.calls.write, 4);
  assert.equal(memory.calls.removeMigration, 4);
});

test("concurrent initialization shares one migration read and one initialization", async () => {
  let releaseMigrationRead;
  let writeCount = 0;
  let canonicalReadCount = 0;
  let migrationReadCount = 0;
  const storage = {
    async read() {
      canonicalReadCount += 1;
      return undefined;
    },
    async write() {
      writeCount += 1;
    },
    readMigration() {
      migrationReadCount += 1;
      return new Promise((resolve) => {
        releaseMigrationRead = resolve;
      });
    },
    async writeMigration() {
      assert.fail("missing state must not start a migration");
    },
    async removeMigration() {
      assert.fail("missing state must not clear a migration");
    }
  };
  const service = new WorkspaceStateService(storage);

  const firstRequest = service.getOrInitialize();
  const secondRequest = service.getOrInitialize();
  await Promise.resolve();
  assert.equal(migrationReadCount, 1);
  releaseMigrationRead(undefined);

  const [first, second] = await Promise.all([firstRequest, secondRequest]);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.equal(canonicalReadCount, 1);
  assert.equal(writeCount, 1);
});

test("invalid and future state are rejected without canonical or journal writes", async () => {
  for (const [storedState, expectedCode] of [
    [{ schemaVersion: 3, workspaces: [], rail: [] }, WORKSPACE_STATE_ERROR_CODES.INVALID_STATE],
    [
      {
        ...createDefaultWorkspaceState(),
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION + 1
      },
      WORKSPACE_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
    ]
  ]) {
    const memory = createMemoryStorage(storedState);
    const service = new WorkspaceStateService(memory.storage);

    await assert.rejects(service.getOrInitialize(), (error) => {
      assert.ok(error instanceof WorkspaceStateError);
      assert.equal(error.code, expectedCode);
      return true;
    });
    assert.equal(memory.calls.write, 0);
    assert.equal(memory.calls.writeMigration, 0);
  }
});

test("read and initialization-write failures become storage-unavailable errors", async () => {
  const readFailureService = new WorkspaceStateService({
    async readMigration() {
      throw new Error("synthetic read failure");
    },
    async read() {
      assert.fail("canonical read must not follow a journal read failure");
    }
  });
  await assert.rejects(
    readFailureService.getOrInitialize(),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE
  );

  const writeFailureService = new WorkspaceStateService({
    async readMigration() {
      return undefined;
    },
    async read() {
      return undefined;
    },
    async write() {
      throw new Error("synthetic write failure");
    }
  });
  await assert.rejects(
    writeFailureService.getOrInitialize(),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE
  );
});

test("replacing a workspace icon rewrites only matching workspaces in one write", async () => {
  const memory = createMemoryStorage(undefined);
  const service = new WorkspaceStateService(memory.storage);
  const customId = `custom-${"a".repeat(32)}`;
  await service.updateWorkspace("ws-default-work", { icon: customId });
  await service.updateWorkspace("ws-default-research", { icon: customId });
  const writesBefore = memory.calls.write;

  const result = await service.replaceWorkspaceIcon(customId, "house");
  assert.equal(result.replacedCount, 2);
  assert.equal(memory.calls.write, writesBefore + 1);
  assert.deepEqual(memory.value().workspaces.map(({ icon }) => icon), ["house", "user", "house"]);
  assert.deepEqual(result.state.workspaces.map(({ icon }) => icon), ["house", "user", "house"]);

  const unchanged = await service.replaceWorkspaceIcon(customId, "house");
  assert.equal(unchanged.replacedCount, 0);
  assert.equal(memory.calls.write, writesBefore + 1);

  for (const [from, to] of [
    ["house", "house"],
    ["not-an-icon", "house"],
    [customId, "future-icon"],
    [7, "house"]
  ]) {
    await assert.rejects(
      service.replaceWorkspaceIcon(from, to),
      (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
    );
  }
});

test("conditional restore rollback never overwrites a newer workspace state", async () => {
  const previous = createDefaultWorkspaceState();
  const imported = structuredClone(previous);
  imported.workspaces[0].name = "Imported Work";
  const newer = structuredClone(imported);
  newer.workspaces[0].color = "#123456";
  const memory = createMemoryStorage(previous);
  const service = new WorkspaceStateService(memory.storage);

  await service.replaceForRestore(imported);
  const rolledBack = await service.replaceForRestoreIfCurrent(imported, previous);
  assert.equal(rolledBack.replaced, true);
  assert.deepEqual(memory.value(), previous);

  await service.replaceForRestore(imported);
  await service.replaceForRestore(newer);
  const writesBefore = memory.calls.write;
  const skipped = await service.replaceForRestoreIfCurrent(imported, previous);
  assert.equal(skipped.replaced, false);
  assert.deepEqual(skipped.state, newer);
  assert.deepEqual(memory.value(), newer);
  assert.equal(memory.calls.write, writesBefore);
});

function batchService(memory) {
  let counter = 0;
  return new WorkspaceStateService(memory.storage, {
    idGenerator: () => `batch${(counter += 1)}`
  });
}

const railKeys = (state) =>
  state.rail.map((entry) => (entry.kind === "workspace" ? entry.workspaceId : entry.kind));

test("a shared change reaches only the selected workspaces in one write", async () => {
  const memory = createMemoryStorage(createDefaultWorkspaceState());
  const service = batchService(memory);
  const writesBefore = memory.calls.write;

  const next = await service.updateWorkspaces(
    ["ws-default-work", "ws-default-research"],
    { icon: "briefcase-business", color: "#112233" }
  );

  assert.equal(memory.calls.write - writesBefore, 1);
  const byId = new Map(next.workspaces.map((workspace) => [workspace.id, workspace]));
  for (const id of ["ws-default-work", "ws-default-research"]) {
    assert.equal(byId.get(id).icon, "briefcase-business");
    assert.equal(byId.get(id).color, "#112233");
  }
  assert.equal(byId.get("ws-default-personal").icon, "user");
  assert.equal(byId.get("ws-default-personal").color, "#FFFFFF");
  // Names mean something different per workspace, so bulk editing refuses them.
  await assert.rejects(
    () => service.updateWorkspaces(["ws-default-work"], { name: "Shared" }),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("one default container reaches only the selected workspaces in one write", async () => {
  const memory = createMemoryStorage(createDefaultWorkspaceState());
  const service = batchService(memory);
  const writesBefore = memory.calls.write;

  const next = await service.setDefaultContainerRefs(
    ["ws-default-work", "ws-default-research"],
    "ctr-work"
  );
  assert.equal(memory.calls.write - writesBefore, 1);
  const refs = (state) => Object.fromEntries(
    state.workspaces.map(({ id, defaultContainerRef }) => [id, defaultContainerRef])
  );
  assert.deepEqual(refs(next), {
    "ws-default-work": "ctr-work",
    "ws-default-personal": null,
    "ws-default-research": "ctr-work"
  });

  // No Container is a value to set, not a change to skip.
  const cleared = await service.setDefaultContainerRefs(["ws-default-work"], null);
  assert.equal(refs(cleared)["ws-default-work"], null);
  assert.equal(refs(cleared)["ws-default-research"], "ctr-work");

  // The shared icon/color path still cannot set a container: only the
  // container path, which resolves the reference first, reaches this method.
  await assert.rejects(
    () => service.updateWorkspaces(["ws-default-work"], { defaultContainerRef: "ctr-work" }),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
  const writesAfter = memory.calls.write;
  for (const attempt of [
    () => service.setDefaultContainerRefs(["ws-missing"], "ctr-work"),
    () => service.setDefaultContainerRefs(["ws-default-work"], "Work container")
  ]) {
    await assert.rejects(
      attempt,
      (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
    );
  }
  assert.equal(memory.calls.write, writesAfter);
});

test("a scattered selection moves as one block and keeps its relative order", async () => {
  const memory = createMemoryStorage(createDefaultWorkspaceState());
  const service = batchService(memory);

  const next = await service.placeRailEntries(
    [
      { kind: "workspace", id: "ws-default-work" },
      { kind: "workspace", id: "ws-default-research" }
    ],
    { kind: "workspace", id: "ws-default-personal" },
    "before"
  );
  assert.deepEqual(railKeys(next), [
    "ws-default-work",
    "ws-default-research",
    "ws-default-personal"
  ]);

  // Dropping a selection onto itself has no meaning and must not half-apply.
  await assert.rejects(
    () => service.placeRailEntries(
      [
        { kind: "workspace", id: "ws-default-work" },
        { kind: "workspace", id: "ws-default-research" }
      ],
      { kind: "workspace", id: "ws-default-work" },
      "after"
    ),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("wrapping a selection in dividers is one write, and workspaces resist removal", async () => {
  const memory = createMemoryStorage(createDefaultWorkspaceState());
  const service = batchService(memory);
  const writesBefore = memory.calls.write;

  const wrapped = await service.insertRailEntries([
    { kind: "divider", target: { kind: "workspace", id: "ws-default-work" }, position: "before" },
    { kind: "divider", target: { kind: "workspace", id: "ws-default-research" }, position: "after" }
  ]);
  assert.equal(memory.calls.write - writesBefore, 1);
  assert.deepEqual(railKeys(wrapped), [
    "divider",
    "ws-default-work",
    "ws-default-personal",
    "ws-default-research",
    "divider"
  ]);

  const dividers = wrapped.rail.filter(({ kind }) => kind === "divider");
  const removed = await service.removeRailEntries(
    dividers.map(({ kind, id }) => ({ kind, id }))
  );
  assert.deepEqual(railKeys(removed), [
    "ws-default-work",
    "ws-default-personal",
    "ws-default-research"
  ]);

  // Removing a workspace moves its tabs, so it never travels this path.
  await assert.rejects(
    () => service.removeRailEntries([{ kind: "workspace", id: "ws-default-work" }]),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

test("pasted workspaces are fresh identities placed at the drop point", async () => {
  const memory = createMemoryStorage(createDefaultWorkspaceState());
  const service = batchService(memory);

  const next = await service.duplicateWorkspaces(
    ["ws-default-work", "ws-default-personal"],
    { kind: "workspace", id: "ws-default-work" },
    "after"
  );

  const ids = next.workspaces.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "every workspace keeps a distinct identity");
  assert.equal(next.workspaces.length, 5);
  const [firstCopy, secondCopy] = ids.slice(3);
  assert.deepEqual(railKeys(next), [
    "ws-default-work",
    firstCopy,
    secondCopy,
    "ws-default-personal",
    "ws-default-research"
  ]);
  const copy = next.workspaces.find(({ id }) => id === firstCopy);
  assert.equal(copy.name, "Work");
  assert.equal(copy.icon, "house");

  await assert.rejects(
    () => service.duplicateWorkspaces(["ws-missing"], null),
    (error) => error.code === WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
  );
});

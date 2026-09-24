import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_PACKAGE_ERROR_CODES,
  WORKSPACE_PACKAGE_IMPORT_MODES,
  WorkspacePackageError,
  encodeWorkspacePackageBytes
} from "../../src/contracts/workspace-package.js";
import {
  WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceState
} from "../../src/contracts/workspace-state.js";
import { createSerialOperationExecutor } from "../../src/core/serial-operation-executor.js";
import { WorkspacePackageService } from "../../src/core/workspace-package-service.js";
import { createZipArchive } from "../../src/core/zip-writer.js";
import { readZipEntries } from "../helpers/zip-reader.js";
import { customIconId, pngBytes, sha256Hex } from "../helpers/custom-icon-fixture.js";

function storedIcon(seed) {
  const bytes = pngBytes({ fill: seed % 256 });
  return {
    id: customIconId(seed),
    label: `Icon ${seed}`,
    digest: sha256Hex(bytes),
    createdAt: new Date(Date.UTC(2026, 8, 11, 0, 0, seed)).toISOString(),
    bytes
  };
}

function currentState({ workspaces, rail } = {}) {
  return parseWorkspaceState({
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspaces: workspaces ?? [
      { id: "ws-existing", name: "Existing", icon: "house", color: "#ffffff", defaultContainerRef: null }
    ],
    rail: rail ?? [{ kind: "workspace", workspaceId: "ws-existing" }]
  });
}

function packageDocument({ workspaces, rail, icons = [] } = {}) {
  return {
    documentType: "sidebars.workspace-package",
    schemaVersion: 1,
    createdAt: "2026-09-19T20:00:00.000Z",
    payload: {
      workspaces: {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: workspaces ?? [
          { id: "ws-a", name: "Imported A", icon: "house", color: "#010101" },
          { id: "ws-b", name: "Imported B", icon: "house", color: "#020202" }
        ],
        rail: rail ?? [
          { kind: "workspace", workspaceId: "ws-a" },
          { kind: "divider", id: "divider-x", size: 16 },
          { kind: "workspace", workspaceId: "ws-b" }
        ]
      },
      icons
    }
  };
}

function packagedIconFrom(bytes, { id = customIconId(1), label = "Packaged", digest } = {}) {
  return {
    id,
    label,
    digest: digest ?? sha256Hex(bytes),
    byteLength: bytes.byteLength,
    dataBase64: encodeWorkspacePackageBytes(bytes)
  };
}

function jsonBytes(document) {
  return new TextEncoder().encode(JSON.stringify(document));
}

function cloneStoredIcon(icon) {
  return {
    ...icon,
    bytes: new Uint8Array(icon.bytes),
    source: icon.source == null
      ? null
      : {
        ...icon.source,
        bytes: new Uint8Array(icon.source.bytes)
      }
  };
}

function createHarness({
  state = currentState(),
  icons = [],
  measure = async () => ({ width: 128, height: 128 }),
  splitViewWorkspaceIds = [],
  failStateWrite = false,
  stateWriteFailureState = null,
  iconLimit = 100,
  operationExecutor = undefined
} = {}) {
  const stateService = {
    state,
    writes: [],
    async getOrInitialize() {
      return this.state;
    },
    async replaceForRestore(next) {
      const parsed = parseWorkspaceState(next);
      if (stateWriteFailureState !== null) {
        this.state = parseWorkspaceState(stateWriteFailureState);
        throw new Error("storage failed after a newer write");
      }
      if (failStateWrite) throw new Error("storage unavailable");
      this.writes.push(parsed);
      this.state = parsed;
      return parsed;
    },
    async replaceForRestoreIfCurrent(expected, replacement) {
      const parsedExpected = parseWorkspaceState(expected);
      if (JSON.stringify(this.state) !== JSON.stringify(parsedExpected)) {
        return { replaced: false, state: this.state };
      }
      const parsed = parseWorkspaceState(replacement);
      this.writes.push(parsed);
      this.state = parsed;
      return { replaced: true, state: parsed };
    }
  };

  let nextSeed = 500;
  const customIconService = {
    icons: icons.map(cloneStoredIcon),
    added: [],
    removed: [],
    compatibility: new Map(),
    legacyReferences: [],
    async list() {
      return {
        icons: this.icons.map(cloneStoredIcon),
        usage: { iconCount: this.icons.length, byteCount: 0 }
      };
    },
    async listForExport() {
      return this.list();
    },
    async add(label, bytes, source = null, { preferredId = null } = {}) {
      const digest = sha256Hex(bytes);
      const duplicate = this.icons.find((icon) => icon.digest === digest);
      if (duplicate) {
        if (source !== null && duplicate.source == null) {
          duplicate.source = {
            mimeType: source.mimeType,
            byteLength: source.byteLength,
            bytes: new Uint8Array(source.bytes)
          };
        }
        return { icon: cloneStoredIcon(duplicate), duplicate: true };
      }
      if (this.icons.length >= iconLimit) throw new Error("limit reached");
      nextSeed += 1;
      const occupied = new Set(this.icons.map(({ id }) => id));
      const record = {
        id: preferredId !== null && !occupied.has(preferredId)
          ? preferredId
          : customIconId(nextSeed),
        label,
        digest,
        createdAt: new Date().toISOString(),
        bytes: new Uint8Array(bytes),
        source: source === null ? null : {
          mimeType: source.mimeType,
          byteLength: source.byteLength,
          bytes: new Uint8Array(source.bytes)
        }
      };
      this.icons.push(record);
      this.added.push(record.id);
      return { icon: cloneStoredIcon(record), duplicate: false };
    },
    async importIcon(label, bytes, source = null, options = {}) {
      const digest = sha256Hex(bytes);
      const previous = this.icons.find((icon) => icon.digest === digest);
      const previousCopy = previous ? cloneStoredIcon(previous) : null;
      const result = await this.add(label, bytes, source, options);
      let rollbackToken = null;
      if (previousCopy === null) {
        rollbackToken = { kind: "remove", id: result.icon.id };
      } else if (previousCopy.source === null && result.icon.source !== null) {
        rollbackToken = { kind: "restore", record: previousCopy };
      }
      return { ...result, rollbackToken };
    },
    async rollbackImportIcon(token) {
      if (token?.kind === "remove") {
        this.removed.push(token.id);
        this.icons = this.icons.filter((icon) => icon.id !== token.id);
        return;
      }
      if (token?.kind === "restore") {
        const index = this.icons.findIndex(({ id }) => id === token.record.id);
        this.icons[index] = cloneStoredIcon(token.record);
        return;
      }
      throw new Error("invalid icon rollback token");
    },
    async recordLegacyReference(sourceId, targetId, digest) {
      const previous = this.compatibility.has(sourceId)
        ? structuredClone(this.compatibility.get(sourceId))
        : null;
      const target = this.icons.find(({ id }) => id === targetId);
      assert.equal(target?.digest, digest);
      const mappings = (previous?.mappings ?? [])
        .filter((mapping) => mapping.digest !== digest);
      mappings.push({ digest, targetId });
      const record = { sourceId, mappings };
      this.compatibility.set(sourceId, record);
      this.legacyReferences.push(structuredClone(record));
      return { sourceId, previous };
    },
    async restoreLegacyReference(token) {
      if (token.previous === null) {
        this.compatibility.delete(token.sourceId);
      } else {
        this.compatibility.set(token.sourceId, structuredClone(token.previous));
      }
    },
    async remove(id) {
      this.removed.push(id);
      this.icons = this.icons.filter((icon) => icon.id !== id);
    }
  };

  const makeController = (name) => ({
    name,
    prepared: [],
    preparationOptions: [],
    restored: [],
    reconciled: [],
    async prepareWorkspaceStateReplacement(next, options) {
      this.prepared.push(next);
      this.preparationOptions.push(options);
      return { token: name };
    },
    async restorePreparedWorkspaceState(token) {
      this.restored.push(token);
      return true;
    },
    async reconcileWindow(windowId) {
      this.reconciled.push(windowId);
    },
    async listSplitViewWorkspaceIds() {
      return splitViewWorkspaceIds;
    }
  });

  const normalController = makeController("normal");
  const privateController = makeController("private");
  const safetySnapshots = [];

  const service = new WorkspacePackageService({
    workspaceStateService: stateService,
    customIconService,
    decoder: { measure },
    normalController,
    privateController,
    captureSafetySnapshot: async () => {
      safetySnapshots.push(true);
    },
    clock: () => new Date("2026-09-19T20:00:00.000Z"),
    operationExecutor
  });

  return {
    service,
    stateService,
    customIconService,
    normalController,
    privateController,
    safetySnapshots,
    operationExecutor
  };
}

async function codeOf(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WorkspacePackageError, `expected a package error, got ${error}`);
    return error.code;
  }
  return null;
}

test("export carries the whole icon library, not only the icons in use", async () => {
  const used = storedIcon(1);
  const spare = storedIcon(2);
  const { service } = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: used.id, color: "#ffffff", defaultContainerRef: null }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-one" }]
    }),
    icons: [used, spare]
  });

  const { document } = await service.export();
  // The spare icon travels so that importing restores the library whole.
  assert.deepEqual(document.payload.icons.map(({ id }) => id).sort(), [used.id, spare.id].sort());
});

test("export replaces a dangling custom-icon reference so every package is asset-closed", async () => {
  const missingId = customIconId(90);
  const { service } = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: missingId, color: "#ffffff", defaultContainerRef: null }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-one" }]
    })
  });

  const { document } = await service.export();
  assert.equal(document.payload.workspaces.workspaces[0].icon, "house");
  assert.deepEqual(document.payload.icons, []);
});

test("export waits for a shared workspace-and-icon mutation and reads one coherent result", async () => {
  const operationExecutor = createSerialOperationExecutor();
  const harness = createHarness({ operationExecutor });
  const icon = storedIcon(80);
  let allowIconWrite;
  let stateWritten;
  const iconGate = new Promise((resolve) => { allowIconWrite = resolve; });
  const stateGate = new Promise((resolve) => { stateWritten = resolve; });
  const mutation = operationExecutor.runExclusive(async () => {
    harness.stateService.state = currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: icon.id, color: "#ffffff", defaultContainerRef: null }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-one" }]
    });
    stateWritten();
    await iconGate;
    harness.customIconService.icons.push(cloneStoredIcon(icon));
  });
  await stateGate;

  const exported = harness.service.export();
  allowIconWrite();
  await mutation;
  const { document } = await exported;

  assert.equal(document.payload.workspaces.workspaces[0].icon, icon.id);
  assert.deepEqual(document.payload.icons.map(({ id }) => id), [icon.id]);
});

test("export drops every container assignment and names one zip", async () => {
  const { service } = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: "house", color: "#ffffff", defaultContainerRef: "ctr-work" }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-one" }]
    })
  });

  const { document, filename } = await service.export();
  assert.deepEqual(
    Object.keys(document.payload.workspaces.workspaces[0]).sort(),
    ["color", "icon", "id", "name"]
  );
  assert.match(filename, /^Snapshots & Settings\/Terminus Workspaces - .+\.zip$/);
});

test("the exported zip holds the manifest, each icon and each retained original", async () => {
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const vector = {
    ...storedIcon(1),
    label: "Vector",
    source: { mimeType: "image/svg+xml", byteLength: svg.byteLength, bytes: svg }
  };
  const raster = { ...storedIcon(2), label: "Raster" };
  const { service } = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: vector.id, color: "#ffffff", defaultContainerRef: null }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-one" }]
    }),
    icons: [vector, raster]
  });

  const { bytes } = await service.export();
  const entries = readZipEntries(bytes);
  assert.deepEqual(entries.map(({ name }) => name), [
    "workspaces.json",
    "icons/Vector.png",
    "originals/Vector.svg",
    "icons/Raster.png"
  ]);
  // Raw image bytes, not base64 text: that is the space this format saves.
  assert.deepEqual(entries[1].bytes, vector.bytes);
  assert.deepEqual(entries[2].bytes, svg);
  const manifest = JSON.parse(new TextDecoder().decode(entries[0].bytes));
  assert.equal(manifest.documentType, "sidebars.workspace-archive");
  assert.deepEqual(manifest.payload.icons.map(({ file }) => file), [
    "icons/Vector.png",
    "icons/Raster.png"
  ]);
  assert.equal(manifest.payload.icons[0].source.file, "originals/Vector.svg");
  assert.equal(JSON.stringify(manifest).includes("dataBase64"), false);
});

test("icon file names in the zip are made safe and kept distinct", async () => {
  const first = { ...storedIcon(1), label: "Work/Home" };
  const second = { ...storedIcon(2), label: "Work Home" };
  const { service } = createHarness({ icons: [first, second] });
  const entries = readZipEntries((await service.export()).bytes);
  assert.deepEqual(entries.slice(1).map(({ name }) => name), [
    "icons/Work Home.png",
    "icons/Work Home (2).png"
  ]);
});

test("add keeps the existing rail and appends the imported one", async () => {
  const harness = createHarness();
  const result = await harness.service.import(
    7,
    packageDocument(),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.equal(result.workspaceCount, 2);
  const written = harness.stateService.writes.at(-1);
  assert.deepEqual(
    written.workspaces.map(({ name }) => name),
    ["Existing", "Imported A", "Imported B"]
  );
  assert.deepEqual(
    written.rail.map(({ kind }) => kind),
    ["workspace", "workspace", "divider", "workspace"]
  );
  assert.equal(harness.normalController.reconciled.at(-1), 7);
});

test("imported workspaces always get fresh ids, so re-importing the source makes a copy", async () => {
  const harness = createHarness();
  await harness.service.import(1, packageDocument(), WORKSPACE_PACKAGE_IMPORT_MODES.ADD);
  const first = harness.stateService.writes.at(-1);
  await harness.service.import(1, packageDocument(), WORKSPACE_PACKAGE_IMPORT_MODES.ADD);
  const second = harness.stateService.writes.at(-1);

  assert.equal(second.workspaces.length, 5);
  assert.equal(new Set(second.workspaces.map(({ id }) => id)).size, 5);
  // Minted ids are ws-<32 hex>, so compare exactly: a prefix test would match
  // any minted id whose first hex digit happened to be "a".
  const sourceIds = new Set(["ws-a", "ws-b"]);
  for (const workspace of second.workspaces) {
    assert.ok(!sourceIds.has(workspace.id), `source id ${workspace.id} was reused`);
  }
  assert.equal(first.workspaces.length, 3);
});

test("replace maps matching source workspaces one-to-one in both scopes", async () => {
  const harness = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-a", name: "Imported A", icon: "house", color: "#010101", defaultContainerRef: null },
        { id: "ws-b", name: "Imported B", icon: "house", color: "#020202", defaultContainerRef: null }
      ],
      rail: [
        { kind: "workspace", workspaceId: "ws-a" },
        { kind: "workspace", workspaceId: "ws-b" }
      ]
    })
  });
  const outcome = await harness.service.import(
    3,
    packageDocument(),
    WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE
  );

  const written = harness.stateService.writes.at(-1);
  assert.deepEqual(written.workspaces.map(({ name }) => name), ["Imported A", "Imported B"]);
  assert.equal(outcome.matchedWorkspaceCount, 2);
  assert.equal(outcome.retainedWorkspaceCount, 0);
  assert.equal(harness.safetySnapshots.length, 1);
  assert.equal(harness.normalController.prepared.length, 1);
  assert.equal(harness.privateController.prepared.length, 1);
  assert.deepEqual(
    [...harness.normalController.preparationOptions[0].workspaceIdMap],
    [["ws-a", written.workspaces[0].id], ["ws-b", written.workspaces[1].id]]
  );
});

test("add takes no safety snapshot, because it removes nothing", async () => {
  const harness = createHarness();
  await harness.service.import(1, packageDocument(), WORKSPACE_PACKAGE_IMPORT_MODES.ADD);
  assert.equal(harness.safetySnapshots.length, 0);
});

test("concurrent package imports serialize from preflight through commit", async () => {
  const harness = createHarness();
  const originalPrepare = harness.normalController.prepareWorkspaceStateReplacement.bind(
    harness.normalController
  );
  let releaseFirst;
  let firstPrepared;
  const releaseGate = new Promise((resolve) => { releaseFirst = resolve; });
  const preparedGate = new Promise((resolve) => { firstPrepared = resolve; });
  let preparationCount = 0;
  harness.normalController.prepareWorkspaceStateReplacement = async (...args) => {
    const token = await originalPrepare(...args);
    preparationCount += 1;
    if (preparationCount === 1) {
      firstPrepared();
      await releaseGate;
    }
    return token;
  };

  const first = harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "First import", icon: "house", color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );
  await preparedGate;
  const second = harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-b", name: "Second import", icon: "user", color: "#020202" }],
      rail: [{ kind: "workspace", workspaceId: "ws-b" }]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.normalController.prepared.length, 1);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(harness.stateService.state.workspaces.map(({ name }) => name), [
    "Existing",
    "First import",
    "Second import"
  ]);
  assert.equal(harness.stateService.writes.length, 2);
});

test("replace keeps an unrelated workspace-id collision separate", async () => {
  const harness = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-a", name: "Unrelated", icon: "user", color: "#abcdef", defaultContainerRef: null }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }]
    })
  });

  const outcome = await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "Imported A", icon: "house", color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE
  );

  const written = harness.stateService.writes.at(-1);
  assert.deepEqual(written.workspaces.map(({ name }) => name), ["Imported A", "Unrelated"]);
  assert.notEqual(written.workspaces[0].id, "ws-a");
  assert.equal(written.workspaces[1].id, "ws-a");
  assert.equal(outcome.matchedWorkspaceCount, 0);
  assert.equal(outcome.retainedWorkspaceCount, 1);
  assert.deepEqual(
    [...harness.normalController.preparationOptions[0].workspaceIdMap],
    [["ws-a", "ws-a"]]
  );
});

test("replace mints around retained ids and keeps retained workspaces in rail order", async (t) => {
  const generated = [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "cccccccc-cccc-cccc-cccc-cccccccccccc"
  ];
  t.mock.method(globalThis.crypto, "randomUUID", () => generated.shift());
  const firstId = "ws-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const secondId = "ws-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const harness = createHarness({
    state: currentState({
      workspaces: [
        { id: firstId, name: "First", icon: "house", color: "#111111", defaultContainerRef: null },
        { id: secondId, name: "Second", icon: "user", color: "#222222", defaultContainerRef: null }
      ],
      rail: [
        { kind: "workspace", workspaceId: secondId },
        { kind: "workspace", workspaceId: firstId }
      ]
    })
  });

  await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-source", name: "Imported", icon: "house", color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-source" }]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE
  );

  const written = harness.stateService.writes.at(-1);
  assert.equal(written.workspaces[0].id, "ws-cccccccccccccccccccccccccccccccc");
  assert.deepEqual(
    written.rail.map(({ workspaceId }) => workspaceId),
    [written.workspaces[0].id, secondId, firstId]
  );
});

test("an icon already held under a different id is reused and consumes no slot", async () => {
  const existing = storedIcon(1);
  const harness = createHarness({ icons: [existing] });
  // Same bytes, different source id.
  const packaged = packagedIconFrom(existing.bytes, { id: customIconId(99), label: "Renamed" });

  await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: [packaged]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.deepEqual(harness.customIconService.added, []);
  assert.equal(harness.customIconService.icons.length, 1);
  assert.equal(harness.stateService.writes.at(-1).workspaces.at(-1).icon, existing.id);
  assert.deepEqual(harness.customIconService.compatibility.get(customIconId(99)), {
    sourceId: customIconId(99),
    mappings: [{ digest: existing.digest, targetId: existing.id }]
  });
});

test("new icon content keeps its durable source id for older snapshots", async () => {
  const harness = createHarness();
  const bytes = pngBytes({ fill: 77 });
  const packaged = packagedIconFrom(bytes, { id: customIconId(99) });

  await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: [packaged]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.equal(harness.customIconService.added.length, 1);
  const imported = harness.stateService.writes.at(-1).workspaces.at(-1);
  assert.equal(imported.icon, harness.customIconService.added[0]);
  assert.equal(imported.icon, customIconId(99));
});

test("a custom-icon id collision is remapped without replacing unrelated bytes", async () => {
  const occupied = storedIcon(99);
  const harness = createHarness({ icons: [occupied] });
  const incomingBytes = pngBytes({ fill: 201 });
  const packaged = packagedIconFrom(incomingBytes, { id: occupied.id });

  await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: occupied.id, color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: [packaged]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  const imported = harness.stateService.writes.at(-1).workspaces.at(-1);
  assert.notEqual(imported.icon, occupied.id);
  assert.equal(harness.customIconService.icons.find(({ id }) => id === occupied.id).digest, occupied.digest);
  assert.deepEqual(harness.customIconService.compatibility.get(occupied.id), {
    sourceId: occupied.id,
    mappings: [{ digest: sha256Hex(incomingBytes), targetId: imported.icon }]
  });
});

test("a declared digest cannot make different content look like a stored icon", async () => {
  const existing = storedIcon(1);
  const harness = createHarness({ icons: [existing] });
  const differentBytes = pngBytes({ fill: 200 });
  // The package lies: it claims the stored icon's digest for other content.
  const packaged = packagedIconFrom(differentBytes, {
    id: customIconId(99),
    digest: existing.digest
  });

  await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: [packaged]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  // Recomputed content wins: it is new, not a reuse of the stored icon.
  assert.equal(harness.customIconService.added.length, 1);
  assert.notEqual(harness.stateService.writes.at(-1).workspaces.at(-1).icon, existing.id);
});

test("an undecodable icon falls back to House and is reported, without failing the import", async () => {
  const harness = createHarness({
    measure: async () => {
      throw new Error("cannot decode");
    }
  });
  const packaged = packagedIconFrom(pngBytes({ fill: 5 }), { id: customIconId(99), label: "Broken" });

  const result = await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: [packaged]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.equal(harness.stateService.writes.at(-1).workspaces.at(-1).icon, "house");
  assert.deepEqual(result.icons.damaged, [{ id: customIconId(99), label: "Broken" }]);
  assert.deepEqual(harness.customIconService.added, []);
});

test("an icon of the wrong size is damaged, not stored", async () => {
  const harness = createHarness({ measure: async () => ({ width: 64, height: 64 }) });
  const packaged = packagedIconFrom(pngBytes({ fill: 5 }), { id: customIconId(99) });

  const result = await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: [packaged]
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.equal(result.icons.damaged.length, 1);
  assert.deepEqual(harness.customIconService.added, []);
});

test("a referenced icon the package never carried falls back to House and is reported", async () => {
  const harness = createHarness();
  const result = await harness.service.import(
    1,
    packageDocument({
      workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
      rail: [{ kind: "workspace", workspaceId: "ws-a" }],
      icons: []
    }),
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.equal(harness.stateService.writes.at(-1).workspaces.at(-1).icon, "house");
  assert.deepEqual(result.icons.damaged, [{ id: customIconId(99), label: null }]);
});

test("the icon limit refuses the import before anything is written", async () => {
  const full = Array.from({ length: 100 }, (unused, index) => storedIcon(index + 1));
  const harness = createHarness({ icons: full, iconLimit: 100 });
  const packaged = packagedIconFrom(pngBytes({ fill: 250 }), { id: customIconId(999) });

  const code = await codeOf(
    harness.service.import(
      1,
      packageDocument({
        workspaces: [{ id: "ws-a", name: "A", icon: customIconId(999), color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }],
        icons: [packaged]
      }),
      WORKSPACE_PACKAGE_IMPORT_MODES.ADD
    )
  );

  assert.equal(code, WORKSPACE_PACKAGE_ERROR_CODES.ICON_LIMIT);
  assert.deepEqual(harness.stateService.writes, []);
  assert.deepEqual(harness.customIconService.added, []);
  assert.deepEqual(harness.normalController.prepared, []);
});

test("the workspace limit refuses an add before anything is written", async () => {
  const many = Array.from({ length: 99 }, (unused, index) => ({
    id: `ws-${index}`,
    name: `W${index}`,
    icon: "house",
    color: "#ffffff",
    defaultContainerRef: null
  }));
  const harness = createHarness({
    state: currentState({
      workspaces: many,
      rail: many.map(({ id }) => ({ kind: "workspace", workspaceId: id }))
    })
  });

  const code = await codeOf(
    harness.service.import(1, packageDocument(), WORKSPACE_PACKAGE_IMPORT_MODES.ADD)
  );

  assert.equal(code, WORKSPACE_PACKAGE_ERROR_CODES.WORKSPACE_LIMIT);
  assert.deepEqual(harness.stateService.writes, []);
  assert.deepEqual(harness.normalController.prepared, []);
});

test("a workspace holding a split view refuses replace and applies nothing", async () => {
  const harness = createHarness({ splitViewWorkspaceIds: ["ws-existing"] });
  const code = await codeOf(
    harness.service.import(1, packageDocument(), WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE)
  );

  assert.equal(code, WORKSPACE_PACKAGE_ERROR_CODES.SPLIT_VIEW_ACTIVE);
  assert.deepEqual(harness.stateService.writes, []);
  assert.deepEqual(harness.normalController.prepared, []);
  assert.equal(harness.safetySnapshots.length, 0);
});

test("a split view never blocks add, which removes nothing", async () => {
  const harness = createHarness({ splitViewWorkspaceIds: ["ws-existing"] });
  await harness.service.import(1, packageDocument(), WORKSPACE_PACKAGE_IMPORT_MODES.ADD);
  assert.equal(harness.stateService.writes.length, 1);
});

test("a failed state write rolls back both prepared runtimes and the icons it added", async () => {
  const harness = createHarness({ failStateWrite: true });
  const packaged = packagedIconFrom(pngBytes({ fill: 88 }), { id: customIconId(99) });

  await assert.rejects(
    harness.service.import(
      1,
      packageDocument({
        workspaces: [{ id: "ws-a", name: "A", icon: customIconId(99), color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }],
        icons: [packaged]
      }),
      WORKSPACE_PACKAGE_IMPORT_MODES.ADD
    )
  );

  assert.deepEqual(harness.normalController.restored, [{ token: "normal" }]);
  assert.deepEqual(harness.privateController.restored, [{ token: "private" }]);
  assert.equal(harness.customIconService.removed.length, 1);
  assert.equal(harness.customIconService.icons.length, 0);
});

test("a failed package commit never rolls a newer workspace state back to its stale predecessor", async () => {
  const newer = currentState({
    workspaces: [
      { id: "ws-newer", name: "Newer", icon: "user", color: "#abcdef", defaultContainerRef: null }
    ],
    rail: [{ kind: "workspace", workspaceId: "ws-newer" }]
  });
  const harness = createHarness({ stateWriteFailureState: newer });

  await assert.rejects(
    harness.service.import(
      1,
      packageDocument({
        workspaces: [{ id: "ws-a", name: "Imported", icon: "house", color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }]
      }),
      WORKSPACE_PACKAGE_IMPORT_MODES.ADD
    )
  );

  assert.deepEqual(harness.stateService.state, newer);
  assert.deepEqual(harness.normalController.restored, []);
  assert.deepEqual(harness.privateController.restored, []);
});

test("a failed import rolls back original enrichment and durable legacy mappings", async () => {
  const existing = storedIcon(1);
  const sourceId = customIconId(55);
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const packaged = withSource(
    packagedIconFrom(existing.bytes, { id: sourceId, label: "Vector copy" }),
    { bytes: svg }
  );
  const harness = createHarness({ icons: [existing], failStateWrite: true });

  await assert.rejects(
    harness.service.import(
      1,
      packageDocument({
        workspaces: [{ id: "ws-a", name: "A", icon: sourceId, color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }],
        icons: [packaged]
      }),
      WORKSPACE_PACKAGE_IMPORT_MODES.ADD
    )
  );

  assert.equal(harness.customIconService.icons.length, 1);
  assert.equal(harness.customIconService.icons[0].id, existing.id);
  assert.equal(harness.customIconService.icons[0].source, null);
  assert.deepEqual([...harness.customIconService.compatibility], []);
});

test("an unknown mode is refused", async () => {
  const harness = createHarness();
  const code = await codeOf(harness.service.import(1, packageDocument(), "merge"));
  assert.equal(code, WORKSPACE_PACKAGE_ERROR_CODES.INVALID_REQUEST);
  assert.deepEqual(harness.stateService.writes, []);
});

test("an exported zip imports back with its rail, colors and whole icon library", async () => {
  const used = { ...storedIcon(1), label: "Used" };
  const spare = { ...storedIcon(2), label: "Spare" };
  const source = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: used.id, color: "#112233", defaultContainerRef: null },
        { id: "ws-two", name: "Two", icon: "house", color: "#445566", defaultContainerRef: null }
      ],
      rail: [
        { kind: "workspace", workspaceId: "ws-one" },
        { kind: "divider", id: "divider-a", size: 24 },
        { kind: "space", id: "space-a" },
        { kind: "workspace", workspaceId: "ws-two" }
      ]
    }),
    icons: [used, spare]
  });
  const { bytes } = await source.service.export();

  // A different profile: one workspace of its own and no custom icons.
  const target = createHarness();
  const { document, preview } = await target.service.readFile(bytes);
  assert.equal(preview.workspaceCount, 2);
  assert.equal(preview.icons.new, 2, "the spare icon arrives as well");
  assert.deepEqual(preview.icons.damaged, []);

  const outcome = await target.service.import(
    7,
    document,
    WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE
  );
  const [written] = target.stateService.writes;
  assert.deepEqual(written.workspaces.map(({ name }) => name), ["One", "Two", "Existing"]);
  assert.deepEqual(written.workspaces.map(({ color }) => color), ["#112233", "#445566", "#ffffff"]);
  assert.deepEqual(
    written.rail.map(({ kind }) => kind),
    ["workspace", "divider", "space", "workspace", "workspace"]
  );
  assert.equal(written.rail[1].size, 24);
  assert.equal(written.workspaces[0].icon, used.id);
  assert.equal(written.workspaces[1].icon, "house");
  assert.equal(outcome.retainedWorkspaceCount, 1);
  assert.equal(target.customIconService.icons.length, 2, "the library is restored whole");
});

test("a zip that carries no setup is refused, and a damaged one is reported as damaged", async () => {
  const harness = createHarness();
  const photos = createZipArchive([{ name: "photo.png", bytes: pngBytes({ fill: 5 }) }]);
  assert.equal(
    await codeOf(harness.service.readFile(photos)),
    WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE
  );

  const { bytes } = await createHarness({ icons: [storedIcon(1)] }).service.export();
  const broken = new Uint8Array(bytes);
  broken[Math.floor(broken.length / 2)] ^= 0xff;
  assert.equal(
    await codeOf(harness.service.readFile(broken)),
    WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
  );
  assert.deepEqual(harness.stateService.writes, []);
});

test("reading a file previews the counts without writing anything", async () => {
  const existing = storedIcon(1);
  const harness = createHarness({ icons: [existing] });
  const reused = packagedIconFrom(existing.bytes, { id: customIconId(50) });
  const fresh = packagedIconFrom(pngBytes({ fill: 123 }), { id: customIconId(51) });

  const { preview } = await harness.service.readFile(
    jsonBytes(
      packageDocument({
        workspaces: [
          { id: "ws-a", name: "A", icon: customIconId(50), color: "#010101" },
          { id: "ws-b", name: "B", icon: customIconId(51), color: "#020202" }
        ],
        rail: [
          { kind: "workspace", workspaceId: "ws-a" },
          { kind: "workspace", workspaceId: "ws-b" }
        ],
        icons: [reused, fresh]
      })
    )
  );

  assert.equal(preview.workspaceCount, 2);
  assert.equal(preview.icons.reusable, 1);
  assert.equal(preview.icons.new, 1);
  assert.deepEqual(preview.icons.damaged, []);
  assert.deepEqual(harness.stateService.writes, []);
  assert.deepEqual(harness.customIconService.added, []);
});

test("a JSON package from before the zip still imports", async () => {
  const harness = createHarness();
  const { document, preview } = await harness.service.readFile(jsonBytes(packageDocument()));
  assert.equal(preview.workspaceCount, 2);
  await harness.service.import(1, document, WORKSPACE_PACKAGE_IMPORT_MODES.ADD);
  assert.equal(harness.stateService.writes.length, 1);
  assert.deepEqual(
    harness.stateService.writes[0].workspaces.map(({ name }) => name),
    ["Existing", "Imported A", "Imported B"]
  );
});

test("a file that is neither a zip nor JSON is refused as not a package", async () => {
  const harness = createHarness();
  assert.equal(
    await codeOf(harness.service.readFile(new TextEncoder().encode("not json"))),
    WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE
  );
  assert.equal(
    await codeOf(harness.service.readFile("a string, not bytes")),
    WORKSPACE_PACKAGE_ERROR_CODES.INVALID_REQUEST
  );
});

function withSource(icon, { mimeType = "image/svg+xml", bytes } = {}) {
  const source = bytes ?? new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  return {
    ...icon,
    source: {
      mimeType,
      byteLength: source.byteLength,
      dataBase64: encodeWorkspacePackageBytes(source)
    }
  };
}

test("export carries a retained original and null for an icon without one", async () => {
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const withOriginal = { ...storedIcon(1), source: { mimeType: "image/svg+xml", byteLength: svg.byteLength, bytes: svg } };
  const withoutOriginal = storedIcon(2);
  const { service } = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: withOriginal.id, color: "#ffffff", defaultContainerRef: null },
        { id: "ws-two", name: "Two", icon: withoutOriginal.id, color: "#ffffff", defaultContainerRef: null }
      ],
      rail: [
        { kind: "workspace", workspaceId: "ws-one" },
        { kind: "workspace", workspaceId: "ws-two" }
      ]
    }),
    icons: [withOriginal, withoutOriginal]
  });

  const { document } = await service.export();
  const byId = new Map(document.payload.icons.map((icon) => [icon.id, icon]));
  assert.equal(byId.get(withOriginal.id).source.mimeType, "image/svg+xml");
  assert.equal(byId.get(withoutOriginal.id).source, null);
});

test("an imported original travels inside the zip rather than a second download", async () => {
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const vector = {
    ...storedIcon(1),
    label: "Vector",
    source: { mimeType: "image/svg+xml", byteLength: svg.byteLength, bytes: svg }
  };
  const source = createHarness({
    state: currentState({
      workspaces: [
        { id: "ws-one", name: "One", icon: vector.id, color: "#ffffff", defaultContainerRef: null }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-one" }]
    }),
    icons: [vector]
  });
  const { bytes } = await source.service.export();
  const target = createHarness();
  const { document } = await target.service.readFile(bytes);
  // The original is carried through the read, so nothing has to be saved
  // separately during the import.
  assert.equal(document.payload.icons[0].source.mimeType, "image/svg+xml");
  const outcome = await target.service.import(1, document, WORKSPACE_PACKAGE_IMPORT_MODES.ADD);
  assert.equal(Object.hasOwn(outcome, "savedIcons"), false);
  assert.equal(target.customIconService.added.length, 1);
  assert.deepEqual(target.customIconService.icons[0].source?.bytes, svg);
});

test("a corrupt optional original is warned about while its normalized icon still imports", async () => {
  const harness = createHarness();
  const png = pngBytes({ fill: 211 });
  const sourceBytes = new TextEncoder().encode("<svg/>");
  const icon = {
    ...packagedIconFrom(png, { id: customIconId(70), label: "Recoverable" }),
    source: {
      mimeType: "image/svg+xml",
      byteLength: sourceBytes.byteLength + 1,
      dataBase64: encodeWorkspacePackageBytes(sourceBytes)
    }
  };
  const raw = packageDocument({
    workspaces: [{ id: "ws-a", name: "A", icon: icon.id, color: "#010101" }],
    rail: [{ kind: "workspace", workspaceId: "ws-a" }],
    icons: [icon]
  });

  const { document, preview } = await harness.service.readFile(jsonBytes(raw));
  assert.deepEqual(preview.icons.damaged, []);
  assert.deepEqual(preview.icons.damagedOriginals, [{ id: icon.id, label: icon.label }]);
  const outcome = await harness.service.import(
    1,
    document,
    WORKSPACE_PACKAGE_IMPORT_MODES.ADD
  );

  assert.deepEqual(outcome.icons.damagedOriginals, [{ id: icon.id, label: icon.label }]);
  assert.equal(harness.customIconService.icons.length, 1);
  assert.equal(harness.customIconService.icons[0].source, null);
  assert.equal(harness.stateService.writes.at(-1).workspaces.at(-1).icon, icon.id);
});

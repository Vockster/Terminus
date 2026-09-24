import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_LIMITS,
  CustomIconError,
  parseCustomIconCompatibilityRecord,
  parseCustomIconRecord
} from "../../src/contracts/custom-icons.js";
import { CustomIconService } from "../../src/core/custom-icon-service.js";
import { customIconRecord, pngBytes, sha256Hex } from "../helpers/custom-icon-fixture.js";

class MemoryIconStorage {
  records = new Map();
  compatibility = new Map();
  log = [];
  failRemove = false;

  async list() {
    return [...this.records.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    );
  }

  async get(id) {
    return this.records.get(id) ?? null;
  }

  async put(value) {
    const parsed = parseCustomIconRecord(value);
    this.records.set(parsed.id, parsed);
    this.log.push(["put", parsed.id]);
    return parsed;
  }

  async remove(id) {
    this.log.push(["remove", id]);
    if (this.failRemove) throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE);
    this.records.delete(id);
    for (const [sourceId, record] of this.compatibility) {
      const mappings = record.mappings.filter(({ targetId }) => this.records.has(targetId));
      if (!this.records.has(sourceId) && mappings.length === 0) {
        this.compatibility.delete(sourceId);
      } else {
        this.compatibility.set(sourceId, parseCustomIconCompatibilityRecord({ sourceId, mappings }));
      }
    }
  }

  async getCompatibility(sourceId) {
    return this.compatibility.get(sourceId) ?? null;
  }

  async listCompatibility() {
    return [...this.compatibility.values()];
  }

  async putCompatibility(value) {
    const parsed = parseCustomIconCompatibilityRecord(value);
    this.compatibility.set(parsed.sourceId, parsed);
    return parsed;
  }

  async removeCompatibility(sourceId) {
    this.compatibility.delete(sourceId);
  }

  async stats() {
    const icons = await this.list();
    return {
      iconCount: icons.length,
      byteCount: icons.reduce(
        (total, icon) => total + icon.byteLength + (icon.source?.byteLength ?? 0),
        0
      )
    };
  }
}

function createHarness({ measure = async () => ({ width: 128, height: 128 }), replaceWorkspaceIcon } = {}) {
  const storage = new MemoryIconStorage();
  const changes = [];
  const measured = [];
  let uuidCounter = 0;
  const workspaceStateService = {
    calls: [],
    async replaceWorkspaceIcon(fromIconId, toIconId) {
      storage.log.push(["reassign", fromIconId, toIconId]);
      this.calls.push([fromIconId, toIconId]);
      if (replaceWorkspaceIcon) return replaceWorkspaceIcon(fromIconId, toIconId);
      return { state: null, replacedCount: 2 };
    }
  };
  const service = new CustomIconService({
    storage,
    decoder: {
      async measure(bytes) {
        measured.push(bytes);
        return measure(bytes);
      }
    },
    workspaceStateService,
    onChanged: async (change) => changes.push(change),
    clock: () => new Date("2026-09-11T12:00:00.000Z"),
    randomUUID: () => (uuidCounter += 1).toString(16).padStart(32, "0")
  });
  return { service, storage, changes, measured, workspaceStateService };
}

test("adding stores a validated icon, reports usage, and notifies open pages", async () => {
  const { service, storage, changes } = createHarness();
  const bytes = pngBytes({ fill: 3 });
  const result = await service.add("Team Logo", bytes);

  assert.equal(result.duplicate, false);
  assert.equal(result.icon.id, "custom-00000000000000000000000000000001");
  assert.equal(result.icon.label, "Team Logo");
  assert.equal(result.icon.digest, sha256Hex(bytes));
  assert.equal(result.icon.createdAt, "2026-09-11T12:00:00.000Z");
  assert.deepEqual(changes, ["added"]);
  assert.equal(storage.records.size, 1);

  const listed = await service.list();
  assert.deepEqual(listed.usage, { iconCount: 1, byteCount: bytes.byteLength });
  assert.deepEqual(listed.icons.map(({ id }) => id), [result.icon.id]);
  assert.deepEqual(await service.stats(), { iconCount: 1, byteCount: bytes.byteLength });
});

test("the same image is kept once, even when added concurrently", async () => {
  const { service, storage, changes } = createHarness();
  const bytes = pngBytes({ fill: 5 });
  const [first, second] = await Promise.all([service.add("One", bytes), service.add("Two", bytes)]);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.icon.id, first.icon.id);
  assert.equal(second.icon.label, "One");
  assert.equal(storage.records.size, 1);
  assert.deepEqual(changes, ["added"]);
});

test("trusted imports preserve a free source id and retain the original image", async () => {
  const { service, storage } = createHarness();
  const bytes = pngBytes({ fill: 7 });
  const sourceBytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const preferredId = "custom-0000000000000000000000000000abcd";
  const result = await service.add(
    "Imported",
    bytes,
    { mimeType: "image/svg+xml", byteLength: sourceBytes.byteLength, bytes: sourceBytes },
    { preferredId }
  );

  assert.equal(result.icon.id, preferredId);
  assert.equal(Object.hasOwn(result.icon, "source"), false);
  assert.deepEqual(storage.records.get(preferredId)?.source?.bytes, sourceBytes);
});

test("digest reuse attaches a newly supplied original without exposing it publicly", async () => {
  const { service, storage, changes } = createHarness();
  const bytes = pngBytes({ fill: 10 });
  const sourceBytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const first = await service.add("Existing", bytes);
  const reused = await service.add(
    "Imported",
    bytes,
    { mimeType: "image/svg+xml", byteLength: sourceBytes.byteLength, bytes: sourceBytes }
  );

  assert.equal(reused.duplicate, true);
  assert.equal(reused.icon.id, first.icon.id);
  assert.equal(Object.hasOwn(reused.icon, "source"), false);
  assert.deepEqual(storage.records.get(first.icon.id).source.bytes, sourceBytes);
  assert.deepEqual(changes, ["added", "updated"]);
  assert.deepEqual((await service.list()).usage, {
    iconCount: 1,
    byteCount: bytes.byteLength + sourceBytes.byteLength
  });
  assert.equal(Object.hasOwn((await service.list()).icons[0], "source"), false);
  assert.deepEqual((await service.listForExport()).icons[0].source.bytes, sourceBytes);
});

test("legacy reference metadata records ambiguity and can be rolled back", async () => {
  const { service, storage } = createHarness();
  const sourceId = "custom-0000000000000000000000000000abcd";
  await service.add("Occupied", pngBytes({ fill: 11 }), null, { preferredId: sourceId });
  const imported = await service.importIcon(
    "Imported",
    pngBytes({ fill: 12 }),
    null,
    { preferredId: sourceId }
  );
  const digest = storage.records.get(imported.icon.id).digest;
  const token = await service.recordLegacyReference(sourceId, imported.icon.id, digest);

  assert.deepEqual((await service.snapshotCompatibility()).compatibility, [{
    sourceId,
    mappings: [{ digest, targetId: imported.icon.id }]
  }]);
  await service.restoreLegacyReference(token);
  assert.deepEqual((await service.snapshotCompatibility()).compatibility, []);
});

test("trusted imports mint a different id when the preferred id is occupied", async () => {
  const { service } = createHarness();
  const preferredId = "custom-0000000000000000000000000000abcd";
  await service.add("Existing", pngBytes({ fill: 8 }), null, { preferredId });
  const imported = await service.add("Imported", pngBytes({ fill: 9 }), null, { preferredId });

  assert.notEqual(imported.icon.id, preferredId);
  assert.equal(imported.icon.id, "custom-00000000000000000000000000000001");
});

test("the library refuses a 101st icon", async () => {
  const { service, storage, changes } = createHarness();
  for (let seed = 1; seed <= CUSTOM_ICON_LIMITS.maxIcons; seed += 1) {
    const record = parseCustomIconRecord(customIconRecord({ seed, bytes: pngBytes({ length: 64 + seed }) }));
    storage.records.set(record.id, record);
  }
  await assert.rejects(
    service.add("Extra", pngBytes({ length: 400 })),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED
  );
  assert.equal(storage.records.size, CUSTOM_ICON_LIMITS.maxIcons);
  assert.deepEqual(changes, []);
});

test("structural and decode failures reject before anything is stored", async () => {
  const structural = createHarness();
  await assert.rejects(
    structural.service.add("Wide", pngBytes({ width: 256 })),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE
  );
  assert.equal(structural.measured.length, 0);
  await assert.rejects(
    structural.service.add(" padded", pngBytes()),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST
  );

  const wrongSize = createHarness({ measure: async () => ({ width: 64, height: 64 }) });
  await assert.rejects(
    wrongSize.service.add("Logo", pngBytes()),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE
  );
  assert.equal(wrongSize.storage.records.size, 0);

  const undecodable = createHarness({
    measure: async () => {
      throw new CustomIconError(CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE);
    }
  });
  await assert.rejects(
    undecodable.service.add("Logo", pngBytes()),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.UNREADABLE_IMAGE
  );
  assert.equal(undecodable.storage.records.size, 0);
});

test("removing reassigns workspaces to House before deleting the image", async () => {
  const { service, storage, changes, workspaceStateService } = createHarness();
  const { icon } = await service.add("Logo", pngBytes());
  changes.length = 0;
  storage.log.length = 0;

  const result = await service.remove(icon.id);
  assert.deepEqual(result, { id: icon.id, reassignedWorkspaceCount: 2 });
  assert.deepEqual(storage.log, [["reassign", icon.id, "house"], ["remove", icon.id]]);
  assert.deepEqual(workspaceStateService.calls, [[icon.id, "house"]]);
  assert.equal(storage.records.size, 0);
  assert.deepEqual(changes, ["removed"]);
});

test("removing an unknown icon changes nothing", async () => {
  const { service, workspaceStateService, changes } = createHarness();
  await assert.rejects(
    service.remove("custom-0000000000000000000000000000abcd"),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.NOT_FOUND
  );
  await assert.rejects(
    service.remove("house"),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.INVALID_REQUEST
  );
  assert.deepEqual(workspaceStateService.calls, []);
  assert.deepEqual(changes, []);
});

test("a failed reassignment keeps the icon, and a failed deletion keeps it listed for a retry", async () => {
  const failedReassign = createHarness({
    replaceWorkspaceIcon: async () => {
      throw new Error("workspace storage unavailable");
    }
  });
  const { icon } = await failedReassign.service.add("Logo", pngBytes());
  failedReassign.storage.log.length = 0;
  await assert.rejects(failedReassign.service.remove(icon.id), /workspace storage unavailable/);
  assert.equal(failedReassign.storage.records.has(icon.id), true);
  assert.deepEqual(failedReassign.storage.log, [["reassign", icon.id, "house"]]);

  const failedDelete = createHarness();
  const added = await failedDelete.service.add("Logo", pngBytes());
  failedDelete.changes.length = 0;
  failedDelete.storage.failRemove = true;
  await assert.rejects(
    failedDelete.service.remove(added.icon.id),
    (error) => error.code === CUSTOM_ICON_ERROR_CODES.STORAGE_UNAVAILABLE
  );
  assert.deepEqual(failedDelete.workspaceStateService.calls, [[added.icon.id, "house"]]);
  assert.equal((await failedDelete.service.list()).icons.length, 1);
  assert.deepEqual(failedDelete.changes, []);

  failedDelete.storage.failRemove = false;
  await failedDelete.service.remove(added.icon.id);
  assert.equal((await failedDelete.service.list()).icons.length, 0);
});

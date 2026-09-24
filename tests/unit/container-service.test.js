import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTAINER_CAPABILITIES,
  CONTAINER_ERROR_CODES,
  uniqueAvailableContainerEntries
} from "../../src/contracts/containers.js";
import { ContainerService } from "../../src/core/container-service.js";

const work = Object.freeze({
  cookieStoreId: "firefox-container-1",
  name: "Work",
  color: "blue",
  icon: "briefcase",
  colorCode: "#37adff"
});

function memoryStorage(initialValue) {
  let value = structuredClone(initialValue);
  return {
    value: () => structuredClone(value),
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); }
  };
}

function fakeBrowser({ capability = CONTAINER_CAPABILITIES.AVAILABLE, identities = [work] } = {}) {
  let live = structuredClone(identities);
  let listener;
  let nextContainerId = 2;
  return {
    setLive(next) { live = structuredClone(next); },
    emit(type) { listener?.(type); },
    async capability() { return capability; },
    async list() { return structuredClone(live); },
    async supportedOptions() {
      return {
        colors: [{ color: "blue", colorCode: "#37adff" }],
        icons: [{
          icon: "briefcase",
          iconUrl: "resource://usercontext-content/briefcase.svg"
        }]
      };
    },
    async create(descriptor) {
      const created = { cookieStoreId: `firefox-container-${nextContainerId++}`, ...descriptor };
      live.push(created);
      return structuredClone(created);
    },
    subscribe(nextListener) { listener = nextListener; return () => { listener = null; }; }
  };
}

test("overview reconciles native identities to logical references without exposing native IDs", async () => {
  const storage = memoryStorage(undefined);
  const service = new ContainerService({
    storage,
    browserAdapter: fakeBrowser(),
    idGenerator: () => "work"
  });
  const overview = await service.overview();
  assert.equal(overview.capability, "available");
  assert.deepEqual(overview.containers, [{
    refId: "ctr-work",
    canonicalRefId: "ctr-work",
    descriptor: {
      name: "Work",
      color: "blue",
      icon: "briefcase",
      colorCode: "#37adff"
    },
    status: "available"
  }]);
  assert.deepEqual(overview.supportedColorOptions, [{
    color: "blue",
    colorCode: "#37adff"
  }]);
  assert.deepEqual(overview.supportedIconOptions, [{
    icon: "briefcase",
    iconUrl: "resource://usercontext-content/briefcase.svg"
  }]);
  assert.equal(JSON.stringify(overview).includes("firefox-container-1"), false);
  assert.equal(storage.value().bindings[0].cookieStoreId, "firefox-container-1");
});

test("an unchanged native registry is observed without rewriting local state", async () => {
  let writes = 0;
  const stored = {
    schemaVersion: 1,
    bindings: [{
      refId: "ctr-work",
      descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" },
      cookieStoreId: "firefox-container-1"
    }]
  };
  const service = new ContainerService({
    storage: {
      async read() { return structuredClone(stored); },
      async write() { writes += 1; }
    },
    browserAdapter: fakeBrowser()
  });

  await service.overview();
  await service.overview();

  assert.equal(writes, 0);
});

test("rename updates descriptors and deletion retains an unavailable reference", async () => {
  const storage = memoryStorage(undefined);
  const browser = fakeBrowser();
  const service = new ContainerService({ storage, browserAdapter: browser, idGenerator: () => "work" });
  await service.overview();
  browser.setLive([{ ...work, name: "Employment", color: "red", colorCode: "#ff613d" }]);
  let overview = await service.refresh();
  assert.equal(overview.containers[0].descriptor.name, "Employment");
  browser.setLive([]);
  overview = await service.refresh();
  assert.equal(overview.containers[0].status, "unavailable");
  assert.equal(storage.value().bindings[0].cookieStoreId, null);
});

test("authoritative native deletion reports every logical alias before clearing bindings", async () => {
  const storage = memoryStorage({
    schemaVersion: 1,
    bindings: [
      {
        refId: "ctr-work",
        descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" },
        cookieStoreId: "firefox-container-1"
      },
      {
        refId: "ctr-work-alias",
        descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" },
        cookieStoreId: "firefox-container-1"
      }
    ]
  });
  const removed = [];
  const service = new ContainerService({
    storage,
    browserAdapter: fakeBrowser({ identities: [] }),
    async onBindingsRemoved(refIds) {
      removed.push([...refIds]);
      assert.ok(storage.value().bindings.every(({ cookieStoreId }) => cookieStoreId !== null));
    }
  });

  await service.refresh();

  assert.deepEqual(removed, [["ctr-work", "ctr-work-alias"]]);
  assert.ok(storage.value().bindings.every(({ cookieStoreId }) => cookieStoreId === null));
});

test("silent refresh reconciles cache state without emitting a change notification", async () => {
  let notifications = 0;
  const service = new ContainerService({
    storage: memoryStorage(undefined),
    browserAdapter: fakeBrowser({ identities: [] })
  });
  service.start(() => { notifications += 1; });

  const overview = await service.refresh({ notify: false });

  assert.equal(overview.capability, CONTAINER_CAPABILITIES.AVAILABLE);
  assert.equal(notifications, 0);
});

test("change notifications can safely request a fresh overview", { timeout: 1_000 }, async () => {
  let callbackOverview = null;
  const service = new ContainerService({
    storage: memoryStorage(undefined),
    browserAdapter: fakeBrowser({ identities: [] })
  });
  service.start(async () => {
    callbackOverview = await service.overview();
  });

  await service.refresh();

  assert.equal(callbackOverview.capability, CONTAINER_CAPABILITIES.AVAILABLE);
});

test("create validates through the adapter and returns a logical reference", async () => {
  const storage = memoryStorage(undefined);
  const service = new ContainerService({
    storage,
    browserAdapter: fakeBrowser({ identities: [] }),
    idGenerator: () => "created"
  });
  const created = await service.create({
    name: "Created",
    color: "blue",
    icon: "briefcase",
    colorCode: null
  });
  assert.equal(created.refId, "ctr-created");
  assert.equal(JSON.stringify(created).includes("firefox-container-2"), false);
  assert.equal(await service.resolve("ctr-created"), "firefox-container-2");
});

test("create preserves a Terminus display icon separately from Firefox's native icon", async () => {
  const service = new ContainerService({
    storage: memoryStorage(undefined),
    browserAdapter: fakeBrowser({ identities: [] }),
    idGenerator: () => "display-icon"
  });
  const created = await service.create({
    name: "Shopping",
    color: "blue",
    icon: "briefcase",
    sidebarsIcon: "cart",
    colorCode: null
  });

  assert.equal(created.descriptor.icon, "briefcase");
  assert.equal(created.descriptor.sidebarsIcon, "cart");
  assert.equal((await service.overview()).containers[0].descriptor.sidebarsIcon, "cart");
});

test("container names may duplicate container and workspace labels", async () => {
  const service = new ContainerService({
    storage: memoryStorage(undefined),
    browserAdapter: fakeBrowser(),
    workspaceNameProvider: async () => {
      throw new Error("Duplicate-name checks must not query workspaces.");
    }
  });

  const first = await service.create({
    name: " Work ",
    color: "blue",
    icon: "briefcase",
    colorCode: null
  });
  const second = await service.create({
    name: "Work",
    color: "blue",
    icon: "briefcase",
    colorCode: null
  });
  const third = await service.create({
    name: "Personal",
    color: "blue",
    icon: "briefcase",
    colorCode: null
  });

  assert.equal(first.descriptor.name, "Work");
  assert.equal(second.descriptor.name, "Work");
  assert.equal(third.descriptor.name, "Personal");
  assert.equal((await service.overview()).containers.filter(
    ({ descriptor }) => descriptor.name === "Work"
  ).length, 3);
});

test("presentation choices collapse aliases of the same Firefox identity", async () => {
  const storage = memoryStorage({
    schemaVersion: 1,
    bindings: [
      {
        refId: "ctr-work",
        descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" },
        cookieStoreId: "firefox-container-1"
      },
      {
        refId: "ctr-imported",
        descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" },
        cookieStoreId: "firefox-container-1"
      }
    ]
  });
  const service = new ContainerService({ storage, browserAdapter: fakeBrowser() });
  const overview = await service.overview();

  assert.equal(overview.containers.length, 2);
  assert.ok(overview.containers.every(({ canonicalRefId }) => canonicalRefId === "ctr-work"));
  assert.deepEqual(
    uniqueAvailableContainerEntries(overview.containers).map(({ refId }) => refId),
    ["ctr-work"]
  );
  assert.deepEqual(
    uniqueAvailableContainerEntries(overview.containers, "ctr-imported").map(({ refId }) => refId),
    ["ctr-imported"]
  );
  assert.equal(JSON.stringify(overview).includes("firefox-container-1"), false);
});

test("permission loss preserves local bindings but marks them unavailable", async () => {
  const storage = memoryStorage({
    schemaVersion: 1,
    bindings: [{
      refId: "ctr-work",
      descriptor: { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" },
      cookieStoreId: "firefox-container-1"
    }]
  });
  const service = new ContainerService({
    storage,
    browserAdapter: fakeBrowser({ capability: CONTAINER_CAPABILITIES.PERMISSION_REQUIRED }),
    onBindingsRemoved() {
      assert.fail("Permission loss must not be treated as native container deletion.");
    }
  });
  const overview = await service.overview();
  assert.equal(overview.capability, "permission-required");
  assert.equal(overview.containers[0].status, "unavailable");
  assert.equal(storage.value().bindings[0].cookieStoreId, "firefox-container-1");
});

test("container state writes are verified before becoming authoritative", async () => {
  const storage = {
    async read() { return undefined; },
    async write() {}
  };
  const service = new ContainerService({
    storage,
    browserAdapter: fakeBrowser({ identities: [] })
  });
  await assert.rejects(
    service.overview(),
    (error) => error.code === CONTAINER_ERROR_CODES.STORAGE_UNAVAILABLE
  );
});

test("container lifecycle event bursts coalesce and retain the final refresh", async () => {
  let listener;
  let releaseFirstList;
  let listCalls = 0;
  let notifications = 0;
  const firstListStarted = new Promise((resolve) => {
    releaseFirstList = () => {};
    const browser = {
      async capability() { return CONTAINER_CAPABILITIES.AVAILABLE; },
      async list() {
        listCalls += 1;
        if (listCalls === 1) {
          await new Promise((release) => {
            releaseFirstList = release;
            resolve();
          });
        }
        return [];
      },
      subscribe(next) { listener = next; return () => { listener = null; }; }
    };
    const service = new ContainerService({
      storage: memoryStorage(undefined),
      browserAdapter: browser
    });
    service.start(() => { notifications += 1; });
    listener();
    listener();
    listener();
  });

  await firstListStarted;
  listener();
  listener();
  releaseFirstList();
  while (listCalls < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listCalls, 2);
  assert.equal(notifications, 2);
});

test("imported references remain unavailable until explicitly aliased", async () => {
  const storage = memoryStorage({
    schemaVersion: 1,
    bindings: [{
      refId: "ctr-local",
      descriptor: {
        name: "Local",
        color: "blue",
        icon: "briefcase",
        colorCode: "#37adff"
      },
      cookieStoreId: "firefox-container-1"
    }]
  });
  const service = new ContainerService({ storage, browserAdapter: fakeBrowser() });
  await service.importCatalog([{ refId: "ctr-imported", descriptor: {
    name: "Imported",
    color: "blue",
    icon: "briefcase",
    colorCode: "#37adff"
  } }]);
  await assert.rejects(
    service.resolve("ctr-imported"),
    (error) => error.code === CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE
  );

  await service.bindReference("ctr-imported", "ctr-local");
  assert.equal(await service.resolve("ctr-imported"), "firefox-container-1");
  assert.equal(storage.value().bindings.filter(
    ({ cookieStoreId }) => cookieStoreId === "firefox-container-1"
  ).length, 2);
});

test("explicit default stores map to No Container without optional permissions", async () => {
  const service = new ContainerService({
    storage: memoryStorage(undefined),
    browserAdapter: fakeBrowser({ capability: CONTAINER_CAPABILITIES.PERMISSION_REQUIRED })
  });
  assert.deepEqual(await service.assignmentForCookieStore("firefox-default"), { kind: "none" });
  assert.deepEqual(await service.assignmentForCookieStore("firefox-private"), { kind: "none" });
});

test("revoked permission cannot turn previously used container tabs into No Container", async () => {
  const service = new ContainerService({
    storage: memoryStorage({
      schemaVersion: 1,
      bindings: [{
        refId: "ctr-work",
        descriptor: {
          name: "Work",
          color: "blue",
          icon: "briefcase",
          colorCode: "#37adff"
        },
        cookieStoreId: "firefox-container-1"
      }]
    }),
    browserAdapter: fakeBrowser({ capability: CONTAINER_CAPABILITIES.PERMISSION_REQUIRED })
  });
  await assert.rejects(
    service.assignmentsForCookieStores([undefined, "firefox-default"]),
    (error) => error.code === CONTAINER_ERROR_CODES.PERMISSION_REQUIRED
  );
});

test("invalid future registry data fails closed without an initialization write", async () => {
  let writes = 0;
  const service = new ContainerService({
    storage: {
      async read() { return { schemaVersion: 2, bindings: [] }; },
      async write() { writes += 1; }
    },
    browserAdapter: fakeBrowser({ capability: CONTAINER_CAPABILITIES.PERMISSION_REQUIRED })
  });
  await assert.rejects(
    service.overview(),
    (error) => error.code === CONTAINER_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
  );
  assert.equal(writes, 0);
});

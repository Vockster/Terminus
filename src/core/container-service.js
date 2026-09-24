import {
  CONTAINER_CAPABILITIES,
  CONTAINER_ERROR_CODES,
  CONTAINER_STATE_SCHEMA_VERSION,
  CONTAINER_STATUSES,
  ContainerError,
  createEmptyContainerState,
  invalidContainerRequest,
  noContainerAssignment,
  parseContainerDescriptor,
  parseContainerCatalog,
  parseContainerRefId,
  parseContainerState,
  projectContainerCatalog
} from "../contracts/containers.js";
import { createSerialOperationExecutor } from "./serial-operation-executor.js";

function storageUnavailable(cause) {
  return new ContainerError(CONTAINER_ERROR_CODES.STORAGE_UNAVAILABLE, undefined, { cause });
}

function defaultIdGenerator() {
  return globalThis.crypto.randomUUID();
}

function isDefaultCookieStore(cookieStoreId) {
  return typeof cookieStoreId !== "string" ||
    cookieStoreId === "firefox-default" ||
    cookieStoreId === "firefox-private";
}

export class ContainerService {
  #storage;
  #browser;
  #idGenerator;
  #executor = createSerialOperationExecutor();
  #notificationTail = Promise.resolve();
  #initialized = null;
  #unsubscribe = null;
  #onChanged = null;
  #onBindingsRemoved = null;
  #refreshRunning = false;
  #refreshQueued = false;
  #cachedState = createEmptyContainerState();
  #cachedCapability = CONTAINER_CAPABILITIES.PERMISSION_REQUIRED;

  constructor({
    storage,
    browserAdapter,
    idGenerator = defaultIdGenerator,
    onBindingsRemoved = null
  }) {
    this.#storage = storage;
    this.#browser = browserAdapter;
    this.#idGenerator = idGenerator;
    this.#onBindingsRemoved = typeof onBindingsRemoved === "function"
      ? onBindingsRemoved
      : null;
  }

  start(onChanged = null) {
    if (this.#unsubscribe) return;
    this.#onChanged = typeof onChanged === "function" ? onChanged : null;
    this.#unsubscribe = this.#browser.subscribe(() => this.#browserEventHint());
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#onChanged = null;
  }

  #browserEventHint() {
    this.#refreshQueued = true;
    if (this.#refreshRunning) return;
    this.#refreshRunning = true;
    void (async () => {
      try {
        do {
          this.#refreshQueued = false;
          await this.refresh().catch(() => undefined);
        } while (this.#refreshQueued);
      } finally {
        this.#refreshRunning = false;
      }
    })();
  }

  overview({ privateContext = false } = {}) {
    return this.#executor.run(async () => {
      const capability = await this.#browser.capability({ privateContext });
      const state = capability === CONTAINER_CAPABILITIES.AVAILABLE
        ? await this.#reconcile()
        : await this.#load();
      const options = capability === CONTAINER_CAPABILITIES.AVAILABLE
        ? await this.#browser.supportedOptions()
        : { colors: [], icons: [] };
      return this.#publicOverview(state, capability, options);
    });
  }

  async refresh({ notify = true } = {}) {
    if (typeof notify !== "boolean") {
      throw invalidContainerRequest("The refresh notification option is invalid.");
    }
    const overview = await this.#executor.run(async () => {
      const capability = await this.#browser.capability();
      const state = capability === CONTAINER_CAPABILITIES.AVAILABLE
        ? await this.#reconcile()
        : await this.#load();
      return this.#publicOverview(state, capability, { colors: [], icons: [] });
    });
    if (notify) await this.#notify(overview);
    return overview;
  }

  async create(rawDescriptor) {
    const { result, overview } = await this.#executor.run(async () => {
      const descriptor = parseContainerDescriptor(rawDescriptor, invalidContainerRequest);
      const capability = await this.#browser.capability();
      if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
        throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
      }
      const state = await this.#reconcile();
      const native = await this.#browser.create(descriptor);
      const existing = state.bindings.find(({ cookieStoreId }) => cookieStoreId === native.cookieStoreId);
      const binding = existing ?? {
        refId: this.#createRef(new Set(state.bindings.map(({ refId }) => refId))),
        descriptor: this.#descriptorFromNative(native, descriptor.sidebarsIcon),
        cookieStoreId: native.cookieStoreId
      };
      const bindings = existing
        ? state.bindings.map((entry) => entry.refId === existing.refId
          ? { ...entry, descriptor: this.#descriptorFromNative(native, descriptor.sidebarsIcon) }
          : entry)
        : [...state.bindings, binding];
      const written = await this.#write({ schemaVersion: CONTAINER_STATE_SCHEMA_VERSION, bindings });
      return {
        result: { refId: binding.refId, descriptor: binding.descriptor },
        overview: this.#publicOverview(
          written,
          CONTAINER_CAPABILITIES.AVAILABLE,
          { colors: [], icons: [] }
        )
      };
    });
    await this.#notify(overview);
    return result;
  }

  assignmentForCookieStore(cookieStoreId) {
    return this.#executor.run(async () => {
      if (isDefaultCookieStore(cookieStoreId)) return noContainerAssignment();
      const capability = await this.#browser.capability();
      if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
        throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
      }
      const state = await this.#reconcile();
      const binding = state.bindings.find((entry) => entry.cookieStoreId === cookieStoreId);
      if (!binding) throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
      return { kind: "container", refId: binding.refId };
    });
  }

  assignmentsForCookieStores(cookieStoreIds) {
    return this.#executor.run(async () => {
      if (!Array.isArray(cookieStoreIds)) {
        throw invalidContainerRequest("Container assignments must be an array.");
      }
      const requiresContainers = cookieStoreIds.some((cookieStoreId) =>
        !isDefaultCookieStore(cookieStoreId)
      );
      if (!requiresContainers) {
        const state = await this.#load();
        if (state.bindings.length > 0) {
          const capability = await this.#browser.capability();
          if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
            throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
          }
        }
        return cookieStoreIds.map(() => noContainerAssignment());
      }
      const capability = await this.#browser.capability();
      if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
        throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
      }
      const state = await this.#reconcile();
      const byNative = new Map(state.bindings.flatMap((entry) =>
        entry.cookieStoreId === null ? [] : [[entry.cookieStoreId, entry.refId]]
      ));
      return cookieStoreIds.map((cookieStoreId) => {
        if (isDefaultCookieStore(cookieStoreId)) return noContainerAssignment();
        const refId = byNative.get(cookieStoreId);
        if (!refId) throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
        return { kind: "container", refId };
      });
    });
  }

  resolve(refId) {
    return this.#executor.run(async () => {
      const parsedRef = parseContainerRefId(refId, invalidContainerRequest);
      const capability = await this.#browser.capability();
      if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
        throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
      }
      const state = await this.#reconcile();
      const binding = state.bindings.find((entry) => entry.refId === parsedRef);
      if (!binding?.cookieStoreId) {
        throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
      }
      return binding.cookieStoreId;
    });
  }

  bindReference(refId, targetRefId) {
    return this.#executor.run(async () => {
      const parsedRef = parseContainerRefId(refId, invalidContainerRequest);
      const parsedTarget = parseContainerRefId(targetRefId, invalidContainerRequest);
      const capability = await this.#browser.capability();
      if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
        throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
      }
      const state = await this.#reconcile();
      const target = state.bindings.find((entry) => entry.refId === parsedTarget);
      if (!target?.cookieStoreId) {
        throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE);
      }
      const bindings = state.bindings.filter((entry) => entry.refId !== parsedRef);
      bindings.push({
        refId: parsedRef,
        descriptor: { ...target.descriptor },
        cookieStoreId: target.cookieStoreId
      });
      await this.#write({ schemaVersion: CONTAINER_STATE_SCHEMA_VERSION, bindings });
      return { refId: parsedRef, descriptor: { ...target.descriptor } };
    });
  }

  async recreateReference(refId, rawDescriptor) {
    const { result, overview } = await this.#executor.run(async () => {
      const parsedRef = parseContainerRefId(refId, invalidContainerRequest);
      const descriptor = parseContainerDescriptor(rawDescriptor, invalidContainerRequest);
      const capability = await this.#browser.capability();
      if (capability !== CONTAINER_CAPABILITIES.AVAILABLE) {
        throw new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
      }
      const state = await this.#reconcile();
      const current = state.bindings.find((entry) => entry.refId === parsedRef);
      if (current?.cookieStoreId) {
        throw invalidContainerRequest("An available container reference cannot be recreated.");
      }
      const native = await this.#browser.create(descriptor);
      const bindings = state.bindings.filter((entry) => entry.refId !== parsedRef);
      bindings.push({
        refId: parsedRef,
          descriptor: this.#descriptorFromNative(native, descriptor.sidebarsIcon),
        cookieStoreId: native.cookieStoreId
      });
      const written = await this.#write({ schemaVersion: CONTAINER_STATE_SCHEMA_VERSION, bindings });
      return {
        result: {
          refId: parsedRef,
          descriptor: this.#descriptorFromNative(native, descriptor.sidebarsIcon)
        },
        overview: this.#publicOverview(
          written,
          CONTAINER_CAPABILITIES.AVAILABLE,
          { colors: [], icons: [] }
        )
      };
    });
    await this.#notify(overview);
    return result;
  }

  importCatalog(rawCatalog) {
    return this.#executor.run(async () => {
      const catalog = parseContainerCatalog(rawCatalog, invalidContainerRequest);
      const state = await this.#load();
      const byRef = new Map(state.bindings.map((entry) => [entry.refId, entry]));
      const bindings = [...state.bindings];
      for (const entry of catalog) {
        const existing = byRef.get(entry.refId);
        if (existing) {
          if (JSON.stringify(existing.descriptor) !== JSON.stringify(entry.descriptor)) {
            throw invalidContainerRequest(
              "An imported container reference conflicts with local container data."
            );
          }
          continue;
        }
        const binding = {
          refId: entry.refId,
          descriptor: entry.descriptor,
          cookieStoreId: null
        };
        bindings.push(binding);
        byRef.set(entry.refId, binding);
      }
      const written = await this.#write({
        schemaVersion: CONTAINER_STATE_SCHEMA_VERSION,
        bindings
      });
      return this.#publicOverview(written, this.#cachedCapability, { colors: [], icons: [] });
    });
  }

  projectCatalog(refIds) {
    return this.#executor.run(async () => {
      const state = await this.#load();
      return projectContainerCatalog(refIds, state.bindings);
    });
  }

  presentationForCookieStore(cookieStoreId) {
    if (typeof cookieStoreId !== "string") return noContainerAssignment();
    const binding = this.#cachedState.bindings.find(
      (entry) => entry.cookieStoreId === cookieStoreId
    );
    if (!binding) return noContainerAssignment();
    return {
      kind: "container",
      refId: binding.refId,
      descriptor: { ...binding.descriptor },
      status:
        this.#cachedCapability === CONTAINER_CAPABILITIES.AVAILABLE
          ? CONTAINER_STATUSES.AVAILABLE
          : CONTAINER_STATUSES.UNAVAILABLE
    };
  }

  presentationForRef(refId) {
    if (refId === null) return noContainerAssignment();
    const binding = this.#cachedState.bindings.find((entry) => entry.refId === refId);
    if (!binding) {
      return { kind: "container", refId, descriptor: null, status: CONTAINER_STATUSES.UNAVAILABLE };
    }
    return {
      kind: "container",
      refId: binding.refId,
      descriptor: { ...binding.descriptor },
      status:
        this.#cachedCapability === CONTAINER_CAPABILITIES.AVAILABLE &&
        binding.cookieStoreId !== null
          ? CONTAINER_STATUSES.AVAILABLE
          : CONTAINER_STATUSES.UNAVAILABLE
    };
  }

  async #load() {
    if (!this.#initialized) {
      this.#initialized = (async () => {
        let raw;
        try {
          raw = await this.#storage.read();
        } catch (error) {
          throw storageUnavailable(error);
        }
        if (raw === undefined) return this.#write(createEmptyContainerState());
        return parseContainerState(raw);
      })();
      this.#initialized.catch(() => {
        this.#initialized = null;
      });
    }
    return parseContainerState(await this.#initialized);
  }

  async #write(rawState) {
    const state = parseContainerState(rawState);
    let persisted;
    try {
      await this.#storage.write(state);
      persisted = parseContainerState(await this.#storage.read());
    } catch (error) {
      throw storageUnavailable(error);
    }
    if (JSON.stringify(persisted) !== JSON.stringify(state)) {
      throw storageUnavailable(new Error("Container state did not verify after persistence."));
    }
    this.#initialized = Promise.resolve(persisted);
    this.#cachedState = persisted;
    return parseContainerState(persisted);
  }

  async #reconcile() {
    this.#cachedCapability = CONTAINER_CAPABILITIES.AVAILABLE;
    const [state, live] = await Promise.all([this.#load(), this.#browser.list()]);
    const byNative = new Map(live.map((identity) => [identity.cookieStoreId, identity]));
    const claimed = new Set(state.bindings.flatMap(({ cookieStoreId }) =>
      cookieStoreId === null ? [] : [cookieStoreId]
    ));
    const usedRefs = new Set(state.bindings.map(({ refId }) => refId));
    const removedRefIds = state.bindings
      .filter(({ cookieStoreId }) => cookieStoreId !== null && !byNative.has(cookieStoreId))
      .map(({ refId }) => refId);
    const bindings = state.bindings.map((entry) => {
      const native = entry.cookieStoreId === null ? null : byNative.get(entry.cookieStoreId);
      return native
        ? {
            ...entry,
            descriptor: this.#descriptorFromNative(native, entry.descriptor.sidebarsIcon)
          }
        : { ...entry, cookieStoreId: null };
    });
    for (const native of live) {
      if (claimed.has(native.cookieStoreId)) continue;
      bindings.push({
        refId: this.#createRef(usedRefs),
        descriptor: this.#descriptorFromNative(native),
        cookieStoreId: native.cookieStoreId
      });
    }
    const reconciled = parseContainerState({
      schemaVersion: CONTAINER_STATE_SCHEMA_VERSION,
      bindings
    });
    if (JSON.stringify(reconciled) === JSON.stringify(state)) {
      this.#cachedState = state;
      return state;
    }
    if (removedRefIds.length > 0) {
      await this.#onBindingsRemoved?.(removedRefIds);
    }
    return this.#write(reconciled);
  }

  #notify(overview) {
    const operation = this.#notificationTail.then(() => this.#onChanged?.(overview));
    this.#notificationTail = operation.catch(() => undefined);
    return operation;
  }

  #publicOverview(state, capability, options) {
    this.#cachedState = state;
    this.#cachedCapability = capability;
    const supportedColorOptions = options.colors.map((entry) => ({ ...entry }));
    const supportedIconOptions = options.icons.map((entry) => ({ ...entry }));
    const canonicalRefs = new Map();
    for (const { refId, cookieStoreId } of state.bindings) {
      if (cookieStoreId !== null && !canonicalRefs.has(cookieStoreId)) {
        canonicalRefs.set(cookieStoreId, refId);
      }
    }
    return {
      capability,
      containers: state.bindings.map(({ refId, descriptor, cookieStoreId }) => ({
        refId,
        canonicalRefId: cookieStoreId === null ? refId : canonicalRefs.get(cookieStoreId),
        descriptor,
        status:
          capability === CONTAINER_CAPABILITIES.AVAILABLE && cookieStoreId !== null
            ? CONTAINER_STATUSES.AVAILABLE
            : CONTAINER_STATUSES.UNAVAILABLE
      })),
      supportedColors: supportedColorOptions.map(({ color }) => color),
      supportedIcons: supportedIconOptions.map(({ icon }) => icon),
      supportedColorOptions,
      supportedIconOptions
    };
  }

  #descriptorFromNative(native, sidebarsIcon = undefined) {
    const descriptor = {
      name: native.name,
      color: native.color,
      icon: native.icon,
      colorCode: native.colorCode
    };
    if (sidebarsIcon !== undefined) descriptor.sidebarsIcon = sidebarsIcon;
    return descriptor;
  }

  #createRef(usedRefs) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const refId = `ctr-${this.#idGenerator()}`.toLowerCase();
      if (/^ctr-[a-z0-9][a-z0-9-]{0,123}$/.test(refId) && !usedRefs.has(refId)) {
        usedRefs.add(refId);
        return refId;
      }
    }
    throw new ContainerError(CONTAINER_ERROR_CODES.INVALID_STATE);
  }
}

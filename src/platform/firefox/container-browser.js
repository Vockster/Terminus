import {
  CONTAINER_CAPABILITIES,
  CONTAINER_ERROR_CODES,
  ContainerError,
  invalidContainerRequest,
  parseContainerDescriptor,
  parseNativeContainer,
  parseSupportedContainerColor,
  parseSupportedContainerIcon
} from "../../contracts/containers.js";

export const CONTAINER_REQUIRED_PERMISSIONS = Object.freeze(["contextualIdentities"]);
export const CONTAINER_OPTIONAL_PERMISSIONS = Object.freeze(["cookies"]);

function unsupported() {
  return new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED);
}

function permissionRequired() {
  return new ContainerError(CONTAINER_ERROR_CODES.PERMISSION_REQUIRED);
}

const LEGACY_COLOR_ALIASES = Object.freeze({
  toolbar: "gray",
  turquoise: "cyan"
});

function uniqueSupportedOptions(values, key) {
  const unique = new Map();
  for (const value of values) {
    const existing = unique.get(value[key]);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw unsupported();
    }
    unique.set(value[key], value);
  }
  return [...unique.values()];
}

function normalizeNativeIdentity(value) {
  return parseNativeContainer({
    cookieStoreId: value?.cookieStoreId,
    name: value?.name,
    color: value?.color,
    icon: value?.icon,
    colorCode: typeof value?.colorCode === "string" ? value.colorCode : null
  });
}

function validateSupportedUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 65536) {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
  }
  if (!["http:", "https:", "ftp:", "file:"].includes(parsed.protocol) && value !== "about:blank") {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_URL);
  }
  return value;
}

export function createFirefoxContainerBrowser(browserApi) {
  const identities = browserApi.contextualIdentities;
  const permissions = browserApi.permissions;

  async function capability({ privateContext = false } = {}) {
    if (privateContext) return CONTAINER_CAPABILITIES.PRIVATE_UNAVAILABLE;
    if (!identities || !permissions?.contains) return CONTAINER_CAPABILITIES.UNSUPPORTED;
    const [contextual, cookies] = await Promise.all([
      permissions.contains({ permissions: [...CONTAINER_REQUIRED_PERMISSIONS] }),
      permissions.contains({ permissions: [...CONTAINER_OPTIONAL_PERMISSIONS] })
    ]);
    if (contextual && cookies) return CONTAINER_CAPABILITIES.AVAILABLE;
    if (contextual || cookies) return CONTAINER_CAPABILITIES.PARTIAL_PERMISSION;
    return CONTAINER_CAPABILITIES.PERMISSION_REQUIRED;
  }

  async function assertAvailable(options) {
    const state = await capability(options);
    if (state === CONTAINER_CAPABILITIES.AVAILABLE) return;
    if (state === CONTAINER_CAPABILITIES.UNSUPPORTED) throw unsupported();
    if (state === CONTAINER_CAPABILITIES.PRIVATE_UNAVAILABLE) {
      throw new ContainerError(CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE);
    }
    throw permissionRequired();
  }

  async function list() {
    await assertAvailable();
    return (await identities.query({})).map(normalizeNativeIdentity);
  }

  async function supportedOptions() {
    await assertAvailable();
    if (
      typeof identities.getSupportedColors !== "function" ||
      typeof identities.getSupportedIcons !== "function"
    ) {
      throw unsupported();
    }
    const [colors, icons] = await Promise.all([
      identities.getSupportedColors(),
      identities.getSupportedIcons()
    ]);
    if (!Array.isArray(colors) || !Array.isArray(icons)) {
      throw unsupported();
    }
    return {
      colors: uniqueSupportedOptions(
        colors.map((value) => parseSupportedContainerColor(value, unsupported)),
        "color"
      ),
      icons: uniqueSupportedOptions(
        icons.map((value) => parseSupportedContainerIcon(value, unsupported)),
        "icon"
      )
    };
  }

  async function create(rawDescriptor) {
    const descriptor = parseContainerDescriptor(rawDescriptor, invalidContainerRequest);
    const options = await supportedOptions();
    const supportedColors = new Set(options.colors.map(({ color }) => color));
    const supportedIcons = new Set(options.icons.map(({ icon }) => icon));
    const aliasedColor = LEGACY_COLOR_ALIASES[descriptor.color] ?? descriptor.color;
    const color = supportedColors.has(descriptor.color)
      ? descriptor.color
      : supportedColors.has(aliasedColor)
        ? aliasedColor
        : null;
    if (color === null || !supportedIcons.has(descriptor.icon)) {
      throw invalidContainerRequest("The selected color or icon is unsupported.");
    }
    return normalizeNativeIdentity(await identities.create({
      name: descriptor.name,
      color,
      icon: descriptor.icon
    }));
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("A container listener is required.");
    const subscriptions = [];
    const add = (event, type, mapEvent = () => type) => {
      if (!event?.addListener) return;
      const handler = (value) => listener(mapEvent(value));
      event.addListener(handler);
      subscriptions.push(() => event.removeListener(handler));
    };
    add(identities?.onCreated, "identity-created");
    add(identities?.onUpdated, "identity-updated");
    add(identities?.onRemoved, "identity-removed", (identity) => ({
      kind: "identity-removed",
      cookieStoreId: typeof identity?.cookieStoreId === "string"
        ? identity.cookieStoreId
        : null
    }));
    add(permissions?.onAdded, "permission-added");
    add(permissions?.onRemoved, "permission-removed");
    return () => {
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    };
  }

  async function getTab(tabId) {
    if (!Number.isInteger(tabId)) throw invalidContainerRequest("The tab ID is invalid.");
    const tab = await browserApi.tabs.get(tabId);
    if (tab?.incognito === true) {
      throw new ContainerError(CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE);
    }
    return tab;
  }

  async function createTab({ windowId, index, active = true, url, cookieStoreId = null }) {
    await assertAvailable();
    if (!Number.isInteger(windowId) || (index !== undefined && !Number.isInteger(index))) {
      throw invalidContainerRequest("The tab placement is invalid.");
    }
    const createProperties = { windowId, active };
    if (index !== undefined) createProperties.index = index;
    if (url !== undefined) createProperties.url = validateSupportedUrl(url);
    if (cookieStoreId !== null) createProperties.cookieStoreId = cookieStoreId;
    const created = await browserApi.tabs.create(createProperties);
    if (created?.cookieStoreId !== (cookieStoreId ?? "firefox-default")) {
      if (Number.isInteger(created?.id)) {
        await browserApi.tabs.remove(created.id).catch(() => undefined);
      }
      throw new ContainerError(CONTAINER_ERROR_CODES.CONTAINER_MISMATCH);
    }
    return created;
  }

  return Object.freeze({
    capability,
    assertAvailable,
    list,
    supportedOptions,
    create,
    subscribe,
    getTab,
    createTab,
    validateSupportedUrl
  });
}

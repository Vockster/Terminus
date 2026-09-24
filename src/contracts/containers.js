export const CONTAINER_STATE_SCHEMA_VERSION = 1;
export const CONTAINER_STATE_STORAGE_KEY = "containerState";
export const MAX_CONTAINER_BINDINGS = 256;
export const MAX_CONTAINER_NAME_LENGTH = 80;
export const MAX_CONTAINER_TOKEN_LENGTH = 64;
export const MAX_CONTAINER_ICON_URL_LENGTH = 4096;

export const CONTAINER_CAPABILITIES = Object.freeze({
  AVAILABLE: "available",
  PERMISSION_REQUIRED: "permission-required",
  PERMISSION_DENIED: "permission-denied",
  PARTIAL_PERMISSION: "partial-permission",
  UNSUPPORTED: "unsupported",
  PRIVATE_UNAVAILABLE: "private-unavailable"
});

export const CONTAINER_STATUSES = Object.freeze({
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable"
});

export const CONTAINER_RESOLUTION_ACTIONS = Object.freeze({
  EXISTING: "existing",
  RECREATE: "recreate",
  NONE: "none",
  SKIP: "skip"
});

export const CONTAINER_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_STATE: "INVALID_STATE",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  PERMISSION_REQUIRED: "PERMISSION_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNSUPPORTED: "UNSUPPORTED",
  PRIVATE_UNAVAILABLE: "PRIVATE_UNAVAILABLE",
  CONTAINER_UNAVAILABLE: "CONTAINER_UNAVAILABLE",
  CONTAINER_MISMATCH: "CONTAINER_MISMATCH",
  UNSUPPORTED_URL: "UNSUPPORTED_URL",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export const CONTAINER_ERROR_MESSAGES = Object.freeze({
  [CONTAINER_ERROR_CODES.INVALID_REQUEST]: "The container request is invalid.",
  [CONTAINER_ERROR_CODES.INVALID_STATE]:
    "Stored container data is invalid and was not changed.",
  [CONTAINER_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION]:
    "Stored container data uses an unsupported schema version and was not changed.",
  [CONTAINER_ERROR_CODES.STORAGE_UNAVAILABLE]:
    "Container storage is unavailable. Stored data was not changed.",
  [CONTAINER_ERROR_CODES.PERMISSION_REQUIRED]:
    "Container support needs Firefox contextual identity access and the optional cookies permission.",
  [CONTAINER_ERROR_CODES.PERMISSION_DENIED]:
    "Firefox did not grant the optional cookies permission.",
  [CONTAINER_ERROR_CODES.UNSUPPORTED]:
    "Firefox container support is unavailable in this browser.",
  [CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE]:
    "Firefox containers are unavailable in private windows.",
  [CONTAINER_ERROR_CODES.CONTAINER_UNAVAILABLE]:
    "The selected Firefox container is unavailable.",
  [CONTAINER_ERROR_CODES.CONTAINER_MISMATCH]:
    "Firefox did not create the tab in the requested container.",
  [CONTAINER_ERROR_CODES.UNSUPPORTED_URL]:
    "This page cannot be copied into another container.",
  [CONTAINER_ERROR_CODES.INTERNAL_ERROR]: "The container operation could not be completed."
});

export function uniqueAvailableContainerEntries(containers, preferredRefId = null) {
  const byIdentity = new Map();
  for (const entry of containers) {
    if (entry.status !== CONTAINER_STATUSES.AVAILABLE) continue;
    const key = entry.canonicalRefId ?? entry.refId;
    const current = byIdentity.get(key);
    if (!current || entry.refId === preferredRefId) {
      byIdentity.set(key, entry);
    }
  }
  return [...byIdentity.values()];
}

const REF_ID_PATTERN = /^ctr-[a-z0-9][a-z0-9-]{0,123}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLOR_CODE_PATTERN = /^#[0-9a-f]{6}$/i;

export class ContainerError extends Error {
  constructor(code, message = CONTAINER_ERROR_MESSAGES[code], options = {}) {
    super(message, options);
    this.name = "ContainerError";
    this.code = code;
  }
}

function invalidState(reason) {
  return new ContainerError(
    CONTAINER_ERROR_CODES.INVALID_STATE,
    `${CONTAINER_ERROR_MESSAGES[CONTAINER_ERROR_CODES.INVALID_STATE]} ${reason}`
  );
}

export function invalidContainerRequest(reason) {
  return new ContainerError(
    CONTAINER_ERROR_CODES.INVALID_REQUEST,
    `${CONTAINER_ERROR_MESSAGES[CONTAINER_ERROR_CODES.INVALID_REQUEST]} ${reason}`
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseContainerRefId(value, errorFactory = invalidState) {
  if (typeof value !== "string" || !REF_ID_PATTERN.test(value)) {
    throw errorFactory("The logical container reference is invalid.");
  }
  return value;
}

function parseToken(value, label, errorFactory) {
  if (
    typeof value !== "string" ||
    value.length > MAX_CONTAINER_TOKEN_LENGTH ||
    !TOKEN_PATTERN.test(value)
  ) {
    throw errorFactory(`The container ${label} is invalid.`);
  }
  return value;
}

export function parseContainerDescriptor(value, errorFactory = invalidState) {
  const descriptorKeys = ["name", "color", "icon", "colorCode"];
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, descriptorKeys) &&
      !hasExactKeys(value, [...descriptorKeys, "sidebarsIcon"]))
  ) {
    throw errorFactory("The container descriptor has an invalid shape.");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (
    name.length < 1 ||
    name.length > MAX_CONTAINER_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw errorFactory("The container name is invalid.");
  }
  if (
    value.colorCode !== null &&
    (typeof value.colorCode !== "string" || !COLOR_CODE_PATTERN.test(value.colorCode))
  ) {
    throw errorFactory("The container color code is invalid.");
  }
  const descriptor = {
    name,
    color: parseToken(value.color, "color", errorFactory),
    icon: parseToken(value.icon, "icon", errorFactory),
    colorCode: value.colorCode === null ? null : value.colorCode.toLowerCase()
  };
  if (Object.prototype.hasOwnProperty.call(value, "sidebarsIcon")) {
    descriptor.sidebarsIcon = parseToken(value.sidebarsIcon, "Terminus icon", errorFactory);
  }
  return descriptor;
}

export function parseSupportedContainerColor(value, errorFactory = invalidState) {
  if (!isRecord(value) || !hasExactKeys(value, ["color", "colorCode"])) {
    throw errorFactory("The supported container color has an invalid shape.");
  }
  if (typeof value.colorCode !== "string" || !COLOR_CODE_PATTERN.test(value.colorCode)) {
    throw errorFactory("The supported container color code is invalid.");
  }
  return {
    color: parseToken(value.color, "color", errorFactory),
    colorCode: value.colorCode.toLowerCase()
  };
}

export function parseSupportedContainerIcon(value, errorFactory = invalidState) {
  if (!isRecord(value) || !hasExactKeys(value, ["icon", "iconUrl"])) {
    throw errorFactory("The supported container icon has an invalid shape.");
  }
  if (
    typeof value.iconUrl !== "string" ||
    value.iconUrl.length < 1 ||
    value.iconUrl.length > MAX_CONTAINER_ICON_URL_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.iconUrl) ||
    !value.iconUrl.startsWith("resource://")
  ) {
    throw errorFactory("The supported container icon URL is invalid.");
  }
  return {
    icon: parseToken(value.icon, "icon", errorFactory),
    iconUrl: value.iconUrl
  };
}

export function parseNativeContainer(value, errorFactory = invalidState) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["cookieStoreId", "name", "color", "icon", "colorCode"])
  ) {
    throw errorFactory("The native container has an invalid shape.");
  }
  if (
    typeof value.cookieStoreId !== "string" ||
    value.cookieStoreId.length < 1 ||
    value.cookieStoreId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value.cookieStoreId)
  ) {
    throw errorFactory("The native container identifier is invalid.");
  }
  const descriptor = parseContainerDescriptor(
    {
      name: value.name,
      color: value.color,
      icon: value.icon,
      colorCode: value.colorCode
    },
    errorFactory
  );
  return { cookieStoreId: value.cookieStoreId, ...descriptor };
}

export function parseContainerAssignment(value, errorFactory = invalidState) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw errorFactory("The container assignment has an invalid shape.");
  }
  if (value.kind === "none" && hasExactKeys(value, ["kind"])) {
    return { kind: "none" };
  }
  if (value.kind === "container" && hasExactKeys(value, ["kind", "refId"])) {
    return { kind: "container", refId: parseContainerRefId(value.refId, errorFactory) };
  }
  throw errorFactory("The container assignment has an invalid shape.");
}

export function noContainerAssignment() {
  return { kind: "none" };
}

export function containerAssignment(refId) {
  return { kind: "container", refId: parseContainerRefId(refId, invalidContainerRequest) };
}

export function parseContainerCatalog(value, errorFactory = invalidState) {
  if (!Array.isArray(value) || value.length > MAX_CONTAINER_BINDINGS) {
    throw errorFactory("The container catalog is invalid.");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["refId", "descriptor"])) {
      throw errorFactory(`Container catalog entry ${index} has an invalid shape.`);
    }
    const refId = parseContainerRefId(entry.refId, errorFactory);
    if (seen.has(refId)) {
      throw errorFactory("Container catalog references must be unique.");
    }
    seen.add(refId);
    return { refId, descriptor: parseContainerDescriptor(entry.descriptor, errorFactory) };
  });
}

export function parseContainerResolutionDecisions(value, errorFactory = invalidContainerRequest) {
  if (!Array.isArray(value) || value.length > MAX_CONTAINER_BINDINGS) {
    throw errorFactory("Container resolution decisions must be an array.");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.action !== "string") {
      throw errorFactory(`Container resolution decision ${index} has an invalid shape.`);
    }
    const refId = parseContainerRefId(entry.refId, errorFactory);
    if (seen.has(refId)) {
      throw errorFactory("Container resolution references must be unique.");
    }
    seen.add(refId);
    if (
      entry.action === CONTAINER_RESOLUTION_ACTIONS.EXISTING &&
      hasExactKeys(entry, ["refId", "action", "targetRefId"])
    ) {
      return {
        refId,
        action: entry.action,
        targetRefId: parseContainerRefId(entry.targetRefId, errorFactory)
      };
    }
    if (
      entry.action === CONTAINER_RESOLUTION_ACTIONS.RECREATE &&
      hasExactKeys(entry, ["refId", "action", "name"])
    ) {
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (
        name.length < 1 ||
        name.length > MAX_CONTAINER_NAME_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(name)
      ) {
        throw errorFactory(`Container resolution decision ${index} has an invalid name.`);
      }
      return { refId, action: entry.action, name };
    }
    if (
      [CONTAINER_RESOLUTION_ACTIONS.RECREATE, CONTAINER_RESOLUTION_ACTIONS.NONE].includes(entry.action) &&
      hasExactKeys(entry, ["refId", "action"])
    ) {
      return { refId, action: entry.action };
    }
    if (
      entry.action === CONTAINER_RESOLUTION_ACTIONS.SKIP &&
      hasExactKeys(entry, ["refId", "action", "clearWorkspaceDefaults"]) &&
      entry.clearWorkspaceDefaults === true
    ) {
      return { refId, action: entry.action, clearWorkspaceDefaults: true };
    }
    throw errorFactory(`Container resolution decision ${index} has an invalid shape.`);
  });
}

export function parseContainerState(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "bindings"])) {
    throw invalidState("The root document has an invalid shape.");
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw invalidState("The schema version is invalid.");
  }
  if (value.schemaVersion > CONTAINER_STATE_SCHEMA_VERSION) {
    throw new ContainerError(CONTAINER_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION);
  }
  if (value.schemaVersion !== CONTAINER_STATE_SCHEMA_VERSION) {
    throw invalidState(`Expected container schema version ${CONTAINER_STATE_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(value.bindings) || value.bindings.length > MAX_CONTAINER_BINDINGS) {
    throw invalidState("The container bindings are invalid.");
  }
  const refs = new Set();
  const bindings = value.bindings.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["refId", "descriptor", "cookieStoreId"])
    ) {
      throw invalidState(`Container binding ${index} has an invalid shape.`);
    }
    const refId = parseContainerRefId(entry.refId);
    if (refs.has(refId)) {
      throw invalidState("Container binding references must be unique.");
    }
    refs.add(refId);
    if (
      entry.cookieStoreId !== null &&
      (typeof entry.cookieStoreId !== "string" ||
        entry.cookieStoreId.length < 1 ||
        entry.cookieStoreId.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(entry.cookieStoreId))
    ) {
      throw invalidState(`Container binding ${index} has an invalid native identifier.`);
    }
    return {
      refId,
      descriptor: parseContainerDescriptor(entry.descriptor),
      cookieStoreId: entry.cookieStoreId
    };
  });
  return { schemaVersion: CONTAINER_STATE_SCHEMA_VERSION, bindings };
}

export function createEmptyContainerState() {
  return parseContainerState({ schemaVersion: CONTAINER_STATE_SCHEMA_VERSION, bindings: [] });
}

export function projectContainerCatalog(rawRefIds, rawBindings) {
  const refIds = [...new Set(rawRefIds)].sort();
  const bindings = parseContainerState({
    schemaVersion: CONTAINER_STATE_SCHEMA_VERSION,
    bindings: rawBindings
  }).bindings;
  const byRef = new Map(bindings.map((entry) => [entry.refId, entry]));
  return parseContainerCatalog(refIds.map((refId, index) => {
    const binding = byRef.get(parseContainerRefId(refId));
    if (!binding) {
      throw invalidState(`Container reference ${index} has no descriptor.`);
    }
    return { refId, descriptor: binding.descriptor };
  }));
}

import {
  CONTAINER_STATUSES,
  parseContainerDescriptor,
  parseContainerRefId
} from "./containers.js";

const LOGICAL_TAB_ID_PATTERN = /^tab-[a-z0-9][a-z0-9-]{0,127}$/;
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const WORKSPACE_ICON_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORKSPACE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MAX_TAB_TITLE_LENGTH = 4096;
const MAX_GROUP_TITLE_LENGTH = 255;
const MAX_ANCESTOR_TITLES = 32;
export const MAX_TAB_SEARCH_LOCATION_LENGTH = 2048;
export const MAX_WORKSPACE_SEARCH_RESULTS = 10_000;

function safelyDecoded(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

// Search matches a tab's site and page path, never the query string, fragment,
// port, or credentials, which can carry tokens. Other schemes (data:, blob:,
// moz-extension:, javascript:) have no useful address and are omitted.
export function searchableTabLocation(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let location = null;
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    const path = parsed.pathname === "/" ? "" : safelyDecoded(parsed.pathname);
    location = `${parsed.hostname}${path}`;
  } else if (parsed.protocol === "file:") {
    location = safelyDecoded(parsed.pathname);
  } else if (parsed.protocol === "about:") {
    location = `about:${parsed.pathname}`;
  }
  if (!location) return null;
  return location.slice(0, MAX_TAB_SEARCH_LOCATION_LENGTH);
}

function invalidSearchIndex(reason) {
  return new TypeError(`Invalid workspace search index. ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validTitle(value, maximum = MAX_TAB_TITLE_LENGTH) {
  return typeof value === "string" && value.length <= maximum;
}

function parseContainerPresentation(value, label) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw invalidSearchIndex(`${label} has an invalid container marker.`);
  }
  if (value.kind === "none" && hasExactKeys(value, ["kind"])) {
    return { kind: "none" };
  }
  if (
    value.kind !== "container" ||
    !hasExactKeys(value, ["kind", "refId", "descriptor", "status"]) ||
    !Object.values(CONTAINER_STATUSES).includes(value.status)
  ) {
    throw invalidSearchIndex(`${label} has an invalid container marker.`);
  }
  const refId = parseContainerRefId(value.refId, invalidSearchIndex);
  const descriptor = value.descriptor === null
    ? null
    : parseContainerDescriptor(value.descriptor, invalidSearchIndex);
  if (value.status === CONTAINER_STATUSES.AVAILABLE && descriptor === null) {
    throw invalidSearchIndex(`${label} has an unavailable container descriptor.`);
  }
  return { kind: "container", refId, descriptor, status: value.status };
}

function knownWorkspaceMap(workspaces) {
  if (workspaces === null) return null;
  if (!Array.isArray(workspaces)) throw invalidSearchIndex("Known workspaces are invalid.");
  return new Map(workspaces.map((workspace) =>
    typeof workspace === "string" ? [workspace, null] : [workspace.id, workspace]
  ));
}

function parseWorkspacePresentations(value, knownWorkspaces) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    (knownWorkspaces !== null && value.length !== knownWorkspaces.size)
  ) {
    throw invalidSearchIndex("Workspace presentations are incomplete.");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const label = `Workspace ${index}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["id", "name", "icon", "color", "container"]) ||
      typeof entry.id !== "string" ||
      !WORKSPACE_ID_PATTERN.test(entry.id) ||
      seen.has(entry.id) ||
      (knownWorkspaces !== null && !knownWorkspaces.has(entry.id)) ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      entry.name.length > 80 ||
      entry.name !== entry.name.trim() ||
      typeof entry.icon !== "string" ||
      !WORKSPACE_ICON_PATTERN.test(entry.icon) ||
      typeof entry.color !== "string" ||
      !WORKSPACE_COLOR_PATTERN.test(entry.color)
    ) {
      throw invalidSearchIndex(`${label} has invalid presentation data.`);
    }
    const known = knownWorkspaces?.get(entry.id);
    // Stored workspace colors keep the case they were written with, while this
    // parser emits lowercase, so a reparsed index must compare colors canonically.
    if (
      known &&
      (
        known.name !== entry.name ||
        known.icon !== entry.icon ||
        typeof known.color !== "string" ||
        known.color.toLowerCase() !== entry.color.toLowerCase()
      )
    ) {
      throw invalidSearchIndex(`${label} does not match the current workspace.`);
    }
    seen.add(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      color: entry.color.toLowerCase(),
      container: parseContainerPresentation(entry.container, label)
    };
  });
}

export function parseWorkspaceSearchIndex(value, workspaces = null) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["workspaces", "tabs"]) ||
    !Array.isArray(value.tabs) ||
    value.tabs.length > MAX_WORKSPACE_SEARCH_RESULTS
  ) {
    throw invalidSearchIndex("The document has an invalid shape.");
  }

  const knownWorkspaces = knownWorkspaceMap(workspaces);
  const workspacePresentations = parseWorkspacePresentations(
    value.workspaces,
    knownWorkspaces
  );
  const knownWorkspaceIds = new Set(
    workspacePresentations.map(({ id }) => id)
  );
  const logicalIds = new Set();
  const firefoxIds = new Set();
  const tabs = value.tabs.map((entry, index) => {
    const label = `Tab ${index}`;
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "logicalTabId",
        "firefoxTabId",
        "workspaceId",
        "title",
        "discarded",
        "pinned",
        "groupTitle",
        "ancestorTitles",
        "location"
      ]) ||
      typeof entry.logicalTabId !== "string" ||
      !LOGICAL_TAB_ID_PATTERN.test(entry.logicalTabId) ||
      logicalIds.has(entry.logicalTabId) ||
      !Number.isInteger(entry.firefoxTabId) ||
      entry.firefoxTabId < 0 ||
      firefoxIds.has(entry.firefoxTabId) ||
      typeof entry.workspaceId !== "string" ||
      !WORKSPACE_ID_PATTERN.test(entry.workspaceId) ||
      !knownWorkspaceIds.has(entry.workspaceId) ||
      !validTitle(entry.title) ||
      typeof entry.discarded !== "boolean" ||
      typeof entry.pinned !== "boolean" ||
      (entry.groupTitle !== null && !validTitle(entry.groupTitle, MAX_GROUP_TITLE_LENGTH)) ||
      !Array.isArray(entry.ancestorTitles) ||
      entry.ancestorTitles.length > MAX_ANCESTOR_TITLES ||
      entry.ancestorTitles.some((title) => !validTitle(title)) ||
      (entry.location !== null && !validTitle(entry.location, MAX_TAB_SEARCH_LOCATION_LENGTH))
    ) {
      throw invalidSearchIndex(`${label} has invalid identity or presentation data.`);
    }
    logicalIds.add(entry.logicalTabId);
    firefoxIds.add(entry.firefoxTabId);
    return {
      logicalTabId: entry.logicalTabId,
      firefoxTabId: entry.firefoxTabId,
      workspaceId: entry.workspaceId,
      title: entry.title,
      discarded: entry.discarded,
      pinned: entry.pinned,
      groupTitle: entry.groupTitle,
      ancestorTitles: [...entry.ancestorTitles],
      location: entry.location
    };
  });

  return { workspaces: workspacePresentations, tabs };
}

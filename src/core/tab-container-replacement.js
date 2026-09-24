import { CONTAINER_ERROR_CODES, ContainerError } from "../contracts/containers.js";
import { TAB_CONTAINER_MOVE_REASONS } from "../contracts/tab-container-move.js";

const DEFAULT_COOKIE_STORE_ID = "firefox-default";

export function tabUsesCookieStore(tab, cookieStoreId) {
  const current = typeof tab?.cookieStoreId === "string"
    ? tab.cookieStoreId
    : DEFAULT_COOKIE_STORE_ID;
  return current === (cookieStoreId ?? DEFAULT_COOKIE_STORE_ID);
}

// Moves one live tab into another container. Firefox cannot change a tab's
// container, so the same page opens beside it first and the original closes
// only once that replacement exists. The replacement then takes the
// original's logical identity, which keeps its workspace, position, tree,
// group, pin intent, and remembered selection valid without remapping.
//
// Returns { moved: true, firefoxTabId } or { moved: false, reason }.
export async function replaceTabInContainer({ browserAdapter, windowId, tab, cookieStoreId }) {
  let replacement;
  try {
    replacement = await browserAdapter.createContainerReplacement(tab.id, { cookieStoreId });
  } catch (error) {
    return {
      moved: false,
      reason: error instanceof ContainerError && error.code === CONTAINER_ERROR_CODES.UNSUPPORTED_URL
        ? TAB_CONTAINER_MOVE_REASONS.UNSUPPORTED_URL
        : TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE
    };
  }
  const removeReplacement = () =>
    browserAdapter.removeTabs([replacement.id]).catch(() => undefined);

  if (tab.active === true) {
    try {
      await browserAdapter.activateTab(replacement.id);
    } catch {
      await removeReplacement();
      return { moved: false, reason: TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE };
    }
  }

  // Firefox can keep the original open, for example behind a page's leave
  // prompt, so the window is listed again rather than trusting the call.
  await browserAdapter.removeTabs([tab.id]).catch(() => undefined);
  let liveTabs;
  try {
    liveTabs = await browserAdapter.listTabs(windowId);
  } catch {
    // Whether the original closed is unknown, so both tabs are left as they
    // are; reconciliation keeps whichever still exists.
    return { moved: false, reason: TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE };
  }
  if (liveTabs.some(({ id }) => id === tab.id)) {
    // Firefox can answer this call while the page's leave prompt is still
    // open, and closing that prompt later would take the tab with it. The
    // replacement therefore stays beside the original as a loose copy, with
    // no logical identity, rather than risking the page. The original stays
    // where it is and keeps focus.
    if (tab.active === true) {
      await browserAdapter.activateTab(tab.id).catch(() => undefined);
    }
    return { moved: false, reason: TAB_CONTAINER_MOVE_REASONS.CLOSE_REFUSED };
  }

  try {
    await browserAdapter.setTabIdentity(replacement.id, tab.logicalId);
  } catch {
    return { moved: false, reason: TAB_CONTAINER_MOVE_REASONS.BROWSER_FAILURE };
  }
  return { moved: true, firefoxTabId: replacement.id };
}

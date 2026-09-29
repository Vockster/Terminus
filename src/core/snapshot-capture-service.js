import {
  SNAPSHOT_ERROR_CODES,
  SnapshotError,
  parsePrivateSnapshotPayload,
  parseSnapshotPayload
} from "../contracts/snapshots.js";
import { parseWorkspaceState } from "../contracts/workspace-state.js";

function cloneLayout(layout, tabs) {
  if (tabs.length === layout.tabIds.length) {
    return {
      workspaceId: layout.workspaceId,
      tabs,
      pinnedTabIds: [...layout.pinnedTabIds],
      groups: structuredClone(layout.groups),
      tree: structuredClone(layout.tree),
      splitViews: structuredClone(layout.splitViews)
    };
  }
  // A tab that vanished mid-operation was omitted from `tabs`; every
  // structure that names it must drop it too, or the snapshot's derived
  // runtime fails validation. Children of an omitted tab re-parent to its
  // nearest retained ancestor, and a split missing a pane is no longer a
  // recreatable wrapper record.
  const retained = new Set(tabs.map(({ id }) => id));
  const resolvedParent = new Map();
  const tree = [];
  for (const node of layout.tree ?? []) {
    const parent = node.parentTabId === null
      ? null
      : retained.has(node.parentTabId)
        ? node.parentTabId
        : resolvedParent.get(node.parentTabId) ?? null;
    if (retained.has(node.tabId)) {
      tree.push({ tabId: node.tabId, parentTabId: parent, collapsed: node.collapsed });
    } else {
      resolvedParent.set(node.tabId, parent);
    }
  }
  return {
    workspaceId: layout.workspaceId,
    tabs,
    pinnedTabIds: layout.pinnedTabIds.filter((tabId) => retained.has(tabId)),
    groups: layout.groups
      .map((group) => ({
        ...structuredClone(group),
        tabIds: group.tabIds.filter((tabId) => retained.has(tabId))
      }))
      .filter((group) => group.tabIds.length > 0),
    tree,
    splitViews: layout.splitViews.filter((split) =>
      split.tabIds.every((tabId) => retained.has(tabId))
    ).map((split) => structuredClone(split))
  };
}

export class SnapshotCaptureService {
  #browser;
  #containerService;

  constructor(browserAdapter, { containerService = null } = {}) {
    this.#browser = browserAdapter;
    this.#containerService = containerService;
  }

  async capture(inventory) {
    const contexts = [...inventory.contexts.values()];
    // An unfinished workspace operation must never block captures forever:
    // the reconciled inventory already holds the last saved layouts, so a
    // capture during an unsettled window records those plus live page data.
    // Only an open Split View chooser still refuses, and only momentarily.
    if (contexts.some(({ splitViewChooserTabId }) => splitViewChooserTabId !== null)) {
      throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
    }
    const capturedWindows = await this.#browser.captureWindows(
      contexts.map(({ windowId }) => windowId)
    );
    const rawByWindowId = new Map(
      capturedWindows.map((window) => [window.firefoxWindowId, window])
    );
    const contextByLogicalId = new Map(
      contexts.map((context) => [context.windowRuntime.id, context])
    );
    // Runtime also keeps records of closed windows so Firefox can restore
    // them into their workspaces; a snapshot describes only open windows.
    const openWindows = inventory.runtime.windows.filter((windowRuntime) =>
      contextByLogicalId.has(windowRuntime.id)
    );

    const rawCookieStoreIds = openWindows.flatMap((windowRuntime) => {
      const context = contextByLogicalId.get(windowRuntime.id);
      const rawWindow = context ? rawByWindowId.get(context.windowId) : null;
      if (!context || !rawWindow) return [];
      const rawTabByFirefoxId = new Map(rawWindow.tabs.map((tab) => [tab.firefoxTabId, tab]));
      const firefoxTabByLogicalId = new Map(context.tabs.map((tab) => [tab.logicalId, tab.id]));
      return windowRuntime.workspaceLayouts.flatMap((layout) => layout.tabIds.map((logicalTabId) => {
        const raw = rawTabByFirefoxId.get(firefoxTabByLogicalId.get(logicalTabId));
        return raw?.cookieStoreId;
      }));
    });
    const assignments = this.#containerService
      ? await this.#containerService.assignmentsForCookieStores(rawCookieStoreIds)
      : [];
    let assignmentIndex = 0;

    const windows = openWindows.flatMap((windowRuntime) => {
      const context = contextByLogicalId.get(windowRuntime.id);
      const rawWindow = context ? rawByWindowId.get(context.windowId) : null;
      // A window that closed between reconcile and capture contributed no
      // cookie-store lookups above, so omitting it keeps the assignment
      // index aligned.
      if (!context || !rawWindow) return [];
      const rawTabByFirefoxId = new Map(
        rawWindow.tabs.map((tab) => [tab.firefoxTabId, tab])
      );
      const firefoxTabByLogicalId = new Map(
        context.tabs.map((tab) => [tab.logicalId, tab.id])
      );
      const workspaceLayouts = windowRuntime.workspaceLayouts.map((layout) => {
        const tabs = layout.tabIds.flatMap((logicalTabId) => {
          const firefoxTabId = firefoxTabByLogicalId.get(logicalTabId);
          const raw = rawTabByFirefoxId.get(firefoxTabId);
          if (!raw) {
            // The tab no longer exists in Firefox (for example it closed
            // mid-operation); its lookup above yielded a no-container
            // assignment that must still be consumed.
            if (this.#containerService) assignmentIndex += 1;
            return [];
          }
          const tab = {
            id: logicalTabId,
            url: raw.url,
            title: raw.title,
            active: raw.active,
            highlighted: raw.highlighted,
            discarded: raw.discarded
          };
          if (this.#containerService) {
            tab.container = assignments[assignmentIndex];
            assignmentIndex += 1;
          }
          return tab;
        });
        return cloneLayout(layout, tabs);
      });
      const retainedTabIds = new Set(
        workspaceLayouts.flatMap(({ tabs }) => tabs.map(({ id }) => id))
      );
      return {
        id: windowRuntime.id,
        geometry: rawWindow.geometry,
        activeWorkspaceId: windowRuntime.activeWorkspaceId,
        selectedTabs: structuredClone(
          windowRuntime.selectedTabs.filter(({ tabId }) => retainedTabIds.has(tabId))
        ),
        workspaceLayouts
      };
    });

    if (!this.#containerService) {
      const workspaceState = parseWorkspaceState({
        ...inventory.state,
        workspaces: inventory.state.workspaces.map((workspace) => ({
          ...workspace,
          defaultContainerRef: null
        }))
      });
      return parsePrivateSnapshotPayload({ workspaceState, windows });
    }
    const referenced = [
      ...assignments.flatMap((assignment) =>
        assignment.kind === "container" ? [assignment.refId] : []
      ),
      ...inventory.state.workspaces.flatMap(({ defaultContainerRef }) =>
        defaultContainerRef === null ? [] : [defaultContainerRef]
      )
    ];
    return parseSnapshotPayload({
      workspaceState: inventory.state,
      windows,
      containerCatalog: await this.#containerService.projectCatalog(referenced)
    });
  }
}

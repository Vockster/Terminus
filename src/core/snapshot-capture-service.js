import {
  SNAPSHOT_ERROR_CODES,
  SnapshotError,
  parsePrivateSnapshotPayload,
  parseSnapshotPayload
} from "../contracts/snapshots.js";
import { parseWorkspaceState } from "../contracts/workspace-state.js";

function cloneLayout(layout, tabs) {
  return {
    workspaceId: layout.workspaceId,
    tabs,
    pinnedTabIds: [...layout.pinnedTabIds],
    groups: structuredClone(layout.groups),
    tree: structuredClone(layout.tree),
    splitViews: structuredClone(layout.splitViews)
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
    if (
      contexts.some(
        ({ splitViewChooserTabId, windowRuntime }) =>
          splitViewChooserTabId !== null || windowRuntime.pendingOperation !== null
      )
    ) {
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

    const windows = openWindows.map((windowRuntime) => {
      const context = contextByLogicalId.get(windowRuntime.id);
      const rawWindow = context ? rawByWindowId.get(context.windowId) : null;
      if (!context || !rawWindow) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
      }
      const rawTabByFirefoxId = new Map(
        rawWindow.tabs.map((tab) => [tab.firefoxTabId, tab])
      );
      const firefoxTabByLogicalId = new Map(
        context.tabs.map((tab) => [tab.logicalId, tab.id])
      );
      const workspaceLayouts = windowRuntime.workspaceLayouts.map((layout) => {
        const tabs = layout.tabIds.map((logicalTabId) => {
          const firefoxTabId = firefoxTabByLogicalId.get(logicalTabId);
          const raw = rawTabByFirefoxId.get(firefoxTabId);
          if (!raw) {
            throw new SnapshotError(SNAPSHOT_ERROR_CODES.RESTORE_BLOCKED);
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
      return {
        id: windowRuntime.id,
        geometry: rawWindow.geometry,
        activeWorkspaceId: windowRuntime.activeWorkspaceId,
        selectedTabs: structuredClone(windowRuntime.selectedTabs),
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

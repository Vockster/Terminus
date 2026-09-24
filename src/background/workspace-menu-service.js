import { WORKSPACE_PENDING_OPERATION_KINDS } from "../contracts/workspace-runtime.js";
import { WORKSPACE_STATE_ERROR_CODES } from "../contracts/workspace-state.js";
import { uniqueAvailableContainerEntries } from "../contracts/containers.js";

export const WORKSPACE_MENU_IDS = Object.freeze({
  MOVE_TAB: "sidebars-move-tab",
  MOVE_GROUP: "sidebars-move-group",
  COPY_TO_CONTAINER: "sidebars-copy-to-container",
  MOVE_TAB_DESTINATION_PREFIX: "sidebars-move-tab:",
  MOVE_GROUP_DESTINATION_PREFIX: "sidebars-move-group:",
  COPY_TO_CONTAINER_PREFIX: "sidebars-copy-to-container:"
});

function workspaceEntries(state) {
  const workspaceById = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
  return state.rail
    .filter((entry) => entry.kind === "workspace")
    .map((entry) => workspaceById.get(entry.workspaceId));
}

function destinationId(menuItemId, prefix) {
  return typeof menuItemId === "string" && menuItemId.startsWith(prefix)
    ? menuItemId.slice(prefix.length)
    : null;
}

export function createWorkspaceMenuService({
  browserApi,
  controller,
  controllerForTab = null,
  stateService,
  containerService = null,
  onOperationFinished
}) {
  let workspaceCache = [];
  let containerCache = [];
  let rebuildTail = Promise.resolve();
  let started = false;

  function createMenuTree(state, containerOverview) {
    workspaceCache = workspaceEntries(state).map((workspace) => ({
      id: workspace.id,
      name: workspace.name
    }));
    browserApi.menus.create({
      id: WORKSPACE_MENU_IDS.MOVE_TAB,
      title: "Move Tab to Workspace",
      contexts: ["tab"]
    });
    browserApi.menus.create({
      id: WORKSPACE_MENU_IDS.MOVE_GROUP,
      title: "Move Group to Workspace",
      contexts: ["tab"],
      visible: false
    });
    containerCache = containerOverview?.capability === "available"
      ? uniqueAvailableContainerEntries(containerOverview.containers)
      : [];
    browserApi.menus.create({
      id: WORKSPACE_MENU_IDS.COPY_TO_CONTAINER,
      title: "Open a Copy in Container",
      contexts: ["tab"],
      visible: false
    });
    browserApi.menus.create({
      id: `${WORKSPACE_MENU_IDS.COPY_TO_CONTAINER_PREFIX}none`,
      parentId: WORKSPACE_MENU_IDS.COPY_TO_CONTAINER,
      title: "No Container",
      contexts: ["tab"]
    });
    for (const container of containerCache) {
      browserApi.menus.create({
        id: `${WORKSPACE_MENU_IDS.COPY_TO_CONTAINER_PREFIX}${container.refId}`,
        parentId: WORKSPACE_MENU_IDS.COPY_TO_CONTAINER,
        title: container.descriptor.name,
        contexts: ["tab"]
      });
    }
    for (const workspace of workspaceCache) {
      browserApi.menus.create({
        id: `${WORKSPACE_MENU_IDS.MOVE_TAB_DESTINATION_PREFIX}${workspace.id}`,
        parentId: WORKSPACE_MENU_IDS.MOVE_TAB,
        title: workspace.name,
        contexts: ["tab"]
      });
      browserApi.menus.create({
        id: `${WORKSPACE_MENU_IDS.MOVE_GROUP_DESTINATION_PREFIX}${workspace.id}`,
        parentId: WORKSPACE_MENU_IDS.MOVE_GROUP,
        title: workspace.name,
        contexts: ["tab"]
      });
    }
  }

  function synchronize(knownContainerOverview = undefined) {
    const operation = rebuildTail.then(async () => {
      const [state, containerOverview] = await Promise.all([
        stateService.getOrInitialize(),
        knownContainerOverview === undefined
          ? containerService?.overview().catch(() => null) ?? Promise.resolve(null)
          : Promise.resolve(knownContainerOverview)
      ]);
      await browserApi.menus.removeAll();
      createMenuTree(state, containerOverview);
    });
    rebuildTail = operation.catch(() => undefined);
    return operation;
  }

  async function hideRoots() {
    await Promise.allSettled([
      browserApi.menus.update(WORKSPACE_MENU_IDS.MOVE_TAB, { visible: false }),
      browserApi.menus.update(WORKSPACE_MENU_IDS.MOVE_GROUP, { visible: false }),
      browserApi.menus.update(WORKSPACE_MENU_IDS.COPY_TO_CONTAINER, { visible: false })
    ]);
    await browserApi.menus.refresh();
  }

  async function handleShown(info, tab) {
    if (!info?.contexts?.includes("tab") || !Number.isInteger(tab?.id)) {
      await hideRoots();
      return;
    }
    try {
      await rebuildTail;
      const scopedController = controllerForTab?.(tab) ?? controller;
      if (!scopedController) {
        await hideRoots();
        return;
      }
      const context = await scopedController.getMoveMenuContext(tab.id);
      const containerOverview = containerService
        ? await containerService.overview({ privateContext: tab.incognito === true })
        : null;
      const nextWorkspaces = workspaceEntries(context.state);
      const cacheMatches =
        nextWorkspaces.length === workspaceCache.length &&
        nextWorkspaces.every(
          (workspace, index) =>
            workspace.id === workspaceCache[index].id &&
            workspace.name === workspaceCache[index].name
        );
      const nextContainers = containerOverview?.capability === "available"
        ? uniqueAvailableContainerEntries(containerOverview.containers)
        : [];
      const containerCacheMatches =
        nextContainers.length === containerCache.length &&
        nextContainers.every((entry, index) =>
          entry.refId === containerCache[index].refId &&
          entry.descriptor.name === containerCache[index].descriptor.name
        );
      if (!cacheMatches || !containerCacheMatches) {
        await synchronize();
      }
      const updates = [
        browserApi.menus.update(WORKSPACE_MENU_IDS.MOVE_TAB, {
          visible: context.splitLocked !== true
        }),
        browserApi.menus.update(WORKSPACE_MENU_IDS.MOVE_GROUP, {
          visible:
            context.logicalGroupId !== null &&
            context.groupSplitLocked !== true
        }),
        browserApi.menus.update(WORKSPACE_MENU_IDS.COPY_TO_CONTAINER, {
          visible: containerOverview?.capability === "available" && tab.incognito !== true
        })
      ];
      for (const workspace of workspaceCache) {
        const enabled = workspace.id !== context.workspaceId && context.splitLocked !== true;
        const groupVisible =
          context.logicalGroupId !== null &&
          context.groupSplitLocked !== true;
        updates.push(
          browserApi.menus.update(
            `${WORKSPACE_MENU_IDS.MOVE_TAB_DESTINATION_PREFIX}${workspace.id}`,
            { enabled, visible: context.splitLocked !== true }
          ),
          browserApi.menus.update(
            `${WORKSPACE_MENU_IDS.MOVE_GROUP_DESTINATION_PREFIX}${workspace.id}`,
            {
              enabled: workspace.id !== context.workspaceId && groupVisible,
              visible: groupVisible
            }
          )
        );
      }
      await Promise.all(updates);
      await browserApi.menus.refresh();
    } catch {
      await hideRoots();
    }
  }

  async function handleClicked(info, tab) {
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
      return;
    }
    const tabDestination = destinationId(
      info?.menuItemId,
      WORKSPACE_MENU_IDS.MOVE_TAB_DESTINATION_PREFIX
    );
    const groupDestination = destinationId(
      info?.menuItemId,
      WORKSPACE_MENU_IDS.MOVE_GROUP_DESTINATION_PREFIX
    );
    const containerDestination = destinationId(
      info?.menuItemId,
      WORKSPACE_MENU_IDS.COPY_TO_CONTAINER_PREFIX
    );
    if (!tabDestination && !groupDestination && !containerDestination) {
      return;
    }
    const scopedController = controllerForTab?.(tab) ?? controller;
    if (!scopedController) {
      return;
    }
    const operation = groupDestination
      ? WORKSPACE_PENDING_OPERATION_KINDS.MOVE_GROUP
      : WORKSPACE_PENDING_OPERATION_KINDS.MOVE_TAB;
    try {
      if (containerDestination) {
        if (tab.incognito === true) return;
        const assignment = containerDestination === "none"
          ? { kind: "none" }
          : { kind: "container", refId: containerDestination };
        await scopedController.copyTabToContainer(tab.windowId, tab.id, assignment);
      } else if (groupDestination) {
        await scopedController.moveGroupToWorkspace(tab.id, groupDestination);
      } else {
        await scopedController.moveTabToWorkspace(tab.id, tabDestination);
      }
    } catch (error) {
      if (
        !containerDestination &&
        error?.code !== WORKSPACE_STATE_ERROR_CODES.INVALID_REQUEST
      ) {
        await scopedController.reportOperationFailure(tab.windowId, operation).catch(() => undefined);
      }
    } finally {
      await onOperationFinished?.(tab.windowId);
    }
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    browserApi.menus.onShown.addListener(handleShown);
    browserApi.menus.onClicked.addListener(handleClicked);
  }

  return Object.freeze({ handleClicked, handleShown, start, synchronize });
}

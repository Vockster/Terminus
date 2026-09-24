import {
  CONTAINER_MESSAGE_TYPES,
  containerFailure,
  containerSuccess
} from "../contracts/container-messages.js";
import {
  CONTAINER_ERROR_CODES,
  ContainerError,
  invalidContainerRequest,
  parseContainerAssignment,
  parseContainerDescriptor,
  parseContainerRefId
} from "../contracts/containers.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidRequest() {
  return Promise.resolve(containerFailure(invalidContainerRequest("The message shape is invalid.")));
}

function rejectPrivate() {
  return Promise.resolve(containerFailure(new ContainerError(CONTAINER_ERROR_CODES.PRIVATE_UNAVAILABLE)));
}

export function createContainerMessageHandler({
  service,
  workspaceController,
  resolveWorkspaceController = () => workspaceController
}) {
  return function handleContainerMessage(message, sender) {
    if (!isRecord(message)) return undefined;
    const isPrivate = sender?.tab?.incognito === true;

    if (message.type === CONTAINER_MESSAGE_TYPES.OVERVIEW) {
      if (!hasExactKeys(message, ["type"])) return invalidRequest();
      return service.overview({ privateContext: isPrivate }).then(containerSuccess, containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.REFRESH) {
      if (!hasExactKeys(message, ["type"])) return invalidRequest();
      if (isPrivate) return rejectPrivate();
      return service.refresh().then(containerSuccess, containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.ENABLE) {
      if (!hasExactKeys(message, ["type"])) return invalidRequest();
      if (isPrivate) return rejectPrivate();
      return service.refresh().then(containerSuccess, containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.CREATE) {
      if (!hasExactKeys(message, ["type", "descriptor"])) return invalidRequest();
      if (isPrivate) return rejectPrivate();
      let descriptor;
      try {
        descriptor = parseContainerDescriptor(message.descriptor, invalidContainerRequest);
      } catch (error) {
        return Promise.resolve(containerFailure(error));
      }
      return service.create(descriptor).then(containerSuccess, containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.RECREATE) {
      if (!hasExactKeys(message, ["type", "refId", "descriptor"])) return invalidRequest();
      if (isPrivate) return rejectPrivate();
      try {
        const refId = parseContainerRefId(message.refId, invalidContainerRequest);
        const descriptor = parseContainerDescriptor(message.descriptor, invalidContainerRequest);
        return service.recreateReference(refId, descriptor).then(containerSuccess, containerFailure);
      } catch (error) {
        return Promise.resolve(containerFailure(error));
      }
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULT) {
      if (!hasExactKeys(message, ["type", "workspaceId", "refId"])) return invalidRequest();
      if (isPrivate) return rejectPrivate();
      if (typeof message.workspaceId !== "string") return invalidRequest();
      let refId;
      try {
        refId = message.refId === null
          ? null
          : parseContainerRefId(message.refId, invalidContainerRequest);
      } catch (error) {
        return Promise.resolve(containerFailure(error));
      }
      return workspaceController
        .setWorkspaceDefaultContainer(message.workspaceId, refId)
        .then((state) => containerSuccess({ state }), containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.SET_WORKSPACE_DEFAULTS) {
      if (!hasExactKeys(message, ["type", "workspaceIds", "refId"])) return invalidRequest();
      if (isPrivate) return rejectPrivate();
      if (
        !Array.isArray(message.workspaceIds) ||
        message.workspaceIds.some((workspaceId) => typeof workspaceId !== "string")
      ) {
        return invalidRequest();
      }
      let refId;
      try {
        refId = message.refId === null
          ? null
          : parseContainerRefId(message.refId, invalidContainerRequest);
      } catch (error) {
        return Promise.resolve(containerFailure(error));
      }
      return workspaceController
        .setWorkspaceDefaultContainers(message.workspaceIds, refId)
        .then((state) => containerSuccess({ state }), containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.CREATE_WORKSPACE_TAB) {
      if (!hasExactKeys(message, ["type", "windowId", "workspaceId", "assignment"])) {
        return invalidRequest();
      }
      if (isPrivate && message.assignment !== null) return rejectPrivate();
      try {
        if (message.assignment !== null) {
          parseContainerAssignment(message.assignment, invalidContainerRequest);
        }
      } catch (error) {
        return Promise.resolve(containerFailure(error));
      }
      return Promise.resolve(resolveWorkspaceController(sender, message.windowId))
        .then((controller) => controller.createWorkspaceTab(
          message.windowId,
          message.workspaceId,
          message.assignment
        ))
        .then((view) => containerSuccess({ view }), containerFailure);
    }
    if (message.type === CONTAINER_MESSAGE_TYPES.COPY_TAB) {
      if (!hasExactKeys(message, ["type", "windowId", "tabId", "assignment"])) {
        return invalidRequest();
      }
      if (isPrivate) return rejectPrivate();
      try {
        parseContainerAssignment(message.assignment, invalidContainerRequest);
      } catch (error) {
        return Promise.resolve(containerFailure(error));
      }
      return Promise.resolve(resolveWorkspaceController(sender, message.windowId))
        .then((controller) => controller.copyTabToContainer(
          message.windowId,
          message.tabId,
          message.assignment
        ))
        .then((view) => containerSuccess({ view }), containerFailure);
    }
    return undefined;
  };
}

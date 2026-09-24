import {
  MAX_WORKSPACE_PACKAGE_BYTES,
  WORKSPACE_PACKAGE_ERROR_CODES,
  WORKSPACE_PACKAGE_MESSAGE_TYPES,
  WorkspacePackageError,
  workspacePackageFailure,
  workspacePackageSuccess
} from "../contracts/workspace-package.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function failWith(code) {
  return Promise.resolve(workspacePackageFailure(new WorkspacePackageError(code)));
}

function invalidRequest() {
  return failWith(WORKSPACE_PACKAGE_ERROR_CODES.INVALID_REQUEST);
}

const MESSAGE_TYPES = new Set(Object.values(WORKSPACE_PACKAGE_MESSAGE_TYPES));

export function createWorkspacePackageMessageHandler({ service, downloads, onImported = null }) {
  return function handleWorkspacePackageMessage(message, sender) {
    if (!isRecord(message) || !MESSAGE_TYPES.has(message.type)) {
      return undefined;
    }
    // Workspace packages are normal-scope only. A private Settings tab is
    // refused here as well as being disabled in the page.
    if (sender?.tab?.incognito === true) {
      return failWith(WORKSPACE_PACKAGE_ERROR_CODES.PRIVATE_WINDOW);
    }
    const respond = (operation) =>
      Promise.resolve(operation).then(workspacePackageSuccess, workspacePackageFailure);

    if (message.type === WORKSPACE_PACKAGE_MESSAGE_TYPES.EXPORT) {
      if (!hasExactKeys(message, ["type"])) return invalidRequest();
      return respond(
        service.export().then(async ({ bytes, filename }) => {
          const downloadId = await downloads.downloadBytes({
            bytes,
            mimeType: "application/zip",
            filename
          });
          return { downloadId, filename };
        })
      );
    }

    if (message.type === WORKSPACE_PACKAGE_MESSAGE_TYPES.READ_FILE) {
      if (!hasExactKeys(message, ["type", "bytes"]) || !(message.bytes instanceof Uint8Array)) {
        return invalidRequest();
      }
      // Settings checks the file size first; this is the boundary guard that
      // does not depend on the page.
      if (message.bytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) {
        return failWith(WORKSPACE_PACKAGE_ERROR_CODES.FILE_TOO_LARGE);
      }
      return respond(service.readFile(message.bytes));
    }

    if (message.type === WORKSPACE_PACKAGE_MESSAGE_TYPES.IMPORT) {
      if (
        !hasExactKeys(message, ["type", "package", "mode"]) ||
        !isRecord(message.package) ||
        typeof message.mode !== "string"
      ) {
        return invalidRequest();
      }
      const windowId = sender?.tab?.windowId;
      if (!Number.isInteger(windowId)) return invalidRequest();
      return respond(
        service.import(windowId, message.package, message.mode).then((outcome) => {
          onImported?.(windowId);
          return outcome;
        })
      );
    }

    return invalidRequest();
  };
}

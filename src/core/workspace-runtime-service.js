import {
  WORKSPACE_STATE_ERROR_CODES,
  WORKSPACE_STATE_ERROR_MESSAGES,
  WorkspaceStateError
} from "../contracts/workspace-state.js";
import {
  WORKSPACE_RUNTIME_LEGACY_SCHEMA_VERSION,
  WORKSPACE_RUNTIME_V2_SCHEMA_VERSION,
  WORKSPACE_RUNTIME_V3_SCHEMA_VERSION,
  WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
  WORKSPACE_RUNTIME_SCHEMA_VERSION,
  createEmptyWorkspaceRuntime,
  migrateWorkspaceRuntimeV1ToV2,
  migrateWorkspaceRuntimeV2ToV3,
  migrateWorkspaceRuntimeV3ToV4,
  migrateWorkspaceRuntimeV4ToV5,
  parseWorkspaceRuntime,
  parseWorkspaceRuntimeV1,
  parseWorkspaceRuntimeV2,
  parseWorkspaceRuntimeV3,
  parseWorkspaceRuntimeV4
} from "../contracts/workspace-runtime.js";
import { StorageMigrationCoordinator } from "./storage-migration-coordinator.js";

function storageUnavailable(cause) {
  return new WorkspaceStateError(
    WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE,
    WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.STORAGE_UNAVAILABLE],
    { cause }
  );
}

export class WorkspaceRuntimeService {
  #storage;
  #initializationPromise = null;

  constructor(storage) {
    this.#storage = storage;
  }

  getOrInitialize(workspaceIds) {
    if (!this.#initializationPromise) {
      const operation = this.#loadOrInitialize(workspaceIds);
      this.#initializationPromise = operation;
      const clearOperation = () => {
        if (this.#initializationPromise === operation) {
          this.#initializationPromise = null;
        }
      };
      operation.then(clearOperation, clearOperation);
    }

    return this.#initializationPromise.then((runtime) =>
      parseWorkspaceRuntime(runtime, workspaceIds)
    );
  }

  async save(runtime, workspaceIds) {
    const parsed = parseWorkspaceRuntime(runtime, workspaceIds);
    try {
      await this.#storage.write(parsed);
    } catch (error) {
      throw storageUnavailable(error);
    }
    return parseWorkspaceRuntime(parsed, workspaceIds);
  }

  async reset(workspaceIds) {
    const runtime = await this.save(createEmptyWorkspaceRuntime(), workspaceIds);
    try {
      await this.#storage.removeMigration();
    } catch (error) {
      throw storageUnavailable(error);
    }
    return runtime;
  }

  async #loadOrInitialize(workspaceIds) {
    const migrationCoordinator = new StorageMigrationCoordinator({
      storage: this.#storage,
      targetVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
      parseTarget: (value) => parseWorkspaceRuntime(value, workspaceIds),
      migrations: [
        {
          sourceVersion: WORKSPACE_RUNTIME_LEGACY_SCHEMA_VERSION,
          targetVersion: WORKSPACE_RUNTIME_V2_SCHEMA_VERSION,
          parseSource: (value) => parseWorkspaceRuntimeV1(value, workspaceIds),
          parseTarget: (value) => parseWorkspaceRuntimeV2(value, workspaceIds),
          migrateSource: (value) => migrateWorkspaceRuntimeV1ToV2(value, workspaceIds)
        },
        {
          sourceVersion: WORKSPACE_RUNTIME_V2_SCHEMA_VERSION,
          targetVersion: WORKSPACE_RUNTIME_V3_SCHEMA_VERSION,
          parseSource: (value) => parseWorkspaceRuntimeV2(value, workspaceIds),
          parseTarget: (value) => parseWorkspaceRuntimeV3(value, workspaceIds),
          migrateSource: (value) => migrateWorkspaceRuntimeV2ToV3(value, workspaceIds)
        },
        {
          sourceVersion: WORKSPACE_RUNTIME_V3_SCHEMA_VERSION,
          targetVersion: WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
          parseSource: (value) => parseWorkspaceRuntimeV3(value, workspaceIds),
          parseTarget: (value) => parseWorkspaceRuntimeV4(value, workspaceIds),
          migrateSource: (value) => migrateWorkspaceRuntimeV3ToV4(value, workspaceIds)
        },
        {
          sourceVersion: WORKSPACE_RUNTIME_V4_SCHEMA_VERSION,
          targetVersion: WORKSPACE_RUNTIME_SCHEMA_VERSION,
          parseSource: (value) => parseWorkspaceRuntimeV4(value, workspaceIds),
          parseTarget: (value) => parseWorkspaceRuntime(value, workspaceIds),
          migrateSource: (value) => migrateWorkspaceRuntimeV4ToV5(value, workspaceIds)
        }
      ],
      createInvalidError: (reason) => new WorkspaceStateError(
        WORKSPACE_STATE_ERROR_CODES.INVALID_STATE,
        `${WORKSPACE_STATE_ERROR_MESSAGES[WORKSPACE_STATE_ERROR_CODES.INVALID_STATE]} ${reason}`
      ),
      createStorageError: storageUnavailable,
      isDomainError: (error) => error instanceof WorkspaceStateError
    });
    const storedRuntime = await migrationCoordinator.load();
    if (storedRuntime !== undefined) {
      return storedRuntime;
    }

    const initialRuntime = createEmptyWorkspaceRuntime();
    try {
      await this.#storage.write(initialRuntime);
    } catch (error) {
      throw storageUnavailable(error);
    }
    return initialRuntime;
  }
}

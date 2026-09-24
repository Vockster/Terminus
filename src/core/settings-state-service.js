import {
  SETTINGS_STATE_ERROR_CODES,
  SETTINGS_STATE_ERROR_MESSAGES,
  SETTINGS_STATE_LEGACY_SCHEMA_VERSION,
  SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY,
  SETTINGS_STATE_V2_SCHEMA_VERSION,
  SETTINGS_STATE_V4_SCHEMA_VERSION,
  SETTINGS_STATE_V5_SCHEMA_VERSION,
  SETTINGS_STATE_V6_SCHEMA_VERSION,
  SETTINGS_STATE_V7_SCHEMA_VERSION,
  SETTINGS_STATE_V8_SCHEMA_VERSION,
  SETTINGS_STATE_V9_SCHEMA_VERSION,
  SETTINGS_STATE_V10_SCHEMA_VERSION,
  SETTINGS_STATE_V11_SCHEMA_VERSION,
  SETTINGS_STATE_V12_SCHEMA_VERSION,
  SETTINGS_STATE_V13_SCHEMA_VERSION,
  SETTINGS_STATE_V14_SCHEMA_VERSION,
  SETTINGS_STATE_V15_SCHEMA_VERSION,
  SETTINGS_STATE_V16_SCHEMA_VERSION,
  SETTINGS_STATE_V17_SCHEMA_VERSION,
  SETTINGS_STATE_V18_SCHEMA_VERSION,
  SETTINGS_STATE_V19_SCHEMA_VERSION,
  SETTINGS_STATE_V20_SCHEMA_VERSION,
  SETTINGS_STATE_V21_SCHEMA_VERSION,
  SETTINGS_STATE_V22_SCHEMA_VERSION,
  SETTINGS_STATE_V23_SCHEMA_VERSION,
  SETTINGS_STATE_V24_SCHEMA_VERSION,
  SETTINGS_STATE_V25_SCHEMA_VERSION,
  SETTINGS_STATE_V26_SCHEMA_VERSION,
  SETTINGS_STATE_V27_SCHEMA_VERSION,
  SETTINGS_STATE_V28_SCHEMA_VERSION,
  SETTINGS_STATE_V29_SCHEMA_VERSION,
  SETTINGS_STATE_V30_SCHEMA_VERSION,
  SETTINGS_STATE_V31_SCHEMA_VERSION,
  SETTINGS_STATE_V32_SCHEMA_VERSION,
  SETTINGS_STATE_V33_SCHEMA_VERSION,
  SettingsStateError,
  applySettingsPatch,
  createDefaultSettingsState,
  migrateSettingsStateV1ToV2,
  migrateSettingsStateV2,
  migrateSettingsStateV3,
  migrateSettingsStateV4,
  migrateSettingsStateV5,
  migrateSettingsStateV6,
  migrateSettingsStateV7,
  migrateSettingsStateV8,
  migrateSettingsStateV9,
  migrateSettingsStateV10,
  migrateSettingsStateV11,
  migrateSettingsStateV12,
  migrateSettingsStateV13,
  migrateSettingsStateV14,
  migrateSettingsStateV15,
  migrateSettingsStateV16,
  migrateSettingsStateV17,
  migrateSettingsStateV18,
  migrateSettingsStateV19,
  migrateSettingsStateV20,
  migrateSettingsStateV21,
  migrateSettingsStateV22,
  migrateSettingsStateV23,
  migrateSettingsStateV24,
  migrateSettingsStateV25,
  migrateSettingsStateV26,
  migrateSettingsStateV27,
  migrateSettingsStateV28,
  migrateSettingsStateV29,
  migrateSettingsStateV30,
  migrateSettingsStateV31,
  migrateSettingsStateV32,
  migrateSettingsStateV33,
  parseSettingsPatch,
  parseSettingsState,
  parseSettingsStateV1,
  parseSettingsStateV2,
  parseSettingsStateV3,
  parseSettingsStateV4,
  parseSettingsStateV5,
  parseSettingsStateV6,
  parseSettingsStateV7,
  parseSettingsStateV8,
  parseSettingsStateV9,
  parseSettingsStateV10,
  parseSettingsStateV11,
  parseSettingsStateV12,
  parseSettingsStateV13,
  parseSettingsStateV14,
  parseSettingsStateV15,
  parseSettingsStateV16,
  parseSettingsStateV17,
  parseSettingsStateV18,
  parseSettingsStateV19,
  parseSettingsStateV20,
  parseSettingsStateV21,
  parseSettingsStateV22,
  parseSettingsStateV23,
  parseSettingsStateV24,
  parseSettingsStateV25,
  parseSettingsStateV26,
  parseSettingsStateV27,
  parseSettingsStateV28,
  parseSettingsStateV29,
  parseSettingsStateV30,
  parseSettingsStateV31,
  parseSettingsStateV32,
  parseSettingsStateV33,
  useSystemInterfaceTypography,
  resetSettingsSection
} from "../contracts/settings-state.js";
import { StorageMigrationCoordinator } from "./storage-migration-coordinator.js";

function invalidMigration(reason) {
  return new SettingsStateError(
    SETTINGS_STATE_ERROR_CODES.INVALID_STATE,
    `${SETTINGS_STATE_ERROR_MESSAGES[SETTINGS_STATE_ERROR_CODES.INVALID_STATE]} ${reason}`
  );
}

function storageUnavailable(cause) {
  return new SettingsStateError(
    SETTINGS_STATE_ERROR_CODES.STORAGE_UNAVAILABLE,
    SETTINGS_STATE_ERROR_MESSAGES[SETTINGS_STATE_ERROR_CODES.STORAGE_UNAVAILABLE],
    { cause }
  );
}

export class SettingsStateService {
  #storage;
  #migrationCoordinator;
  #operationTail = Promise.resolve();
  #initializationPromise = null;

  constructor(storage) {
    this.#storage = storage;
    this.#migrationCoordinator = new StorageMigrationCoordinator({
      storage,
      targetVersion: SETTINGS_STATE_SCHEMA_VERSION,
      parseTarget: parseSettingsState,
      migrations: [
        {
          sourceVersion: SETTINGS_STATE_LEGACY_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V2_SCHEMA_VERSION,
          parseSource: parseSettingsStateV1,
          parseTarget: parseSettingsStateV2,
          migrateSource: migrateSettingsStateV1ToV2
        },
        {
          sourceVersion: SETTINGS_STATE_V2_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION,
          parseSource: parseSettingsStateV2,
          parseTarget: parseSettingsStateV3,
          migrateSource: migrateSettingsStateV2
        },
        {
          sourceVersion: SETTINGS_STATE_PREVIOUS_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V4_SCHEMA_VERSION,
          parseSource: parseSettingsStateV3,
          parseTarget: parseSettingsStateV4,
          migrateSource: migrateSettingsStateV3
        },
        {
          sourceVersion: SETTINGS_STATE_V4_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V5_SCHEMA_VERSION,
          parseSource: parseSettingsStateV4,
          parseTarget: parseSettingsStateV5,
          migrateSource: migrateSettingsStateV4
        },
        {
          sourceVersion: SETTINGS_STATE_V5_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V6_SCHEMA_VERSION,
          parseSource: parseSettingsStateV5,
          parseTarget: parseSettingsStateV6,
          migrateSource: migrateSettingsStateV5
        },
        {
          sourceVersion: SETTINGS_STATE_V6_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V7_SCHEMA_VERSION,
          parseSource: parseSettingsStateV6,
          parseTarget: parseSettingsStateV7,
          migrateSource: migrateSettingsStateV6
        },
        {
          sourceVersion: SETTINGS_STATE_V7_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V8_SCHEMA_VERSION,
          parseSource: parseSettingsStateV7,
          parseTarget: parseSettingsStateV8,
          migrateSource: migrateSettingsStateV7
        },
        {
          sourceVersion: SETTINGS_STATE_V8_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V9_SCHEMA_VERSION,
          parseSource: parseSettingsStateV8,
          parseTarget: parseSettingsStateV9,
          migrateSource: migrateSettingsStateV8
        },
        {
          sourceVersion: SETTINGS_STATE_V9_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V10_SCHEMA_VERSION,
          parseSource: parseSettingsStateV9,
          parseTarget: parseSettingsStateV10,
          migrateSource: migrateSettingsStateV9
        },
        {
          sourceVersion: SETTINGS_STATE_V10_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V11_SCHEMA_VERSION,
          parseSource: parseSettingsStateV10,
          parseTarget: parseSettingsStateV11,
          migrateSource: migrateSettingsStateV10
        },
        {
          sourceVersion: SETTINGS_STATE_V11_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V12_SCHEMA_VERSION,
          parseSource: parseSettingsStateV11,
          parseTarget: parseSettingsStateV12,
          migrateSource: migrateSettingsStateV11
        },
        {
          sourceVersion: SETTINGS_STATE_V12_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V13_SCHEMA_VERSION,
          parseSource: parseSettingsStateV12,
          parseTarget: parseSettingsStateV13,
          migrateSource: migrateSettingsStateV12
        },
        {
          sourceVersion: SETTINGS_STATE_V13_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V14_SCHEMA_VERSION,
          parseSource: parseSettingsStateV13,
          parseTarget: parseSettingsStateV14,
          migrateSource: migrateSettingsStateV13
        },
        {
          sourceVersion: SETTINGS_STATE_V14_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V15_SCHEMA_VERSION,
          parseSource: parseSettingsStateV14,
          parseTarget: parseSettingsStateV15,
          migrateSource: migrateSettingsStateV14
        },
        {
          sourceVersion: SETTINGS_STATE_V15_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V16_SCHEMA_VERSION,
          parseSource: parseSettingsStateV15,
          parseTarget: parseSettingsStateV16,
          migrateSource: migrateSettingsStateV15
        },
        {
          sourceVersion: SETTINGS_STATE_V16_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
          parseSource: parseSettingsStateV16,
          parseTarget: parseSettingsStateV17,
          migrateSource: migrateSettingsStateV16
        },
        {
          sourceVersion: SETTINGS_STATE_V17_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V18_SCHEMA_VERSION,
          parseSource: parseSettingsStateV17,
          parseTarget: parseSettingsStateV18,
          migrateSource: migrateSettingsStateV17
        },
        {
          sourceVersion: SETTINGS_STATE_V18_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V19_SCHEMA_VERSION,
          parseSource: parseSettingsStateV18,
          parseTarget: parseSettingsStateV19,
          migrateSource: migrateSettingsStateV18
        },
        {
          sourceVersion: SETTINGS_STATE_V19_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V20_SCHEMA_VERSION,
          parseSource: parseSettingsStateV19,
          parseTarget: parseSettingsStateV20,
          migrateSource: migrateSettingsStateV19
        },
        {
          sourceVersion: SETTINGS_STATE_V20_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V21_SCHEMA_VERSION,
          parseSource: parseSettingsStateV20,
          parseTarget: parseSettingsStateV21,
          migrateSource: migrateSettingsStateV20
        },
        {
          sourceVersion: SETTINGS_STATE_V21_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V22_SCHEMA_VERSION,
          parseSource: parseSettingsStateV21,
          parseTarget: parseSettingsStateV22,
          migrateSource: migrateSettingsStateV21
        },
        {
          sourceVersion: SETTINGS_STATE_V22_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V23_SCHEMA_VERSION,
          parseSource: parseSettingsStateV22,
          parseTarget: parseSettingsStateV23,
          migrateSource: migrateSettingsStateV22
        },
        {
          sourceVersion: SETTINGS_STATE_V23_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V24_SCHEMA_VERSION,
          parseSource: parseSettingsStateV23,
          parseTarget: parseSettingsStateV24,
          migrateSource: migrateSettingsStateV23
        },
        {
          sourceVersion: SETTINGS_STATE_V24_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V25_SCHEMA_VERSION,
          parseSource: parseSettingsStateV24,
          parseTarget: parseSettingsStateV25,
          migrateSource: migrateSettingsStateV24
        },
        {
          sourceVersion: SETTINGS_STATE_V25_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V26_SCHEMA_VERSION,
          parseSource: parseSettingsStateV25,
          parseTarget: parseSettingsStateV26,
          migrateSource: migrateSettingsStateV25
        },
        {
          sourceVersion: SETTINGS_STATE_V26_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V27_SCHEMA_VERSION,
          parseSource: parseSettingsStateV26,
          parseTarget: parseSettingsStateV27,
          migrateSource: migrateSettingsStateV26
        },
        {
          sourceVersion: SETTINGS_STATE_V27_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V28_SCHEMA_VERSION,
          parseSource: parseSettingsStateV27,
          parseTarget: parseSettingsStateV28,
          migrateSource: migrateSettingsStateV27
        },
        {
          sourceVersion: SETTINGS_STATE_V28_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V29_SCHEMA_VERSION,
          parseSource: parseSettingsStateV28,
          parseTarget: parseSettingsStateV29,
          migrateSource: migrateSettingsStateV28
        },
        {
          sourceVersion: SETTINGS_STATE_V29_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V30_SCHEMA_VERSION,
          parseSource: parseSettingsStateV29,
          parseTarget: parseSettingsStateV30,
          migrateSource: migrateSettingsStateV29
        },
        {
          sourceVersion: SETTINGS_STATE_V30_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V31_SCHEMA_VERSION,
          parseSource: parseSettingsStateV30,
          parseTarget: parseSettingsStateV31,
          migrateSource: migrateSettingsStateV30
        },
        {
          sourceVersion: SETTINGS_STATE_V31_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V32_SCHEMA_VERSION,
          parseSource: parseSettingsStateV31,
          parseTarget: parseSettingsStateV32,
          migrateSource: migrateSettingsStateV31
        },
        {
          sourceVersion: SETTINGS_STATE_V32_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_V33_SCHEMA_VERSION,
          parseSource: parseSettingsStateV32,
          parseTarget: parseSettingsStateV33,
          migrateSource: migrateSettingsStateV32
        },
        {
          sourceVersion: SETTINGS_STATE_V33_SCHEMA_VERSION,
          targetVersion: SETTINGS_STATE_SCHEMA_VERSION,
          parseSource: parseSettingsStateV33,
          parseTarget: parseSettingsState,
          migrateSource: migrateSettingsStateV33
        }
      ],
      createInvalidError: invalidMigration,
      createStorageError: storageUnavailable,
      isDomainError: (error) => error instanceof SettingsStateError
    });
  }

  getOrInitialize() {
    if (!this.#initializationPromise) {
      const operation = this.#enqueue(() => this.#loadOrInitialize());
      this.#initializationPromise = operation;
      const clearOperation = () => {
        if (this.#initializationPromise === operation) {
          this.#initializationPromise = null;
        }
      };
      operation.then(clearOperation, clearOperation);
    }
    return this.#initializationPromise.then((settings) => parseSettingsState(settings));
  }

  update(rawPatch) {
    return this.#enqueue(async () => {
      const patch = parseSettingsPatch(rawPatch);
      const current = await this.#loadOrInitialize();
      return this.#write(useSystemInterfaceTypography(applySettingsPatch(current, patch)));
    });
  }

  resetSection(section) {
    return this.#enqueue(async () => {
      const current = await this.#loadOrInitialize();
      return this.#write(resetSettingsSection(current, section));
    });
  }

  reset(rawDefaults = createDefaultSettingsState()) {
    return this.#enqueue(async () => {
      const defaults = await this.#write(rawDefaults);
      await this.#callStorage(() => this.#storage.removeMigration());
      return defaults;
    });
  }

  replaceForRestore(rawSettings) {
    return this.#enqueue(() => this.#write(useSystemInterfaceTypography(rawSettings)));
  }

  async #loadOrInitialize() {
    let storedState;
    try {
      storedState = await this.#migrationCoordinator.load();
    } catch (error) {
      if (
        error?.code !== SETTINGS_STATE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION ||
        !(await this.#preserveUnsupportedDocument())
      ) {
        throw error;
      }
      return this.#write(createDefaultSettingsState());
    }
    if (storedState !== undefined) {
      const normalized = useSystemInterfaceTypography(storedState);
      return JSON.stringify(normalized) === JSON.stringify(storedState)
        ? storedState
        : this.#write(normalized);
    }
    return this.#write(createDefaultSettingsState());
  }

  // Settings written by a newer Terminus cannot be downgraded, and refusing to
  // load takes the sidebar and scheduling down together. Keep the newer
  // document under its own key and continue from defaults -- but only once that
  // copy is safely stored, so the newer data is never traded away for defaults.
  async #preserveUnsupportedDocument() {
    if (typeof this.#storage.writeUnsupportedBackup !== "function") {
      return false;
    }
    try {
      const stored = await this.#storage.read();
      if (stored === undefined) {
        return false;
      }
      await this.#storage.writeUnsupportedBackup(stored);
      console.warn(
        "Terminus settings came from a newer version; the original is kept at",
        SETTINGS_STATE_UNSUPPORTED_BACKUP_STORAGE_KEY
      );
      return true;
    } catch {
      return false;
    }
  }

  async #write(settings) {
    const parsed = parseSettingsState(settings);
    await this.#callStorage(() => this.#storage.write(parsed));
    return parseSettingsState(parsed);
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async #callStorage(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SettingsStateError) {
        throw error;
      }
      throw storageUnavailable(error);
    }
  }
}

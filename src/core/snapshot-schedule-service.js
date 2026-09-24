import {
  snapshotDurationMilliseconds
} from "../contracts/settings-state.js";
import {
  SNAPSHOT_CAPTURE_ALARM_NAME,
  SNAPSHOT_CLEANUP_ALARM_NAME,
  SNAPSHOT_AUTOMATIC_LIBRARIES,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_PRIVATE_TEST_ALARM_NAME,
  SNAPSHOT_TEST_ALARM_NAME,
  SnapshotError,
  createDefaultSnapshotScheduleState
} from "../contracts/snapshots.js";

const AUTOMATIC_TEST_DELAY_MILLISECONDS = 5 * 1000;
export const PENDING_CAPTURE_ALARM_DELAY_MILLISECONDS = 1000;
export const PENDING_CAPTURE_RETRY_MILLISECONDS = 60_000;

function hasScheduledCapture(settings) {
  return settings.snapshots.automaticEnabled ||
    settings.snapshots.automaticSettingsBackupsEnabled ||
    settings.privacy.automaticSnapshotsEnabled;
}

export function applicableAutomaticLibraries(settings) {
  return [
    settings.snapshots.automaticEnabled ? SNAPSHOT_AUTOMATIC_LIBRARIES.SIDEBAR : null,
    settings.snapshots.automaticSettingsBackupsEnabled
      ? SNAPSHOT_AUTOMATIC_LIBRARIES.SETTINGS
      : null,
    settings.privacy.automaticSnapshotsEnabled ? SNAPSHOT_AUTOMATIC_LIBRARIES.PRIVATE : null
  ].filter(Boolean);
}

export function snapshotIntervalMilliseconds(snapshotSettings) {
  return snapshotDurationMilliseconds(
    snapshotSettings.intervalValue,
    snapshotSettings.intervalUnit
  );
}

function nextDue(now, intervalMilliseconds) {
  return new Date(now.getTime() + intervalMilliseconds).toISOString();
}

// Schema 32 leaves one schedule: Save every, counted from the last save.
export function snapshotNextDueAt(now, snapshotSettings) {
  return nextDue(now, snapshotIntervalMilliseconds(snapshotSettings));
}

export class SnapshotScheduleService {
  #settingsService;
  #repository;
  #alarms;
  #captureAutomatic;
  #captureAutomaticTest;
  #capturePrivateAutomaticTest;
  #cleanupAutomatic;
  #clock;
  #operationTail = Promise.resolve();

  constructor({
    settingsService,
    repository,
    alarmsAdapter,
    captureAutomatic,
    captureAutomaticTest = captureAutomatic,
    capturePrivateAutomaticTest = captureAutomatic,
    cleanupAutomatic,
    clock = () => new Date()
  }) {
    this.#settingsService = settingsService;
    this.#repository = repository;
    this.#alarms = alarmsAdapter;
    this.#captureAutomatic = captureAutomatic;
    this.#captureAutomaticTest = captureAutomaticTest;
    this.#capturePrivateAutomaticTest = capturePrivateAutomaticTest;
    this.#cleanupAutomatic = cleanupAutomatic;
    this.#clock = clock;
  }

  synchronize({ initializing = false } = {}) {
    return this.#enqueue(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (initializing && typeof this.#repository.ensureStartupProtection === "function") {
        await this.#repository.ensureStartupProtection(this.#clock());
      }
      await this.#synchronizeCapture(settings);
      await this.#retireCleanupAlarm();
    });
  }

  // Runs one cleanup pass so a confirmed change to the maximum takes effect
  // without waiting for the next automatic save.
  applyRetention() {
    return this.#enqueue(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (!hasScheduledCapture(settings)) {
        return { removed: [], reason: "disabled" };
      }
      return this.#cleanup(settings);
    });
  }

  scheduleAutomaticTest() {
    return this.#enqueue(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (!settings.snapshots.automaticEnabled) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      const dueAt = new Date(
        this.#clock().getTime() + AUTOMATIC_TEST_DELAY_MILLISECONDS
      ).toISOString();
      await this.#alarms.clear(SNAPSHOT_TEST_ALARM_NAME);
      this.#alarms.create(SNAPSHOT_TEST_ALARM_NAME, Date.parse(dueAt));
      return { dueAt, delayMilliseconds: AUTOMATIC_TEST_DELAY_MILLISECONDS };
    });
  }

  schedulePrivateAutomaticTest() {
    return this.#enqueue(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (!settings.privacy.automaticSnapshotsEnabled) {
        throw new SnapshotError(SNAPSHOT_ERROR_CODES.INVALID_REQUEST);
      }
      const dueAt = new Date(
        this.#clock().getTime() + AUTOMATIC_TEST_DELAY_MILLISECONDS
      ).toISOString();
      await this.#alarms.clear(SNAPSHOT_PRIVATE_TEST_ALARM_NAME);
      this.#alarms.create(SNAPSHOT_PRIVATE_TEST_ALARM_NAME, Date.parse(dueAt));
      return { dueAt, delayMilliseconds: AUTOMATIC_TEST_DELAY_MILLISECONDS };
    });
  }

  handleAlarm(name) {
    return this.#enqueue(async () => {
      const settings = await this.#settingsService.getOrInitialize();
      if (name === SNAPSHOT_CAPTURE_ALARM_NAME) {
        if (!hasScheduledCapture(settings)) {
          await this.#disableJob("capture", SNAPSHOT_CAPTURE_ALARM_NAME);
          return { created: false, reason: "disabled" };
        }
        const state = await this.#repository.readScheduleState();
        const now = this.#clock();
        let pendingLibraries = state.capture.pendingLibraries.filter((library) =>
          applicableAutomaticLibraries(settings).includes(library)
        );
        if (pendingLibraries.length !== state.capture.pendingLibraries.length) {
          await this.#writeJob("capture", {
            ...state.capture,
            pendingLibraries,
            pendingSince: pendingLibraries.length > 0 ? state.capture.pendingSince : null
          });
        }
        if (pendingLibraries.length === 0) {
          if (
            state.capture.nextDueAt &&
            Date.parse(state.capture.nextDueAt) > now.getTime()
          ) {
            this.#alarms.create(
              SNAPSHOT_CAPTURE_ALARM_NAME,
              Date.parse(state.capture.nextDueAt)
            );
            return { created: false, reason: "not-due" };
          }
          pendingLibraries = applicableAutomaticLibraries(settings);
          await this.#writeJob("capture", {
            ...state.capture,
            pendingLibraries,
            pendingSince: state.capture.nextDueAt ?? now.toISOString()
          });
        }
        return this.#capture(settings, pendingLibraries);
      }
      if (name === SNAPSHOT_CLEANUP_ALARM_NAME) {
        // Left over from a profile that had the age limit before schema 31.
        await this.#retireCleanupAlarm();
        return { removed: [], reason: "disabled" };
      }
      if (name === SNAPSHOT_TEST_ALARM_NAME) {
        if (!settings.snapshots.automaticEnabled) {
          return { created: false, reason: "disabled" };
        }
        return this.#captureAutomaticTest(settings);
      }
      if (name === SNAPSHOT_PRIVATE_TEST_ALARM_NAME) {
        if (!settings.privacy.automaticSnapshotsEnabled) {
          return { created: false, reason: "disabled" };
        }
        return this.#capturePrivateAutomaticTest(settings);
      }
      return { ignored: true };
    });
  }

  async #synchronizeCapture(settings) {
    if (!hasScheduledCapture(settings)) {
      await this.#disableJob("capture", SNAPSHOT_CAPTURE_ALARM_NAME);
      return;
    }
    const intervalMilliseconds = snapshotIntervalMilliseconds(settings.snapshots);
    const state = await this.#repository.readScheduleState();
    const now = this.#clock();
    const applicable = applicableAutomaticLibraries(settings);
    const pendingLibraries = state.capture.pendingLibraries.filter((library) =>
      applicable.includes(library)
    );
    const overdue = state.capture.nextDueAt &&
      Date.parse(state.capture.nextDueAt) <= now.getTime();
    if (overdue) {
      for (const library of applicable) {
        if (!pendingLibraries.includes(library)) pendingLibraries.push(library);
      }
    }
    if (pendingLibraries.length > 0) {
      await this.#writeJob("capture", {
        ...state.capture,
        intervalMilliseconds,
        pendingLibraries,
        pendingSince:
          state.capture.pendingSince ?? state.capture.nextDueAt ?? now.toISOString()
      });
      this.#alarms.create(
        SNAPSHOT_CAPTURE_ALARM_NAME,
        now.getTime() + PENDING_CAPTURE_ALARM_DELAY_MILLISECONDS
      );
      return;
    }
    if (state.capture.pendingLibraries.length > 0) {
      await this.#writeJob("capture", {
        ...state.capture,
        intervalMilliseconds,
        pendingLibraries: [],
        pendingSince: null
      });
    }
    const existingAlarm = await this.#alarms.get(SNAPSHOT_CAPTURE_ALARM_NAME);
    if (
      state.capture.intervalMilliseconds === intervalMilliseconds &&
      state.capture.nextDueAt &&
      existingAlarm
    ) {
      return;
    }
    const dueAt = snapshotNextDueAt(now, settings.snapshots);
    await this.#writeJob("capture", {
      ...state.capture,
      intervalMilliseconds,
      nextDueAt: dueAt
    });
    this.#alarms.create(
      SNAPSHOT_CAPTURE_ALARM_NAME,
      Date.parse(dueAt)
    );
  }

  // Schema 31 removed the age limit, so nothing schedules cleanup any more.
  // Clearing on every synchronize retires the alarm and its stored job for a
  // profile upgraded from 30; on every later run it finds nothing to do.
  async #retireCleanupAlarm() {
    await this.#disableJob("cleanup", SNAPSHOT_CLEANUP_ALARM_NAME);
  }

  async #capture(settings, requestedLibraries) {
    const now = this.#clock();
    const intervalMilliseconds = snapshotIntervalMilliseconds(settings.snapshots);
    const prior = (await this.#repository.readScheduleState()).capture;
    const enabled = new Set(applicableAutomaticLibraries(settings));
    const libraries = [...new Set(requestedLibraries)].filter((library) => enabled.has(library));
    if (libraries.length === 0) {
      await this.#writeJob("capture", {
        ...prior,
        pendingLibraries: [],
        pendingSince: null
      });
      return { created: false, reason: "disabled" };
    }
    await this.#writeJob("capture", {
      ...prior,
      intervalMilliseconds,
      lastAttemptAt: now.toISOString(),
      pendingLibraries: libraries,
      pendingSince: prior.pendingSince ?? now.toISOString()
    });
    try {
      const result = await this.#captureAutomatic(settings, libraries);
      const completedAt = this.#clock();
      const dueAt = snapshotNextDueAt(completedAt, settings.snapshots);
      await this.#writeJob("capture", {
        intervalMilliseconds,
        nextDueAt: dueAt,
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: completedAt.toISOString(),
        lastResult: result.created ? "created" : "unchanged",
        pendingLibraries: [],
        pendingSince: null
      });
      this.#alarms.create(
        SNAPSHOT_CAPTURE_ALARM_NAME,
        Date.parse(dueAt)
      );
      return result;
    } catch (error) {
      const failedAt = this.#clock();
      const dueAt = snapshotNextDueAt(failedAt, settings.snapshots);
      const completed = new Set(
        Array.isArray(error?.completedLibraries) ? error.completedLibraries : []
      );
      const pendingLibraries = libraries.filter((library) => !completed.has(library));
      await this.#writeJob("capture", {
        intervalMilliseconds,
        nextDueAt: dueAt,
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: prior.lastSuccessAt,
        lastResult: "failed",
        pendingLibraries,
        pendingSince: pendingLibraries.length > 0
          ? prior.pendingSince ?? now.toISOString()
          : null
      });
      this.#alarms.create(
        SNAPSHOT_CAPTURE_ALARM_NAME,
        failedAt.getTime() + PENDING_CAPTURE_RETRY_MILLISECONDS
      );
      throw error;
    }
  }

  // Records the pass in the cleanup job. Nothing schedules a next one: the
  // maximum is enforced by each automatic save and by `applyRetention()`.
  async #cleanup(settings) {
    const now = this.#clock();
    const prior = (await this.#repository.readScheduleState()).cleanup;
    await this.#writeJob("cleanup", {
      ...prior,
      intervalMilliseconds: null,
      lastAttemptAt: now.toISOString()
    });
    const scheduleNext = async (_finishedAt, outcome) => {
      await this.#writeJob("cleanup", {
        intervalMilliseconds: null,
        nextDueAt: null,
        lastAttemptAt: now.toISOString(),
        ...outcome
      });
    };
    try {
      const result = await this.#cleanupAutomatic(settings);
      const completedAt = this.#clock();
      await scheduleNext(completedAt, {
        lastSuccessAt: completedAt.toISOString(),
        lastResult: result.removed.length > 0 ? "deleted" : "unchanged"
      });
      return result;
    } catch (error) {
      await scheduleNext(this.#clock(), {
        lastSuccessAt: prior.lastSuccessAt,
        lastResult: "failed"
      });
      throw error;
    }
  }

  // A failed capture re-arms its alarm on a short retry cadence. The startup
  // coordinator asks this before each capture alarm so a retry skips the
  // forced all-window settle burst; the capture itself still verifies its
  // preconditions inside its own serialized slot.
  async lastCaptureFailed() {
    const state = await this.#repository.readScheduleState();
    return state.capture.lastResult === "failed";
  }

  async #disableJob(key, alarmName) {
    await this.#alarms.clear(alarmName);
    const state = await this.#repository.readScheduleState();
    const empty = createDefaultSnapshotScheduleState()[key];
    if (JSON.stringify(state[key]) !== JSON.stringify(empty)) {
      await this.#repository.writeScheduleState({ ...state, [key]: empty });
    }
  }

  async #writeJob(key, value) {
    const state = await this.#repository.readScheduleState();
    return this.#repository.writeScheduleState({ ...state, [key]: value });
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.catch(() => undefined);
    return result;
  }
}

import { SNAPSHOT_CAPTURE_ALARM_NAME } from "../contracts/snapshots.js";

export const SNAPSHOT_STARTUP_QUIET_MILLISECONDS = 1000;
export const SNAPSHOT_STARTUP_MAX_WAIT_MILLISECONDS = 15_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SnapshotStartupReadiness {
  #quietMilliseconds;
  #maxWaitMilliseconds;
  #now;
  #delay;
  #revision = 0;
  #lastActivityAt = null;

  constructor({
    quietMilliseconds = SNAPSHOT_STARTUP_QUIET_MILLISECONDS,
    maxWaitMilliseconds = SNAPSHOT_STARTUP_MAX_WAIT_MILLISECONDS,
    now = () => Date.now(),
    wait = delay
  } = {}) {
    this.#quietMilliseconds = quietMilliseconds;
    this.#maxWaitMilliseconds = maxWaitMilliseconds;
    this.#now = now;
    this.#delay = wait;
  }

  noteStructuralActivity() {
    this.#revision += 1;
    this.#lastActivityAt = this.#now();
  }

  async waitUntilSettled(reconcile) {
    const startedAt = this.#now();
    const deadline = startedAt + this.#maxWaitMilliseconds;
    if (this.#lastActivityAt === null) {
      this.noteStructuralActivity();
    }

    while (true) {
      await reconcile();
      const reconciledRevision = this.#revision;
      const quietAt = (this.#lastActivityAt ?? startedAt) + this.#quietMilliseconds;
      const waitMilliseconds = Math.max(0, Math.min(quietAt, deadline) - this.#now());
      if (waitMilliseconds > 0) {
        await this.#delay(waitMilliseconds);
      }
      const now = this.#now();
      if (now >= deadline) {
        await reconcile();
        return Object.freeze({ timedOut: true, waitedMilliseconds: now - startedAt });
      }
      if (
        reconciledRevision === this.#revision &&
        now >= (this.#lastActivityAt ?? startedAt) + this.#quietMilliseconds
      ) {
        return Object.freeze({ timedOut: false, waitedMilliseconds: now - startedAt });
      }
    }
  }
}

export class SnapshotStartupCoordinator {
  #ensureInitialized;
  #scheduleService;
  #routers;
  #readiness;
  #captureTail = Promise.resolve();

  constructor({ ensureInitialized, scheduleService, routers, readiness }) {
    this.#ensureInitialized = ensureInitialized;
    this.#scheduleService = scheduleService;
    this.#routers = [...routers];
    this.#readiness = readiness;
  }

  noteBrowserStartup() {
    this.#readiness.noteStructuralActivity();
  }

  noteStructuralActivity() {
    this.#readiness.noteStructuralActivity();
  }

  handleAlarm(name) {
    if (name !== SNAPSHOT_CAPTURE_ALARM_NAME) {
      return this.#ensureInitialized().then(() => this.#scheduleService.handleAlarm(name));
    }
    const operation = async () => {
      await this.#ensureInitialized();
      // A retry after a failed capture skips the forced all-window reconcile
      // burst: the burst never resolves what blocked the capture (a pending
      // operation or an open split chooser needs events or the user), and
      // repeating it every retry queues sustained work ahead of user actions.
      // The capture re-checks its preconditions inside its serialized slot.
      const retryingFailedCapture =
        (await this.#scheduleService.lastCaptureFailed?.()) === true;
      const startupReadiness = retryingFailedCapture
        ? Object.freeze({ timedOut: false, waitedMilliseconds: 0, skippedForRetry: true })
        : await this.#readiness.waitUntilSettled(async () => {
          await Promise.all(this.#routers.map((router) => router.enqueueAll()));
          await Promise.all(this.#routers.map((router) => router.whenIdle()));
        });
      const result = await this.#scheduleService.handleAlarm(name);
      return Object.freeze({ ...result, startupReadiness });
    };
    const result = this.#captureTail.then(operation, operation);
    this.#captureTail = result.catch(() => undefined);
    return result;
  }
}

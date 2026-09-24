import {
  SNAPSHOT_CAPTURE_ALARM_NAME,
  SNAPSHOT_CLEANUP_ALARM_NAME,
  SNAPSHOT_PRIVATE_TEST_ALARM_NAME,
  SNAPSHOT_TEST_ALARM_NAME
} from "../../contracts/snapshots.js";

const OWNED_ALARMS = new Set([
  SNAPSHOT_CAPTURE_ALARM_NAME,
  SNAPSHOT_CLEANUP_ALARM_NAME,
  SNAPSHOT_PRIVATE_TEST_ALARM_NAME,
  SNAPSHOT_TEST_ALARM_NAME
]);

export function createFirefoxSnapshotAlarms(browserApi) {
  return Object.freeze({
    create(name, when, periodInMinutes) {
      if (!OWNED_ALARMS.has(name)) {
        throw new TypeError("Unknown snapshot alarm.");
      }
      browserApi.alarms.create(name, {
        when,
        ...(Number.isFinite(periodInMinutes) ? { periodInMinutes } : {})
      });
    },

    clear(name) {
      if (!OWNED_ALARMS.has(name)) {
        throw new TypeError("Unknown snapshot alarm.");
      }
      return browserApi.alarms.clear(name);
    },

    get(name) {
      if (!OWNED_ALARMS.has(name)) {
        throw new TypeError("Unknown snapshot alarm.");
      }
      return browserApi.alarms.get(name);
    },

    subscribe(listener) {
      const handler = (alarm) => {
        if (OWNED_ALARMS.has(alarm?.name)) {
          listener(alarm.name, alarm);
        }
      };
      browserApi.alarms.onAlarm.addListener(handler);
      return () => browserApi.alarms.onAlarm.removeListener(handler);
    }
  });
}

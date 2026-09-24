import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsMessageHandler } from "../../src/background/settings-message-handler.js";
import { SETTINGS_MESSAGE_TYPES } from "../../src/contracts/settings-messages.js";
import {
  SETTINGS_STATE_MIGRATION_STORAGE_KEY,
  SETTINGS_STATE_SCHEMA_VERSION,
  SETTINGS_STATE_STORAGE_KEY,
  SIDEBAR_SIZE_PRESETS,
  createDefaultSettingsState
} from "../../src/contracts/settings-state.js";
import { SettingsStateService } from "../../src/core/settings-state-service.js";
import { createFirefoxSettingsStorage } from "../../src/platform/firefox/settings-storage.js";

test("v1 settings migrate and update through messages, service, and Firefox storage", async () => {
  const stored = {
    unrelated: "preserved",
    [SETTINGS_STATE_STORAGE_KEY]: {
      schemaVersion: 1,
      sidebar: { railSize: 84, iconSize: 64, spacerSize: 32 }
    }
  };
  const operations = [];
  const browserApi = {
    storage: {
      local: {
        async get(key) {
          operations.push(["get", key]);
          return Object.prototype.hasOwnProperty.call(stored, key)
            ? { [key]: structuredClone(stored[key]) }
            : {};
        },
        async set(value) {
          const [key] = Object.keys(value);
          operations.push(["set", key]);
          stored[key] = structuredClone(value[key]);
        },
        async remove(key) {
          operations.push(["remove", key]);
          delete stored[key];
        }
      }
    }
  };
  const handler = createSettingsMessageHandler(
    new SettingsStateService(createFirefoxSettingsStorage(browserApi))
  );

  const loaded = await handler({ type: SETTINGS_MESSAGE_TYPES.GET });
  assert.equal(loaded.settings.schemaVersion, SETTINGS_STATE_SCHEMA_VERSION);
  assert.equal(loaded.settings.appearance.applyToSettings, false);
  assert.equal(loaded.settings.appearance.settingsBackgroundColor, "#000000");
  assert.deepEqual(loaded.settings.sidebar, {
    workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE,
    tabSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
    dividerSize: 32,
    workspaceReorderingLocked: false,
    showActionButtons: true,
    warnBeforeLoadingManyTabs: true,
    showAddWorkspaceButton: true,
    warnBeforeClosingMultipleTabs: true,
    hideUnloadedTabsFromFirefox: false,
    showTabSearch: true,
    tabSearchPosition: "top"
  });
  assert.equal(loaded.settings.appearance.contentMode, "full");
  assert.equal(loaded.settings.snapshots.automaticEnabled, false);
  assert.equal(Object.hasOwn(loaded.settings.snapshots, "deleteOldAutomaticEnabled"), false);
  assert.equal(loaded.settings.snapshots.retentionCount, 9999);
  assert.equal(loaded.settings.snapshots.warnBeforeSnapshotDeletion, true);
  assert.equal(stored[SETTINGS_STATE_MIGRATION_STORAGE_KEY], undefined);

  const updated = await handler({
    type: SETTINGS_MESSAGE_TYPES.UPDATE,
    patch: { sidebar: { dividerSize: 20 } }
  });
  assert.equal(updated.settings.sidebar.dividerSize, 20);
  assert.equal(updated.settings.sidebar.workspaceSize, SIDEBAR_SIZE_PRESETS.MASSIVE);
  assert.deepEqual(stored[SETTINGS_STATE_STORAGE_KEY], updated.settings);
  const locked = await handler({
    type: SETTINGS_MESSAGE_TYPES.UPDATE,
    patch: { sidebar: { workspaceReorderingLocked: true } }
  });
  assert.equal(locked.settings.sidebar.workspaceReorderingLocked, true);
  assert.deepEqual(stored[SETTINGS_STATE_STORAGE_KEY], locked.settings);

  const reset = await handler({ type: SETTINGS_MESSAGE_TYPES.RESET });
  assert.deepEqual(reset.settings, createDefaultSettingsState());
  assert.equal(stored.unrelated, "preserved");
  assert.ok(operations.some(([operation, key]) => operation === "set" && key === SETTINGS_STATE_MIGRATION_STORAGE_KEY));
  assert.ok(operations.some(([operation, key]) => operation === "remove" && key === SETTINGS_STATE_MIGRATION_STORAGE_KEY));
});

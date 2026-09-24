import { SETTINGS_STATE_STORAGE_KEY } from "../contracts/settings-state.js";
import {
  PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY,
  PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY,
  PRIVATE_RECOVERY_STORAGE_KEY,
  PRIVATE_RESTORE_JOURNAL_STORAGE_KEY,
  PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX
} from "../contracts/private-snapshots.js";

const PRIVATE_STATUS_STORAGE_KEYS = new Set([
  PRIVATE_RECOVERY_STORAGE_KEY,
  PRIVATE_RECOVERY_QUARANTINE_STORAGE_KEY,
  PRIVATE_RESTORE_JOURNAL_STORAGE_KEY,
  PRIVATE_LAST_RESTORE_REPORT_STORAGE_KEY
]);

export function hasPrivacyPanelStorageChange(changes) {
  if (!changes || typeof changes !== "object") {
    return false;
  }
  return Object.keys(changes).some(
    (key) =>
      key === SETTINGS_STATE_STORAGE_KEY ||
      key.startsWith(PRIVATE_SNAPSHOT_RECORD_STORAGE_PREFIX) ||
      PRIVATE_STATUS_STORAGE_KEYS.has(key)
  );
}

export function createPrivacyPanel({ client }) {
  const panel = document.querySelector("#privacy-panel");
  const accessStatus = panel.querySelector("#private-access-status");
  const accessHelp = panel.querySelector("#private-access-help");
  const keepTabs = panel.querySelector("#private-keep-tabs");
  const recoverySummary = panel.querySelector("#private-recovery-summary");
  const recoveryPill = panel.querySelector("#private-recovery-pill");
  const clearRecovery = panel.querySelector("#private-clear-recovery");
  const privateStatus = panel.querySelector("#private-status");
  const disableDialog = document.querySelector("#private-disable-recovery-dialog");
  const disableForm = document.querySelector("#private-disable-recovery-form");
  const disableCancel = document.querySelector("#private-disable-recovery-cancel");
  const clearDialog = document.querySelector("#private-clear-recovery-dialog");
  const clearForm = document.querySelector("#private-clear-recovery-form");
  const clearCancel = document.querySelector("#private-clear-recovery-cancel");
  let currentOverview = null;
  let busy = false;
  let active = false;
  let dirtyWhileInactive = false;
  let destroyed = false;
  let refreshScheduled = false;
  let refreshPromise = null;
  let rerunRequested = false;

  // The panel owns #private-status, which is its own role="status" live
  // region beside the controls. Routing the same message to the page-wide
  // status as well printed and announced every privacy message twice.
  function report(message, variant = "quiet") {
    privateStatus.textContent = message;
    privateStatus.hidden = message.length === 0;
    if (variant === "error") {
      privateStatus.dataset.variant = "error";
    } else {
      delete privateStatus.dataset.variant;
    }
  }

  function formatRecovery(recovery) {
    if (!recovery) {
      return "No private recovery data is stored right now.";
    }
    return `${recovery.tabCount} tab${recovery.tabCount === 1 ? "" : "s"} across ${recovery.windowCount} window${recovery.windowCount === 1 ? "" : "s"}, saved ${new Date(recovery.createdAt).toLocaleString()}.`;
  }

  function apply(overview) {
    currentOverview = overview;
    accessStatus.textContent = overview.privateAccessAllowed ? "Allowed" : "Not allowed";
    accessStatus.dataset.allowed = String(overview.privateAccessAllowed);
    accessStatus.className = overview.privateAccessAllowed ? "state-pill is-good" : "state-pill is-warn";
    accessHelp.textContent = overview.privateAccessAllowed
      ? "Terminus runs in private windows on this device."
      : "Terminus doesn't run in private windows on this device.";
    keepTabs.checked = overview.keepPrivateTabsBetweenSessions;
    keepTabs.disabled = !overview.privateAccessAllowed;
    recoverySummary.textContent = formatRecovery(overview.recovery);
    recoveryPill.textContent = overview.recovery ? "Kept" : "Nothing kept";
    recoveryPill.className = overview.recovery ? "state-pill is-accent" : "state-pill";
    clearRecovery.disabled = !overview.recovery;
  }

  async function performRefresh({ quiet }) {
    try {
      const overview = await client.overview();
      if (!destroyed) {
        apply(overview);
        if (!quiet) {
          report("");
        }
      }
    } catch (error) {
      if (!destroyed) {
        report(error.message, "error");
      }
    }
  }

  function refresh({ quiet = false } = {}) {
    if (destroyed) {
      return Promise.resolve();
    }
    if (refreshPromise) {
      rerunRequested = true;
      return refreshPromise;
    }
    refreshPromise = (async () => {
      let nextQuiet = quiet;
      do {
        rerunRequested = false;
        await performRefresh({ quiet: nextQuiet });
        nextQuiet = true;
      } while (rerunRequested && !destroyed);
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function scheduleRefresh() {
    if (destroyed || refreshScheduled) {
      return;
    }
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      if (!destroyed && active) {
        void refresh({ quiet: true });
      }
    });
  }

  function markChanged() {
    if (active) {
      scheduleRefresh();
    } else {
      dirtyWhileInactive = true;
    }
  }

  async function setPersistence(enabled) {
    if (busy) {
      return;
    }
    busy = true;
    keepTabs.disabled = true;
    report(enabled ? "Enabling private recovery…" : "Turning off private recovery…");
    try {
      await client.setPersistence(enabled);
      await refresh({ quiet: true });
      report(enabled
        ? "Private recovery is on. New private changes are saved locally."
        : "Private recovery is off. The current recovery stays available until the private session ends.");
    } catch (error) {
      if (currentOverview) {
        apply(currentOverview);
      }
      report(error.message, "error");
    } finally {
      busy = false;
      keepTabs.disabled = !currentOverview?.privateAccessAllowed;
    }
  }

  keepTabs.addEventListener("change", () => {
    if (keepTabs.checked) {
      void setPersistence(true);
      return;
    }
    keepTabs.checked = true;
    disableDialog.showModal();
  });
  disableCancel.addEventListener("click", () => disableDialog.close());
  disableForm.addEventListener("submit", (event) => {
    event.preventDefault();
    disableDialog.close();
    void setPersistence(false);
  });

  clearRecovery.addEventListener("click", () => clearDialog.showModal());
  clearCancel.addEventListener("click", () => clearDialog.close());
  clearForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearDialog.close();
    void (async () => {
      clearRecovery.disabled = true;
      try {
        await client.clearRecovery();
        await refresh({ quiet: true });
        report("Saved private recovery deleted. New private activity can create another recovery while the setting remains on.");
      } catch (error) {
        report(error.message, "error");
      } finally {
        if (currentOverview) {
          apply(currentOverview);
        }
      }
    })();
  });

  return Object.freeze({
    refresh,
    apply,
    setActive(value) {
      if (destroyed) {
        return;
      }
      const wasActive = active;
      active = Boolean(value);
      if (active && (!wasActive || dirtyWhileInactive)) {
        dirtyWhileInactive = false;
        scheduleRefresh();
      }
    },
    notifyLocalStorageChanged(changes) {
      if (hasPrivacyPanelStorageChange(changes)) {
        markChanged();
      }
    },
    destroy() {
      destroyed = true;
      active = false;
      dirtyWhileInactive = false;
      refreshScheduled = false;
    }
  });
}

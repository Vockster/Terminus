import {
  FAVICON_ERROR_CODES,
  FAVICON_MESSAGE_TYPES
} from "../contracts/favicon-messages.js";

export function formatStorageBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / (1024 ** unitIndex);
  return `${unitIndex === 0 ? Math.round(amount) : amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function displayHost(origin) {
  try {
    return new URL(origin).hostname || origin;
  } catch {
    return origin;
  }
}

export function createStoragePanel({
  client,
  privateContext = false,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url)
}) {
  const faviconCount = document.querySelector("#storage-favicon-count");
  const faviconBytes = document.querySelector("#storage-favicon-bytes");
  const gallery = document.querySelector("#storage-icon-gallery");
  const galleryEmpty = document.querySelector("#storage-icon-gallery-empty");
  const status = document.querySelector("#storage-status");
  const accessSection = document.querySelector("#storage-access-section");
  const accessList = document.querySelector("#storage-access-list");
  const removeUnusedButton = document.querySelector("#storage-remove-unused");
  const clearButton = document.querySelector("#storage-clear-favicons");
  const dialog = document.querySelector("#storage-clear-dialog");
  const form = document.querySelector("#storage-clear-form");
  const cancelButton = document.querySelector("#storage-clear-cancel");
  const submitButton = document.querySelector("#storage-clear-submit");
  let busy = false;
  let accessHosts = new Map();
  let objectUrls = [];
  let active = false;
  let dirtyWhileInactive = false;
  let destroyed = false;
  let refreshScheduled = false;
  let refreshPromise = null;
  let rerunRequested = false;

  function report(message, variant = "quiet") {
    status.textContent = message;
    status.hidden = variant === "quiet";
    if (["error", "success", "status"].includes(variant)) status.dataset.variant = variant;
    else delete status.dataset.variant;
  }

  function setBusy(value) {
    busy = value;
    removeUnusedButton.disabled = value || privateContext;
    clearButton.disabled = value || privateContext;
    submitButton.disabled = value || privateContext;
    for (const button of accessList.querySelectorAll("button")) button.disabled = value || privateContext;
  }

  function releaseObjectUrls() {
    for (const url of objectUrls) revokeObjectURL(url);
    objectUrls = [];
  }

  function renderAccessNeeds(access) {
    accessList.replaceChildren();
    accessHosts = new Map();
    const hosts = access?.available && Array.isArray(access.hosts) ? access.hosts : [];
    for (const entry of hosts) {
      if (
        typeof entry?.origin !== "string" ||
        typeof entry?.host !== "string" ||
        accessHosts.has(entry.origin)
      ) continue;
      accessHosts.set(entry.origin, entry.host);
      const row = document.createElement("div");
      row.className = "storage-access-row";
      const label = document.createElement("strong");
      label.textContent = entry.host;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.dataset.origin = entry.origin;
      button.textContent = "Allow icon host";
      button.setAttribute("aria-label", `Allow Terminus to download website icons from ${entry.host}`);
      row.append(label, button);
      accessList.append(row);
    }
    accessSection.hidden = accessHosts.size === 0;
  }

  function renderGallery(icons) {
    releaseObjectUrls();
    gallery.replaceChildren();
    for (const icon of icons) {
      const tile = document.createElement("div");
      tile.className = "storage-icon-tile";
      tile.setAttribute("role", "listitem");
      const image = document.createElement("img");
      const url = createObjectURL(new Blob([icon.bytes], { type: icon.mime }));
      objectUrls.push(url);
      image.src = url;
      image.alt = "";
      image.width = 32;
      image.height = 32;
      const label = document.createElement("span");
      label.textContent = displayHost(icon.origin);
      tile.title = `${icon.origin} · ${formatStorageBytes(icon.byteCount)}`;
      tile.setAttribute("aria-label", `Cached website icon for ${displayHost(icon.origin)}`);
      tile.append(image, label);
      gallery.append(tile);
    }
    galleryEmpty.hidden = icons.length !== 0;
  }

  async function loadAllIcons() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const icons = [];
      let cursor = null;
      try {
        do {
          const page = await client.list(cursor);
          icons.push(...page.icons);
          cursor = page.nextCursor;
        } while (cursor !== null);
        return icons;
      } catch (error) {
        if (error.code !== FAVICON_ERROR_CODES.STALE_GENERATION || attempt === 2) throw error;
      }
    }
    return [];
  }

  function apply(overview, icons) {
    const cache = overview.favicon;
    faviconCount.textContent = cache.available
      ? `${cache.iconCount} ${cache.iconCount === 1 ? "icon" : "icons"}`
      : "Unavailable";
    faviconBytes.textContent = cache.available ? formatStorageBytes(cache.byteCount) : "";
    renderAccessNeeds(overview.access);
    renderGallery(icons);
  }

  function applyPrivateState() {
    faviconCount.textContent = "Unavailable in private windows";
    faviconBytes.textContent = "";
    accessSection.hidden = true;
    gallery.replaceChildren();
    galleryEmpty.hidden = false;
    galleryEmpty.textContent = "Open Settings in a normal window to view cached website icons.";
    setBusy(false);
    report("Website icons from normal browsing stay hidden in private windows.", "status");
  }

  async function performRefresh({ quiet }) {
    if (privateContext) {
      applyPrivateState();
      return;
    }
    try {
      const [overview, icons] = await Promise.all([client.overview(), loadAllIcons()]);
      if (!destroyed) {
        apply(overview, icons);
        if (!quiet) report("Website icons updated.", "success");
      }
    } catch (error) {
      if (!destroyed) report(error.message, "error");
    }
  }

  function refresh({ quiet = false } = {}) {
    if (destroyed) return Promise.resolve();
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
    if (destroyed || refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      if (!destroyed && active) void refresh({ quiet: true });
    });
  }

  function markChanged() {
    if (active) scheduleRefresh();
    else dirtyWhileInactive = true;
  }

  accessList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-origin]");
    const origin = button?.dataset.origin;
    const host = accessHosts.get(origin);
    if (busy || privateContext || !origin || !host) return;
    setBusy(true);
    report(`Waiting for Firefox to confirm access to ${host}...`, "status");
    try {
      const granted = await client.requestHostAccess(origin);
      if (!granted) {
        report(`Access to ${host} was not granted. Terminus will keep using the fallback icon.`, "error");
        return;
      }
      await client.confirmHostAccess(origin);
      await refresh({ quiet: true });
      report(`Access to ${host} was granted. Its icon will be retried when you use that site again.`, "success");
    } catch (error) {
      report(error.message, "error");
    } finally {
      setBusy(false);
    }
  });

  removeUnusedButton.addEventListener("click", async () => {
    if (busy || privateContext) return;
    setBusy(true);
    report("Removing website icons not used by open tabs or snapshots...", "status");
    try {
      const result = await client.removeUnused();
      await refresh({ quiet: true });
      report(`${result.removedCount} unused ${result.removedCount === 1 ? "icon was" : "icons were"} removed.`, "success");
    } catch (error) {
      report(error.message, "error");
    } finally {
      setBusy(false);
    }
  });
  clearButton.addEventListener("click", () => {
    if (!busy && !privateContext) dialog.showModal();
  });
  cancelButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => clearButton.focus());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || privateContext) return;
    dialog.close();
    setBusy(true);
    report("Clearing cached website icons...", "status");
    try {
      const result = await client.clearAll();
      await refresh({ quiet: true });
      report(`${result.removedCount} cached ${result.removedCount === 1 ? "icon was" : "icons were"} cleared. Icons can return as you revisit eligible sites.`, "success");
    } catch (error) {
      report(error.message, "error");
    } finally {
      setBusy(false);
    }
  });

  const onMessage = (message) => {
    if (message?.type === FAVICON_MESSAGE_TYPES.CHANGED) markChanged();
  };
  browser.runtime.onMessage.addListener(onMessage);
  return Object.freeze({
    refresh,
    setActive(value) {
      const wasActive = active;
      active = Boolean(value);
      if (active && (!wasActive || dirtyWhileInactive)) {
        dirtyWhileInactive = false;
        scheduleRefresh();
      }
    },
    notifyLocalStorageChanged() {},
    destroy() {
      destroyed = true;
      active = false;
      refreshScheduled = false;
      releaseObjectUrls();
      browser.runtime.onMessage.removeListener(onMessage);
    }
  });
}

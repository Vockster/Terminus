import { FAVICON_LOOKUP_MAX_TABS, FAVICON_MESSAGE_TYPES } from "../contracts/favicon-messages.js";
import { FAVICON_DIAGNOSTIC_REASONS } from "../contracts/favicon-cache.js";

const FALLBACK_COLORS = Object.freeze([
  "#3367d6", "#7b3fb3", "#a13f6f", "#a34b2b", "#7a5c00", "#28725a", "#176b87", "#4f5f79"
]);

function hashText(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function faviconFallback(title, logicalId) {
  const normalized = typeof title === "string" ? title.trim() : "";
  const initial = normalized.match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase() ?? "•";
  return { initial, color: FALLBACK_COLORS[hashText(logicalId) % FALLBACK_COLORS.length] };
}

function sameBytes(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return null;
}

export class FaviconPresenter {
  #root;
  #sendMessage;
  #createObjectURL;
  #revokeObjectURL;
  #onDiagnostic;
  #lookupEnabled;
  #reportedDiagnostics = new Set();
  // Icons are keyed by the complete live identity, never by logical id alone.
  // A logical id can survive close recovery while Firefox necessarily assigns
  // the recreated tab a different handle.
  #icons = new Map();
  #candidates = new Map();
  #pending = new Map();
  #revisions = new Map();
  #live = new Map();
  #liveByLogicalId = new Map();
  #rendered = new Map();
  #windowId = null;
  #destroyed = false;

  constructor({
    root,
    sendMessage = (message) => browser.runtime.sendMessage(message),
    createObjectURL = (blob) => URL.createObjectURL(blob),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
    lookupEnabled = () => true,
    onDiagnostic = () => {}
  }) {
    this.#root = root;
    this.#sendMessage = sendMessage;
    this.#createObjectURL = createObjectURL;
    this.#revokeObjectURL = revokeObjectURL;
    this.#lookupEnabled = lookupEnabled;
    this.#onDiagnostic = onDiagnostic;
  }

  // Called immediately after every tab-pane render. A view is only the current
  // projection, not an authoritative live-tab inventory: tabs that leave it on
  // a workspace switch or search filter keep their decoded image until an exact
  // removal/replacement event or synchronizeLiveTabs() proves them dead.
  present(view, windowId) {
    if (this.#destroyed) return;
    if (this.#windowId !== null && this.#windowId !== windowId) this.#resetForWindow();
    this.#windowId = windowId;
    const tabs = this.#identities(view?.activeTabs ?? []);
    this.#rendered = new Map(tabs.map((tab) => [tab.key, tab]));
    for (const tab of tabs) this.#markLive(tab);
    this.#request(this.#restore(tabs));
  }

  // Replace the inferred live set with a complete, authoritative inventory.
  // This is intentionally separate from present(): a filtered/current-workspace
  // projection must never be mistaken for proof that another live tab closed.
  synchronizeLiveTabs(tabs) {
    if (this.#destroyed) return;
    const next = this.#identities(tabs);
    const nextKeys = new Set(next.map(({ key }) => key));
    for (const key of [...this.#live.keys()]) {
      if (!nextKeys.has(key)) this.#retire(key);
    }
    for (const tab of next) this.#markLive(tab);
  }

  // A URL or favIconUrl update may or may not change the icon: single-page
  // sites such as YouTube update the URL constantly under the same icon.
  // Tearing the image down first showed the fallback letter until the lookup
  // returned, on every such update. The displayed image now stays until an
  // authoritative answer replaces it, clears it, or the lookup fails.
  handleSourceChange(logicalId, firefoxTabId) {
    const tab = this.#identity({ logicalId, firefoxTabId });
    if (!tab || !this.#live.has(tab.key) || this.#destroyed) return;
    this.#advance(tab.key);
    this.#pending.delete(tab.key);
    this.#discardCandidate(tab.key);
    this.#request([tab], { force: true, sourceChanged: true });
  }

  // Firefox-event-shaped helpers let the sidebar integrate before a refreshed
  // workspace view arrives. Firefox tab ids are live-window-unique, while the
  // presenter supplies the corresponding logical half of the identity.
  handleTabUpdate(firefoxTabId, changeInfo = {}) {
    // Firefox reports an icon change as favIconUrl, so a URL change alone is
    // no reason to look up: single-page sites change URLs constantly under
    // one icon. A page that finishes loading without declaring an icon only
    // becomes distinguishable from a still-loading page at completion.
    if (!Object.hasOwn(changeInfo, "favIconUrl") && changeInfo.status !== "complete") return;
    const tab = this.#liveIdentityForFirefoxTab(firefoxTabId);
    if (tab) this.handleSourceChange(tab.logicalId, tab.firefoxTabId);
  }

  handleTabReplaced(addedFirefoxTabId, removedFirefoxTabId) {
    const tab = this.#liveIdentityForFirefoxTab(removedFirefoxTabId);
    if (tab) this.handleTabReplacement(tab.logicalId, removedFirefoxTabId, addedFirefoxTabId);
  }

  handleTabRemoved(firefoxTabId) {
    const tab = this.#liveIdentityForFirefoxTab(firefoxTabId);
    if (tab) this.handleTabRemoval(tab.logicalId, tab.firefoxTabId);
  }

  handleTabReplacement(logicalId, removedFirefoxTabId, addedFirefoxTabId) {
    const removed = this.#identity({ logicalId, firefoxTabId: removedFirefoxTabId });
    const added = this.#identity({ logicalId, firefoxTabId: addedFirefoxTabId });
    if (!removed || !added || this.#destroyed) return;
    const wasRendered = this.#rendered.has(removed.key);
    this.#retire(removed.key);
    this.#markLive(added);
    if (wasRendered) this.#rendered.set(added.key, added);
    this.#request([added]);
  }

  handleTabRemoval(logicalId, firefoxTabId) {
    const tab = this.#identity({ logicalId, firefoxTabId });
    if (!tab || this.#destroyed) return;
    this.#retire(tab.key);
  }

  // Cache notifications revalidate rendered identities without first tearing
  // down valid images. A clear is authoritative and therefore releases them.
  refresh(change = "icons", firefoxTabIds = null) {
    if (this.#destroyed || !Number.isInteger(this.#windowId)) return;
    if (change === "clear") {
      for (const key of [...this.#live.keys()]) {
        this.#advance(key);
        this.#pending.delete(key);
        this.#discardCandidate(key);
        this.#releaseIcon(key);
      }
      return;
    }
    // A coarse notification carries no affected identity. Revalidate every
    // authoritative live tab, including rows already outside the current
    // workspace/search projection, so a cleared cache entry cannot reattach
    // its retained image when that row returns later.
    const affected = Array.isArray(firefoxTabIds)
      ? new Set(firefoxTabIds.filter((id) => Number.isInteger(id)))
      : null;
    this.#request(
      [...this.#live.values()].filter(({ firefoxTabId }) =>
        affected === null || affected.has(firefoxTabId)
      ),
      { force: true }
    );
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#resetForWindow();
    this.#windowId = null;
  }

  #identity(tab) {
    const logicalId = tab?.logicalId ?? tab?.logicalTabId;
    const firefoxTabId = tab?.firefoxTabId ?? tab?.firefoxId;
    if (typeof logicalId !== "string" || logicalId.length === 0 || !Number.isInteger(firefoxTabId)) return null;
    return { logicalId, firefoxTabId, key: `${logicalId}\u0000${firefoxTabId}` };
  }

  #identities(tabs) {
    const result = [];
    const seen = new Set();
    for (const value of tabs) {
      const tab = this.#identity(value);
      if (!tab || seen.has(tab.key)) continue;
      seen.add(tab.key);
      result.push(tab);
    }
    return result;
  }

  #liveIdentityForFirefoxTab(firefoxTabId) {
    if (!Number.isInteger(firefoxTabId)) return null;
    for (const tab of this.#live.values()) {
      if (tab.firefoxTabId === firefoxTabId) return tab;
    }
    return null;
  }

  #markLive(tab) {
    const previousKey = this.#liveByLogicalId.get(tab.logicalId);
    if (previousKey && previousKey !== tab.key) this.#retire(previousKey);
    this.#live.set(tab.key, tab);
    this.#liveByLogicalId.set(tab.logicalId, tab.key);
  }

  #retire(key) {
    const tab = this.#live.get(key);
    this.#advance(key);
    this.#pending.delete(key);
    this.#discardCandidate(key);
    this.#releaseIcon(key);
    this.#live.delete(key);
    this.#rendered.delete(key);
    if (tab && this.#liveByLogicalId.get(tab.logicalId) === key) {
      this.#liveByLogicalId.delete(tab.logicalId);
    }
  }

  #revision(key) {
    return this.#revisions.get(key) ?? 0;
  }

  #advance(key) {
    this.#revisions.set(key, this.#revision(key) + 1);
  }

  #restore(tabs) {
    const missing = [];
    let faviconByKey = null;
    for (const tab of tabs) {
      const entry = this.#icons.get(tab.key);
      if (!entry) {
        if (!this.#candidates.has(tab.key)) missing.push(tab);
        continue;
      }
      faviconByKey ??= this.#faviconIndex();
      const favicon = faviconByKey.get(tab.key) ??
        this.#faviconElement(tab.logicalId, tab.firefoxTabId);
      if (!favicon) continue;
      if (entry.image.parentNode !== favicon) favicon.append(entry.image);
      favicon.classList.add("tab-favicon--loaded");
    }
    return missing;
  }

  #request(tabs, { force = false, sourceChanged = false } = {}) {
    if (!Number.isInteger(this.#windowId) || this.#destroyed || !this.#lookupEnabled()) return;
    const requested = [];
    const seen = new Set();
    for (const tab of tabs) {
      if (seen.has(tab.key) || !this.#live.has(tab.key)) continue;
      seen.add(tab.key);
      if (this.#pending.has(tab.key) || this.#candidates.has(tab.key)) continue;
      if (!force && this.#icons.has(tab.key)) continue;
      requested.push(tab);
    }
    for (let offset = 0; offset < requested.length; offset += FAVICON_LOOKUP_MAX_TABS) {
      const chunk = requested.slice(offset, offset + FAVICON_LOOKUP_MAX_TABS);
      const token = Symbol("favicon-lookup");
      const states = chunk.map((tab) => ({ ...tab, revision: this.#revision(tab.key), sourceChanged }));
      for (const state of states) this.#pending.set(state.key, { token, revision: state.revision });
      let response;
      try {
        response = this.#sendMessage({
          type: FAVICON_MESSAGE_TYPES.LOOKUP,
          windowId: this.#windowId,
          tabs: chunk.map(({ logicalId, firefoxTabId }) => ({ logicalId, firefoxTabId }))
        });
      } catch {
        this.#finishFailedChunk(states, token);
        continue;
      }
      void Promise.resolve(response)
        .then((result) => this.#applyChunk(result, states, token))
        .catch(() => this.#finishFailedChunk(states, token));
    }
  }

  #finishFailedChunk(states, token) {
    for (const state of states) {
      if (this.#pending.get(state.key)?.token !== token) continue;
      this.#pending.delete(state.key);
      this.#releaseChangedSource(state);
    }
  }

  // After a proven source change, a failed lookup cannot confirm the image
  // still on screen, so it gives way to the fallback.
  #releaseChangedSource(state) {
    if (!state.sourceChanged || !this.#isCurrent(state)) return;
    this.#discardCandidate(state.key);
    this.#releaseIcon(state.key);
  }

  #applyChunk(response, states, token) {
    const successful = response?.ok === true && Array.isArray(response.result?.icons);
    const returned = new Map();
    const loading = new Set();
    if (successful) {
      for (const icon of response.result.icons) {
        const tab = this.#identity(icon);
        if (tab) returned.set(tab.key, icon);
      }
      for (const entry of Array.isArray(response.result.pending) ? response.result.pending : []) {
        const tab = this.#identity(entry);
        if (tab) loading.add(tab.key);
      }
    }
    for (const state of states) {
      const pending = this.#pending.get(state.key);
      if (pending?.token !== token) continue;
      this.#pending.delete(state.key);
      if (!successful) {
        this.#releaseChangedSource(state);
        continue;
      }
      if (!this.#isCurrent(state)) continue;
      const icon = returned.get(state.key);
      if (icon?.substitute === true && !state.sourceChanged && this.#icons.has(state.key)) {
        // Another icon of the same site stands in while this tab's own is not
        // cached. It helps a tab showing nothing, but trading a shown icon for
        // it made tabs on sites with several icons flip on every cache save.
        continue;
      }
      if (icon) {
        this.#stage(icon, state);
      } else if (loading.has(state.key)) {
        // The page has not declared its icon yet; keep the current image.
        continue;
      } else {
        // A successful lookup is authoritative for every requested exact
        // identity. Release a retained image even when its row left the
        // current projection while the lookup was pending, or that stale node
        // could be reattached on a later workspace/search render.
        this.#discardCandidate(state.key);
        this.#releaseIcon(state.key);
      }
    }
  }

  #isCurrent(state) {
    return this.#live.has(state.key) && this.#revision(state.key) === state.revision;
  }

  // One pass over the rendered rows replaces a document search per tab, which
  // grew with the square of the row count. The first row in document order
  // wins, exactly as querySelector would choose.
  #faviconIndex() {
    const index = new Map();
    for (const row of this.#root.querySelectorAll?.("[data-tab-id][data-firefox-tab-id]") ?? []) {
      const key = `${row.dataset?.tabId}\u0000${row.dataset?.firefoxTabId}`;
      if (index.has(key)) continue;
      const favicon = row.querySelector?.(".tab-favicon");
      if (favicon) index.set(key, favicon);
    }
    return index;
  }

  #faviconElement(logicalId, firefoxTabId) {
    const selector = `[data-tab-id="${CSS.escape(logicalId)}"][data-firefox-tab-id="${firefoxTabId}"]`;
    return this.#root.querySelector(selector)?.querySelector(".tab-favicon") ?? null;
  }

  #stage(icon, state) {
    if (icon.mime !== "image/png") return;
    const bytes = bytesFrom(icon.bytes);
    if (!bytes?.byteLength) return;
    // Cache refreshes return the same bytes for almost every row. Replacing
    // an identical image only risked a blank frame while the copy decoded.
    const displayed = this.#icons.get(state.key);
    if (displayed && sameBytes(displayed.bytes, bytes)) {
      this.#discardCandidate(state.key);
      const favicon = this.#faviconElement(state.logicalId, state.firefoxTabId);
      if (favicon && displayed.image.parentNode !== favicon) favicon.append(displayed.image);
      favicon?.classList.add("tab-favicon--loaded");
      return;
    }
    if (sameBytes(this.#candidates.get(state.key)?.bytes, bytes)) return;
    this.#discardCandidate(state.key);
    let resource;
    let image;
    try {
      resource = { url: this.#createObjectURL(new Blob([bytes], { type: icon.mime })), released: false };
      image = document.createElement("img");
      image.className = "tab-favicon-image";
      image.alt = "";
      image.draggable = false;
      const candidate = { ...state, resource, image, bytes };
      this.#candidates.set(state.key, candidate);
      image.addEventListener("load", () => {
        // Swap only once the replacement can paint, so the row never shows
        // an empty frame between the old image and the new one.
        if (typeof image.decode !== "function") {
          this.#acceptCandidate(candidate);
          return;
        }
        image.decode().then(
          () => this.#acceptCandidate(candidate),
          () => this.#acceptCandidate(candidate)
        );
      }, { once: true });
      image.addEventListener("error", () => {
        if (this.#candidates.get(state.key) !== candidate) return;
        this.#discardCandidate(state.key);
        if (!this.#icons.has(state.key)) this.#clearLoaded(state);
        this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.DISPLAY_FAILED);
      }, { once: true });
      image.src = resource.url;
    } catch {
      if (this.#candidates.get(state.key)?.resource === resource) this.#candidates.delete(state.key);
      image?.remove?.();
      this.#releaseResource(resource);
    }
  }

  #acceptCandidate(candidate) {
    if (this.#candidates.get(candidate.key) !== candidate) return;
    if (!this.#isCurrent(candidate)) {
      this.#discardCandidate(candidate.key);
      return;
    }
    const previous = this.#icons.get(candidate.key);
    if (previous) {
      previous.image.remove();
      this.#releaseResource(previous.resource);
    }
    this.#candidates.delete(candidate.key);
    this.#icons.set(candidate.key, candidate);
    const favicon = this.#faviconElement(candidate.logicalId, candidate.firefoxTabId);
    if (!favicon) return;
    favicon.append(candidate.image);
    favicon.classList.add("tab-favicon--loaded");
    if (favicon.isConnected) this.#diagnose(FAVICON_DIAGNOSTIC_REASONS.DISPLAYED);
  }

  #discardCandidate(key) {
    const candidate = this.#candidates.get(key);
    if (!candidate) return;
    this.#candidates.delete(key);
    candidate.image.remove();
    this.#releaseResource(candidate.resource);
  }

  #releaseIcon(key) {
    const entry = this.#icons.get(key);
    if (!entry) return;
    this.#icons.delete(key);
    entry.image.remove();
    this.#releaseResource(entry.resource);
    this.#clearLoaded(entry);
  }

  #releaseResource(resource) {
    if (!resource || resource.released) return;
    resource.released = true;
    this.#revokeObjectURL(resource.url);
  }

  #clearLoaded({ logicalId, firefoxTabId }) {
    this.#faviconElement(logicalId, firefoxTabId)?.classList.remove("tab-favicon--loaded");
  }

  #diagnose(reason) {
    if (this.#reportedDiagnostics.has(reason)) return;
    this.#reportedDiagnostics.add(reason);
    this.#onDiagnostic(reason);
  }

  #resetForWindow() {
    for (const key of [...this.#candidates.keys()]) this.#discardCandidate(key);
    for (const key of [...this.#icons.keys()]) this.#releaseIcon(key);
    this.#pending.clear();
    this.#revisions.clear();
    this.#live.clear();
    this.#liveByLogicalId.clear();
    this.#rendered.clear();
  }
}

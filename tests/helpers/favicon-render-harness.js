import { createTabRenderCoordinator } from "../../src/sidebar/tab-render-coordinator.js";
import { FaviconPresenter } from "../../src/sidebar/favicon-presenter.js";

function identityOf(value) {
  const logicalId = value?.logicalId ?? value?.logicalTabId;
  const firefoxTabId = value?.firefoxTabId ?? value?.firefoxId;
  return { logicalId, firefoxTabId, key: `${logicalId}\u0000${firefoxTabId}` };
}

function faviconSlot() {
  const classes = new Set();
  return {
    isConnected: true,
    children: [],
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      has: (name) => classes.has(name)
    },
    append(image) {
      image.parentNode?.removeChild?.(image);
      image.parentNode = this;
      if (!this.children.includes(image)) this.children.push(image);
    },
    removeChild(image) {
      this.children = this.children.filter((child) => child !== image);
      image.parentNode = null;
    }
  };
}

export function createFaviconRenderHarness({
  resolveIcon = () => Uint8Array.of(1),
  windowId = 7
} = {}) {
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const requests = [];
  const createdUrls = [];
  const revokedUrls = [];
  const images = [];
  let rows = new Map();

  globalThis.document = {
    createElement() {
      const listeners = {};
      const image = {
        className: "",
        alt: "",
        draggable: true,
        parentNode: null,
        addEventListener(name, listener) {
          listeners[name] = listener;
        },
        set src(value) {
          this.source = value;
          queueMicrotask(() => listeners.load?.());
        },
        remove() {
          this.parentNode?.removeChild?.(this);
        }
      };
      images.push(image);
      return image;
    }
  };
  globalThis.CSS = { escape: (value) => value };

  const root = {
    querySelector(selector) {
      const logicalId = selector.match(/data-tab-id="([^"]+)"/)?.[1];
      const firefoxTabId = Number(selector.match(/data-firefox-tab-id="(\d+)"/)?.[1]);
      const slot = rows.get(`${logicalId}\u0000${firefoxTabId}`);
      return slot ? { querySelector: () => slot } : null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const presenter = new FaviconPresenter({
    root,
    async sendMessage(message) {
      requests.push(structuredClone(message));
      const icons = [];
      for (const reference of message.tabs) {
        const resolved = resolveIcon({ ...reference });
        if (resolved === null || resolved === undefined) continue;
        const bytes = resolved instanceof Uint8Array
          ? resolved
          : resolved.bytes instanceof Uint8Array
            ? resolved.bytes
            : Uint8Array.of(1);
        icons.push({
          logicalId: reference.logicalId,
          firefoxTabId: reference.firefoxTabId,
          mime: resolved.mime ?? "image/png",
          bytes
        });
      }
      return { ok: true, result: { icons } };
    },
    createObjectURL() {
      const url = `blob:test-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL(url) {
      revokedUrls.push(url);
    }
  });
  const coordinator = createTabRenderCoordinator({
    tabPane: {
      render(view) {
        rows = new Map(
          (view.activeTabs ?? []).map((tab) => {
            const identity = identityOf(tab);
            return [identity.key, faviconSlot()];
          })
        );
      }
    },
    searchRoot: { replaceChildren() {} },
    faviconPresenter: presenter,
    getWindowId: () => windowId
  });

  return {
    requests,
    createdUrls,
    revokedUrls,
    images,
    presenter,
    render(view) {
      coordinator.renderTree(view);
    },
    slot(logicalId, firefoxTabId) {
      return rows.get(`${logicalId}\u0000${firefoxTabId}`) ?? null;
    },
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    destroy() {
      presenter.destroy();
      globalThis.document = previousDocument;
      globalThis.CSS = previousCss;
    }
  };
}

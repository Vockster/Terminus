import test from "node:test";
import assert from "node:assert/strict";

import { recoverClosedSidebarTabs } from "../../src/core/sidebar-tab-recovery.js";
import { createFaviconRenderHarness } from "../helpers/favicon-render-harness.js";

function descriptor(logicalTabId, overrides = {}) {
  return {
    logicalTabId,
    firefoxTabId: 10,
    windowId: 7,
    logicalWindowId: "window-one",
    workspaceId: "ws-default-work",
    index: 0,
    url: "https://example.com/",
    title: "Example",
    pinned: false,
    discarded: false,
    active: false,
    hidden: false,
    containerRef: null,
    ...overrides
  };
}

function faviconView(tabs) {
  return {
    activeTabs: tabs.map(({ logicalTabId, firefoxTabId }) => ({
      logicalId: logicalTabId,
      firefoxId: firefoxTabId
    })),
    liveTabIdentities: tabs.map(({ logicalTabId, firefoxTabId }) => ({
      logicalTabId,
      firefoxTabId
    }))
  };
}

function faviconIdentity({ logicalTabId, firefoxTabId }) {
  return `${logicalTabId}\u0000${firefoxTabId}`;
}

test("closed-tab recovery recreates inactive tabs and reports protected URLs and ID conflicts", async () => {
  const calls = [];
  let nextId = 20;
  const entry = {
    affectedKeys: ["tab:tab-a", "tab:tab-b"],
    before: {
      browserTabs: [
        descriptor("tab-a", { index: 1 }),
        descriptor("tab-b", {
          index: 2,
          url: "about:config",
          containerRef: "ctr-one"
        })
      ]
    }
  };
  const result = await recoverClosedSidebarTabs({
    entry,
    currentSnapshot: {
      browserTabs: [],
      workspaceRuntime: { tabs: [{ id: "tab-b", workspaceId: "ws-default-work" }] }
    },
    browserAdapter: {
      async listNormalWindowIds() { return [7]; },
      async createTab(windowId, options) {
        calls.push(["create", windowId, options]);
        return { id: nextId++ };
      },
      async setTabIdentity(tabId, logicalTabId) {
        calls.push(["set", tabId, logicalTabId]);
      },
      async getOrCreateTabIdentity(tabId) {
        calls.push(["allocate", tabId]);
        return "tab-new";
      }
    },
    containerService: {
      async resolve(refId) {
        assert.equal(refId, "ctr-one");
        return "firefox-container-1";
      }
    }
  });

  assert.deepEqual(calls[0], ["create", 7, {
    active: false,
    index: 1,
    url: "https://example.com/",
    cookieStoreId: null
  }]);
  assert.deepEqual(calls[2], ["create", 7, {
    active: false,
    index: 2,
    url: "about:blank",
    cookieStoreId: "firefox-container-1"
  }]);
  assert.deepEqual(result.restored.map(({ logicalTabId }) => logicalTabId), ["tab-a", "tab-new"]);
  assert.equal(result.approximatedCount, 2);
  assert.deepEqual(result.reasons, [
    { reason: "identity-conflict-approximated", count: 1 },
    { reason: "protected-url-approximated", count: 1 }
  ]);
});

test("closed-tab recovery skips lost windows and containers, reports failures, and retains safety tabs", async () => {
  const entry = {
    affectedKeys: ["tab:tab-window", "tab:tab-container", "tab:tab-failure", "tab:tab-safety"],
    before: {
      browserTabs: [
        descriptor("tab-window", { windowId: 9 }),
        descriptor("tab-container", { containerRef: "ctr-missing" }),
        descriptor("tab-failure")
      ]
    }
  };
  const result = await recoverClosedSidebarTabs({
    entry,
    currentSnapshot: {
      browserTabs: [descriptor("tab-safety", { firefoxTabId: 99 })],
      workspaceRuntime: { tabs: [] }
    },
    browserAdapter: {
      async listNormalWindowIds() { return [7]; },
      async createTab() { throw new Error("Firefox refused"); },
      async setTabIdentity() { assert.fail("failed creations have no identity"); },
      async getOrCreateTabIdentity() { assert.fail("failed creations have no identity"); }
    },
    containerService: {
      async resolve() { throw new Error("missing container"); }
    }
  });

  assert.equal(result.requestedCount, 3);
  assert.deepEqual(result.skipped, ["tab-container", "tab-window"]);
  assert.deepEqual(result.failed, ["tab-failure"]);
  assert.equal(result.retainedSafetyCount, 1);
  assert.deepEqual(result.reasons, [
    { reason: "container-unavailable", count: 1 },
    { reason: "browser-failure", count: 1 },
    { reason: "missing-tab", count: 1 },
    { reason: "safety-successor-retained", count: 1 }
  ]);
});

test("closed-tab recovery removes a created tab when logical identity binding fails", async () => {
  const removed = [];
  const result = await recoverClosedSidebarTabs({
    entry: {
      affectedKeys: ["tab:tab-a"],
      before: { browserTabs: [descriptor("tab-a")] }
    },
    currentSnapshot: {
      browserTabs: [],
      workspaceRuntime: { tabs: [] }
    },
    browserAdapter: {
      async listNormalWindowIds() { return [7]; },
      async createTab() { return { id: 22 }; },
      async setTabIdentity() { throw new Error("identity write failed"); },
      async getOrCreateTabIdentity() { assert.fail("the original identity was free"); },
      async removeTabs(tabIds) { removed.push(...tabIds); }
    }
  });

  assert.deepEqual(removed, [22]);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(result.failed, ["tab-a"]);
  assert.deepEqual(result.reasons, [{ reason: "browser-failure", count: 1 }]);
});

test("close recovery variants reacquire only exact recreated identities and keep honest fallbacks", async (t) => {
  const scenarios = [
    {
      name: "logical identity conflict",
      beforeTabs: [descriptor("tab-a")],
      currentTabs: [],
      runtimeTabs: [{ id: "tab-a", workspaceId: "ws-default-work" }],
      allocatedLogicalId: "tab-recreated",
      cachedRestored: false,
      expectedRestored: ["tab-recreated"],
      expectedSkipped: [],
      expectedReasons: [{ reason: "identity-conflict-approximated", count: 1 }]
    },
    {
      name: "protected URL approximation",
      beforeTabs: [descriptor("tab-a", { url: "about:config" })],
      currentTabs: [],
      runtimeTabs: [],
      cachedRestored: false,
      expectedRestored: ["tab-a"],
      expectedSkipped: [],
      expectedReasons: [{ reason: "protected-url-approximated", count: 1 }]
    },
    {
      name: "partial restore with an unavailable container",
      beforeTabs: [
        descriptor("tab-a", { index: 0 }),
        descriptor("tab-b", { index: 1, containerRef: "ctr-missing" })
      ],
      currentTabs: [],
      runtimeTabs: [],
      containerUnavailable: true,
      cachedRestored: true,
      expectedRestored: ["tab-a"],
      expectedSkipped: ["tab-b"],
      expectedReasons: [{ reason: "container-unavailable", count: 1 }]
    },
    {
      name: "retained safety successor",
      beforeTabs: [descriptor("tab-a")],
      currentTabs: [descriptor("tab-safety", { firefoxTabId: 99 })],
      runtimeTabs: [{ id: "tab-safety", workspaceId: "ws-default-work" }],
      affectedExtras: ["tab:tab-safety"],
      cachedRestored: true,
      expectedRestored: ["tab-a"],
      expectedSkipped: [],
      expectedReasons: [{ reason: "safety-successor-retained", count: 1 }]
    }
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const cached = new Set([
        ...scenario.beforeTabs.map(faviconIdentity),
        ...scenario.currentTabs.map(faviconIdentity)
      ]);
      const favicons = createFaviconRenderHarness({
        resolveIcon(reference) {
          return cached.has(faviconIdentity({
            logicalTabId: reference.logicalId,
            firefoxTabId: reference.firefoxTabId
          }))
            ? Uint8Array.of(reference.firefoxTabId % 255 || 1)
            : null;
        }
      });
      try {
        favicons.render(faviconView(scenario.beforeTabs));
        await favicons.settle();
        const closedImages = new Map(scenario.beforeTabs.map((tab) => [
          tab.logicalTabId,
          favicons.slot(tab.logicalTabId, tab.firefoxTabId)?.children[0]
        ]));
        assert.ok([...closedImages.values()].every(Boolean));

        favicons.render(faviconView(scenario.currentTabs));
        await favicons.settle();
        for (const image of closedImages.values()) {
          assert.ok(favicons.revokedUrls.includes(image.source));
        }
        const safetyImage = scenario.currentTabs.length > 0
          ? favicons.slot("tab-safety", 99)?.children[0]
          : null;

        let nextFirefoxTabId = 20;
        const result = await recoverClosedSidebarTabs({
          entry: {
            affectedKeys: [
              ...scenario.beforeTabs.map(({ logicalTabId }) => `tab:${logicalTabId}`),
              ...(scenario.affectedExtras ?? [])
            ],
            before: { browserTabs: scenario.beforeTabs }
          },
          currentSnapshot: {
            browserTabs: scenario.currentTabs,
            workspaceRuntime: { tabs: scenario.runtimeTabs }
          },
          browserAdapter: {
            async listNormalWindowIds() { return [7]; },
            async createTab() { return { id: nextFirefoxTabId++ }; },
            async setTabIdentity() {},
            async getOrCreateTabIdentity() {
              return scenario.allocatedLogicalId ?? "tab-recreated";
            }
          },
          containerService: {
            async resolve() {
              if (scenario.containerUnavailable) throw new Error("missing container");
              return "firefox-container-1";
            }
          }
        });

        assert.deepEqual(
          result.restored.map(({ logicalTabId }) => logicalTabId),
          scenario.expectedRestored
        );
        assert.deepEqual(result.skipped, scenario.expectedSkipped);
        assert.deepEqual(result.reasons, scenario.expectedReasons);

        if (scenario.cachedRestored) {
          for (const restored of result.restored) cached.add(faviconIdentity(restored));
        }
        const restoredTabs = result.restored.map(({ logicalTabId, firefoxTabId }) => ({
          logicalTabId,
          firefoxTabId
        }));
        favicons.render(faviconView([...scenario.currentTabs, ...restoredTabs]));
        await favicons.settle();

        for (const restored of restoredTabs) {
          const exactLookup = favicons.requests.flatMap(({ tabs }) => tabs).some((reference) =>
            reference.logicalId === restored.logicalTabId &&
            reference.firefoxTabId === restored.firefoxTabId
          );
          assert.equal(exactLookup, true, "the recreated composite identity is looked up exactly");
          const restoredImage = favicons.slot(
            restored.logicalTabId,
            restored.firefoxTabId
          )?.children[0];
          if (scenario.cachedRestored) {
            assert.ok(restoredImage, "a valid origin cache entry is reattached to the new handle");
            assert.equal(
              [...closedImages.values()].includes(restoredImage),
              false,
              "the recreated row never borrows a closed handle's decoded image"
            );
          } else {
            assert.equal(restoredImage, undefined, "an unavailable exact icon keeps the fallback");
          }
        }
        for (const logicalTabId of scenario.expectedSkipped) {
          assert.equal(
            [...result.restored, ...scenario.currentTabs]
              .some((entry) => entry.logicalTabId === logicalTabId),
            false
          );
        }
        if (safetyImage) {
          assert.equal(
            favicons.slot("tab-safety", 99)?.children[0],
            safetyImage,
            "Undo keeps the safety successor's decoded favicon"
          );
        }
        assert.equal(new Set(favicons.revokedUrls).size, favicons.revokedUrls.length);
      } finally {
        favicons.destroy();
      }
    });
  }
});

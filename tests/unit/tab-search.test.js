import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TAB_SEARCH_SCOPE,
  TAB_SEARCH_SCOPES,
  createTabSearchController,
  filterTabSearchResults,
  normalizedTabSearchQuery,
  tabSearchBreadcrumb
} from "../../src/sidebar/tab-search.js";
import { parseWorkspaceSearchIndex } from "../../src/contracts/workspace-search.js";
import { createEvent, createFakeDocument, element } from "../helpers/fake-dom.js";

const index = {
  tabs: [
    {
      logicalTabId: "tab-one",
      firefoxTabId: 11,
      workspaceId: "ws-one",
      title: "Release Notes",
      discarded: true,
      pinned: false,
      groupTitle: "Planning",
      ancestorTitles: ["Project"],
      location: "docs.example.test/release"
    },
    {
      logicalTabId: "tab-two",
      firefoxTabId: 12,
      workspaceId: "ws-two",
      title: "Notes archive",
      discarded: false,
      pinned: false,
      groupTitle: null,
      ancestorTitles: [],
      location: null
    },
    {
      logicalTabId: "tab-three",
      firefoxTabId: 13,
      workspaceId: "ws-one",
      title: "Inbox",
      discarded: false,
      pinned: false,
      groupTitle: "Release notes group",
      ancestorTitles: ["Notes ancestor"],
      location: "mail.example.test/inbox"
    },
    {
      logicalTabId: "tab-four",
      firefoxTabId: 14,
      workspaceId: "ws-one",
      title: "Footnotes",
      discarded: false,
      pinned: false,
      groupTitle: null,
      ancestorTitles: [],
      location: null
    }
  ]
};

const ids = (tabs) => tabs.map(({ logicalTabId }) => logicalTabId);

test("tab search is trimmed, case-insensitive, and ignores context-only text", () => {
  assert.equal(normalizedTabSearchQuery("  NoTeS "), "notes");
  assert.deepEqual(ids(filterTabSearchResults(index, {
    query: "  NoTeS ",
    activeWorkspaceId: "ws-one"
  })), ["tab-one", "tab-two", "tab-four"]);
  assert.deepEqual(filterTabSearchResults(index, {
    query: "ancestor",
    activeWorkspaceId: "ws-one"
  }), []);
  assert.deepEqual(filterTabSearchResults(index, {
    query: "   ",
    activeWorkspaceId: "ws-one"
  }), []);
});

test("tab search defaults to every workspace in the window", () => {
  assert.equal(DEFAULT_TAB_SEARCH_SCOPE, TAB_SEARCH_SCOPES.WINDOW);
  assert.deepEqual(ids(filterTabSearchResults(index, {
    query: "archive",
    activeWorkspaceId: "ws-one"
  })), ["tab-two"]);
  assert.deepEqual(ids(filterTabSearchResults(index, {
    query: "notes",
    scope: TAB_SEARCH_SCOPES.WORKSPACE,
    activeWorkspaceId: "ws-one"
  })), ["tab-one", "tab-four"]);
  assert.throws(
    () => filterTabSearchResults(index, { query: "notes", scope: "everything" }),
    /Invalid tab search scope/
  );
});

test("title word matches rank above in-word title matches, then site and path matches", () => {
  assert.deepEqual(ids(filterTabSearchResults(index, {
    query: "notes",
    activeWorkspaceId: "ws-one"
  })), ["tab-one", "tab-two", "tab-four"]);
  assert.deepEqual(ids(filterTabSearchResults(index, {
    query: "example.test",
    activeWorkspaceId: "ws-one"
  })), ["tab-one", "tab-three"]);
  const mixed = {
    tabs: [
      { ...index.tabs[2], title: "Inbox", location: "release.example.test" },
      { ...index.tabs[3], title: "Prerelease plan" },
      { ...index.tabs[0], title: "Release" }
    ]
  };
  assert.deepEqual(ids(filterTabSearchResults(mixed, { query: "release" })), [
    "tab-one",
    "tab-four",
    "tab-three"
  ]);
});

test("tab search drops identities the newest view or a removal no longer holds, and duplicates", () => {
  const duplicated = { tabs: [...index.tabs, { ...index.tabs[0] }] };
  assert.deepEqual(ids(filterTabSearchResults(duplicated, { query: "notes" })), [
    "tab-one",
    "tab-two",
    "tab-four"
  ]);
  assert.deepEqual(ids(filterTabSearchResults(index, {
    query: "notes",
    liveTabIdentities: [
      { logicalTabId: "tab-one", firefoxTabId: 11 },
      { logicalTabId: "tab-two", firefoxTabId: 99 },
      { logicalTabId: "tab-four", firefoxTabId: 14 }
    ],
    removedFirefoxTabIds: new Set([14])
  })), ["tab-one"]);
});

test("tab search breadcrumbs supply workspace, group, and tree context", () => {
  assert.equal(tabSearchBreadcrumb(index.tabs[0], "Work"), "Work › Planning › Project");
});

const WORKSPACES = Object.freeze([
  { id: "ws-work", name: "Work", icon: "house", color: "#FFFFFF", defaultContainerRef: null },
  { id: "ws-personal", name: "Personal", icon: "user", color: "#AbCdEf", defaultContainerRef: "ctr-bank" }
]);

function row(id, workspaceId, title, overrides = {}) {
  return {
    logicalTabId: `tab-${id}`,
    firefoxTabId: id,
    workspaceId,
    title,
    discarded: false,
    pinned: false,
    groupTitle: null,
    ancestorTitles: [],
    location: null,
    ...overrides
  };
}

// Builds the exact wire document the background sends: presentation colors
// are canonicalized by the background parse, then serialized.
function wireIndex(tabs, workspaces = WORKSPACES) {
  return JSON.parse(JSON.stringify(parseWorkspaceSearchIndex({
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      icon: workspace.icon,
      color: workspace.color,
      container: workspace.defaultContainerRef === null
        ? { kind: "none" }
        : {
          kind: "container",
          refId: workspace.defaultContainerRef,
          descriptor: { name: "Bank", color: "blue", icon: "dollar", colorCode: "#37adff" },
          status: "available"
        }
    })),
    tabs
  }, workspaces)));
}

function viewFor(tabs, { activeWorkspaceId = "ws-work", workspaces = WORKSPACES } = {}) {
  return {
    activeWorkspaceId,
    state: { workspaces: structuredClone(workspaces) },
    liveTabIdentities: tabs.map(({ logicalTabId, firefoxTabId }) => ({
      logicalTabId,
      firefoxTabId
    }))
  };
}

function createSearchHarness({ contentMode = "full", activate = async () => true } = {}) {
  const document = createFakeDocument();
  const input = element(document, "input", { className: "tab-search-input" });
  const clear = element(document, "button", { className: "tab-search-clear", hidden: true });
  const scope = element(document, "select", { className: "tab-search-scope" });
  scope.value = DEFAULT_TAB_SEARCH_SCOPE;
  const controls = element(document, "div", { className: "tab-search-controls", hidden: true }, [
    element(document, "div", { className: "tab-search-input-wrap" }, [input, clear]),
    scope
  ]);
  const toggle = element(document, "button", { className: "tab-search-toggle" });
  const region = element(document, "div", { className: "tab-search", hidden: true }, [toggle, controls]);
  const results = element(document, "div", { className: "tab-search-results", hidden: true });
  const tree = element(document, "div", { className: "tab-list" });
  const treeRow = element(document, "div", { className: "tab-row" });
  tree.append(treeRow);
  const scroll = element(document, "div", { className: "tab-scroll" }, [results, tree]);
  const footer = element(document, "div", { className: "tab-footer" });
  const pane = element(document, "section", { className: "tab-pane" }, [region, scroll, footer]);
  document.body.dataset.contentMode = contentMode;
  document.body.append(pane);

  const loads = [];
  const activations = [];
  const indicators = [];
  const presented = [];
  let treeShown = 0;
  const controller = createTabSearchController({
    document,
    elements: { pane, region, toggle, controls, input, clear, scope, results, tree, scroll, footer },
    loadIndex: () => new Promise((resolve, reject) => loads.push({ resolve, reject })),
    parseIndex: parseWorkspaceSearchIndex,
    createWorkspaceIndicator(workspace) {
      indicators.push(workspace);
      return element(document, "span", { className: "tab-search-result-workspace" });
    },
    createFavicon: () => element(document, "span", { className: "tab-favicon" }),
    presentResults({ content, renderedTabs }) {
      presented.push(renderedTabs);
      results.replaceChildren(content);
    },
    showTree() {
      treeShown += 1;
      results.replaceChildren();
    },
    activateResult(tab) {
      activations.push(tab);
      return activate(tab);
    },
    focusActivatedTab() {
      treeRow.focus();
      return true;
    }
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    document,
    controller,
    elements: { pane, region, toggle, controls, input, clear, scope, results, tree, treeRow, footer },
    loads,
    activations,
    indicators,
    presented,
    treeShownCount: () => treeShown,
    settle,
    async respond(tabs, workspaces) {
      const load = loads.shift();
      assert.ok(load, "an index request is pending");
      load.resolve(wireIndex(tabs, workspaces));
      await settle();
    },
    async fail() {
      loads.shift().reject(new Error("Synthetic transport failure"));
      await settle();
    },
    type(text) {
      input.value = text;
      input.dispatchEvent(createEvent("input"));
    },
    key(target, key, properties = {}) {
      const event = createEvent("keydown", { key, ...properties });
      target.dispatchEvent(event);
      return event;
    },
    resultButtons: () => results.querySelectorAll(".tab-search-result"),
    resultTitles: () => results
      .querySelectorAll(".tab-search-result-title")
      .map(({ textContent }) => textContent),
    statusText: () => results.querySelectorAll(".tab-search-empty")[0]?.textContent ?? null
  };
}

const TABS = Object.freeze([
  row(11, "ws-work", "Quarterly report"),
  row(12, "ws-work", "Team calendar", { pinned: true }),
  row(21, "ws-personal", "Bank statement report", {
    discarded: true,
    groupTitle: "Finance",
    location: "bank.example.test/statements"
  }),
  row(22, "ws-personal", "Recipes")
]);

async function openWithIndex(harness, tabs = TABS, viewOptions = {}) {
  harness.controller.configure({ enabled: true, position: "top" });
  harness.controller.setView(viewFor(tabs, viewOptions));
  harness.elements.toggle.click();
  await harness.respond(tabs, viewOptions.workspaces);
}

for (const contentMode of ["full", "icons"]) {
  test(`the magnifier opens search with input focus and every workspace in scope (${contentMode})`, async () => {
    const harness = createSearchHarness({ contentMode });
    const { toggle, controls, input, region, pane, results, tree, scope } = harness.elements;
    harness.controller.configure({ enabled: true, position: "top" });
    harness.controller.setView(viewFor(TABS));

    assert.equal(region.hidden, false);
    assert.equal(controls.hidden, true);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(pane.dataset.tabSearchOpen, "false");
    assert.equal(harness.loads.length, 0);

    toggle.click();
    assert.equal(controls.hidden, false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(pane.dataset.tabSearchOpen, "true");
    assert.equal(harness.document.activeElement, input);
    assert.equal(scope.value, TAB_SEARCH_SCOPES.WINDOW);
    assert.equal(input.placeholder, "Search all tabs…");
    assert.equal(harness.loads.length, 1, "opening prefetches the index");
    assert.equal(tree.hidden, false, "an empty query keeps the ordinary tab list");

    await harness.respond(TABS);
    harness.type("report");
    assert.equal(tree.hidden, true);
    assert.equal(results.hidden, false);
    assert.deepEqual(harness.resultTitles(), ["Quarterly report", "Bank statement report"]);
    assert.equal(harness.document.activeElement, input);
  });
}

test("results from the active and other workspaces keep workspace, group, pin, and unload context", async () => {
  const harness = createSearchHarness();
  await openWithIndex(harness);
  harness.type("report");

  const [work, personal] = harness.resultButtons();
  assert.equal(work.dataset.workspaceId, "ws-work");
  assert.equal(personal.dataset.workspaceId, "ws-personal");
  assert.equal(personal.querySelectorAll(".tab-search-result-context")[0].textContent, "Personal › Finance");
  assert.equal(personal.querySelectorAll(".tab-search-result-state")[0].textContent, "Unloaded");
  assert.match(personal.getAttribute("aria-label"), /^Bank statement report, Personal › Finance, unloaded$/);
  assert.deepEqual(
    harness.indicators.slice(-2).map(({ id, container }) => [id, container.status]),
    [["ws-work", undefined], ["ws-personal", "available"]]
  );

  harness.type("calendar");
  const [pinned] = harness.resultButtons();
  assert.equal(pinned.querySelectorAll(".tab-search-result-state")[0].textContent, "Pinned");

  harness.type("bank.example");
  assert.deepEqual(harness.resultTitles(), ["Bank statement report"], "container workspace tabs match by site");
});

test("clicking a result from another workspace activates that exact tab and closes search", async () => {
  const harness = createSearchHarness();
  await openWithIndex(harness);
  harness.type("bank");
  const [result] = harness.resultButtons();
  result.querySelectorAll(".tab-search-result-title")[0].click();
  await harness.settle();

  assert.deepEqual(
    harness.activations.map(({ workspaceId, logicalTabId, firefoxTabId }) => ({
      workspaceId,
      logicalTabId,
      firefoxTabId
    })),
    [{ workspaceId: "ws-personal", logicalTabId: "tab-21", firefoxTabId: 21 }]
  );
  assert.equal(harness.controller.isOpen(), false);
  assert.equal(harness.elements.input.value, "");
  assert.equal(harness.elements.results.hidden, true);
  assert.equal(harness.elements.tree.hidden, false);
  assert.equal(harness.document.activeElement, harness.elements.treeRow);
});

test("Enter activates the first ranked result and arrows move between results", async () => {
  const harness = createSearchHarness();
  await openWithIndex(harness);
  const { input } = harness.elements;
  harness.type("re");

  const composing = harness.key(input, "Enter", { isComposing: true });
  assert.equal(composing.defaultPrevented, false);
  assert.equal(harness.activations.length, 0);

  harness.key(input, "ArrowDown");
  const buttons = harness.resultButtons();
  assert.equal(harness.document.activeElement, buttons[0]);
  harness.key(buttons[0], "ArrowDown");
  assert.equal(harness.document.activeElement, buttons[1]);
  harness.key(buttons[1], "ArrowUp");
  harness.key(buttons[0], "ArrowUp");
  assert.equal(harness.document.activeElement, input);

  const enter = harness.key(input, "Enter");
  await harness.settle();
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(harness.activations.map(({ logicalTabId }) => logicalTabId), ["tab-11"]);
});

test("Escape and the magnifier close search, reset its state, and restore the tab list", async () => {
  const harness = createSearchHarness();
  await openWithIndex(harness);
  const { input, scope, toggle, results, tree, controls } = harness.elements;
  scope.value = TAB_SEARCH_SCOPES.WORKSPACE;
  scope.dispatchEvent(createEvent("change"));
  assert.equal(input.placeholder, "Search this workspace…");
  harness.type("report");
  const [result] = harness.resultButtons();
  result.focus();

  const escape = harness.key(result, "Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.controller.isOpen(), false);
  assert.equal(input.value, "");
  assert.equal(scope.value, TAB_SEARCH_SCOPES.WINDOW);
  assert.equal(controls.hidden, true);
  assert.equal(results.hidden, true);
  assert.equal(tree.hidden, false);
  assert.equal(harness.document.activeElement, toggle);

  toggle.click();
  assert.equal(harness.document.activeElement, input);
  harness.key(input, "Escape");
  assert.equal(harness.controller.isOpen(), false);

  toggle.click();
  toggle.focus();
  toggle.click();
  assert.equal(harness.controller.isOpen(), false);
  assert.equal(harness.document.activeElement, toggle);

  const closedEscape = harness.key(toggle, "Escape");
  assert.equal(closedEscape.defaultPrevented, false, "closed search leaves Escape alone");
});

test("closed and newly opened tabs and changed titles converge without duplicates", async () => {
  const harness = createSearchHarness();
  await openWithIndex(harness);
  harness.type("report");
  assert.deepEqual(harness.resultTitles(), ["Quarterly report", "Bank statement report"]);

  harness.controller.handleTabRemoved(21);
  assert.deepEqual(harness.resultTitles(), ["Quarterly report"], "a removal hides the row at once");

  const opened = [
    row(11, "ws-work", "Quarterly report (final)"),
    row(12, "ws-work", "Team calendar", { pinned: true }),
    row(22, "ws-personal", "Recipes"),
    row(23, "ws-personal", "Expense report")
  ];
  harness.controller.setView(viewFor(opened));
  assert.deepEqual(harness.resultTitles(), ["Quarterly report"], "stale rows stay visible while refreshing");
  harness.controller.setView(viewFor(opened));
  assert.equal(harness.loads.length, 1, "only one index request runs at a time");

  await harness.respond(TABS);
  assert.equal(harness.loads.length, 1, "a response older than the newest view is followed by another");
  assert.deepEqual(harness.resultTitles(), ["Quarterly report"]);

  await harness.respond(opened);
  assert.equal(harness.loads.length, 0);
  assert.deepEqual(harness.resultTitles(), ["Quarterly report (final)", "Expense report"]);
  assert.equal(harness.resultButtons().length, new Set(
    harness.resultButtons().map(({ dataset }) => dataset.tabId)
  ).size);
});

test("view refreshes keep focus on the input or the same result", async () => {
  const harness = createSearchHarness();
  await openWithIndex(harness);
  const { input } = harness.elements;
  harness.type("report");
  harness.controller.setView(viewFor(TABS));
  assert.equal(harness.document.activeElement, input);
  await harness.respond(TABS);

  harness.resultButtons()[1].focus();
  const snapshot = harness.controller.captureFocus();
  harness.elements.results.replaceChildren();
  harness.controller.setView(viewFor(TABS), snapshot);
  assert.equal(harness.document.activeElement.dataset.tabId, "tab-21");
});

test("an index that fails keeps usable results and retries on the next input or view", async () => {
  const harness = createSearchHarness();
  harness.controller.configure({ enabled: true, position: "top" });
  harness.controller.setView(viewFor(TABS));
  harness.elements.toggle.click();
  harness.type("report");
  assert.equal(harness.statusText(), "Searching…");
  await harness.fail();
  assert.equal(harness.statusText(), "Tab search is unavailable.");
  assert.equal(harness.loads.length, 0, "a failure does not loop");

  harness.type("repo");
  assert.equal(harness.loads.length, 1);
  await harness.respond(TABS);
  assert.deepEqual(harness.resultTitles(), ["Quarterly report", "Bank statement report"]);

  harness.controller.setView(viewFor(TABS));
  await harness.fail();
  assert.deepEqual(harness.resultTitles(), ["Quarterly report", "Bank statement report"]);
});

test("a stale result keeps search open and refreshes the index", async () => {
  const harness = createSearchHarness({ activate: async () => false });
  await openWithIndex(harness);
  harness.type("recipes");
  harness.resultButtons()[0].click();
  await harness.settle();
  assert.equal(harness.controller.isOpen(), true);
  assert.equal(harness.loads.length, 1);

  const busy = createSearchHarness({ activate: async () => undefined });
  await openWithIndex(busy);
  busy.type("recipes");
  busy.resultButtons()[0].click();
  await busy.settle();
  assert.equal(busy.controller.isOpen(), true);
  assert.equal(busy.loads.length, 0, "a busy sidebar changes nothing");
});

test("bottom placement, disabled search, and uppercase stored colors", async () => {
  const harness = createSearchHarness();
  const { pane, region, footer, toggle, input } = harness.elements;
  harness.controller.configure({ enabled: true, position: "bottom" });
  assert.equal(region.nextElementSibling, footer);
  assert.equal(pane.dataset.tabSearchPosition, "bottom");

  harness.controller.setView(viewFor(TABS));
  toggle.click();
  await harness.respond(TABS);
  harness.type("report");
  assert.deepEqual(harness.resultTitles(), ["Quarterly report", "Bank statement report"]);
  harness.key(input, "ArrowUp");
  assert.equal(harness.document.activeElement.dataset.tabId, "tab-21");

  harness.controller.configure({ enabled: false, position: "bottom" });
  assert.equal(region.hidden, true);
  assert.equal(harness.controller.isOpen(), false);
  assert.equal(input.value, "");
  toggle.click();
  assert.equal(harness.controller.isOpen(), false);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseWorkspaceUnloadOutcome,
  parseWorkspaceView
} from "../../src/contracts/workspace-view.js";
import { createDefaultWorkspaceState } from "../../src/core/workspace-defaults.js";

const WORK_ID = "ws-default-work";
const PERSONAL_ID = "ws-default-personal";
const RESEARCH_ID = "ws-default-research";

function validView() {
  return {
    state: createDefaultWorkspaceState(),
    activeWorkspaceId: WORK_ID,
    workspaceTabs: [
      { workspaceId: WORK_ID, tabCount: 2, discardedTabCount: 0, loadState: "loaded" },
      {
        workspaceId: PERSONAL_ID,
        tabCount: 2,
        discardedTabCount: 1,
        loadState: "partial"
      },
      {
        workspaceId: RESEARCH_ID,
        tabCount: 1,
        discardedTabCount: 1,
        loadState: "unloaded"
      }
    ],
    hiddenTabCount: 3,
    visibleExceptionCount: 0,
    visibleExceptions: { active: 0, pinned: 0, sharing: 0, closing: 0 },
    liveTabIdentities: [],
    activeTabs: [],
    activeGroups: [],
    activeSplitViews: [],
    notice: null
  };
}

test("workspace views validate exact observed tab summaries and return defensive copies", () => {
  const source = validView();
  const parsed = parseWorkspaceView(source);

  assert.deepEqual(parsed, source);
  assert.notStrictEqual(parsed, source);
  assert.notStrictEqual(parsed.state, source.state);
  assert.notStrictEqual(parsed.workspaceTabs[0], source.workspaceTabs[0]);
  parsed.workspaceTabs[0].tabCount = 99;
  assert.equal(source.workspaceTabs[0].tabCount, 2);
});

test("workspace views reject missing summaries, duplicate IDs, and inconsistent load states", () => {
  const missing = validView();
  missing.workspaceTabs.pop();
  assert.throws(() => parseWorkspaceView(missing), /incomplete/);

  const duplicate = validView();
  duplicate.workspaceTabs[1].workspaceId = WORK_ID;
  assert.throws(() => parseWorkspaceView(duplicate), /workspace ID/);

  const inconsistent = validView();
  inconsistent.workspaceTabs[0].loadState = "unloaded";
  assert.throws(() => parseWorkspaceView(inconsistent), /load state/);

  const empty = validView();
  empty.workspaceTabs[0] = {
    workspaceId: WORK_ID,
    tabCount: 0,
    discardedTabCount: 0,
    loadState: "empty"
  };
  assert.equal(parseWorkspaceView(empty).workspaceTabs[0].loadState, "empty");

  const inconsistentExceptions = validView();
  inconsistentExceptions.visibleExceptionCount = 1;
  assert.throws(() => parseWorkspaceView(inconsistentExceptions), /breakdown/);
});

test("workspace views expose unique URL-free live tab identities", () => {
  const source = validView();
  source.liveTabIdentities = [
    { logicalTabId: "tab-one", firefoxTabId: 11 },
    { logicalTabId: "tab-two", firefoxTabId: 12 }
  ];
  assert.deepEqual(parseWorkspaceView(source).liveTabIdentities, source.liveTabIdentities);

  const duplicate = structuredClone(source);
  duplicate.liveTabIdentities[1].firefoxTabId = 11;
  assert.throws(() => parseWorkspaceView(duplicate), /Live tab identity/);

  const unsafe = structuredClone(source);
  unsafe.liveTabIdentities[0].url = "https://example.test/private";
  assert.throws(() => parseWorkspaceView(unsafe), /Live tab identity/);
});

test("workspace unload outcomes require known workspaces and consistent aggregate counts", () => {
  const workspaceIds = [WORK_ID, PERSONAL_ID, RESEARCH_ID];
  const outcome = {
    workspaceId: PERSONAL_ID,
    requestedTabCount: 4,
    unpinnedCount: 1,
    remainingPinnedCount: 0,
    ungroupedCount: 2,
    remainingGroupedCount: 0,
    newlyHiddenCount: 3,
    remainingVisibleCount: 0,
    alreadyDiscardedCount: 1,
    newlyDiscardedCount: 2,
    remainingLoadedCount: 1,
    failedDiscardCount: 1,
    switchedWindowCount: 0,
    pendingWindowCount: 0,
    safetyTabCount: 0
  };

  assert.deepEqual(parseWorkspaceUnloadOutcome(outcome, workspaceIds), outcome);
  assert.throws(
    () => parseWorkspaceUnloadOutcome({ ...outcome, workspaceId: "ws-missing" }, workspaceIds),
    /workspace/
  );
  assert.throws(
    () => parseWorkspaceUnloadOutcome({ ...outcome, remainingLoadedCount: 0 }, workspaceIds),
    /Inconsistent/
  );
});

test("detailed active rows preserve tree and group presentation without accepting unsafe favicons", () => {
  const source = validView();
  source.activeTabs = [
    {
      logicalId: "tab-alpha",
      firefoxId: 11,
      workspaceId: WORK_ID,
      title: "Alpha",
      active: true,
      discarded: false,
      audible: false,
      muted: false,
      pinned: false,
      groupId: null,
      splitViewId: null,
      splitPosition: null,
      parentTabId: null,
      depth: 0,
      collapsed: false,
      hiddenByCollapsedAncestor: false,
      internalPage: null,
      container: { kind: "none" }
    },
    {
      logicalId: "tab-beta",
      firefoxId: 12,
      workspaceId: WORK_ID,
      title: "Beta",
      active: false,
      discarded: false,
      audible: true,
      muted: false,
      pinned: false,
      groupId: "group-one",
      splitViewId: null,
      splitPosition: null,
      parentTabId: null,
      depth: 0,
      collapsed: true,
      hiddenByCollapsedAncestor: false,
      internalPage: null,
      container: { kind: "none" }
    },
    {
      logicalId: "tab-gamma",
      firefoxId: 13,
      workspaceId: WORK_ID,
      title: "Gamma",
      active: false,
      discarded: true,
      audible: false,
      muted: true,
      pinned: false,
      groupId: "group-one",
      splitViewId: null,
      splitPosition: null,
      parentTabId: "tab-beta",
      depth: 1,
      collapsed: false,
      hiddenByCollapsedAncestor: true,
      internalPage: null,
      container: { kind: "none" }
    }
  ];
  source.activeGroups = [{
    id: "group-one",
    title: "Research",
    color: "purple",
    collapsed: false,
    tabIds: ["tab-beta", "tab-gamma"]
  }];
  source.liveTabIdentities = source.activeTabs.map(({ logicalId, firefoxId }) => ({
    logicalTabId: logicalId,
    firefoxTabId: firefoxId
  }));
  const parsed = parseWorkspaceView(source);
  assert.deepEqual(parsed.activeGroups, source.activeGroups);
  assert.notStrictEqual(parsed.activeTabs[0], source.activeTabs[0]);
  const unsafe = structuredClone(source);
  unsafe.activeTabs[0].favIconUrl = "javascript:alert(1)";
  assert.throws(() => parseWorkspaceView(unsafe), /invalid shape/);
  assert.equal(Object.hasOwn(parsed.activeTabs[0], "favIconUrl"), false);
});

test("detailed active rows accept only known internal pages", () => {
  const row = (internalPage) => ({
    logicalId: "tab-left", firefoxId: 11, workspaceId: WORK_ID, title: "Left",
    active: true, discarded: false, audible: false, muted: false,
    pinned: false, groupId: null, splitViewId: null, splitPosition: null,
    parentTabId: null, depth: 0, collapsed: false, hiddenByCollapsedAncestor: false,
    internalPage, container: { kind: "none" }
  });

  const withRow = (internalPage) => {
    const source = validView();
    source.activeTabs = [row(internalPage)];
    source.liveTabIdentities = source.activeTabs.map(({ logicalId, firefoxId }) => ({
      logicalTabId: logicalId,
      firefoxTabId: firefoxId
    }));
    return source;
  };

  assert.equal(parseWorkspaceView(withRow("settings")).activeTabs[0].internalPage, "settings");
  assert.equal(parseWorkspaceView(withRow(null)).activeTabs[0].internalPage, null);

  for (const bad of ["Settings", "sidebar", "", 0, false, {}]) {
    assert.throws(() => parseWorkspaceView(withRow(bad)), /internal page|invalid/i);
  }
});

test("detailed active rows expose one ordered logical split pair", () => {
  const source = validView();
  source.activeTabs = [
    {
      logicalId: "tab-left", firefoxId: 11, workspaceId: WORK_ID, title: "Left",
      active: true, discarded: false, audible: false, muted: false,
      pinned: false, groupId: null, splitViewId: "split-one", splitPosition: "start",
      parentTabId: null, depth: 0, collapsed: false, hiddenByCollapsedAncestor: false,
      internalPage: null, container: { kind: "none" }
    },
    {
      logicalId: "tab-right", firefoxId: 12, workspaceId: WORK_ID, title: "Right",
      active: false, discarded: false, audible: false, muted: false,
      pinned: false, groupId: null, splitViewId: "split-one", splitPosition: "end",
      parentTabId: null, depth: 0, collapsed: false, hiddenByCollapsedAncestor: false,
      internalPage: null, container: { kind: "none" }
    }
  ];
  source.activeSplitViews = [{ id: "split-one", tabIds: ["tab-left", "tab-right"] }];
  source.liveTabIdentities = source.activeTabs.map(({ logicalId, firefoxId }) => ({
    logicalTabId: logicalId,
    firefoxTabId: firefoxId
  }));
  assert.deepEqual(parseWorkspaceView(source).activeSplitViews, source.activeSplitViews);

  const reversed = structuredClone(source);
  reversed.activeSplitViews[0].tabIds.reverse();
  assert.throws(() => parseWorkspaceView(reversed), /invalid member/);
});

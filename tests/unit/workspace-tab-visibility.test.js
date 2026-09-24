import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_TAB_VISIBILITIES,
  WORKSPACE_TAB_VISIBILITY_REASONS,
  deriveWorkspaceTabVisibility,
  workspaceTabVisibilityIsSettled
} from "../../src/core/workspace-tab-visibility.js";

const ENABLED_SETTINGS = {
  sidebar: { hideUnloadedTabsFromFirefox: true }
};
const DISABLED_SETTINGS = {
  sidebar: { hideUnloadedTabsFromFirefox: false }
};

function tab(overrides = {}) {
  return {
    id: 11,
    logicalId: "tab-11",
    active: false,
    highlighted: false,
    hidden: false,
    pinned: false,
    discarded: true,
    splitViewId: -1,
    ...overrides
  };
}

function classify(overrides = {}) {
  return deriveWorkspaceTabVisibility({
    settings: ENABLED_SETTINGS,
    tab: tab(),
    isActiveWorkspace: true,
    ...overrides
  });
}

test("inactive-workspace visibility stays independent of the unloaded-tab preference", () => {
  for (const settings of [ENABLED_SETTINGS, DISABLED_SETTINGS]) {
    assert.deepEqual(
      deriveWorkspaceTabVisibility({
        settings,
        tab: tab({ discarded: false, active: true, pinned: true }),
        isActiveWorkspace: false,
        isLogicalPinned: true,
        isSelected: true
      }),
      {
        desiredVisibility: WORKSPACE_TAB_VISIBILITIES.HIDDEN,
        reason: WORKSPACE_TAB_VISIBILITY_REASONS.INACTIVE_WORKSPACE,
        protected: false,
        uncertain: false
      }
    );
  }
});

test("active-workspace tabs hide only when the preference is on and Firefox reports discarded", () => {
  assert.equal(
    deriveWorkspaceTabVisibility({
      settings: DISABLED_SETTINGS,
      tab: tab(),
      isActiveWorkspace: true
    }).reason,
    WORKSPACE_TAB_VISIBILITY_REASONS.PREFERENCE_DISABLED
  );
  assert.equal(
    classify({ tab: tab({ discarded: false }) }).reason,
    WORKSPACE_TAB_VISIBILITY_REASONS.LOADED
  );
  assert.deepEqual(classify(), {
    desiredVisibility: WORKSPACE_TAB_VISIBILITIES.HIDDEN,
    reason: WORKSPACE_TAB_VISIBILITY_REASONS.DISCARDED,
    protected: false,
    uncertain: false
  });
});

test("selected, active, logical/native pinned, sharing, split, and closing tabs stay visible", () => {
  const cases = [
    [{ tab: tab({ active: true }) }, WORKSPACE_TAB_VISIBILITY_REASONS.ACTIVE, false],
    [{ isSelected: true }, WORKSPACE_TAB_VISIBILITY_REASONS.SELECTED, false],
    [{ tab: tab({ highlighted: true }) }, WORKSPACE_TAB_VISIBILITY_REASONS.SELECTED, false],
    [{ isLogicalPinned: true }, WORKSPACE_TAB_VISIBILITY_REASONS.LOGICAL_PIN, false],
    [{ tab: tab({ pinned: true }) }, WORKSPACE_TAB_VISIBILITY_REASONS.NATIVE_PIN, false],
    [
      { tab: tab({ sharingState: { screen: true } }) },
      WORKSPACE_TAB_VISIBILITY_REASONS.SHARING,
      false
    ],
    [{ isLogicalSplitViewMember: true }, WORKSPACE_TAB_VISIBILITY_REASONS.SPLIT_VIEW, false],
    [{ tab: tab({ splitViewId: 42 }) }, WORKSPACE_TAB_VISIBILITY_REASONS.SPLIT_VIEW, false],
    [{ tab: tab({ closing: true }) }, WORKSPACE_TAB_VISIBILITY_REASONS.CLOSING, true]
  ];

  for (const [inputs, reason, uncertain] of cases) {
    assert.deepEqual(classify(inputs), {
      desiredVisibility: WORKSPACE_TAB_VISIBILITIES.VISIBLE,
      reason,
      protected: true,
      uncertain
    });
  }
});

test("final inventory tolerates only an explicit active discarded-tab refusal", () => {
  const discarded = classify();
  assert.equal(workspaceTabVisibilityIsSettled({
    classification: discarded,
    observedHidden: false
  }), false);
  assert.equal(workspaceTabVisibilityIsSettled({
    classification: discarded,
    observedHidden: false,
    hideRefused: true
  }), true);
  assert.equal(workspaceTabVisibilityIsSettled({
    classification: discarded,
    observedHidden: true
  }), true);

  const inactive = deriveWorkspaceTabVisibility({
    settings: ENABLED_SETTINGS,
    tab: tab(),
    isActiveWorkspace: false
  });
  assert.equal(workspaceTabVisibilityIsSettled({
    classification: inactive,
    observedHidden: false,
    hideRefused: true
  }), false);

  const protectedTab = classify({ isSelected: true });
  assert.equal(workspaceTabVisibilityIsSettled({
    classification: protectedTab,
    observedHidden: true,
    hideRefused: true
  }), false);
});

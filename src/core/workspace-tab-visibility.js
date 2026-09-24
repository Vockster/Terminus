export const WORKSPACE_TAB_VISIBILITIES = Object.freeze({
  HIDDEN: "hidden",
  VISIBLE: "visible"
});

export const WORKSPACE_TAB_VISIBILITY_REASONS = Object.freeze({
  ACTIVE: "active",
  CLOSING: "closing",
  DISCARDED: "discarded",
  INACTIVE_WORKSPACE: "inactive-workspace",
  LOADED: "loaded",
  LOGICAL_PIN: "logical-pin",
  NATIVE_PIN: "native-pin",
  PREFERENCE_DISABLED: "preference-disabled",
  SELECTED: "selected",
  SHARING: "sharing",
  SPLIT_VIEW: "split-view"
});

const FIREFOX_SPLIT_VIEW_ID_NONE = -1;

function visible(reason, { protectedTab = false, uncertain = false } = {}) {
  return {
    desiredVisibility: WORKSPACE_TAB_VISIBILITIES.VISIBLE,
    reason,
    protected: protectedTab,
    uncertain
  };
}

function hidden(reason) {
  return {
    desiredVisibility: WORKSPACE_TAB_VISIBILITIES.HIDDEN,
    reason,
    protected: false,
    uncertain: false
  };
}

function tabIsSharing(tab) {
  const sharing = tab?.sharingState;
  return Boolean(sharing && (sharing.camera || sharing.microphone || sharing.screen));
}

function tabIsInNativeSplitView(tab) {
  return Number.isInteger(tab?.splitViewId) &&
    tab.splitViewId !== FIREFOX_SPLIT_VIEW_ID_NONE;
}

// This owner derives intent only. It never calls Firefox or reads storage.
// `settings` is the one parsed snapshot retained by the enclosing reconcile.
export function deriveWorkspaceTabVisibility({
  settings,
  tab,
  isActiveWorkspace,
  isLogicalPinned = false,
  isLogicalSplitViewMember = false,
  isSelected = false
}) {
  if (!isActiveWorkspace) {
    return hidden(WORKSPACE_TAB_VISIBILITY_REASONS.INACTIVE_WORKSPACE);
  }
  if (settings?.sidebar?.hideUnloadedTabsFromFirefox !== true) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.PREFERENCE_DISABLED);
  }
  if (tab?.discarded !== true) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.LOADED);
  }
  if (tab.active === true) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.ACTIVE, { protectedTab: true });
  }
  if (isSelected || tab.highlighted === true) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.SELECTED, { protectedTab: true });
  }
  if (isLogicalPinned) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.LOGICAL_PIN, { protectedTab: true });
  }
  if (tab.pinned === true) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.NATIVE_PIN, { protectedTab: true });
  }
  if (tabIsSharing(tab)) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.SHARING, { protectedTab: true });
  }
  if (isLogicalSplitViewMember || tabIsInNativeSplitView(tab)) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.SPLIT_VIEW, { protectedTab: true });
  }
  if (tab.closing === true) {
    return visible(WORKSPACE_TAB_VISIBILITY_REASONS.CLOSING, {
      protectedTab: true,
      uncertain: true
    });
  }
  return hidden(WORKSPACE_TAB_VISIBILITY_REASONS.DISCARDED);
}

// Final inventory is authoritative. An eligible active-workspace tab that is
// still visible after this exact pass tried to hide it is a Firefox refusal,
// not a reason to retain a permanent pending operation. A future event starts
// a new pass and reevaluates it from fresh inventory.
export function workspaceTabVisibilityIsSettled({
  classification,
  observedHidden,
  hideRefused = false
}) {
  if (classification.desiredVisibility === WORKSPACE_TAB_VISIBILITIES.VISIBLE) {
    return observedHidden !== true;
  }
  if (observedHidden === true) {
    return true;
  }
  return classification.reason === WORKSPACE_TAB_VISIBILITY_REASONS.DISCARDED &&
    hideRefused;
}

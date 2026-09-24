import { SIDEBAR_UNDO_REASON_CODES } from "../contracts/sidebar-undo.js";
import { restorableUrl } from "./restorable-url.js";

function appendReason(reasons, reason, count = 1) {
  const existing = reasons.find((entry) => entry.reason === reason);
  if (existing) existing.count += count;
  else reasons.push({ reason, count });
}

export async function recoverClosedSidebarTabs({
  entry,
  currentSnapshot,
  browserAdapter,
  containerService = null
}) {
  const currentByLogicalId = new Map(
    currentSnapshot.browserTabs.map((tab) => [tab.logicalTabId, tab])
  );
  const affectedTabIds = new Set(
    entry.affectedKeys
      .filter((key) => key.startsWith("tab:"))
      .map((key) => key.slice("tab:".length))
  );
  const missing = entry.before.browserTabs.filter((tab) =>
    affectedTabIds.has(tab.logicalTabId) && !currentByLogicalId.has(tab.logicalTabId)
  );
  const retainedSafetyCount = currentSnapshot.browserTabs.filter((tab) =>
    affectedTabIds.has(tab.logicalTabId) &&
    !entry.before.browserTabs.some((beforeTab) => beforeTab.logicalTabId === tab.logicalTabId)
  ).length;
  const liveWindowIds = new Set(await browserAdapter.listNormalWindowIds());
  const usedLogicalIds = new Set(currentSnapshot.workspaceRuntime.tabs.map(({ id }) => id));
  const restored = [];
  const skipped = [];
  const failed = [];
  const reasons = [];
  let approximatedCount = 0;

  for (const descriptor of missing.sort(
    (left, right) => left.windowId - right.windowId || left.index - right.index
  )) {
    if (!liveWindowIds.has(descriptor.windowId)) {
      skipped.push(descriptor.logicalTabId);
      appendReason(reasons, SIDEBAR_UNDO_REASON_CODES.MISSING_TAB);
      continue;
    }
    let cookieStoreId = null;
    if (descriptor.containerRef !== null) {
      try {
        if (!containerService) throw new Error("Container service unavailable.");
        cookieStoreId = await containerService.resolve(descriptor.containerRef);
      } catch {
        skipped.push(descriptor.logicalTabId);
        appendReason(reasons, SIDEBAR_UNDO_REASON_CODES.CONTAINER_UNAVAILABLE);
        continue;
      }
    }
    const targetUrl = restorableUrl(descriptor.url);
    let created = null;
    try {
      created = await browserAdapter.createTab(descriptor.windowId, {
        active: false,
        index: descriptor.index,
        url: targetUrl.url,
        cookieStoreId
      });
      let logicalTabId = descriptor.logicalTabId;
      if (usedLogicalIds.has(logicalTabId)) {
        logicalTabId = await browserAdapter.getOrCreateTabIdentity(created.id);
        approximatedCount += 1;
        appendReason(reasons, SIDEBAR_UNDO_REASON_CODES.IDENTITY_CONFLICT);
      } else {
        await browserAdapter.setTabIdentity(created.id, logicalTabId);
      }
      usedLogicalIds.add(logicalTabId);
      if (!targetUrl.supported) {
        approximatedCount += 1;
        appendReason(reasons, SIDEBAR_UNDO_REASON_CODES.PROTECTED_URL);
      }
      restored.push({ descriptor, firefoxTabId: created.id, logicalTabId });
    } catch {
      if (Number.isInteger(created?.id) && typeof browserAdapter.removeTabs === "function") {
        await browserAdapter.removeTabs([created.id]).catch(() => undefined);
      }
      failed.push(descriptor.logicalTabId);
      appendReason(reasons, SIDEBAR_UNDO_REASON_CODES.BROWSER_FAILURE);
    }
  }

  if (retainedSafetyCount > 0) {
    appendReason(reasons, SIDEBAR_UNDO_REASON_CODES.SAFETY_RETAINED, retainedSafetyCount);
  }
  return {
    requestedCount: missing.length,
    restored,
    skipped,
    failed,
    approximatedCount,
    retainedSafetyCount,
    reasons
  };
}

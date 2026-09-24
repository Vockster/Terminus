// Middle Mouse over a tab row, group header, or workspace button unloads it.
// The unload runs on pointerup; auxclick is only a fallback for a release
// Firefox did not report, and never unloads twice.

const MIDDLE_BUTTON = 1;
const PRESS_TIMEOUT_MILLISECONDS = 1_000;
const TARGET_SELECTOR = "[data-unload-target]";
const IGNORED_ORIGIN_SELECTOR = [
  "input",
  "select",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  ".tab-disclosure",
  ".tab-menu-button",
  ".group-menu-button",
  ".workspace-menu-button",
  ".new-tab-button",
  ".rail-action",
  ".command-menu",
  "dialog"
].join(", ");

function eventElement(event) {
  for (const candidate of event.composedPath?.() ?? []) {
    if (candidate && typeof candidate.closest === "function") return candidate;
  }
  return event.target && typeof event.target.closest === "function" ? event.target : null;
}

function isPlainMiddlePress(event) {
  return event.button === MIDDLE_BUTTON &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey;
}

function isUsableTarget(target) {
  return target !== null &&
    target !== undefined &&
    typeof target.matches === "function" &&
    target.isConnected &&
    !target.hidden &&
    !target.matches(":disabled, [aria-disabled='true']") &&
    target.closest("[hidden], [aria-hidden='true']") === null;
}

export function resolveUnloadTarget(event) {
  const origin = eventElement(event);
  if (!origin || origin.closest(IGNORED_ORIGIN_SELECTOR) !== null) return null;
  const target = origin.closest(TARGET_SELECTOR);
  return isUsableTarget(target) ? target : null;
}

function pressMarker(event, target) {
  const { unloadTarget, tabId, groupId, workspaceId } = target.dataset;
  return `${event.button}:${unloadTarget}:${tabId ?? groupId ?? workspaceId ?? ""}`;
}

function stopInput(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

// Maps a resolved target to its existing unload owner. Each owner returns its
// mutation promise so the controller stays locked until the unload settles.
export function createUnloadTargetRouter({ unloadTab, unloadGroup, unloadWorkspace, hasWorkspace }) {
  return function routeUnloadTarget({ kind, target }) {
    if (kind === "tab") return unloadTab(target);
    if (kind === "group") return unloadGroup(target);
    if (kind === "workspace") {
      const workspaceId = target?.dataset?.workspaceId;
      if (typeof workspaceId !== "string" || !hasWorkspace(workspaceId)) return false;
      return unloadWorkspace(workspaceId);
    }
    return false;
  };
}

export function createMiddleClickUnloadController({
  onUnloadTarget,
  isBlocked = () => false,
  documentElement = document,
  now = () => Date.now()
}) {
  if (typeof onUnloadTarget !== "function") {
    throw new TypeError("An unload handler is required.");
  }

  let disposed = false;
  let pendingPress = null;
  let completedRelease = null;
  let unloadInFlight = false;

  function invoke(target, event) {
    stopInput(event);
    unloadInFlight = true;
    void Promise.resolve()
      .then(() => onUnloadTarget({ kind: target.dataset.unloadTarget, target, event }))
      // Unload owners report their own failures in the sidebar status.
      .catch(() => undefined)
      .finally(() => {
        unloadInFlight = false;
      });
  }

  function handlePointer(event) {
    if (disposed) return;
    const timestamp = now();
    if (completedRelease && completedRelease.expiresAt < timestamp) completedRelease = null;
    if (event.type === "auxclick" && completedRelease && event.button === MIDDLE_BUTTON) {
      completedRelease = null;
      stopInput(event);
      return;
    }
    if (unloadInFlight || isBlocked()) return;
    if (event.type === "pointerdown") {
      if (!isPlainMiddlePress(event)) return;
      const target = resolveUnloadTarget(event);
      if (!target) return;
      stopInput(event);
      completedRelease = null;
      pendingPress = {
        marker: pressMarker(event, target),
        expiresAt: timestamp + PRESS_TIMEOUT_MILLISECONDS
      };
      return;
    }
    if (!pendingPress || pendingPress.expiresAt < timestamp) {
      pendingPress = null;
      return;
    }
    const target = resolveUnloadTarget(event);
    if (!target || pendingPress.marker !== pressMarker(event, target)) return;
    pendingPress = null;
    if (event.type === "pointerup") {
      completedRelease = { expiresAt: timestamp + PRESS_TIMEOUT_MILLISECONDS };
    }
    invoke(target, event);
  }

  documentElement.addEventListener("pointerdown", handlePointer, true);
  documentElement.addEventListener("pointerup", handlePointer, true);
  documentElement.addEventListener("auxclick", handlePointer, true);

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      documentElement.removeEventListener("pointerdown", handlePointer, true);
      documentElement.removeEventListener("pointerup", handlePointer, true);
      documentElement.removeEventListener("auxclick", handlePointer, true);
    }
  });
}

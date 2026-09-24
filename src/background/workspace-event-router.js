// Tab updates that only change what a row shows. A reconcile for them can
// wait briefly: pages such as video sites and live tickers change titles many
// times a second, and reconciling back-to-back for each one saturated the
// background and piled up events and memory once sessions reached thousands
// of tabs. Structural events still reconcile at once.
const PRESENTATION_UPDATE_KEYS = new Set(["title", "audible", "mutedInfo", "status"]);
export const PRESENTATION_UPDATE_DELAY_MS = 250;
export const VISIBILITY_CONTENTION_RESET_MS = 2000;

export function isPresentationWorkspaceEvent(event) {
  return (
    event?.kind === "tab-updated" &&
    Array.isArray(event.changed) &&
    event.changed.length > 0 &&
    event.changed.every((key) => PRESENTATION_UPDATE_KEYS.has(key))
  );
}

function isVisibilityOnlyUpdate(event) {
  return event?.kind === "tab-updated" &&
    Number.isInteger(event.tabId) &&
    Array.isArray(event.changed) &&
    event.changed.length === 1 &&
    event.changed[0] === "hidden";
}

function isSnapshotOnlyUpdate(event) {
  return event?.kind === "tab-updated" &&
    Array.isArray(event.changed) &&
    event.changed.length > 0 &&
    event.changed.every((key) => key === "url");
}

export function createWorkspaceEventRouter({
  browserAdapter,
  controller,
  onReconciled,
  onTabRemoved,
  onStructuralActivity,
  presentationDelayMs = PRESENTATION_UPDATE_DELAY_MS,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  now = () => Date.now()
}) {
  const states = new Map();
  // Outlives a window's idle state so spacing still applies to the next burst.
  const lastStartedAtByWindow = new Map();
  const idleWaiters = new Set();
  const visibilityContention = new Map();
  let unsubscribe = null;

  function settleIdleWaiters() {
    if ([...states.values()].some((state) => state.scheduled || state.running)) {
      return;
    }
    for (const resolve of idleWaiters) {
      resolve();
    }
    idleWaiters.clear();
  }

  // Presentation-only work waits until presentationDelayMs after the previous
  // pass started; anything else runs on the next microtask.
  function schedule(windowId, state) {
    state.scheduled = true;
    const token = ++state.scheduleToken;
    const wait = state.urgent
      ? 0
      : Math.max(0, state.lastStartedAt + presentationDelayMs - now());
    state.delayed = wait > 0;
    if (wait === 0) {
      Promise.resolve().then(() => run(windowId, state, token));
    } else {
      setTimer(() => run(windowId, state, token), wait);
    }
  }

  async function run(windowId, state, token) {
    // A later schedule (an urgent event cutting a delay short) supersedes this one.
    if (token !== state.scheduleToken || state.running) return;
    state.scheduled = false;
    state.delayed = false;
    state.running = true;
    try {
      do {
        state.dirty = false;
        if (!state.urgent && state.lastStartedAt + presentationDelayMs > now()) {
          // Only presentation updates arrived during the last pass; space the
          // next one out instead of reconciling back-to-back.
          state.running = false;
          schedule(windowId, state);
          return;
        }
        state.urgent = false;
        state.lastStartedAt = now();
        lastStartedAtByWindow.set(windowId, state.lastStartedAt);
        let reconciled = false;
        let reconciledView = null;
        try {
          const events = state.events.splice(0);
          reconciledView = await controller.reconcileWindow(windowId, {
            events,
            refreshContainers: false
          }) ?? null;
          state.retryCount = 0;
          reconciled = true;
        } catch {
          if (state.retryCount < 1) {
            state.retryCount += 1;
            state.dirty = true;
            state.urgent = true;
          }
          // The controller owns user-visible operation notices after the bounded retry.
        }
        // Open sidebars refresh only from this notification, so it follows a
        // final failure too; their next view request reports the notice. The
        // reconciled view lets the listener skip notifying when nothing a
        // sidebar renders has changed; a failed pass carries no view and
        // notifies unconditionally.
        if (reconciled || !state.dirty) {
          try {
            await onReconciled?.(windowId, reconciledView);
          } catch {
            // A missing listener must not turn a settled pass into a retry.
          }
        }
      } while (state.dirty);
    } finally {
      if (state.running) {
        state.running = false;
        if (!state.scheduled && !state.dirty) {
          states.delete(windowId);
          for (const [id, startedAt] of lastStartedAtByWindow) {
            if (!states.has(id) && startedAt + presentationDelayMs <= now()) {
              lastStartedAtByWindow.delete(id);
            }
          }
        }
      }
      settleIdleWaiters();
    }
  }

  function enqueue(windowId, event = null) {
    if (!Number.isInteger(windowId) || windowId < 0) {
      return;
    }
    const visibilityPrefix = `${windowId}\u0000`;
    const resetVisibilityContention = () => {
      for (const key of visibilityContention.keys()) {
        if (key.startsWith(visibilityPrefix)) visibilityContention.delete(key);
      }
    };
    if (event === null) {
      resetVisibilityContention();
    } else if (isVisibilityOnlyUpdate(event)) {
      const key = `${visibilityPrefix}${event.tabId}`;
      const previous = visibilityContention.get(key);
      const count = !previous || now() - previous.lastAt >= VISIBILITY_CONTENTION_RESET_MS
        ? 0
        : previous.count;
      visibilityContention.set(key, { count: count + 1, lastAt: now() });
      if (count >= 2) return;
    } else if (!isPresentationWorkspaceEvent(event)) {
      resetVisibilityContention();
    }
    let state = states.get(windowId);
    if (!state) {
      state = {
        scheduled: false,
        running: false,
        dirty: false,
        urgent: false,
        delayed: false,
        scheduleToken: 0,
        retryCount: 0,
        lastStartedAt: lastStartedAtByWindow.get(windowId) ?? Number.NEGATIVE_INFINITY,
        events: []
      };
      states.set(windowId, state);
    }
    if (event) {
      state.events.push(event);
    }
    if (!isPresentationWorkspaceEvent(event)) {
      state.urgent = true;
    }
    if (state.running) {
      state.dirty = true;
      return;
    }
    if (state.scheduled && !(state.delayed && state.urgent)) {
      return;
    }
    schedule(windowId, state);
  }

  async function enqueueAll() {
    let windowIds;
    try {
      windowIds = await browserAdapter.listNormalWindowIds();
    } catch {
      return;
    }
    for (const windowId of windowIds) {
      enqueue(windowId);
    }
  }

  function start() {
    if (unsubscribe) {
      return;
    }
    unsubscribe = browserAdapter.subscribeWorkspaceEvents((event) => {
      if (!isPresentationWorkspaceEvent(event)) {
        onStructuralActivity?.(event);
      }
      if (isSnapshotOnlyUpdate(event)) {
        return;
      }
      if (event.kind === "tab-removed" && event.isWindowClosing) {
        return;
      }
      if (event.kind === "tab-removed" && Number.isInteger(event.tabId)) {
        for (const windowId of event.windowIds) {
          void onTabRemoved?.(windowId, event.tabId);
        }
      }
      if (event.kind === "window-removed" || event.windowIds.length === 0) {
        void enqueueAll();
        return;
      }
      for (const windowId of event.windowIds) {
        enqueue(windowId, event);
      }
    });
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
  }

  function whenIdle() {
    if (![...states.values()].some((state) => state.scheduled || state.running)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  return Object.freeze({ enqueue, enqueueAll, start, stop, whenIdle });
}

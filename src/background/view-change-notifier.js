// Owns the VIEW_CHANGED fan-out policy: every open sidebar answers a
// notification with a full serialized view request, so an event pass whose
// rebuilt view is identical to the last notified one for that window is
// suppressed. A notification without a view (imports, icon changes, failed
// reconcile passes) always sends and resets the comparison, because it signals
// content the serialized view does not carry.
export function createViewChangeNotifier(send) {
  const lastNotifiedViewJson = new Map();

  return {
    async notify(windowId, view = null) {
      if (view !== null) {
        const viewJson = JSON.stringify(view);
        if (lastNotifiedViewJson.get(windowId) === viewJson) {
          return false;
        }
        lastNotifiedViewJson.set(windowId, viewJson);
      } else {
        lastNotifiedViewJson.delete(windowId);
      }
      await send(windowId);
      return true;
    },
    forget(windowId) {
      lastNotifiedViewJson.delete(windowId);
    }
  };
}

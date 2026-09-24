export function createFirefoxThemeSource(browserApi, windowId) {
  return Object.freeze({
    async getCurrent() {
      return browserApi.theme.getCurrent(windowId);
    },

    subscribe(listener) {
      const handleUpdate = ({ theme, windowId: updatedWindowId }) => {
        if (updatedWindowId === undefined || updatedWindowId === windowId) {
          listener(theme);
        }
      };
      browserApi.theme.onUpdated.addListener(handleUpdate);
      return () => browserApi.theme.onUpdated.removeListener(handleUpdate);
    }
  });
}

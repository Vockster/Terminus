export function createTabRenderCoordinator({
  tabPane,
  searchRoot,
  faviconPresenter,
  getWindowId
}) {
  function synchronize(liveTabIdentities) {
    faviconPresenter.synchronizeLiveTabs(liveTabIdentities ?? []);
  }

  function present(renderedTabs) {
    faviconPresenter.present(
      { activeTabs: renderedTabs ?? [] },
      getWindowId()
    );
  }

  return Object.freeze({
    renderTree(view) {
      tabPane.render(view);
      searchRoot.replaceChildren();
      synchronize(view.liveTabIdentities);
      present(view.activeTabs);
    },

    showTree(view) {
      searchRoot.replaceChildren();
      if (!view) return;
      synchronize(view.liveTabIdentities);
      present(view.activeTabs);
    },

    renderSearch({ content, renderedTabs, liveTabIdentities }) {
      searchRoot.replaceChildren(content);
      synchronize(liveTabIdentities);
      present(renderedTabs);
    }
  });
}

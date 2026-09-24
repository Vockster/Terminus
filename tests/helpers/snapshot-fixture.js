import { WORKSPACE_STATE_SCHEMA_VERSION } from "../../src/contracts/workspace-state.js";

export function createSnapshotPayloadFixture({ containerAware = true } = {}) {
  const payload = {
    workspaceState: {
      schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaces: [
        {
          id: "ws-source",
          name: "Source",
          icon: "briefcase",
          color: "#336699",
          defaultContainerRef: null
        }
      ],
      rail: [{ kind: "workspace", workspaceId: "ws-source" }]
    },
    windows: [
      {
        id: "window-source",
        geometry: { left: 20, top: 30, width: 1200, height: 800, state: "normal" },
        activeWorkspaceId: "ws-source",
        selectedTabs: [{ workspaceId: "ws-source", tabId: "tab-one" }],
        workspaceLayouts: [
          {
            workspaceId: "ws-source",
            tabs: [
              {
                id: "tab-one",
                url: "https://one.invalid/",
                title: "One",
                active: true,
                highlighted: true,
                discarded: false,
                container: { kind: "none" }
              },
              {
                id: "tab-two",
                url: "https://two.invalid/",
                title: "Two",
                active: false,
                highlighted: false,
                discarded: false,
                container: { kind: "none" }
              },
              {
                id: "tab-three",
                url: "https://three.invalid/",
                title: "Three",
                active: false,
                highlighted: false,
                discarded: true,
                container: { kind: "none" }
              }
            ],
            pinnedTabIds: ["tab-one"],
            groups: [
              {
                id: "group-source",
                title: "Grouped",
                color: "blue",
                collapsed: true,
                tabIds: ["tab-two", "tab-three"]
              }
            ],
            tree: [
              { tabId: "tab-one", parentTabId: null, collapsed: false },
              { tabId: "tab-two", parentTabId: null, collapsed: true },
              { tabId: "tab-three", parentTabId: "tab-two", collapsed: false }
            ],
            splitViews: [{ id: "split-source", tabIds: ["tab-two", "tab-three"] }]
          }
        ]
      }
    ],
    containerCatalog: []
  };
  if (containerAware) return payload;
  return {
    workspaceState: {
      ...payload.workspaceState,
      workspaces: payload.workspaceState.workspaces.map((workspace) => ({
        ...workspace,
        defaultContainerRef: null
      }))
    },
    windows: payload.windows.map((window) => ({
      ...window,
      workspaceLayouts: window.workspaceLayouts.map((layout) => ({
        ...layout,
        tabs: layout.tabs.map(({ container: _container, ...tab }) => tab)
      }))
    }))
  };
}

import {
  WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceState
} from "../contracts/workspace-state.js";

export const DEFAULT_WORKSPACES = Object.freeze([
  Object.freeze({
    id: "ws-default-work",
    name: "Work",
    icon: "house",
    color: "#FFFFFF"
  }),
  Object.freeze({
    id: "ws-default-personal",
    name: "Personal",
    icon: "user",
    color: "#FFFFFF"
  }),
  Object.freeze({
    id: "ws-default-research",
    name: "Research",
    icon: "notebook-pen",
    color: "#FFFFFF"
  })
]);

// A workspace added from Settings or the rail + starts with these fields.
export const NEW_WORKSPACE_FIELDS = Object.freeze({
  name: "New workspace",
  icon: "briefcase-business",
  color: "#2563eb"
});

export const DEFAULT_RAIL = Object.freeze(
  DEFAULT_WORKSPACES.map((workspace) =>
    Object.freeze({
      kind: "workspace",
      workspaceId: workspace.id
    })
  )
);

export function createDefaultWorkspaceState() {
  return parseWorkspaceState({
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspaces: DEFAULT_WORKSPACES.map((workspace) => ({
      ...workspace,
      defaultContainerRef: null
    })),
    rail: DEFAULT_RAIL
  });
}

export function createResetWorkspaceState(currentState) {
  const current = parseWorkspaceState(currentState);
  const defaults = createDefaultWorkspaceState();
  const currentById = new Map(current.workspaces.map((workspace) => [workspace.id, workspace]));
  return parseWorkspaceState({
    ...defaults,
    workspaces: defaults.workspaces.map((workspace) => ({
      ...workspace,
      defaultContainerRef:
        currentById.get(workspace.id)?.defaultContainerRef ?? workspace.defaultContainerRef
    }))
  });
}

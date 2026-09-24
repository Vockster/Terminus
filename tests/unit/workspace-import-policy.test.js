import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_IMPORT_BEHAVIORS,
  WORKSPACE_IMPORT_ERROR_CODES,
  WorkspaceImportError,
  normalizeImportedWorkspaces,
  validateWorkspaceAssociationMap
} from "../../src/core/workspace-import-policy.js";

const current = {
  id: "ws-current",
  name: "Current",
  icon: "custom-00000000000000000000000000000001",
  color: "#112233",
  defaultContainerRef: null
};

function normalize(source, behavior, resolveIcon = (iconId) => iconId) {
  return normalizeImportedWorkspaces({
    sourceWorkspaces: [source],
    currentWorkspaces: [current],
    workspaceIdMap: new Map([[source.id, current.id]]),
    behavior,
    resolveIcon
  })[0];
}

test("missing icon data differs from an explicit House reset", () => {
  const withoutIcon = { id: "ws-source", name: "Imported", color: "#445566" };
  assert.equal(normalize(withoutIcon, WORKSPACE_IMPORT_BEHAVIORS.MERGE).icon, current.icon);
  assert.equal(normalize(withoutIcon, WORKSPACE_IMPORT_BEHAVIORS.REPLACE).icon, "house");

  const explicitReset = { ...withoutIcon, icon: "house" };
  assert.equal(normalize(explicitReset, WORKSPACE_IMPORT_BEHAVIORS.MERGE).icon, "house");
});

test("an unresolved custom icon is preserved only for an existing merge destination", () => {
  const source = {
    id: "ws-source",
    name: "Imported",
    icon: "custom-00000000000000000000000000000002",
    color: "#445566"
  };
  const missing = () => null;
  assert.equal(normalize(source, WORKSPACE_IMPORT_BEHAVIORS.MERGE, missing).icon, current.icon);
  assert.equal(normalize(source, WORKSPACE_IMPORT_BEHAVIORS.REPLACE, missing).icon, "house");

  const [created] = normalizeImportedWorkspaces({
    sourceWorkspaces: [source],
    currentWorkspaces: [current],
    workspaceIdMap: new Map([[source.id, "ws-new"]]),
    behavior: WORKSPACE_IMPORT_BEHAVIORS.MERGE,
    resolveIcon: missing
  });
  assert.equal(created.icon, "house");
});

test("temporary presentation URLs can never become stored icon references", () => {
  const source = {
    id: "ws-source",
    name: "Imported",
    icon: "blob:temporary-preview",
    color: "#445566"
  };
  assert.equal(normalize(source, WORKSPACE_IMPORT_BEHAVIORS.REPLACE).icon, "house");
});

test("workspace mappings must be complete and one-to-one", () => {
  const resolved = validateWorkspaceAssociationMap({
    sourceWorkspaceIds: ["ws-a", "ws-b"],
    targetWorkspaceIds: ["ws-new-a", "ws-new-b"],
    workspaceIdMap: new Map([["ws-a", "ws-new-a"], ["ws-b", "ws-new-b"]])
  });
  assert.deepEqual([...resolved], [["ws-a", "ws-new-a"], ["ws-b", "ws-new-b"]]);

  assert.throws(
    () => validateWorkspaceAssociationMap({
      sourceWorkspaceIds: ["ws-a", "ws-b"],
      targetWorkspaceIds: ["ws-new-a"],
      workspaceIdMap: new Map([["ws-a", "ws-new-a"], ["ws-b", "ws-new-a"]])
    }),
    (error) => error instanceof WorkspaceImportError &&
      error.code === WORKSPACE_IMPORT_ERROR_CODES.UNRESOLVED_ASSOCIATION &&
      error.workspaceIds.includes("ws-b")
  );

  assert.throws(
    () => validateWorkspaceAssociationMap({
      sourceWorkspaceIds: ["ws-a"],
      targetWorkspaceIds: ["ws-new-a", "ws-new-a"],
      workspaceIdMap: new Map([["ws-a", "ws-new-a"]])
    }),
    (error) => error instanceof WorkspaceImportError &&
      error.code === WORKSPACE_IMPORT_ERROR_CODES.INVALID_MAPPING
  );
});

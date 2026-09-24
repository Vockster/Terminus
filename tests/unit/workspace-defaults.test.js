import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RAIL,
  DEFAULT_WORKSPACES,
  NEW_WORKSPACE_FIELDS,
  createDefaultWorkspaceState,
  createResetWorkspaceState
} from "../../src/core/workspace-defaults.js";
import { WORKSPACE_ICON_CATALOG } from "../../src/contracts/workspace-icons.js";

test("a workspace added from Settings or the rail + starts from one shared definition", async () => {
  assert.deepEqual(NEW_WORKSPACE_FIELDS, {
    name: "New workspace",
    icon: "briefcase-business",
    color: "#2563eb"
  });
  assert.equal(Object.isFrozen(NEW_WORKSPACE_FIELDS), true);
  assert.ok(WORKSPACE_ICON_CATALOG.some(({ id }) => id === NEW_WORKSPACE_FIELDS.icon));
  const { readFile } = await import("node:fs/promises");
  const panel = await readFile(new URL("../../src/settings/workspaces-panel.js", import.meta.url), "utf8");
  assert.match(panel, /client\.create\(\{ \.\.\.NEW_WORKSPACE_FIELDS \}\)/);
  assert.doesNotMatch(panel, /name: "New workspace"/);
});

test("default workspace definitions and rail are deterministic", () => {
  assert.deepEqual(DEFAULT_WORKSPACES, [
    {
      id: "ws-default-work",
      name: "Work",
      icon: "house",
      color: "#FFFFFF"
    },
    {
      id: "ws-default-personal",
      name: "Personal",
      icon: "user",
      color: "#FFFFFF"
    },
    {
      id: "ws-default-research",
      name: "Research",
      icon: "notebook-pen",
      color: "#FFFFFF"
    }
  ]);
  assert.deepEqual(DEFAULT_RAIL, [
    { kind: "workspace", workspaceId: "ws-default-work" },
    { kind: "workspace", workspaceId: "ws-default-personal" },
    { kind: "workspace", workspaceId: "ws-default-research" }
  ]);
});

test("reset defaults preserve container assignments for surviving default workspaces", () => {
  const current = createDefaultWorkspaceState();
  current.workspaces[0].name = "Office";
  current.workspaces[0].color = "#112233";
  current.workspaces[0].defaultContainerRef = "ctr-work";
  current.workspaces.push({
    id: "ws-extra",
    name: "Extra",
    icon: "circle",
    color: "#112233",
    defaultContainerRef: "ctr-extra"
  });
  current.rail.push({ kind: "workspace", workspaceId: "ws-extra" });

  const reset = createResetWorkspaceState(current);
  assert.equal(reset.workspaces[0].name, "Work");
  assert.equal(reset.workspaces[0].color, "#FFFFFF");
  assert.deepEqual(
    reset.workspaces.map(({ icon, color }) => ({ icon, color })),
    [
      { icon: "house", color: "#FFFFFF" },
      { icon: "user", color: "#FFFFFF" },
      { icon: "notebook-pen", color: "#FFFFFF" }
    ]
  );
  assert.equal(reset.workspaces[0].defaultContainerRef, "ctr-work");
  assert.equal(reset.workspaces.some(({ id }) => id === "ws-extra"), false);
});

test("each default state is a fresh validated document", () => {
  const first = createDefaultWorkspaceState();
  const second = createDefaultWorkspaceState();

  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.workspaces, second.workspaces);
  assert.notStrictEqual(first.rail, second.rail);

  first.workspaces[0].name = "Changed locally";
  first.rail.reverse();
  assert.equal(second.workspaces[0].name, "Work");
  assert.equal(second.rail[0].workspaceId, "ws-default-work");
});

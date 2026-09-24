import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TAB_SEARCH_LOCATION_LENGTH,
  parseWorkspaceSearchIndex,
  searchableTabLocation
} from "../../src/contracts/workspace-search.js";

const WORKSPACES = ["ws-one", "ws-two"];

function validIndex() {
  return {
    workspaces: [
      {
        id: "ws-one",
        name: "One",
        icon: "house",
        color: "#112233",
        container: { kind: "none" }
      },
      {
        id: "ws-two",
        name: "Two",
        icon: "user",
        color: "#445566",
        container: {
          kind: "container",
          refId: "ctr-two",
          descriptor: null,
          status: "unavailable"
        }
      }
    ],
    tabs: [
      {
        logicalTabId: "tab-one",
        firefoxTabId: 11,
        workspaceId: "ws-one",
        title: "Release notes",
        discarded: true,
        pinned: false,
        groupTitle: "Planning",
        ancestorTitles: ["Project home"],
        location: "docs.example.test/release"
      },
      {
        logicalTabId: "tab-two",
        firefoxTabId: 12,
        workspaceId: "ws-two",
        title: "Inbox",
        discarded: false,
        pinned: true,
        groupTitle: null,
        ancestorTitles: [],
        location: null
      }
    ]
  };
}

test("workspace search indexes keep only bounded presentation data and a reduced location", () => {
  const source = validIndex();
  const parsed = parseWorkspaceSearchIndex(source, WORKSPACES);
  assert.deepEqual(parsed, source);
  assert.notStrictEqual(parsed.tabs[0], source.tabs[0]);
  assert.notStrictEqual(parsed.tabs[0].ancestorTitles, source.tabs[0].ancestorTitles);
  assert.notStrictEqual(parsed.workspaces[0], source.workspaces[0]);

  const withUrl = structuredClone(source);
  withUrl.tabs[0].url = "https://example.test/secret";
  assert.throws(() => parseWorkspaceSearchIndex(withUrl, WORKSPACES), /invalid identity/);

  const missingLocation = structuredClone(source);
  delete missingLocation.tabs[0].location;
  assert.throws(() => parseWorkspaceSearchIndex(missingLocation, WORKSPACES), /invalid identity/);

  const oversizedLocation = structuredClone(source);
  oversizedLocation.tabs[0].location = "a".repeat(MAX_TAB_SEARCH_LOCATION_LENGTH + 1);
  assert.throws(() => parseWorkspaceSearchIndex(oversizedLocation, WORKSPACES), /invalid identity/);
});

test("searchable tab locations keep the site and path but drop secrets and opaque schemes", () => {
  assert.equal(
    searchableTabLocation("https://user:pass@Docs.Example.test:8443/a/Caf%C3%A9?token=1#top"),
    "docs.example.test/a/Café"
  );
  assert.equal(searchableTabLocation("http://example.test/"), "example.test");
  assert.equal(searchableTabLocation("about:preferences#privacy"), "about:preferences");
  assert.equal(searchableTabLocation("file:///home/me/notes.txt?x=1"), "/home/me/notes.txt");
  assert.equal(searchableTabLocation("https://example.test/%E0%A4%A"), "example.test/%E0%A4%A");
  for (const opaque of [
    "data:text/html,secret",
    "blob:https://example.test/1",
    "moz-extension://abc/page.html",
    "javascript:alert(1)",
    "not a url",
    "",
    undefined
  ]) {
    assert.equal(searchableTabLocation(opaque), null, String(opaque));
  }
  assert.equal(
    searchableTabLocation(`https://example.test/${"a".repeat(5000)}`).length,
    MAX_TAB_SEARCH_LOCATION_LENGTH
  );
});

test("sidebar revalidation compares canonical workspace colors against stored case", () => {
  const knownWorkspaces = [
    { id: "ws-one", name: "One", icon: "house", color: "#FFFFFF" },
    { id: "ws-two", name: "Two", icon: "user", color: "#AbCdEf" }
  ];
  const source = validIndex();
  source.workspaces[0].color = "#FFFFFF";
  source.workspaces[1].color = "#abcdef";
  const backgroundPass = parseWorkspaceSearchIndex(source, knownWorkspaces);
  assert.deepEqual(backgroundPass.workspaces.map(({ color }) => color), ["#ffffff", "#abcdef"]);
  const wire = JSON.parse(JSON.stringify(backgroundPass));
  assert.deepEqual(parseWorkspaceSearchIndex(wire, knownWorkspaces), backgroundPass);

  const recolored = structuredClone(wire);
  recolored.workspaces[1].color = "#abcdee";
  assert.throws(
    () => parseWorkspaceSearchIndex(recolored, knownWorkspaces),
    /does not match the current workspace/
  );
});

test("workspace search indexes reject stale, duplicate, and unknown identities", () => {
  const duplicateLogical = validIndex();
  duplicateLogical.tabs[1].logicalTabId = "tab-one";
  assert.throws(
    () => parseWorkspaceSearchIndex(duplicateLogical, WORKSPACES),
    /invalid identity/
  );

  const duplicateFirefox = validIndex();
  duplicateFirefox.tabs[1].firefoxTabId = 11;
  assert.throws(
    () => parseWorkspaceSearchIndex(duplicateFirefox, WORKSPACES),
    /invalid identity/
  );

  const unknownWorkspace = validIndex();
  unknownWorkspace.tabs[0].workspaceId = "ws-unknown";
  assert.throws(
    () => parseWorkspaceSearchIndex(unknownWorkspace, WORKSPACES),
    /invalid identity/
  );
});

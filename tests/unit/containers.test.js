import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTAINER_ERROR_CODES,
  CONTAINER_STATE_SCHEMA_VERSION,
  ContainerError,
  containerAssignment,
  createEmptyContainerState,
  noContainerAssignment,
  parseContainerAssignment,
  parseContainerCatalog,
  parseSupportedContainerColor,
  parseSupportedContainerIcon,
  parseContainerState,
  projectContainerCatalog
} from "../../src/contracts/containers.js";

const descriptor = Object.freeze({
  name: "Work",
  color: "blue",
  icon: "briefcase",
  colorCode: "#37adff"
});

test("supported Firefox option records normalize safe color and icon metadata", () => {
  assert.deepEqual(
    parseSupportedContainerColor({ color: "blue", colorCode: "#37ADFF" }),
    { color: "blue", colorCode: "#37adff" }
  );
  assert.deepEqual(
    parseSupportedContainerIcon({
      icon: "fingerprint",
      iconUrl: "resource://usercontext-content/fingerprint.svg"
    }),
    {
      icon: "fingerprint",
      iconUrl: "resource://usercontext-content/fingerprint.svg"
    }
  );
  assert.throws(
    () => parseSupportedContainerIcon({ icon: "fingerprint", iconUrl: "https://example.test/icon.svg" }),
    expectCode(CONTAINER_ERROR_CODES.INVALID_STATE)
  );
});

function expectCode(code) {
  return (error) => {
    assert.ok(error instanceof ContainerError);
    assert.equal(error.code, code);
    return true;
  };
}

test("container state is strict, defensive, and keeps native identifiers local", () => {
  const source = {
    schemaVersion: CONTAINER_STATE_SCHEMA_VERSION,
    bindings: [{ refId: "ctr-work", descriptor, cookieStoreId: "firefox-container-1" }]
  };
  const parsed = parseContainerState(source);
  assert.deepEqual(parsed, source);
  assert.notStrictEqual(parsed.bindings[0], source.bindings[0]);
  assert.notStrictEqual(parsed.bindings[0].descriptor, source.bindings[0].descriptor);
  assert.deepEqual(createEmptyContainerState(), { schemaVersion: 1, bindings: [] });
});

test("portable container catalogs preserve the Terminus icon independently", () => {
  const withDisplayIcon = { ...descriptor, sidebarsIcon: "cart" };
  const parsed = parseContainerCatalog([{ refId: "ctr-work", descriptor: withDisplayIcon }]);
  assert.equal(parsed[0].descriptor.icon, "briefcase");
  assert.equal(parsed[0].descriptor.sidebarsIcon, "cart");
});

test("portable assignments distinguish explicit none from logical references", () => {
  assert.deepEqual(parseContainerAssignment(noContainerAssignment()), { kind: "none" });
  assert.deepEqual(parseContainerAssignment(containerAssignment("ctr-work")), {
    kind: "container",
    refId: "ctr-work"
  });
  assert.throws(
    () => parseContainerAssignment({ kind: "none", refId: null }),
    expectCode(CONTAINER_ERROR_CODES.INVALID_STATE)
  );
});

test("catalog projection is deduplicated, sorted, and excludes cookieStoreId", () => {
  const catalog = projectContainerCatalog(
    ["ctr-work", "ctr-work"],
    [{ refId: "ctr-work", descriptor, cookieStoreId: "firefox-container-1" }]
  );
  assert.deepEqual(catalog, [{ refId: "ctr-work", descriptor }]);
  assert.equal(JSON.stringify(catalog).includes("firefox-container-1"), false);
});

test("malformed, duplicate, and future container documents reject", () => {
  assert.throws(
    () => parseContainerState({ schemaVersion: 2, bindings: [] }),
    expectCode(CONTAINER_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION)
  );
  assert.throws(
    () => parseContainerState({
      schemaVersion: 1,
      bindings: [
        { refId: "ctr-work", descriptor, cookieStoreId: null },
        { refId: "ctr-work", descriptor, cookieStoreId: null }
      ]
    }),
    expectCode(CONTAINER_ERROR_CODES.INVALID_STATE)
  );
  assert.throws(
    () => parseContainerCatalog([
      { refId: "ctr-work", descriptor },
      { refId: "ctr-work", descriptor }
    ]),
    expectCode(CONTAINER_ERROR_CODES.INVALID_STATE)
  );
});

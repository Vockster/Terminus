import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_WORKSPACE_PACKAGE_BYTES,
  WORKSPACE_PACKAGE_DOCUMENT_TYPE,
  WORKSPACE_PACKAGE_ERROR_CODES,
  WORKSPACE_PACKAGE_SCHEMA_VERSION,
  WorkspacePackageError,
  createWorkspaceArchiveManifest,
  createWorkspacePackage,
  decodeWorkspacePackageBytes,
  encodeWorkspacePackageBytes,
  parseWorkspacePackage,
  workspacePackageFailure,
  workspacePackageFromArchive
} from "../../src/contracts/workspace-package.js";
import { WORKSPACE_STATE_SCHEMA_VERSION } from "../../src/contracts/workspace-state.js";
import { customIconId, pngBytes, sha256Hex } from "../helpers/custom-icon-fixture.js";

function packagedIcon(seed = 1) {
  const bytes = pngBytes({ fill: seed % 256 });
  return {
    id: customIconId(seed),
    label: `Icon ${seed}`,
    digest: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    dataBase64: encodeWorkspacePackageBytes(bytes)
  };
}

function validDocument({ icons = [packagedIcon(1)], workspaceIcon = customIconId(1) } = {}) {
  return {
    documentType: WORKSPACE_PACKAGE_DOCUMENT_TYPE,
    schemaVersion: WORKSPACE_PACKAGE_SCHEMA_VERSION,
    createdAt: "2026-09-19T20:00:00.000Z",
    payload: {
      workspaces: {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [
          { id: "ws-one", name: "Work", icon: workspaceIcon, color: "#ffffff" },
          { id: "ws-two", name: "Personal", icon: "house", color: "#112233" }
        ],
        rail: [
          { kind: "workspace", workspaceId: "ws-one" },
          { kind: "divider", id: "divider-a", size: 16 },
          { kind: "workspace", workspaceId: "ws-two" },
          { kind: "space", id: "space-a" }
        ]
      },
      icons
    }
  };
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof WorkspacePackageError, `expected a package error, got ${error}`);
    return error.code;
  }
  return null;
}

test("a valid package parses and keeps its rail decorations and icons", () => {
  const parsed = parseWorkspacePackage(validDocument());
  assert.equal(parsed.documentType, WORKSPACE_PACKAGE_DOCUMENT_TYPE);
  assert.equal(parsed.schemaVersion, WORKSPACE_PACKAGE_SCHEMA_VERSION);
  assert.equal(parsed.payload.workspaces.workspaces.length, 2);
  assert.deepEqual(
    parsed.payload.workspaces.rail.map(({ kind }) => kind),
    ["workspace", "divider", "workspace", "space"]
  );
  assert.equal(parsed.payload.icons.length, 1);
});

test("a package carries no container assignment at all", () => {
  const parsed = parseWorkspacePackage(validDocument());
  for (const workspace of parsed.payload.workspaces.workspaces) {
    assert.deepEqual(Object.keys(workspace).sort(), ["color", "icon", "id", "name"]);
  }
  assert.ok(!("containerCatalog" in parsed.payload));
});

test("a workspace state carrying a container reference is not a valid package payload", () => {
  const document = validDocument();
  document.payload.workspaces.workspaces[0].defaultContainerRef = null;
  assert.equal(
    codeOf(() => parseWorkspacePackage(document)),
    WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
  );
});

test("another document type is not read as a workspace package", () => {
  const document = validDocument();
  document.documentType = "sidebars.snapshot";
  assert.equal(
    codeOf(() => parseWorkspacePackage(document)),
    WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE
  );
});

test("a newer schema version is refused as unsupported rather than damaged", () => {
  const document = validDocument();
  document.schemaVersion = WORKSPACE_PACKAGE_SCHEMA_VERSION + 1;
  assert.equal(
    codeOf(() => parseWorkspacePackage(document)),
    WORKSPACE_PACKAGE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
  );
});

test("missing and extra document keys are both refused", () => {
  const missing = validDocument();
  delete missing.createdAt;
  assert.equal(
    codeOf(() => parseWorkspacePackage(missing)),
    WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE
  );

  const extra = validDocument();
  extra.extra = true;
  assert.equal(
    codeOf(() => parseWorkspacePackage(extra)),
    WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE
  );
});

test("bad workspace fields are refused", () => {
  for (const mutate of [
    (document) => { document.payload.workspaces.workspaces[0].name = "  untrimmed"; },
    (document) => { document.payload.workspaces.workspaces[0].name = ""; },
    (document) => { document.payload.workspaces.workspaces[0].color = "red"; },
    (document) => { document.payload.workspaces.workspaces[0].icon = "Not An Icon"; },
    (document) => { document.payload.workspaces.workspaces[0].id = "Bad Id"; },
    (document) => { document.payload.workspaces.rail[1].size = 9999; },
    (document) => { document.payload.workspaces.rail[0].workspaceId = "ws-missing"; }
  ]) {
    const document = validDocument();
    mutate(document);
    assert.equal(
      codeOf(() => parseWorkspacePackage(document)),
      WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
    );
  }
});

test("bad icon records are refused", () => {
  for (const mutate of [
    (document) => { document.payload.icons[0].id = "not-a-custom-id"; },
    (document) => { document.payload.icons[0].digest = "xyz"; },
    (document) => { document.payload.icons[0].byteLength = 0; },
    (document) => { document.payload.icons[0].dataBase64 = "not base64!"; },
    (document) => { document.payload.icons[0].label = ""; },
    (document) => { delete document.payload.icons[0].label; }
  ]) {
    const document = validDocument();
    mutate(document);
    assert.equal(
      codeOf(() => parseWorkspacePackage(document)),
      WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
    );
  }
});

test("two icon records may not share one id", () => {
  const document = validDocument({ icons: [packagedIcon(1), packagedIcon(1)] });
  assert.equal(
    codeOf(() => parseWorkspacePackage(document)),
    WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
  );
});

test("an icon a workspace references may be absent, because the import falls back", () => {
  const document = validDocument({ icons: [] });
  const parsed = parseWorkspacePackage(document);
  assert.equal(parsed.payload.icons.length, 0);
  assert.equal(parsed.payload.workspaces.workspaces[0].icon, customIconId(1));
});

test("createWorkspacePackage produces a document its own parser accepts", () => {
  const icons = [packagedIcon(7)];
  const document = createWorkspacePackage({
    workspaces: [{ id: "ws-one", name: "Work", icon: customIconId(7), color: "#abcdef" }],
    rail: [{ kind: "workspace", workspaceId: "ws-one" }],
    icons,
    createdAt: "2026-09-19T20:00:00.000Z"
  });
  assert.deepEqual(parseWorkspacePackage(JSON.parse(JSON.stringify(document))), document);
});

test("icon bytes survive the base64 round trip exactly", () => {
  const bytes = pngBytes({ fill: 42, length: 256 });
  assert.deepEqual(decodeWorkspacePackageBytes(encodeWorkspacePackageBytes(bytes)), bytes);
});

test("base64 that is not base64 is refused rather than decoded", () => {
  assert.equal(
    codeOf(() => decodeWorkspacePackageBytes("@@@@")),
    WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
  );
  assert.equal(
    codeOf(() => decodeWorkspacePackageBytes("")),
    WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
  );
});

test("an archive manifest and its files read back as the same package", () => {
  const png = pngBytes({ fill: 44 });
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const inline = createWorkspacePackage({
    workspaces: [{ id: "ws-a", name: "A", icon: customIconId(7), color: "#010101" }],
    rail: [{ kind: "workspace", workspaceId: "ws-a" }],
    icons: [{
      id: customIconId(7),
      label: "Vector",
      digest: sha256Hex(png),
      byteLength: png.byteLength,
      dataBase64: encodeWorkspacePackageBytes(png),
      source: {
        mimeType: "image/svg+xml",
        byteLength: svg.byteLength,
        dataBase64: encodeWorkspacePackageBytes(svg)
      }
    }],
    createdAt: "2026-09-22T04:00:00.000Z"
  });

  const fileNames = new Map([[customIconId(7), { file: "icons/Vector.png", sourceFile: "originals/Vector.svg" }]]);
  const manifest = createWorkspaceArchiveManifest(inline, fileNames);
  assert.equal(manifest.documentType, "sidebars.workspace-archive");
  assert.equal(manifest.schemaVersion, 1);
  // The manifest names files instead of carrying base64 text.
  assert.deepEqual(manifest.payload.icons[0].file, "icons/Vector.png");
  assert.deepEqual(manifest.payload.icons[0].source.file, "originals/Vector.svg");
  assert.equal(JSON.stringify(manifest).includes("dataBase64"), false);

  const files = new Map([["icons/Vector.png", png], ["originals/Vector.svg", svg]]);
  assert.deepEqual(workspacePackageFromArchive(manifest, files), inline);
});

test("a damaged optional original is reported and dropped without losing its normalized icon", () => {
  const png = pngBytes({ fill: 46 });
  const sourceId = customIconId(9);
  const manifest = {
    documentType: "sidebars.workspace-archive",
    schemaVersion: 1,
    createdAt: "2026-09-22T04:00:00.000Z",
    payload: {
      workspaces: {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [{ id: "ws-a", name: "A", icon: sourceId, color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }]
      },
      icons: [{
        id: sourceId,
        label: "Vector",
        digest: sha256Hex(png),
        byteLength: png.byteLength,
        file: "icons/Vector.png",
        source: {
          mimeType: "image/svg+xml",
          byteLength: 40,
          file: "originals/Vector.svg"
        }
      }]
    }
  };
  const damaged = [];
  const parsed = workspacePackageFromArchive(
    manifest,
    new Map([["icons/Vector.png", png]]),
    { onDamagedSource: (icon) => damaged.push(icon) }
  );

  assert.equal(parsed.payload.icons[0].source, null);
  assert.deepEqual(decodeWorkspacePackageBytes(parsed.payload.icons[0].dataBase64), png);
  assert.deepEqual(damaged, [{ id: sourceId, label: "Vector" }]);
});

test("an archive whose files are missing, resized or misnamed is damaged", () => {
  const png = pngBytes({ fill: 45 });
  const manifest = {
    documentType: "sidebars.workspace-archive",
    schemaVersion: 1,
    createdAt: "2026-09-22T04:00:00.000Z",
    payload: {
      workspaces: {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [{ id: "ws-a", name: "A", icon: customIconId(8), color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }]
      },
      icons: [{
        id: customIconId(8),
        label: "Solo",
        digest: sha256Hex(png),
        byteLength: png.byteLength,
        file: "icons/Solo.png",
        source: null
      }]
    }
  };
  const good = new Map([["icons/Solo.png", png]]);
  assert.equal(workspacePackageFromArchive(manifest, good).payload.icons.length, 1);

  for (const files of [
    new Map(),
    new Map([["icons/Solo.png", png.subarray(0, png.byteLength - 1)]]),
    new Map([["icons/Other.png", png]])
  ]) {
    assert.throws(
      () => workspacePackageFromArchive(manifest, files),
      (error) => error.code === WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
    );
  }
  // The manifest cannot name itself as an icon file.
  assert.throws(
    () => workspacePackageFromArchive(
      { ...manifest, payload: { ...manifest.payload, icons: [{ ...manifest.payload.icons[0], file: "workspaces.json" }] } },
      new Map([["workspaces.json", png]])
    ),
    (error) => error.code === WORKSPACE_PACKAGE_ERROR_CODES.INVALID_PACKAGE
  );
});

test("another document type or a newer archive is refused before its files are read", () => {
  const base = {
    documentType: "sidebars.workspace-archive",
    schemaVersion: 1,
    createdAt: "2026-09-22T04:00:00.000Z",
    payload: {
      workspaces: {
        schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
        workspaces: [{ id: "ws-a", name: "A", icon: "house", color: "#010101" }],
        rail: [{ kind: "workspace", workspaceId: "ws-a" }]
      },
      icons: []
    }
  };
  assert.equal(workspacePackageFromArchive(base, new Map()).payload.workspaces.workspaces.length, 1);
  assert.throws(
    () => workspacePackageFromArchive({ ...base, documentType: "sidebars.snapshot" }, new Map()),
    (error) => error.code === WORKSPACE_PACKAGE_ERROR_CODES.NOT_PACKAGE_FILE
  );
  assert.throws(
    () => workspacePackageFromArchive({ ...base, schemaVersion: 2 }, new Map()),
    (error) => error.code === WORKSPACE_PACKAGE_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
  );
});

test("the package ceiling matches the existing export limit", () => {
  assert.equal(MAX_WORKSPACE_PACKAGE_BYTES, 16 * 1024 * 1024);
});

test("a foreign error carrying a code this contract owns keeps that code", () => {
  // A refused downloads permission arrives as a SnapshotError, not a package
  // error. Collapsing it to INTERNAL_ERROR once hid the real cause of a failed
  // export behind "could not be completed".
  const foreign = new Error("Downloads permission is required.");
  foreign.code = WORKSPACE_PACKAGE_ERROR_CODES.PERMISSION_REQUIRED;
  const failure = workspacePackageFailure(foreign);
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, WORKSPACE_PACKAGE_ERROR_CODES.PERMISSION_REQUIRED);
  assert.match(failure.error.message, /Saving files is not available/);
});

test("a foreign error with an unknown code is still internal", () => {
  const foreign = new Error("something else");
  foreign.code = "SOME_OTHER_SUBSYSTEM_CODE";
  assert.equal(
    workspacePackageFailure(foreign).error.code,
    WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR
  );
  assert.equal(
    workspacePackageFailure(new Error("no code at all")).error.code,
    WORKSPACE_PACKAGE_ERROR_CODES.INTERNAL_ERROR
  );
});

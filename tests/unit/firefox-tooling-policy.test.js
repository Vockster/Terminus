import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlledWebExtArgs,
  createSanitizedWebExtEnvironment,
  validateForwardedWebExtArgs,
  validateTrustedWebExtConfig
} from "../../scripts/firefox-tooling-policy.mjs";

function trustedConfig() {
  return {
    sourceDir: ".",
    artifactsDir: "web-ext-artifacts",
    ignoreFiles: ["node_modules/**"],
    run: { target: ["firefox-desktop"] },
    lint: { warningsAsErrors: true }
  };
}

test("Firefox tooling rejects every profile, browser, target, raw-argument, and config override", () => {
  for (const token of [
    "--firefox-profile=daily",
    "--firefoxProfile",
    "-pdaily",
    "-vp",
    "--keep-profile-changes",
    "--no-keep-profile-changes",
    "--profile-create-if-missing",
    "--chromium-profile",
    "--chromium-binary=chrome",
    "--firefox",
    "--firefox-binary=nightly",
    "-fnightly",
    "--target=chromium",
    "-tchromium",
    "--args=-profile",
    "--arg",
    "--config=other.js",
    "-cother.js",
    "--config-discovery",
    "--no-config-discovery",
    "--source-dir=elsewhere",
    "-selsewhere",
    "--artifacts-dir=elsewhere",
    "-aelsewhere",
    "--ignore-files=manifest.json",
    "-imanifest.json",
    "--no-warnings-as-errors",
    "-w=false",
    "--"
  ]) {
    assert.throws(() => validateForwardedWebExtArgs([token]), /controlled|raw argument/);
  }

  assert.deepEqual(validateForwardedWebExtArgs(["--devtools", "--start-url", "about:blank"]), [
    "--devtools",
    "--start-url",
    "about:blank"
  ]);
});

test("Firefox tooling removes all web-ext environment overrides without mutating the source", () => {
  const source = {
    PATH: "bin",
    WEB_EXT_FIREFOX_PROFILE: "daily",
    web_ext_target: "chromium",
    WEB_EXTENSION_UNRELATED: "also consumed by the prefix parser",
    TERMINUS_FIREFOX_BINARY: "firefox"
  };

  assert.deepEqual(createSanitizedWebExtEnvironment(source), {
    PATH: "bin",
    TERMINUS_FIREFOX_BINARY: "firefox"
  });
  assert.equal(source.WEB_EXT_FIREFOX_PROFILE, "daily");
});

test("Firefox tooling accepts only the pinned repository config shape", () => {
  assert.equal(validateTrustedWebExtConfig(trustedConfig()).sourceDir, ".");

  for (const mutate of [
    (config) => {
      config.run.firefoxProfile = "daily";
    },
    (config) => {
      config.run.target = ["chromium"];
    },
    (config) => {
      config.config = "elsewhere.js";
    },
    (config) => {
      config.lint.warningsAsErrors = false;
    }
  ]) {
    const config = trustedConfig();
    mutate(config);
    assert.throws(() => validateTrustedWebExtConfig(config), /unsupported|exactly|enabled/);
  }
});

test("Firefox command construction pins repository config, target, and binary", () => {
  assert.deepEqual(
    createControlledWebExtArgs({
      cliPath: "web-ext.js",
      command: "run",
      packageJsonPath: "package.json",
      firefoxPath: "firefox.exe",
      forwardedArgs: ["--devtools"]
    }),
    [
      "web-ext.js",
      "run",
      "--no-config-discovery",
      "--config",
      "package.json",
      "--target",
      "firefox-desktop",
      "--firefox",
      "firefox.exe",
      "--devtools"
    ]
  );
});

// Packaging takes the artifact directory and ignore list from the repository
// config, never a caller, and replaces a stale artifact rather than failing on
// a rebuild.
test("packaging pins repository config and owns the artifact replacement", () => {
  assert.deepEqual(
    createControlledWebExtArgs({
      cliPath: "web-ext.js",
      command: "build",
      packageJsonPath: "package.json"
    }),
    [
      "web-ext.js",
      "build",
      "--no-config-discovery",
      "--config",
      "package.json",
      "--overwrite-dest"
    ]
  );
  for (const option of ["--artifacts-dir", "--overwrite-dest", "--no-overwrite-dest", "--ignore-files"]) {
    assert.throws(() => validateForwardedWebExtArgs([option]), /not permitted|controlled/i);
  }
});

test("packaging never accepts a Firefox binary or an unknown command", () => {
  assert.throws(
    () => createControlledWebExtArgs({
      cliPath: "web-ext.js",
      command: "sign",
      packageJsonPath: "package.json"
    }),
    /unsupported controlled web-ext command/
  );
});

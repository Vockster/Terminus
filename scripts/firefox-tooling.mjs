#!/usr/bin/env node

import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createControlledWebExtArgs,
  createSanitizedWebExtEnvironment,
  validateForwardedWebExtArgs,
  validateTrustedWebExtConfig
} from "./firefox-tooling-policy.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "manifest.json");
const repoPackagePath = join(repoRoot, "package.json");
const webExtPackagePath = join(repoRoot, "node_modules", "web-ext", "package.json");
const command = process.argv[2] ?? "check";
const forwardedArgs = process.argv.slice(3);

function fail(message, exitCode = 1) {
  console.error(`Terminus tooling error: ${message}`);
  process.exit(exitCode);
}

function firstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function findOnPath(executableNames) {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

  for (const entry of pathEntries) {
    for (const executableName of executableNames) {
      const candidate = join(entry, executableName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function findFirefox() {
  const override = process.env.TERMINUS_FIREFOX_BINARY;
  if (override) {
    const resolvedOverride = isAbsolute(override) ? override : resolve(repoRoot, override);
    if (!existsSync(resolvedOverride)) {
      fail(`TERMINUS_FIREFOX_BINARY does not exist: ${resolvedOverride}`);
    }
    return resolvedOverride;
  }

  const pathMatch = findOnPath(
    process.platform === "win32" ? ["firefox.exe", "firefox.cmd"] : ["firefox"]
  );

  const platformCandidates = {
    win32: [
      join(process.env.ProgramFiles ?? "C:\\Program Files", "Mozilla Firefox", "firefox.exe"),
      join(
        process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
        "Mozilla Firefox",
        "firefox.exe"
      ),
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Mozilla Firefox", "firefox.exe")
        : undefined
    ],
    darwin: [
      "/Applications/Firefox.app/Contents/MacOS/firefox",
      "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"
    ],
    linux: ["/usr/bin/firefox", "/usr/local/bin/firefox", "/snap/bin/firefox"]
  };

  return pathMatch ?? firstExistingPath(platformCandidates[process.platform] ?? []);
}

function loadWebExt() {
  if (!existsSync(webExtPackagePath)) {
    fail("web-ext is not installed. Run `npm install` first.");
  }

  const packageJson = JSON.parse(readFileSync(webExtPackagePath, "utf8"));
  const binEntry =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.["web-ext"];

  if (!binEntry) {
    fail("the installed web-ext package does not expose its CLI entry point.");
  }

  const cliPath = resolve(dirname(webExtPackagePath), binEntry);
  if (!existsSync(cliPath)) {
    fail(`the web-ext CLI entry point is missing: ${cliPath}`);
  }

  return { cliPath, version: packageJson.version };
}

function runProcess(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    env: {
      ...createSanitizedWebExtEnvironment(process.env),
      NO_UPDATE_NOTIFIER: "1"
    },
    stdio: "inherit",
    windowsHide: true
  });

  if (result.error) {
    fail(result.error.message);
  }

  process.exit(result.status ?? 1);
}

function requireTrustedWebExtConfig() {
  try {
    const packageJson = JSON.parse(readFileSync(repoPackagePath, "utf8"));
    validateTrustedWebExtConfig(packageJson.webExt);
  } catch (error) {
    fail(`the repository web-ext configuration is not trusted: ${error.message}`);
  }
}

// web-ext overwrites the ZIP in place, so the build it replaces would otherwise
// be gone. Keep each outgoing archive beside the new one with a "B" suffix, so
// there is always one previous package to fall back to.
function backupPreviousArtifacts() {
  let artifactsDir = "web-ext-artifacts";
  try {
    const packageJson = JSON.parse(readFileSync(repoPackagePath, "utf8"));
    if (typeof packageJson.webExt?.artifactsDir === "string") {
      artifactsDir = packageJson.webExt.artifactsDir;
    }
  } catch {
    // The trusted-config check already reported anything wrong with this file.
  }
  const directory = join(repoRoot, artifactsDir);
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const extension = extname(entry.name);
    if (extension !== ".zip" && extension !== ".xpi") {
      continue;
    }
    const base = entry.name.slice(0, -extension.length);
    if (base.endsWith("B")) {
      continue;
    }
    const backupName = `${base}B${extension}`;
    try {
      copyFileSync(join(directory, entry.name), join(directory, backupName));
      console.log(`Kept the previous build as ${backupName}`);
    } catch (error) {
      fail(`the previous build could not be backed up as ${backupName}: ${error.message}`);
    }
  }
}

function requireSafeForwardedArgs() {
  try {
    validateForwardedWebExtArgs(forwardedArgs);
  } catch (error) {
    fail(error.message, 2);
  }
}

function requireManifest() {
  if (!existsSync(manifestPath)) {
    fail(
      "manifest.json is missing. Restore the extension manifest, then rerun this command.",
      2
    );
  }
}

function printCheck() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const { version: webExtVersion } = loadWebExt();
  const firefoxPath = findFirefox();
  requireTrustedWebExtConfig();

  console.log(`Node: ${process.versions.node}${nodeMajor >= 22 ? " (supported)" : " (requires 22+)"}`);
  console.log(`web-ext: ${webExtVersion} (repo-local)`);
  console.log(`Firefox: ${firefoxPath ?? "not found"}`);
  console.log(`Manifest: ${existsSync(manifestPath) ? manifestPath : "missing"}`);
  console.log("Test profile: temporary and disposable (enforced by Terminus tooling)");
  console.log("web-ext config: repository package only; discovery and WEB_EXT_* overrides disabled");

  if (nodeMajor < 22) {
    fail("web-ext 10 requires Node.js 22 or newer.");
  }
  if (!firefoxPath) {
    fail(
      "Firefox was not found. Set TERMINUS_FIREFOX_BINARY to the full Firefox executable path."
    );
  }
}

if (extname(webExtPackagePath) !== ".json") {
  fail("unexpected web-ext package metadata path.");
}

switch (command) {
  case "check":
    printCheck();
    break;

  case "lint": {
    requireManifest();
    requireTrustedWebExtConfig();
    requireSafeForwardedArgs();
    const { cliPath } = loadWebExt();
    runProcess(
      process.execPath,
      createControlledWebExtArgs({
        cliPath,
        command: "lint",
        packageJsonPath: repoPackagePath,
        forwardedArgs
      })
    );
    break;
  }

  case "build": {
    requireManifest();
    requireTrustedWebExtConfig();
    requireSafeForwardedArgs();
    backupPreviousArtifacts();
    const { cliPath } = loadWebExt();
    runProcess(
      process.execPath,
      createControlledWebExtArgs({
        cliPath,
        command: "build",
        packageJsonPath: repoPackagePath,
        forwardedArgs
      })
    );
    break;
  }

  case "run": {
    requireManifest();
    requireTrustedWebExtConfig();
    requireSafeForwardedArgs();
    const { cliPath } = loadWebExt();
    const firefoxPath = findFirefox();
    if (!firefoxPath) {
      fail(
        "Firefox was not found. Set TERMINUS_FIREFOX_BINARY to the full Firefox executable path."
      );
    }

    runProcess(
      process.execPath,
      createControlledWebExtArgs({
        cliPath,
        command: "run",
        packageJsonPath: repoPackagePath,
        firefoxPath,
        forwardedArgs
      })
    );
    break;
  }

  default:
    fail(`unknown command "${command}". Expected check, lint, build, or run.`, 2);
}

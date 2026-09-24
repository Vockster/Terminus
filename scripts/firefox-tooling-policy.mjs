const CONTROLLED_LONG_OPTIONS = new Set([
  "arg",
  "args",
  "artifacts-dir",
  "chromium-binary",
  "chromium-profile",
  "config",
  "config-discovery",
  "firefox",
  "firefox-binary",
  "firefox-profile",
  "ignore-files",
  "keep-profile-changes",
  "overwrite-dest",
  "profile-create-if-missing",
  "source-dir",
  "target",
  "warnings-as-errors"
]);

const CONTROLLED_SHORT_OPTIONS = new Set(["a", "c", "f", "i", "p", "s", "t", "w"]);
const ALLOWED_WEB_EXT_KEYS = new Set([
  "artifactsDir",
  "ignoreFiles",
  "lint",
  "run",
  "sourceDir"
]);

function optionNameFromLongToken(token) {
  const rawName = token.slice(2).split("=", 1)[0];
  const withoutNegation = rawName.startsWith("no-") ? rawName.slice(3) : rawName;
  return withoutNegation
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

export function validateForwardedWebExtArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("forwarded web-ext arguments must be an array of strings");
  }

  for (const token of args) {
    if (token === "--") {
      throw new Error("the raw argument delimiter is controlled by Terminus tooling");
    }
    if (token.startsWith("--")) {
      const optionName = optionNameFromLongToken(token);
      if (CONTROLLED_LONG_OPTIONS.has(optionName)) {
        throw new Error(`--${optionName} is controlled by Terminus tooling`);
      }
      continue;
    }
    if (token.startsWith("-") && token.length >= 2) {
      const shortToken = token.slice(1).split("=", 1)[0].toLowerCase();
      const optionName = [...shortToken].find((name) =>
        CONTROLLED_SHORT_OPTIONS.has(name)
      );
      if (optionName) {
        throw new Error(`-${optionName} is controlled by Terminus tooling`);
      }
    }
  }

  return [...args];
}

export function createSanitizedWebExtEnvironment(environment) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError("web-ext environment must be an object");
  }

  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.toUpperCase().startsWith("WEB_EXT"))
  );
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !expectedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported key: ${unexpected[0]}`);
  }
}

export function validateTrustedWebExtConfig(webExt) {
  assertExactKeys(webExt, ALLOWED_WEB_EXT_KEYS, "package.json webExt");
  if (webExt.sourceDir !== ".") {
    throw new Error('package.json webExt.sourceDir must be "."');
  }
  if (webExt.artifactsDir !== "web-ext-artifacts") {
    throw new Error('package.json webExt.artifactsDir must be "web-ext-artifacts"');
  }
  if (
    !Array.isArray(webExt.ignoreFiles) ||
    webExt.ignoreFiles.length === 0 ||
    webExt.ignoreFiles.some((pattern) => typeof pattern !== "string" || pattern.length === 0)
  ) {
    throw new Error("package.json webExt.ignoreFiles must be a non-empty string array");
  }

  assertExactKeys(webExt.run, new Set(["target"]), "package.json webExt.run");
  if (
    !Array.isArray(webExt.run.target) ||
    webExt.run.target.length !== 1 ||
    webExt.run.target[0] !== "firefox-desktop"
  ) {
    throw new Error("package.json webExt.run.target must be exactly firefox-desktop");
  }

  assertExactKeys(webExt.lint, new Set(["warningsAsErrors"]), "package.json webExt.lint");
  if (webExt.lint.warningsAsErrors !== true) {
    throw new Error("package.json webExt.lint.warningsAsErrors must remain enabled");
  }

  return webExt;
}

export function createControlledWebExtArgs({
  cliPath,
  command,
  packageJsonPath,
  firefoxPath,
  forwardedArgs = []
}) {
  if (command !== "lint" && command !== "run" && command !== "build") {
    throw new Error(`unsupported controlled web-ext command: ${command}`);
  }
  const safeArgs = validateForwardedWebExtArgs(forwardedArgs);
  const controlledArgs = [
    cliPath,
    command,
    "--no-config-discovery",
    "--config",
    packageJsonPath
  ];

  // Packaging stays passive: the artifact directory and ignore list come from
  // the repository config, and replacing a stale artifact is the wrapper's
  // choice rather than a caller's, so `overwrite-dest` is controlled too.
  if (command === "build") {
    controlledArgs.push("--overwrite-dest");
  }

  if (command === "run") {
    if (typeof firefoxPath !== "string" || firefoxPath.length === 0) {
      throw new Error("a controlled Firefox path is required");
    }
    controlledArgs.push("--target", "firefox-desktop", "--firefox", firefoxPath);
  }

  return [...controlledArgs, ...safeArgs];
}

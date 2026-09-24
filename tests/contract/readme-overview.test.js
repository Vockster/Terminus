import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("README keeps its required sections and states the project license", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  const sections = [...readme.matchAll(/^## (.+)$/gm)].map(([, title]) => title);
  assert.deepEqual(sections, ["Features", "Privacy", "Requirements", "Development", "Credits", "License"]);
  assert.match(readme, /^# Terminus$/m);
  assert.match(readme, /Firefox Desktop 153 or newer/);
  for (const command of [
    "npm install",
    "npm test",
    "npm run lint:extension",
    "npm run check:tooling",
    "npm run test:firefox -- --no-reload"
  ]) {
    assert.ok(readme.includes(command), command);
  }
  assert.match(readme, /Mozilla Public License 2\.0/);
  assert.match(readme, /ISC License, with the Feather MIT notice/);
  assert.match(readme, /src\/assets\/icons\/LICENSE\.lucide\.txt/);
  // The project carries a real license now, so the README must name it and
  // point at the file rather than staying silent.
  assert.match(readme, /\[LICENSE\]\(LICENSE\)/);
  for (const file of ["CHANGELOG.md", "PRIVACY.md", "SECURITY.md"]) {
    assert.ok(readme.includes(`(${file})`), `README links ${file}`);
  }
});

// The files a published repository is expected to carry. Each is a promise to
// someone outside the project, so their absence is a contract failure.
test("the repository ships its standard top-level documents", async () => {
  const [license, changelog, privacy, security, manifest, packageJson, packageLock, readme] = await Promise.all([
    readFile(new URL("../../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../../CHANGELOG.md", import.meta.url), "utf8"),
    readFile(new URL("../../PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../../SECURITY.md", import.meta.url), "utf8"),
    readFile(new URL("../../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../../README.md", import.meta.url), "utf8")
  ]);
  // Exhibit A is the last section of the MPL, so its presence proves the text
  // is complete rather than an excerpt or a summary.
  assert.match(license, /^Mozilla Public License Version 2\.0$/m);
  assert.match(license, /Exhibit B - "Incompatible With Secondary Licenses" Notice/);
  assert.equal(JSON.parse(packageJson).license, "MPL-2.0");
  assert.equal(JSON.parse(packageLock).packages[""].license, JSON.parse(packageJson).license);
  assert.match(changelog, /^## \[Unreleased\]$/m);
  assert.match(changelog, /^## \[0\.1\.0\] - \d{4}-\d{2}-\d{2}$/m);
  // The privacy and security promises the extension actually makes.
  assert.match(privacy, /never calls the cookies API/i);
  assert.match(privacy, /not\*{0,2} encrypted/i);
  assert.match(privacy, /logical container assignments/i);
  assert.match(privacy, /native `cookieStoreId` values\s+stay on this computer/i);
  assert.match(privacy, /names, colors, and icons/i);
  assert.match(privacy, /does not read, write, or\s+delete that remote account data/i);
  assert.match(privacy, /no cloud-sync\s+feature/i);
  assert.doesNotMatch(readme, /^### Firefox Sync$/m);
  assert.doesNotMatch(readme, /Terminus Devices/);
  assert.doesNotMatch(privacy, /does not collect, transmit, or sell/i);
  assert.match(security, /do not open a public issue/i);
  // Every name the user sees belongs to Terminus.
  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.name, "Terminus");
  assert.equal(parsedManifest.short_name, "Terminus");
  // No user-facing surface carries a build suffix.
  assert.doesNotMatch(parsedManifest.name, /dev/i);
  assert.doesNotMatch(parsedManifest.short_name, /dev/i);
  // about:addons shows this line, so it describes the product, not the build.
  assert.equal(
    parsedManifest.description,
    "Organize your tabs into workspaces and switch between them from a compact sidebar rail."
  );
  assert.doesNotMatch(parsedManifest.description, /development|foundation/i);
  // The add-on ID is a stored identity, not a name Firefox shows. Changing it
  // makes Firefox treat this as a different extension and empties the profile's
  // storage, so it stays put until that cost is chosen deliberately.
  assert.equal(parsedManifest.browser_specific_settings.gecko.id, "terminus-dev@local.invalid");
  assert.equal(JSON.parse(packageJson).name, "terminus");
});

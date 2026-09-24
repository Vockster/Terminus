import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
const manifestPath = fileURLToPath(new URL("../../manifest.json", import.meta.url));

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  }));
  return nested.flat();
}

test("container support never calls the Firefox cookies API or adds host access", async () => {
  const files = await javascriptFiles(sourceRoot);
  const sources = await Promise.all(files.map((path) => readFile(path, "utf8")));
  assert.equal(
    sources.some((source) => /\b(?:browser|browserApi)\.cookies\b/.test(source)),
    false
  );

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.permissions.includes("contextualIdentities"), true);
  assert.deepEqual(manifest.optional_permissions, ["downloads", "cookies", "bookmarks"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
});

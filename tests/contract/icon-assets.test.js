import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTAINER_ICON_FALLBACK_ID,
  LOCAL_CONTAINER_ICON_IDS,
  containerIconAssetPath
} from "../../src/contracts/container-icons.js";
import { WORKSPACE_ICON_CATALOG } from "../../src/contracts/workspace-icons.js";

const ICON_DIRECTORY = new URL("../../src/assets/icons/", import.meta.url);
const ICON_PATH_PREFIX = "../assets/icons/";
const MOZILLA_REVISION = "023cb8315420edf23536fc0fde97d5717e72f5b1";
const MOZILLA_ICON_SOURCES = Object.freeze({
  "archive.svg": "toolkit/themes/shared/icons/folder.svg",
  "briefcase.svg": "browser/components/contextualidentity/content/briefcase.svg",
  "cart.svg": "browser/components/contextualidentity/content/cart.svg",
  "chill.svg": "browser/components/contextualidentity/content/chill.svg",
  "circle.svg": "browser/components/contextualidentity/content/circle.svg",
  "dollar.svg": "browser/components/contextualidentity/content/dollar.svg",
  "dropper.svg": "toolkit/themes/shared/icons/color-picker-20.svg",
  "favicon-group.svg": "toolkit/themes/shared/icons/folder.svg",
  "favicon-group-filled.svg": "toolkit/themes/shared/icons/folder.svg",
  "fence.svg": "browser/components/contextualidentity/content/fence.svg",
  "fingerprint.svg": "browser/components/contextualidentity/content/fingerprint.svg",
  "food.svg": "browser/components/contextualidentity/content/food.svg",
  "fruit.svg": "browser/components/contextualidentity/content/fruit.svg",
  "gift.svg": "browser/components/contextualidentity/content/gift.svg",
  "panel-config.svg": "toolkit/themes/shared/icons/settings.svg",
  "pet.svg": "browser/components/contextualidentity/content/pet.svg",
  "plus-thin.svg": "toolkit/themes/shared/icons/plus.svg",
  "private-window.svg": "browser/themes/shared/icons/privateBrowsing.svg",
  "settings.svg": "toolkit/themes/shared/icons/settings.svg",
  "snapshot.svg": "browser/themes/shared/icons/screenshot.svg",
  "stats.svg": "toolkit/themes/shared/icons/performance.svg",
  "refresh.svg": "browser/themes/shared/icons/sync.svg",
  "tree.svg": "browser/components/contextualidentity/content/tree.svg",
  "vacation.svg": "browser/components/contextualidentity/content/vacation.svg"
});
const TERMINUS_ORIGINAL_ICONS = Object.freeze([
  "app-sidebar.svg",
  "app.svg",
  "case-sensitive.svg",
  "star-filled.svg",
  "star.svg",
  "undo.svg"
]);
const LUCIDE_REVISION = "4aec3f892fd6c23063bc2fead83c899b5d412b1c";
const LUCIDE_ICONS = Object.freeze(["palette.svg"]);
const LUCIDE_WORKSPACE_REVISION = "5d592a96aaeb4a3a09ffd8134f8f5ed878c9a0c5";
const LUCIDE_UI_ICONS = Object.freeze({
  "search.svg": "53d152d48da4476e96224a7f1b4e89adc84afed7d8a12b2b82c0fb8a598a7e51"
});
const LUCIDE_WORKSPACE_ICONS = Object.freeze([
  "audio-lines", "book-a", "book-bookmark", "book-heart", "book-open", "book-open-text",
  "brick-wall-shield", "briefcase-business", "car", "circle-dollar-sign", "cross", "crown",
  "engine", "fingerprint-pattern", "gem", "glasses", "heart", "house", "image", "library-big",
  "mail", "notebook-pen", "package", "paw-print", "shield-cog-corner", "shield-keyhole",
  "shopping-cart", "shopping-cart-minus", "shopping-cart-plus", "star", "summary",
  "tickets-plane", "tree-palm", "trophy", "user", "users", "utensils-crossed", "van", "wallet",
  "wrench"
].map((id) => `workspace/${id}.svg`));
const RETAINED_PROVENANCE_ASSETS = new Set(["dropper.svg"]);
const HISTORICAL_SIDEBERY_BLOB_IDS = new Set([
  "059c31a0587b8560b4b2359bca4aeb4e7d1d8037",
  "0a641cdec9a95ec9d8a131ed469f223f1cc5a8b1",
  "1f9e8025871425701d1e006b3f23e277f314ccb4",
  "291a44832dcb501663b20153d90d776e8f4550af",
  "371a1a8a6ae33a7291817411e1f8b35abbe04724",
  "3d798127ac73988b667d0d8a5fc4a823ed05eb01",
  "3dc3a1334306aa687428a238f255e0bc0bbe6c05",
  "442471359a34199f4bfba7d34b84fb5f8c88d0a9",
  "4b24dafe65ceadbf448131664913d64de8a171f8",
  "5efa83444d051214aa93384525488d9c9dc02e41",
  "784c2e1cc2c6ece76d434a2e2ed05076671bf4ab",
  "8032176011a64f16cdd2479b073408795765ea9e",
  "84b6b203706396c36ee05cb521f4c752a0c2cb5b",
  "88cf5636d7b55e1467db9515f89531d5c8201e3f",
  "8c314c2a04caa6724b5bd92706ae573e8595365e",
  "9e30548cebf82ee4f7e6a24eceb6ac0ec251b2a4",
  "a94af96de63f440f34e4cdc4d82603e7b9f6f6a1",
  "b07e9b2ce9ff43ec4f59bd2ef8990f137dd54de4",
  "c98920ce0976d05c3d4bcf2c1c22a27c01c4e4ae",
  "cda528c199fe9c73557c22fb4340b19a6af95a0c",
  "db25b418d4200de1280c43dbbb5d30031fca4118",
  "dd6bb2d153ca0661445928b64421a366905c9081",
  "e79d7885d6ee287718b21dba02992b04d97cc363",
  "f415f5058ee19c4e4fc4d7da4ad79c99a7a635c6",
  "fcccc8d447c4f5514aa9ebeb74dabc6b4031ca49"
]);
const EXPECTED_ICONS = Object.freeze([
  ...Object.keys(MOZILLA_ICON_SOURCES),
  ...TERMINUS_ORIGINAL_ICONS,
  ...LUCIDE_ICONS,
  ...Object.keys(LUCIDE_UI_ICONS),
  ...LUCIDE_WORKSPACE_ICONS
].sort());

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(url));
    } else if (/\.(?:css|html|js)$/i.test(entry.name)) {
      files.push(url);
    }
  }
  return files;
}

async function packagedIcons() {
  const entries = await readdir(ICON_DIRECTORY, { withFileTypes: true });
  assert.deepEqual(
    entries.filter((entry) => entry.isDirectory()).map(({ name }) => name),
    ["workspace"]
  );
  const nested = (await readdir(new URL("workspace/", ICON_DIRECTORY)))
    .map((name) => `workspace/${name}`);
  return [
    ...entries.filter((entry) => entry.isFile()).map(({ name }) => name),
    ...nested
  ];
}

function iconAssetName(path) {
  assert.ok(path.startsWith(ICON_PATH_PREFIX), path);
  return path.slice(ICON_PATH_PREFIX.length);
}

function gitBlobId(content) {
  const header = Buffer.from(`blob ${content.byteLength}\0`);
  return createHash("sha1").update(header).update(content).digest("hex");
}

test("the icon directory contains exactly the live manifest, UI, container, and workspace assets", async () => {
  const actual = (await packagedIcons()).filter((name) => name.endsWith(".svg")).sort();
  assert.deepEqual(actual, EXPECTED_ICONS);
  assert.deepEqual((await packagedIcons()).filter((name) => /sidebery/i.test(name)), []);

  const referenced = new Set();
  const files = [new URL("../../manifest.json", import.meta.url), ...await sourceFiles(
    new URL("../../src/", import.meta.url)
  )];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(/assets\/icons\/((?:workspace\/)?[a-z0-9-]+\.svg)/g)) {
      referenced.add(match[1]);
    }
  }
  for (const icon of WORKSPACE_ICON_CATALOG) {
    referenced.add(iconAssetName(icon.path));
  }
  for (const iconId of [...LOCAL_CONTAINER_ICON_IDS, CONTAINER_ICON_FALLBACK_ID]) {
    referenced.add(iconAssetName(containerIconAssetPath(iconId)));
  }
  assert.deepEqual(
    [...referenced].sort(),
    EXPECTED_ICONS.filter((name) => !RETAINED_PROVENANCE_ASSETS.has(name))
  );
});

test("Mozilla-derived icons retain their MPL notice and pinned source provenance", async () => {
  for (const [name, sourcePath] of Object.entries(MOZILLA_ICON_SOURCES)) {
    const content = await readFile(new URL(name, ICON_DIRECTORY), "utf8");
    assert.match(content, /This Source Code Form is subject to the terms of the Mozilla Public/);
    assert.match(content, /mozilla\.org\/MPL\/2\.0/);
    assert.ok(content.includes(MOZILLA_REVISION));
    assert.ok(content.includes(sourcePath));
    assert.doesNotMatch(content, /-moz-pref|class="(?:nova|proton)"/);
  }
});

test("project-owned icons are explicit and every retained SVG is passive local markup", async () => {
  for (const name of EXPECTED_ICONS) {
    const bytes = await readFile(new URL(name, ICON_DIRECTORY));
    const content = bytes.toString("utf8");
    assert.match(content, /<svg\b/);
    assert.match(content, /<\/svg>\s*$/);
    assert.doesNotMatch(content, /<script\b|\son[a-z]+\s*=|\b(?:href|src)\s*=\s*["']https?:|url\(\s*["']?https?:/i);
    assert.doesNotMatch(content, /<(?:image|foreignObject)\b/i);
    assert.doesNotMatch(content, /sidebery/i);
    assert.equal(HISTORICAL_SIDEBERY_BLOB_IDS.has(gitBlobId(bytes)), false);
  }
  for (const name of TERMINUS_ORIGINAL_ICONS) {
    const content = await readFile(new URL(name, ICON_DIRECTORY), "utf8");
    assert.match(content, /Terminus original artwork/);
  }
});

test("the Lucide palette asset carries pinned ISC provenance", async () => {
  const content = await readFile(new URL("palette.svg", ICON_DIRECTORY), "utf8");
  const license = await readFile(new URL("LICENSE.lucide.txt", ICON_DIRECTORY), "utf8");
  for (const text of [content, license]) {
    assert.match(text, /ISC License/);
    assert.match(text, /Copyright \(c\) 2026 Lucide Icons and Contributors/);
    assert.ok(text.includes(LUCIDE_REVISION));
  }
  assert.match(content, /icons\/palette\.svg/);
  assert.match(content, /Supplied\/moved source SHA-256: d14265aa0e1a2c2211b7e4737bcc246c840217bc25b49ec35ac22ee978135877/);
  assert.doesNotMatch(content, /class=/);
  assert.match(content, /stroke="#000"/);
});

test("Lucide sidebar control icons carry supplied geometry provenance and mask paint", async () => {
  for (const [name, suppliedDigest] of Object.entries(LUCIDE_UI_ICONS)) {
    const content = await readFile(new URL(name, ICON_DIRECTORY), "utf8");
    assert.ok(content.includes(`Supplied/moved source SHA-256: ${suppliedDigest}\n`), name);
    assert.ok(
      content.includes(`lucide/blob/${LUCIDE_WORKSPACE_REVISION}/icons/${name}`),
      name
    );
    assert.match(content, /ISC License\n\s*Copyright \(c\) 2026 Lucide Icons and Contributors/);
    assert.match(content, /Full license: LICENSE\.lucide\.txt/);
    assert.doesNotMatch(content, /class=|currentColor/);
    assert.match(content, /stroke="#000"/);
  }
});

test("workspace icons carry pinned Lucide provenance, both license notices, and mask paint", async () => {
  const license = await readFile(new URL("LICENSE.lucide.txt", ICON_DIRECTORY), "utf8");
  assert.ok(license.includes(`lucide/blob/${LUCIDE_WORKSPACE_REVISION}/LICENSE`));
  assert.match(license, /The MIT License \(MIT\)/);
  assert.match(license, /Copyright \(c\) 2013-present Cole Bemis/);

  const labels = new Map(
    WORKSPACE_ICON_CATALOG.map(({ path, label }) => [iconAssetName(path), label])
  );
  for (const name of LUCIDE_WORKSPACE_ICONS) {
    const content = await readFile(new URL(name, ICON_DIRECTORY), "utf8");
    const sourceName = name.slice("workspace/".length);
    assert.ok(content.includes(`Lucide ${labels.get(name)} icon, user-supplied geometry.`), name);
    assert.match(content, /Supplied\/moved source SHA-256: [0-9a-f]{64}\n/);
    assert.ok(
      content.includes(`lucide/blob/${LUCIDE_WORKSPACE_REVISION}/icons/${sourceName}`),
      name
    );
    assert.match(content, /ISC License\n\s*Copyright \(c\) 2026 Lucide Icons and Contributors/);
    assert.match(content, /Feather-derived icons: MIT License, Copyright \(c\) 2013-present Cole Bemis/);
    assert.match(content, /Full license: \.\.\/LICENSE\.lucide\.txt/);
    assert.doesNotMatch(content, /class=|currentColor/);
    assert.match(content, /stroke="#000"/);
  }
});

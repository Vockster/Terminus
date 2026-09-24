import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  COPY_UNAVAILABLE_MESSAGE,
  COPY_VALUES,
  DOWNLOAD_FILENAME,
  DOWNLOAD_UNAVAILABLE_MESSAGE,
  OBJECT_URL_LIFETIME_MS,
  SHEET_PATH,
  copyText,
  downloadStylesheet
} from "../../src/settings/firefox-styling-panel.js";

const SHEET_URL = new URL(`../../${SHEET_PATH}`, import.meta.url);

function fakeUrlApi() {
  const created = [];
  const revoked = [];
  return {
    created,
    revoked,
    createObjectURL(blob) {
      const url = `blob:terminus/${created.length}`;
      created.push({ url, blob });
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };
}

function fakeScheduler() {
  const pending = [];
  const schedule = (callback, delay) => pending.push({ callback, delay });
  return { pending, schedule };
}

function okResponse(bytes) {
  const copy = new Uint8Array(bytes);
  return { ok: true, status: 200, arrayBuffer: async () => copy.buffer };
}

test("the sheet is the packaged original, saved as the one file Firefox reads", () => {
  assert.equal(SHEET_PATH, "userchrome/original.css");
  // Firefox loads only chrome/userChrome.css, and matches the name exactly.
  assert.equal(DOWNLOAD_FILENAME, "userChrome.css");
  assert.deepEqual({ ...COPY_VALUES }, {
    support: "about:support",
    config: "about:config",
    preference: "toolkit.legacyUserProfileCustomizations.stylesheets"
  });
});

test("downloading saves the packaged sheet's exact bytes as userChrome.css", async () => {
  const source = await readFile(SHEET_URL);
  const urlApi = fakeUrlApi();
  const scheduler = fakeScheduler();
  const requested = [];
  const saved = [];

  const result = await downloadStylesheet({
    getUrl: (path) => `moz-extension://terminus/${path}`,
    fetchImpl: async (url) => {
      requested.push(url);
      return okResponse(source);
    },
    save: (href, filename) => saved.push({ href, filename }),
    urlApi,
    BlobType: Blob,
    schedule: scheduler.schedule
  });

  assert.deepEqual(requested, ["moz-extension://terminus/userchrome/original.css"]);
  assert.deepEqual(saved, [{ href: "blob:terminus/0", filename: "userChrome.css" }]);
  assert.equal(result.filename, DOWNLOAD_FILENAME);
  const blob = urlApi.created[0].blob;
  assert.equal(blob.type, "text/css");
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), source);
  assert.equal(result.byteLength, source.byteLength);

  // The object URL outlives the click, then is released.
  assert.deepEqual(urlApi.revoked, []);
  assert.equal(scheduler.pending.length, 1);
  assert.equal(scheduler.pending[0].delay, OBJECT_URL_LIFETIME_MS);
  scheduler.pending[0].callback();
  assert.deepEqual(urlApi.revoked, ["blob:terminus/0"]);
});

test("a sheet missing from the package reports a plain reason and saves nothing", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
    async () => {
      throw new TypeError("NetworkError when attempting to fetch resource.");
    }
  ]) {
    const urlApi = fakeUrlApi();
    const saved = [];
    await assert.rejects(
      downloadStylesheet({
        getUrl: (path) => path,
        fetchImpl,
        save: (href, filename) => saved.push({ href, filename }),
        urlApi,
        BlobType: Blob,
        schedule: () => assert.fail("nothing to release")
      }),
      (error) => error.message === DOWNLOAD_UNAVAILABLE_MESSAGE
    );
    assert.deepEqual(saved, []);
    assert.deepEqual(urlApi.created, []);
  }
});

test("a save that throws releases its object URL at once", async () => {
  const urlApi = fakeUrlApi();
  await assert.rejects(
    downloadStylesheet({
      getUrl: (path) => path,
      fetchImpl: async () => okResponse(new TextEncoder().encode("#sidebar-panel-header { display: none !important; }")),
      save: () => {
        throw new Error("blocked");
      },
      urlApi,
      BlobType: Blob,
      schedule: () => assert.fail("already released")
    }),
    /blocked/
  );
  assert.deepEqual(urlApi.revoked, ["blob:terminus/0"]);
});

test("copying writes the exact text, and a refused or missing clipboard is reported", async () => {
  const written = [];
  await copyText(COPY_VALUES.preference, { writeText: async (value) => written.push(value) });
  assert.deepEqual(written, ["toolkit.legacyUserProfileCustomizations.stylesheets"]);

  await assert.rejects(
    copyText(COPY_VALUES.support, { writeText: async () => {
      throw new DOMException("Clipboard write was blocked", "NotAllowedError");
    } }),
    (error) => error.message === COPY_UNAVAILABLE_MESSAGE
  );
  await assert.rejects(
    copyText(COPY_VALUES.config, undefined),
    (error) => error.message === COPY_UNAVAILABLE_MESSAGE
  );
});

test("the packaged sheet hides exactly one interface element and needs no other file", async () => {
  const source = await readFile(SHEET_URL, "utf8");
  const rules = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
  assert.equal(rules, "#sidebar-panel-header{display:none!important;}");
  // One file is the whole install: no assets, imports or other requirements.
  assert.doesNotMatch(rules, /url\(|@import|@charset|@namespace/);
  // The file is the rule and nothing else; Settings carries the instructions.
  assert.equal(
    source.replace(/\r\n/g, "\n"),
    "/* No sidebar panel header. */\n#sidebar-panel-header {\n  display: none !important;\n}\n"
  );
});

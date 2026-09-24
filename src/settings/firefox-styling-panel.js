// Offers the optional userChrome.css sheet packaged with Terminus. Terminus
// never reads, detects, or depends on a copy installed in a Firefox profile, so
// this panel shows no installed state and changes no setting.

export const SHEET_PATH = "userchrome/original.css";
// Saved under the one name Firefox reads, so a first install is a single file
// dropped into the profile's chrome folder.
export const DOWNLOAD_FILENAME = "userChrome.css";

export const COPY_VALUES = Object.freeze({
  support: "about:support",
  config: "about:config",
  preference: "toolkit.legacyUserProfileCustomizations.stylesheets"
});

// Firefox starts an anchor download after click() returns, so revoking the
// object URL at once can cancel it. The sheet is a few kilobytes; holding it
// briefly costs nothing.
export const OBJECT_URL_LIFETIME_MS = 40_000;

// How long a Copy button reads "Copied" before it returns to "Copy".
export const COPIED_LABEL_MS = 2_000;

export const DOWNLOAD_UNAVAILABLE_MESSAGE =
  "Terminus couldn't read its style sheet. Reinstalling Terminus should restore it.";
export const COPY_UNAVAILABLE_MESSAGE =
  "Couldn't copy. Select the text and copy it instead.";

export async function downloadStylesheet({
  getUrl,
  fetchImpl,
  save,
  urlApi = globalThis.URL,
  BlobType = globalThis.Blob,
  schedule = globalThis.setTimeout
}) {
  // The packaged bytes pass through untouched, so the saved file is the
  // shipped file exactly, whatever its encoding.
  let bytes;
  try {
    const response = await fetchImpl(getUrl(SHEET_PATH));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    bytes = await response.arrayBuffer();
  } catch {
    throw new Error(DOWNLOAD_UNAVAILABLE_MESSAGE);
  }
  const objectUrl = urlApi.createObjectURL(new BlobType([bytes], { type: "text/css" }));
  try {
    save(objectUrl, DOWNLOAD_FILENAME);
  } catch (error) {
    urlApi.revokeObjectURL(objectUrl);
    throw error;
  }
  schedule(() => urlApi.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS);
  return { filename: DOWNLOAD_FILENAME, byteLength: bytes.byteLength };
}

export async function copyText(value, clipboard) {
  if (typeof clipboard?.writeText !== "function") {
    throw new Error(COPY_UNAVAILABLE_MESSAGE);
  }
  try {
    await clipboard.writeText(value);
  } catch {
    throw new Error(COPY_UNAVAILABLE_MESSAGE);
  }
}

export function createFirefoxStylingPanel({
  documentRef = globalThis.document,
  getUrl = (path) => browser.runtime.getURL(path),
  fetchImpl = (url) => globalThis.fetch(url),
  clipboard = globalThis.navigator?.clipboard
} = {}) {
  const panel = documentRef.querySelector("#firefox-styling-panel");
  const downloadButton = documentRef.querySelector("#firefox-styling-download");
  const downloadStatus = documentRef.querySelector("#firefox-styling-status");
  // The Copy buttons sit in the steps, far below the download, so their
  // results are announced in the install card rather than beside the download.
  const copyStatus = documentRef.querySelector("#firefox-styling-copy-status");
  const copiedTimers = new Map();
  let busy = false;

  function report(status, message, variant = "quiet") {
    status.textContent = message;
    status.hidden = variant === "quiet";
    if (["error", "success"].includes(variant)) status.dataset.variant = variant;
    else delete status.dataset.variant;
  }

  function showCopied(button) {
    clearTimeout(copiedTimers.get(button));
    button.textContent = "Copied";
    copiedTimers.set(button, setTimeout(() => {
      button.textContent = "Copy";
      copiedTimers.delete(button);
    }, COPIED_LABEL_MS));
  }

  // An attached anchor is the one form every supported Firefox honours for a
  // download; it is removed again straight after the click.
  function save(href, filename) {
    const anchor = documentRef.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.hidden = true;
    documentRef.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  }

  downloadButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    downloadButton.disabled = true;
    try {
      await downloadStylesheet({ getUrl, fetchImpl, save });
      report(
        downloadStatus,
        `Downloading ${DOWNLOAD_FILENAME}. Nothing changes until you install it below.`,
        "success"
      );
    } catch (error) {
      report(downloadStatus, error.message, "error");
    } finally {
      busy = false;
      downloadButton.disabled = false;
    }
  });

  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-copy]");
    if (!button) return;
    const value = button.dataset.copy;
    try {
      await copyText(value, clipboard);
      showCopied(button);
      report(copyStatus, `Copied ${value}.`, "success");
    } catch (error) {
      report(copyStatus, error.message, "error");
    }
  });

  return Object.freeze({
    clearTransientMessages() {
      report(downloadStatus, "");
      report(copyStatus, "");
    }
  });
}

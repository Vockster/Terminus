import { WORKSPACE_PACKAGE_IMPORT_MODES } from "../contracts/workspace-package.js";

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describe(preview) {
  const parts = [
    `${countLabel(preview.workspaceCount, "workspace", "workspaces")} in this file.`
  ];
  const { reusable, new: fresh, damaged } = preview.icons;
  if (fresh > 0) {
    parts.push(`${countLabel(fresh, "custom icon", "custom icons")} will be added.`);
  }
  if (reusable > 0) {
    parts.push(
      `${countLabel(reusable, "custom icon", "custom icons")} you already have will be reused.`
    );
  }
  if (fresh === 0 && reusable === 0 && damaged.length === 0) {
    parts.push("It carries no custom icons.");
  }
  return parts.join(" ");
}

function describeDamaged(damaged) {
  if (damaged.length === 0) return "";
  const names = damaged
    .map(({ label }) => label)
    .filter((label) => typeof label === "string" && label.length > 0);
  const detail = names.length > 0 ? ` (${names.join(", ")})` : "";
  return `${countLabel(damaged.length, "icon", "icons")} could not be read${detail}. ` +
    "Any workspace using one arrives with the House icon.";
}

function describeDamagedOriginals(damagedOriginals = []) {
  if (damagedOriginals.length === 0) return "";
  return `${countLabel(
    damagedOriginals.length,
    "original icon file",
    "original icon files"
  )} could not be retained. The normalized ${damagedOriginals.length === 1 ? "icon is" : "icons are"} still usable.`;
}

export function createWorkspacePackageView({
  client,
  setStatus,
  onImported = () => undefined,
  root = document
}) {
  const card = root.getElementById("workspace-package-card");
  if (!card) return { destroy() {} };

  const exportButton = root.getElementById("export-workspace-package");
  const importButton = root.getElementById("import-workspace-package");
  const fileInput = root.getElementById("workspace-package-file");
  const status = root.getElementById("workspace-package-status");
  const dialog = root.getElementById("workspace-package-dialog");
  const form = root.getElementById("workspace-package-form");
  const summary = root.getElementById("workspace-package-summary");
  const damagedNote = root.getElementById("workspace-package-damaged");
  const addMode = root.getElementById("workspace-package-mode-add");
  const replaceMode = root.getElementById("workspace-package-mode-replace");
  const replaceConfirmation = root.getElementById("workspace-package-replace-confirmation");
  const replaceWarning = root.getElementById("workspace-package-replace-warning");
  const replaceAcknowledged = root.getElementById("workspace-package-replace-acknowledged");
  const cancelButton = root.getElementById("cancel-workspace-package");
  const confirmButton = root.getElementById("confirm-workspace-package");

  let pending = null;

  function report(message, { error = false } = {}) {
    status.textContent = message;
    status.hidden = message.length === 0;
    if (message.length > 0) setStatus?.(message, error ? "error" : "quiet");
  }

  function selectedMode() {
    return replaceMode.checked
      ? WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE
      : WORKSPACE_PACKAGE_IMPORT_MODES.ADD;
  }

  function refreshModeUi() {
    const replacing = selectedMode() === WORKSPACE_PACKAGE_IMPORT_MODES.REPLACE;
    replaceConfirmation.hidden = !replacing;
    confirmButton.textContent = replacing ? "Replace workspaces" : "Import";
    confirmButton.classList.toggle("is-danger", replacing);
    // Replace is the one destructive choice here, so it is never one click.
    confirmButton.disabled = replacing && !replaceAcknowledged.checked;
  }

  function closeDialog() {
    pending = null;
    replaceAcknowledged.checked = false;
    addMode.checked = true;
    refreshModeUi();
    if (dialog.open) dialog.close();
  }

  async function runExport() {
    exportButton.disabled = true;
    report("Saving your workspace setup…");
    try {
      // permissions.request needs the click that is still on the stack, so the
      // optional downloads grant is asked for here rather than in the
      // background where the file is actually written.
      const granted = await client.requestDownloadsPermission();
      if (!granted) {
        throw new Error("Allow Downloads access to save files.");
      }
      const { filename } = await client.exportSetup();
      report(`Saved ${filename}.`);
    } catch (error) {
      report(error.message, { error: true });
    } finally {
      exportButton.disabled = false;
    }
  }

  async function readChosenFile(file) {
    importButton.disabled = true;
    report("Reading that file…");
    try {
      const { document: workspacePackage, preview } = await client.readFile(file);
      pending = { document: workspacePackage, preview };
      summary.textContent = describe(preview);
      const damagedText = [
        describeDamaged(preview.icons.damaged),
        describeDamagedOriginals(preview.icons.damagedOriginals)
      ].filter(Boolean).join(" ");
      damagedNote.textContent = damagedText;
      damagedNote.hidden = damagedText.length === 0;
      replaceWarning.textContent =
        "Tabs follow a matching workspace one-to-one. Current workspaces that cannot be " +
        "matched safely stay separate after the imported setup. No tab is closed.";
      report("");
      addMode.checked = true;
      replaceAcknowledged.checked = false;
      refreshModeUi();
      dialog.showModal();
    } catch (error) {
      report(error.message, { error: true });
    } finally {
      importButton.disabled = false;
    }
  }

  async function runImport(event) {
    event.preventDefault();
    if (!pending) return;
    const mode = selectedMode();
    const { document: workspacePackage, preview } = pending;
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    try {
      const outcome = await client.importSetup(workspacePackage, mode);
      closeDialog();
      const damagedText = describeDamaged(outcome.icons.damaged);
      const damagedOriginalsText = describeDamagedOriginals(preview.icons.damagedOriginals);
      const retainedText = outcome.retainedWorkspaceCount > 0
        ? ` Kept ${countLabel(
          outcome.retainedWorkspaceCount,
          "unmatched current workspace",
          "unmatched current workspaces"
        )} separate.`
        : "";
      report(
        `Imported ${countLabel(outcome.workspaceCount, "workspace", "workspaces")}.` +
          retainedText +
          (damagedText ? ` ${damagedText}` : "") +
          (damagedOriginalsText ? ` ${damagedOriginalsText}` : "")
      );
      onImported();
    } catch (error) {
      closeDialog();
      report(error.message, { error: true });
    } finally {
      cancelButton.disabled = false;
      refreshModeUi();
    }
  }

  function onFileChosen() {
    const [file] = fileInput.files ?? [];
    fileInput.value = "";
    if (file) void readChosenFile(file);
  }

  exportButton.addEventListener("click", () => void runExport());
  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", onFileChosen);
  addMode.addEventListener("change", refreshModeUi);
  replaceMode.addEventListener("change", refreshModeUi);
  replaceAcknowledged.addEventListener("change", refreshModeUi);
  cancelButton.addEventListener("click", closeDialog);
  form.addEventListener("submit", (event) => void runImport(event));

  refreshModeUi();

  return {
    destroy() {
      closeDialog();
    }
  };
}

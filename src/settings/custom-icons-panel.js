import {
  CUSTOM_ICON_ERROR_CODES,
  CUSTOM_ICON_FILE_ACCEPT,
  CUSTOM_ICON_LIMITS,
  CUSTOM_ICON_SOURCE_MIME_TYPES,
  customIconLabelFromFileName
} from "../contracts/custom-icons.js";
import { formatStorageBytes } from "./storage-panel.js";

function counted(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// The original travels with the icon only while it stays small and its type is
// one Terminus is willing to hand back. Anything else keeps the normalized PNG
// alone, which is exactly what every icon added before this did.
export async function readRetainableSource(file) {
  const mimeType = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  if (
    !CUSTOM_ICON_SOURCE_MIME_TYPES.includes(mimeType) ||
    typeof file.size !== "number" ||
    file.size === 0 ||
    file.size > CUSTOM_ICON_LIMITS.maxSourceBytes
  ) {
    return null;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > CUSTOM_ICON_LIMITS.maxSourceBytes) {
      return null;
    }
    return { mimeType, byteLength: bytes.byteLength, bytes };
  } catch {
    // An unreadable original is not a reason to reject the icon itself.
    return null;
  }
}

export function summarizeCustomIconAdds({ added, duplicates, rejected, limitReached }) {
  const parts = [];
  if (added > 0) parts.push(`${counted(added, "icon")} added.`);
  if (duplicates > 0) {
    parts.push(`${counted(duplicates, "icon")} ${duplicates === 1 ? "was" : "were"} already added.`);
  }
  for (const { name, message } of rejected) parts.push(`Could not add “${name}”: ${message}`);
  if (limitReached) {
    parts.push(`The limit of ${CUSTOM_ICON_LIMITS.maxIcons} custom icons was reached. Remove one to add another.`);
  }
  return parts.length > 0 ? parts.join(" ") : "No icons were added.";
}

export function customIconUsageText(iconCount, byteCount) {
  const tip = "transparent backgrounds work best";
  return iconCount > 0 && Number.isSafeInteger(byteCount)
    ? `${formatStorageBytes(byteCount)} · ${tip}`
    : `${tip[0].toUpperCase()}${tip.slice(1)}`;
}

export function removalWarning(workspaceCount) {
  return workspaceCount === 1
    ? "1 workspace uses this icon. It will switch to House."
    : `${workspaceCount} workspaces use this icon. They will switch to House.`;
}

export function createCustomIconsPanel({
  client,
  workspaceClient,
  normalizer,
  iconUrls,
  onLibraryChanged = () => {}
}) {
  const addButton = document.querySelector("#add-custom-icons");
  const fileInput = document.querySelector("#custom-icon-file");
  const count = document.querySelector("#custom-icon-count");
  const usage = document.querySelector("#custom-icon-usage");
  const library = document.querySelector("#custom-icon-library");
  const status = document.querySelector("#custom-icon-status");
  const removeDialog = document.querySelector("#remove-custom-icon-dialog");
  const removeForm = document.querySelector("#remove-custom-icon-form");
  const removeDetails = document.querySelector("#remove-custom-icon-details");
  const cancelRemoval = document.querySelector("#cancel-custom-icon-removal");
  let busy = false;
  let pendingRemoval = null;
  let byteCount = null;
  let refreshGeneration = 0;

  fileInput.accept = CUSTOM_ICON_FILE_ACCEPT;

  function report(message, variant = "status") {
    status.textContent = message;
    status.hidden = message === "";
    if (variant === "error" || variant === "success") status.dataset.variant = variant;
    else delete status.dataset.variant;
  }

  function setBusy(value) {
    busy = value;
    addButton.disabled = value;
    for (const button of library.querySelectorAll("button")) button.disabled = value;
  }

  function render() {
    const icons = iconUrls.list();
    count.textContent = `${icons.length} of ${CUSTOM_ICON_LIMITS.maxIcons}`;
    usage.textContent = customIconUsageText(icons.length, byteCount);
    library.replaceChildren(...icons.map((icon) => {
      const item = document.createElement("li");
      item.className = "custom-icon-item";
      const image = document.createElement("img");
      image.className = "custom-icon-image";
      image.alt = "";
      image.draggable = false;
      image.src = icon.url;
      const label = document.createElement("span");
      label.className = "custom-icon-label";
      label.textContent = icon.label;
      label.title = icon.label;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "custom-icon-remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${icon.label}`);
      remove.disabled = busy;
      remove.addEventListener("click", () => void requestRemoval(icon));
      item.append(image, label, remove);
      return item;
    }));
    library.hidden = icons.length === 0;
  }

  // A failed load keeps the icons already shown and reports the problem.
  async function refresh() {
    const generation = ++refreshGeneration;
    try {
      const listed = await client.list();
      if (generation !== refreshGeneration) return;
      iconUrls.replace(listed.icons);
      byteCount = listed.usage.byteCount;
    } catch (error) {
      if (generation !== refreshGeneration) return;
      report(error.message, "error");
    }
    render();
    onLibraryChanged();
  }

  async function addFiles(files) {
    if (busy || files.length === 0) return;
    setBusy(true);
    report(`Adding ${counted(files.length, "image")}…`);
    const outcome = { added: 0, duplicates: 0, rejected: [], limitReached: false };
    try {
      for (const file of files) {
        try {
          const bytes = await normalizer.normalize(file);
          // The file itself is kept beside the normalized PNG when it is small
          // and of a listed type, so a workspace package can hand it back.
          const source = await readRetainableSource(file);
          const result = await client.add(
            customIconLabelFromFileName(file.name),
            bytes,
            source
          );
          if (result.duplicate) outcome.duplicates += 1;
          else outcome.added += 1;
        } catch (error) {
          if (error?.code === CUSTOM_ICON_ERROR_CODES.LIMIT_REACHED) {
            outcome.limitReached = true;
            break;
          }
          outcome.rejected.push({ name: file.name, message: error.message });
        }
      }
    } finally {
      setBusy(false);
      await refresh();
    }
    report(
      summarizeCustomIconAdds(outcome),
      outcome.rejected.length > 0 || outcome.limitReached ? "error" : "success"
    );
  }

  async function performRemoval(icon) {
    setBusy(true);
    report(`Removing ${icon.label}…`);
    try {
      const { reassignedWorkspaceCount } = await client.remove(icon.id);
      report(
        reassignedWorkspaceCount > 0
          ? `${icon.label} was removed. ${counted(reassignedWorkspaceCount, "workspace")} now ${reassignedWorkspaceCount === 1 ? "shows" : "show"} House.`
          : `${icon.label} was removed.`,
        "success"
      );
    } catch (error) {
      report(error.message, "error");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function requestRemoval(icon) {
    if (busy) return;
    let workspaceCount;
    try {
      const state = await workspaceClient.get();
      workspaceCount = state.workspaces.filter((workspace) => workspace.icon === icon.id).length;
    } catch (error) {
      report(error.message, "error");
      return;
    }
    if (workspaceCount === 0) {
      await performRemoval(icon);
      return;
    }
    pendingRemoval = icon;
    removeDetails.textContent = removalWarning(workspaceCount);
    removeDialog.showModal();
  }

  addButton.addEventListener("click", () => {
    if (!busy) fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    void addFiles(files);
  });
  removeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const icon = pendingRemoval;
    removeDialog.close();
    if (icon) void performRemoval(icon);
  });
  cancelRemoval.addEventListener("click", () => removeDialog.close());
  removeDialog.addEventListener("close", () => {
    pendingRemoval = null;
  });

  render();
  return Object.freeze({ refresh });
}

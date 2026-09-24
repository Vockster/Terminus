import {
  WORKSPACE_ICON_CATALOG,
  resolveWorkspaceIcon
} from "../contracts/workspace-icons.js";
import {
  presentWorkspaceIcon,
  workspaceIconLabel
} from "../ui/workspace-icon-presentation.js";
import {
  WORKSPACE_DIVIDER_SIZE_LIMITS,
  parseWorkspaceState
} from "../contracts/workspace-state.js";
import { containerIconAssetPath } from "../contracts/container-icons.js";
import { uniqueAvailableContainerEntries } from "../contracts/containers.js";
import { NEW_WORKSPACE_FIELDS } from "../core/workspace-defaults.js";
import { readableForeground } from "../ui/appearance.js";
import {
  planRemovalIntoFirstWorkspace,
  railEntryLocator,
  railEntryMatches
} from "../contracts/workspace-rail-batch.js";
import {
  clearSelection,
  createRailSelection,
  extendSelection,
  isSelected,
  orderedMembers,
  pruneSelection,
  railEntryKey,
  selectOnly,
  selectedWorkspaceIds,
  selectionKinds,
  selectionSize,
  toggleSelection
} from "./rail-selection.js";

export function createWorkspacesPanel({
  client,
  containerClient,
  setStatus,
  colorPanel,
  customIconUrls = null
}) {
  const editor = document.querySelector("#workspace-editor");
  const railPreview = document.querySelector("#rail-preview");
  const railInspector = document.querySelector("#rail-inspector");
  const railSelectionStatus = document.querySelector("#rail-selection-status");
  const createButton = document.querySelector("#create-workspace");
  const addDividerButton = document.querySelector("#add-divider");
  const addSpaceButton = document.querySelector("#add-space");
  const removalUndo = document.querySelector("#workspace-removal-undo");
  const removalUndoText = document.querySelector("#workspace-removal-undo-text");
  const removalUndoButton = document.querySelector("#workspace-removal-undo-button");
  const enableContainerSupport = document.querySelector("#enable-container-support");
  const containerSupportPill = document.querySelector("#container-support-pill");
  const containerSupportStatus = document.querySelector("#container-support-status");
  const createContainerDialog = document.querySelector("#create-container-dialog");
  const createContainerForm = document.querySelector("#create-container-form");
  const createContainerHeading = document.querySelector("#create-container-heading");
  const createContainerName = document.querySelector("#create-container-name");
  const createContainerColor = document.querySelector("#create-container-color");
  const createContainerIcon = document.querySelector("#create-container-icon");
  const createContainerStatus = document.querySelector("#create-container-status");
  const submitCreateContainer = document.querySelector("#submit-create-container");
  const cancelCreateContainer = document.querySelector("#cancel-create-container");
  let state;
  let containers = {
    capability: "permission-required",
    containers: [],
    supportedColors: [],
    supportedIcons: [],
    supportedColorOptions: [],
    supportedIconOptions: []
  };
  let busy = false;
  let dragSession = null;
  // Keys, not elements: a whole-state re-render keeps the selection, and keys
  // for entries that no longer exist are pruned rather than silently
  // re-selecting whatever later occupies the same position.
  let selection = createRailSelection();
  // Copy holds ids for the life of the page only: no storage, no clipboard
  // API, nothing that leaves the page.
  let copiedWorkspaceIds = [];
  let iconGridSequence = 0;
  // The Undo this page's own last removal created, while the window's one
  // slot still holds it.
  let removalUndoId = null;
  let createContainerWorkspaceId = null;
  let recreateContainerRefId = null;
  let selectedContainerColor = null;
  let selectedContainerIcon = null;
  let containerCreationBusy = false;

  const DRAG_THRESHOLD_PX = 5;

  function clearDragPresentation() {
    editor.querySelector(".is-dragging")?.classList.remove("is-dragging");
    for (const row of editor.querySelectorAll("[data-drop-position]")) {
      row.removeAttribute("data-drop-position");
    }
    editor.removeAttribute("data-dragging");
  }

  function cancelActiveDrag() {
    const activeDrag = dragSession;
    dragSession = null;
    if (activeDrag?.captureTarget.hasPointerCapture(activeDrag.pointerId)) {
      activeDrag.captureTarget.releasePointerCapture(activeDrag.pointerId);
    }
    clearDragPresentation();
  }

  function updateDragTarget(event) {
    if (!dragSession || event.pointerId !== dragSession.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragSession.originX,
      event.clientY - dragSession.originY
    );
    if (!dragSession.active && distance < DRAG_THRESHOLD_PX) {
      return;
    }
    if (!dragSession.active) {
      dragSession.active = true;
      dragSession.sourceRow.classList.add("is-dragging");
      editor.setAttribute("data-dragging", "true");
    }

    event.preventDefault();
    dragSession.targetRow?.removeAttribute("data-drop-position");
    dragSession.targetRow = null;
    dragSession.position = null;

    const candidate = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(".rail-preview-row");
    if (!candidate || !editor.contains(candidate) || candidate === dragSession.sourceRow) {
      return;
    }

    const bounds = candidate.getBoundingClientRect();
    dragSession.position = event.clientY < bounds.top + bounds.height / 2
      ? "before"
      : "after";
    dragSession.targetRow = candidate;
    candidate.dataset.dropPosition = dragSession.position;
  }

  function finishDrag(event, canceled = false) {
    if (!dragSession || event.pointerId !== dragSession.pointerId) {
      return;
    }

    const completedDrag = dragSession;
    dragSession = null;
    if (completedDrag.captureTarget.hasPointerCapture(event.pointerId)) {
      completedDrag.captureTarget.releasePointerCapture(event.pointerId);
    }
    clearDragPresentation();

    if (
      canceled ||
      !completedDrag.active ||
      !completedDrag.targetRow ||
      !completedDrag.position
    ) {
      return;
    }

    const target = {
      kind: completedDrag.targetRow.dataset.railKind,
      id: completedDrag.targetRow.dataset.railId
    };
    const members = selectionLocators();
    const carriesSelection =
      members.length > 1 &&
      members.some((member) => locatorKey(member) === locatorKey(completedDrag.entry)) &&
      !members.some((member) => locatorKey(member) === locatorKey(target));
    void runMutation(
      () => carriesSelection
        ? client.placeMany(members, target, completedDrag.position)
        : client.place(completedDrag.entry, target, completedDrag.position),
      carriesSelection ? "Moving rail entries…" : "Moving rail entry…",
      "Rail order saved."
    );
  }

  const locatorKey = ({ kind, id }) => `${kind}:${id}`;

  function selectionLocators() {
    return state ? orderedMembers(selection, state.rail) : [];
  }

  function setSelection(next) {
    if (next === selection) {
      return;
    }
    selection = next;
    renderSelection();
  }

  // A selection reorders by landing beside the nearest entry outside itself, so
  // Alt+Arrow keeps working when several entries are selected.
  function selectionMoveTarget(direction) {
    const members = selectionLocators();
    if (members.length === 0 || !state) {
      return null;
    }
    const indexes = members
      .map((member) => state.rail.findIndex((entry) => railEntryMatches(entry, member)))
      .filter((index) => index >= 0);
    if (indexes.length === 0) {
      return null;
    }
    const occupied = new Set(indexes);
    if (direction === "up") {
      let index = Math.min(...indexes) - 1;
      while (index >= 0 && occupied.has(index)) index -= 1;
      if (index < 0) return null;
      return { target: railEntryLocator(state.rail[index]), position: "before" };
    }
    let index = Math.max(...indexes) + 1;
    while (index < state.rail.length && occupied.has(index)) index += 1;
    if (index >= state.rail.length) return null;
    return { target: railEntryLocator(state.rail[index]), position: "after" };
  }

  function isInteractiveDragTarget(target) {
    return target instanceof Element && Boolean(
      target.closest("button, input, select, textarea, summary, details, label, a")
    );
  }

  function attachRowDrag(row, entry, label, index) {
    row.dataset.railKind = entry.kind;
    row.dataset.railId = entry.id;
    row.tabIndex = 0;
    row.setAttribute(
      "aria-label",
      `${label} rail entry. Drag this row or press Alt+Up or Alt+Down to reorder.`
    );
    row.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");

    const handle = document.createElement("span");
    handle.className = "rail-drag-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.title = `Drag ${label} row to reorder.`;
    handle.textContent = "⠿";
    row.addEventListener("pointerdown", (event) => {
      if (
        busy ||
        dragSession ||
        isInteractiveDragTarget(event.target) ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }
      event.preventDefault();
      row.focus({ preventScroll: true });
      row.setPointerCapture(event.pointerId);
      dragSession = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        active: false,
        sourceRow: row,
        targetRow: null,
        position: null,
        entry,
        captureTarget: row
      };
    });
    row.addEventListener("pointermove", updateDragTarget);
    row.addEventListener("pointerup", (event) => finishDrag(event));
    row.addEventListener("pointercancel", (event) => finishDrag(event, true));
    row.addEventListener("click", (event) => {
      if (busy || isInteractiveDragTarget(event.target)) {
        return;
      }
      const key = locatorKey(entry);
      if (event.shiftKey) {
        setSelection(extendSelection(selection, key, state.rail));
      } else if (event.ctrlKey || event.metaKey) {
        setSelection(toggleSelection(selection, key));
      } else {
        setSelection(selectOnly(selection, key));
      }
    });
    row.addEventListener("keydown", (event) => {
      if (busy || event.target !== row) {
        return;
      }
      const key = locatorKey(entry);
      if (!event.altKey) {
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          deleteSelection();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && (event.key === "c" || event.key === "C")) {
          event.preventDefault();
          copySelection();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && (event.key === "v" || event.key === "V")) {
          event.preventDefault();
          pasteSelection();
          return;
        }
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          setSelection(
            event.shiftKey
              ? extendSelection(selection, key, state.rail)
              : toggleSelection(selection, key)
          );
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSelection(clearSelection());
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const step = event.key === "ArrowUp" ? -1 : 1;
          const rows = [...railPreview.querySelectorAll(".rail-preview-row")];
          const next = rows[rows.indexOf(row) + step];
          if (!next) {
            return;
          }
          event.preventDefault();
          next.focus({ preventScroll: true });
          setSelection(
            event.shiftKey
              ? extendSelection(selection, next.dataset.railKey, state.rail)
              : selectOnly(selection, next.dataset.railKey)
          );
        }
        return;
      }

      const direction = event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowDown"
          ? "down"
          : null;
      if (!direction) {
        return;
      }
      // Alt+Arrow reorders. With several entries selected the whole block
      // moves, landing beside the nearest entry outside the selection.
      const members = selectionLocators();
      if (members.length > 1 && members.some((member) => locatorKey(member) === key)) {
        const placement = selectionMoveTarget(direction);
        if (!placement) {
          return;
        }
        event.preventDefault();
        void runMutation(
          () => client.placeMany(members, placement.target, placement.position),
          "Moving rail entries…",
          "Rail order saved."
        );
        return;
      }
      if (
        (direction === "up" && index === 0) ||
        (direction === "down" && index === state.rail.length - 1)
      ) {
        return;
      }
      event.preventDefault();
      void runMutation(
        () => client.move(entry, direction),
        "Moving rail entry…",
        "Rail order saved."
      );
    });
    return handle;
  }

  function iconPreview(iconId, color) {
    const presentation = presentWorkspaceIcon(iconId, customIconUrls);
    if (presentation.kind === "image") {
      const image = document.createElement("img");
      image.className = "workspace-icon-preview workspace-icon-preview--image";
      image.alt = "";
      image.draggable = false;
      image.src = presentation.url;
      return image;
    }
    const preview = document.createElement("span");
    preview.className = "workspace-icon-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.style.setProperty("--icon-mask", `url("${presentation.path}")`);
    preview.style.setProperty("--icon-scale", String(presentation.opticalScale));
    preview.style.setProperty("--icon-color", color);
    return preview;
  }

  function workspaceChip(workspace) {
    const chip = document.createElement("span");
    chip.className = "rail-chip";
    chip.setAttribute("aria-hidden", "true");
    chip.style.setProperty("--chip-color", workspace.color);
    // A white workspace colour is the default, so the icon takes whichever of
    // black or white reads on the chip rather than always white.
    chip.append(iconPreview(workspace.icon, readableForeground(workspace.color)));
    return chip;
  }

  // The icon choices shared by one workspace and a selection: the catalog,
  // then the custom library on its own line.
  function iconChoiceGrid(choose, isPressed, labelFor) {
    const iconGrid = document.createElement("div");
    iconGrid.className = "rail-shared-icons";
    const appendChoice = (iconId, label, parent) => {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "icon-choice";
      choice.title = label;
      choice.setAttribute("aria-label", labelFor(label));
      choice.setAttribute("aria-pressed", String(isPressed(iconId)));
      choice.append(iconPreview(iconId, "currentColor"));
      choice.addEventListener("click", () => choose(iconId));
      parent.append(choice);
    };
    for (const icon of WORKSPACE_ICON_CATALOG) {
      appendChoice(icon.id, icon.label, iconGrid);
    }
    const customIcons = customIconUrls?.list() ?? [];
    if (customIcons.length > 0) {
      const customGroup = document.createElement("div");
      customGroup.className = "rail-shared-custom";
      customGroup.setAttribute("role", "group");
      const customHeading = document.createElement("span");
      customHeading.className = "rail-icon-group-label";
      customHeading.id = `rail-custom-icons-${iconGridSequence += 1}`;
      customHeading.textContent = "Custom icons";
      customGroup.setAttribute("aria-labelledby", customHeading.id);
      customGroup.append(customHeading);
      for (const icon of customIcons) {
        appendChoice(icon.id, icon.label, customGroup);
      }
      iconGrid.append(customGroup);
    }
    return iconGrid;
  }

  function fieldLabel(text) {
    const label = document.createElement("span");
    label.className = "rail-field-label";
    label.textContent = text;
    return label;
  }

  // A colour is a swatch and its hex, as on Appearance. The swatch opens the
  // picker; the hex commits on change so a mutation never interrupts typing.
  function colorRow({ color, mixedColors = null, title, ariaLabel, apply }) {
    const row = document.createElement("div");
    row.className = "swatch-row";
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch swatch--small";
    swatch.setAttribute("aria-label", ariaLabel);
    // Set apart from the `background` shorthand, which would reset the
    // stylesheet's border-box origin and tile the gradient onto the edge.
    if (mixedColors) {
      swatch.style.backgroundImage =
        `linear-gradient(135deg, ${mixedColors[0]} 50%, ${mixedColors[1]} 50%)`;
      swatch.style.backgroundColor = "transparent";
    } else {
      swatch.style.backgroundImage = "none";
      swatch.style.backgroundColor = color;
    }
    swatch.addEventListener("click", () => {
      colorPanel.open({ title, value: color ?? mixedColors[0], onApply: apply });
    });
    row.append(swatch);
    if (mixedColors) {
      const mixed = document.createElement("span");
      mixed.className = "rail-mixed-note";
      mixed.textContent = "Mixed colors";
      row.append(mixed);
      return row;
    }
    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "hex";
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = "off";
    hex.value = color.toUpperCase();
    hex.setAttribute("aria-label", `${ariaLabel} hex`);
    hex.addEventListener("change", () => {
      const value = hex.value.trim().replace(/^#?/, "#").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(value)) {
        hex.value = color.toUpperCase();
        setStatus("Enter six hex digits after #, for example #2B2A33.", "error");
        return;
      }
      if (value !== color.toLowerCase()) {
        apply(value);
      }
    });
    hex.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        hex.blur();
      }
    });
    row.append(hex);
    return row;
  }

  function inspectorHead(lead, text) {
    const heading = document.createElement("div");
    heading.className = "rail-inspector-heading";
    const title = document.createElement("h3");
    title.textContent = text;
    heading.append(lead, title);
    return heading;
  }

  function removeButton(label, ariaLabel, onRemove, disabled = false) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn is-danger workspace-remove-button";
    remove.textContent = label;
    remove.setAttribute("aria-label", ariaLabel);
    remove.disabled = disabled;
    remove.addEventListener("click", onRemove);
    return remove;
  }

  function containerIconPreview(iconId, color, iconUrl = null) {
    const preview = document.createElement("span");
    preview.className = "container-icon-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.style.setProperty(
      "--container-icon-mask",
      `url("${iconUrl ?? containerIconAssetPath(iconId)}")`
    );
    preview.style.setProperty("--container-icon-color", color);
    return preview;
  }

  function supportedColorOptions() {
    return containers.supportedColorOptions?.length > 0
      ? containers.supportedColorOptions
      : containers.supportedColors.map((color) => ({
          color,
          colorCode: containers.containers.find(
            ({ descriptor }) => descriptor.color === color && descriptor.colorCode
          )?.descriptor.colorCode ?? "#737373"
        }));
  }

  function supportedIconOptions() {
    return containers.supportedIconOptions?.length > 0
      ? containers.supportedIconOptions
      : containers.supportedIcons.map((icon) => ({ icon, iconUrl: null }));
  }

  function selectedColorCode() {
    return supportedColorOptions().find(({ color }) => color === selectedContainerColor)?.colorCode
      ?? "#737373";
  }

  function renderContainerColor() {
    const color = selectedColorCode();
    createContainerColor.style.setProperty("--chosen-container-color", color);
    createContainerColor.textContent = selectedContainerColor
      ? `Choose color (${selectedContainerColor})`
      : "Choose color";
    createContainerColor.setAttribute(
      "aria-label",
      `Choose container color. Current color ${selectedContainerColor ?? "unavailable"}.`
    );
  }

  function renderContainerIconChoices() {
    createContainerIcon.replaceChildren();
    const iconOptions = supportedIconOptions();
    for (const [index, { icon, iconUrl }] of iconOptions.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "container-icon-choice";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(icon === selectedContainerIcon));
      button.setAttribute("aria-label", icon);
      button.title = icon;
      button.tabIndex = icon === selectedContainerIcon || (selectedContainerIcon === null && index === 0)
        ? 0
        : -1;
      button.append(containerIconPreview(icon, selectedColorCode(), iconUrl));
      button.addEventListener("click", () => {
        selectedContainerIcon = icon;
        renderContainerIconChoices();
        renderContainerColor();
        createContainerIcon.querySelector(`[data-icon="${CSS.escape(icon)}"]`)?.focus();
      });
      button.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
          nextIndex = (index - 1 + iconOptions.length) % iconOptions.length;
        } else if (["ArrowRight", "ArrowDown"].includes(event.key)) {
          nextIndex = (index + 1) % iconOptions.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = iconOptions.length - 1;
        }
        if (nextIndex === null) return;
        event.preventDefault();
        selectedContainerIcon = iconOptions[nextIndex].icon;
        renderContainerIconChoices();
        renderContainerColor();
        createContainerIcon.querySelector(
          `[data-icon="${CSS.escape(selectedContainerIcon)}"]`
        )?.focus();
      });
      button.dataset.icon = icon;
      createContainerIcon.append(button);
    }
  }

  function requestWorkspaceRemoval(workspace) {
    requestWorkspaceRemovals([workspace.id]);
  }

  function requestWorkspaceRemovals(workspaceIds, decorations = []) {
    if (!state || workspaceIds.length === 0) {
      return;
    }
    const plan = planRemovalIntoFirstWorkspace(state.rail, workspaceIds);
    if (!plan.ok) {
      setStatus(
        plan.code === "NO_SURVIVING_WORKSPACE"
          ? "At least one workspace must remain."
          : "Those workspaces could not be removed.",
        "error"
      );
      return;
    }
    void performWorkspaceRemovals(plan.order, decorations);
  }

  // Removed in the planned order inside one mutation, so the rail is redrawn
  // once and every workspace's tabs land on a workspace that survives.
  // One background call removes the whole selection, so it lands as a single
  // Undo entry in this window's slot, however many workspaces it held.
  async function performWorkspaceRemovals(workspaceIds, decorations = []) {
    const names = workspaceIds
      .map((id) => state.workspaces.find((workspace) => workspace.id === id)?.name)
      .filter(Boolean)
      .reverse();
    let result = null;
    await runMutation(
      async () => {
        result = await client.removeWorkspaces(workspaceIds, decorations);
        return result.state;
      },
      workspaceIds.length === 1 ? "Removing workspace…" : `Removing ${workspaceIds.length} workspaces…`,
      `${workspaceIds.length === 1 ? "Workspace" : `${workspaceIds.length} workspaces`} removed. No tabs were closed.`
    );
    if (result) {
      showRemovalUndo(names, result.undo);
    }
  }

  function removalSummary(names) {
    const listed = names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${listed} removed. No tabs were closed.`;
  }

  function showRemovalUndo(names, undo) {
    const available = undo?.available === true && undo.action === "undo";
    removalUndoId = available ? undo.undoId : null;
    removalUndoText.textContent = removalSummary(names);
    removalUndoButton.hidden = !available;
    removalUndo.hidden = false;
  }

  // The window's one slot moves on when anything else fills it, so the Undo
  // offered here disappears with it rather than undoing something newer.
  function applyUndoSummary(summary) {
    if (removalUndoId !== null && summary?.undoId !== removalUndoId) {
      removalUndoId = null;
      removalUndo.hidden = true;
    }
  }

  function inspectWorkspace(workspace) {
    const body = document.createElement("div");
    body.className = "rail-inspector-body";
    body.append(inspectorHead(workspaceChip(workspace), workspace.name));

    const fields = document.createElement("div");
    fields.className = "workspace-fields";

    const nameLabel = document.createElement("label");
    nameLabel.className = "rail-field";
    nameLabel.append(fieldLabel("Name"));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 80;
    nameInput.value = workspace.name;
    nameInput.addEventListener("change", () => {
      const name = nameInput.value.trim();
      nameInput.setCustomValidity("");
      void runMutation(
        () => client.update(workspace.id, { name }),
        `Saving ${workspace.name}…`,
        "Workspace name saved."
      );
    });
    nameLabel.append(nameInput);

    const currentLabel = workspaceIconLabel(workspace.icon, customIconUrls);
    const selectedIconId = currentLabel === null ? null : resolveWorkspaceIcon(workspace.icon).id;
    const iconField = document.createElement("div");
    iconField.className = "rail-field";
    iconField.append(
      fieldLabel("Icon"),
      iconChoiceGrid(
        (iconId) => runMutation(
          () => client.update(workspace.id, { icon: iconId }),
          `Saving ${workspace.name}…`,
          "Workspace icon saved."
        ),
        (iconId) => iconId === selectedIconId,
        (label) => `Use ${label} icon for ${workspace.name}`
      )
    );
    if (currentLabel === null) {
      const unavailable = document.createElement("p");
      unavailable.className = "rail-mixed-note";
      unavailable.textContent = `Unavailable icon (${workspace.icon}). Shown as House.`;
      iconField.append(unavailable);
    }

    const colorField = document.createElement("div");
    colorField.className = "rail-field";
    colorField.append(
      fieldLabel("Color"),
      colorRow({
        color: workspace.color,
        title: `Choose ${workspace.name} color`,
        ariaLabel: `${workspace.name} color`,
        apply: (color) => runMutation(
          () => client.update(workspace.id, { color }),
          `Saving ${workspace.name}…`,
          "Workspace color saved."
        )
      })
    );

    const containerLabel = document.createElement("label");
    containerLabel.className = "rail-field";
    containerLabel.append(fieldLabel("Container"));
    const containerSelect = document.createElement("select");
    containerSelect.className = "workspace-container-select";
    containerSelect.setAttribute("aria-label", `Container for ${workspace.name} workspace`);
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "None";
    noneOption.setAttribute("aria-label", "None");
    noneOption.title = "None";
    containerSelect.append(noneOption);
    const available = uniqueAvailableContainerEntries(
      containers.containers,
      workspace.defaultContainerRef
    );
    for (const entry of available) {
      const option = document.createElement("option");
      option.value = entry.refId;
      option.textContent = entry.descriptor.name;
      containerSelect.append(option);
    }
    if (
      workspace.defaultContainerRef !== null &&
      !available.some(({ refId }) => refId === workspace.defaultContainerRef)
    ) {
      const unavailable = containers.containers.find(
        ({ refId }) => refId === workspace.defaultContainerRef
      );
      const option = document.createElement("option");
      option.value = workspace.defaultContainerRef;
      option.textContent = `${unavailable?.descriptor?.name ?? "Unavailable container"} (unavailable)`;
      option.disabled = true;
      containerSelect.append(option);
    }
    if (containers.capability === "available") {
      if (
        workspace.defaultContainerRef !== null &&
        !available.some(({ refId }) => refId === workspace.defaultContainerRef)
      ) {
        const recreateOption = document.createElement("option");
        recreateOption.value = "__recreate__";
        recreateOption.textContent = "Recreate unavailable container...";
        containerSelect.append(recreateOption);
      }
      const createOption = document.createElement("option");
      createOption.value = "__create__";
      createOption.textContent = "Create Container…";
      containerSelect.append(createOption);
    }
    containerSelect.value = workspace.defaultContainerRef ?? "";
    containerSelect.disabled =
      containers.capability === "private-unavailable" ||
      (containers.capability !== "available" && workspace.defaultContainerRef === null);
    containerSelect.addEventListener("change", () => {
      if (containerSelect.value === "__create__") {
        containerSelect.value = workspace.defaultContainerRef ?? "";
        openCreateContainer(workspace.id);
        return;
      }
      if (containerSelect.value === "__recreate__") {
        containerSelect.value = workspace.defaultContainerRef ?? "";
        openCreateContainer(workspace.id, workspace.defaultContainerRef);
        return;
      }
      const refId = containerSelect.value || null;
      void runMutation(
        async () => (await containerClient.setWorkspaceDefault(workspace.id, refId)).state,
        `Saving ${workspace.name} container...`,
        "Workspace default container saved. Existing tabs were not changed."
      );
    });
    containerLabel.append(containerSelect);
    fields.append(nameLabel, iconField, colorField, containerLabel);

    const controls = document.createElement("div");
    controls.className = "card-foot workspace-row-controls";
    appendClipboardActions(controls);
    controls.append(removeButton(
      "Remove",
      `Remove ${workspace.name}`,
      () => requestWorkspaceRemoval(workspace),
      state.workspaces.length < 2
    ));
    body.append(fields, controls);
    return body;
  }

  function inspectDivider(entry) {
    const body = document.createElement("div");
    body.className = "rail-inspector-body";
    const label = document.createElement("h3");
    label.className = "divider-label";
    label.textContent = "Divider";

    const sizeControl = document.createElement("div");
    sizeControl.className = "divider-size-control";
    const sizeHeader = document.createElement("div");
    const sizeLabel = document.createElement("label");
    const inputId = `divider-size-${entry.id}`;
    sizeLabel.htmlFor = inputId;
    sizeLabel.textContent = "Distance";
    const sizeOutput = document.createElement("output");
    sizeOutput.setAttribute("for", inputId);
    const sizeInput = document.createElement("input");
    sizeInput.id = inputId;
    sizeInput.type = "range";
    sizeInput.min = String(WORKSPACE_DIVIDER_SIZE_LIMITS.min);
    sizeInput.max = String(WORKSPACE_DIVIDER_SIZE_LIMITS.max);
    sizeInput.step = "1";
    sizeInput.value = String(entry.size ?? WORKSPACE_DIVIDER_SIZE_LIMITS.defaultValue);
    const updateSizeOutput = () => {
      sizeOutput.textContent = `${sizeInput.value} px`;
    };
    updateSizeOutput();
    sizeInput.addEventListener("input", updateSizeOutput);
    sizeInput.addEventListener("change", () => runMutation(
      () => client.resizeDivider(entry.id, Number(sizeInput.value)),
      "Saving divider distance…",
      "Divider distance saved."
    ));
    sizeHeader.append(sizeLabel, sizeOutput);
    sizeControl.append(sizeHeader, sizeInput);

    const controls = document.createElement("div");
    controls.className = "card-foot workspace-row-controls";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn is-danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => runMutation(
      () => client.removeDivider(entry.id),
      "Removing divider…",
      "Divider removed."
    ));
    controls.append(remove);
    body.append(label, sizeControl, controls);
    return body;
  }

  function inspectSpace(entry) {
    const body = document.createElement("div");
    body.className = "rail-inspector-body";

    const label = document.createElement("h3");
    label.className = "space-label";
    label.textContent = "Flexible space";
    const description = document.createElement("span");
    description.className = "space-description";
    description.textContent = "Fills the available blank space.";

    const controls = document.createElement("div");
    controls.className = "card-foot workspace-row-controls";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn is-danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => runMutation(
      () => client.removeSpace(entry.id),
      "Removing flexible space…",
      "Flexible space removed."
    ));
    controls.append(remove);
    body.append(label, description, controls);
    return body;
  }

  function railPreviewRow(entry, index, workspaceById) {
    const row = document.createElement("div");
    row.className = "rail-preview-row";
    row.setAttribute("role", "option");
    const locator = railEntryLocator(entry);
    row.dataset.railKey = locatorKey(locator);

    if (entry.kind === "workspace") {
      const workspace = workspaceById.get(entry.workspaceId);
      row.classList.add("rail-preview-row--workspace");
      row.append(
        attachRowDrag(row, locator, workspace.name, index),
        workspaceChip(workspace)
      );
      const name = document.createElement("span");
      name.className = "rail-preview-name";
      name.textContent = workspace.name;
      row.append(name);
      return row;
    }

    if (entry.kind === "divider") {
      row.classList.add("rail-preview-row--divider");
      row.append(attachRowDrag(row, locator, "Divider", index));
      const size = entry.size ?? WORKSPACE_DIVIDER_SIZE_LIMITS.defaultValue;
      const rule = document.createElement("span");
      rule.className = "rail-preview-rule";
      rule.setAttribute("aria-hidden", "true");
      // Drawn at its real proportion so the preview reads like the rail.
      rule.style.blockSize = `${Math.max(1, Math.round(size / 8))}px`;
      const meta = document.createElement("span");
      meta.className = "rail-preview-meta";
      meta.textContent = `Divider · ${size}px`;
      row.append(rule, meta);
      return row;
    }

    row.classList.add("rail-preview-row--space");
    row.append(attachRowDrag(row, locator, "Flexible space", index));
    const meta = document.createElement("span");
    meta.className = "rail-preview-meta";
    meta.textContent = "Flexible space · fills the gap";
    row.append(meta);
    return row;
  }

  function inspectEmpty() {
    const body = document.createElement("div");
    body.className = "rail-inspector-body rail-inspector-empty";
    const hint = document.createElement("p");
    hint.className = "setting-help";
    hint.textContent =
      "Select a workspace, divider or space on the left to edit it. Shift+click for a range, Ctrl+click to add.";
    body.append(hint);
    return body;
  }

  function sharedValue(values) {
    const unique = new Set(values);
    return unique.size === 1 ? [...unique][0] : null;
  }

  function mixedNote(text) {
    const mixed = document.createElement("p");
    mixed.className = "rail-mixed-note";
    mixed.textContent = text;
    return mixed;
  }

  function inspectSelection(members) {
    const body = document.createElement("div");
    body.className = "rail-inspector-body";

    const workspaceIds = selectedWorkspaceIds(selection, state.rail);
    const workspaces = workspaceIds
      .map((id) => state.workspaces.find((workspace) => workspace.id === id))
      .filter(Boolean);

    const count = document.createElement("span");
    count.className = "rail-selection-count";
    count.setAttribute("aria-hidden", "true");
    count.textContent = String(members.length);
    body.append(inspectorHead(
      count,
      workspaces.length > 0
        ? workspaces.map(({ name }) => name).join(", ")
        : `${members.length} rail entries`
    ));

    if (workspaces.length > 1) {
      const sharedIcon = sharedValue(workspaces.map(({ icon }) => icon));
      const sharedColor = sharedValue(workspaces.map(({ color }) => color));

      const iconField = document.createElement("div");
      iconField.className = "rail-field rail-shared-field";
      const iconHeading = fieldLabel("Icon");
      const iconGrid = iconChoiceGrid(
        (iconId) => runMutation(
          () => client.updateMany(workspaceIds, { icon: iconId }),
          `Saving ${workspaces.length} workspaces…`,
          "Workspace icons saved."
        ),
        (iconId) => iconId === sharedIcon,
        (label) => `Use ${label} icon for all ${workspaces.length} workspaces`
      );
      iconField.append(iconHeading, iconGrid);
      if (sharedIcon === null) {
        iconField.append(mixedNote("Mixed — the selected workspaces use different icons."));
      }

      const distinctColors = [...new Set(workspaces.map(({ color }) => color))];
      const colorField = document.createElement("div");
      colorField.className = "rail-field rail-shared-field";
      colorField.append(
        fieldLabel("Color"),
        colorRow({
          color: sharedColor,
          mixedColors: sharedColor === null ? distinctColors.slice(0, 2) : null,
          title: `Choose one color for ${workspaces.length} workspaces`,
          ariaLabel: `Choose one color for ${workspaces.length} workspaces`,
          apply: (color) => runMutation(
            () => client.updateMany(workspaceIds, { color }),
            `Saving ${workspaces.length} workspaces…`,
            "Workspace colors saved."
          )
        })
      );
      body.append(iconField, colorField);
      if (containers.capability === "available") {
        body.append(sharedContainerField(workspaces, workspaceIds));
      }
    }

    const actions = document.createElement("div");
    actions.className = "card-foot rail-selection-actions";

    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className = "btn";
    wrap.textContent = "Wrap in dividers";
    wrap.addEventListener("click", () => runMutation(
      () => client.insertMany([
        { kind: "divider", target: members[0], position: "before" },
        { kind: "divider", target: members.at(-1), position: "after" }
      ]),
      "Adding dividers…",
      "Dividers added."
    ));
    actions.append(wrap);

    if (workspaceIds.length > 0) {
      appendClipboardActions(actions);
    }
    actions.append(removeButton(
      members.length === 2 ? "Remove both" : `Remove ${members.length}`,
      `Remove the ${members.length} selected rail entries`,
      deleteSelection,
      workspaceIds.length > 0 && state.workspaces.length - workspaceIds.length < 1
    ));
    body.append(actions);
    return body;
  }

  // One default container for every selected workspace. A null reference is
  // a real shared value (None), so a mixed selection is tracked separately.
  function sharedContainerField(workspaces, workspaceIds) {
    const refs = new Set(workspaces.map(({ defaultContainerRef }) => defaultContainerRef));
    const mixed = refs.size > 1;
    const sharedRef = mixed ? null : [...refs][0];

    const label = document.createElement("label");
    label.className = "rail-field rail-shared-field";
    label.append(fieldLabel("Container"));
    const select = document.createElement("select");
    select.className = "workspace-container-select";
    select.setAttribute("aria-label", `Container for all ${workspaces.length} workspaces`);
    if (mixed) {
      const mixedOption = document.createElement("option");
      mixedOption.value = "__mixed__";
      mixedOption.textContent = "Mixed";
      mixedOption.disabled = true;
      select.append(mixedOption);
    }
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "None";
    select.append(noneOption);
    const available = uniqueAvailableContainerEntries(containers.containers, sharedRef);
    for (const entry of available) {
      const option = document.createElement("option");
      option.value = entry.refId;
      option.textContent = entry.descriptor.name;
      select.append(option);
    }
    if (sharedRef !== null && !available.some(({ refId }) => refId === sharedRef)) {
      const unavailable = containers.containers.find(({ refId }) => refId === sharedRef);
      const option = document.createElement("option");
      option.value = sharedRef;
      option.textContent = `${unavailable?.descriptor?.name ?? "Unavailable container"} (unavailable)`;
      option.disabled = true;
      select.append(option);
    }
    select.value = mixed ? "__mixed__" : sharedRef ?? "";
    select.addEventListener("change", () => {
      const refId = select.value || null;
      void runMutation(
        async () => (await containerClient.setWorkspaceDefaults(workspaceIds, refId)).state,
        `Saving ${workspaces.length} workspaces…`,
        "Default container saved for every selected workspace. Existing tabs were not changed."
      );
    });
    label.append(select);
    if (mixed) {
      label.append(mixedNote("Mixed — the selected workspaces use different containers."));
    }
    return label;
  }

  function deleteSelection() {
    if (busy || !state) {
      return;
    }
    const members = selectionLocators();
    if (members.length === 0) {
      return;
    }
    const workspaces = members.filter(({ kind }) => kind === "workspace");
    const decorations = members.filter(({ kind }) => kind !== "workspace");

    if (workspaces.length === 0) {
      void runMutation(
        () => client.removeMany(decorations),
        "Removing rail entries…",
        "Rail entries removed."
      );
      return;
    }
    requestWorkspaceRemovals(workspaces.map(({ id }) => id), decorations);
  }

  function copySelection() {
    if (!state) {
      return;
    }
    const workspaceIds = selectedWorkspaceIds(selection, state.rail);
    if (workspaceIds.length === 0) {
      setStatus("Select at least one workspace to copy.");
      return;
    }
    copiedWorkspaceIds = [...workspaceIds];
    setStatus(
      `${copiedWorkspaceIds.length} ${copiedWorkspaceIds.length === 1 ? "workspace" : "workspaces"} copied.`
    );
    renderSelection();
  }

  function pasteSelection() {
    if (busy || !state) {
      return;
    }
    if (copiedWorkspaceIds.length === 0) {
      setStatus("Nothing has been copied yet.");
      return;
    }
    const members = selectionLocators();
    const target = members.length > 0 ? members.at(-1) : null;
    void runMutation(
      () => client.duplicateMany(copiedWorkspaceIds, target, "after"),
      "Pasting workspaces…",
      "Workspaces pasted."
    );
  }

  function appendClipboardActions(controls) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn";
    copy.textContent = "Copy";
    copy.addEventListener("click", copySelection);
    controls.append(copy);
    if (copiedWorkspaceIds.length > 0) {
      const paste = document.createElement("button");
      paste.type = "button";
      paste.className = "btn";
      paste.textContent = "Paste";
      paste.title = `Paste ${copiedWorkspaceIds.length} copied ${copiedWorkspaceIds.length === 1 ? "workspace" : "workspaces"}`;
      paste.setAttribute("aria-label", paste.title);
      paste.addEventListener("click", pasteSelection);
      controls.append(paste);
    }
  }

  function renderInspector(members) {
    if (members.length === 0) {
      railInspector.replaceChildren(inspectEmpty());
      return;
    }
    if (members.length === 1) {
      const entry = state.rail.find((candidate) => railEntryMatches(candidate, members[0]));
      if (!entry) {
        railInspector.replaceChildren(inspectEmpty());
        return;
      }
      if (entry.kind === "workspace") {
        const workspace = state.workspaces.find(({ id }) => id === entry.workspaceId);
        railInspector.replaceChildren(workspace ? inspectWorkspace(workspace) : inspectEmpty());
        return;
      }
      railInspector.replaceChildren(
        entry.kind === "divider" ? inspectDivider(entry) : inspectSpace(entry)
      );
      return;
    }
    railInspector.replaceChildren(inspectSelection(members));
  }

  function renderSelection() {
    if (!state) {
      return;
    }
    for (const row of railPreview.querySelectorAll(".rail-preview-row")) {
      const active = isSelected(selection, row.dataset.railKey);
      row.setAttribute("aria-selected", String(active));
      row.classList.toggle("is-selected", active);
    }
    const members = selectionLocators();
    railSelectionStatus.textContent = members.length === 0
      ? "Nothing selected"
      : `${members.length} selected`;
    renderInspector(members);
    positionInspector();
  }

  // The inspector sits beside the entry being edited rather than at the top of
  // a tall rail. It follows the first selected row in rail order, so a range, a
  // toggled set and a keyboard selection all land it in the same place.
  //
  // Nothing here measures the inspector's own rect. It is sticky, so once the
  // page is scrolled that rect reports where it is stuck rather than where it
  // sits in the layout. Both panes are grid items in the same row, so the
  // preview pane's top is also the inspector's unshifted top.
  function positionInspector() {
    railInspector.style.marginBlockStart = "";
    const previewPane = railPreview.closest(".rail-editor-pane");
    if (!previewPane) {
      return;
    }
    // One column: the inspector already sits under the rail, where aligning it
    // with a row would mean nothing.
    if (previewPane.offsetWidth >= editor.clientWidth - 1) {
      return;
    }
    const anchor = railPreview.querySelector(".rail-preview-row.is-selected");
    if (!anchor) {
      return;
    }
    // Stopping at the preview's own bottom keeps the inspector beside the rail
    // instead of hanging past it and stretching the editor into a new scroll.
    const reach = previewPane.offsetHeight - railInspector.offsetHeight;
    const top = previewPane.getBoundingClientRect().top;
    const offset = Math.min(anchor.getBoundingClientRect().top - top, reach);
    if (offset > 0) {
      railInspector.style.marginBlockStart = `${Math.round(offset)}px`;
    }
  }

  function apply(rawState) {
    const nextState = parseWorkspaceState(rawState);
    cancelActiveDrag();
    state = nextState;
    const workspaceById = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
    // A replaced rail drops keys for entries that are gone rather than letting
    // them re-select whatever later occupies the same position.
    selection = pruneSelection(selection, state.rail);
    copiedWorkspaceIds = copiedWorkspaceIds.filter((id) => workspaceById.has(id));
    const fragment = document.createDocumentFragment();
    state.rail.forEach((entry, index) => {
      fragment.append(railPreviewRow(entry, index, workspaceById));
    });
    railPreview.replaceChildren(fragment);
    renderSelection();
    editor.setAttribute("aria-busy", String(busy));
  }

  // Until saved workspaces have been read once, the editor shows only this
  // message; it never draws built-in workspaces in their place.
  function showDataMessage(message) {
    if (state) {
      return;
    }
    const notice = document.createElement("p");
    notice.className = "setting-help workspace-editor-message";
    notice.textContent = message;
    railPreview.replaceChildren(notice);
    railInspector.replaceChildren();
  }


  function renderContainerCapability() {
    const states = {
      available: ["On", "is-good", "Containers are on."],
      "permission-required": ["Off", "", "Firefox will ask for cookies access when you enable this."],
      "permission-denied": ["Off", "is-warn", "Firefox didn't grant cookies access. Workspaces keep using ordinary tabs."],
      "partial-permission": ["Partial", "is-warn", "Firefox granted only part of what containers need. Enable them again to retry."],
      unsupported: ["Unavailable", "", "This Firefox doesn't offer containers."],
      "private-unavailable": ["Unavailable", "", "Containers aren't available in private windows."]
    };
    const [pill, variant, message] = states[containers.capability]
      ?? ["Unknown", "is-warn", "Container status unavailable."];
    containerSupportPill.textContent = pill;
    containerSupportPill.className = `state-pill${variant ? ` ${variant}` : ""}`;
    containerSupportStatus.textContent = message;
    enableContainerSupport.hidden = containers.capability === "available";
    enableContainerSupport.disabled = ["unsupported", "private-unavailable"].includes(
      containers.capability
    );
    enableContainerSupport.textContent = "Enable containers";
  }

  function applyContainers(nextContainers) {
    containers = nextContainers;
    renderContainerCapability();
    if (state) apply(state);
  }

  function openCreateContainer(workspaceId, refId = null) {
    if (containers.capability !== "available") return;
    createContainerWorkspaceId = workspaceId;
    recreateContainerRefId = refId;
    const unavailable = refId === null
      ? null
      : containers.containers.find((entry) => entry.refId === refId);
    createContainerHeading.textContent = refId === null
      ? "Create Firefox container"
      : "Recreate Firefox container";
    submitCreateContainer.textContent = refId === null ? "Create container" : "Recreate container";
    createContainerName.value = unavailable?.descriptor.name ?? "";
    selectedContainerColor = supportedColorOptions().some(
      ({ color }) => color === unavailable?.descriptor.color
    )
      ? unavailable.descriptor.color
      : supportedColorOptions()[0]?.color ?? null;
    selectedContainerIcon = supportedIconOptions().some(
      ({ icon }) => icon === unavailable?.descriptor.icon
    )
      ? unavailable.descriptor.icon
      : supportedIconOptions()[0]?.icon ?? null;
    createContainerStatus.hidden = true;
    createContainerStatus.textContent = "";
    delete createContainerStatus.dataset.variant;
    renderContainerIconChoices();
    renderContainerColor();
    createContainerDialog.showModal();
    createContainerName.focus();
  }

  async function runMutation(operation, pendingMessage, successMessage) {
    if (busy) {
      return;
    }
    busy = true;
    editor.setAttribute("aria-busy", "true");
    // The panel holds cards this module does not own, such as Custom icons, so
    // re-enabling a fixed list left every other control disabled until the page
    // was reloaded. Only controls this mutation actually disabled are restored,
    // which leaves a control another panel disabled for its own reasons alone.
    const suspended = [
      ...document.querySelectorAll(
        "#workspaces-panel button, #workspaces-panel input, #workspaces-panel select"
      )
    ].filter((control) => !control.disabled);
    for (const control of suspended) {
      control.disabled = true;
    }
    let restored = false;
    // Restoring before apply() lets the freshly rendered state have the last
    // word on controls it legitimately keeps disabled.
    const restore = () => {
      if (restored) return;
      restored = true;
      for (const control of suspended) {
        control.disabled = false;
      }
    };
    setStatus(pendingMessage);
    try {
      const nextState = await operation();
      busy = false;
      restore();
      apply(nextState);
      setStatus(successMessage);
    } catch (error) {
      busy = false;
      restore();
      setStatus(error.message, "error");
      if (state) {
        apply(state);
      }
    } finally {
      busy = false;
      restore();
      editor.setAttribute("aria-busy", "false");
    }
  }

  createButton.addEventListener("click", () => runMutation(
    () => client.create({ ...NEW_WORKSPACE_FIELDS }),
    "Creating workspace…",
    "Workspace created."
  ));
  addDividerButton.addEventListener("click", () => runMutation(
    () => client.addDivider(),
    "Adding divider…",
    "Divider added."
  ));
  addSpaceButton.addEventListener("click", () => runMutation(
    () => client.addSpace(),
    "Adding flexible space…",
    "Flexible space added."
  ));

  removalUndoButton.addEventListener("click", () => {
    const undoId = removalUndoId;
    if (undoId === null || busy) {
      return;
    }
    removalUndoId = null;
    removalUndo.hidden = true;
    void runMutation(
      async () => {
        const outcome = await client.undoRemoval(undoId);
        if (outcome.status !== "applied") {
          throw new Error(
            outcome.status === "partial"
              ? "Undo restored only part of the removal."
              : "Undo could not restore the removal. The workspaces changed since."
          );
        }
        return client.get();
      },
      "Undoing removal…",
      "Removal undone. The workspaces and their tabs are back."
    );
  });

  enableContainerSupport.addEventListener("click", async () => {
    enableContainerSupport.disabled = true;
    setStatus("Requesting Firefox container permission…");
    try {
      applyContainers(await containerClient.enable());
      setStatus("Containers enabled.");
    } catch (error) {
      setStatus(error.message, "error");
      renderContainerCapability();
    }
  });

  createContainerColor.addEventListener("click", () => {
    const options = supportedColorOptions().map(({ color, colorCode }) => ({
      value: color,
      color: colorCode,
      label: color
    }));
    if (options.length === 0) {
      createContainerStatus.hidden = false;
      createContainerStatus.textContent = "Firefox did not provide any container colors.";
      createContainerStatus.dataset.variant = "error";
      return;
    }
    colorPanel.openPalette({
      title: "Choose container color",
      options,
      value: selectedContainerColor,
      onApply(color) {
        selectedContainerColor = color;
        renderContainerIconChoices();
        renderContainerColor();
      }
    });
  });
  createContainerName.addEventListener("input", () => {
    createContainerName.setCustomValidity("");
  });

  cancelCreateContainer.addEventListener("click", () => {
    if (!containerCreationBusy) createContainerDialog.close();
  });
  createContainerDialog.addEventListener("close", () => {
    createContainerWorkspaceId = null;
    recreateContainerRefId = null;
    selectedContainerColor = null;
    selectedContainerIcon = null;
    containerCreationBusy = false;
    createContainerForm.reset();
  });
  createContainerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const workspaceId = createContainerWorkspaceId;
    const refId = recreateContainerRefId;
    if (!workspaceId || containerCreationBusy) return;
    if (!selectedContainerColor || !selectedContainerIcon) {
      createContainerStatus.hidden = false;
      createContainerStatus.textContent = "Choose a supported color and icon.";
      createContainerStatus.dataset.variant = "error";
      return;
    }
    const name = createContainerName.value.trim();
    createContainerName.setCustomValidity("");
    const descriptor = {
      name,
      color: selectedContainerColor,
      icon: selectedContainerIcon,
      colorCode: null
    };
    containerCreationBusy = true;
    submitCreateContainer.disabled = true;
    cancelCreateContainer.disabled = true;
    delete createContainerStatus.dataset.variant;
    createContainerStatus.hidden = false;
    createContainerStatus.textContent = "Creating container…";
    try {
      const created = refId === null
        ? await containerClient.create(descriptor)
        : await containerClient.recreate(refId, descriptor);
      const result = await containerClient.setWorkspaceDefault(workspaceId, created.refId);
      applyContainers(await containerClient.overview());
      apply(result.state);
      createContainerDialog.close();
      setStatus("Container created and assigned to the workspace.");
    } catch (error) {
      createContainerStatus.textContent = error.message;
      createContainerStatus.dataset.variant = "error";
      setStatus(error.message, "error");
    } finally {
      containerCreationBusy = false;
      submitCreateContainer.disabled = false;
      cancelCreateContainer.disabled = false;
    }
  });

  function refreshIcons() {
    if (state) apply(state);
  }

  // Row positions move with the column width, and the two-column layout itself
  // collapses at a breakpoint, so the offset is recomputed rather than kept.
  window.addEventListener("resize", positionInspector);

  renderContainerCapability();
  return Object.freeze({ apply, applyContainers, applyUndoSummary, refreshIcons, showDataMessage });
}

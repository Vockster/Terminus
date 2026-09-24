import { uniqueAvailableContainerEntries } from "../contracts/containers.js";

// Move to container offers No Container, then each available container
// once. A choice that every source tab already uses would change nothing, so
// it is disabled and marked current.
export function containerMoveChoices(sources, containers) {
  const choices = [
    { kind: "none", refId: null, canonicalRefId: null, name: "No Container", colorCode: null },
    ...uniqueAvailableContainerEntries(containers).map((entry) => ({
      kind: "container",
      refId: entry.refId,
      canonicalRefId: entry.canonicalRefId ?? entry.refId,
      name: entry.descriptor.name,
      colorCode: entry.descriptor.colorCode
    }))
  ];
  return choices.map((choice) => ({
    ...choice,
    current: sources.length > 0 && sources.every(({ container }) =>
      choice.kind === "none"
        ? container.kind === "none"
        : container.kind === "container" && container.refId === choice.canonicalRefId
    )
  }));
}

export function containerMoveAssignment(choice) {
  return choice.kind === "none"
    ? { kind: "none" }
    : { kind: "container", refId: choice.refId };
}

export function createContainerMoveDialog({
  document,
  dialog,
  form,
  list,
  submitButton,
  cancelButton,
  onMove,
  onClose = () => undefined
}) {
  let pending = null;
  let inputs = [];

  function choiceRow(choice, index) {
    const label = document.createElement("label");
    label.className = "container-move-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "container";
    input.value = String(index);
    input.disabled = choice.current;
    input.addEventListener("change", () => {
      submitButton.disabled = !inputs.some((candidate) => candidate.checked);
    });
    const star = document.createElement("span");
    star.className = "container-move-star";
    star.setAttribute("aria-hidden", "true");
    if (choice.colorCode) {
      star.style.setProperty("--tab-container-color", choice.colorCode);
    } else {
      star.dataset.empty = "true";
    }
    const name = document.createElement("span");
    name.className = "container-move-name";
    name.textContent = choice.name;
    label.append(input, star, name);
    if (choice.current) {
      const current = document.createElement("span");
      current.className = "container-move-current";
      current.textContent = "Current";
      label.append(current);
    }
    inputs.push(input);
    return label;
  }

  function open(sources, containers) {
    const choices = containerMoveChoices(sources, containers);
    pending = { sources, choices };
    inputs = [];
    list.replaceChildren(...choices.map(choiceRow));
    submitButton.disabled = true;
    if (!dialog.open) dialog.showModal();
    inputs.find((input) => !input.disabled)?.focus();
    return choices;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selectedIndex = inputs.findIndex((input) => input.checked && !input.disabled);
    const request = pending;
    if (!request || selectedIndex < 0) return;
    dialog.close();
    void onMove(request.sources, request.choices[selectedIndex]);
  });
  cancelButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    const sources = pending?.sources ?? [];
    pending = null;
    inputs = [];
    list.replaceChildren();
    onClose(sources);
  });

  return { open };
}

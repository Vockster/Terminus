import test from "node:test";
import assert from "node:assert/strict";

import { createEvent, createFakeDocument, element } from "../helpers/fake-dom.js";
import {
  containerMoveAssignment,
  containerMoveChoices,
  createContainerMoveDialog
} from "../../src/sidebar/container-move-dialog.js";

const WORK = { name: "Work", color: "blue", icon: "briefcase", colorCode: "#37adff" };
const HOME = { name: "Home", color: "green", icon: "tree", colorCode: "#51cd00" };
const CONTAINERS = [
  { refId: "ctr-work", canonicalRefId: "ctr-work", descriptor: WORK, status: "available" },
  { refId: "ctr-work-alias", canonicalRefId: "ctr-work", descriptor: WORK, status: "available" },
  { refId: "ctr-home", canonicalRefId: "ctr-home", descriptor: HOME, status: "available" },
  { refId: "ctr-gone", canonicalRefId: "ctr-gone", descriptor: HOME, status: "unavailable" }
];

function source(container) {
  return { logicalId: `tab-${Math.random()}`, firefoxId: 1, container };
}

const NONE = { kind: "none" };
const IN_WORK = { kind: "container", refId: "ctr-work", descriptor: WORK, status: "available" };

test("container choices list No Container and each available identity once, marking shared current choices", () => {
  const mixed = containerMoveChoices([source(NONE), source(IN_WORK)], CONTAINERS);
  assert.deepEqual(mixed.map(({ name, current }) => [name, current]), [
    ["No Container", false],
    ["Work", false],
    ["Home", false]
  ]);

  const allWork = containerMoveChoices([source(IN_WORK), source(IN_WORK)], CONTAINERS);
  assert.deepEqual(allWork.map(({ name, current }) => [name, current]), [
    ["No Container", false],
    ["Work", true],
    ["Home", false]
  ]);
  assert.equal(containerMoveChoices([source(NONE)], CONTAINERS)[0].current, true);

  assert.deepEqual(containerMoveAssignment(mixed[0]), { kind: "none" });
  assert.deepEqual(containerMoveAssignment(mixed[2]), { kind: "container", refId: "ctr-home" });
});

test("the dialog disables current choices, needs an explicit choice, and moves the original sources", async () => {
  const document = createFakeDocument();
  const dialog = element(document, "dialog");
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(createEvent("close"));
  };
  const form = element(document, "form");
  const list = element(document, "div");
  const submitButton = element(document, "button");
  const cancelButton = element(document, "button");
  const moves = [];
  const closed = [];
  const controller = createContainerMoveDialog({
    document,
    dialog,
    form,
    list,
    submitButton,
    cancelButton,
    onMove: async (sources, choice) => { moves.push([sources, choice]); },
    onClose: (sources) => { closed.push(sources); }
  });
  const sources = [source(IN_WORK)];

  controller.open(sources, CONTAINERS);
  assert.equal(dialog.open, true);
  assert.equal(submitButton.disabled, true);
  const rows = list.children;
  assert.deepEqual(rows.map((row) => row.children.find((child) => child.className === "container-move-name").textContent), [
    "No Container", "Work", "Home"
  ]);
  const inputs = rows.map((row) => row.children[0]);
  assert.deepEqual(inputs.map(({ disabled }) => disabled), [false, true, false]);
  assert.equal(rows[1].children.at(-1).textContent, "Current");
  assert.equal(rows[0].children[1].dataset.empty, "true");
  assert.equal(rows[2].children[1].style.properties.get("--tab-container-color"), "#51cd00");

  form.dispatchEvent(createEvent("submit"));
  assert.deepEqual(moves, [], "nothing moves before a choice");

  inputs[2].checked = true;
  inputs[2].dispatchEvent(createEvent("change"));
  assert.equal(submitButton.disabled, false);
  form.dispatchEvent(createEvent("submit"));
  await Promise.resolve();
  assert.equal(dialog.open, false);
  assert.equal(moves.length, 1);
  assert.equal(moves[0][0], sources);
  assert.equal(moves[0][1].refId, "ctr-home");
  assert.deepEqual(closed, [sources]);
  assert.equal(list.children.length, 0);

  controller.open(sources, CONTAINERS);
  cancelButton.click();
  assert.equal(dialog.open, false);
  assert.equal(moves.length, 1, "Cancel moves nothing");
});

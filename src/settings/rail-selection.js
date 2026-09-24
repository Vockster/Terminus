import { railEntryLocator } from "../contracts/workspace-rail-batch.js";

// The selection model for the rail editor. It holds keys, not elements, so the
// panel can rebuild its rows from fresh state without losing what the user had
// selected, and so selection arithmetic is testable without a DOM.

export function railEntryKey(entry) {
  const locator = railEntryLocator(entry);
  return `${locator.kind}:${locator.id}`;
}

function keyOrder(rail) {
  return rail.map((entry) => railEntryKey(entry));
}

function frozen(keys, anchor) {
  return Object.freeze({ keys: Object.freeze([...keys]), anchor });
}

export function createRailSelection(initialKeys = [], anchor = null) {
  return frozen([...new Set(initialKeys)], anchor);
}

export function isSelected(selection, key) {
  return selection.keys.includes(key);
}

export function selectionSize(selection) {
  return selection.keys.length;
}

export function selectOnly(selection, key) {
  return frozen([key], key);
}

export function clearSelection() {
  return frozen([], null);
}

// Ctrl/Cmd click. The anchor follows the last key the user touched, including
// when that key was just removed, which is what makes a following Shift+click
// extend from where they actually are.
export function toggleSelection(selection, key) {
  const keys = isSelected(selection, key)
    ? selection.keys.filter((candidate) => candidate !== key)
    : [...selection.keys, key];
  return frozen(keys, key);
}

// Shift+click. With no anchor yet this behaves as a plain select, so the first
// Shift+click in a fresh panel cannot select the whole rail by accident.
export function extendSelection(selection, key, rail) {
  const order = keyOrder(rail);
  const anchorIndex = selection.anchor === null ? -1 : order.indexOf(selection.anchor);
  const targetIndex = order.indexOf(key);
  if (targetIndex < 0) return selection;
  if (anchorIndex < 0) return selectOnly(selection, key);

  const [start, end] = anchorIndex <= targetIndex
    ? [anchorIndex, targetIndex]
    : [targetIndex, anchorIndex];
  return frozen(order.slice(start, end + 1), selection.anchor);
}

export function selectAll(rail) {
  const order = keyOrder(rail);
  return frozen(order, order.at(-1) ?? null);
}

// A mutation replaces the rail, so keys for entries that no longer exist are
// dropped rather than lingering and re-selecting a later entry that happens to
// reuse a position.
export function pruneSelection(selection, rail) {
  const order = new Set(keyOrder(rail));
  const keys = selection.keys.filter((key) => order.has(key));
  const anchor = selection.anchor !== null && order.has(selection.anchor)
    ? selection.anchor
    : null;
  return keys.length === selection.keys.length && anchor === selection.anchor
    ? selection
    : frozen(keys, anchor);
}

// Always rail order, never click order: every batch operation downstream
// depends on the selection reading the way the rail reads.
export function orderedMembers(selection, rail) {
  const selected = new Set(selection.keys);
  return rail
    .filter((entry) => selected.has(railEntryKey(entry)))
    .map((entry) => railEntryLocator(entry));
}

export function selectedWorkspaceIds(selection, rail) {
  return orderedMembers(selection, rail)
    .filter(({ kind }) => kind === "workspace")
    .map(({ id }) => id);
}

export function selectionKinds(selection, rail) {
  return new Set(orderedMembers(selection, rail).map(({ kind }) => kind));
}

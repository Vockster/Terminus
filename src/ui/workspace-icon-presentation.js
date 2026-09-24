import {
  FALLBACK_WORKSPACE_ICON,
  isWorkspaceIconId,
  resolveWorkspaceIcon
} from "../contracts/workspace-icons.js";

function maskPresentation(icon) {
  return Object.freeze({
    kind: "mask",
    path: icon.path,
    opticalScale: icon.opticalScale,
    label: icon.label
  });
}

// Built-in icons are masks tinted with the workspace color; custom images keep
// their own colors. A custom ID without a stored image draws House.
export function presentWorkspaceIcon(iconId, customIconUrls = null) {
  const icon = resolveWorkspaceIcon(iconId);
  if (icon.kind !== "custom") return maskPresentation(icon);
  const custom = customIconUrls?.get(icon.id) ?? null;
  return custom
    ? Object.freeze({ kind: "image", url: custom.url, label: custom.label })
    : maskPresentation(FALLBACK_WORKSPACE_ICON);
}

// Names the icon a workspace stores, or null when it can no longer be drawn.
export function workspaceIconLabel(iconId, customIconUrls = null) {
  const icon = resolveWorkspaceIcon(iconId);
  if (icon.kind === "custom") return customIconUrls?.get(icon.id)?.label ?? null;
  return isWorkspaceIconId(iconId) ? icon.label : null;
}

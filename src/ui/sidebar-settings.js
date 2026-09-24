import {
  getTabSizeGeometry,
  getWorkspaceSizeGeometry,
  parseSettingsState
} from "../contracts/settings-state.js";

const WORKSPACE_COUNT_FONT_SIZE_MIN = 9;
const WORKSPACE_COUNT_FONT_SIZE_MAX = 14;
const WORKSPACE_COUNT_FONT_SIZE_RATIO = 0.34;
const COUNT_DISC_FONT_SIZE_MIN = 11;
const COUNT_DISC_FONT_SIZE_MAX = 16;
// Firefox's thin scrollbar still consumes inline space. Icons Only needs a
// separate reserve so a long tab list cannot take that space from the tile
// gutter and force the fixed icon lane to widen.
const TAB_ICON_SCROLLBAR_RESERVE = 8;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function countTextWidth(fontSize) {
  return Math.ceil(fontSize * 0.64 * 4) + 4;
}

export function deriveSidebarGeometry(settings) {
  const parsed = parseSettingsState(settings);
  const workspace = getWorkspaceSizeGeometry(parsed.sidebar.workspaceSize);
  const tab = getTabSizeGeometry(parsed.sidebar.tabSize);
  const { railSize, buttonSize, iconSize } = workspace;
  const { dividerSize } = parsed.sidebar;
  const workspaceCountFontSize = clamp(
    Math.round(iconSize * WORKSPACE_COUNT_FONT_SIZE_RATIO),
    WORKSPACE_COUNT_FONT_SIZE_MIN,
    WORKSPACE_COUNT_FONT_SIZE_MAX
  );
  const tabCountFontSize = clamp(
    tab.fontSize - 2,
    COUNT_DISC_FONT_SIZE_MIN,
    COUNT_DISC_FONT_SIZE_MAX
  );
  const tabDisclosureSize = clamp(Math.round(tab.faviconSize * 0.78), 14, 24);
  // A collapsed container root keeps its star beside the count, so the status
  // column must fit both at the effective range.
  const tabStatusWidth =
    tabDisclosureSize + countTextWidth(tabCountFontSize) + 2;
  // One indent step must clear the branch elbow and still read as a column.
  const treeIndentSize = clamp(Math.round(tab.faviconSize * 0.8), 14, 28);
  const tabControlSize = clamp(Math.round(tab.rowSize * 0.7), 20, 36);
  const workspaceMenuSize = clamp(Math.round(buttonSize * 0.45), 16, 24);
  const workspaceUnavailableSize = clamp(Math.round(iconSize * 0.42), 10, 16);
  const workspaceFooterRequirement = railSize;
  const tabFooterRequirement = tab.iconColumnSize;

  return Object.freeze({
    railSize,
    buttonSize,
    iconSize,
    dividerSize,
    workspaceCountFontSize,
    workspaceMenuSize,
    workspaceUnavailableSize,
    tabIconColumnSize: tab.iconColumnSize,
    tabIconPaneSize: tab.iconColumnSize + TAB_ICON_SCROLLBAR_RESERVE,
    tabTileSize: tab.tileSize,
    tabRowSize: tab.rowSize,
    tabFaviconSize: tab.faviconSize,
    tabFontSize: tab.fontSize,
    tabControlSize,
    tabDisclosureSize,
    tabCountFontSize,
    tabCountLineSize: tabCountFontSize + 2,
    tabStatusWidth,
    treeIndentSize,
    workspaceFooterRequirement,
    tabFooterRequirement,
    footerSize: Math.max(workspaceFooterRequirement, tabFooterRequirement)
  });
}

export function applySidebarSettings(rootElement, settings) {
  const parsed = parseSettingsState(settings);
  const geometry = deriveSidebarGeometry(settings);
  const properties = {
    "--workspace-rail-size": geometry.railSize,
    "--workspace-button-size": geometry.buttonSize,
    "--workspace-icon-size": geometry.iconSize,
    "--workspace-divider-size": geometry.dividerSize,
    "--workspace-count-font-size": geometry.workspaceCountFontSize,
    "--workspace-menu-size": geometry.workspaceMenuSize,
    "--workspace-unavailable-size": geometry.workspaceUnavailableSize,
    "--tab-icon-column-size": geometry.tabIconColumnSize,
    "--tab-icon-pane-size": geometry.tabIconPaneSize,
    "--tab-tile-size": geometry.tabTileSize,
    "--tab-row-size": geometry.tabRowSize,
    "--tab-favicon-size": geometry.tabFaviconSize,
    "--tab-label-font-size": geometry.tabFontSize,
    "--sidebar-font-size": geometry.tabFontSize,
    "--tab-control-size": geometry.tabControlSize,
    "--tab-disclosure-size": geometry.tabDisclosureSize,
    "--tab-count-font-size": geometry.tabCountFontSize,
    "--tab-count-line-size": geometry.tabCountLineSize,
    "--tab-status-width": geometry.tabStatusWidth,
    "--tree-indent-size": geometry.treeIndentSize,
    "--workspace-footer-requirement": geometry.workspaceFooterRequirement,
    "--tab-footer-requirement": geometry.tabFooterRequirement,
    "--sidebar-footer-size": geometry.footerSize
  };

  for (const [property, value] of Object.entries(properties)) {
    rootElement.style.setProperty(property, `${value}px`);
  }
  rootElement.dataset.contentMode = parsed.appearance.contentMode;
  rootElement.dataset.actionButtons =
    parsed.appearance.contentMode === "full" && parsed.sidebar.showActionButtons
      ? "shown"
      : "hidden";
  rootElement.dataset.addWorkspaceButton = parsed.sidebar.showAddWorkspaceButton
    ? "shown"
    : "hidden";
  return geometry;
}

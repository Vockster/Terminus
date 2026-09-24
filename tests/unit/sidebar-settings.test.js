import test from "node:test";
import assert from "node:assert/strict";

import {
  applySidebarSettings,
  deriveSidebarGeometry
} from "../../src/ui/sidebar-settings.js";
import {
  SIDEBAR_SIZE_PRESETS,
  createDefaultSettingsState
} from "../../src/contracts/settings-state.js";

function settingsWith(sidebar) {
  return {
    ...createDefaultSettingsState(),
    sidebar: {
      ...createDefaultSettingsState().sidebar,
      ...sidebar,
      showActionButtons: true
    }
  };
}

test("sidebar geometry derives icon and transparent count dimensions from settings", () => {
  assert.deepEqual(
    deriveSidebarGeometry(settingsWith({
      workspaceSize: SIDEBAR_SIZE_PRESETS.MEDIUM,
      tabSize: SIDEBAR_SIZE_PRESETS.SMALL,
      dividerSize: 16
    })),
    {
      railSize: 46,
      buttonSize: 38,
      iconSize: 24,
      dividerSize: 16,
      workspaceCountFontSize: 9,
      workspaceMenuSize: 17,
      workspaceUnavailableSize: 10,
      tabIconColumnSize: 40,
      tabIconPaneSize: 48,
      tabTileSize: 32,
      tabRowSize: 34,
      tabFaviconSize: 20,
      tabFontSize: 14,
      tabControlSize: 24,
      tabDisclosureSize: 16,
      tabCountFontSize: 12,
      tabCountLineSize: 14,
      tabStatusWidth: 53,
      treeIndentSize: 16,
      workspaceFooterRequirement: 46,
      tabFooterRequirement: 40,
      footerSize: 46
    }
  );
  assert.deepEqual(
    [SIDEBAR_SIZE_PRESETS.SMALL, SIDEBAR_SIZE_PRESETS.MEDIUM, SIDEBAR_SIZE_PRESETS.LARGE, SIDEBAR_SIZE_PRESETS.MASSIVE]
      .map((tabSize) => {
        const geometry = deriveSidebarGeometry(settingsWith({ tabSize }));
        return [
          geometry.tabCountFontSize,
          geometry.tabCountLineSize,
          geometry.tabStatusWidth,
          geometry.tabIconPaneSize - geometry.tabIconColumnSize
        ];
      }),
    [[12, 14, 53, 8], [14, 16, 61, 8], [16, 18, 71, 8], [16, 18, 71, 8]]
  );
  assert.equal(
    deriveSidebarGeometry(settingsWith({
      workspaceSize: SIDEBAR_SIZE_PRESETS.SMALL,
      tabSize: SIDEBAR_SIZE_PRESETS.MASSIVE
    })).footerSize,
    68
  );
});

test("count text stays legible and inside its owning row at every preset", () => {
  for (const tabSize of Object.values(SIDEBAR_SIZE_PRESETS)) {
    for (const workspaceSize of Object.values(SIDEBAR_SIZE_PRESETS)) {
      const geometry = deriveSidebarGeometry(settingsWith({ tabSize, workspaceSize }));
      assert.ok(geometry.tabCountFontSize >= 11, `${tabSize} tab count text`);
      assert.ok(geometry.workspaceCountFontSize >= 9, `${workspaceSize} workspace count text`);
      assert.ok(geometry.tabCountLineSize < geometry.tabTileSize, `${tabSize} count line fits`);
      assert.ok(geometry.tabIconColumnSize > geometry.tabTileSize, `${tabSize} tile gutter`);
      assert.ok(geometry.tabIconPaneSize > geometry.tabIconColumnSize, `${tabSize} scrollbar reserve`);
      assert.ok(geometry.railSize > geometry.buttonSize, `${workspaceSize} button gutter`);
    }
  }
});

test("Icons Only keeps the tile gutter after a long list adds its scrollbar", () => {
  for (const tabSize of Object.values(SIDEBAR_SIZE_PRESETS)) {
    const geometry = deriveSidebarGeometry(settingsWith({ tabSize }));
    const tileGutter = geometry.tabIconColumnSize - geometry.tabTileSize;
    const scrollbarReserve = geometry.tabIconPaneSize - geometry.tabIconColumnSize;
    assert.ok(tileGutter > 0, `${tabSize} has a tile gutter`);
    assert.ok(
      scrollbarReserve >= tileGutter,
      `${tabSize} reserves the complete gutter outside the icon column`
    );
  }
});

test("applying sidebar settings writes geometry, content mode, and action-button visibility", () => {
  const properties = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      }
    }
  };

  applySidebarSettings(root, settingsWith({
    workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE,
    tabSize: SIDEBAR_SIZE_PRESETS.LARGE,
    dividerSize: 32
  }));

  assert.deepEqual(Object.fromEntries(properties), {
    "--workspace-rail-size": "68px",
    "--workspace-button-size": "60px",
    "--workspace-icon-size": "42px",
    "--workspace-divider-size": "32px",
    "--workspace-count-font-size": "14px",
    "--workspace-menu-size": "24px",
    "--workspace-unavailable-size": "16px",
    "--tab-icon-column-size": "56px",
    "--tab-icon-pane-size": "64px",
    "--tab-tile-size": "48px",
    "--tab-row-size": "46px",
    "--tab-favicon-size": "32px",
    "--tab-label-font-size": "18px",
    "--sidebar-font-size": "18px",
    "--tab-control-size": "32px",
    "--tab-disclosure-size": "24px",
    "--tab-count-font-size": "16px",
    "--tab-count-line-size": "18px",
    "--tab-status-width": "71px",
    "--tree-indent-size": "26px",
    "--workspace-footer-requirement": "68px",
    "--tab-footer-requirement": "56px",
    "--sidebar-footer-size": "68px"
  });
  assert.equal(root.dataset.contentMode, "full");
  assert.equal(root.dataset.actionButtons, "shown");
  assert.equal(root.dataset.addWorkspaceButton, "shown");
  assert.equal(Object.hasOwn(root.dataset, "workspaceCountRange"), false);
  assert.equal(Object.hasOwn(root.dataset, "tabCountRange"), false);
  assert.equal(Object.hasOwn(root.dataset, "rightClickBehavior"), false);

  applySidebarSettings(root, settingsWith({ showAddWorkspaceButton: false }));
  assert.equal(root.dataset.addWorkspaceButton, "hidden");

  applySidebarSettings(root, {
    ...settingsWith({ workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE }),
    sidebar: {
      ...settingsWith({ workspaceSize: SIDEBAR_SIZE_PRESETS.MASSIVE }).sidebar,
      showActionButtons: false
    }
  });
  assert.equal(root.dataset.actionButtons, "hidden");

  const iconsOnly = settingsWith({ tabSize: SIDEBAR_SIZE_PRESETS.MASSIVE });
  iconsOnly.appearance.contentMode = "icons";
  applySidebarSettings(root, iconsOnly);
  assert.equal(root.dataset.actionButtons, "hidden");
});

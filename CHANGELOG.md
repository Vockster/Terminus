# Changelog

All notable changes to Terminus are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-23

The first release of Terminus.

### Added

- **Workspaces.** Isolated sets of tabs with their own name, icon, color, and
  rail position, shared across every normal window. Each window remembers its own
  active workspace, and one workspace can be active in several windows.
- **Tab hiding.** Switching a workspace hides the other workspaces' tabs through
  Firefox's tab-hiding API without closing them.
- **Native tab groups and logical pins.** Groups belong to one workspace and move
  between workspaces as a unit. Pins are extension state, materialized as native
  Firefox pins only while their workspace is active.
- **Firefox containers.** Optional per-workspace default containers, container
  creation, identity-preserving moves, and container-aware restore. Terminus
  never calls the cookies API.
- **Unloading.** Middle-click a tab, group header, or workspace to unload it.
  Tab targets also unload nested tabs. Structure survives; only the selected tab
  reloads on return.
- **Non-destructive workspace removal.** Removing a workspace transfers its tabs,
  pins, groups, and tree relationships to the next workspace in rail order. It
  never closes tabs, and a safety snapshot is captured first.
- **Snapshots and backups.** Manual and scheduled snapshots of workspace and
  window layout, settings backups covering preferences only, an automatic-save
  maximum with ask-first cleanup, and scoped restore with a safety capture.
- **Private browsing.** A separate session-only runtime, opt-in local recovery,
  and private-only snapshot history.
- **Appearance.** Follow Firefox, solid, or 2–6 stop gradient modes, an
  independent current-tab highlight color, four size presets for workspace icons
  and tabs, Full Labels and Icons Only content modes, and a rail lock.
- **Workspace icons.** A 40-icon Lucide catalog plus custom 128×128 PNG icons
  kept locally, outside backups.
- **Settings Overview.** A final Settings tab explaining every feature with
  per-card links to the setting it describes.
- **Rail editor.** Workspaces settings shows the rail as a preview you edit
  directly. Select several entries by pointer or keyboard to give them one icon,
  color, or default container, move them together, wrap them in dividers, copy
  and paste them, or remove them at once; removed workspaces' tabs move to the
  first remaining workspace.
- **Optional Firefox Styling.** A Settings tab that downloads an optional
  `userChrome.css`, which hides the header bar Firefox draws above the sidebar.
  It shows what changes, walks through a five-step install with copy buttons,
  and covers undo and common problems. It needs no permission, and Terminus
  never installs, detects, or depends on the file.
- **Session Undo and Redo.** One window- and scope-local sidebar action can
  alternate between Undo and Redo from the footer or any sidebar context menu.
  The slot is session-only, private-scope isolated, and never becomes persistent
  or multi-step history.
- **Branch and group closing.** Parent tabs can close their full nested branch,
  groups can close every member without changing Delete group's ungrouping
  meaning, and one suppressible warning protects every multi-tab close.
- **Flatten branch.** A parent tab's menu can un-nest its whole branch without
  closing, unloading, or moving any tab, the tree counterpart of Delete group.
  Undo restores the nesting.
- **Tab search.** A magnifying-glass button in Full Labels and Icons Only opens a
  search across every workspace in the window. It matches titles first, then
  each tab's site and page path, keeps workspace, group, pin, and unload context
  in results, and opens the exact tab with Enter or a click. Escape closes it.
- **Hide unloaded tabs from Firefox.** An off-by-default preference hides
  eligible unloaded tabs from Firefox's tab strip while they stay in Terminus.
- **Gentle snapshot restores.** Restored tabs are created unloaded with their
  saved titles, so only the selected tab loads. Snapshots settings choose how
  many tabs a restore opens at a time (1–9999, default 10); the setting stays on
  each device.
- **Move to container.** A tab's menu can reopen that tab, or every tab
  selected, in another Firefox container. Each tab keeps its workspace, place,
  nested tabs, group, and pin; pages reload, and sign-ins and form contents do
  not carry over. An unloaded tab stays unloaded, tabs already in the container
  or held by a Split View are reported as skipped, and Undo moves them back. A
  page that asks to stay open keeps its own tab, and its copy in the new
  container is left beside it rather than closed.
- **Whole-tree selection actions.** With several tabs selected, Close closes
  every selected tab together with the tabs nested under it, behind the same
  one-use warning, and Flatten un-nests every selected branch at once.
- **Bookmark import.** The Snapshot Viewer can read your Firefox bookmarks or a
  bookmarks file exported from another browser, show the whole library with
  folders and counts, and create an Imported bookmarks workspace from the ones
  you tick. Tabs arrive unloaded, each folder becomes a tab group, links Firefox
  cannot open and repeated addresses are reported as skipped, and Terminus only
  ever reads bookmarks. Firefox asks for bookmark access when you choose it, and
  the flow is unavailable in private windows.
- **Move a workspace setup to another computer.** The Workspaces panel saves
  your whole setup as one zip: every workspace with its name, icon and color,
  the rail's order with its dividers and spaces, and all of your custom icons as
  ordinary image files. Importing it on another profile brings all of that back.
  Choose whether the workspaces are added to the ones you have or replace them;
  replacing asks first, maps matching workspaces one-to-one, keeps unmatched or
  colliding workspaces separate, and never closes a tab. Tabs, containers and
  other settings are not included.
  Custom icons keep the file you originally chose when it is small enough, so an
  SVG stays an SVG, and icons you added before this update travel as their 128px
  PNG. A setup zip from an older Terminus, saved as JSON, still imports.
- **Accessibility.** Labels, focus boundaries, and forced-colors support so state
  never depends on color alone.

### Changed

- **Storage now focuses on website icons.** The computer-space allowance meter
  and unrelated local categories are gone. Storage shows the exact cached icon
  count and bytes, every cached icon, host-access needs, and the existing unused
  and clear controls. Private Settings cannot read or change the normal cache.
- Legacy records imported by an earlier Sync build now appear as **Imported** in
  the Snapshot Viewer and in new export filenames.
- **The extension is now named Terminus.** It was developed under the working
  name Sidebars. Stored data keys and document types keep their original
  spelling so existing data and exported files stay readable.
- Workspace and collapsed tab/group counts are transparent text in their
  established positions. Loaded or partly loaded aggregates are bright white;
  fully unloaded aggregates are grey. Every mode shows exact values through 999
  and `999+` above that, with exact counts retained in accessible text.
- Exported snapshots and settings backups have readable names, such as
  "Terminus Snapshot - Sep 13, 2026 9.25 PM". Files are still recognized by
  their contents, so older exports import as before.
- Privacy and security documentation now distinguishes local-by-default behavior
  from the website-icon requests Terminus initiates.

### Removed

- **Firefox Sync and Terminus Devices.** The Sync tab, remote settings and
  snapshot channels, device list, consent declarations, listeners, and local
  provider state have been removed. Terminus no longer reads or writes
  `storage.sync`; remote values written by an earlier development build are
  intentionally left untouched.

### Fixed

- Undo of a close reopened blank tabs instead of the pages that were closed,
  because the address of each tab was never recorded. A confirmed close now
  records the pages of exactly the tabs it removes, so Undo brings each tab
  back to its own page.
- Moving a tab tree left its nested tabs behind, refused to move a tab whose
  branch was open, or nested the moved tab into the tree above it. Move tab up,
  Move tab down, and dragging now carry the whole tree, step over whole sibling
  trees and groups, and leave a parent or a group in one step.
- Move group up and Move group down could drop a group into the middle of a tab
  tree and split it. A group now steps over a whole tree.
- Create new group left the nested tabs of a collapsed branch outside the new
  group, which also detached them from their parent. Every nested tab now joins
  the group with its tree intact.
- Collapsed tab-tree titles no longer shift across the row or show both a count
  and a duplicate load marker. Group counts now reflect loaded, partial, and
  fully unloaded membership consistently.
- Dropping several selected tabs inside another tab now nests every selected
  root and preserves selected parent/child relationships.
- Shift/Ctrl/Command tab selection now updates rows in place, so favicons remain
  visible throughout multi-tab actions.
- In Icons Only, activating a collapsed tree root expands its branch; clicking
  that active root again collapses it.
- Favicons no longer flash their fallback initial when the tab list re-renders.
  Decoded icons are retained across renders and reattached before the browser
  paints, and only tabs that have never been resolved cost a lookup.
- Private recovery messages appeared and were announced twice. The Privacy panel
  now reports only through its own status region.
- Tab search reported "Tab search is unavailable" for default workspaces, could
  refuse to open a result while Firefox kept a window from fully settling, lost
  focus during other sidebar work, and blanked its results during bursts of tab
  events.
- A narrow sidebar clipped tab rows, status markers, and search controls. Rows
  now compact in stages by the tab pane's own width down to Firefox's minimum
  sidebar width, and right-click still reaches every hidden action.
- Restoring a large snapshot loaded every restored page at once. Tabs now start
  unloaded, restore work runs in bounded batches, and existence checks use one
  window listing instead of one lookup per tab.
- Favicons on sites that use more than one icon address, such as YouTube and
  other video sites after a browser restart, flickered and re-downloaded without
  end because tabs on the same site replaced each other's cached icon. Each icon
  address now keeps its own cached image, a site's other icon stands in until
  the exact one is saved, and address or icon changes keep the current image
  until a replacement is ready. Existing cached icons carry over.
- The sidebar grew slow with many tabs: every tab event re-read each tab's
  identity from Firefox and rebuilt the whole tab list, twice. Identities are
  now remembered for the browser session, unchanged rows are reused, and only
  the background reconcile triggers a refresh. With 1,000 tabs a tab change now
  reaches the sidebar in about 0.2 seconds instead of about 2, and opening the
  sidebar takes under a second instead of 8.
- Switching to a workspace whose remembered tab was not its first tab could show
  a false "not converged yet (close order)" warning.
- Closing and reopening Firefox could put every tab into the first workspace and
  lose tab order, pins, groups, and trees, and later automatic snapshots then
  recorded that state. Firefox can start Terminus before it finishes restoring
  windows, and Terminus discarded the saved layout of any window not open yet.
  A closed window now keeps its workspaces until Firefox restores or reopens it,
  and a window caught mid-restore is read again once restored.
- Favicons could still flash their fallback initial while pages loaded, most
  often right after a restart. A tab whose page started or finished loading
  during a lookup was treated as having no icon, and a failed lookup could clear
  every icon in the sidebar. A tab also no longer swaps its shown icon for
  another icon of the same site each time a different tab saves one.
- An automatic snapshot that was overdue when Firefox started was saved before
  Terminus had caught up with the restored windows, and cleanup could then push
  out the last good automatic snapshot. Overdue saves now wait until Firefox and
  Terminus settle, and one automatic Sidebar Snapshot from before startup is
  kept, marked Startup protected, until you delete it or clear the Snapshot
  Viewer.

### Security

- The base runtime has no dependencies, no content scripts, no page-content
  access, and no telemetry. See [PRIVACY.md](PRIVACY.md).

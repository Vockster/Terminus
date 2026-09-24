# Terminus

Terminus is a Firefox Desktop extension that keeps your tabs organized into workspaces, one for each part of your day. A narrow rail of workspace icons sits in Firefox's sidebar next to the current workspace's tabs, groups, and pins. Switching workspaces hides the other workspaces' tabs without closing them, and snapshots let you save and restore your whole setup. Terminus keeps its data in your Firefox profile and has no Terminus account, server, or cloud sync.

## Features

### Workspaces

- A workspace holds the tabs for one part of your day, like Work or Personal.
- Switching hides the other workspaces' tabs. They stay open, ready for later.
- Each window remembers its own workspace, even after Firefox restarts, and one workspace can be open in several windows.
- Add a workspace with the + at the end of the rail, or in Workspaces settings.
- Separate workspaces on the rail with dividers and flexible spaces from Workspaces settings.
- Workspaces settings shows your rail as you edit it. Select several entries with Shift or Ctrl (Cmd on a Mac), or the keyboard, to give them one icon, color, or default container, move them together, wrap them in dividers, copy and paste them, or remove them at once.
- Removing a workspace never closes its tabs. They move to the next workspace, or to the first remaining one when you remove several, and a safety snapshot is saved first.

### Tabs, groups, and pins

- New tabs join the workspace of the window they open in.
- Firefox tab groups and pinned tabs belong to their workspace.
- Drag tabs or a whole group onto a workspace in the rail to move them there. Firefox's tab menu also has Move Tab to Workspace and Move Group to Workspace.
- Move tab up, Move tab down, and dragging take every tab nested under a tab, even inside a collapsed branch, and step over whole trees and groups.
- Move group up and Move group down step over a whole tree, so a group never splits one. Create new group keeps each selected tab with its nested tabs.
- A collapsed group or branch shows how many tabs it holds. Click a parent's arrow, or its icon in full labels, to expand or collapse its branch.
- Firefox Split View tabs stay together in their workspace. Switching away separates them, because Firefox can't rejoin them.

### Find, close, and undo

- Click the magnifying glass to search every workspace in this window, or only this one, by title or site. Results show each tab's workspace, group, and whether it's pinned or unloaded.
- Use the arrow keys to move through results and Enter to open one, even in another workspace. Press Escape to close search.
- Close a tab, branch, group, or workspace from its right-click menu, or select several tabs and close them together with their nested tabs. Terminus asks first when that closes more than one tab.
- Flatten a branch from its right-click menu to un-nest its tabs without closing any. With several tabs selected, every selected branch is flattened.
- Delete group removes the group but keeps its tabs open.
- Undo brings back your last sidebar change, like a close or a move, and Redo repeats it, until the session ends. It sits beside New tab and in the sidebar's right-click menus.

### Firefox containers

- Containers keep sites apart, like two accounts on the same site. They're optional.
- Turn them on in Workspaces settings. Firefox asks for permission first.
- Give a workspace a default container for tabs opened with its New tab button.
- Moving a tab to another workspace keeps its container.
- Container tabs show a star in the container's color.
- Move to container reopens a tab, or every tab selected, in another container. Each tab keeps its place, nested tabs, group, and pin, but pages reload and sign-ins and form contents don't carry over.
- A page that asks to stay open keeps its own tab, and its copy in the new container is left beside it.
- Open a copy of a tab in another container from Firefox's tab menu.
- Not available in private windows.

### Unloading

- Middle-click a tab to unload it and every tab nested under it.
- Middle-click a group header or a workspace to unload all of its tabs.
- Or choose Unload from a tab's right-click menu.
- Unloaded tabs keep their place and load again when you select them.
- To also take unloaded tabs off Firefox's tab strip, turn on Hide unloaded tabs from Firefox's tab strip in Sidebar settings. They stay in Terminus.
- A tab shows a filled circle while loaded and a dashed circle once unloaded. Container tabs use a filled or outlined star, groups a filled or hollow folder, and collapsed branch, group, and workspace counts show exact values through 999 and `999+` above that. Aggregate counts are plain white while anything they represent is loaded and grey once everything is unloaded.
- Unloading is always on. Only hiding unloaded tabs from Firefox needs a setting.

### Look and feel

- Keep the dark default, follow your Firefox theme, or pick a solid color or a gradient.
- Choose how the current tab is highlighted.
- Workspaces with a default container glow softly in the container's color. Switch to the workspace's color, or turn glow off.
- Settings can use its own background and font size.

### Layout and sizes

- Pick one of four sizes for workspace icons and tabs.
- Show full labels, or icons only for a slimmer sidebar.
- Show tab search at the top or bottom of the tab list, in full labels or icons only.
- Drag Firefox's sidebar narrower and rows shrink to fit. Right-click still opens every action when the ... buttons hide.
- Hide the ... buttons altogether if you'd rather use right-click.
- Lock the rail so workspaces can't be dragged by accident.
- Hide the + at the end of the rail if you don't need it.

### Workspace icons

- Choose from 40 built-in icons.
- Add your own pictures with Add Icons. They stay on this computer, keep their own colors, and are left out of backups.
- Export setup in Workspaces settings saves one zip with every workspace, the rail's order, and all your custom icons. Import setup reads it back, on this computer or another one.

### Snapshots and backups

- A snapshot saves your workspaces, tabs, groups, and window layout.
- Save one any time, or turn on automatic snapshots on a schedule.
- Settings Backups save your preferences only.
- Automatic saves stop at the maximum you choose, and the oldest is removed first. Manual saves stay until you delete them.
- Changing those limits asks first if saves you already have would be removed.
- One automatic Sidebar Snapshot from before Firefox started is marked Startup protected and kept until you delete it or clear the Snapshot Viewer.
- Exported files go to Downloads, in Snapshots & Settings, with names like "Terminus Snapshot - Sep 13, 2026 9.25 PM". Terminus reads a file's contents, not its name, so older exports still import.

### Restoring

- Browse your saved snapshots in the Snapshot Viewer.
- Restore everything, one window, or only the tabs you pick.
- Restoring replaces the tabs you have open. A safety snapshot of them is taken first.
- Restored tabs stay unloaded until you select them, so even a very large snapshot opens without loading every page. Choose how many tabs open at a time in Snapshots (10 by default); that choice stays in this Firefox profile.
- Pick a Firefox container for each saved container, or ignore containers.
- Pages come back, but not what you typed into them or your sign-ins.
- Import Bookmarks reads your Firefox bookmarks or another browser's exported bookmarks file, and you pick which ones to bring in. Terminus only reads bookmarks; it never changes or deletes them.
- New Workspace puts the bookmarks you picked into an Imported bookmarks workspace of unloaded tabs, with a group for each folder.

### Private windows

- Terminus works in private windows once you allow it in Firefox's Add-ons Manager.
- Private windows share your workspaces but keep their own tabs.
- Private tabs aren't kept after private browsing ends, unless you turn on private recovery.

### Storage

- See every website icon Terminus has cached, with the exact icon count and cache size.
- Remove icons unused by open tabs or snapshots, or clear the whole website-icon cache.
- Private windows cannot view or change the normal-window icon cache.

### Optional Firefox styling

- An optional style sheet hides the header bar Firefox draws across the top of the sidebar. Download it from Optional Firefox Styling in Settings.
- Terminus works the same without it, and never installs it or checks for it. Settings walks you through installing it in your Firefox profile, undoing it, and fixing common problems.
- It hides that header for every sidebar in the profile, not only Terminus, and a Firefox update can stop it working.

The Overview tab in Terminus Settings gives a short tour of these features and links to their settings.

## Privacy

Your workspaces and saves stay in this Firefox profile unless you explicitly export a file. Terminus has no account, cloud sync, analytics, or telemetry, and it never reads page contents, cookies, or sign-ins. Website icons are downloaded from the site or the icon host it declares and cached locally; Terminus uses no separate icon lookup service. Snapshots and exported snapshot files contain tab addresses and titles. When containers are used, non-private snapshots also contain logical container assignments and saved container names, colors, and icons. Treat them like browsing history.

[PRIVACY.md](PRIVACY.md) sets out exactly what is stored, what leaves this computer, and why each permission exists.

## Requirements

Firefox Desktop 153 or newer. Firefox for Android and other browsers are not supported.

## Development

Terminus has no runtime dependencies. The development tools need Node.js 22 or newer.

```sh
npm install
npm test
npm run lint:extension
npm run check:tooling
npm run test:firefox -- --no-reload
```

- `npm test` runs the unit and contract tests.
- `npm run lint:extension` checks the extension with web-ext; warnings count as failures.
- `npm run check:tooling` confirms Node, web-ext, and Firefox are ready.
- `npm run test:firefox -- --no-reload` opens Firefox with Terminus loaded in a new, temporary profile that is thrown away when you close it. It never uses your own Firefox profile.

Release history is in [CHANGELOG.md](CHANGELOG.md). To report a security problem, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Credits

- Icons derived from Mozilla Firefox are used under the Mozilla Public License 2.0; each file carries its own notice.
- Lucide icons are used under the ISC License, with the Feather MIT notice; see [`src/assets/icons/LICENSE.lucide.txt`](src/assets/icons/LICENSE.lucide.txt).
- The remaining icons are original Terminus artwork.

## License

Terminus is released under the Mozilla Public License 2.0. The full text is in [LICENSE](LICENSE).

Bundled icons keep their own notices: Mozilla-derived files remain under the MPL 2.0, and Lucide icons remain under the ISC License.

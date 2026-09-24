# Privacy Policy

**Terminus has no account or server, does not sell your data, and includes no
analytics or telemetry.** Its local features keep your data in your Firefox
profile unless you explicitly export a file. Terminus has no cloud-sync
feature. It can fetch a site's icon from a host you allow.

This document describes Terminus 0.1.0.

## What Terminus stores on your computer

| Data | Where | Why |
|---|---|---|
| Workspace definitions: names, icons, colors, rail order | `storage.local` | The workspaces you created |
| Tab, group, pin, and window layout for each workspace | `storage.local` | Restoring your organization after a restart |
| Preferences, including privacy preferences | `storage.local` | Your settings |
| Snapshots and settings backups you save | `storage.local` | Restoring a previous setup |
| Custom workspace icons you add | IndexedDB, 128×128 PNG copies | Showing the icon you chose |
| Website icons (favicons) | IndexedDB | Drawing tabs without refetching every time |
| Private-window tabs | `storage.session` by default | Discarded when the last private window closes |
| One sidebar Undo/Redo slot per window and browsing scope | `storage.session` | Reversing or reapplying the latest eligible sidebar action; a close entry may briefly include the affected tabs' addresses and titles |

Extension storage is **not encrypted**. Anyone with access to your Firefox
profile directory can read it, exactly as they could read your browsing history.

## What Terminus never does

- It never reads the contents of the pages you visit. It has no content scripts
  and no page-content access.
- It never reads, copies, or transmits cookies, sign-ins, passwords, form
  contents, or session data.
- It never sends usage data, crash reports, telemetry, or any analytics.
- It never contacts a Terminus server, because there is none.
- It never reads or writes Firefox Sync storage.
- It never deletes files outside the exports it created and you asked it to
  manage.

## Data that is sensitive

**Snapshots and exported snapshot files contain tab addresses, titles, and
logical container assignments.** When a snapshot uses containers, it also stores
their names, colors, and icons so you can map them during restore. Treat an
exported snapshot the way you would treat exported browsing history. Settings
backups contain preferences only: no tabs, addresses, workspaces, containers, or
custom icons.

**Sidebar Undo/Redo is session-only and may contain tab addresses and titles
after a close.** It keeps at most one reversible slot per Firefox window and
normal/private scope, is replaced by the next eligible action, and is cleared
with that window or browser session. It is never exported, backed up, or sent
to a remote service.

**Tab search reads each tab's site and page path while you search.** It uses
them only in memory to match what you type, drops query strings, fragments, and
sign-in details first, never shows or stores them, and never searches another
window.

**The website-icon cache records the origin of sites you visit** (for example
`https://example.com`), because that is how an icon is looked up again. Each icon
is also keyed by a one-way fingerprint (SHA-256) of the icon address the site
declared, so tabs on one site that use different icons each keep their own. It
stores no page paths, query strings, titles, or readable addresses. It is never
written from a private window.

## Extension-initiated website requests

The only website request Terminus initiates is downloading a website's icon from
that website or from the icon host the site declares. There is no separate icon
lookup service, and Terminus adds no device ID, account ID, analytics ID, or
browsing-history payload to the request.

Some sites host their icon elsewhere. Terminus asks for permission for that one
host before it will fetch from it, and you can revoke it later in Firefox's
Add-ons Manager.

## Private windows

Firefox controls whether Terminus runs in private windows at all; you allow or
deny it in the Add-ons Manager.

Private browsing uses a separate, session-only runtime. Private tabs are not kept
after private browsing ends unless you turn on private recovery in Privacy
settings. Private data stays separate from normal browsing, and private
recovery and private snapshots exclude cookies, form state, and container
assignments. Turning private recovery off keeps the current recovery until the
last private window closes; Clear Recovery removes it immediately.

## Earlier development builds

Earlier development builds could write preferences, one selected snapshot, and
device-list records to Firefox Sync. The current build does not read, write, or
delete that remote account data. Upgrading intentionally leaves it untouched;
use Firefox's account/profile controls or an older compatible build if you need
to inspect or remove it.

## Firefox containers

Container support is optional and unavailable in private windows. Firefox
requires the `contextualIdentities` permission at install time, and Terminus
requests the optional `cookies` permission only when you enable containers.

**Terminus never calls the cookies API.** Firefox requires that permission solely
to open a tab in a container you chose. Firefox's native `cookieStoreId` values
stay on this computer and never appear in exported files.
Non-private snapshots use Terminus-only references plus container names, colors,
and icons so you can remap them during restore; private records contain no
container assignments.

## Permissions and why they exist

| Permission | Why |
|---|---|
| `tabs`, `tabHide`, `tabGroups`, `sessions` | Move, hide, group, and remember tabs, which is the core feature |
| `storage`, `unlimitedStorage` | Keep your workspaces and snapshots locally |
| `alarms` | Run scheduled automatic snapshots |
| `menus`, `theme`, `search` | Right-click actions, matching your Firefox theme, new-tab behavior |
| `contextualIdentities` | Container support. Firefox does not allow this one to be optional |
| `cookies` (optional) | Required by Firefox to open a tab in a chosen container. Never used to read cookies |
| `downloads` (optional) | Export a snapshot or backup to a file you asked for |
| `bookmarks` (optional) | Read your Firefox bookmarks when you import them into a workspace. Terminus never changes or deletes bookmarks |
| `https://*/*` (optional, per host) | Fetch a website's icon from the host that site declares |

Importing bookmarks stays on this computer. The bookmarks you pick become
ordinary tabs in a new workspace, and neither the bookmarks you read nor the
file you chose is sent anywhere. Terminus reads bookmarks only while an import
is running, and it never creates, edits, moves, or deletes a bookmark.

## Your control

- Delete any snapshot or backup from the Snapshot Viewer or Snapshots settings.
- Clear private recovery immediately from Privacy settings.
- Revoke any granted host, the cookies permission, or the bookmarks permission in
  Firefox's Add-ons Manager.
- Remove unused website icons or clear the whole cache from Storage settings.
- Uninstalling Terminus removes its local storage with it. Files you exported
  yourself are yours and are not touched.

## Changes

Material changes to this policy will be recorded in [CHANGELOG.md](CHANGELOG.md).

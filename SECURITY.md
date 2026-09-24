# Security Policy

## Supported versions

Only the latest release is supported.

| Version | Supported |
|---|---|
| 0.1.0 (latest) | Yes |
| Anything else | No |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately to the maintainer. If this repository is hosted on GitHub,
use **Security → Report a vulnerability** to open a private advisory. Otherwise
contact the maintainer directly.

Please include:

- What the issue allows an attacker to do.
- The Firefox version and operating system.
- Exact steps to reproduce, with a synthetic profile rather than your own.
- Whether any real browsing data was involved, so it can be handled carefully.

Expect an acknowledgement within a week. Please give a reasonable window to
ship a fix before disclosing publicly.

## What counts as a vulnerability

Terminus is a local, dependency-free extension with no server and no account, so
the interesting boundaries are these:

- **Data leaving the device unexpectedly.** Any path that sends workspace data,
  addresses, titles, preferences, or device metadata outside the documented
  export and permitted website-icon behaviors.
- **Private-window leakage.** Any path where private-window tabs, recovery data,
  or history reaches normal-window storage or an exported file.
- **Cookie or session exposure.** Terminus never calls the cookies API. Any path
  that reads, copies, or transmits cookies or session data is a vulnerability.
- **Page-content access.** Terminus has no content scripts. Any path that reads
  page contents is a vulnerability.
- **Destructive behavior without consent.** Closing tabs, deleting snapshots, or
  removing files outside a user-initiated action and its documented warning or
  Undo behavior.
- **Validation bypass.** A crafted snapshot or settings backup that mutates
  stored state before it has been validated, or that escapes its schema.

## What does not count

- Extension storage is not encrypted. Anyone with access to the Firefox profile
  directory can read it, which is documented in [PRIVACY.md](PRIVACY.md).
- Snapshots and exported files contain addresses and titles by design.
- Firefox restrictions that Terminus surfaces rather than bypasses, such as
  refusing to hide an active, pinned, or sharing tab.
- Development-only advisories in `web-ext` and its dependency tree. No runtime
  package ships with the extension.

## Scope

This policy covers the extension source in `src/` and the manifest. Development
tooling in `scripts/` and `node_modules/` is out of scope, as is Firefox itself.

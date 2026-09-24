import { WORKSPACE_GROUP_COLORS } from "../contracts/workspace-runtime.js";

// Firefox identifies a tab group by a color name, not by a CSS color. Handing
// that name straight to CSS picks the keyword palette instead of Firefox's, so
// plain `yellow` and `cyan` wash out on a light surface and `grey` sinks into a
// dark one. Each name resolves to a pair tuned for both surfaces; the sidebar
// follows the browser theme and Settings has its own scheme, so the choice is
// left to `light-dark()` at use rather than decided here.
const GROUP_COLOR_SCHEME_PAIRS = Object.freeze({
  grey: Object.freeze(["#5b5b66", "#b1b1bd"]),
  blue: Object.freeze(["#0060df", "#6aa6ff"]),
  red: Object.freeze(["#d70022", "#ff6a75"]),
  yellow: Object.freeze(["#a47f00", "#ffd400"]),
  green: Object.freeze(["#058b00", "#63c56a"]),
  pink: Object.freeze(["#d846b9", "#ff8fd6"]),
  purple: Object.freeze(["#7542e5", "#b39bff"]),
  cyan: Object.freeze(["#007f8c", "#4dd8e6"]),
  orange: Object.freeze(["#c25400", "#ffa84c"])
});

const FALLBACK_GROUP_COLOR = "grey";

// Every name the runtime accepts must have a color, or a group Firefox allows
// would render as the fallback and look like a different group.
for (const name of WORKSPACE_GROUP_COLORS) {
  if (!Object.hasOwn(GROUP_COLOR_SCHEME_PAIRS, name)) {
    throw new TypeError(`Tab group color ${name} has no palette entry.`);
  }
}

// Returns a CSS color for `--group-color`. An unrecognized name falls back
// rather than leaving the property unset, which would silently show the
// accent color as if the group had no color of its own.
export function groupColorToken(color) {
  const [light, dark] = GROUP_COLOR_SCHEME_PAIRS[color]
    ?? GROUP_COLOR_SCHEME_PAIRS[FALLBACK_GROUP_COLOR];
  return `light-dark(${light}, ${dark})`;
}

import { isCustomIconId } from "./custom-icons.js";

function catalogIcon(id, label) {
  return Object.freeze({
    kind: "catalog",
    id,
    label,
    path: `../assets/icons/workspace/${id}.svg`,
    opticalScale: 1
  });
}

export const WORKSPACE_ICON_CATALOG = Object.freeze([
  catalogIcon("house", "House"),
  catalogIcon("user", "User"),
  catalogIcon("notebook-pen", "Notebook"),
  catalogIcon("briefcase-business", "Briefcase business"),
  catalogIcon("audio-lines", "Audio lines"),
  catalogIcon("book-a", "Book A"),
  catalogIcon("book-bookmark", "Book bookmark"),
  catalogIcon("book-heart", "Book heart"),
  catalogIcon("book-open", "Book open"),
  catalogIcon("book-open-text", "Book with text"),
  catalogIcon("brick-wall-shield", "Brick wall shield"),
  catalogIcon("car", "Car"),
  catalogIcon("circle-dollar-sign", "Circle dollar sign"),
  catalogIcon("cross", "Cross"),
  catalogIcon("crown", "Crown"),
  catalogIcon("engine", "Engine"),
  catalogIcon("fingerprint-pattern", "Fingerprint pattern"),
  catalogIcon("gem", "Gem"),
  catalogIcon("glasses", "Glasses"),
  catalogIcon("heart", "Heart"),
  catalogIcon("image", "Image"),
  catalogIcon("library-big", "Library"),
  catalogIcon("mail", "Mail"),
  catalogIcon("package", "Package"),
  catalogIcon("paw-print", "Paw print"),
  catalogIcon("shield-cog-corner", "Shield with cog"),
  catalogIcon("shield-keyhole", "Shield keyhole"),
  catalogIcon("shopping-cart", "Shopping cart"),
  catalogIcon("shopping-cart-minus", "Shopping cart minus"),
  catalogIcon("shopping-cart-plus", "Shopping cart plus"),
  catalogIcon("star", "Star"),
  catalogIcon("summary", "Summary"),
  catalogIcon("tickets-plane", "Tickets plane"),
  catalogIcon("tree-palm", "Tree palm"),
  catalogIcon("trophy", "Trophy"),
  catalogIcon("users", "Users"),
  catalogIcon("utensils-crossed", "Utensils crossed"),
  catalogIcon("van", "Van"),
  catalogIcon("wallet", "Wallet"),
  catalogIcon("wrench", "Wrench")
]);

const ICON_BY_ID = new Map(WORKSPACE_ICON_CATALOG.map((icon) => [icon.id, icon]));

export const FALLBACK_WORKSPACE_ICON = ICON_BY_ID.get("house");

// Stored IDs are never rewritten. Each retired ID renders the new icon that
// matches what it displayed before this catalog replaced the Firefox set.
const RETIRED_ICON_ALIASES = new Map([
  ["briefcase", "briefcase-business"],
  ["books", "briefcase-business"],
  ["folder", "briefcase-business"],
  ["fingerprint", "fingerprint-pattern"],
  ["home", "fingerprint-pattern"],
  ["code", "fingerprint-pattern"],
  ["dollar", "circle-dollar-sign"],
  ["cart", "shopping-cart"],
  ["circle", "star"],
  ["app", "star"],
  ["calendar", "star"],
  ["gift", "package"],
  ["vacation", "tickets-plane"],
  ["food", "utensils-crossed"],
  ["fruit", "utensils-crossed"],
  ["pet", "paw-print"],
  ["tree", "tree-palm"],
  ["flask", "tree-palm"],
  ["compass", "tree-palm"],
  ["chill", "glasses"],
  ["coffee", "glasses"],
  ["gamepad", "glasses"],
  ["fence", "brick-wall-shield"]
]);

export function isWorkspaceIconId(iconId) {
  return ICON_BY_ID.has(iconId) || RETIRED_ICON_ALIASES.has(iconId) || isCustomIconId(iconId);
}

export function resolveWorkspaceIcon(iconId) {
  if (isCustomIconId(iconId)) {
    return Object.freeze({ kind: "custom", id: iconId });
  }
  return ICON_BY_ID.get(RETIRED_ICON_ALIASES.get(iconId) ?? iconId) ?? FALLBACK_WORKSPACE_ICON;
}

// Packaged copies of Firefox's container icons, used wherever a preview has no
// native resource:// icon URL. Unknown icon names fall back to the circle.
export const LOCAL_CONTAINER_ICON_IDS = Object.freeze([
  "fingerprint",
  "briefcase",
  "dollar",
  "cart",
  "circle",
  "gift",
  "vacation",
  "food",
  "fruit",
  "pet",
  "tree",
  "chill",
  "fence"
]);

export const CONTAINER_ICON_FALLBACK_ID = "circle";

const LOCAL_ICON_IDS = new Set(LOCAL_CONTAINER_ICON_IDS);

export function containerIconAssetPath(iconId) {
  const assetId = LOCAL_ICON_IDS.has(iconId) ? iconId : CONTAINER_ICON_FALLBACK_ID;
  return `../assets/icons/${assetId}.svg`;
}

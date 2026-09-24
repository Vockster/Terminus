export const COUNT_BADGE_MAXIMUM = 999;

export function countBadgeText(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError("A count badge requires a non-negative integer.");
  }
  return count > COUNT_BADGE_MAXIMUM ? `${COUNT_BADGE_MAXIMUM}+` : String(count);
}

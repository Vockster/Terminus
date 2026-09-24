export function restorableUrl(url) {
  if (typeof url !== "string") {
    return { url: "about:blank", supported: false };
  }
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "ftp:", "file:"].includes(parsed.protocol)) {
      return { url, supported: true };
    }
    if (parsed.protocol === "about:" && parsed.pathname === "blank") {
      return { url: "about:blank", supported: true };
    }
  } catch {
    // Firefox can report privileged pseudo-URLs that extensions cannot recreate.
  }
  return { url: "about:blank", supported: false };
}

import { CUSTOM_ICON_MIME_TYPE } from "../contracts/custom-icons.js";

// Holds one object URL per stored custom icon, keyed by ID and digest, and
// revokes each URL once its image is replaced, removed, or disposed.
export class CustomIconUrlCache {
  #createObjectURL;
  #revokeObjectURL;
  #entries = new Map();

  constructor({
    createObjectURL = (blob) => URL.createObjectURL(blob),
    revokeObjectURL = (url) => URL.revokeObjectURL(url)
  } = {}) {
    this.#createObjectURL = createObjectURL;
    this.#revokeObjectURL = revokeObjectURL;
  }

  replace(icons) {
    const next = new Map();
    for (const icon of icons) {
      const existing = this.#entries.get(icon.id);
      const url = existing?.digest === icon.digest
        ? existing.url
        : this.#createObjectURL(new Blob([icon.bytes], { type: CUSTOM_ICON_MIME_TYPE }));
      next.set(icon.id, Object.freeze({ id: icon.id, label: icon.label, digest: icon.digest, url }));
    }
    for (const [id, entry] of this.#entries) {
      if (next.get(id)?.url !== entry.url) this.#revokeObjectURL(entry.url);
    }
    this.#entries = next;
  }

  get(id) {
    return this.#entries.get(id) ?? null;
  }

  list() {
    return [...this.#entries.values()];
  }

  dispose() {
    for (const entry of this.#entries.values()) this.#revokeObjectURL(entry.url);
    this.#entries.clear();
  }
}

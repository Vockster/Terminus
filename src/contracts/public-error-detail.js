// Validation failures carry a short reason built only from contract labels,
// indexes, allowlisted keys, and schema constants — never from stored or
// imported values — so it is safe to show beside the public message.
export const PUBLIC_ERROR_MESSAGE_MAX_LENGTH = 300;

export function errorDetail(options) {
  return typeof options?.detail === "string" && options.detail.trim().length > 0
    ? options.detail.trim()
    : null;
}

export function publicMessageWithDetail(message, detail) {
  const full = typeof detail === "string" && detail.length > 0 ? `${message} ${detail}` : message;
  return full.length > PUBLIC_ERROR_MESSAGE_MAX_LENGTH
    ? `${full.slice(0, PUBLIC_ERROR_MESSAGE_MAX_LENGTH - 1)}…`
    : full;
}

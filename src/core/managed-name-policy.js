export function normalizeManagedName(value) {
  return value.trim().normalize("NFC");
}

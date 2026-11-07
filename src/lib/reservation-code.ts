/**
 * Reservation codes: "FM-" + 5 characters from an alphabet without look-alikes
 * (no 0/O, no 1/I). Codes are generated in the database
 * (private.new_reservation_code); this module checks and normalises what people type.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_RE = /^FM-[2-9A-HJ-NP-Z]{5}$/;

/** " fm 7k3qx " / "fm7k3qx" / "FM-7K3QX" → "FM-7K3QX" (or null if it can't be a code). */
export function normalizeCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s\-_.]/g, '');
  const body = compact.startsWith('FM') ? compact.slice(2) : compact;
  const code = `FM-${body}`;
  return CODE_RE.test(code) ? code : null;
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

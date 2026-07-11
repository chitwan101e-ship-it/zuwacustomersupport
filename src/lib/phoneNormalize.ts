/**
 * Strip to digits only for duplicate detection across country formats (+44, 0044, spaces, etc.).
 * Returns null if empty or too short to treat as a real phone key.
 */
export function normalizePhoneForDedup(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const digits = t.replace(/\D/g, '')
  if (digits.length < 8) return null
  return digits
}

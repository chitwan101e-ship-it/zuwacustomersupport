/** Extract storage object path from a message-images public/signed URL. */
export function storagePathFromMessageImageUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  const marker = '/message-images/'
  const idx = trimmed.indexOf(marker)
  if (idx === -1) return null
  const raw = trimmed.slice(idx + marker.length).split('?')[0]
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

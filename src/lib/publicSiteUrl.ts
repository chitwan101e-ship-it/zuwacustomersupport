/**
 * Public site base URL for links in outbound emails (should be production, not localhost).
 * Priority: PUBLIC_SITE_URL → https://NEXT_PUBLIC_ROOT_DOMAIN → NEXT_PUBLIC_APP_URL
 */
export function getPublicSiteUrl(): string {
  const explicit =
    process.env.PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim()
  if (root) {
    const host = root.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    return `https://${host}`
  }

  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '')
}

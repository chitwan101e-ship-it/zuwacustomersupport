import { getPublicSiteUrl } from '@/lib/publicSiteUrl'

/** In-app path to open a specific feed announcement. */
export function postFeedPath(announcementId: string): string {
  return `/feed?post=${encodeURIComponent(announcementId)}`
}

/** Full public URL for sharing (emails, clipboard, native share sheet). */
export function postShareUrl(announcementId: string, origin?: string): string {
  const base = (origin ?? getPublicSiteUrl()).replace(/\/$/, '')
  return `${base}${postFeedPath(announcementId)}`
}

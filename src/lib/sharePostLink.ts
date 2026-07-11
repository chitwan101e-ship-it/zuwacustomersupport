import { postShareUrl } from '@/lib/postShareUrl'

export type SharePostResult = 'shared' | 'copied'

/**
 * Opens the native share sheet when available; otherwise copies the post URL.
 * @throws if the user dismisses the native share sheet (AbortError).
 */
export async function sharePostLink(options: {
  announcementId: string
  title?: string
  text?: string
  origin?: string
}): Promise<SharePostResult> {
  const url = postShareUrl(
    options.announcementId,
    options.origin ?? (typeof window !== 'undefined' ? window.location.origin : undefined)
  )

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share({
      title: options.title?.trim() || 'Relay post',
      text: options.text?.trim() || undefined,
      url,
    })
    return 'shared'
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
    return 'copied'
  }

  throw new Error('Copy is not supported in this browser.')
}

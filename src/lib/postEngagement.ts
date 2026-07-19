import type { SupabaseClient } from '@supabase/supabase-js'

/** PostgREST returns at most ~1000 rows per request unless paginated with `.range()`. */
export const ENGAGEMENT_PAGE_SIZE = 1000
/** Keep `.in()` URL filters under proxy length limits. */
export const ENGAGEMENT_ID_CHUNK = 80

type PageResult<T> = { data: T[] | null; error: { message?: string; code?: string } | null }

/**
 * Exhaustively load rows for a set of announcement IDs.
 * Chunks `.in()` filters and pages with `.range()` so viral posts are not truncated at 1000.
 */
export async function fetchAllForAnnouncementIds<T>(
  ids: string[],
  fetchPage: (slice: string[], from: number, to: number) => Promise<PageResult<T>>
): Promise<{ rows: T[]; error: { message?: string; code?: string } | null }> {
  const rows: T[] = []
  if (ids.length === 0) return { rows, error: null }

  for (let i = 0; i < ids.length; i += ENGAGEMENT_ID_CHUNK) {
    const slice = ids.slice(i, i + ENGAGEMENT_ID_CHUNK)
    let from = 0
    for (;;) {
      const { data, error } = await fetchPage(slice, from, from + ENGAGEMENT_PAGE_SIZE - 1)
      if (error) return { rows, error }
      const page = data || []
      rows.push(...page)
      if (page.length < ENGAGEMENT_PAGE_SIZE) break
      from += ENGAGEMENT_PAGE_SIZE
    }
  }

  return { rows, error: null }
}

export type StaffEngagementCountRow = {
  announcement_id: string
  like_count: number | string
  comment_count: number | string
}

/** Aggregated like/comment counts for staff posts (avoids PostgREST row caps). */
export async function fetchStaffEngagementCounts(
  client: SupabaseClient,
  businessId: string,
  announcementIds: string[]
): Promise<{ counts: Record<string, { likes: number; comments: number }>; error: string | null }> {
  const counts: Record<string, { likes: number; comments: number }> = {}
  for (const id of announcementIds) {
    counts[id] = { likes: 0, comments: 0 }
  }
  if (announcementIds.length === 0) return { counts, error: null }

  const { data, error } = await client.rpc('staff_post_engagement_counts', {
    p_business_id: businessId,
    p_announcement_ids: announcementIds,
  })

  if (error) return { counts, error: error.message }

  for (const row of (data || []) as StaffEngagementCountRow[]) {
    const id = row.announcement_id
    if (!counts[id]) counts[id] = { likes: 0, comments: 0 }
    counts[id].likes = Number(row.like_count) || 0
    counts[id].comments = Number(row.comment_count) || 0
  }

  return { counts, error: null }
}

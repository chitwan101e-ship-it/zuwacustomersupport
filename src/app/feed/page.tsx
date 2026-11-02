'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markConversationNotificationsRead } from '@/lib/markConversationNotificationsRead'
import {
  countConversationsWithUnreadFromTeam,
  loadCustomerChatPreviews,
  CUSTOMER_MESSAGE_SELECT,
  CUSTOMER_MESSAGE_SELECT_LEGACY,
  CUSTOMER_MESSAGE_SELECT_BASE,
  fetchLatestConversationMessages,
  hydrateReplyEmbeds,
  isReplyToSchemaError,
  oneMessageEmbed as oneReplyEmbed,
  replyAuthorLabel,
  replyPreviewText,
  type ChatPreview,
  type MessageReplyEmbed,
  type ReplyTargetMessage,
} from '@/lib/customerMessaging'
import { markMessagesReadByIds } from '@/lib/markMessagesReadByIds'
import { draftListLabel, omitRecordKey, readChatDraftMap, writeChatDraft } from '@/lib/chatDrafts'
import { useMarkMessagesReadOnView } from '@/lib/useMarkMessagesReadOnView'
import { pickPrimaryBusinessFromList } from '@/lib/signupApproval'
import RelayLogo from '@/components/RelayLogo'
import { CustomerMobileFooterNav } from '@/components/CustomerMobileFooterNav'
import { SpinReceiptCard } from '@/components/SpinReceiptCard'
import { parseSpinReceipt } from '@/lib/luckySpin'
import { LUCKY_SPIN_SNOOZE_KEY, LuckySpinModal } from '@/components/LuckySpinModal'
import { CustomerRefreshButton } from '@/components/CustomerRefreshButton'
import clsx from 'clsx'
import {
  ThumbsUp,
  MessageCircle,
  Bell,
  Send,
  Loader2,
  Building2,
  ChevronDown,
  ChevronUp,
  Home,
  X,
  ChevronRight,
  ImagePlus,
  Check,
  CheckCheck,
  Share2,
} from 'lucide-react'
import {
  ChatMessageImage,
  MessageReplyQuote,
  ReplyTargetBar,
} from '@/components/ChatMessageImage'
import { ChatJumpToLatestButton } from '@/components/ChatJumpToLatestButton'
import { useChatScrollToLatest } from '@/lib/useChatScrollToLatest'
import { ContentModerationMenu } from '@/components/ContentModerationMenu'
import { sharePostLink } from '@/lib/sharePostLink'
import { FeedPostImage } from '@/components/FeedPostImage'
import { LinkifiedText } from '@/components/LinkifiedText'
import { ExpandablePostText } from '@/components/ExpandablePostText'

type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  first_name?: string | null
  avatar_url?: string | null
  account_status?: string
}
type BusinessRow = {
  id: string
  name: string
  slug: string
  logo_url?: string | null
  admin_avatar_url?: string | null
}
type BizEmbed = { id: string; name: string; slug: string; logo_url?: string | null }
type AuthorEmbed = {
  avatar_url?: string | null
  first_name?: string | null
  last_name?: string | null
  username?: string
}
type AnnouncementRow = {
  id: string
  title: string
  body: string
  image_url?: string | null
  created_at: string
  business_id: string
  author_id?: string
  businesses: BizEmbed | BizEmbed[] | null
  author?: AuthorEmbed | AuthorEmbed[] | null
}
type ProfileEmbed = {
  username: string
  first_name: string
  last_name: string
  avatar_url?: string | null
  role?: string
  business_role?: string | null
}
type CommentRow = {
  id: string
  announcement_id: string
  parent_comment_id?: string | null
  body: string
  created_at: string
  user_id: string
  hidden_at?: string | null
  profiles?: ProfileEmbed | ProfileEmbed[] | null
}
type ConversationRow = { id: string; business_id: string; customer_id: string; status: string }
type MessageSenderEmbed = {
  username: string
  first_name: string
  last_name: string
  role: string
  business_role: string | null
  avatar_url?: string | null
}
type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  image_url?: string | null
  read?: boolean | null
  read_at?: string | null
  reply_to_message_id?: string | null
  reply_to?: MessageReplyEmbed | MessageReplyEmbed[] | null
  profiles?: MessageSenderEmbed | MessageSenderEmbed[] | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`
  return new Date(iso).toLocaleDateString()
}

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean)
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase()
  return (p[0]?.slice(0, 2) || '?').toUpperCase()
}

function teamAvatarUrl(
  embed: MessageSenderEmbed | null,
  biz: BusinessRow | null | undefined
): string | null {
  return (
    embed?.avatar_url?.trim() ||
    biz?.logo_url?.trim() ||
    biz?.admin_avatar_url?.trim() ||
    null
  )
}

function businessChatAvatarUrl(biz: BusinessRow | null | undefined): string | null {
  return biz?.logo_url?.trim() || biz?.admin_avatar_url?.trim() || null
}

function ChatAvatar({
  name,
  imageUrl,
  className,
  gradient,
  ink = 'text-white',
}: {
  name: string
  imageUrl?: string | null
  className: string
  gradient: string
  ink?: string
}) {
  if (imageUrl?.trim()) {
    return (
      <img
        src={imageUrl.trim()}
        alt={`${name} avatar`}
        className={`${className} rounded-full object-cover border border-[#f0c86a]/45 shrink-0`}
      />
    )
  }
  return (
    <div
      className={`${className} rounded-full flex items-center justify-center font-bold border border-[#fff1c2]/70 shrink-0 ${ink}`}
      style={{ background: gradient }}
    >
      {initials(name)}
    </div>
  )
}

function announcementAvatarUrl(a: AnnouncementRow): string | null {
  const biz = one(a.businesses)
  const author = one(a.author)
  return biz?.logo_url?.trim() || author?.avatar_url?.trim() || null
}

async function loadBusinessRows(supabase: ReturnType<typeof createClient>): Promise<BusinessRow[]> {
  const { data: biz, error: bErr } = await supabase
    .from('businesses')
    .select('id, name, slug, logo_url')
    .order('name')

  if (bErr || !biz?.length) return (biz || []) as BusinessRow[]

  const bizIds = biz.map((b) => (b as { id: string }).id)
  const adminAvatarByBiz: Record<string, string> = {}

  const { data: admins } = await supabase
    .from('profiles')
    .select('business_id, avatar_url')
    .eq('role', 'business')
    .eq('business_role', 'admin')
    .in('business_id', bizIds)
    .not('avatar_url', 'is', null)

  for (const row of admins || []) {
    const r = row as { business_id: string; avatar_url: string | null }
    const url = r.avatar_url?.trim()
    if (url) adminAvatarByBiz[r.business_id] = url
  }

  return (biz as BusinessRow[]).map((b) => ({
    ...b,
    admin_avatar_url: adminAvatarByBiz[b.id] ?? null,
  }))
}

function isAdminComment(c: CommentRow): boolean {
  const p = one(c.profiles)
  return p?.role === 'business' && p?.business_role === 'admin'
}

const COMMENT_PROFILE_SELECT =
  'username, first_name, last_name, avatar_url, role, business_role'
const COMMENT_LIST_SELECT = `
  id,
  announcement_id,
  parent_comment_id,
  body,
  created_at,
  user_id,
  hidden_at,
  profiles ( ${COMMENT_PROFILE_SELECT} )
`
/** First open shows a short list. View more brings the next older page. */
const COMMENT_PREVIEW = 6
const COMMENT_MORE = 12

function commentsByParent(comments: CommentRow[]) {
  const map = new Map<string | null, CommentRow[]>()
  for (const c of comments) {
    const k = c.parent_comment_id ?? null
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(c)
  }
  for (const [parentId, arr] of map.entries()) {
    if (parentId === null) {
      arr.sort((a, b) => {
        const aAdmin = isAdminComment(a)
        const bAdmin = isAdminComment(b)
        if (aAdmin !== bAdmin) return aAdmin ? -1 : 1
        return +new Date(a.created_at) - +new Date(b.created_at)
      })
    } else {
      arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    }
  }
  return map
}

function extFromImageFile(f: File) {
  if (f.type === 'image/png') return 'png'
  if (f.type === 'image/webp') return 'webp'
  if (f.type === 'image/gif') return 'gif'
  return 'jpg'
}

function greetingByHour(d = new Date()) {
  const hour = d.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 22) return 'Good evening'
  return 'Good night'
}

function isPostNote(type: string) {
  return type === 'announcement' || type === 'alert' || type === 'update'
}

function isReplyNote(type: string) {
  return type === 'support_reply' || type === 'support_reply_reminder' || type === 'support_message'
}

function isAccountNote(type: string) {
  return type === 'account_approved' || type.includes('account') || type.includes('suspend')
}

function describeHomeStatus(opts: {
  chatUnread: number
  noteCount: number
  noteTypes: string[]
  teamName: string
  hasPosts: boolean
}): { text: string; action: 'chat' | 'notes' | null } {
  const { chatUnread, noteCount, noteTypes, teamName, hasPosts } = opts
  if (chatUnread > 0) {
    return {
      text: chatUnread === 1 ? `${teamName} replied` : `${chatUnread} new messages from ${teamName}`,
      action: 'chat',
    }
  }
  if (noteCount > 0) {
    const posts = noteTypes.filter(isPostNote).length
    const replies = noteTypes.filter(isReplyNote).length
    const accounts = noteTypes.filter(isAccountNote).length
    if (posts > 0 && replies === 0 && accounts === 0 && posts === noteTypes.length) {
      return { text: noteCount === 1 ? '1 new post' : `${noteCount} new posts`, action: 'notes' }
    }
    if (noteCount === 1 && replies === 1) return { text: `${teamName} replied`, action: 'chat' }
    if (noteCount === 1 && accounts === 1) return { text: 'Your account has an update', action: 'notes' }
    return {
      text: noteCount === 1 ? '1 new notification' : `${noteCount} new notifications`,
      action: 'notes',
    }
  }
  if (hasPosts) return { text: `Latest from ${teamName} is below`, action: null }
  return { text: 'You are all set. Message the team anytime.', action: 'chat' }
}

function businessListScore(b: BusinessRow, previews: Map<string, ChatPreview>): number {
  const pv = previews.get(b.id)
  let score = 0
  if (pv && new Date(pv.lastAt).getTime() > 0) score += 10
  if (pv?.unreadFromTeam) score += pv.unreadFromTeam * 5
  if (b.logo_url?.trim() || b.admin_avatar_url?.trim()) score += 3
  if (previews.has(b.id)) score += 1
  return score
}

/** One row per display name — keeps the thread that actually has messages / unread. */
function dedupeBusinessesByName(rows: BusinessRow[], previews: Map<string, ChatPreview>): BusinessRow[] {
  const byName = new Map<string, BusinessRow>()
  for (const b of rows) {
    const key = b.name.trim().toLowerCase()
    const existing = byName.get(key)
    if (!existing || businessListScore(b, previews) > businessListScore(existing, previews)) {
      byName.set(key, b)
    }
  }
  return Array.from(byName.values())
}

export default function FeedPage() {
  const router = useRouter()
  const pathname = usePathname()
  // createBrowserClient returns a new instance each call — stabilize so effects don't loop forever
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [likeRows, setLikeRows] = useState<{ announcement_id: string }[]>([])
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({})
  const [commentsByAnn, setCommentsByAnn] = useState<Record<string, CommentRow[]>>({})
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [commentHasMore, setCommentHasMore] = useState<Record<string, boolean>>({})
  const [commentLoadingId, setCommentLoadingId] = useState<string | null>(null)
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({})
  const commentOpenedRef = useRef<Set<string>>(new Set())
  const commentOldestRef = useRef<Record<string, string>>({})
  const announcementIdsRef = useRef<string[]>([])
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({})
  const [busyAnn, setBusyAnn] = useState<string | null>(null)
  const [replyThreadTarget, setReplyThreadTarget] = useState<{ annId: string; parentId: string } | null>(null)
  const [replyThreadDraft, setReplyThreadDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentBody, setEditCommentBody] = useState('')
  const [commentModerationBusyId, setCommentModerationBusyId] = useState<string | null>(null)

  const [businesses, setBusinesses] = useState<BusinessRow[]>([])
  const [supportBizId, setSupportBizId] = useState<string>('')
  const conversationRef = useRef<ConversationRow | null>(null)
  const [conversation, setConversation] = useState<ConversationRow | null>(null)
  conversationRef.current = conversation
  const [messages, setMessages] = useState<MessageRow[]>([])
  /** Unsent customer text, keyed by business id. Kept when the panel is minimized. */
  const [supportDrafts, setSupportDrafts] = useState<Record<string, string>>({})
  const supportDraft = supportBizId ? (supportDrafts[supportBizId] ?? '') : ''
  const customerDraftsHydratedRef = useRef<string | null>(null)
  const customerComposerDirtyRef = useRef(false)
  const customerTypingSnapshotRef = useRef<{ bizId: string; snapshot: string } | null>(null)
  const [supportLoading, setSupportLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  /** Unread inbound team messages (drives the Messages FAB — delivered, not opened). */
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [chatPreviews, setChatPreviews] = useState<Map<string, ChatPreview>>(new Map())
  const chatPreviewsRef = useRef(chatPreviews)
  chatPreviewsRef.current = chatPreviews
  const messagesLoadSeqRef = useRef(0)
  const [followedBusinessIds, setFollowedBusinessIds] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [feedRefreshing, setFeedRefreshing] = useState(false)
  const [messagesRefreshing, setMessagesRefreshing] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const supportOpenRef = useRef(false)
  supportOpenRef.current = supportOpen
  const [supportPanelView, setSupportPanelView] = useState<'list' | 'chat'>('list')
  const supportPanelViewRef = useRef<'list' | 'chat'>('list')
  supportPanelViewRef.current = supportPanelView

  /** Only mark team messages read while the customer has the chat panel open on this thread. */
  function isActivelyViewingCustomerChat(conversationId: string) {
    return (
      supportOpenRef.current &&
      supportPanelViewRef.current === 'chat' &&
      conversationRef.current?.id === conversationId
    )
  }
  const [greeting, setGreeting] = useState(() => greetingByHour())
  const [unreadNoteTypes, setUnreadNoteTypes] = useState<string[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<
    Record<string, { file: File; previewUrl: string }>
  >({})
  const pendingAttachmentsRef = useRef(pendingAttachments)
  pendingAttachmentsRef.current = pendingAttachments
  const pendingAttachment = supportBizId ? (pendingAttachments[supportBizId] ?? null) : null
  const [replyTargets, setReplyTargets] = useState<Record<string, ReplyTargetMessage>>({})
  const replyTarget = supportBizId ? (replyTargets[supportBizId] ?? null) : null
  const supportFileInputRef = useRef<HTMLInputElement>(null)
  const supportMessagesScrollRef = useRef<HTMLDivElement>(null)
  const supportMessagesEndRef = useRef<HTMLDivElement>(null)
  /** Ref for feed realtime so the channel is not torn down when follows change. */
  const followedBusinessIdsRef = useRef<string[]>([])
  const consumedOpenChatQueryRef = useRef(false)
  const openPrimarySupportChatRef = useRef<() => Promise<void>>(async () => {})
  const supportChatChannelRef = useRef<ReturnType<(typeof supabase)['channel']> | null>(null)
  const supportChatBroadcastReadyRef = useRef(false)
  const inboxLiveChannelRef = useRef<ReturnType<(typeof supabase)['channel']> | null>(null)
  const inboxLiveBroadcastReadyRef = useRef(false)
  const customerTypingSentRef = useRef(false)
  const customerTypingIdleTimerRef = useRef<number | null>(null)
  const peerTeamTypingClearTimerRef = useRef<number | null>(null)
  const [peerTeamTyping, setPeerTeamTyping] = useState(false)
  /** Increments when the customer-chat Realtime channel is subscribed so typing emit retries. */
  const [supportTypingChannelReady, setSupportTypingChannelReady] = useState(0)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 4200)
  }, [])

  const loadAnnouncements = useCallback(
    async (uid: string, followIds: string[]) => {
      if (followIds.length === 0) {
        announcementIdsRef.current = []
        setAnnouncements([])
        setLikeRows([])
        setLikeCounts({})
        setCommentCounts({})
        setCommentsByAnn({})
        return
      }

      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .select(
          `
          id,
          title,
          body,
          image_url,
          created_at,
          business_id,
          author_id,
          businesses ( id, name, slug, logo_url ),
          author:profiles!announcements_author_id_fkey ( avatar_url, first_name, last_name, username )
        `
        )
        .in('business_id', followIds)
        .is('deleted_at', null)
        .is('hidden_at', null)
        .order('created_at', { ascending: false })

      if (annErr) {
        console.error(annErr)
        setAnnouncements([])
        return
      }

      const list = (ann || []) as AnnouncementRow[]
      setAnnouncements(list)
      const ids = list.map((a) => a.id)
      announcementIdsRef.current = ids
      if (ids.length === 0) {
        setLikeRows([])
        setLikeCounts({})
        setCommentCounts({})
      }
    },
    [supabase]
  )

  const loadEngagement = useCallback(
    async (uid: string, ids: string[]) => {
      if (ids.length === 0) return
      const likeCountsNext: Record<string, number> = {}
      const commentCountsNext: Record<string, number> = {}
      const mine: { announcement_id: string }[] = []

      for (let i = 0; i < ids.length; i += 80) {
        const slice = ids.slice(i, i + 80)
        const { data, error } = await supabase
          .from('reactions')
          .select('announcement_id')
          .eq('user_id', uid)
          .eq('reaction', 'like')
          .in('announcement_id', slice)
        if (error) {
          console.error('[feed] my likes', error.message)
        } else {
          for (const row of data || []) mine.push(row as { announcement_id: string })
        }
      }

      const wave = 6
      for (let i = 0; i < ids.length; i += wave) {
        const slice = ids.slice(i, i + wave)
        await Promise.all(
          slice.map(async (id) => {
            const [likes, comments] = await Promise.all([
              supabase
                .from('reactions')
                .select('announcement_id', { count: 'exact', head: true })
                .eq('announcement_id', id)
                .eq('reaction', 'like'),
              supabase
                .from('comments')
                .select('id', { count: 'exact', head: true })
                .eq('announcement_id', id)
                .is('deleted_at', null),
            ])
            likeCountsNext[id] = likes.count ?? 0
            commentCountsNext[id] = comments.count ?? 0
          })
        )
      }

      setLikeCounts(likeCountsNext)
      setLikeRows(mine)
      setCommentCounts(commentCountsNext)
    },
    [supabase]
  )

  const loadUnreadNotifications = useCallback(
    async (uid: string) => {
      const { count, data, error } = await supabase
        .from('notifications')
        .select('type', { count: 'exact' })
        .eq('user_id', uid)
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(12)
      if (error) {
        console.error(error)
        setUnreadNotifications(0)
        setUnreadNoteTypes([])
        return
      }
      setUnreadNotifications(count ?? 0)
      setUnreadNoteTypes((data || []).map((row) => (row as { type: string }).type))
    },
    [supabase]
  )

  const refreshMessagingUI = useCallback(
    async (customerId: string) => {
      const { previews, error: pvErr } = await loadCustomerChatPreviews(supabase, customerId)
      if (!pvErr) {
        setChatPreviews(previews)
        setChatUnreadCount(countConversationsWithUnreadFromTeam(previews))
      }
    },
    [supabase]
  )

  const refreshFeed = useCallback(async () => {
    const uid = profile?.id
    if (!uid || feedRefreshing) return
    setFeedRefreshing(true)
    try {
      const { data: followsRows } = await supabase.from('follows').select('business_id').eq('user_id', uid)
      const fids = (followsRows || []).map((r) => (r as { business_id: string }).business_id)
      followedBusinessIdsRef.current = fids
      setFollowedBusinessIds(fids)
      await loadAnnouncements(uid, fids)
      await Promise.all([
        loadUnreadNotifications(uid),
        refreshMessagingUI(uid),
        loadEngagement(uid, announcementIdsRef.current),
      ])
      setToast('Feed updated')
      window.setTimeout(() => setToast(null), 2200)
    } catch (e) {
      console.error(e)
      showToast('Could not refresh feed. Try again.')
    } finally {
      setFeedRefreshing(false)
    }
  }, [
    profile?.id,
    feedRefreshing,
    supabase,
    loadAnnouncements,
    loadEngagement,
    loadUnreadNotifications,
    refreshMessagingUI,
    showToast,
  ])

  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/login')
        return
      }

      const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('id, role, username, first_name, avatar_url, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (pErr || !prof) {
        console.error(pErr)
        router.replace('/login')
        return
      }

      const pr = prof as ProfileRow & { deleted_at?: string | null }

      if (pr.role !== 'customer') {
        router.replace('/dashboard')
        return
      }

      if (pr.deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }

      if (pr.account_status === 'suspended') {
        router.replace('/account-suspended')
        return
      }

      if (pr.account_status !== 'approved') {
        router.replace('/pending-approval')
        return
      }

      if (cancelled) return
      setProfile(pr)

      const bizRows = await loadBusinessRows(supabase)
      if (!cancelled) setBusinesses(bizRows)

      const { data: followsRows } = await supabase.from('follows').select('business_id').eq('user_id', session.user.id)
      let fids = (followsRows || []).map((r) => (r as { business_id: string }).business_id)
      if (fids.length === 0 && bizRows.length > 0) {
        const primary = pickPrimaryBusinessFromList(bizRows)
        if (primary) {
          const { error: followErr } = await supabase.from('follows').insert({
            user_id: session.user.id,
            business_id: primary.id,
          })
          if (!followErr || followErr.code === '23505') {
            fids = [primary.id]
          } else {
            console.error('[feed] ensure follow:', followErr.message)
          }
        }
      }
      followedBusinessIdsRef.current = fids
      setFollowedBusinessIds(fids)

      await loadAnnouncements(session.user.id, fids)
      if (cancelled) return
      setLoading(false)
      void Promise.all([
        loadUnreadNotifications(session.user.id),
        refreshMessagingUI(session.user.id),
        loadEngagement(session.user.id, announcementIdsRef.current),
      ])
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase, loadAnnouncements, loadEngagement, loadUnreadNotifications, refreshMessagingUI])

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setGreeting(greetingByHour(now))
    }
    const id = window.setInterval(tick, 60_000)
    tick()
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (loading) return
    const postId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('post') : null
    if (!postId) return
    const t = window.setTimeout(() => {
      const el = document.getElementById(`announcement-${postId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el) {
        el.classList.add('ring-2', 'ring-[#e7b84a]', 'ring-offset-2', 'ring-offset-[#120e1c]')
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-[#e7b84a]', 'ring-offset-2', 'ring-offset-[#120e1c]')
        }, 2800)
      }
    }, 150)
    return () => window.clearTimeout(t)
  }, [loading, announcements])

  async function shareAnnouncement(a: AnnouncementRow, bizName: string) {
    try {
      const result = await sharePostLink({
        announcementId: a.id,
        title: a.title,
        text: `${bizName}: ${a.title}`,
      })
      showToast(result === 'shared' ? 'Post shared' : 'Post link copied to clipboard')
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      console.error(e)
      showToast(e instanceof Error ? e.message : 'Could not share this post')
    }
  }

  async function toggleLike(announcementId: string) {
    if (!profile) return
    setBusyAnn(announcementId)
    const has = likeRows.some((r) => r.announcement_id === announcementId)
    try {
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser()
      if (authErr || !user) {
        showToast(authErr?.message || 'Please sign in again to like posts.')
        return
      }
      const uid = user.id

      if (has) {
        const { error } = await supabase
          .from('reactions')
          .delete()
          .eq('announcement_id', announcementId)
          .eq('user_id', uid)
        if (error) throw error
        setLikeRows((prev) => prev.filter((r) => r.announcement_id !== announcementId))
        setLikeCounts((prev) => ({
          ...prev,
          [announcementId]: Math.max(0, (prev[announcementId] || 0) - 1),
        }))
      } else {
        const { error } = await supabase.from('reactions').insert({
          announcement_id: announcementId,
          user_id: uid,
          reaction: 'like',
        })
        if (error) {
          // Stale UI / double-click: like already in DB — sync local state.
          if (error.code === '23505') {
            setLikeRows((prev) =>
              prev.some((r) => r.announcement_id === announcementId)
                ? prev
                : [...prev, { announcement_id: announcementId }]
            )
            const { count } = await supabase
              .from('reactions')
              .select('*', { count: 'exact', head: true })
              .eq('announcement_id', announcementId)
              .eq('reaction', 'like')
            if (typeof count === 'number') {
              setLikeCounts((prev) => ({ ...prev, [announcementId]: count }))
            } else {
              setLikeCounts((prev) => ({
                ...prev,
                [announcementId]: Math.max(1, prev[announcementId] || 0),
              }))
            }
            return
          }
          throw error
        }
        setLikeRows((prev) =>
          prev.some((r) => r.announcement_id === announcementId)
            ? prev
            : [...prev, { announcement_id: announcementId }]
        )
        setLikeCounts((prev) => ({
          ...prev,
          [announcementId]: (prev[announcementId] || 0) + 1,
        }))
      }
    } catch (e) {
      const err = e as { message?: string; code?: string; details?: string; hint?: string }
      const detail = [err?.message, err?.code, err?.details, err?.hint].filter(Boolean).join(' · ')
      console.warn(`[toggleLike] ${detail || 'unknown error'}`)
      showToast(err?.message ? `Could not update like: ${err.message}` : 'Could not update like. Try again.')
    } finally {
      setBusyAnn(null)
    }
  }

  async function loadCommentPage(announcementId: string, more: boolean) {
    if (commentLoadingId === announcementId) return
    setCommentLoadingId(announcementId)
    const limit = more ? COMMENT_MORE : COMMENT_PREVIEW
    try {
      let query = supabase
        .from('comments')
        .select(COMMENT_LIST_SELECT)
        .eq('announcement_id', announcementId)
        .is('parent_comment_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit)
      const oldest = more ? commentOldestRef.current[announcementId] : undefined
      if (oldest) query = query.lt('created_at', oldest)
      const { data, error } = await query
      if (error) throw error
      const parents = (data || []) as CommentRow[]
      if (parents.length > 0) {
        commentOldestRef.current[announcementId] = parents[parents.length - 1].created_at
      }
      setCommentHasMore((prev) => ({ ...prev, [announcementId]: parents.length === limit }))

      let replies: CommentRow[] = []
      const parentIds = parents.map((row) => row.id)
      if (parentIds.length > 0) {
        const { data: replyData, error: replyErr } = await supabase
          .from('comments')
          .select(COMMENT_LIST_SELECT)
          .in('parent_comment_id', parentIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
        if (replyErr) throw replyErr
        replies = (replyData || []) as CommentRow[]
      }

      setCommentsByAnn((prev) => {
        const merged = new Map((prev[announcementId] || []).map((row) => [row.id, row]))
        for (const row of [...parents, ...replies]) merged.set(row.id, row)
        return { ...prev, [announcementId]: [...merged.values()] }
      })
    } catch (e) {
      console.error(e)
      if (!more) commentOpenedRef.current.delete(announcementId)
      showToast('Could not load comments.')
    } finally {
      setCommentLoadingId((current) => (current === announcementId ? null : current))
    }
  }

  async function revealComments(announcementId: string) {
    setOpenComments((open) => ({ ...open, [announcementId]: true }))
    if (commentOpenedRef.current.has(announcementId)) return
    commentOpenedRef.current.add(announcementId)
    await loadCommentPage(announcementId, false)
  }

  async function submitComment(announcementId: string) {
    if (!profile) return
    const text = (commentDraft[announcementId] || '').trim()
    if (!text) return
    setBusyAnn(`c-${announcementId}`)
    try {
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser()
      if (authErr || !user) {
        showToast(authErr?.message || 'Please sign in again to comment.')
        return
      }

      const { data, error } = await supabase
        .from('comments')
        .insert({
          announcement_id: announcementId,
          user_id: user.id,
          body: text,
        })
        .select(
          `
          id,
          announcement_id,
          parent_comment_id,
          body,
          created_at,
          user_id,
          hidden_at
        `
        )
        .single()

      if (error) throw error

      const row: CommentRow = {
        ...(data as CommentRow),
        profiles: {
          username: profile.username,
          first_name: profile.first_name || profile.username,
          last_name: '',
          avatar_url: profile.avatar_url,
          role: 'customer',
          business_role: null,
        },
      }
      setCommentsByAnn((prev) => ({
        ...prev,
        [announcementId]: [...(prev[announcementId] || []), row],
      }))
      setCommentCounts((prev) => ({ ...prev, [announcementId]: (prev[announcementId] || 0) + 1 }))
      commentOpenedRef.current.add(announcementId)
      setCommentDraft((d) => ({ ...d, [announcementId]: '' }))
      setOpenComments((o) => ({ ...o, [announcementId]: true }))
    } catch (e) {
      const err = e as { message?: string; code?: string; details?: string; hint?: string }
      const detail = [err?.message, err?.code, err?.details, err?.hint].filter(Boolean).join(' · ')
      console.warn(`[submitComment] ${detail || 'unknown error'}`)
      showToast(err?.message ? `Could not post comment: ${err.message}` : 'Could not post comment. Try again.')
    } finally {
      setBusyAnn(null)
    }
  }

  function beginEditComment(c: CommentRow) {
    setEditingCommentId(c.id)
    setEditCommentBody(c.body)
  }

  async function saveEditComment(announcementId: string) {
    if (!profile || !editingCommentId) return
    const body = editCommentBody.trim()
    if (!body) return
    setCommentModerationBusyId(editingCommentId)
    try {
      const { error } = await supabase.from('comments').update({ body }).eq('id', editingCommentId).eq('user_id', profile.id)
      if (error) throw error
      setCommentsByAnn((prev) => ({
        ...prev,
        [announcementId]: (prev[announcementId] || []).map((c) => (c.id === editingCommentId ? { ...c, body } : c)),
      }))
      setEditingCommentId(null)
    } catch (e) {
      console.error(e)
      showToast('Could not save comment.')
    } finally {
      setCommentModerationBusyId(null)
    }
  }

  async function toggleCommentHidden(announcementId: string, commentId: string, currentlyHidden: boolean) {
    if (!profile) return
    setCommentModerationBusyId(commentId)
    const hidden_at = currentlyHidden ? null : new Date().toISOString()
    try {
      const { error } = await supabase
        .from('comments')
        .update({ hidden_at })
        .eq('id', commentId)
        .eq('user_id', profile.id)
      if (error) throw error
      if (hidden_at) {
        setCommentsByAnn((prev) => ({
          ...prev,
          [announcementId]: (prev[announcementId] || []).map((c) => (c.id === commentId ? { ...c, hidden_at } : c)),
        }))
      } else {
        setCommentsByAnn((prev) => ({
          ...prev,
          [announcementId]: (prev[announcementId] || []).map((c) =>
            c.id === commentId ? { ...c, hidden_at: null } : c
          ),
        }))
      }
    } catch (e) {
      console.error(e)
      showToast('Could not update comment visibility.')
    } finally {
      setCommentModerationBusyId(null)
    }
  }

  async function deleteComment(announcementId: string, commentId: string) {
    if (!profile) return
    if (!window.confirm('Delete this comment?')) return
    setCommentModerationBusyId(commentId)
    try {
      const { error } = await supabase
        .from('comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', commentId)
        .eq('user_id', profile.id)
      if (error) throw error
      setCommentsByAnn((prev) => ({
        ...prev,
        [announcementId]: (prev[announcementId] || []).filter((c) => c.id !== commentId),
      }))
      setCommentCounts((prev) => ({
        ...prev,
        [announcementId]: Math.max(0, (prev[announcementId] || 0) - 1),
      }))
      if (editingCommentId === commentId) setEditingCommentId(null)
    } catch (e) {
      console.error(e)
      showToast('Could not delete comment.')
    } finally {
      setCommentModerationBusyId(null)
    }
  }

  async function submitCommentReply(announcementId: string, parentCommentId: string) {
    if (!profile) return
    const text = replyThreadDraft.trim()
    if (!text) return
    setBusyAnn(`cr-${announcementId}`)
    try {
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser()
      if (authErr || !user) {
        showToast(authErr?.message || 'Please sign in again to reply.')
        return
      }

      const { data, error } = await supabase
        .from('comments')
        .insert({
          announcement_id: announcementId,
          user_id: user.id,
          body: text,
          parent_comment_id: parentCommentId,
        })
        .select(
          'id, announcement_id, parent_comment_id, body, created_at, user_id, hidden_at'
        )
        .single()

      if (error) throw error
      const row: CommentRow = {
        ...(data as CommentRow),
        profiles: {
          username: profile.username,
          first_name: profile.first_name || profile.username,
          last_name: '',
          avatar_url: profile.avatar_url,
          role: 'customer',
          business_role: null,
        },
      }
      setCommentsByAnn((prev) => ({
        ...prev,
        [announcementId]: [...(prev[announcementId] || []), row],
      }))
      setCommentCounts((prev) => ({ ...prev, [announcementId]: (prev[announcementId] || 0) + 1 }))
      setReplyThreadDraft('')
      setReplyThreadTarget(null)
    } catch (e) {
      const err = e as { message?: string; code?: string; details?: string; hint?: string }
      const detail = [err?.message, err?.code, err?.details, err?.hint].filter(Boolean).join(' · ')
      console.warn(`[submitCommentReply] ${detail || 'unknown error'}`)
      showToast(err?.message ? `Could not post reply: ${err.message}` : 'Could not post reply. Try again.')
    } finally {
      setBusyAnn(null)
    }
  }

  const loadConversationMessages = useCallback(
    async (conversationId: string, options?: { markRead?: boolean }) => {
      const seq = ++messagesLoadSeqRef.current
      const shouldMarkRead = options?.markRead === true

      async function fetchWithReplyFallback() {
        return fetchLatestConversationMessages<MessageRow>(supabase, conversationId, {
          full: CUSTOMER_MESSAGE_SELECT,
          legacy: CUSTOMER_MESSAGE_SELECT_LEGACY,
          base: CUSTOMER_MESSAGE_SELECT_BASE,
        }, { profileKind: 'customer' })
      }

      const { data: msgs, error: mErr } = await fetchWithReplyFallback()
      if (seq !== messagesLoadSeqRef.current) return
      if (mErr) throw mErr
      setMessages(msgs)

      if (shouldMarkRead) {
        const uid = profile?.id
        const unreadTeamIds = msgs
          .filter((m) => uid && m.sender_id !== uid && m.read !== true)
          .map((m) => m.id)
        if (unreadTeamIds.length > 0) {
          const { errorMessage: markErr } = await markMessagesReadByIds(supabase, unreadTeamIds)
          if (markErr) console.error(markErr)

          const { data: msgs2, error: refetchErr } = await fetchWithReplyFallback()
          if (seq !== messagesLoadSeqRef.current) return
          if (!refetchErr && msgs2) setMessages(msgs2)
        }

        const uid2 = profile?.id
        if (uid2) {
          const { errorMessage: nErr } = await markConversationNotificationsRead(supabase, uid2, conversationId)
          if (nErr) console.error(nErr)
        }
      }

      const uid = profile?.id
      if (uid) {
        void refreshMessagingUI(uid)
        void loadUnreadNotifications(uid)
      }
    },
    [supabase, profile?.id, refreshMessagingUI, loadUnreadNotifications]
  )

  const refreshMessagesPanel = useCallback(async () => {
    const uid = profile?.id
    if (!uid || messagesRefreshing) return
    setMessagesRefreshing(true)
    try {
      const tasks: Promise<unknown>[] = [refreshMessagingUI(uid)]
      if (supportPanelView === 'chat' && conversation?.id) {
        tasks.push(loadConversationMessages(conversation.id, { markRead: false }))
      }
      await Promise.all(tasks)
    } catch (e) {
      console.error(e)
      showToast('Could not refresh messages. Try again.')
    } finally {
      setMessagesRefreshing(false)
    }
  }, [
    profile?.id,
    messagesRefreshing,
    supportPanelView,
    conversation?.id,
    refreshMessagingUI,
    loadConversationMessages,
    showToast,
  ])

  /**
   * Which business receives footer / primary Support chat.
   * If NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG is set, it wins against the pool
   * (not only businesses the customer follows) — otherwise a customer-only follow list would miss support.
   */
  function resolvePrimarySupportBusinessId(pool: BusinessRow[]): string | null {
    const list = pool
    if (list.length === 0) return null

    const pickFirstByName = (rows: BusinessRow[]) =>
      [...rows].sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null

    const envSlug = process.env.NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG?.trim()
    if (envSlug) {
      const fromEnv = list.find((b) => b.slug.toLowerCase() === envSlug.toLowerCase())
      if (fromEnv) return fromEnv.id
    }

    const followedSet = new Set(followedBusinessIds)
    const followedRows = list.filter((b) => followedSet.has(b.id))
    const scoped = followedRows.length > 0 ? followedRows : list

    const slugHints = ['support', 'relay', 'jbcoms', 'admin', 'help']
    for (const s of slugHints) {
      const hit = scoped.find((b) => b.slug.toLowerCase() === s)
      if (hit) return hit.id
    }
    const byName = scoped.find((b) => /support|helpdesk|help\s*desk|relay\s*support/i.test(b.name))
    if (byName) return byName.id
    return pickFirstByName(scoped)
  }

  function pickBusinessWithUnread(pool: BusinessRow[]): string | null {
    let best: { id: string; unread: number; lastAt: number } | null = null
    for (const b of pool) {
      const pv = chatPreviewsRef.current.get(b.id)
      const unread = pv?.unreadFromTeam ?? 0
      if (unread <= 0) continue
      const lastAt = pv ? new Date(pv.lastAt).getTime() : 0
      if (
        !best ||
        unread > best.unread ||
        (unread === best.unread && lastAt > best.lastAt)
      ) {
        best = { id: b.id, unread, lastAt }
      }
    }
    return best?.id ?? null
  }

  /** Prefer unread, then the thread with the latest message, then primary support business. */
  function pickBusinessForChatOpen(pool: BusinessRow[]): string | null {
    const unreadId = pickBusinessWithUnread(pool)
    if (unreadId) return unreadId

    let bestActivity: { id: string; lastAt: number } | null = null
    for (const b of pool) {
      const pv = chatPreviewsRef.current.get(b.id)
      const lastAt = pv ? new Date(pv.lastAt).getTime() : 0
      if (lastAt > 0 && (!bestActivity || lastAt > bestActivity.lastAt)) {
        bestActivity = { id: b.id, lastAt }
      }
    }
    if (bestActivity) return bestActivity.id
    if (pool.length === 1) return pool[0].id
    return resolvePrimarySupportBusinessId(pool)
  }

  async function openPrimarySupportChat() {
    if (!profile) return
    setSupportOpen(true)

    const pool = messageableBusinessesRef.current
    const bid = pickBusinessForChatOpen(pool)
    if (bid) {
      await openThreadForBusiness(bid)
      return
    }

    showToast('No team is available to message yet.')
    setSupportPanelView('list')
  }

  function closeMessagesPanel() {
    customerComposerDirtyRef.current = false
    setSupportOpen(false)
  }

  function onMessagesEntryClick() {
    if (supportOpen) {
      closeMessagesPanel()
      return
    }
    void openPrimarySupportChat()
  }

  async function openThreadForBusiness(businessId: string) {
    if (!profile || !businessId) return
    const switchingBusiness = supportBizId !== businessId
    customerComposerDirtyRef.current = false
    setSupportBizId(businessId)
    setSupportPanelView('chat')
    setSupportLoading(true)
    if (switchingBusiness) {
      messagesLoadSeqRef.current += 1
      setMessages([])
      setConversation(null)
    }
    try {
      const preview = chatPreviewsRef.current.get(businessId)

      if (preview?.conversationId) {
        const conv: ConversationRow = {
          id: preview.conversationId,
          business_id: businessId,
          customer_id: profile.id,
          status: 'open',
        }
        setConversation(conv)
        await loadConversationMessages(conv.id, { markRead: false })
        return
      }

      const { data: existing, error: exErr } = await supabase
        .from('conversations')
        .select('id, business_id, customer_id, status')
        .eq('business_id', businessId)
        .eq('customer_id', profile.id)
        .maybeSingle()

      if (exErr) throw exErr

      let conv = existing as ConversationRow | null
      if (!conv) {
        const { data: created, error: crErr } = await supabase
          .from('conversations')
          .insert({
            business_id: businessId,
            customer_id: profile.id,
            status: 'open',
          })
          .select('id, business_id, customer_id, status')
          .single()
        if (crErr) throw crErr
        conv = created as ConversationRow
      }

      setConversation(conv)
      await loadConversationMessages(conv.id, { markRead: false })
    } catch (e) {
      console.error(e)
      showToast('Could not open messages. Try again.')
      setConversation(null)
      setMessages([])
      setSupportPanelView('list')
    } finally {
      setSupportLoading(false)
    }
  }

  openPrimarySupportChatRef.current = openPrimarySupportChat

  useEffect(() => {
    if (loading || !profile?.id) return
    if (pathname !== '/feed') return
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('openChat') !== '1') {
      consumedOpenChatQueryRef.current = false
      return
    }
    if (consumedOpenChatQueryRef.current) return
    consumedOpenChatQueryRef.current = true
    sp.delete('openChat')
    const q = sp.toString()
    router.replace(q ? `/feed?${q}` : '/feed', { scroll: false })
    queueMicrotask(() => {
      void openPrimarySupportChatRef.current()
    })
  }, [loading, profile?.id, pathname, router])

  useEffect(() => {
    followedBusinessIdsRef.current = followedBusinessIds
  }, [followedBusinessIds])

  useEffect(() => {
    const customerId = profile?.id
    if (!customerId) return

    let timer: number | null = null
    const queueFeedRefresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const fids = followedBusinessIdsRef.current
        void loadAnnouncements(customerId, fids)
      }, 300)
    }

    let msgDebounce: number | null = null
    const queueMessagingRefresh = () => {
      if (msgDebounce) window.clearTimeout(msgDebounce)
      msgDebounce = window.setTimeout(() => {
        void refreshMessagingUI(customerId)
        void loadUnreadNotifications(customerId)
      }, 350)
    }

    const channel = supabase
      .channel(`customer-feed-${customerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, queueFeedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
        void loadEngagement(customerId, announcementIdsRef.current)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => {
        void loadEngagement(customerId, announcementIdsRef.current)
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${customerId}` },
        () => void loadUnreadNotifications(customerId)
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, queueMessagingRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, queueMessagingRefresh)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'follows', filter: `user_id=eq.${customerId}` },
        () => {
          void (async () => {
            const { data: fr } = await supabase.from('follows').select('business_id').eq('user_id', customerId)
            const fids = (fr || []).map((r) => (r as { business_id: string }).business_id)
            followedBusinessIdsRef.current = fids
            setFollowedBusinessIds(fids)
            void loadAnnouncements(customerId, fids)
          })()
        }
      )
      .subscribe()

    return () => {
      if (timer) window.clearTimeout(timer)
      if (msgDebounce) window.clearTimeout(msgDebounce)
      void supabase.removeChannel(channel)
    }
  }, [supabase, profile?.id, loadAnnouncements, loadEngagement, loadUnreadNotifications, refreshMessagingUI])

  useEffect(() => {
    if (!conversation?.id || !profile?.id) return
    const cid = conversation.id
    const myId = profile.id
    let stopped = false
    supportChatBroadcastReadyRef.current = false
    supportChatChannelRef.current = null

    const channel = supabase
      .channel(`customer-chat-${cid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` },
        (payload) => {
          if (!isActivelyViewingCustomerChat(cid)) {
            const uid = profile?.id
            if (uid) void refreshMessagingUI(uid)
            return
          }
          const raw = payload.new as Record<string, unknown>
          const id = typeof raw.id === 'string' ? raw.id : null
          if (!id) return
          setMessages((prev) => {
            if (prev.some((m) => m.id === id)) return prev
            const replyToId =
              typeof raw.reply_to_message_id === 'string' ? raw.reply_to_message_id : null
            let reply_to: MessageRow['reply_to'] = null
            if (replyToId) {
              const parent = prev.find((m) => m.id === replyToId)
              if (parent) {
                reply_to = {
                  id: parent.id,
                  sender_id: parent.sender_id,
                  body: parent.body,
                  image_url: parent.image_url ?? null,
                  profiles: parent.profiles ?? null,
                }
              }
            }
            const incoming: MessageRow = {
              id,
              conversation_id: cid,
              sender_id: String(raw.sender_id ?? ''),
              body: String(raw.body ?? ''),
              created_at: String(raw.created_at ?? new Date().toISOString()),
              image_url: (raw.image_url as string | null | undefined) ?? null,
              read: (raw.read as boolean | null | undefined) ?? null,
              read_at: (raw.read_at as string | null | undefined) ?? null,
              reply_to_message_id: replyToId,
              reply_to,
              profiles: null,
            }
            return [...prev, incoming]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` },
        (payload) => {
          if (!isActivelyViewingCustomerChat(cid)) return
          const row = payload.new as {
            id?: string
            read?: boolean
            read_at?: string | null
          }
          if (!row?.id) return
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id ? { ...m, read: row.read ?? m.read, read_at: row.read_at ?? m.read_at } : m
            )
          )
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { userId?: string; typing?: boolean }
        if (!p?.userId || p.userId === myId) return
        if (peerTeamTypingClearTimerRef.current) {
          window.clearTimeout(peerTeamTypingClearTimerRef.current)
          peerTeamTypingClearTimerRef.current = null
        }
        if (p.typing) {
          setPeerTeamTyping(true)
          peerTeamTypingClearTimerRef.current = window.setTimeout(() => {
            setPeerTeamTyping(false)
            peerTeamTypingClearTimerRef.current = null
          }, 3500)
        } else {
          setPeerTeamTyping(false)
        }
      })
      .subscribe((status) => {
        if (stopped) return
        supportChatBroadcastReadyRef.current = status === 'SUBSCRIBED'
        if (status === 'SUBSCRIBED') setSupportTypingChannelReady((n) => n + 1)
      })

    supportChatChannelRef.current = channel

    return () => {
      stopped = true
      supportChatBroadcastReadyRef.current = false
      supportChatChannelRef.current = null
      if (customerTypingIdleTimerRef.current) {
        window.clearTimeout(customerTypingIdleTimerRef.current)
        customerTypingIdleTimerRef.current = null
      }
      if (customerTypingSentRef.current) {
        void channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: myId, typing: false },
        })
        customerTypingSentRef.current = false
      }
      if (peerTeamTypingClearTimerRef.current) {
        window.clearTimeout(peerTeamTypingClearTimerRef.current)
        peerTeamTypingClearTimerRef.current = null
      }
      setPeerTeamTyping(false)
      void supabase.removeChannel(channel)
    }
  }, [supabase, conversation?.id, loadConversationMessages, profile?.id])

  /** Shared bus with staff dashboard so inbound bubbles appear as fast as desktop notifications. */
  useEffect(() => {
    if (!conversation?.business_id) return
    const bid = conversation.business_id
    let stopped = false
    inboxLiveBroadcastReadyRef.current = false
    inboxLiveChannelRef.current = null

    const channel = supabase
      .channel(`inbox-live-${bid}`)
      .subscribe((status) => {
        if (stopped) return
        inboxLiveBroadcastReadyRef.current = status === 'SUBSCRIBED'
      })

    inboxLiveChannelRef.current = channel

    return () => {
      stopped = true
      inboxLiveBroadcastReadyRef.current = false
      inboxLiveChannelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [supabase, conversation?.business_id])

  useEffect(() => {
    const userId = profile?.id
    if (!userId || customerDraftsHydratedRef.current === userId) return
    customerDraftsHydratedRef.current = userId
    const saved = readChatDraftMap(userId, 'customer')
    setSupportDrafts((prev) => ({ ...saved, ...prev }))
  }, [profile?.id])

  /** Emit typing while the customer is actively editing, not when a saved draft is restored. */
  useEffect(() => {
    if (!conversation?.id || !profile?.id || !supportOpen || supportPanelView !== 'chat') {
      customerTypingSnapshotRef.current = null
      return
    }
    const snapshot = `${supportDraft}\0${pendingAttachment ? '1' : '0'}`
    const prev = customerTypingSnapshotRef.current
    const switched = !prev || prev.bizId !== supportBizId
    customerTypingSnapshotRef.current = { bizId: supportBizId, snapshot }
    if (switched || !customerComposerDirtyRef.current) return

    const hasComposerContent = Boolean(supportDraft.trim()) || Boolean(pendingAttachment)
    const ch = supportChatChannelRef.current
    const myId = profile.id

    const sendStop = () => {
      if (customerTypingIdleTimerRef.current) {
        window.clearTimeout(customerTypingIdleTimerRef.current)
        customerTypingIdleTimerRef.current = null
      }
      if (!customerTypingSentRef.current) return
      if (supportChatBroadcastReadyRef.current && ch) {
        void ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: false } })
      }
      customerTypingSentRef.current = false
    }

    if (!hasComposerContent) {
      sendStop()
      return
    }

    if (supportChatBroadcastReadyRef.current && ch) {
      if (!customerTypingSentRef.current) {
        void ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: true } })
        customerTypingSentRef.current = true
      }
    }

    if (customerTypingIdleTimerRef.current) window.clearTimeout(customerTypingIdleTimerRef.current)
    customerTypingIdleTimerRef.current = window.setTimeout(() => {
      customerTypingIdleTimerRef.current = null
      sendStop()
    }, 2000)

    return () => {
      if (customerTypingIdleTimerRef.current) {
        window.clearTimeout(customerTypingIdleTimerRef.current)
        customerTypingIdleTimerRef.current = null
      }
    }
  }, [
    supportDraft,
    pendingAttachment,
    conversation?.id,
    profile?.id,
    supportOpen,
    supportPanelView,
    supportBizId,
    supportTypingChannelReady,
  ])

  useEffect(() => {
    if (supportOpen && supportPanelView === 'chat') return
    const ch = supportChatChannelRef.current
    if (ch && supportChatBroadcastReadyRef.current && profile?.id && customerTypingSentRef.current) {
      void ch.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: profile.id, typing: false },
      })
      customerTypingSentRef.current = false
    }
    if (customerTypingIdleTimerRef.current) {
      window.clearTimeout(customerTypingIdleTimerRef.current)
      customerTypingIdleTimerRef.current = null
    }
  }, [supportOpen, supportPanelView, profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void loadUnreadNotifications(profile.id)
        void refreshMessagingUI(profile.id)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [profile?.id, loadUnreadNotifications, refreshMessagingUI])

  /** Fallback when Realtime is off or flaky — keeps bell / message badges fresh. */
  useEffect(() => {
    if (!profile?.id) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadUnreadNotifications(profile.id)
      void refreshMessagingUI(profile.id)
    }, 20_000)
    return () => window.clearInterval(id)
  }, [profile?.id, loadUnreadNotifications, refreshMessagingUI])

  function setSupportDraftFor(bizId: string, value: string) {
    if (!bizId) return
    const userId = profile?.id
    if (userId) writeChatDraft(userId, 'customer', bizId, value)
    setSupportDrafts((prev) => {
      if ((prev[bizId] ?? '') === value) return prev
      if (!value) return omitRecordKey(prev, bizId)
      return { ...prev, [bizId]: value }
    })
  }

  function setPendingAttachmentFor(bizId: string, next: { file: File; previewUrl: string } | null) {
    if (!bizId) return
    const cur = pendingAttachmentsRef.current[bizId]
    if (cur && cur.previewUrl !== next?.previewUrl) URL.revokeObjectURL(cur.previewUrl)
    pendingAttachmentsRef.current = next
      ? { ...pendingAttachmentsRef.current, [bizId]: next }
      : omitRecordKey(pendingAttachmentsRef.current, bizId)
    setPendingAttachments(pendingAttachmentsRef.current)
  }

  function setCustomerReplyTarget(target: ReplyTargetMessage | null) {
    if (!supportBizId) return
    setReplyTargets((prev) => {
      if (!target) return omitRecordKey(prev, supportBizId)
      return { ...prev, [supportBizId]: target }
    })
  }

  function clearPendingAttachment() {
    if (!supportBizId) return
    setPendingAttachmentFor(supportBizId, null)
  }

  function onSupportImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return
    if (f.size > 5 * 1024 * 1024) {
      alert('Please choose an image under 5 MB.')
      return
    }
    if (!supportBizId) return
    customerComposerDirtyRef.current = true
    setPendingAttachmentFor(supportBizId, { file: f, previewUrl: URL.createObjectURL(f) })
  }

  const scrollSupportToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = supportMessagesScrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior })
      return
    }
    const end = supportMessagesEndRef.current
    if (end) end.scrollIntoView({ block: 'end', behavior })
  }, [])

  const supportChatScroll = useChatScrollToLatest(
    supportMessagesScrollRef,
    supportOpen && supportPanelView === 'chat' ? conversation?.id ?? null : null
  )

  useEffect(() => {
    if (!supportOpen || supportPanelView !== 'chat' || !conversation?.id || supportLoading) return
    let cancelled = false
    const scroll = () => {
      if (cancelled) return
      scrollSupportToLatest('auto')
      supportChatScroll.markAtLatest()
    }
    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(scroll))
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [
    supportOpen,
    supportPanelView,
    conversation?.id,
    supportLoading,
    scrollSupportToLatest,
    supportChatScroll.markAtLatest,
  ])

  useEffect(() => {
    if (!supportOpen || supportPanelView !== 'chat' || !conversation?.id || supportLoading) return
    if (!supportChatScroll.isNearBottomRef.current) return
    let cancelled = false
    const scroll = () => {
      if (cancelled) return
      scrollSupportToLatest('auto')
    }
    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(scroll))
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [
    supportOpen,
    supportPanelView,
    conversation?.id,
    supportLoading,
    messages.length,
    scrollSupportToLatest,
    supportChatScroll.isNearBottomRef,
  ])

  async function sendSupportMessage() {
    if (!profile || !conversation) return
    const text = supportDraft.trim()
    const hasImage = !!pendingAttachment
    if (!text && !hasImage) return

    const chTyping = supportChatChannelRef.current
    if (chTyping && supportChatBroadcastReadyRef.current && customerTypingSentRef.current) {
      void chTyping.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: profile.id, typing: false },
      })
      customerTypingSentRef.current = false
    }
    if (customerTypingIdleTimerRef.current) {
      window.clearTimeout(customerTypingIdleTimerRef.current)
      customerTypingIdleTimerRef.current = null
    }

    setSupportLoading(true)
    try {
      let imageUrl: string | null = null
      if (hasImage && pendingAttachment) {
        const ext = extFromImageFile(pendingAttachment.file)
        const path = `${profile.id}/${conversation.id}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('message-images')
          .upload(path, pendingAttachment.file, {
            contentType: pendingAttachment.file.type || 'image/jpeg',
            upsert: false,
          })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('message-images').getPublicUrl(path)
        imageUrl = pub.publicUrl
      }

      const body = text || (imageUrl ? '📷' : ' ')

      const replyToId = replyTarget?.id ?? null

      const insertPayload: {
        conversation_id: string
        sender_id: string
        body: string
        image_url: string | null
        reply_to_message_id?: string | null
      } = {
        conversation_id: conversation.id,
        sender_id: profile.id,
        body,
        image_url: imageUrl,
      }
      if (replyToId) insertPayload.reply_to_message_id = replyToId

      const capturedReplyTarget = replyTarget

      let { data, error } = await supabase
        .from('messages')
        .insert(insertPayload)
        .select(CUSTOMER_MESSAGE_SELECT)
        .single()

      if (error && isReplyToSchemaError(error.message)) {
        const legacy = await supabase
          .from('messages')
          .insert(insertPayload)
          .select(CUSTOMER_MESSAGE_SELECT_LEGACY)
          .single()
        data = legacy.data as typeof data
        error = legacy.error
      }

      if (error && isReplyToSchemaError(error.message)) {
        const { reply_to_message_id: _drop, ...basePayload } = insertPayload
        const base = await supabase
          .from('messages')
          .insert(basePayload)
          .select(CUSTOMER_MESSAGE_SELECT_BASE)
          .single()
        data = base.data as typeof data
        error = base.error
        if (replyToId && !error) {
          showToast('Run migration 030 in Supabase to save reply links permanently.')
        }
      }

      if (error) throw error

      let row = data as MessageRow
      if (capturedReplyTarget && replyToId) {
        row = {
          ...row,
          reply_to_message_id: replyToId,
          reply_to: {
            id: capturedReplyTarget.id,
            sender_id: capturedReplyTarget.sender_id,
            body: capturedReplyTarget.body,
            image_url: capturedReplyTarget.image_url ?? null,
            profiles: capturedReplyTarget.profiles ?? null,
          },
        }
      }
      row = hydrateReplyEmbeds([row])[0]

      setMessages((prev) => [...prev, row])
      const bizId = supportBizId || conversation.business_id
      customerComposerDirtyRef.current = false
      setSupportDraftFor(bizId, '')
      setPendingAttachmentFor(bizId, null)
      setReplyTargets((prev) => omitRecordKey(prev, bizId))

      const live = inboxLiveChannelRef.current
      if (live && inboxLiveBroadcastReadyRef.current) {
        void live.send({
          type: 'broadcast',
          event: 'customer_message',
          payload: {
            id: row.id,
            conversation_id: row.conversation_id,
            sender_id: row.sender_id,
            body: row.body,
            created_at: row.created_at,
            image_url: row.image_url ?? null,
            read: row.read ?? null,
            read_at: row.read_at ?? null,
            reply_to_message_id: row.reply_to_message_id ?? null,
          },
        })
      }

      let notifyPreview = text.trim().slice(0, 160)
      if (!notifyPreview) notifyPreview = imageUrl ? '📷 Message' : 'Message'
      void fetch('/api/customer/notify-staff-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, preview: notifyPreview }),
      }).then(async (res) => {
        if (res.ok) return
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        console.error('notify-staff-message failed:', res.status, j.error ?? j)
      })

      void refreshMessagingUI(profile.id)
    } catch (e) {
      console.error(e)
      showToast(
        e instanceof Error && e.message.includes('storage')
          ? 'Could not upload image. Check storage setup (message-images bucket).'
          : 'Could not send message. Try again.'
      )
    } finally {
      setSupportLoading(false)
    }
  }

  async function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return
    try {
      sessionStorage.removeItem(LUCKY_SPIN_SNOOZE_KEY)
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const sortedBusinesses = useMemo(() => {
    const followedSet = new Set(followedBusinessIds)
    const filtered = businesses.filter((b) => followedSet.has(b.id) || chatPreviews.has(b.id))
    const deduped = dedupeBusinessesByName(filtered, chatPreviews)
    return deduped.sort((a, b) => {
      const pa = chatPreviews.get(a.id)
      const pb = chatPreviews.get(b.id)
      const ta = pa ? new Date(pa.lastAt).getTime() : 0
      const tb = pb ? new Date(pb.lastAt).getTime() : 0
      if (tb !== ta) return tb - ta
      return a.name.localeCompare(b.name)
    })
  }, [businesses, chatPreviews, followedBusinessIds])

  const messageableBusinessesRef = useRef<BusinessRow[]>([])
  messageableBusinessesRef.current = sortedBusinesses

  const feedSeenIndexes = useMemo(() => {
    const uid = profile?.id
    if (!uid || messages.length === 0) return { lastMine: -1, lastOther: -1 }
    let lastMine = -1
    let lastOther = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (lastMine < 0 && messages[i].sender_id === uid) lastMine = i
      if (lastOther < 0 && messages[i].sender_id !== uid) lastOther = i
    }
    return { lastMine, lastOther }
  }, [messages, profile?.id])

  const customerThreadUnreadTeamIds = useMemo(() => {
    const uid = profile?.id
    if (!uid || !conversation?.id) return [] as string[]
    return messages.filter((m) => m.sender_id !== uid && m.read !== true).map((m) => m.id)
  }, [messages, conversation?.id, profile?.id])

  const markTeamMessagesReadOnView = useCallback(
    async (messageIds: string[]) => {
      const uid = profile?.id
      const conversationId = conversationRef.current?.id
      if (!uid || !conversationId || messageIds.length === 0) return

      const { errorMessage } = await markMessagesReadByIds(supabase, messageIds)
      if (errorMessage) {
        console.error(errorMessage)
        return
      }

      const now = new Date().toISOString()
      setMessages((prev) => {
        const next = prev.map((m) =>
          messageIds.includes(m.id) && m.sender_id !== uid
            ? { ...m, read: true, read_at: m.read_at ?? now }
            : m
        )
        return next
      })
      void refreshMessagingUI(uid)
      void loadUnreadNotifications(uid)
    },
    [supabase, profile?.id, refreshMessagingUI, loadUnreadNotifications]
  )

  useMarkMessagesReadOnView({
    enabled: supportOpen && supportPanelView === 'chat' && Boolean(conversation?.id) && !supportLoading,
    rootRef: supportMessagesScrollRef,
    unreadMessageIds: customerThreadUnreadTeamIds,
    markRead: markTeamMessagesReadOnView,
  })

  if (loading || !profile) {
    return (
      <div className="relay-customer-dark relay-lobby min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#e7b84a]" />
      </div>
    )
  }

  const fbBlue = '#c9922e'
  const relayChatGradient = 'linear-gradient(180deg, #fff6d4 0%, #e7b84a 46%, #b8862d 100%)'
  const chatInk = 'text-[#3a2508]'
  /** Light theme removed — keep flag so existing ternaries resolve to dark styling. */
  const isLight = false
  const pageBg = 'relay-lobby text-[#fff8ee]'
  const panelBg = isLight ? 'bg-white/95 border-slate-200' : 'bg-[#1a1428]/95 border-[#e1b55d]/32'
  const mutedText = isLight ? 'text-slate-500' : 'text-[#cbb89a]'
  const bodyText = isLight ? 'text-slate-700' : 'text-[#e4d8f0]'
  const headingText = isLight ? 'text-slate-900 font-semibold' : 'text-[#fff6e8] font-semibold'
  const commentInputText = isLight ? 'text-slate-800 placeholder:text-slate-400' : 'text-[#fff6e8] placeholder:text-[#a89878]'
  const teamName =
    sortedBusinesses[0]?.name || one(announcements[0]?.businesses)?.name || 'the team'
  const homeStatus = describeHomeStatus({
    chatUnread: chatUnreadCount,
    noteCount: unreadNotifications,
    noteTypes: unreadNoteTypes,
    teamName,
    hasPosts: announcements.length > 0,
  })
  const latestThread = sortedBusinesses[0] ?? null
  const latestPreview = latestThread ? chatPreviews.get(latestThread.id) : undefined
  const latestPreviewLine = latestPreview
    ? `${latestPreview.lastSenderIsCustomer ? 'You: ' : ''}${latestPreview.lastBody}`
    : latestThread
      ? 'No messages yet. Say hello when you need the team.'
      : 'Your conversation with the team will show up here.'

  return (
    <div className={`relay-customer-dark min-h-[100dvh] grid grid-rows-[auto_1fr] overflow-hidden ${pageBg}`}>
      <LuckySpinModal chatOpen={supportOpen} />
      {/* Top nav + greeting — one frosted shell, toolbar / divider / hero for clearer hierarchy */}
      <header className="z-30 border-b border-[#edc06e]/25 bg-[#120e1c]/80 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 h-14">
          <div className="min-w-0 flex-1 pr-2">
            <RelayLogo theme="dark" size="md" accent="gold" className="min-w-0" />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CustomerRefreshButton
              busy={feedRefreshing}
              isLight={false}
              tone="gold"
              onRefresh={refreshFeed}
              aria-label="Refresh feed"
            />
            <button
              type="button"
              onClick={() => router.push('/notifications')}
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-[#f9d587] hover:bg-[#d79c22]/15"
              aria-label="Notifications"
            >
              <Bell className="w-[18px] h-[18px]" strokeWidth={2} />
              {unreadNotifications > 0 ? (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#ff3b5c] text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => router.push('/profile')}
              className="h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-[#f0c86a]/55"
              aria-label="Open profile"
            >
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={`${profile.username} avatar`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#fff6d4] to-[#c9922e] text-xs font-bold text-[#3a2508]">
                  {initials(profile.username)}
                </span>
              )}
            </button>
          </div>
        </div>
        <div className="px-4 pb-3">
          <h1 className="relay-gold-type text-[1.45rem] font-semibold leading-tight tracking-tight">
            {greeting}, {profile.first_name?.trim() || profile.username}
          </h1>
          {homeStatus.action ? (
            <button
              type="button"
              onClick={() => {
                if (homeStatus.action === 'chat') onMessagesEntryClick()
                else router.push('/notifications')
              }}
              className="mt-1 text-left text-[13px] font-medium tracking-wide text-[#e7c373] hover:text-[#fff1c2] hover:underline"
            >
              {homeStatus.text}
            </button>
          ) : (
            <p className="mt-1 text-[13px] font-medium tracking-wide text-[#e7c373]">{homeStatus.text}</p>
          )}
        </div>
      </header>

      {/* Desktop: 220px rail | scroll feed | 260px aside; mobile: single column */}
      <div className="min-h-0 overflow-hidden flex flex-col min-[900px]:grid min-[900px]:grid-cols-[220px_minmax(0,1fr)_260px] min-[900px]:gap-4 px-3.5 min-[900px]:px-5 min-[900px]:pb-5">
        <aside className="hidden min-[900px]:block min-h-0">
          <nav className="sticky top-3 space-y-0.5 px-1" aria-label="Home">
            <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold tracking-wide text-[#f0c86a]">
              <Home className="w-5 h-5 shrink-0" strokeWidth={2} />
              Home
            </div>
            <Link
              href="/notifications"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#e4d8f0] hover:bg-white/5"
            >
              <Bell className="w-5 h-5 shrink-0" strokeWidth={2} />
              Notifications
              {unreadNotifications > 0 ? (
                <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b5c] text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              ) : null}
            </Link>
            <button
              type="button"
              onClick={() => onMessagesEntryClick()}
              className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium ${
                supportOpen ? 'text-[#f0c86a]' : 'text-[#e4d8f0] hover:bg-white/5'
              }`}
            >
              <MessageCircle className="w-5 h-5 shrink-0" strokeWidth={2} />
              <span className="truncate">Messages</span>
              {chatUnreadCount > 0 ? (
                <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b5c] text-white text-[10px] font-bold flex items-center justify-center">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              ) : null}
            </button>
          </nav>
        </aside>

        <main
          id="relay-feed-main"
          className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-3 pt-2 pb-[calc(4.75rem+env(safe-area-inset-bottom))] min-[900px]:pt-0 min-[900px]:pb-0 scroll-mt-2"
        >
          {followedBusinessIds.length === 0 ? (
            <div className={`rounded-2xl border p-8 sm:p-10 text-center ${panelBg}`}>
              <Building2 className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-slate-400' : 'text-[#e7c373]'}`} />
              <p className={`text-lg ${headingText}`}>No team feed yet</p>
              <p className={`${mutedText} text-sm mt-2 max-w-md mx-auto leading-relaxed`}>
                Once your account is approved, updates from the team show up here. Refresh this page if you were just approved.
              </p>
            </div>
          ) : announcements.length === 0 ? (
            <div className={`rounded-2xl border p-10 text-center ${panelBg}`}>
              <Building2 className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-slate-400' : 'text-[#e7c373]'}`} />
              <p className={`text-[15px] ${headingText}`}>You are all set</p>
              <p className={`${mutedText} text-sm mt-1`}>
                When the team posts an update, it will show up here. You can message them anytime.
              </p>
            </div>
          ) : (
            announcements.map((a, index) => {
              const biz = one(a.businesses)
              const bizName = biz?.name || 'Business'
              const postAvatarUrl = announcementAvatarUrl(a)
              const liked = likeRows.some((r) => r.announcement_id === a.id)
              const count = likeCounts[a.id] || 0
              const comments = commentsByAnn[a.id] || []
              const totalComments = commentCounts[a.id] || 0
              const open = openComments[a.id]
              const commentsLoading = commentLoadingId === a.id
              const byParent = commentsByParent(comments)

              function renderCommentNode(c: CommentRow, depth: number) {
                const p = one(c.profiles)
                const who = p ? `${p.first_name} ${p.last_name}`.trim() || p.username : 'Member'
                const kids = byParent.get(c.id) || []
                const isReplying = replyThreadTarget?.annId === a.id && replyThreadTarget?.parentId === c.id
                const isOwn = profile?.id === c.user_id
                return (
                  <li key={c.id} className="flex gap-2 text-sm">
                    {p?.avatar_url ? (
                      <img
                        src={p.avatar_url}
                        alt={`${who} avatar`}
                        className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: '#606770' }}
                      >
                        {p ? initials(`${p.first_name} ${p.last_name}`) : '?'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`max-w-full rounded-2xl px-3 py-2 border ${
                          isLight ? 'bg-white border-slate-200' : 'bg-[#241c36] border-[#e1b55d]/22'
                        } ${c.hidden_at ? 'opacity-70' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className={`font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>{who}</span>
                            {c.hidden_at ? (
                              <span
                                className={`ml-2 text-[10px] font-semibold uppercase ${
                                  isLight ? 'text-amber-700' : 'text-amber-200'
                                }`}
                              >
                                Hidden
                              </span>
                            ) : null}
                          </div>
                          {isOwn ? (
                            <ContentModerationMenu
                              isHidden={Boolean(c.hidden_at)}
                              busy={commentModerationBusyId === c.id}
                              onEdit={() => beginEditComment(c)}
                              onHide={() => void toggleCommentHidden(a.id, c.id, Boolean(c.hidden_at))}
                              onDelete={() => void deleteComment(a.id, c.id)}
                              className="shrink-0"
                            />
                          ) : null}
                        </div>
                        {editingCommentId === c.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              className={`w-full min-h-14 rounded-xl border px-2.5 py-2 text-sm outline-none ${
                                isLight ? 'border-slate-200 bg-slate-50 text-slate-900' : 'border-[#e1b55d]/25 bg-[#140f1e] text-[#fff6e8]'
                              }`}
                              value={editCommentBody}
                              onChange={(e) => setEditCommentBody(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={commentModerationBusyId === c.id || !editCommentBody.trim()}
                                onClick={() => void saveEditComment(a.id)}
                                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                style={{ backgroundColor: fbBlue }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCommentId(null)}
                                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                                  isLight ? 'border-slate-200 text-slate-600' : 'border-white/10 text-[#c4cbe6]'
                                }`}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className={`mt-0.5 whitespace-pre-wrap ${isLight ? 'text-slate-700' : 'text-[#d4dbf0]'}`}>{c.body}</p>
                        )}
                      </div>
                      <div className="mt-1 ml-1 flex flex-wrap items-center gap-2">
                        <p className={`text-[11px] ${mutedText}`}>{timeAgo(c.created_at)}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyThreadTarget((prev) =>
                              prev?.annId === a.id && prev.parentId === c.id ? null : { annId: a.id, parentId: c.id }
                            )
                            setReplyThreadDraft('')
                          }}
                          className={`text-[11px] font-semibold ${isLight ? 'text-[#1877f2]' : 'text-[#f0c86a]'}`}
                        >
                          Reply
                        </button>
                      </div>
                      {isReplying ? (
                        <div className="mt-2 flex gap-2 items-end">
                          <textarea
                            rows={1}
                            value={replyThreadDraft}
                            onChange={(e) => setReplyThreadDraft(e.target.value)}
                            placeholder={`Reply to ${who}…`}
                            className={`flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm outline-none resize-none min-h-[40px] max-h-28 ${isLight ? 'border-slate-200 bg-white' : 'border-[#e1b55d]/28 bg-[#140f1e]'} ${commentInputText}`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void submitCommentReply(a.id, c.id)
                              }
                            }}
                          />
                          <button
                            type="button"
                            disabled={busyAnn === `cr-${a.id}` || !replyThreadDraft.trim()}
                            onClick={() => void submitCommentReply(a.id, c.id)}
                            className="p-2 rounded-full text-white shrink-0 disabled:opacity-50"
                            style={{ backgroundColor: fbBlue }}
                            aria-label="Send reply"
                          >
                            {busyAnn === `cr-${a.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          </button>
                        </div>
                      ) : null}
                      {kids.length > 0 ? (
                        <ul className={`mt-2 space-y-2 border-l pl-2 ml-1 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
                          {kids.map((k) => renderCommentNode(k, depth + 1))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                )
              }

              return (
                <div key={a.id} className="space-y-2">
                {index === 0 ? (
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e7c373]">
                    Latest from the team
                  </p>
                ) : null}
                <article
                  id={`announcement-${a.id}`}
                  className={`overflow-hidden rounded-2xl border scroll-mt-24 ${panelBg}`}
                >
                  <div className={index === 0 ? 'p-4 pb-0' : 'p-3 pb-0'}>
                    <div className="flex items-start gap-3">
                      {postAvatarUrl ? (
                        <img
                          src={postAvatarUrl}
                          alt={`${bizName} avatar`}
                          className={`${index === 0 ? 'w-10 h-10' : 'w-8 h-8'} rounded-full object-cover shrink-0`}
                        />
                      ) : (
                        <div
                          className={`${index === 0 ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs'} rounded-full flex items-center justify-center font-bold shrink-0 bg-gradient-to-b from-[#fff6d4] to-[#c9922e] text-[#3a2508]`}
                        >
                          {initials(bizName)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1 leading-tight">
                        {biz?.slug ? (
                          <Link
                            href={`/business/${biz.slug}`}
                            className={`block truncate hover:underline ${headingText}`}
                          >
                            {bizName}
                          </Link>
                        ) : (
                          <div className={`truncate ${headingText}`}>{bizName}</div>
                        )}
                        <div className={`text-xs ${mutedText}`}>
                          <span>{timeAgo(a.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className={`mt-3 text-[15px] ${isLight ? 'text-slate-800' : 'text-white'}`}>
                      {a.title.trim() ? (
                        <ExpandablePostText
                          text={a.title}
                          collapsedLines={index === 0 ? 4 : 3}
                          isLight={isLight}
                          className={`mb-1.5 font-semibold ${index === 0 ? 'text-[17px]' : 'text-[15px]'} ${headingText}`}
                        />
                      ) : null}
                      {a.body.trim() ? (
                        <ExpandablePostText
                          text={a.body}
                          collapsedLines={5}
                          isLight={isLight}
                          className={`text-[15px] ${isLight ? 'text-slate-700 leading-7' : 'leading-snug'}`}
                        />
                      ) : null}
                    </div>
                  </div>

                  {a.image_url ? (
                    <div className={index === 0 ? 'mt-3' : 'mt-2 px-3'}>
                      <FeedPostImage imageUrl={a.image_url} alt="" edge={index === 0} compact={index !== 0} rounded="xl" />
                    </div>
                  ) : null}

                  {(count > 0 || totalComments > 0) && (
                    <div className="px-4 pt-3 flex items-center gap-3 text-sm text-[#e4d8f0]">
                      {count > 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px]"
                            style={{ backgroundColor: fbBlue }}
                          >
                            <ThumbsUp className="w-3 h-3" />
                          </span>
                          <span>{count}</span>
                        </span>
                      ) : null}
                      {totalComments > 0 ? (
                        <button
                          type="button"
                          onClick={() => void revealComments(a.id)}
                          className="hover:underline"
                        >
                          {totalComments} comment{totalComments === 1 ? '' : 's'}
                        </button>
                      ) : null}
                    </div>
                  )}

                  <div className="px-2 py-1 mt-2 border-t border-[#e1b55d]/22">
                    <div className="flex">
                      <button
                        type="button"
                        disabled={busyAnn === a.id}
                        onClick={() => void toggleLike(a.id)}
                        className={clsx(
                          'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[15px] font-medium transition-colors',
                          liked ? 'text-[#f0c86a]' : isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-[#e4d8f0] hover:bg-white/10'
                        )}
                      >
                        {busyAnn === a.id ? (
                          <Loader2 className="w-[18px] h-[18px] animate-spin" />
                        ) : (
                          <ThumbsUp
                            className={clsx(
                              'w-[18px] h-[18px]',
                              liked && 'fill-[#e7b84a] text-[#f0c86a]'
                            )}
                          />
                        )}
                        Like
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (open) setOpenComments((o) => ({ ...o, [a.id]: false }))
                          else void revealComments(a.id)
                        }}
                        className={clsx(
                          `flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[15px] font-medium ${isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-[#b8c0dc] hover:bg-white/10'}`,
                          open && 'text-[#f0c86a]'
                        )}
                      >
                        <MessageCircle className="w-[18px] h-[18px]" />
                        Comment
                        {open ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4 opacity-50" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void shareAnnouncement(a, bizName)}
                        className={clsx(
                          'flex items-center justify-center w-10 py-2 rounded-md',
                          isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-[#b8c0dc] hover:bg-white/10'
                        )}
                        aria-label="Share post"
                      >
                        <Share2 className="w-[18px] h-[18px]" />
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className={`${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#140f1e] border-[#e1b55d]/22'} border-t px-3 py-3 space-y-3`}>
                      {commentHasMore[a.id] ? (
                        <button
                          type="button"
                          disabled={commentsLoading}
                          onClick={() => void loadCommentPage(a.id, true)}
                          className="mx-auto flex items-center gap-1.5 text-[13px] font-semibold text-[#e7c373] disabled:opacity-60"
                        >
                          {commentsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          View more comments
                        </button>
                      ) : null}
                      {commentsLoading && comments.length === 0 ? (
                        <p className={`flex items-center justify-center gap-2 py-2 text-sm ${mutedText}`}>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading comments
                        </p>
                      ) : comments.length === 0 ? (
                        <p className={`text-sm ${mutedText} text-center py-2`}>No comments yet.</p>
                      ) : (
                        <ul className="space-y-3">
                          {comments
                            .filter((c) => !c.parent_comment_id)
                            .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
                            .map((c) => renderCommentNode(c, 0))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenComments((o) => ({ ...o, [a.id]: false }))}
                        className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border border-[#e1b55d]/35 text-[#e7c373]"
                        aria-label="Hide comments"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <div className={`flex gap-2 items-end rounded-2xl px-3 py-1.5 border ${isLight ? 'bg-white border-slate-200' : 'bg-[#140f1e] border-[#e1b55d]/28'}`}>
                        <textarea
                          rows={1}
                          value={commentDraft[a.id] || ''}
                          onChange={(e) =>
                            setCommentDraft((d) => ({ ...d, [a.id]: e.target.value }))
                          }
                          placeholder="Write a comment…"
                          className={`flex-1 min-w-0 bg-transparent text-sm py-2 focus:outline-none resize-none min-h-[40px] max-h-28 ${commentInputText}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void submitComment(a.id)
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={busyAnn === `c-${a.id}`}
                          onClick={() => void submitComment(a.id)}
                          className="p-2 rounded-full text-white shrink-0 disabled:opacity-50"
                          style={{ backgroundColor: fbBlue }}
                          aria-label="Send comment"
                        >
                          {busyAnn === `c-${a.id}` ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
                </div>
              )
            })
          )}
        </main>

        <aside className="hidden min-[900px]:block min-h-0">
          <div className="sticky top-3 px-1">
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.16em] mb-2 ${
                isLight ? 'text-slate-500' : 'text-[#e7c373]'
              }`}
            >
              Messages
            </p>
            {latestThread ? (
              <button
                type="button"
                onClick={() => {
                  setSupportOpen(true)
                  void openThreadForBusiness(latestThread.id)
                }}
                className="w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <p className={`text-[14px] font-semibold truncate ${headingText}`}>{latestThread.name}</p>
                  {latestPreview && latestPreview.unreadFromTeam > 0 ? (
                    <span className="shrink-0 rounded-full bg-[#ff3b5c] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      New
                    </span>
                  ) : null}
                </div>
                <p className={`mt-1 text-[13px] leading-relaxed line-clamp-3 ${bodyText}`}>{latestPreviewLine}</p>
                {latestPreview?.lastAt ? (
                  <p className={`mt-2 text-[11px] ${mutedText}`}>{timeAgo(latestPreview.lastAt)}</p>
                ) : null}
                <p className={`mt-2 text-[12px] font-semibold tracking-wide ${isLight ? 'text-violet-700' : 'text-[#f0c86a]'}`}>
                  Open messages
                </p>
              </button>
            ) : (
              <p className={`text-[13px] leading-relaxed ${bodyText}`}>
                Your conversation with the team will show up here.
              </p>
            )}
          </div>
        </aside>
      </div>

      <CustomerMobileFooterNav
        unreadNotifications={unreadNotifications}
        unreadChatCount={chatUnreadCount}
        isLight={isLight}
        onChatClick={() => onMessagesEntryClick()}
        chatActive={supportOpen}
        tone="gold"
      />

      {/* Primary messaging entry — FAB only when panel closed (avoid a second X beside composer; close from header). */}
      {!supportOpen ? (
        <div className="fixed z-50 flex flex-col items-end gap-1.5 right-[max(14px,env(safe-area-inset-right))] max-[899px]:bottom-[calc(5.75rem+env(safe-area-inset-bottom))] min-[900px]:bottom-4">
          {chatUnreadCount > 0 ? (
            <span className="max-w-[calc(100vw-2rem)] truncate rounded-full bg-[#ff3b5c] px-[11px] py-[5px] text-[10px] font-bold text-white shadow-[0_4px_14px_rgba(255,59,92,0.5)] animate-pulse">
              New team message
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onMessagesEntryClick()}
            className="group relative flex h-[58px] w-[58px] items-center justify-center rounded-full text-white transition-transform duration-200 hover:scale-[1.06] hover:-translate-y-0.5 active:scale-[0.97]"
            style={{
              background: 'linear-gradient(180deg, #fff6d4 0%, #e7b84a 46%, #b8862d 100%)',
              boxShadow: '0 8px 28px -6px rgba(201,146,46,0.7)',
            }}
            aria-label="Open messages"
            aria-expanded={false}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#3a2508"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="select-none pointer-events-none transition-transform duration-200 ease-out group-hover:scale-[1.06] group-hover:-translate-y-0.5"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {chatUnreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[#120e1c] bg-[#ff3b5c] px-1 text-[9px] font-extrabold leading-none text-white">
                {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

      {/* Relay messages panel */}
      {supportOpen && (
        <div
          className="fixed z-50 flex flex-col rounded-[20px] shadow-2xl border border-[#e1b55d]/35 bg-[#140f1e] overflow-hidden w-[min(340px,calc(100vw-1.75rem))] sm:w-[380px] h-[min(85dvh,620px)] max-h-[min(calc(100dvh-8rem-env(safe-area-inset-bottom)),620px)] min-[900px]:max-h-[calc(100dvh-7rem)] max-[899px]:bottom-[calc(6.5rem+env(safe-area-inset-bottom))] min-[900px]:bottom-24 right-[max(0.875rem,env(safe-area-inset-right))]"
        >
          <div
            className="flex items-center gap-2 px-2 py-2.5 text-[#3a2508] shrink-0 min-h-[52px]"
            style={{ background: relayChatGradient }}
          >
            {supportPanelView === 'chat' && (conversation || supportBizId) ? (
              <>
                {(() => {
                  const activeBiz = businesses.find((b) => b.id === supportBizId)
                  return (
                    <ChatAvatar
                      name={activeBiz?.name || 'Business'}
                      imageUrl={businessChatAvatarUrl(activeBiz)}
                      className="w-9 h-9 text-xs ml-1"
                      gradient={relayChatGradient}
                            ink={chatInk}
                    />
                  )
                })()}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate leading-tight">
                    {businesses.find((b) => b.id === supportBizId)?.name || 'Business'}
                  </div>
                  <div className="text-[11px] font-medium tracking-wide text-[#5c3d12]">
                    {supportLoading && !conversation ? 'Opening…' : 'Relay · live'}
                  </div>
                </div>
              </>
            ) : (
              <>
                <MessageCircle className="w-5 h-5 shrink-0 ml-1" strokeWidth={2.5} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm tracking-wide">Messages</div>
                  <div className="text-[11px] font-medium tracking-wide text-[#5c3d12]">Messages · live</div>
                </div>
              </>
            )}
            <div className="flex items-center gap-0.5 shrink-0 ml-auto">
              <CustomerRefreshButton
                variant="panel"
                tone="gold"
                busy={messagesRefreshing}
                onRefresh={refreshMessagesPanel}
                aria-label={
                  supportPanelView === 'chat' ? 'Refresh conversation' : 'Refresh message list'
                }
              />
              <button
                type="button"
                onClick={() => closeMessagesPanel()}
                className="p-2 rounded-full text-[#3a2508] hover:bg-black/10 shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {supportPanelView === 'list' && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#140f1e]">
              <div className="flex-1 overflow-y-auto">
                {sortedBusinesses.length === 0 ? (
                  <p className="p-6 text-center text-sm text-[#cbb89a]">
                    No businesses to message yet.
                  </p>
                ) : (
                  sortedBusinesses.map((b) => {
                    const pv = chatPreviews.get(b.id)
                    const draftLabel = draftListLabel(supportDrafts[b.id], Boolean(pendingAttachments[b.id]))
                    const line = pv
                      ? `${pv.lastSenderIsCustomer ? 'You: ' : ''}${pv.lastBody}`
                      : 'Tap to start messaging'
                    const unread = pv?.unreadFromTeam ?? 0
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={supportLoading}
                        onClick={() => void openThreadForBusiness(b.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 border-b border-[#e1b55d]/18 text-left transition-colors disabled:opacity-50"
                      >
                        <div className="relative shrink-0">
                          <ChatAvatar
                            name={b.name}
                            imageUrl={businessChatAvatarUrl(b)}
                            className="w-12 h-12 text-sm"
                            gradient={relayChatGradient}
                            ink={chatInk}
                          />
                          {unread > 0 ? (
                            <span
                              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#ff3355] border-2 border-[#140f1e]"
                              aria-label="Unread messages"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[15px] text-[#fff6e8] truncate">{b.name}</div>
                          <div className="text-xs text-[#cbb89a] truncate">
                            {draftLabel ? (
                              <>
                                <span className="font-semibold" style={{ color: '#ff4d6d' }}>
                                  Draft:{' '}
                                </span>
                                {draftLabel}
                              </>
                            ) : (
                              line
                            )}
                          </div>
                        </div>
                        {supportLoading && supportBizId === b.id ? (
                          <Loader2 className="w-5 h-5 animate-spin text-[#e7b84a] shrink-0" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-[#e7c373] shrink-0" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {supportPanelView === 'chat' && supportBizId && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#120e1c]">
              {supportLoading && !conversation ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 min-h-0">
                  <Loader2 className="h-9 w-9 animate-spin text-[#e7b84a]" aria-hidden />
                  <p className="text-sm text-[#cbb89a]">Opening your messages…</p>
                </div>
              ) : conversation ? (
                <>
              <div className="relative flex-1 min-h-0 flex flex-col">
              <div
                ref={supportMessagesScrollRef}
                onScroll={supportChatScroll.onScroll}
                className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0"
              >
                {supportLoading && messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <Loader2 className="h-9 w-9 animate-spin text-[#e7b84a] mb-3" aria-hidden />
                    <p className="text-sm text-[#cbb89a]">Loading messages…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    {(() => {
                      const activeBiz = businesses.find((b) => b.id === supportBizId)
                      return (
                        <ChatAvatar
                          name={activeBiz?.name || 'Business'}
                          imageUrl={businessChatAvatarUrl(activeBiz)}
                          className="w-14 h-14 text-sm mb-3"
                          gradient={relayChatGradient}
                            ink={chatInk}
                        />
                      )
                    })()}
                    <p className="text-sm font-medium text-[#fff6e8]">No messages yet</p>
                    <p className="text-xs text-[#cbb89a] mt-1">
                      Send a message or a photo to start the conversation.
                    </p>
                  </div>
                ) : (
                  messages.map((m, i) => {
                    const mine = m.sender_id === profile.id
                    const embed = one(m.profiles)
                    const activeBiz = businesses.find((b) => b.id === supportBizId)
                    const isTeam = !mine && embed?.role === 'business'
                    const prev = i > 0 ? messages[i - 1] : null
                    const showAvatar = isTeam && (!prev || prev.sender_id !== m.sender_id)
                    const avatarName = activeBiz?.name || embed?.username || 'Team'
                    const avatarUrl = teamAvatarUrl(embed, activeBiz)
                    const teamLine =
                      isTeam && embed
                        ? `${[embed.first_name, embed.last_name].filter(Boolean).join(' ').trim() || `@${embed.username}`} · @${embed.username}`
                        : null
                    const showText = Boolean(m.body?.trim()) && m.body !== '📷'
                    const receipt = parseSpinReceipt(m.body)
                    const isLastMine = mine && i === feedSeenIndexes.lastMine
                    const isLastOther = !mine && i === feedSeenIndexes.lastOther
                    const replyParent = oneReplyEmbed(m.reply_to)
                    const customerId = profile.id
                    const replyQuoteVariant = mine ? 'customer-mine' : 'customer-other'
                    const scrollToMessage = (messageId: string) => {
                      document.getElementById(`feed-msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                    return (
                      <div
                        key={m.id}
                        id={`feed-msg-${m.id}`}
                        data-message-id={m.id}
                        className={clsx(
                          'group/msg flex w-full max-w-full shrink-0',
                          mine ? 'justify-end' : 'justify-start gap-2'
                        )}
                      >
                        {!mine && showAvatar ? (
                          <ChatAvatar
                            name={avatarName}
                            imageUrl={avatarUrl}
                            className="w-7 h-7 text-[10px] self-end mb-5"
                            gradient={relayChatGradient}
                            ink={chatInk}
                          />
                        ) : !mine ? (
                          <div className="w-7 shrink-0" aria-hidden />
                        ) : null}
                        <div
                          className={clsx(
                            'flex flex-col w-fit max-w-[min(calc(100%-2.25rem),22rem)] shrink-0',
                            mine ? 'items-end' : 'items-start'
                          )}
                        >
                        {teamLine && !(receipt && !mine) ? (
                          <p
                            className="text-[10px] text-[#e7c373] px-1 pb-0.5 font-medium tracking-wide truncate max-w-full"
                            title={teamLine}
                          >
                            {teamLine}
                          </p>
                        ) : null}
                        {receipt && !mine ? (
                          <SpinReceiptCard receipt={receipt} tone="customer" />
                        ) : (
                        <div
                          className={clsx(
                            'relative text-sm shadow-lg overflow-hidden max-w-full ring-1 ring-white/10',
                            mine
                              ? 'rounded-2xl rounded-br-md text-[#3a2508]'
                              : 'rounded-2xl rounded-bl-md bg-[#241c36] text-[#fff6e8] border border-[#e1b55d]/35'
                          )}
                          style={mine ? { background: relayChatGradient, color: '#3a2508' } : undefined}
                        >
                          {replyParent ? (
                            <div className={showText || m.image_url ? 'px-2 pt-2' : 'p-2'}>
                              <MessageReplyQuote
                                authorLabel={replyAuthorLabel(
                                  replyParent.sender_id,
                                  customerId,
                                  oneReplyEmbed(replyParent.profiles),
                                  {
                                    viewerIsCustomer: true,
                                    businessName: activeBiz?.name,
                                  }
                                )}
                                body={replyParent.body}
                                imageUrl={replyParent.image_url}
                                variant={replyQuoteVariant}
                                onClick={() => scrollToMessage(replyParent.id)}
                              />
                            </div>
                          ) : null}
                          {m.image_url ? (
                            <ChatMessageImage
                              imageUrl={m.image_url}
                              alt="Attachment"
                              className={clsx(
                                'max-w-full max-h-52 w-full object-cover block',
                                showText ? 'rounded-t-2xl' : 'rounded-2xl'
                              )}
                            />
                          ) : null}
                          {showText ? (
                            <LinkifiedText
                              text={m.body}
                              className={clsx(
                                'whitespace-pre-wrap break-words px-3 py-2.5',
                                mine ? 'text-[#3a2508]' : 'text-[#fff6e8]'
                              )}
                              linkClassName={mine ? 'text-[#3a2508] underline' : 'text-[#f0c86a] underline'}
                            />
                          ) : null}
                        </div>
                        )}
                        <div
                          className={clsx(
                            'mt-1 flex max-w-full items-center gap-2 px-0.5 text-[11px]',
                            mine ? 'justify-end text-right' : 'justify-start'
                          )}
                        >
                          <span className="text-[#cbb89a] tabular-nums">{timeAgo(m.created_at)}</span>
                          {!mine ? (
                            <button
                              type="button"
                              onClick={() => setCustomerReplyTarget(m)}
                              className="font-semibold text-[#f0c86a] hover:text-[#fff1c2] hover:underline"
                            >
                              Reply
                            </button>
                          ) : null}
                          {mine && isLastMine ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#f0c86a]">
                              {m.read && m.read_at ? (
                                <>
                                  <CheckCheck className="w-4 h-4 shrink-0 drop-shadow-sm" aria-hidden />
                                  <span>Read · {timeAgo(m.read_at)}</span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-4 h-4 shrink-0 text-[#cbb89a]" aria-hidden />
                                  <span className="text-[#cbb89a]">Delivered</span>
                                </>
                              )}
                            </span>
                          ) : null}
                          {!mine && isLastOther && m.read && m.read_at ? (
                            <span className="text-[#cbb89a]">Opened · {timeAgo(m.read_at)}</span>
                          ) : null}
                        </div>
                        </div>
                      </div>
                    )
                  })
                )}
                {peerTeamTyping ? (
                  <p className="text-left text-xs text-[#e7c373] pl-1 pb-0.5" aria-live="polite">
                    Team is typing…
                  </p>
                ) : null}
                <div ref={supportMessagesEndRef} className="h-px w-full" aria-hidden />
              </div>
              <ChatJumpToLatestButton
                visible={supportChatScroll.showJumpButton}
                onClick={() => supportChatScroll.jumpToLatest(scrollSupportToLatest)}
                tone="gold"
              />
              </div>

              <input
                ref={supportFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={onSupportImagePick}
              />

              <div className="shrink-0 border-t border-[#e1b55d]/25 bg-[#1a1428] p-2 space-y-2">
                {replyTarget ? (
                  <ReplyTargetBar
                    tone="gold"
                    authorLabel={replyAuthorLabel(
                      replyTarget.sender_id,
                      profile.id,
                      oneReplyEmbed(replyTarget.profiles),
                      {
                        viewerIsCustomer: true,
                        businessName: businesses.find((b) => b.id === supportBizId)?.name,
                      }
                    )}
                    previewText={replyPreviewText(replyTarget.body, replyTarget.image_url)}
                    onCancel={() => setCustomerReplyTarget(null)}
                  />
                ) : null}
                {pendingAttachment ? (
                  <div className="relative rounded-lg overflow-hidden border border-white/10 max-h-28">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pendingAttachment.previewUrl}
                      alt="Preview"
                      className="w-full h-24 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => clearPendingAttachment()}
                      className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center text-xs hover:bg-black/80"
                      aria-label="Remove photo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : null}
                <div className="flex items-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => supportFileInputRef.current?.click()}
                    className={clsx(
                      'p-2.5 rounded-full hover:bg-white/10 shrink-0',
                      isLight ? 'text-violet-600' : 'text-[#f0c86a]'
                    )}
                    aria-label="Attach photo"
                  >
                    <ImagePlus className="w-6 h-6" strokeWidth={1.75} />
                  </button>
                  <div className="flex-1 min-w-0 flex items-end gap-2 bg-[#140f1e] rounded-2xl px-3 py-1.5 border border-[#e1b55d]/30">
                    <textarea
                      key={supportBizId || 'none'}
                      rows={1}
                      value={supportDraft}
                      onChange={(e) => {
                        if (!supportBizId) return
                        customerComposerDirtyRef.current = true
                        setSupportDraftFor(supportBizId, e.target.value)
                      }}
                      placeholder="Aa"
                      className="flex-1 min-w-0 bg-transparent py-2 text-[15px] text-[#fff6e8] focus:outline-none placeholder:text-[#a89878] resize-none min-h-[40px] max-h-28 leading-snug"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendSupportMessage()
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={
                      supportLoading ||
                      (!supportDraft.trim() && !pendingAttachment)
                    }
                    onClick={() => void sendSupportMessage()}
                    className="p-2.5 rounded-full text-[#3a2508] shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                    style={{ background: relayChatGradient }}
                    aria-label="Send"
                  >
                    {supportLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {toast ? (
        <div
          role="status"
          className="fixed left-1/2 z-[60] max-w-sm -translate-x-1/2 rounded-xl border border-[#e1b55d]/40 bg-[#1a1428] px-4 py-3 text-center text-sm text-[#fff6e8] shadow-2xl max-[899px]:bottom-[calc(6.75rem+env(safe-area-inset-bottom))] min-[900px]:bottom-28"
        >
          {toast}
        </div>
      ) : null}
    </div>
  )
}



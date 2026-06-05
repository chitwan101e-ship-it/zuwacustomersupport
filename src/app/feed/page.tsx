'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markConversationNotificationsRead } from '@/lib/markConversationNotificationsRead'
import { markStaffMessagesReadForCustomer } from '@/lib/markStaffMessagesReadForCustomer'
import {
  countUnreadStaffMessages,
  loadCustomerChatPreviews,
  type ChatPreview,
} from '@/lib/customerMessaging'
import RelayLogo from '@/components/RelayLogo'
import { CustomerMobileFooterNav } from '@/components/CustomerMobileFooterNav'
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
  Users,
  X,
  ChevronRight,
  ImagePlus,
  Check,
  CheckCheck,
  Share2,
} from 'lucide-react'
import { ContentModerationMenu } from '@/components/ContentModerationMenu'
import { sharePostLink } from '@/lib/sharePostLink'
import { ChatMessageImage } from '@/components/ChatMessageImage'
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
  profiles: ProfileEmbed | ProfileEmbed[] | null
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
  profiles?: MessageSenderEmbed | MessageSenderEmbed[] | null
}

type AppearanceMode = 'dark' | 'playful'
const APPEARANCE_KEY = 'relay-appearance'

function getStoredAppearance(): AppearanceMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(APPEARANCE_KEY)
  if (stored === 'playful') return 'playful'
  if (stored === 'dark' || stored === 'light') return 'dark'
  return 'dark'
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

const MESSAGE_PROFILE_SELECT =
  'username, first_name, last_name, role, business_role, avatar_url'

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
}: {
  name: string
  imageUrl?: string | null
  className: string
  gradient: string
}) {
  if (imageUrl?.trim()) {
    return (
      <img
        src={imageUrl.trim()}
        alt={`${name} avatar`}
        className={`${className} rounded-full object-cover border border-white/20 shrink-0`}
      />
    )
  }
  return (
    <div
      className={`${className} rounded-full flex items-center justify-center font-bold text-white border border-white/30 shrink-0`}
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

function greetingSubtitle(d = new Date()) {
  const hour = d.getHours()
  if (hour < 12) return 'Start the day with the latest on your feed.'
  if (hour < 17) return 'Catch up on announcements and messages in one place.'
  if (hour < 22) return 'See what is new from businesses you follow today.'
  return 'Wind down — your feed and messages are right here when you need them.'
}

function greetingAccentEmoji(d = new Date()) {
  const hour = d.getHours()
  if (hour < 12) return '☀️'
  if (hour < 17) return '✨'
  if (hour < 22) return '🌆'
  return '🌙'
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
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({})
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
  const [supportDraft, setSupportDraft] = useState('')
  const [supportLoading, setSupportLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  /** Unread inbound team messages (drives the Messages FAB — delivered, not opened). */
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [chatPreviews, setChatPreviews] = useState<Map<string, ChatPreview>>(new Map())
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
  const [appearance, setAppearance] = useState<AppearanceMode>(() => getStoredAppearance())
  const [greeting, setGreeting] = useState(() => greetingByHour())
  const [greetingSub, setGreetingSub] = useState(() => greetingSubtitle())
  const [greetingEmoji, setGreetingEmoji] = useState(() => greetingAccentEmoji())
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File
    previewUrl: string
  } | null>(null)
  const supportFileInputRef = useRef<HTMLInputElement>(null)
  const supportMessagesScrollRef = useRef<HTMLDivElement>(null)
  const supportMessagesEndRef = useRef<HTMLDivElement>(null)
  /** Ref for feed realtime so the channel is not torn down when follows change. */
  const followedBusinessIdsRef = useRef<string[]>([])
  const consumedOpenChatQueryRef = useRef(false)
  const openPrimarySupportChatRef = useRef<() => Promise<void>>(async () => {})
  const supportChatChannelRef = useRef<ReturnType<(typeof supabase)['channel']> | null>(null)
  const supportChatBroadcastReadyRef = useRef(false)
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
        setAnnouncements([])
        setLikeRows([])
        setLikeCounts({})
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
      if (ids.length === 0) {
        setLikeRows([])
        setLikeCounts({})
        setCommentsByAnn({})
        return
      }

      const { data: reacts } = await supabase
        .from('reactions')
        .select('announcement_id, user_id, reaction')
        .in('announcement_id', ids)
        .eq('reaction', 'like')

      const counts: Record<string, number> = {}
      for (const r of reacts || []) {
        const aid = (r as { announcement_id: string }).announcement_id
        counts[aid] = (counts[aid] || 0) + 1
      }
      setLikeCounts(counts)

      const mine = (reacts || []).filter(
        (r: { user_id: string }) => r.user_id === uid
      ) as { announcement_id: string }[]
      setLikeRows(mine.map((r) => ({ announcement_id: r.announcement_id })))

      const { data: coms, error: comErr } = await supabase
        .from('comments')
        .select(
          `
          id,
          announcement_id,
          parent_comment_id,
          body,
          created_at,
          user_id,
          hidden_at,
          profiles ( ${COMMENT_PROFILE_SELECT} )
        `
        )
        .in('announcement_id', ids)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })

      if (comErr) {
        console.error(comErr)
        setCommentsByAnn({})
        return
      }

      const by: Record<string, CommentRow[]> = {}
      for (const c of (coms || []) as CommentRow[]) {
        if (!by[c.announcement_id]) by[c.announcement_id] = []
        by[c.announcement_id].push(c)
      }
      setCommentsByAnn(by)
    },
    [supabase]
  )

  const loadUnreadNotifications = useCallback(
    async (uid: string) => {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('read', false)
      if (error) {
        console.error(error)
        setUnreadNotifications(0)
        return
      }
      setUnreadNotifications(count ?? 0)
    },
    [supabase]
  )

  const refreshMessagingUI = useCallback(
    async (customerId: string) => {
      const { count, error: cuErr } = await countUnreadStaffMessages(supabase, customerId)
      if (!cuErr) setChatUnreadCount(count)
      const { previews, error: pvErr } = await loadCustomerChatPreviews(supabase, customerId)
      if (!pvErr) setChatPreviews(previews)
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
      await Promise.all([
        loadAnnouncements(uid, fids),
        loadUnreadNotifications(uid),
        refreshMessagingUI(uid),
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
      const fids = (followsRows || []).map((r) => (r as { business_id: string }).business_id)
      followedBusinessIdsRef.current = fids
      setFollowedBusinessIds(fids)

      await loadAnnouncements(session.user.id, fids)
      await loadUnreadNotifications(session.user.id)
      await refreshMessagingUI(session.user.id)
      if (cancelled) return
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase, loadAnnouncements, loadUnreadNotifications, refreshMessagingUI])

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== APPEARANCE_KEY) return
      const next = e.newValue
      if (next === 'playful') setAppearance('playful')
      else if (next === 'dark' || next === 'light') setAppearance('dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setGreeting(greetingByHour(now))
      setGreetingSub(greetingSubtitle(now))
      setGreetingEmoji(greetingAccentEmoji(now))
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
        el.classList.add('ring-2', 'ring-[#8d63ff]', 'ring-offset-2', 'ring-offset-[#050814]')
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-[#8d63ff]', 'ring-offset-2', 'ring-offset-[#050814]')
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
      if (has) {
        const { error } = await supabase
          .from('reactions')
          .delete()
          .eq('announcement_id', announcementId)
          .eq('user_id', profile.id)
          .eq('reaction', 'like')
        if (error) throw error
        setLikeRows((prev) => prev.filter((r) => r.announcement_id !== announcementId))
        setLikeCounts((prev) => ({
          ...prev,
          [announcementId]: Math.max(0, (prev[announcementId] || 0) - 1),
        }))
      } else {
        const { error } = await supabase.from('reactions').insert({
          announcement_id: announcementId,
          user_id: profile.id,
          reaction: 'like',
        })
        if (error) throw error
        setLikeRows((prev) => [...prev, { announcement_id: announcementId }])
        setLikeCounts((prev) => ({
          ...prev,
          [announcementId]: (prev[announcementId] || 0) + 1,
        }))
      }
    } catch (e) {
      console.error(e)
      showToast('Could not update like. Try again.')
    } finally {
      setBusyAnn(null)
    }
  }

  async function submitComment(announcementId: string) {
    if (!profile) return
    const text = (commentDraft[announcementId] || '').trim()
    if (!text) return
    setBusyAnn(`c-${announcementId}`)
    try {
      const { data, error } = await supabase
        .from('comments')
        .insert({
          announcement_id: announcementId,
          user_id: profile.id,
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
          profiles ( ${COMMENT_PROFILE_SELECT} )
        `
        )
        .single()

      if (error) throw error
      const row = data as CommentRow
      setCommentsByAnn((prev) => ({
        ...prev,
        [announcementId]: [...(prev[announcementId] || []), row],
      }))
      setCommentDraft((d) => ({ ...d, [announcementId]: '' }))
    } catch (e) {
      console.error(e)
      showToast('Could not post comment. Try again.')
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
      const { data, error } = await supabase
        .from('comments')
        .insert({
          announcement_id: announcementId,
          user_id: profile.id,
          body: text,
          parent_comment_id: parentCommentId,
        })
        .select(
          `
          id,
          announcement_id,
          parent_comment_id,
          body,
          created_at,
          user_id,
          profiles ( ${COMMENT_PROFILE_SELECT} )
        `
        )
        .single()

      if (error) throw error
      const row = data as CommentRow
      setCommentsByAnn((prev) => ({
        ...prev,
        [announcementId]: [...(prev[announcementId] || []), row],
      }))
      setReplyThreadDraft('')
      setReplyThreadTarget(null)
    } catch (e) {
      console.error(e)
      showToast('Could not post reply. Try again.')
    } finally {
      setBusyAnn(null)
    }
  }

  const loadConversationMessages = useCallback(
    async (conversationId: string, options?: { markRead?: boolean }) => {
      const sel = `id, conversation_id, sender_id, body, created_at, image_url, read, read_at, profiles ( ${MESSAGE_PROFILE_SELECT} )`
      const shouldMarkRead = options?.markRead ?? isActivelyViewingCustomerChat(conversationId)

      const { data: msgs, error: mErr } = await supabase
        .from('messages')
        .select(sel)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (mErr) throw mErr
      setMessages((msgs || []) as MessageRow[])

      if (shouldMarkRead) {
        const { errorMessage: markErr } = await markStaffMessagesReadForCustomer(supabase, conversationId)
        if (markErr) console.error(markErr)

        const { data: msgs2 } = await supabase
          .from('messages')
          .select(sel)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
        if (msgs2) setMessages(msgs2 as MessageRow[])
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
        tasks.push(
          loadConversationMessages(conversation.id, {
            markRead: supportOpen && supportPanelView === 'chat',
          })
        )
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
   * If NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG is set, it wins against the full businesses list
   * (not only businesses the customer follows) — otherwise a customer-only follow list would miss the support business.
   * When unset, prefer followed businesses for hints, then first team alphabetically.
   */
  function resolvePrimarySupportBusinessId(): string | null {
    const list = businesses
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
    const pool = followedRows.length > 0 ? followedRows : list

    const slugHints = ['support', 'relay', 'jbcoms', 'admin', 'help']
    for (const s of slugHints) {
      const hit = pool.find((b) => b.slug.toLowerCase() === s)
      if (hit) return hit.id
    }
    const byName = pool.find((b) => /support|helpdesk|help\s*desk|relay\s*support/i.test(b.name))
    if (byName) return byName.id
    return pickFirstByName(pool)
  }

  async function openPrimarySupportChat() {
    if (!profile) return
    const bid = resolvePrimarySupportBusinessId()
    if (!bid) {
      showToast('No team is available to message yet.')
      setSupportOpen(true)
      setSupportPanelView('list')
      return
    }
    setSupportOpen(true)
    await openThreadForBusiness(bid)
  }

  function closeMessagesPanel() {
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
    setSupportBizId(businessId)
    setSupportPanelView('chat')
    setSupportLoading(true)
    try {
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

      await loadConversationMessages(conv.id, { markRead: true })
    } catch (e) {
      console.error(e)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, queueFeedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, queueFeedRefresh)
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
  }, [supabase, profile?.id, loadAnnouncements, loadUnreadNotifications, refreshMessagingUI])

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
        () => {
          if (!isActivelyViewingCustomerChat(cid)) {
            const uid = profile?.id
            if (uid) void refreshMessagingUI(uid)
            return
          }
          void loadConversationMessages(cid, { markRead: true })
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

  /** Emit typing while the customer has text or an attachment in the composer. */
  useEffect(() => {
    if (!conversation?.id || !profile?.id) return
    if (!supportOpen || supportPanelView !== 'chat') return
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
    if (!profile?.id || !conversation?.id) return
    if (!supportOpen || supportPanelView !== 'chat') return
    const cid = conversation.id
    void (async () => {
      await loadConversationMessages(cid, { markRead: true })
      const { errorMessage: nErr } = await markConversationNotificationsRead(supabase, profile.id, cid)
      if (nErr) console.error(nErr)
      void loadUnreadNotifications(profile.id)
    })()
  }, [profile?.id, conversation?.id, supportOpen, supportPanelView, supabase, loadConversationMessages, loadUnreadNotifications])

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

  function clearPendingAttachment() {
    setPendingAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
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
    setPendingAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return { file: f, previewUrl: URL.createObjectURL(f) }
    })
  }

  const scrollSupportToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const end = supportMessagesEndRef.current
    if (end) {
      end.scrollIntoView({ block: 'end', behavior })
      return
    }
    const el = supportMessagesScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    if (supportOpen) return
    setPendingAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
    setSupportDraft('')
  }, [supportOpen])

  useEffect(() => {
    if (!supportOpen || supportPanelView !== 'chat' || !conversation?.id) return
    const raf = window.requestAnimationFrame(() => scrollSupportToLatest('auto'))
    return () => window.cancelAnimationFrame(raf)
  }, [supportOpen, supportPanelView, conversation?.id, messages.length, scrollSupportToLatest])

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

      const sel = `id, conversation_id, sender_id, body, created_at, image_url, read, read_at, profiles ( ${MESSAGE_PROFILE_SELECT} )`

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          sender_id: profile.id,
          body,
          image_url: imageUrl,
        })
        .select(sel)
        .single()

      if (error) throw error
      setMessages((prev) => [...prev, data as MessageRow])
      setSupportDraft('')
      clearPendingAttachment()
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
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const sortedBusinesses = useMemo(() => {
    return [...businesses].sort((a, b) => {
      const pa = chatPreviews.get(a.id)
      const pb = chatPreviews.get(b.id)
      const ta = pa ? new Date(pa.lastAt).getTime() : 0
      const tb = pb ? new Date(pb.lastAt).getTime() : 0
      if (tb !== ta) return tb - ta
      return a.name.localeCompare(b.name)
    })
  }, [businesses, chatPreviews])

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

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const fbBlue = appearance === 'playful' ? '#a171ff' : '#8d63ff'
  /** Relay messaging panel — purple gradient (HTML mock), not Messenger blue */
  const relayChatFrom = appearance === 'playful' ? '#8d63ff' : '#7c5af6'
  const relayChatTo = '#5a7ff6'
  const relayChatGradient = `linear-gradient(135deg, ${relayChatFrom}, ${relayChatTo})`
  /** Light theme removed — keep flag so existing ternaries resolve to dark styling. */
  const isLight = false
  const isPlayful = appearance === 'playful'
  const pageBg = isLight
    ? 'bg-[radial-gradient(circle_at_top,_#eef2ff_0%,_#f8faff_40%,_#ffffff_100%)] text-slate-900'
    : isPlayful
      ? 'bg-[radial-gradient(circle_at_top,_#2b1d63_0%,_#100e2a_40%,_#070713_100%)] text-white'
      : 'bg-[radial-gradient(circle_at_top,_#1c2757_0%,_#070a18_42%,_#050814_100%)] text-white'
  const panelBg = isLight ? 'bg-white/95 border-slate-200' : 'bg-[#0e1734]/80 border-white/10'
  const softPanelBg = isLight ? 'bg-white/95 border-slate-200' : 'bg-[#0e1734]/75 border-white/10'
  const mutedText = isLight ? 'text-slate-500' : 'text-[#7f8bad]'
  const bodyText = isLight ? 'text-slate-700' : 'text-[#b8c0dc]'
  const headingText = isLight ? 'text-slate-900 font-semibold' : 'text-white font-semibold'
  const strongHeadingText = isLight ? 'text-slate-900 font-bold tracking-tight' : 'text-white font-extrabold tracking-tight'
  const commentInputText = isLight ? 'text-slate-800 placeholder:text-slate-400' : 'placeholder:text-[#8e99bd]'

  return (
    <div className={`min-h-[100dvh] grid grid-rows-[auto_1fr] overflow-hidden ${pageBg}`}>
      {/* Top nav + greeting — one frosted shell, toolbar / divider / hero for clearer hierarchy */}
      <header className="relative z-30 pt-3 px-4 min-[900px]:pt-4 min-[900px]:px-5">
        <div
          className={`rounded-[20px] border backdrop-blur-xl shadow-[0_24px_70px_-28px_rgba(12,18,56,0.95)] overflow-hidden ${
            isLight ? 'bg-white/92 border-slate-200' : 'bg-[#0b1228]/90 border-white/[0.09]'
          }`}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2.5 min-[900px]:px-4 min-[900px]:pt-3.5">
            <div className="min-w-0 flex-1 pr-2">
              <RelayLogo theme={isLight ? 'light' : 'dark'} size="md" className="min-w-0" />
            </div>
            <div
              className={`flex items-center gap-1.5 shrink-0 overflow-visible rounded-full p-1 pr-1.5 ${
                isLight ? 'bg-slate-100/80 ring-1 ring-slate-200/80' : 'bg-black/20 ring-1 ring-white/[0.07]'
              }`}
            >
              <CustomerRefreshButton
                busy={feedRefreshing}
                isLight={isLight}
                onRefresh={refreshFeed}
                aria-label="Refresh feed"
              />
              <button
                type="button"
                onClick={() => router.push('/notifications')}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                  isLight
                    ? 'bg-white text-slate-600 border-slate-200/90 hover:bg-slate-50'
                    : 'bg-white/[0.06] text-[#d8def5] border-white/[0.08] hover:bg-white/[0.11]'
                }`}
                aria-label="Notifications"
              >
                <Bell className="w-[18px] h-[18px]" strokeWidth={2} />
                {unreadNotifications > 0 ? (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b5c] text-white text-[9px] font-extrabold flex items-center justify-center shadow-[0_2px_8px_rgba(255,59,92,0.45)] ring-2 ring-[#0b1228]">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => router.push('/profile')}
                className="relative h-10 w-10 shrink-0"
                aria-label="Open profile"
              >
                <span className="block h-10 w-10 overflow-hidden rounded-full ring-1 ring-white/15">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={`${profile.username} avatar`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-[#d23a34] text-xs font-bold text-white">
                      {initials(profile.username)}
                    </span>
                  )}
                </span>
                <span
                  className={`pointer-events-none absolute bottom-0 right-0 box-border h-3 w-3 rounded-full border-2 bg-[#22c55e] shadow-[0_0_0_1px_rgba(0,0,0,0.2)] ${
                    isLight ? 'border-white' : 'border-[#0b1228]'
                  }`}
                  aria-hidden
                />
              </button>
            </div>
          </div>

          <div
            className={`h-px mx-4 bg-gradient-to-r from-transparent ${isLight ? 'via-slate-300/70' : 'via-white/[0.12]'} to-transparent`}
            aria-hidden
          />

          <div className="relative px-4 pt-3.5 pb-4 min-[900px]:px-4 min-[900px]:pb-4">
            <div
              className={`pointer-events-none absolute -right-10 -top-6 h-[140px] w-[140px] rounded-full ${
                isLight ? 'bg-violet-300/20' : 'bg-[radial-gradient(circle,rgba(141,99,255,0.22)_0%,transparent_72%)]'
              }`}
              aria-hidden
            />
            <div className="relative min-w-0 max-w-[22rem]">
              <p
                className={`text-[10px] font-semibold uppercase tracking-[0.12em] leading-snug mb-2 ${
                  isLight ? 'text-violet-600/90' : 'text-[#8f9ab8]'
                }`}
              >
                {greetingSub}
              </p>
              <h1
                className={`font-extrabold tracking-[-0.03em] leading-[1.12] flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[clamp(1.35rem,4.5vw,1.85rem)] ${strongHeadingText}`}
              >
                <span
                  className={`min-w-0 ${
                    isLight
                      ? 'bg-gradient-to-r from-violet-700 via-fuchsia-600 to-sky-600 bg-clip-text text-transparent'
                      : 'bg-gradient-to-r from-[#ebe4ff] via-white to-[#bfefff] bg-clip-text text-transparent'
                  }`}
                >
                  {greeting}, {profile.first_name?.trim() || profile.username}
                </span>
                <span className="inline-flex shrink-0 select-none text-[1.2em] leading-none translate-y-[0.06em]" aria-hidden>
                  {greetingEmoji}
                </span>
              </h1>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop: 220px rail | scroll feed | 260px aside; mobile: single column */}
      <div className="min-h-0 overflow-hidden flex flex-col min-[900px]:grid min-[900px]:grid-cols-[220px_minmax(0,1fr)_260px] min-[900px]:gap-4 px-3.5 min-[900px]:px-5 min-[900px]:pb-5">
        <aside className={`hidden min-[900px]:block min-h-0`}>
          <div className={`sticky top-3 space-y-0.5 rounded-2xl border p-2.5 ${softPanelBg}`}>
            <div
              className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium cursor-default ${
                isLight ? 'text-slate-800' : 'text-[#c4cbe6]'
              }`}
            >
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="w-[30px] h-[30px] rounded-full object-cover border border-white/10 shrink-0"
                />
              ) : (
                <div
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                  style={{ backgroundColor: fbBlue }}
                >
                  {initials(profile.username)}
                </div>
              )}
              <span className="truncate">{profile.username}</span>
            </div>
            <div
              className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium ${
                isLight ? 'bg-violet-100 text-violet-700' : 'bg-[#8d63ff]/12 text-[#8d63ff]'
              }`}
            >
              <Home className="w-7 h-7 shrink-0" strokeWidth={2} />
              Home
            </div>
            <Link
              href="/notifications"
              className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
                isLight ? 'text-slate-700 hover:bg-slate-100' : 'text-[#c4cbe6] hover:bg-white/5'
              }`}
            >
              <Bell className="w-7 h-7 shrink-0" strokeWidth={2} />
              Notifications
            </Link>
            <button
              type="button"
              onClick={() => document.getElementById('relay-feed-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`w-full flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
                isLight ? 'text-slate-700 hover:bg-slate-100' : 'text-[#c4cbe6] hover:bg-white/5'
              }`}
            >
              <Users className="w-7 h-7 shrink-0 text-[#8d63ff]" strokeWidth={2} />
              Announcements
            </button>
          </div>
        </aside>

        <main
          id="relay-feed-main"
          className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-3 pt-2 pb-[calc(4.75rem+env(safe-area-inset-bottom))] min-[900px]:pt-0 min-[900px]:pb-0 scroll-mt-2"
        >
          {followedBusinessIds.length === 0 ? (
            <div className={`rounded-3xl border p-8 sm:p-10 text-center shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)] ${panelBg}`}>
              <Building2 className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-slate-400' : 'text-[#7f8cb7]'}`} />
              <p className={`text-lg ${headingText}`}>No team feed yet</p>
              <p className={`${mutedText} text-sm mt-2 max-w-md mx-auto leading-relaxed`}>
                Your account is not linked to a team feed. After an admin approves you, you are automatically connected to their
                announcements. Refresh this page if you were just approved, or sign out and back in.
              </p>
            </div>
          ) : announcements.length === 0 ? (
            <div className={`rounded-3xl border p-10 text-center shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)] ${panelBg}`}>
              <Building2 className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-slate-400' : 'text-[#7f8cb7]'}`} />
              <p className={`text-[15px] ${headingText}`}>No announcements yet</p>
              <p className={`${mutedText} text-sm mt-1`}>
                When your team publishes an update, it will show up here. You can still use Messages to reach support anytime.
              </p>
            </div>
          ) : (
            announcements.map((a) => {
              const biz = one(a.businesses)
              const bizName = biz?.name || 'Business'
              const postAvatarUrl = announcementAvatarUrl(a)
              const liked = likeRows.some((r) => r.announcement_id === a.id)
              const count = likeCounts[a.id] || 0
              const comments = commentsByAnn[a.id] || []
              const open = openComments[a.id]
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
                          isLight ? 'bg-white border-slate-200' : 'bg-[#131d3d] border-white/10'
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
                                isLight ? 'border-slate-200 bg-slate-50 text-slate-900' : 'border-white/10 bg-[#0f1a38] text-white'
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
                          className={`text-[11px] font-semibold ${isLight ? 'text-[#1877f2]' : 'text-[#8d63ff]'}`}
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
                            className={`flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm outline-none resize-none min-h-[40px] max-h-28 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-[#0f1a38]'} ${commentInputText}`}
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
                <article
                  id={`announcement-${a.id}`}
                  key={a.id}
                  className={`rounded-3xl border overflow-hidden shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)] scroll-mt-24 ${panelBg}`}
                >
                  <div className="p-4 pb-0">
                    <div className="flex items-start gap-3">
                      {postAvatarUrl ? (
                        <img
                          src={postAvatarUrl}
                          alt={`${bizName} avatar`}
                          className="w-10 h-10 rounded-full object-cover shrink-0 border border-white/10"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                          style={{ backgroundColor: fbBlue }}
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
                        <div className={`flex items-center gap-1 text-xs ${mutedText}`}>
                          <span>{timeAgo(a.created_at)}</span>
                          <span>·</span>
                          <Building2 className="w-3 h-3" />
                          {biz?.slug ? <span className="truncate">{biz.slug}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className={`mt-3 text-[15px] ${isLight ? 'text-slate-800' : 'text-white'}`}>
                      {a.title.trim() ? (
                        <ExpandablePostText
                          text={a.title}
                          collapsedLines={3}
                          isLight={isLight}
                          className={`mb-1.5 font-semibold ${headingText}`}
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
                    <div className="mt-3 px-1">
                      <FeedPostImage imageUrl={a.image_url} alt="" />
                    </div>
                  ) : null}

                  {count > 0 && (
                    <div className="px-4 pt-3 flex items-center gap-2 text-sm text-[#b8c0dc]">
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px]"
                        style={{ backgroundColor: fbBlue }}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </span>
                      <span>{count}</span>
                    </div>
                  )}

                  <div className="px-2 py-1 mt-2 border-t border-white/10">
                    <div className="flex">
                      <button
                        type="button"
                        disabled={busyAnn === a.id}
                        onClick={() => void toggleLike(a.id)}
                        className={clsx(
                          'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[15px] font-medium transition-colors',
                          liked ? 'text-[#9a87ff]' : isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-[#b8c0dc] hover:bg-white/10'
                        )}
                      >
                        {busyAnn === a.id ? (
                          <Loader2 className="w-[18px] h-[18px] animate-spin" />
                        ) : (
                          <ThumbsUp
                            className={clsx(
                              'w-[18px] h-[18px]',
                              liked && 'fill-[#1877f2] text-[#8d63ff]'
                            )}
                          />
                        )}
                        Like
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenComments((o) => ({ ...o, [a.id]: !o[a.id] }))
                        }
                        className={clsx(
                          `flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[15px] font-medium ${isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-[#b8c0dc] hover:bg-white/10'}`,
                          open && 'text-[#8d63ff]'
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
                          'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[15px] font-medium',
                          isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-[#b8c0dc] hover:bg-white/10'
                        )}
                        aria-label="Share post"
                      >
                        <Share2 className="w-[18px] h-[18px]" />
                        Share
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className={`${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#091028] border-white/10'} border-t px-3 py-3 space-y-3`}>
                      {comments.length === 0 ? (
                        <p className={`text-sm ${mutedText} text-center py-2`}>No comments yet.</p>
                      ) : (
                        <ul className="space-y-3">
                          {(byParent.get(null) || []).map((c) => renderCommentNode(c, 0))}
                        </ul>
                      )}
                      <div className={`flex gap-2 items-end rounded-2xl px-3 py-1.5 border ${isLight ? 'bg-white border-slate-200' : 'bg-[#0f1a38] border-white/10'}`}>
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
              )
            })
          )}
        </main>

        <aside className="hidden min-[900px]:block min-h-0">
          <div className={`sticky top-3 rounded-2xl border p-3.5 ${softPanelBg}`}>
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.15em] mb-2 ${
                isLight ? 'text-slate-500' : 'text-[#8892b0]'
              }`}
            >
              Quick tip
            </p>
            <p className={`text-[13px] leading-relaxed ${bodyText}`}>
              Tap the <strong className={isLight ? 'text-violet-600' : 'text-[#8d63ff]'}>chat</strong> button to open
              Messages. Pick a business and send text or photos — fast and private.
            </p>
          </div>
        </aside>
      </div>

      <CustomerMobileFooterNav
        unreadNotifications={unreadNotifications}
        unreadChatCount={chatUnreadCount}
        isLight={isLight}
        onChatClick={() => onMessagesEntryClick()}
        chatActive={supportOpen}
      />

      {/* Relay messages panel */}
      {supportOpen && (
        <div
          className="fixed z-50 flex flex-col rounded-[20px] shadow-2xl border border-[#8d63ff]/30 bg-[#0a1228] overflow-hidden w-[min(340px,calc(100vw-1.75rem))] sm:w-[380px] h-[min(85dvh,620px)] max-h-[min(calc(100dvh-8rem-env(safe-area-inset-bottom)),620px)] min-[900px]:max-h-[calc(100dvh-7rem)] max-[899px]:bottom-[calc(6.5rem+env(safe-area-inset-bottom))] min-[900px]:bottom-24 right-[max(0.875rem,env(safe-area-inset-right))]"
        >
          <div
            className="flex items-center gap-2 px-2 py-2.5 text-white shrink-0 min-h-[52px]"
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
                    />
                  )
                })()}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate leading-tight">
                    {businesses.find((b) => b.id === supportBizId)?.name || 'Business'}
                  </div>
                  <div className="text-[11px] text-white/85">
                    {supportLoading && !conversation ? 'Opening…' : 'Relay · live'}
                  </div>
                </div>
              </>
            ) : (
              <>
                <MessageCircle className="w-5 h-5 shrink-0 ml-1" strokeWidth={2.5} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">Messages</div>
                  <div className="text-[11px] text-white/85">Messages · live</div>
                </div>
              </>
            )}
            <div className="flex items-center gap-0.5 shrink-0 ml-auto">
              <CustomerRefreshButton
                variant="panel"
                busy={messagesRefreshing}
                onRefresh={refreshMessagesPanel}
                aria-label={
                  supportPanelView === 'chat' ? 'Refresh conversation' : 'Refresh message list'
                }
              />
              <button
                type="button"
                onClick={() => closeMessagesPanel()}
                className="p-2 rounded-full hover:bg-white/20 shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {supportPanelView === 'list' && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#0f1a38]">
              <div className="flex-1 overflow-y-auto">
                {sortedBusinesses.length === 0 ? (
                  <p className="p-6 text-center text-sm text-[#7f8bad]">
                    No businesses to message yet.
                  </p>
                ) : (
                  sortedBusinesses.map((b) => {
                    const pv = chatPreviews.get(b.id)
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
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 border-b border-white/10 text-left transition-colors disabled:opacity-50"
                      >
                        <div className="relative shrink-0">
                          <ChatAvatar
                            name={b.name}
                            imageUrl={businessChatAvatarUrl(b)}
                            className="w-12 h-12 text-sm"
                            gradient={relayChatGradient}
                          />
                          {unread > 0 ? (
                            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3355] text-white text-[10px] font-extrabold leading-[18px] text-center border-2 border-[#0f1a38]">
                              {unread > 9 ? '9+' : unread}
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[15px] text-white truncate">{b.name}</div>
                          <div className="text-xs text-[#9ba6cb] truncate">{line}</div>
                        </div>
                        {supportLoading && supportBizId === b.id ? (
                          <Loader2 className="w-5 h-5 animate-spin text-gray-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {supportPanelView === 'chat' && supportBizId && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#0b132c]">
              {supportLoading && !conversation ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 min-h-0">
                  <Loader2 className="h-9 w-9 animate-spin text-[#8d63ff]" aria-hidden />
                  <p className="text-sm text-[#9ba6cb]">Opening your messages…</p>
                </div>
              ) : conversation ? (
                <>
              <div ref={supportMessagesScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    {(() => {
                      const activeBiz = businesses.find((b) => b.id === supportBizId)
                      return (
                        <ChatAvatar
                          name={activeBiz?.name || 'Business'}
                          imageUrl={businessChatAvatarUrl(activeBiz)}
                          className="w-14 h-14 text-sm mb-3"
                          gradient={relayChatGradient}
                        />
                      )
                    })()}
                    <p className="text-sm font-medium text-white">No messages yet</p>
                    <p className="text-xs text-[#7f8bad] mt-1">
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
                    const isLastMine = mine && i === feedSeenIndexes.lastMine
                    const isLastOther = !mine && i === feedSeenIndexes.lastOther
                    return (
                      <div
                        key={m.id}
                        className={clsx(
                          'flex w-full max-w-full shrink-0',
                          mine ? 'justify-end' : 'justify-start gap-2'
                        )}
                      >
                        {!mine && showAvatar ? (
                          <ChatAvatar
                            name={avatarName}
                            imageUrl={avatarUrl}
                            className="w-7 h-7 text-[10px] self-end mb-5"
                            gradient={relayChatGradient}
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
                        {teamLine ? (
                          <p
                            className="text-[10px] text-[#aeb7d6] px-1 pb-0.5 font-medium truncate max-w-full"
                            title={teamLine}
                          >
                            {teamLine}
                          </p>
                        ) : null}
                        <div
                          className={clsx(
                            'text-sm shadow-lg overflow-hidden max-w-full ring-1 ring-white/10',
                            mine
                              ? 'rounded-2xl rounded-br-md'
                              : 'rounded-2xl rounded-bl-md bg-[#13213d] text-white border border-[#8d63ff]/20'
                          )}
                          style={mine ? { background: relayChatGradient, color: 'white' } : undefined}
                        >
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
                                mine ? 'text-white' : 'text-[#e3e8f8]'
                              )}
                              linkClassName={mine ? 'text-white' : 'text-[#b8c8ff]'}
                            />
                          ) : null}
                        </div>
                        <div
                          className={clsx(
                            'mt-1 flex max-w-full items-center gap-2 px-0.5 text-[11px]',
                            mine ? 'justify-end text-right' : 'justify-start'
                          )}
                        >
                          <span className="text-[#7f8bad] tabular-nums">{timeAgo(m.created_at)}</span>
                          {mine && isLastMine ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-violet-100/95">
                              {m.read && m.read_at ? (
                                <>
                                  <CheckCheck className="w-4 h-4 shrink-0 drop-shadow-sm" aria-hidden />
                                  <span>Read · {timeAgo(m.read_at)}</span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-4 h-4 shrink-0 text-white/50" aria-hidden />
                                  <span className="text-white/70">Delivered</span>
                                </>
                              )}
                            </span>
                          ) : null}
                          {!mine && isLastOther && m.read && m.read_at ? (
                            <span className="text-[#6b7aad]">Opened · {timeAgo(m.read_at)}</span>
                          ) : null}
                        </div>
                        </div>
                      </div>
                    )
                  })
                )}
                {peerTeamTyping ? (
                  <p className="text-left text-xs text-[#9ba6cb] pl-1 pb-0.5" aria-live="polite">
                    Team is typing…
                  </p>
                ) : null}
                <div ref={supportMessagesEndRef} className="h-px w-full" aria-hidden />
              </div>

              <input
                ref={supportFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={onSupportImagePick}
              />

              <div className="shrink-0 border-t border-white/10 bg-[#0f1a38] p-2 space-y-2">
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
                      isLight ? 'text-violet-600' : 'text-[#b8a6ff]'
                    )}
                    aria-label="Attach photo"
                  >
                    <ImagePlus className="w-6 h-6" strokeWidth={1.75} />
                  </button>
                  <div className="flex-1 min-w-0 flex items-end gap-2 bg-[#0b132c] rounded-2xl px-3 py-1.5 border border-white/10/80">
                    <textarea
                      rows={1}
                      value={supportDraft}
                      onChange={(e) => setSupportDraft(e.target.value)}
                      placeholder="Aa"
                      className="flex-1 min-w-0 bg-transparent py-2 text-[15px] focus:outline-none placeholder:text-[#7f8bad] resize-none min-h-[40px] max-h-28 leading-snug"
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
                    className="p-2.5 rounded-full text-white shrink-0 disabled:opacity-40 disabled:pointer-events-none"
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
              background: 'linear-gradient(135deg, #7c5af6, #5a7ff6)',
              boxShadow: '0 8px 28px -6px rgba(124,90,246,0.7)',
            }}
            aria-label="Open messages"
            aria-expanded={false}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="select-none pointer-events-none transition-transform duration-200 ease-out group-hover:scale-[1.06] group-hover:-translate-y-0.5"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {chatUnreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[#050814] bg-[#ff3b5c] px-1 text-[9px] font-extrabold leading-none text-white">
                {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed left-1/2 z-[60] max-w-sm -translate-x-1/2 rounded-xl border border-white/15 bg-[#11172a] px-4 py-3 text-center text-sm text-white shadow-2xl max-[899px]:bottom-[calc(6.75rem+env(safe-area-inset-bottom))] min-[900px]:bottom-28"
        >
          {toast}
        </div>
      ) : null}
    </div>
  )
}



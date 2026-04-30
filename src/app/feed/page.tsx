'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RelayLogo from '@/components/RelayLogo'
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
  Search,
  Home,
  Users,
  X,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
} from 'lucide-react'

type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  account_status?: string
}
type BusinessRow = { id: string; name: string; slug: string }
type BizEmbed = { id: string; name: string; slug: string }
type AnnouncementRow = {
  id: string
  title: string
  body: string
  image_url?: string | null
  created_at: string
  business_id: string
  businesses: BizEmbed | BizEmbed[] | null
}
type ProfileEmbed = { username: string; first_name: string; last_name: string }
type CommentRow = {
  id: string
  announcement_id: string
  body: string
  created_at: string
  user_id: string
  profiles: ProfileEmbed | ProfileEmbed[] | null
}
type ConversationRow = { id: string; business_id: string; customer_id: string; status: string }
type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  image_url?: string | null
}

type AppearanceMode = 'dark' | 'light' | 'playful'
const APPEARANCE_KEY = 'relay-appearance'

function getStoredAppearance(): AppearanceMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(APPEARANCE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'playful') return stored
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

function extFromImageFile(f: File) {
  if (f.type === 'image/png') return 'png'
  if (f.type === 'image/webp') return 'webp'
  if (f.type === 'image/gif') return 'gif'
  return 'jpg'
}

function greetingByHour(d = new Date()) {
  const hour = d.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function FeedPage() {
  const router = useRouter()
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

  const [businesses, setBusinesses] = useState<BusinessRow[]>([])
  const [supportBizId, setSupportBizId] = useState<string>('')
  const [conversation, setConversation] = useState<ConversationRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [supportDraft, setSupportDraft] = useState('')
  const [supportLoading, setSupportLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportPanelView, setSupportPanelView] = useState<'list' | 'chat'>('list')
  const [appearance, setAppearance] = useState<AppearanceMode>(() => getStoredAppearance())
  const [greeting, setGreeting] = useState(() => greetingByHour())
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File
    previewUrl: string
  } | null>(null)
  const supportFileInputRef = useRef<HTMLInputElement>(null)

  const loadAnnouncements = useCallback(
    async (uid: string) => {
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
          businesses ( id, name, slug )
        `
        )
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
          body,
          created_at,
          user_id,
          profiles ( username, first_name, last_name )
        `
        )
        .in('announcement_id', ids)
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

  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/signup')
        return
      }

      const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('id, role, username, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (pErr || !prof) {
        console.error(pErr)
        router.replace('/signup')
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

      const { data: biz, error: bErr } = await supabase
        .from('businesses')
        .select('id, name, slug')
        .order('name')

      if (!bErr && biz) setBusinesses(biz as BusinessRow[])

      await loadAnnouncements(session.user.id)
      await loadUnreadNotifications(session.user.id)
      if (cancelled) return
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase, loadAnnouncements, loadUnreadNotifications])

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== APPEARANCE_KEY) return
      const next = e.newValue
      if (next === 'dark' || next === 'light' || next === 'playful') setAppearance(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setGreeting(greetingByHour()), 60_000)
    setGreeting(greetingByHour())
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (loading) return
    const postId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('post') : null
    if (!postId) return
    const t = window.setTimeout(() => {
      document.getElementById(`announcement-${postId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    return () => window.clearTimeout(t)
  }, [loading, announcements])

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
          body,
          created_at,
          user_id,
          profiles ( username, first_name, last_name )
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
    } finally {
      setBusyAnn(null)
    }
  }

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      const { data: msgs, error: mErr } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, created_at, image_url')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (mErr) throw mErr
      setMessages((msgs || []) as MessageRow[])
    },
    [supabase]
  )

  async function openThreadForBusiness(businessId: string) {
    if (!profile || !businessId) return
    setSupportBizId(businessId)
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

      await loadConversationMessages(conv.id)
      setSupportPanelView('chat')
    } catch (e) {
      console.error(e)
      setConversation(null)
      setMessages([])
      setSupportPanelView('list')
    } finally {
      setSupportLoading(false)
    }
  }

  useEffect(() => {
    if (!profile?.id) return

    let timer: number | null = null
    const queueFeedRefresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (profile?.id) void loadAnnouncements(profile.id)
      }, 300)
    }

    const channel = supabase
      .channel(`customer-feed-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, queueFeedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, queueFeedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, queueFeedRefresh)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        () => void loadUnreadNotifications(profile.id)
      )
      .subscribe()

    return () => {
      if (timer) window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, profile?.id, loadAnnouncements, loadUnreadNotifications])

  useEffect(() => {
    if (!conversation?.id) return
    const channel = supabase
      .channel(`customer-chat-${conversation.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        () => void loadConversationMessages(conversation.id)
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, conversation?.id, loadConversationMessages])

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

  function toggleSupportPanel() {
    setSupportOpen((wasOpen) => {
      if (wasOpen) return false
      setSupportPanelView('list')
      return true
    })
  }

  useEffect(() => {
    if (supportOpen) return
    setPendingAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
    setSupportDraft('')
  }, [supportOpen])

  async function sendSupportMessage() {
    if (!profile || !conversation) return
    const text = supportDraft.trim()
    const hasImage = !!pendingAttachment
    if (!text && !hasImage) return

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

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          sender_id: profile.id,
          body,
          image_url: imageUrl,
        })
        .select('id, conversation_id, sender_id, body, created_at, image_url')
        .single()

      if (error) throw error
      setMessages((prev) => [...prev, data as MessageRow])
      setSupportDraft('')
      clearPendingAttachment()
    } catch (e) {
      console.error(e)
      alert(
        'Could not send. Run supabase/migrations/002_message_images_storage.sql in the Supabase SQL Editor (adds image_url + storage), then try again.'
      )
    } finally {
      setSupportLoading(false)
    }
  }

  async function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return
    await supabase.auth.signOut()
    router.replace('/signup')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const fbBlue = appearance === 'playful' ? '#a171ff' : appearance === 'light' ? '#6a67ff' : '#8d63ff'
  const messengerBlue = appearance === 'playful' ? '#7c4dff' : appearance === 'light' ? '#4169e1' : '#0084ff'
  const messengerBlueDark = appearance === 'playful' ? '#5c36d6' : appearance === 'light' ? '#2d52c9' : '#006edf'
  const isLight = appearance === 'light'
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
    <div className={`min-h-screen pb-28 ${pageBg}`}>
      {/* Relay-style top section */}
      <header className={`sticky top-0 z-40 backdrop-blur-xl border-b ${isLight ? 'bg-white/90 border-slate-200' : 'bg-[#0b1020]/88 border-white/10'}`}>
        <div className="max-w-7xl mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <RelayLogo theme={isLight ? 'light' : 'dark'} size="md" />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/notifications')}
                className="relative p-2 rounded-full hover:bg-white/10"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5 text-[#b8c0dc]" />
                {unreadNotifications > 0 ? (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#8d63ff] text-white text-[10px] font-bold leading-4 text-center">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => router.push('/profile')}
                className="relative"
                aria-label="Open profile"
              >
                <div className="w-10 h-10 rounded-full bg-[#d23a34] text-white flex items-center justify-center text-sm font-bold">
                  {initials(profile.username)}
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#2fd17f] border-2 border-[#0b1020]" />
              </button>
            </div>
          </div>
          <div className={`max-w-full rounded-2xl border px-4 py-3 ${softPanelBg}`}>
            <h1 className={`text-2xl sm:text-[2.1rem] leading-tight flex items-center gap-2 ${strongHeadingText}`}>
              <span className="truncate">{greeting}, {profile.username}</span>
              <span className="inline-block shrink-0">👋</span>
            </h1>
            <p className={`${mutedText} text-sm sm:text-base mt-1`}>Here's what's happening</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex justify-center items-start gap-6 px-2 sm:px-4 pt-5">
        {/* Left shortcuts — Facebook-style rail */}
        <aside className={`hidden xl:block w-[280px] shrink-0 space-y-1 sticky top-24 self-start rounded-2xl border p-3 backdrop-blur-xl ${softPanelBg}`}>
          <div className={`flex items-center gap-3 rounded-xl px-2 py-2 cursor-default ${isLight ? 'hover:bg-slate-100' : 'hover:bg-white/10'}`}>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
              style={{ backgroundColor: fbBlue }}
            >
              {initials(profile.username)}
            </div>
            <span className={`font-medium truncate ${isLight ? 'text-slate-800' : 'text-white'}`}>{profile.username}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-[#1a2347] px-2 py-2 text-[#a894ff]">
            <Home className="w-7 h-7 shrink-0" strokeWidth={2} />
            <span className="font-medium">Home</span>
          </div>
          <div className={`flex items-center gap-3 rounded-xl px-2 py-2 ${isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-white/10 text-[#c4cbe6]'}`}>
            <Users className="w-7 h-7 shrink-0 text-[#8d63ff]" strokeWidth={2} />
            <span className="font-medium">Announcements</span>
          </div>
        </aside>

        {/* Center feed — all announcements */}
        <main className="w-full max-w-[700px] shrink-0 space-y-4 pb-8">
          {announcements.length === 0 ? (
            <div className={`rounded-3xl border p-10 text-center shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)] ${panelBg}`}>
              <Building2 className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-slate-400' : 'text-[#7f8cb7]'}`} />
              <p className={`text-[15px] ${headingText}`}>No announcements yet</p>
              <p className={`${mutedText} text-sm mt-1`}>
                When businesses post updates, they will appear here in your feed.
              </p>
            </div>
          ) : (
            announcements.map((a) => {
              const biz = one(a.businesses)
              const bizName = biz?.name || 'Business'
              const liked = likeRows.some((r) => r.announcement_id === a.id)
              const count = likeCounts[a.id] || 0
              const comments = commentsByAnn[a.id] || []
              const open = openComments[a.id]

              return (
                <article
                  id={`announcement-${a.id}`}
                  key={a.id}
                  className={`rounded-3xl border overflow-hidden shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)] scroll-mt-24 ${panelBg}`}
                >
                  <div className="p-4 pb-0">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                        style={{ backgroundColor: fbBlue }}
                      >
                        {initials(bizName)}
                      </div>
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className={`hover:underline cursor-default truncate ${headingText}`}>
                          {bizName}
                        </div>
                        <div className={`flex items-center gap-1 text-xs ${mutedText}`}>
                          <span>{timeAgo(a.created_at)}</span>
                          <span>·</span>
                          <Building2 className="w-3 h-3" />
                          {biz?.slug ? <span className="truncate">{biz.slug}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className={`mt-3 text-[15px] ${isLight ? 'text-slate-800' : 'text-white'}`}>
                      <p className={`mb-1.5 ${headingText}`}>{a.title}</p>
                      <p className={`whitespace-pre-wrap text-[15px] ${isLight ? 'text-slate-700 leading-7' : 'leading-snug'}`}>{a.body}</p>
                    </div>
                  </div>

                  {a.image_url ? (
                    <div className="mt-3 px-1">
                      <img
                        src={a.image_url}
                        alt=""
                        className="w-full max-h-[480px] object-cover rounded-2xl border border-white/10 bg-black/20"
                      />
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
                    </div>
                  </div>

                  {open && (
                    <div className={`${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#091028] border-white/10'} border-t px-3 py-3 space-y-3`}>
                      {comments.length === 0 ? (
                        <p className={`text-sm ${mutedText} text-center py-2`}>No comments yet.</p>
                      ) : (
                        <ul className="space-y-3">
                          {comments.map((c) => {
                            const p = one(c.profiles)
                            const who = p
                              ? `${p.first_name} ${p.last_name}`
                              : 'Member'
                            return (
                              <li key={c.id} className="flex gap-2 text-sm">
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                  style={{ backgroundColor: '#606770' }}
                                >
                                  {p ? initials(`${p.first_name} ${p.last_name}`) : '?'}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className={`inline-block max-w-full rounded-2xl px-3 py-2 border ${isLight ? 'bg-white border-slate-200' : 'bg-[#131d3d] border-white/10'}`}>
                                    <span className={`font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>{who}</span>
                                    <p className={`mt-0.5 whitespace-pre-wrap ${isLight ? 'text-slate-700' : 'text-[#d4dbf0]'}`}>{c.body}</p>
                                  </div>
                                  <p className={`text-[11px] ${mutedText} mt-0.5 ml-1`}>
                                    {timeAgo(c.created_at)}
                                  </p>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      <div className={`flex gap-2 items-center rounded-full px-3 py-1.5 border ${isLight ? 'bg-white border-slate-200' : 'bg-[#0f1a38] border-white/10'}`}>
                        <input
                          value={commentDraft[a.id] || ''}
                          onChange={(e) =>
                            setCommentDraft((d) => ({ ...d, [a.id]: e.target.value }))
                          }
                          placeholder="Write a comment…"
                          className={`flex-1 min-w-0 bg-transparent text-sm py-2 focus:outline-none ${commentInputText}`}
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

        {/* Right column — lightweight FB-style */}
        <aside className="hidden lg:block w-[300px] shrink-0 sticky top-24 self-start">
          <div className={`rounded-3xl border p-4 shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)] ${panelBg}`}>
            <p className="text-xs font-semibold text-[#7f8bad] uppercase tracking-wide mb-2">
              Tip
            </p>
            <p className={`text-sm ${bodyText} leading-snug`}>
              Tap the <strong className="text-[#0084ff]">chat</strong> bubble to open Chats, pick a
              business, then send text or <strong>photos</strong> like Messenger.
            </p>
          </div>
        </aside>
      </div>

      {/* Messenger-style floating Chats window */}
      {supportOpen && (
        <div
          className="fixed z-50 flex flex-col rounded-2xl shadow-2xl border border-white/15 bg-[#0c1530] overflow-hidden w-[calc(100vw-1rem)] sm:w-[380px] h-[min(85dvh,620px)] max-h-[calc(100dvh-5.5rem)]"
          style={{ bottom: '5.5rem', right: 'max(0.75rem, env(safe-area-inset-right))' }}
        >
          <div
            className="flex items-center gap-2 px-2 py-2.5 text-white shrink-0 min-h-[52px]"
            style={{ background: `linear-gradient(135deg, ${messengerBlue} 0%, ${messengerBlueDark} 100%)` }}
          >
            {supportPanelView === 'chat' && conversation ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSupportPanelView('list')
                    setConversation(null)
                    setMessages([])
                    clearPendingAttachment()
                    setSupportDraft('')
                  }}
                  className="p-2 rounded-full hover:bg-white/15 shrink-0"
                  aria-label="Back to chats"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-full bg-white/25 flex items-center justify-center text-xs font-bold shrink-0 border border-white/30">
                  {initials(
                    businesses.find((b) => b.id === supportBizId)?.name || 'B'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate leading-tight">
                    {businesses.find((b) => b.id === supportBizId)?.name || 'Business'}
                  </div>
                  <div className="text-[11px] text-white/85">Active now · Customer support</div>
                </div>
              </>
            ) : (
              <>
                <MessageCircle className="w-5 h-5 shrink-0 ml-1" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">Chats</div>
                  <div className="text-[11px] text-white/85">Message any business</div>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => toggleSupportPanel()}
              className="p-2 rounded-full hover:bg-white/20 shrink-0 ml-auto"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {supportPanelView === 'list' && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#0f1a38]">
              <div className="flex-1 overflow-y-auto">
                {businesses.length === 0 ? (
                  <p className="p-6 text-center text-sm text-[#7f8bad]">
                    No businesses to message yet.
                  </p>
                ) : (
                  businesses.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={supportLoading}
                      onClick={() => void openThreadForBusiness(b.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 border-b border-white/10 text-left transition-colors disabled:opacity-50"
                    >
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                        style={{ backgroundColor: messengerBlue }}
                      >
                        {initials(b.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[15px] text-white truncate">
                          {b.name}
                        </div>
                        <div className="text-xs text-[#9ba6cb] truncate">@{b.slug}</div>
                      </div>
                      {supportLoading && supportBizId === b.id ? (
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {supportPanelView === 'chat' && conversation && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#0b132c]">
              <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-white mb-3"
                      style={{ backgroundColor: messengerBlue }}
                    >
                      <MessageCircle className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-medium text-white">No messages yet</p>
                    <p className="text-xs text-[#7f8bad] mt-1">
                      Send a message or a photo to start the conversation.
                    </p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === profile.id
                    const showText = Boolean(m.body?.trim()) && m.body !== '📷'
                    return (
                      <div
                        key={m.id}
                        className={clsx(
                          'max-w-[90%] text-sm shadow-sm overflow-hidden',
                          mine
                            ? 'ml-auto rounded-2xl rounded-br-md'
                            : 'mr-auto rounded-2xl rounded-bl-md bg-[#162347] text-white border border-white/10'
                        )}
                        style={mine ? { backgroundColor: messengerBlue, color: 'white' } : undefined}
                      >
                        {m.image_url ? (
                          <a
                            href={m.image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img
                              src={m.image_url}
                              alt=""
                              className={clsx(
                                'max-w-full max-h-52 w-full object-cover block',
                                showText ? 'rounded-t-2xl' : 'rounded-2xl'
                              )}
                            />
                          </a>
                        ) : null}
                        {showText ? (
                          <p
                            className={clsx(
                              'whitespace-pre-wrap px-3 py-2',
                              mine ? 'text-white' : 'text-[#e3e8f8]'
                            )}
                          >
                            {m.body}
                          </p>
                        ) : null}
                        <p
                          className={clsx(
                            'text-[10px] px-3 py-1.5',
                            mine ? 'text-white/75' : 'text-[#9ca8cf]'
                          )}
                        >
                          {timeAgo(m.created_at)}
                        </p>
                      </div>
                    )
                  })
                )}
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
                    className="p-2.5 rounded-full text-[#0084ff] hover:bg-white/10 shrink-0"
                    aria-label="Attach photo"
                  >
                    <ImagePlus className="w-6 h-6" strokeWidth={1.75} />
                  </button>
                  <div className="flex-1 min-w-0 flex items-center gap-2 bg-[#0b132c] rounded-full px-3 py-1 border border-white/10/80">
                    <input
                      value={supportDraft}
                      onChange={(e) => setSupportDraft(e.target.value)}
                      placeholder="Aa"
                      className="flex-1 min-w-0 bg-transparent py-2.5 text-[15px] focus:outline-none placeholder:text-[#7f8bad]"
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
                    style={{ backgroundColor: messengerBlue }}
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
            </div>
          )}
        </div>
      )}

      {/* FAB — Messenger-style */}
      <button
        type="button"
        onClick={() => toggleSupportPanel()}
        className="fixed z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95"
        style={{
          bottom: 'max(1.25rem, env(safe-area-inset-bottom))',
          right: 'max(1.25rem, env(safe-area-inset-right))',
          background: `linear-gradient(135deg, ${messengerBlue} 0%, ${messengerBlueDark} 100%)`,
        }}
        aria-label={supportOpen ? 'Close support chat' : 'Open customer support chat'}
        aria-expanded={supportOpen}
      >
        {!supportOpen ? <span className="absolute inset-0 rounded-full border border-white/40 animate-pulse" /> : null}
        {supportOpen ? (
          <X className="w-7 h-7" />
        ) : (
          <>
            <MessageCircle className="w-7 h-7" strokeWidth={2} />
            {unreadNotifications > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[#213572] text-[10px] font-extrabold leading-[18px] text-center">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            ) : null}
          </>
        )}
      </button>
    </div>
  )
}



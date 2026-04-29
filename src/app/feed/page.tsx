'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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

type ProfileRow = { id: string; role: 'customer' | 'business'; username: string }
type BusinessRow = { id: string; name: string; slug: string }
type BizEmbed = { id: string; name: string; slug: string }
type AnnouncementRow = {
  id: string
  title: string
  body: string
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
        .select('id, role, username')
        .eq('id', session.user.id)
        .single()

      if (pErr || !prof) {
        console.error(pErr)
        router.replace('/signup')
        return
      }

      if ((prof as ProfileRow).role !== 'customer') {
        router.replace('/dashboard')
        return
      }

      if (cancelled) return
      setProfile(prof as ProfileRow)

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

      const { data: msgs, error: mErr } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, created_at, image_url')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true })

      if (mErr) throw mErr
      setMessages((msgs || []) as MessageRow[])
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

  const fbBlue = '#8d63ff'
  const messengerBlue = '#0084ff'

  return (
    <div className="min-h-screen bg-[#050814] pb-28">
      {/* Relay-style top section */}
      <header className="sticky top-0 z-40 bg-[#0b1020]/95 border-b border-white/10 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8d63ff] to-[#5a7ff6] flex items-center justify-center">
                <span className="text-white text-sm font-black tracking-tight">~</span>
              </div>
              <span className="text-white text-2xl font-extrabold tracking-tight">Relay</span>
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
          <div className="max-w-full">
            <h1 className="text-2xl sm:text-[2.1rem] font-extrabold text-white tracking-tight leading-tight flex items-center gap-2">
              <span className="truncate">Good morning, {profile.username}</span>
              <span className="inline-block shrink-0">👋</span>
            </h1>
            <p className="text-[#7f8bad] text-sm sm:text-base mt-1">Here's what's happening</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex justify-center items-start gap-6 px-2 sm:px-4 pt-4">
        {/* Left shortcuts — Facebook-style rail */}
        <aside className="hidden xl:block w-[280px] shrink-0 space-y-1 sticky top-20 self-start">
          <div className="flex items-center gap-3 rounded-lg hover:bg-black/[0.05] px-2 py-2 cursor-default">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
              style={{ backgroundColor: fbBlue }}
            >
              {initials(profile.username)}
            </div>
            <span className="font-medium text-white truncate">{profile.username}</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg hover:bg-black/[0.05] px-2 py-2 text-[#8d63ff]">
            <Home className="w-7 h-7 shrink-0" strokeWidth={2} />
            <span className="font-medium">Home</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg hover:bg-black/[0.05] px-2 py-2 text-gray-700">
            <Users className="w-7 h-7 shrink-0 text-[#8d63ff]" strokeWidth={2} />
            <span className="font-medium">Announcements</span>
          </div>
        </aside>

        {/* Center feed — all announcements */}
        <main className="w-full max-w-[680px] shrink-0 space-y-4 pb-8">
          {announcements.length === 0 ? (
            <div className="bg-white rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.1)] p-10 text-center">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-[#b8c0dc] font-medium">No announcements yet</p>
              <p className="text-[#7f8bad] text-sm mt-1">
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
                  key={a.id}
                  className="bg-white rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.1)] overflow-hidden"
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
                        <div className="font-semibold text-white hover:underline cursor-default truncate">
                          {bizName}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-[#7f8bad]">
                          <span>{timeAgo(a.created_at)}</span>
                          <span>·</span>
                          <Building2 className="w-3 h-3" />
                          {biz?.slug ? <span className="truncate">{biz.slug}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-[15px] text-white">
                      <p className="font-semibold mb-1.5">{a.title}</p>
                      <p className="whitespace-pre-wrap text-[15px] leading-snug">{a.body}</p>
                    </div>
                  </div>

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
                          liked ? 'text-[#8d63ff]' : 'text-[#b8c0dc] hover:bg-white/10'
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
                          'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[15px] font-medium text-[#b8c0dc] hover:bg-white/10',
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
                    <div className="bg-[#050814] border-t border-white/10 px-3 py-3 space-y-3">
                      {comments.length === 0 ? (
                        <p className="text-sm text-[#7f8bad] text-center py-2">No comments yet.</p>
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
                                  <div className="inline-block max-w-full bg-white rounded-2xl px-3 py-2 shadow-sm">
                                    <span className="font-semibold text-white">{who}</span>
                                    <p className="text-gray-800 mt-0.5 whitespace-pre-wrap">{c.body}</p>
                                  </div>
                                  <p className="text-[11px] text-[#7f8bad] mt-0.5 ml-1">
                                    {timeAgo(c.created_at)}
                                  </p>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      <div className="flex gap-2 items-center bg-white rounded-full px-3 py-1.5 shadow-sm border border-white/10">
                        <input
                          value={commentDraft[a.id] || ''}
                          onChange={(e) =>
                            setCommentDraft((d) => ({ ...d, [a.id]: e.target.value }))
                          }
                          placeholder="Write a comment…"
                          className="flex-1 min-w-0 bg-transparent text-sm py-2 focus:outline-none"
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
        <aside className="hidden lg:block w-[300px] shrink-0 sticky top-20 self-start">
          <div className="bg-white rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.1)] p-4">
            <p className="text-xs font-semibold text-[#7f8bad] uppercase tracking-wide mb-2">
              Tip
            </p>
            <p className="text-sm text-[#b8c0dc] leading-snug">
              Tap the <strong className="text-[#0084ff]">chat</strong> bubble to open Chats, pick a
              business, then send text or <strong>photos</strong> like Messenger.
            </p>
          </div>
        </aside>
      </div>

      {/* Messenger-style floating Chats window */}
      {supportOpen && (
        <div
          className="fixed z-50 flex flex-col rounded-xl shadow-2xl border border-white/10/80 bg-white overflow-hidden w-[calc(100vw-1rem)] sm:w-[380px] h-[min(85dvh,620px)] max-h-[calc(100dvh-5.5rem)]"
          style={{ bottom: '5.5rem', right: 'max(0.75rem, env(safe-area-inset-right))' }}
        >
          <div
            className="flex items-center gap-2 px-2 py-2.5 text-white shrink-0 min-h-[52px]"
            style={{ background: `linear-gradient(135deg, ${messengerBlue} 0%, #006edf 100%)` }}
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
            <div className="flex-1 flex flex-col min-h-0 bg-white">
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
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#050814] border-b border-gray-100 text-left transition-colors disabled:opacity-50"
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
                        <div className="text-xs text-[#7f8bad] truncate">@{b.slug}</div>
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
            <div className="flex-1 flex flex-col min-h-0 bg-[#050814]">
              <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-white mb-3"
                      style={{ backgroundColor: messengerBlue }}
                    >
                      <MessageCircle className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-medium text-gray-700">No messages yet</p>
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
                            : 'mr-auto rounded-2xl rounded-bl-md bg-white text-white border border-gray-100'
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
                              mine ? 'text-white' : 'text-white'
                            )}
                          >
                            {m.body}
                          </p>
                        ) : null}
                        <p
                          className={clsx(
                            'text-[10px] px-3 py-1.5',
                            mine ? 'text-white/75' : 'text-gray-400'
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

              <div className="shrink-0 border-t border-white/10 bg-white p-2 space-y-2">
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
                  <div className="flex-1 min-w-0 flex items-center gap-2 bg-[#050814] rounded-full px-3 py-1 border border-white/10/80">
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
          background: `linear-gradient(135deg, ${messengerBlue} 0%, #006edf 100%)`,
        }}
        aria-label={supportOpen ? 'Close support chat' : 'Open customer support chat'}
        aria-expanded={supportOpen}
      >
        {supportOpen ? (
          <X className="w-7 h-7" />
        ) : (
          <MessageCircle className="w-7 h-7" strokeWidth={2} />
        )}
      </button>
    </div>
  )
}



'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RelayLogo from '@/components/RelayLogo'
import {
  ArrowLeft,
  ClipboardList,
  ImagePlus,
  Inbox,
  Loader2,
  LogOut,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Send,
  Shield,
  Ban,
  ThumbsUp,
  UserCheck,
  User2,
  Users,
  X,
} from 'lucide-react'

type AppTab = 'home' | 'post' | 'inbox' | 'users' | 'notify' | 'reports'

type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  business_id: string | null
  business_role: 'admin' | 'support' | null
}

type ConvoListItem = {
  id: string
  customer_id: string
  customerName: string
  customerUsername: string
  preview: string
  updated_at: string
  unreadCount: number
}

type ThreadMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  image_url?: string | null
}

type PendingCustomer = {
  id: string
  first_name: string
  last_name: string
  username: string
  created_at: string
  account_status: string
}

type ActiveMember = {
  id: string
  first_name: string
  last_name: string
  username: string
  account_status: string
}

type ReportItem = {
  id: string
  name: string
  type: string
  status: 'new' | 'in_review' | 'resolved'
  details: string
}

type OwnAnnouncementRow = {
  id: string
  title: string
  body: string
  image_url?: string | null
  created_at: string
}

function extFromImageFile(f: File) {
  if (f.type === 'image/png') return 'png'
  if (f.type === 'image/webp') return 'webp'
  if (f.type === 'image/gif') return 'gif'
  return 'jpg'
}

const NAV_DEF: {
  id: AppTab
  label: string
  adminOnly?: boolean
  icon: ComponentType<{ className?: string }>
}[] = [
  { id: 'home', label: 'Home', icon: Shield },
  { id: 'post', label: 'Post', adminOnly: true, icon: Megaphone },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'notify', label: 'Notify', icon: Send },
  { id: 'reports', label: 'Reports', icon: ClipboardList },
]

function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>('home')

  const [convoList, setConvoList] = useState<ConvoListItem[]>([])
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null)
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)

  const [pendingCustomers, setPendingCustomers] = useState<PendingCustomer[]>([])
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)

  const [reports, setReports] = useState<ReportItem[]>([])

  const [announcementType, setAnnouncementType] = useState<'announcement' | 'alert' | 'update'>('announcement')
  const [audience, setAudience] = useState<'all' | 'selected' | 'one'>('all')
  const [notifyTitle, setNotifyTitle] = useState('')
  const [notifyBody, setNotifyBody] = useState('')
  const [oneUserQuery, setOneUserQuery] = useState('')
  const [notifyBusy, setNotifyBusy] = useState(false)

  const [postTitle, setPostTitle] = useState('')
  const [postBody, setPostBody] = useState('')
  const [postBusy, setPostBusy] = useState(false)
  const [postImage, setPostImage] = useState<{ file: File; previewUrl: string } | null>(null)
  const postFileInputRef = useRef<HTMLInputElement>(null)
  const [myAnnouncements, setMyAnnouncements] = useState<OwnAnnouncementRow[]>([])
  const [myAnnouncementsMeta, setMyAnnouncementsMeta] = useState<
    Record<string, { likes: number; comments: number }>
  >({})
  const [myAnnouncementsLoading, setMyAnnouncementsLoading] = useState(false)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [businessInfo, setBusinessInfo] = useState<{ name: string; slug: string } | null>(null)
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([])
  const [suspendedMembers, setSuspendedMembers] = useState<ActiveMember[]>([])
  const [modBusyId, setModBusyId] = useState<string | null>(null)
  const [dashRefreshing, setDashRefreshing] = useState(false)

  const profileRef = useRef<ProfileRow | null>(null)
  profileRef.current = profile

  const navItems = useMemo(() => {
    if (!profile || profile.business_role !== 'admin') {
      return NAV_DEF.filter((n) => !n.adminOnly)
    }
    return NAV_DEF
  }, [profile])

  const refreshDashboard = useCallback(
    async (p: ProfileRow) => {
      setLoadError(null)
      if (!p.business_id) {
        setLoadError('Staff profile is missing business_id. Fix it in Supabase public.profiles for your admin user.')
        setBusinessInfo(null)
        setConvoList([])
        setPendingCustomers([])
        setActiveMembers([])
        setSuspendedMembers([])
        setReports([])
        return
      }

      const bid = p.business_id

      const { data: bizRow } = await supabase.from('businesses').select('name, slug').eq('id', bid).maybeSingle()
      setBusinessInfo(bizRow ? { name: bizRow.name, slug: bizRow.slug } : null)

      const [convRes, pendingRes, reportRes, convCustRes, followRes] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, customer_id, updated_at')
          .eq('business_id', bid)
          .order('updated_at', { ascending: false })
          .limit(80),
        supabase
          .from('profiles')
          .select('id, first_name, last_name, username, created_at, account_status')
          .eq('role', 'customer')
          .eq('account_status', 'pending')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(80),
        supabase
          .from('admin_reports')
          .select('id, reporter_name, category, status, details, created_at')
          .eq('business_id', bid)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('conversations').select('customer_id').eq('business_id', bid),
        supabase.from('follows').select('user_id').eq('business_id', bid),
      ])

      const errs: string[] = []
      if (convRes.error) errs.push(`conversations: ${convRes.error.message}`)
      if (pendingRes.error) errs.push(`pending: ${pendingRes.error.message}`)
      if (reportRes.error) errs.push(`reports: ${reportRes.error.message}`)
      if (convCustRes.error) errs.push(`members(conv): ${convCustRes.error.message}`)
      if (followRes.error) errs.push(`members(follows): ${followRes.error.message}`)
      if (errs.length) setLoadError(errs.join(' · '))

      const convoRows = convRes.data || []
      setPendingCustomers((pendingRes.data || []) as PendingCustomer[])

      if (Array.isArray(reportRes.data) && reportRes.data.length > 0) {
        setReports(
          reportRes.data.map((r: Record<string, unknown>) => ({
            id: r.id as string,
            name: r.reporter_name as string,
            type: r.category as string,
            status: r.status as ReportItem['status'],
            details: r.details as string,
          }))
        )
      } else {
        setReports([])
      }

      const convIds = convoRows.map((c: { id: string }) => c.id)
      const customerIds = [...new Set(convoRows.map((c: { customer_id: string }) => c.customer_id))]

      const profileById: Record<string, { first_name: string; last_name: string; username: string }> = {}
      if (customerIds.length > 0) {
        const { data: profs, error: pe } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, username')
          .in('id', customerIds)
        if (pe) setLoadError((prev) => (prev ? `${prev} · ` : '') + `profiles: ${pe.message}`)
        for (const row of profs || []) {
          const r = row as { id: string; first_name: string; last_name: string; username: string }
          profileById[r.id] = r
        }
      }

      const previewByConvo: Record<string, { body: string; created_at: string }> = {}
      const unreadByConvo: Record<string, number> = {}
      if (convIds.length > 0) {
        const { data: msgs, error: me } = await supabase
          .from('messages')
          .select('conversation_id, body, created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false })
        if (me) setLoadError((prev) => (prev ? `${prev} · ` : '') + `messages: ${me.message}`)
        for (const m of msgs || []) {
          const row = m as { conversation_id: string; body: string; created_at: string }
          if (!previewByConvo[row.conversation_id]) {
            previewByConvo[row.conversation_id] = { body: row.body, created_at: row.created_at }
          }
        }

        const customerByConvo = Object.fromEntries(
          convoRows.map((r: { id: string; customer_id: string }) => [r.id, r.customer_id])
        ) as Record<string, string>

        const { data: unreadRows, error: ue } = await supabase
          .from('messages')
          .select('conversation_id, sender_id')
          .in('conversation_id', convIds)
          .eq('read', false)
        if (ue) setLoadError((prev) => (prev ? `${prev} · ` : '') + `messages(unread): ${ue.message}`)
        for (const m of unreadRows || []) {
          const row = m as { conversation_id: string; sender_id: string }
          const cust = customerByConvo[row.conversation_id]
          if (cust && row.sender_id === cust) {
            unreadByConvo[row.conversation_id] = (unreadByConvo[row.conversation_id] || 0) + 1
          }
        }
      }

      const list: ConvoListItem[] = convoRows.map((row: { id: string; customer_id: string; updated_at: string }) => {
        const pr = profileById[row.customer_id]
        const name = pr
          ? `${pr.first_name ?? ''} ${pr.last_name ?? ''}`.trim() || pr.username
          : 'Customer'
        const pv = previewByConvo[row.id]
        return {
          id: row.id,
          customer_id: row.customer_id,
          customerName: name,
          customerUsername: pr?.username ?? '…',
          preview: pv?.body || 'No messages yet',
          updated_at: row.updated_at,
          unreadCount: unreadByConvo[row.id] || 0,
        }
      })
      setConvoList(list)

      const memberIds = new Set<string>()
      for (const r of convCustRes.data || []) memberIds.add((r as { customer_id: string }).customer_id)
      for (const r of followRes.data || []) memberIds.add((r as { user_id: string }).user_id)
      const merged = [...memberIds]

      if (merged.length === 0) {
        setActiveMembers([])
        setSuspendedMembers([])
      } else {
        const { data: memberRows, error: me } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, username, account_status')
          .in('id', merged)
          .eq('role', 'customer')
          .in('account_status', ['approved', 'suspended'])
          .is('deleted_at', null)
          .order('username')
        if (me) setLoadError((prev) => (prev ? `${prev} · ` : '') + `members: ${me.message}`)
        const rows = (memberRows || []) as ActiveMember[]
        const approved = rows.filter((r) => r.account_status === 'approved')
        const suspended = rows.filter((r) => r.account_status === 'suspended')
        approved.sort((a, b) => (a.username || '').localeCompare(b.username || ''))
        suspended.sort((a, b) => (a.username || '').localeCompare(b.username || ''))
        setActiveMembers(approved)
        setSuspendedMembers(suspended)
      }
    },
    [supabase]
  )

  const loadMyAnnouncements = useCallback(
    async (businessId: string) => {
      setMyAnnouncementsLoading(true)
      try {
        const { data: ann, error } = await supabase
          .from('announcements')
          .select('id, title, body, image_url, created_at')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .limit(50)

        if (error) throw error
        const list = (ann || []) as OwnAnnouncementRow[]
        setMyAnnouncements(list)
        const ids = list.map((a) => a.id)
        if (ids.length === 0) {
          setMyAnnouncementsMeta({})
          return
        }

        const [{ data: likes }, { data: coms }] = await Promise.all([
          supabase.from('reactions').select('announcement_id').in('announcement_id', ids).eq('reaction', 'like'),
          supabase.from('comments').select('announcement_id').in('announcement_id', ids),
        ])

        const meta: Record<string, { likes: number; comments: number }> = {}
        for (const id of ids) meta[id] = { likes: 0, comments: 0 }
        for (const r of likes || []) {
          const aid = (r as { announcement_id: string }).announcement_id
          if (meta[aid]) meta[aid].likes += 1
        }
        for (const c of coms || []) {
          const aid = (c as { announcement_id: string }).announcement_id
          if (meta[aid]) meta[aid].comments += 1
        }
        setMyAnnouncementsMeta(meta)
      } catch (e) {
        console.error(e)
        setMyAnnouncements([])
        setMyAnnouncementsMeta({})
      } finally {
        setMyAnnouncementsLoading(false)
      }
    },
    [supabase]
  )

  useEffect(() => {
    if (activeTab !== 'post' || profile?.business_role !== 'admin' || !profile.business_id) return
    void loadMyAnnouncements(profile.business_id)
  }, [activeTab, profile?.business_role, profile?.business_id, loadMyAnnouncements])

  useEffect(() => {
    let cancelled = false
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/signup')
        return
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, role, username, business_id, business_role')
        .eq('id', session.user.id)
        .single()

      if (error || !prof) {
        router.replace('/signup')
        return
      }

      const p = prof as ProfileRow
      if (p.role !== 'business') {
        router.replace('/feed')
        return
      }
      if (cancelled) return
      setProfile(p)
      setLoading(false)
      await refreshDashboard(p)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase, refreshDashboard])

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = profileRef.current
      if (p?.business_id) void refreshDashboard(p)
    }, 30_000)
    return () => window.clearInterval(id)
  }, [refreshDashboard])

  useEffect(() => {
    const p = profileRef.current
    if (!p?.business_id) return

    let timer: number | null = null
    const queueRefresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const current = profileRef.current
        if (current?.business_id) void refreshDashboard(current)
      }, 350)
    }

    const channel = supabase
      .channel(`staff-dashboard-${p.business_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${p.business_id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_reports', filter: `business_id=eq.${p.business_id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `business_id=eq.${p.business_id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, queueRefresh)
      .subscribe()

    return () => {
      if (timer) window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, refreshDashboard, profile?.business_id])

  useEffect(() => {
    if (!selectedConvoId) return
    const channel = supabase
      .channel(`staff-thread-${selectedConvoId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConvoId}` },
        () => {
          void openThread(selectedConvoId)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, selectedConvoId])

  async function manualRefresh() {
    const p = profileRef.current
    if (!p?.business_id) return
    setDashRefreshing(true)
    try {
      await refreshDashboard(p)
    } finally {
      setDashRefreshing(false)
    }
  }

  async function moderateSuspension(
    userId: string,
    action: 'suspend' | 'unsuspend',
    displayName: string
  ) {
    if (profileRef.current?.business_role !== 'admin') return
    const msg =
      action === 'suspend'
        ? `Suspend ${displayName}? They will not be able to use the app until a staff member unsuspends them.`
        : `Unsuspend ${displayName} and restore full access?`
    if (!window.confirm(msg)) return
    let reason: string | undefined
    if (action === 'suspend') {
      const note = window.prompt('Optional note for the moderation log (internal):', '')
      if (note === null) return
      reason = note.trim() || undefined
    }
    setModBusyId(userId)
    try {
      const open = convoList.find((c) => c.id === selectedConvoId)
      if (action === 'suspend' && open?.customer_id === userId) {
        setSelectedConvoId(null)
        setThreadMessages([])
      }
      const res = await fetch('/api/staff/moderate-suspension', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId, action, reason }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Request failed')
      const p = profileRef.current
      if (p) await refreshDashboard(p)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setModBusyId(null)
    }
  }

  async function openThread(conversationId: string) {
    setSelectedConvoId(conversationId)
    setThreadLoading(true)
    setReplyDraft('')
    const customerId = convoList.find((c) => c.id === conversationId)?.customer_id
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, body, created_at, image_url')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setThreadMessages((data || []) as ThreadMessage[])

      if (customerId) {
        const { error: readErr } = await supabase
          .from('messages')
          .update({ read: true })
          .eq('conversation_id', conversationId)
          .eq('sender_id', customerId)
          .eq('read', false)
        if (readErr) console.error(readErr)
        setConvoList((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)))
      }
    } catch (e) {
      console.error(e)
      setThreadMessages([])
    } finally {
      setThreadLoading(false)
    }
  }

  async function sendReply() {
    if (!profile || !selectedConvoId) return
    const text = replyDraft.trim()
    if (!text) return
    setReplyBusy(true)
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConvoId,
          sender_id: profile.id,
          body: text,
        })
        .select('id, sender_id, body, created_at, image_url')
        .single()
      if (error) throw error
      setThreadMessages((prev) => [...prev, data as ThreadMessage])
      setReplyDraft('')
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', selectedConvoId)
      await refreshDashboard(profileRef.current!)
    } catch (e) {
      console.error(e)
      alert('Could not send message. Check you are still signed in and RLS allows staff replies.')
    } finally {
      setReplyBusy(false)
    }
  }

  async function reviewCustomer(userId: string, decision: 'approve' | 'reject' | 'block') {
    setReviewBusyId(userId)
    try {
      const res = await fetch('/api/staff/review-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId, decision }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Request failed')
      await refreshDashboard(profileRef.current!)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update account')
    } finally {
      setReviewBusyId(null)
    }
  }

  function onPostImagePick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return
    if (f.size > 5 * 1024 * 1024) {
      alert('Please choose an image under 5 MB.')
      return
    }
    setPostImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return { file: f, previewUrl: URL.createObjectURL(f) }
    })
  }

  function clearPostImage() {
    setPostImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
  }

  async function publishAnnouncement() {
    if (!profile?.business_id || profile.business_role !== 'admin') return
    const rawTitle = postTitle.trim()
    const rawBody = postBody.trim()
    if (!rawBody && !postImage) return
    const title = rawTitle || (rawBody ? rawBody.slice(0, 60) : 'Photo update')
    const body = rawBody || 'Shared a photo.'
    setPostBusy(true)
    let notified = 0
    try {
      let imageUrl: string | null = null
      if (postImage) {
        const ext = extFromImageFile(postImage.file)
        const path = `${profile.id}/announcements/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('message-images')
          .upload(path, postImage.file, {
            contentType: postImage.file.type || 'image/jpeg',
            upsert: false,
          })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('message-images').getPublicUrl(path)
        imageUrl = pub.publicUrl
      }

      const { data: inserted, error: insErr } = await supabase
        .from('announcements')
        .insert({
          business_id: profile.business_id,
          author_id: profile.id,
          title,
          body,
          image_url: imageUrl,
          pinned: false,
        })
        .select('id')
        .single()

      if (insErr) throw insErr
      const announcementId = (inserted as { id: string }).id

      const { data: customers, error: custErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'customer')
        .eq('account_status', 'approved')
        .is('deleted_at', null)

      let notificationsOk = true
      if (custErr) {
        console.error(custErr)
        notificationsOk = false
      } else {
        notified = (customers || []).length
        const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body
        const rows = (customers || []).map((row: { id: string }) => ({
          user_id: row.id,
          business_id: profile.business_id,
          type: 'announcement',
          title: `New post: ${title}`,
          body: preview,
          link: `/feed?post=${announcementId}`,
        }))
        const chunk = 150
        for (let i = 0; i < rows.length; i += chunk) {
          const { error: nErr } = await supabase.from('notifications').insert(rows.slice(i, i + chunk))
          if (nErr) {
            console.error(nErr)
            notificationsOk = false
            break
          }
        }
      }

      setPostTitle('')
      setPostBody('')
      clearPostImage()
      await loadMyAnnouncements(profile.business_id)

      if (!notificationsOk) {
        alert(
          'Announcement published on the feed. In-app notifications could not all be sent — check the console or Supabase notifications policies.'
        )
      } else if (notified > 0) {
        alert(`Announcement posted. ${notified} approved customer(s) were notified in-app.`)
      } else {
        alert('Announcement posted. No approved customers to notify yet.')
      }
    } catch (e) {
      console.error(e)
      alert(
        e instanceof Error
          ? e.message
          : 'Could not post (admin only). For photos, apply storage migration 002_message_images_storage.sql if uploads fail.'
      )
    } finally {
      setPostBusy(false)
    }
  }

  async function sendMemberNotifications() {
    if (!profile?.business_id) return
    const title = notifyTitle.trim()
    const body = notifyBody.trim()
    if (!title || !body) return

    if (audience === 'selected') {
      alert('Selected users is not wired yet. Choose All or One user.')
      return
    }

    setNotifyBusy(true)
    try {
      const recipientIds = new Set<string>()

      if (audience === 'all') {
        const { data: convos } = await supabase.from('conversations').select('customer_id').eq('business_id', profile.business_id)
        for (const c of convos || []) recipientIds.add((c as { customer_id: string }).customer_id)
        const { data: follows } = await supabase.from('follows').select('user_id').eq('business_id', profile.business_id)
        for (const f of follows || []) recipientIds.add((f as { user_id: string }).user_id)
      } else {
        const raw = oneUserQuery.trim()
        if (!raw) {
          alert('Enter a username or user UUID for One user.')
          setNotifyBusy(false)
          return
        }
        if (/^[0-9a-f-]{36}$/i.test(raw)) {
          recipientIds.add(raw)
        } else {
          const { data: u, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', raw)
            .eq('role', 'customer')
            .maybeSingle()
          if (error || !u) {
            alert('No customer found with that username.')
            setNotifyBusy(false)
            return
          }
          recipientIds.add((u as { id: string }).id)
        }
      }

      if (recipientIds.size === 0) {
        alert('No recipients yet. Customers appear after they message you or follow your business.')
        setNotifyBusy(false)
        return
      }

      const rows = [...recipientIds].map((user_id) => ({
        user_id,
        business_id: profile.business_id,
        type: announcementType,
        title,
        body,
        link: '/feed',
      }))

      const { error } = await supabase.from('notifications').insert(rows)
      if (error) throw error
      setNotifyTitle('')
      setNotifyBody('')
      setOneUserQuery('')
      alert(`Sent ${rows.length} notification(s).`)
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not send notifications.')
    } finally {
      setNotifyBusy(false)
    }
  }

  async function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return
    await supabase.auth.signOut()
    router.replace('/signup')
  }

  const metrics = useMemo(() => {
    const pending = pendingCustomers.filter((c) => c.account_status === 'pending').length
    const openThreads = convoList.length
    const reportCount = reports.length
    const members = activeMembers.length
    return { pending, unread: openThreads, reportCount, members }
  }, [pendingCustomers, convoList, reports, activeMembers])

  const inboxUnreadTotal = useMemo(
    () => convoList.reduce((sum, c) => sum + c.unreadCount, 0),
    [convoList]
  )

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const isAdmin = profile.business_role === 'admin'
  const mobileGridClass = navItems.length > 5 ? 'grid-cols-6' : 'grid-cols-5'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1a2250_0%,_#070a18_44%,_#050814_100%)] text-white lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden lg:flex flex-col border-r border-white/10 bg-[#0a1024]/90 backdrop-blur-xl p-6 gap-5">
        <div className="px-2 py-1">
          <p className="text-xs uppercase tracking-[0.18em] text-[#7d86a8]">Staff Portal</p>
          <div className="mt-2">
            <RelayLogo size="sm" />
          </div>
          <h1 className="text-xl font-bold mt-2">Admin Dashboard</h1>
          <p className="text-sm text-[#7d86a8] mt-1">@{profile.username}</p>
        </div>
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeTab
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id)
                  if (item.id !== 'inbox') setSelectedConvoId(null)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                  active
                    ? 'bg-[#1a2347] border-[#7b65ff]/80 text-white shadow-[0_10px_35px_-20px_rgba(123,101,255,0.9)]'
                    : 'bg-[#101937] border-white/10 text-[#8f9ac0] hover:text-white hover:bg-[#141d3d]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === 'inbox' && inboxUnreadTotal > 0 ? (
                  <span className="shrink-0 min-w-[1.35rem] h-6 px-1.5 rounded-full bg-[#8d63ff] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                    {inboxUnreadTotal > 99 ? '99+' : inboxUnreadTotal}
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-auto flex items-center gap-2 text-[#aeb7d6] hover:text-white px-2 py-2"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </aside>

      <main className="max-w-7xl w-full mx-auto p-4 sm:p-7 pb-24 lg:pb-8">
        <header className="mb-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-3xl border border-white/10 bg-[#0b132b]/85 backdrop-blur-xl px-5 py-5 sm:px-6">
            <div className="space-y-1">
              <h2 className="text-3xl font-bold">Dashboard</h2>
              <p className="text-[#7d86a8] text-sm">
                Relay Admin — {profile.business_role === 'admin' ? 'Admin' : 'Support Staff'}
              </p>
              {businessInfo ? (
                <p className="text-[#9ea8cc] text-sm mt-1">
                  Business: <span className="text-white font-medium">{businessInfo.name}</span>
                  {businessInfo.slug ? (
                    <span className="text-[#7d86a8]">
                      {' '}
                      · slug <code className="text-[#aeb7d6]">{businessInfo.slug}</code>
                    </span>
                  ) : null}
                </p>
              ) : profile.business_id ? (
                <p className="text-amber-200/90 text-sm mt-1">Could not load business record — check businesses table for this business_id.</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void manualRefresh()}
                disabled={dashRefreshing || !profile.business_id}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#121d3a] px-3.5 py-2 text-sm text-[#aeb7d6] hover:text-white disabled:opacity-40"
              >
                <RefreshCw className={`w-4 h-4 ${dashRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          {loadError ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              <strong className="font-semibold">Data load issue:</strong> {loadError}
              <p className="text-red-200/80 text-xs mt-1">
                For <code className="text-red-100">suspended</code> status or moderation log errors, run{' '}
                <code className="text-red-100">005_account_suspend_moderation.sql</code> in the Supabase SQL editor. Other column errors
                may need earlier migrations.
              </p>
            </div>
          ) : null}
        </header>

        {activeTab === 'home' ? (
          <section className="space-y-4">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <StatCard icon={<User2 className="w-4 h-4" />} label="Pending" value={metrics.pending} accent="yellow" />
              <StatCard icon={<Inbox className="w-4 h-4" />} label="Threads" value={metrics.unread} accent="purple" />
              <StatCard icon={<ClipboardList className="w-4 h-4" />} label="Reports" value={metrics.reportCount} accent="red" />
              <StatCard icon={<Users className="w-4 h-4" />} label="Active members" value={metrics.members} accent="green" />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <QuickButton icon={<User2 className="w-4 h-4" />} label="Review Queue" onClick={() => setActiveTab('users')} />
              <QuickButton
                icon={<Inbox className="w-4 h-4" />}
                label="Open Inbox"
                badgeCount={inboxUnreadTotal}
                onClick={() => setActiveTab('inbox')}
              />
              {isAdmin ? (
                <QuickButton icon={<Megaphone className="w-4 h-4" />} label="Post" onClick={() => setActiveTab('post')} />
              ) : (
                <QuickButton icon={<Send className="w-4 h-4" />} label="Send Notify" onClick={() => setActiveTab('notify')} />
              )}
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#0d1428]/90 backdrop-blur overflow-hidden shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
              <div className="px-4 py-3 border-b border-white/10">
                <h3 className="text-sm font-semibold tracking-wide text-[#9ea8cc]">RECENT CONVERSATIONS</h3>
              </div>
              <div className="divide-y divide-white/10">
                {convoList.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-[#7d86a8]">No customer threads yet.</p>
                ) : (
                  convoList.slice(0, 4).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setActiveTab('inbox')
                        void openThread(item.id)
                      }}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-xl bg-[#171f3e] flex items-center justify-center shrink-0 relative">
                        <MessageCircle className="w-4 h-4 text-[#8d63ff]" />
                        {item.unreadCount > 0 ? (
                          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#ff3b5c] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                            {item.unreadCount > 99 ? '99+' : item.unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{item.customerName}</p>
                        <p className="text-sm text-[#7984a8] truncate">{item.preview}</p>
                        <p className="text-xs text-[#5c647e] mt-0.5">{timeAgo(item.updated_at)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'post' && isAdmin ? (
          <section className="space-y-8 max-w-[700px]">
            <div>
              <h3 className="text-2xl font-bold">Post announcement</h3>
              <p className="text-[#7d86a8] text-sm mt-1">
                Goes to the public feed for all approved customers. They can like and comment. Approved customers get an in-app notification when you
                publish.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#0d1428]/90 p-5 space-y-4 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
              <input type="file" ref={postFileInputRef} accept="image/*" className="hidden" onChange={onPostImagePick} />
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#8d63ff] to-[#5a7ff6] flex items-center justify-center">
                  <User2 className="w-5 h-5 text-white" />
                </div>
                <input
                  className="flex-1 bg-[#111a31] border border-white/10 rounded-full px-4 py-3 text-sm outline-none focus:border-[#6f54ff] text-[#dce3f9] placeholder:text-[#8b97bf]"
                  placeholder="What's on your mind?"
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                />
              </div>
              <textarea
                className="w-full bg-[#111a31] border border-white/10 rounded-2xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff] min-h-24"
                placeholder="Add more details (optional)"
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
              />
              {postImage ? (
                <div className="relative rounded-xl overflow-hidden border border-white/10 max-h-56">
                  <img src={postImage.previewUrl} alt="" className="w-full h-full object-cover max-h-56" />
                  <button
                    type="button"
                    onClick={clearPostImage}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Remove image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : null}
              <div className="rounded-2xl border border-white/10 bg-[#111a31] px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => postFileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-[#aeb7d6] hover:text-white hover:bg-white/5 transition-colors"
                >
                  <ImagePlus className="w-4 h-4 text-[#8d63ff]" />
                  Photo
                </button>
              </div>
              <button
                type="button"
                disabled={postBusy || (!postBody.trim() && !postImage)}
                onClick={() => void publishAnnouncement()}
                className="w-full rounded-xl py-3 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
              >
                {postBusy ? 'Publishing…' : 'Publish to feed & notify customers'}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h4 className="text-lg font-semibold text-white">Your posts</h4>
                {myAnnouncementsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#8d63ff]" />
                ) : (
                  <span className="text-xs text-[#7d86a8]">{myAnnouncements.length} shown</span>
                )}
              </div>
              {myAnnouncements.length === 0 && !myAnnouncementsLoading ? (
                <p className="text-sm text-[#7d86a8] rounded-2xl border border-white/10 bg-[#0d1428]/60 px-4 py-6 text-center">
                  No announcements yet. Publish above — they will stack here like a timeline.
                </p>
              ) : (
                <ul className="space-y-4">
                  {myAnnouncements.map((a) => {
                    const meta = myAnnouncementsMeta[a.id] || { likes: 0, comments: 0 }
                    return (
                      <li
                        key={a.id}
                        className="rounded-3xl border border-white/10 bg-[#0d1428]/90 overflow-hidden shadow-[0_16px_40px_-28px_rgba(30,49,112,0.95)]"
                      >
                        <div className="p-4">
                          <div className="flex items-center justify-between gap-2 text-xs text-[#7d86a8] mb-2">
                            <span>{timeAgo(a.created_at)}</span>
                            <span className="text-[#5c647e] font-mono text-[10px] truncate max-w-[40%]" title={a.id}>
                              {a.id.slice(0, 8)}…
                            </span>
                          </div>
                          <p className="font-semibold text-white">{a.title}</p>
                          <p className="text-sm text-[#c4cbe6] mt-1 whitespace-pre-wrap line-clamp-6">{a.body}</p>
                        </div>
                        {a.image_url ? (
                          <div className="px-4 pb-3">
                            <img
                              src={a.image_url}
                              alt=""
                              className="w-full max-h-52 object-cover rounded-xl border border-white/10"
                            />
                          </div>
                        ) : null}
                        <div className="flex items-center gap-4 px-4 py-3 border-t border-white/10 text-sm text-[#9ea8cc]">
                          <span className="inline-flex items-center gap-1.5">
                            <ThumbsUp className="w-4 h-4 text-[#8d63ff]" />
                            {meta.likes} likes
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <MessageCircle className="w-4 h-4 text-[#8d63ff]" />
                            {meta.comments} comments
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === 'inbox' ? (
          <section className="space-y-3">
            {selectedConvoId ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedConvoId(null)
                    setThreadMessages([])
                  }}
                  className="inline-flex items-center gap-2 text-sm text-[#9ea8cc] hover:text-white"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to threads
                </button>
                <div className="rounded-3xl border border-white/10 bg-[#0d1428]/90 min-h-[280px] max-h-[50vh] overflow-y-auto p-3.5 space-y-2 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                  {threadLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-[#8d63ff]" />
                    </div>
                  ) : threadMessages.length === 0 ? (
                    <p className="text-sm text-[#7d86a8] py-6 text-center">No messages yet. Say hello below.</p>
                  ) : (
                    threadMessages.map((m) => {
                      const mine = m.sender_id === profile.id
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                              mine ? 'bg-[#6f54ff] text-white' : 'bg-[#151d39] text-[#e2e6f5]'
                            }`}
                          >
                            {m.image_url ? (
                              <img src={m.image_url} alt="" className="rounded-lg max-h-40 mb-1 w-full object-cover" />
                            ) : null}
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-[#7d86a8]'}`}>
                              {timeAgo(m.created_at)}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-[#111a31] border border-white/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff]"
                    placeholder="Reply…"
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void sendReply()
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={replyBusy || !replyDraft.trim()}
                    onClick={() => void sendReply()}
                    className="rounded-xl px-4 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <h3 className="text-2xl font-bold">Inbox</h3>
                    {inboxUnreadTotal > 0 ? (
                      <span className="text-xs font-semibold text-[#b8a6ff] bg-[#8d63ff]/20 border border-[#8d63ff]/35 rounded-full px-2.5 py-0.5 tabular-nums">
                        {inboxUnreadTotal} new
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-[#7d86a8]">{convoList.length} threads</span>
                </div>
                {convoList.length === 0 ? (
                  loadError ? (
                    <p className="text-sm text-red-300/90 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                      Threads could not load — see the error banner above. Staff must have{' '}
                      <code className="text-red-200">profiles.business_id</code> matching conversations for your Vatican business.
                    </p>
                  ) : (
                    <p className="text-sm text-[#7d86a8]">
                      When approved customers message your business from the feed, threads show here. Open Support on an announcement to start a
                      conversation.
                    </p>
                  )
                ) : (
                  convoList.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => void openThread(item.id)}
                      className="w-full rounded-2xl border border-[#4f43aa]/40 bg-[#0e1528]/90 px-4 py-3 flex gap-3 items-center text-left hover:border-[#6f54ff]/50 transition-all hover:-translate-y-0.5"
                    >
                      <div className="w-12 h-12 rounded-full bg-[#6f54ff] flex items-center justify-center font-bold shrink-0 relative">
                        {item.customerName.slice(0, 2).toUpperCase()}
                        {item.unreadCount > 0 ? (
                          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b5c] text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0e1528] tabular-nums">
                            {item.unreadCount > 99 ? '99+' : item.unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold truncate">{item.customerName}</p>
                          <p className="text-xs text-[#7d86a8] shrink-0">{timeAgo(item.updated_at)}</p>
                        </div>
                        <p className="text-[#7d86a8] text-sm truncate">@{item.customerUsername}</p>
                        <p className="text-[#aeb7d6] text-sm truncate mt-0.5">{item.preview}</p>
                      </div>
                    </button>
                  ))
                )}
              </>
            )}
          </section>
        ) : null}

        {activeTab === 'users' ? (
          <section className="space-y-6">
            <div>
              <h3 className="text-2xl font-bold">Users</h3>
              <p className="text-[#7d86a8] text-sm mt-1">
                Approve new signups and manage active members for your business. Pending customers cannot use the app until approved.
              </p>
            </div>
            {!isAdmin ? (
              <p className="text-amber-200/90 text-sm rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                Support accounts cannot approve accounts or suspend members. Ask a business admin.
              </p>
            ) : null}

            <div className="space-y-2">
              <h4 className="text-sm font-semibold tracking-wide text-[#9ea8cc] uppercase">Pending approval</h4>
              <div className="rounded-3xl border border-white/10 bg-[#0d1428]/90 p-3 sm:p-4 space-y-3 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                {pendingCustomers.length === 0 ? (
                  <p className="text-sm text-[#7d86a8] py-4 text-center">No pending signups.</p>
                ) : (
                  pendingCustomers.map((cust) => (
                    <article key={cust.id} className="rounded-2xl border border-white/10 bg-[#121d3a] p-3.5 space-y-3">
                      <div>
                        <p className="font-semibold">
                          {`${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim() || cust.username}
                        </p>
                        <p className="text-[#7d86a8] text-sm">
                          @{cust.username} · joined {timeAgo(cust.created_at)}
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={!isAdmin || reviewBusyId === cust.id}
                          onClick={() => void reviewCustomer(cust.id, 'approve')}
                          className="rounded-xl py-2 font-semibold bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-40"
                        >
                          {reviewBusyId === cust.id ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={!isAdmin || reviewBusyId === cust.id}
                          onClick={() => void reviewCustomer(cust.id, 'reject')}
                          className="rounded-xl py-2 font-semibold bg-red-500/90 hover:bg-red-500 disabled:opacity-40"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={!isAdmin || reviewBusyId === cust.id}
                          onClick={() => void reviewCustomer(cust.id, 'block')}
                          className="rounded-xl py-2 font-semibold bg-white/10 hover:bg-white/15 disabled:opacity-40"
                        >
                          Block
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold tracking-wide text-[#9ea8cc] uppercase">Active members</h4>
              <p className="text-[#7d86a8] text-xs">
                Customers approved for the platform who follow your business or have a support thread with you.
              </p>
              <div className="rounded-3xl border border-white/10 bg-[#0d1428]/90 divide-y divide-white/10 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                {activeMembers.length === 0 ? (
                  <p className="text-sm text-[#7d86a8] py-6 px-4 text-center">
                    No active members linked to this business yet — approve customers and have them follow or message you.
                  </p>
                ) : (
                  activeMembers.map((m) => {
                    const label = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.username
                    return (
                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{label}</p>
                          <p className="text-sm text-[#7d86a8] truncate">@{m.username}</p>
                        </div>
                        {isAdmin ? (
                          <button
                            type="button"
                            disabled={modBusyId === m.id}
                            onClick={() => void moderateSuspension(m.id, 'suspend', label)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
                          >
                            <Ban className="w-4 h-4 shrink-0" />
                            {modBusyId === m.id ? '…' : 'Suspend'}
                          </button>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold tracking-wide text-[#9ea8cc] uppercase">Suspended</h4>
              <p className="text-[#7d86a8] text-xs">These customers cannot use the app until you unsuspend them. Actions are recorded in the moderation log.</p>
              <div className="rounded-3xl border border-amber-500/20 bg-[#0d1428]/90 divide-y divide-white/10 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                {suspendedMembers.length === 0 ? (
                  <p className="text-sm text-[#7d86a8] py-6 px-4 text-center">No suspended members for this business.</p>
                ) : (
                  suspendedMembers.map((m) => {
                    const label = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.username
                    return (
                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{label}</p>
                          <p className="text-sm text-[#7d86a8] truncate">@{m.username}</p>
                        </div>
                        {isAdmin ? (
                          <button
                            type="button"
                            disabled={modBusyId === m.id}
                            onClick={() => void moderateSuspension(m.id, 'unsuspend', label)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            <UserCheck className="w-4 h-4 shrink-0" />
                            {modBusyId === m.id ? '…' : 'Unsuspend'}
                          </button>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'notify' ? (
          <section className="space-y-4">
            <h3 className="text-2xl font-bold">Send notification</h3>
            <p className="text-[#7d86a8] text-sm">
              <strong>All</strong>: customers who have a support thread or follow your business. <strong>One user</strong>:
              username or UUID.
            </p>
            <div className="rounded-3xl border border-white/10 bg-[#0d1428]/90 p-5 space-y-4 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
              <div className="grid grid-cols-3 gap-2">
                {(['announcement', 'alert', 'update'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnnouncementType(opt)}
                    className={`rounded-xl py-3 border capitalize ${
                      announcementType === opt
                        ? 'border-[#6f54ff] bg-[#211a47] text-white'
                        : 'border-white/10 bg-[#111a31] text-[#7d86a8]'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden bg-[#111a31]">
                <AudienceRow label="All (thread + followers)" selected={audience === 'all'} onClick={() => setAudience('all')} />
                <AudienceRow label="Selected users" selected={audience === 'selected'} onClick={() => setAudience('selected')} />
                <AudienceRow label="One user" selected={audience === 'one'} onClick={() => setAudience('one')} />
              </div>
              {audience === 'one' ? (
                <input
                  className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff]"
                  placeholder="Username or user UUID"
                  value={oneUserQuery}
                  onChange={(e) => setOneUserQuery(e.target.value)}
                />
              ) : null}
              <input
                className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff]"
                placeholder="Title"
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
              />
              <textarea
                className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff] min-h-28"
                placeholder="Message"
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
              />
              <button
                type="button"
                disabled={notifyBusy || !notifyTitle.trim() || !notifyBody.trim()}
                onClick={() => void sendMemberNotifications()}
                className="w-full rounded-xl py-3 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
              >
                {notifyBusy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === 'reports' ? (
          <section className="space-y-4">
            <h3 className="text-2xl font-bold">Reports</h3>
            {reports.length === 0 ? (
              <p className="text-sm text-[#7d86a8]">No reports for this business.</p>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <article key={report.id} className="rounded-2xl border border-white/10 bg-[#0e1528]/90 p-4 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{report.name}</p>
                      <StatusPill status={report.status} />
                    </div>
                    <p className="text-sm text-[#73a9ff] mt-2">{report.type}</p>
                    <p className="text-[#7d86a8] mt-1">{report.details}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>

      <nav
        className={`fixed bottom-0 left-0 right-0 lg:hidden border-t border-white/10 bg-[#0a0f1f]/95 backdrop-blur px-1 py-2 grid ${mobileGridClass}`}
      >
        {navItems.map((item) => {
          const Icon = item.icon
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id)
                if (item.id !== 'inbox') setSelectedConvoId(null)
              }}
              className={`flex flex-col items-center gap-0.5 py-1 rounded-xl min-w-0 relative ${
                active ? 'text-[#9e88ff] bg-[#1d1a3c]' : 'text-[#7480a6]'
              }`}
            >
              <span className="relative inline-flex">
                <Icon className="w-4 h-4 shrink-0" />
                {item.id === 'inbox' && inboxUnreadTotal > 0 ? (
                  <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-[#8d63ff] text-white text-[9px] font-bold flex items-center justify-center leading-none tabular-nums border border-[#0a0f1f]">
                    {inboxUnreadTotal > 9 ? '9+' : inboxUnreadTotal}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] leading-tight text-center truncate w-full px-0.5">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent: 'yellow' | 'purple' | 'red' | 'green'
}) {
  const dotClass =
    accent === 'yellow'
      ? 'bg-amber-400'
      : accent === 'purple'
        ? 'bg-violet-400'
        : accent === 'red'
          ? 'bg-red-400'
          : 'bg-emerald-400'
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1428] p-4">
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg bg-[#182243] flex items-center justify-center text-[#9f8bff]">{icon}</div>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      </div>
      <p className="text-4xl font-bold mt-4">{value}</p>
      <p className="text-[#7d86a8]">{label}</p>
    </div>
  )
}

function QuickButton({
  icon,
  label,
  badgeCount,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  badgeCount?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/10 bg-[#0d1428] px-4 py-3 flex items-center justify-center gap-2 text-[#9ea8cc] hover:text-white relative"
    >
      {typeof badgeCount === 'number' && badgeCount > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#8d63ff] text-white text-[10px] font-bold flex items-center justify-center tabular-nums border-2 border-[#0d1428]">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      ) : null}
      {icon}
      {label}
    </button>
  )
}

function AudienceRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full px-4 py-3 flex items-center justify-between">
      <span className="text-left text-sm">{label}</span>
      <span className={`w-5 h-5 rounded-full border shrink-0 ${selected ? 'border-[#7e66ff] bg-[#7e66ff]' : 'border-white/20'}`} />
    </button>
  )
}

function StatusPill({ status }: { status: ReportItem['status'] }) {
  if (status === 'new') return <span className="px-2 py-1 rounded-full text-xs bg-sky-500/20 text-sky-300">New</span>
  if (status === 'in_review')
    return <span className="px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-300">In Review</span>
  return <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-300">Resolved</span>
}

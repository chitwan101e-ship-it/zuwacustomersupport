'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentType, CSSProperties, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markConversationNotificationsRead } from '@/lib/markConversationNotificationsRead'
import { downscaleImageFileToJpeg } from '@/lib/downscaleImageFile'
import RelayLogo from '@/components/RelayLogo'
import { RelayChatBubbleIcon } from '@/components/RelayChatBubbleIcon'
import {
  ArrowLeft,
  Bell,
  Camera,
  Check,
  ClipboardList,
  ImagePlus,
  Inbox,
  Loader2,
  LogOut,
  Megaphone,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Shield,
  Tag,
  BookMarked,
  Ban,
  Eye,
  Pencil,
  EyeOff,
  Trash2,
  ThumbsUp,
  UserCheck,
  User2,
  Users,
  UserCog,
  X,
} from 'lucide-react'
import { ContentModerationMenu } from '@/components/ContentModerationMenu'

type AppTab = 'home' | 'post' | 'inbox' | 'users' | 'notify' | 'reports' | 'team'
type UsersPanelTab = 'pending' | 'active' | 'suspended'

type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  avatar_url?: string | null
  business_id: string | null
  business_role: 'admin' | 'support' | null
}

type InboxLabelRow = {
  id: string
  name: string
  color: string | null
  is_system: boolean
}

type CannedReplyRow = {
  id: string
  title: string
  body: string
  sort_order: number
}

type ConvoListItem = {
  id: string
  customer_id: string
  customerName: string
  customerUsername: string
  customerAvatar?: string | null
  preview: string
  updated_at: string
  unreadCount: number
  labels: InboxLabelRow[]
}

type ThreadMessageSenderEmbed = {
  username: string
  first_name: string
  last_name: string
  business_role: 'admin' | 'support' | null
}

type ThreadMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  image_url?: string | null
  read?: boolean | null
  read_at?: string | null
  profiles?: ThreadMessageSenderEmbed | ThreadMessageSenderEmbed[] | null
}

const THREAD_MESSAGE_SELECT =
  'id, sender_id, body, created_at, image_url, read, read_at, profiles ( username, first_name, last_name, business_role )'

function oneEmbed<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function formatTeamSenderLine(embed: ThreadMessageSenderEmbed | null): string | null {
  if (!embed) return null
  const name = [embed.first_name, embed.last_name].filter(Boolean).join(' ').trim() || `@${embed.username}`
  const role =
    embed.business_role === 'admin' ? 'Admin' : embed.business_role === 'support' ? 'Support' : null
  const handle = `@${embed.username}`
  return role ? `${name} · ${handle} · ${role}` : `${name} · ${handle}`
}

type PendingCustomer = {
  id: string
  first_name: string
  last_name: string
  username: string
  phone: string | null
  referral_username: string | null
  created_at: string
  account_status: string
  email: string | null
  email_verified: boolean
}

type ActiveMember = {
  id: string
  first_name: string
  last_name: string
  username: string
  account_status: string
  avatar_url?: string | null
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
  hidden_at?: string | null
}

type BasicProfile = {
  id: string
  username: string
  first_name: string | null
  last_name: string | null
  avatar_url?: string | null
}

type CommentPreview = {
  id: string
  body: string
  created_at: string
  userName: string
  userAvatar: string | null
}

type EngagementComment = {
  id: string
  user_id: string
  parent_comment_id: string | null
  body: string
  created_at: string
  hidden_at?: string | null
  userName: string
  userAvatar: string | null
}

function formatModerationError(e: unknown, action: string): string {
  const err = e as { message?: string; code?: string; details?: string }
  if (err?.code === '42703') {
    return `${action} failed: moderation columns are missing. Run migration 018 in Supabase SQL.`
  }
  if (err?.code === '42501' || err?.message?.toLowerCase().includes('permission')) {
    return `${action} failed: permission denied (RLS). Run migration 019_fix_moderation_rls_select.sql in Supabase SQL, then refresh and retry.`
  }
  if (err?.message) return `${action} failed: ${err.message}`
  return `${action} failed. Try again.`
}

function engagementCommentsByParent(list: EngagementComment[]) {
  const m = new Map<string | null, EngagementComment[]>()
  for (const c of list) {
    const k = c.parent_comment_id
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(c)
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
  }
  return m
}

function extFromImageFile(f: File) {
  if (f.type === 'image/png') return 'png'
  if (f.type === 'image/webp') return 'webp'
  if (f.type === 'image/gif') return 'gif'
  return 'jpg'
}

type SupabaseBrowserClient = ReturnType<typeof createClient>

/** Prefer DB RPC (migration 010); fall back to PATCH if RPC is not deployed yet. */
async function markCustomerMessagesReadForStaff(
  supabase: SupabaseBrowserClient,
  conversationId: string,
  customerId: string
): Promise<{ errorMessage: string | null }> {
  const { error: rpcErr } = await supabase.rpc('mark_customer_messages_read_for_staff', {
    p_conversation_id: conversationId,
  })
  if (!rpcErr) return { errorMessage: null }

  const msg = rpcErr.message || ''
  const missingRpc =
    rpcErr.code === 'PGRST202' ||
    rpcErr.code === '42883' ||
    /does not exist|schema cache|Could not find the function/i.test(msg)

  if (!missingRpc) return { errorMessage: msg }

  const now = new Date().toISOString()
  const base = () =>
    supabase
      .from('messages')
      .update({ read: true, read_at: now })
      .eq('conversation_id', conversationId)
      .eq('sender_id', customerId)
  const { error: e1 } = await base().eq('read', false)
  if (e1) return { errorMessage: e1.message }
  const { error: e2 } = await base().is('read', null)
  if (e2)   return { errorMessage: e2.message }
  return { errorMessage: null }
}

function InboxTabIcon({ className }: { className?: string }) {
  return <RelayChatBubbleIcon className={className} size={16} strokeWidth={2} />
}

const NAV_DEF: {
  id: AppTab
  label: string
  adminOnly?: boolean
  icon: ComponentType<{ className?: string }>
}[] = [
  { id: 'home', label: 'Home', icon: Shield },
  { id: 'post', label: 'Post', icon: Megaphone },
  { id: 'inbox', label: 'Inbox', icon: InboxTabIcon },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'notify', label: 'Notify', icon: Send },
  { id: 'reports', label: 'Reports', icon: ClipboardList },
  { id: 'team', label: 'Team', adminOnly: true, icon: UserCog },
]

function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

function inboxLabelChipStyle(color: string | null): CSSProperties {
  const c = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#64748b'
  return {
    borderColor: `${c}99`,
    color: c,
    backgroundColor: `${c}18`,
  }
}

/** Placeholders: {customer_name}, {username}, {business} */
function expandCannedReplyBody(
  template: string,
  ctx: { customerName: string; customerUsername: string; businessName: string }
) {
  return template
    .replaceAll('{customer_name}', ctx.customerName)
    .replaceAll('{username}', ctx.customerUsername)
    .replaceAll('{business}', ctx.businessName)
}

function mergeCannedIntoDraft(draft: string, chunk: string) {
  const c = chunk.trim()
  if (!c) return draft
  const d = draft.trimEnd()
  if (!d) return c
  return `${d}\n\n${c}`
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>('home')
  const activeTabRef = useRef<AppTab>('home')
  activeTabRef.current = activeTab

  const [convoList, setConvoList] = useState<ConvoListItem[]>([])
  const convoListRef = useRef<ConvoListItem[]>([])
  convoListRef.current = convoList
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null)
  const selectedConvoIdRef = useRef<string | null>(null)
  selectedConvoIdRef.current = selectedConvoId
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyPendingImage, setReplyPendingImage] = useState<{ blob: Blob; previewUrl: string } | null>(null)

  const [pendingCustomers, setPendingCustomers] = useState<PendingCustomer[]>([])
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)

  const [reports, setReports] = useState<ReportItem[]>([])

  const [announcementType, setAnnouncementType] = useState<'announcement' | 'alert' | 'update'>('announcement')
  const [audience, setAudience] = useState<'all' | 'selected' | 'one' | 'labels'>('all')
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([])
  const [notifyAudienceLabelIds, setNotifyAudienceLabelIds] = useState<string[]>([])
  const [notifyRecipientQuery, setNotifyRecipientQuery] = useState('')
  const [inboxThreadLabelFilterIds, setInboxThreadLabelFilterIds] = useState<string[]>([])
  const [notifyTitle, setNotifyTitle] = useState('')
  const [notifyBody, setNotifyBody] = useState('')
  const [oneUserQuery, setOneUserQuery] = useState('')
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [reportBusyId, setReportBusyId] = useState<string | null>(null)

  const [postTitle, setPostTitle] = useState('')
  const [postBody, setPostBody] = useState('')
  const [postBusy, setPostBusy] = useState(false)
  const [postImage, setPostImage] = useState<{ file: File; previewUrl: string } | null>(null)
  const postFileInputRef = useRef<HTMLInputElement>(null)
  const replyImageInputRef = useRef<HTMLInputElement>(null)
  const threadScrollRef = useRef<HTMLDivElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const staffThreadChannelRef = useRef<ReturnType<(typeof supabase)['channel']> | null>(null)
  const staffThreadBroadcastReadyRef = useRef(false)
  const staffTypingSentRef = useRef(false)
  const staffTypingIdleTimerRef = useRef<number | null>(null)
  const peerCustomerTypingClearTimerRef = useRef<number | null>(null)
  const [peerCustomerTyping, setPeerCustomerTyping] = useState(false)
  const [staffTypingChannelReady, setStaffTypingChannelReady] = useState(0)
  const [myAnnouncements, setMyAnnouncements] = useState<OwnAnnouncementRow[]>([])
  const [myAnnouncementsMeta, setMyAnnouncementsMeta] = useState<
    Record<
      string,
      {
        likes: number
        comments: number
        likedBy: { name: string; avatar: string | null }[]
        commentedBy: string[]
        commentPreviews: CommentPreview[]
        commentDetails: EngagementComment[]
      }
    >
  >({})
  const [myAnnouncementsLoading, setMyAnnouncementsLoading] = useState(false)
  const [engagementOpen, setEngagementOpen] = useState<{ postId: string; mode: 'likes' | 'comments' } | null>(null)
  const [staffCommentReplyDrafts, setStaffCommentReplyDrafts] = useState<Record<string, string>>({})
  const [staffReplyBusyPostId, setStaffReplyBusyPostId] = useState<string | null>(null)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [editPostTitle, setEditPostTitle] = useState('')
  const [editPostBody, setEditPostBody] = useState('')
  const [editPostBusy, setEditPostBusy] = useState(false)
  const [postModerationBusyId, setPostModerationBusyId] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentBody, setEditCommentBody] = useState('')
  const [commentModerationBusyId, setCommentModerationBusyId] = useState<string | null>(null)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [businessInfo, setBusinessInfo] = useState<{ name: string; slug: string } | null>(null)
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([])
  const [suspendedMembers, setSuspendedMembers] = useState<ActiveMember[]>([])
  const [usersPanelTab, setUsersPanelTab] = useState<UsersPanelTab>('pending')
  const [modBusyId, setModBusyId] = useState<string | null>(null)
  const [memberMessageDrafts, setMemberMessageDrafts] = useState<Record<string, string>>({})
  const [memberSendBusyId, setMemberSendBusyId] = useState<string | null>(null)
  const [dashRefreshing, setDashRefreshing] = useState(false)
  const [inboxContactOpen, setInboxContactOpen] = useState(false)
  const [staffNotifyUnread, setStaffNotifyUnread] = useState(0)
  const [inboxRefreshing, setInboxRefreshing] = useState(false)
  const [inboxLabelCatalog, setInboxLabelCatalog] = useState<InboxLabelRow[]>([])
  const [inboxLabelsPopoverOpen, setInboxLabelsPopoverOpen] = useState(false)
  const inboxLabelsPopoverRef = useRef<HTMLDivElement>(null)
  const [inboxLabelRowBusy, setInboxLabelRowBusy] = useState<string | null>(null)
  const [newInboxLabelName, setNewInboxLabelName] = useState('')
  const [inboxLabelCreateBusy, setInboxLabelCreateBusy] = useState(false)
  const [inboxSearchQuery, setInboxSearchQuery] = useState('')
  const [cannedReplies, setCannedReplies] = useState<CannedReplyRow[]>([])
  const [cannedPopoverOpen, setCannedPopoverOpen] = useState(false)
  const cannedPopoverRef = useRef<HTMLDivElement>(null)
  const [cannedPickerQuery, setCannedPickerQuery] = useState('')
  const [cannedEditId, setCannedEditId] = useState<string | null>(null)
  const [cannedFormTitle, setCannedFormTitle] = useState('')
  const [cannedFormBody, setCannedFormBody] = useState('')
  const [cannedSaveBusy, setCannedSaveBusy] = useState(false)
  const [cannedDeleteBusyId, setCannedDeleteBusyId] = useState<string | null>(null)
  const [staffAvatarBusy, setStaffAvatarBusy] = useState(false)
  const staffAvatarInputRef = useRef<HTMLInputElement>(null)

  const [teamRows, setTeamRows] = useState<
    { id: string; username: string; first_name: string; last_name: string; business_role: 'admin' | 'support'; deleted_at: string | null }[]
  >([])
  const [teamLoadBusy, setTeamLoadBusy] = useState(false)
  const [newStaffFirst, setNewStaffFirst] = useState('')
  const [newStaffEmail, setNewStaffEmail] = useState('')
  const [newStaffUsername, setNewStaffUsername] = useState('')
  const [newStaffPassword, setNewStaffPassword] = useState('')
  const [newStaffPasswordConfirm, setNewStaffPasswordConfirm] = useState('')
  const [showNewStaffPassword, setShowNewStaffPassword] = useState(false)
  const [createStaffBusy, setCreateStaffBusy] = useState(false)
  const [removeStaffBusyId, setRemoveStaffBusyId] = useState<string | null>(null)

  const profileRef = useRef<ProfileRow | null>(null)
  profileRef.current = profile

  const scrollThreadToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const end = threadEndRef.current
    if (end) {
      end.scrollIntoView({ block: 'end', behavior })
      return
    }
    const el = threadScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const navItems = useMemo(() => {
    if (!profile || profile.business_role !== 'admin') {
      return NAV_DEF.filter((n) => !n.adminOnly)
    }
    return NAV_DEF
  }, [profile])

  const loadTeam = useCallback(async () => {
    const bid = profileRef.current?.business_id
    if (!bid || profileRef.current?.business_role !== 'admin') return
    setTeamLoadBusy(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, first_name, last_name, business_role, deleted_at')
        .eq('business_id', bid)
        .eq('role', 'business')
        .order('business_role', { ascending: true })
        .order('username', { ascending: true })
      if (error) throw error
      setTeamRows(
        (data || []) as {
          id: string
          username: string
          first_name: string
          last_name: string
          business_role: 'admin' | 'support'
          deleted_at: string | null
        }[]
      )
    } catch (e) {
      console.error(e)
    } finally {
      setTeamLoadBusy(false)
    }
  }, [supabase])

  const refreshDashboard = useCallback(
    async (p: ProfileRow) => {
      setLoadError(null)
      if (!p.business_id) {
        setLoadError('Staff profile is missing business_id. Fix it in Supabase public.profiles for your admin user.')
        setBusinessInfo(null)
        setConvoList([])
        setInboxLabelCatalog([])
        setCannedReplies([])
        setPendingCustomers([])
        setActiveMembers([])
        setSuspendedMembers([])
        setReports([])
        return
      }

      const bid = p.business_id

      const { data: bizRow } = await supabase.from('businesses').select('name, slug').eq('id', bid).maybeSingle()
      setBusinessInfo(bizRow ? { name: bizRow.name, slug: bizRow.slug } : null)

      const pendingFetch: Promise<{ pending?: PendingCustomer[]; error?: string }> = fetch(
        '/api/staff/pending-signups',
        { method: 'GET', cache: 'no-store' }
      )
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { pending?: PendingCustomer[]; error?: string }
          if (!r.ok) return { error: j.error || `HTTP ${r.status}` }
          return { pending: j.pending ?? [] }
        })
        .catch((e: unknown) => {
          const raw = e instanceof Error ? e.message : 'Network error'
          const isOffline =
            e instanceof TypeError &&
            (raw === 'Failed to fetch' || raw === 'Load failed' || raw === 'NetworkError when attempting to fetch resource.')
          return {
            error: isOffline
              ? 'Could not reach the app server for pending signups (often: dev server stopped, tab offline, or request blocked). Try Refresh after confirming npm run dev is running.'
              : raw,
          }
        })

      const [convRes, pendingRes, reportRes, convCustRes, followRes, cannedRes] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, customer_id, updated_at')
          .eq('business_id', bid)
          .order('updated_at', { ascending: false })
          .limit(80),
        pendingFetch,
        supabase
          .from('admin_reports')
          .select('id, reporter_name, category, status, details, created_at')
          .eq('business_id', bid)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('conversations').select('customer_id').eq('business_id', bid),
        supabase.from('follows').select('user_id').eq('business_id', bid),
        supabase
          .from('inbox_canned_replies')
          .select('id, title, body, sort_order')
          .eq('business_id', bid)
          .order('sort_order', { ascending: true })
          .order('title', { ascending: true }),
      ])

      const errs: string[] = []
      if (convRes.error) errs.push(`conversations: ${convRes.error.message}`)
      if (pendingRes.error) errs.push(`pending: ${pendingRes.error}`)
      if (reportRes.error) errs.push(`reports: ${reportRes.error.message}`)
      if (convCustRes.error) errs.push(`members(conv): ${convCustRes.error.message}`)
      if (followRes.error) errs.push(`members(follows): ${followRes.error.message}`)
      if (cannedRes.error) errs.push(`canned replies: ${cannedRes.error.message}`)
      if (errs.length) setLoadError(errs.join(' · '))

      if (!cannedRes.error) {
        setCannedReplies(
          (cannedRes.data || []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            title: r.title as string,
            body: r.body as string,
            sort_order: Number(r.sort_order ?? 0),
          }))
        )
      } else {
        setCannedReplies([])
      }

      const convoRows = convRes.data || []
      setPendingCustomers((pendingRes.pending || []) as PendingCustomer[])

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

      const activeThreadId = selectedConvoIdRef.current
      const inboxActive = activeTabRef.current === 'inbox'
      if (inboxActive && activeThreadId && convIds.includes(activeThreadId)) {
        const { data: activeConvo, error: activeErr } = await supabase
          .from('conversations')
          .select('customer_id')
          .eq('id', activeThreadId)
          .maybeSingle()
        if (!activeErr && activeConvo?.customer_id) {
          const { errorMessage: markErr } = await markCustomerMessagesReadForStaff(
            supabase,
            activeThreadId,
            activeConvo.customer_id as string
          )
          if (markErr)
            setLoadError((prev) => (prev ? `${prev} · ` : '') + `messages(mark read): ${markErr}`)
          const { errorMessage: nMarkErr } = await markConversationNotificationsRead(supabase, p.id, activeThreadId)
          if (nMarkErr)
            setLoadError((prev) => (prev ? `${prev} · ` : '') + `notifications(mark read): ${nMarkErr}`)
        }
      }

      const profileById: Record<string, { first_name: string; last_name: string; username: string; avatar_url?: string | null }> = {}
      if (customerIds.length > 0) {
        const { data: profs, error: pe } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, username, avatar_url')
          .in('id', customerIds)
        if (pe) setLoadError((prev) => (prev ? `${prev} · ` : '') + `profiles: ${pe.message}`)
        for (const row of profs || []) {
          const r = row as { id: string; first_name: string; last_name: string; username: string; avatar_url?: string | null }
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
          .select('conversation_id, sender_id, read')
          .in('conversation_id', convIds)
        if (ue) setLoadError((prev) => (prev ? `${prev} · ` : '') + `messages(unread): ${ue.message}`)
        for (const m of unreadRows || []) {
          const row = m as { conversation_id: string; sender_id: string; read: boolean | null }
          if (row.read === true) continue
          const cust = customerByConvo[row.conversation_id]
          if (cust && row.sender_id === cust) {
            unreadByConvo[row.conversation_id] = (unreadByConvo[row.conversation_id] || 0) + 1
          }
        }
      }

      const { data: defRows, error: defErr } = await supabase
        .from('inbox_label_definitions')
        .select('id, name, color, is_system')
        .eq('business_id', bid)
        .order('is_system', { ascending: false })
        .order('name')
      if (defErr)
        setLoadError((prev) => (prev ? `${prev} · ` : '') + `inbox_label_definitions: ${defErr.message}`)
      const labelCatalog: InboxLabelRow[] = (defRows || []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        name: r.name as string,
        color: (r.color as string | null) ?? null,
        is_system: Boolean(r.is_system),
      }))
      setInboxLabelCatalog(labelCatalog)
      const defById = Object.fromEntries(labelCatalog.map((d) => [d.id, d])) as Record<string, InboxLabelRow>
      const labelsByConvo: Record<string, InboxLabelRow[]> = {}
      if (convIds.length > 0 && !defErr) {
        const { data: assignRows, error: assignErr } = await supabase
          .from('conversation_inbox_labels')
          .select('conversation_id, label_id')
          .in('conversation_id', convIds)
        if (assignErr)
          setLoadError((prev) => (prev ? `${prev} · ` : '') + `conversation_inbox_labels: ${assignErr.message}`)
        else {
          for (const row of assignRows || []) {
            const r = row as { conversation_id: string; label_id: string }
            const d = defById[r.label_id]
            if (!d) continue
            if (!labelsByConvo[r.conversation_id]) labelsByConvo[r.conversation_id] = []
            labelsByConvo[r.conversation_id].push(d)
          }
          for (const cid of Object.keys(labelsByConvo)) {
            labelsByConvo[cid].sort((a, b) => {
              if (a.is_system !== b.is_system) return a.is_system ? -1 : 1
              return a.name.localeCompare(b.name)
            })
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
          customerAvatar: pr?.avatar_url ?? null,
          preview: pv?.body || 'No messages yet',
          updated_at: row.updated_at,
          unreadCount: unreadByConvo[row.id] || 0,
          labels: labelsByConvo[row.id] || [],
        }
      })
      setConvoList(list)

      {
        const { count: bellCount, error: bellErr } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', p.id)
          .eq('read', false)
        if (!bellErr) setStaffNotifyUnread(bellCount ?? 0)
      }

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
          .select('id, first_name, last_name, username, account_status, avatar_url')
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
          .select('id, title, body, image_url, created_at, hidden_at')
          .eq('business_id', businessId)
          .is('deleted_at', null)
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
          supabase.from('reactions').select('announcement_id, user_id').in('announcement_id', ids).eq('reaction', 'like'),
          supabase
            .from('comments')
            .select('id, announcement_id, user_id, parent_comment_id, body, created_at, hidden_at')
            .in('announcement_id', ids)
            .is('deleted_at', null),
        ])

        const userIds = new Set<string>()
        for (const r of likes || []) userIds.add((r as { user_id: string }).user_id)
        for (const c of coms || []) userIds.add((c as { user_id: string }).user_id)

        let profileMap = new Map<string, BasicProfile>()
        if (userIds.size > 0) {
          const { data: rows } = await supabase
            .from('profiles')
            .select('id, username, first_name, last_name, avatar_url')
            .in('id', [...userIds])
          profileMap = new Map((rows || []).map((row) => [row.id, row as BasicProfile]))
        }

        const displayNameFor = (userId: string) => {
          const p = profileMap.get(userId)
          if (!p) return 'Member'
          const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
          return full || `@${p.username}`
        }

        const meta: Record<
          string,
          {
            likes: number
            comments: number
            likedBy: { name: string; avatar: string | null }[]
            commentedBy: string[]
            commentPreviews: CommentPreview[]
            commentDetails: EngagementComment[]
          }
        > = {}
        for (const id of ids) meta[id] = { likes: 0, comments: 0, likedBy: [], commentedBy: [], commentPreviews: [], commentDetails: [] }
        for (const r of likes || []) {
          const row = r as { announcement_id: string; user_id: string }
          const aid = row.announcement_id
          if (meta[aid]) {
            meta[aid].likes += 1
            const name = displayNameFor(row.user_id)
            const avatar = profileMap.get(row.user_id)?.avatar_url ?? null
            if (!meta[aid].likedBy.some((x) => x.name === name)) meta[aid].likedBy.push({ name, avatar })
          }
        }
        for (const c of coms || []) {
          const row = c as {
            id: string
            announcement_id: string
            user_id: string
            parent_comment_id: string | null
            body: string
            created_at: string
          }
          const aid = row.announcement_id
          if (meta[aid]) {
            meta[aid].comments += 1
            const name = displayNameFor(row.user_id)
            if (!meta[aid].commentedBy.includes(name)) meta[aid].commentedBy.push(name)
            meta[aid].commentPreviews.push({
              id: row.id,
              body: row.body,
              created_at: row.created_at,
              userName: name,
              userAvatar: profileMap.get(row.user_id)?.avatar_url ?? null,
            })
            meta[aid].commentDetails.push({
              id: row.id,
              user_id: row.user_id,
              parent_comment_id: row.parent_comment_id ?? null,
              body: row.body,
              created_at: row.created_at,
              hidden_at: (row as { hidden_at?: string | null }).hidden_at ?? null,
              userName: name,
              userAvatar: profileMap.get(row.user_id)?.avatar_url ?? null,
            })
          }
        }
        for (const id of ids) {
          meta[id].commentPreviews.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
          meta[id].commentPreviews = meta[id].commentPreviews.slice(0, 3)
          meta[id].commentDetails.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
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

  function beginEditPost(a: OwnAnnouncementRow) {
    setEditingPostId(a.id)
    setEditPostTitle(a.title)
    setEditPostBody(a.body)
  }

  async function saveEditPost() {
    const p = profileRef.current
    if (!p?.business_id || !editingPostId) return
    const title = editPostTitle.trim()
    const body = editPostBody.trim()
    if (!title || !body) return
    setEditPostBusy(true)
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ title, body })
        .eq('id', editingPostId)
        .eq('business_id', p.business_id)
      if (error) throw error
      setEditingPostId(null)
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(formatModerationError(e, 'Save post'))
    } finally {
      setEditPostBusy(false)
    }
  }

  async function togglePostHidden(postId: string, currentlyHidden: boolean) {
    const p = profileRef.current
    if (!p?.business_id) return
    setPostModerationBusyId(postId)
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ hidden_at: currentlyHidden ? null : new Date().toISOString() })
        .eq('id', postId)
        .eq('business_id', p.business_id)
      if (error) throw error
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(formatModerationError(e, 'Update post visibility'))
    } finally {
      setPostModerationBusyId(null)
    }
  }

  async function deletePost(postId: string) {
    const p = profileRef.current
    if (!p?.business_id) return
    if (!window.confirm('Delete this post? Customers will no longer see it.')) return
    setPostModerationBusyId(postId)
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', postId)
        .eq('business_id', p.business_id)
      if (error) throw error
      if (editingPostId === postId) setEditingPostId(null)
      if (engagementOpen?.postId === postId) setEngagementOpen(null)
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(formatModerationError(e, 'Delete post'))
    } finally {
      setPostModerationBusyId(null)
    }
  }

  function beginEditComment(c: EngagementComment) {
    setEditingCommentId(c.id)
    setEditCommentBody(c.body)
  }

  async function saveEditComment() {
    const p = profileRef.current
    if (!p?.business_id || !editingCommentId) return
    const body = editCommentBody.trim()
    if (!body) return
    setCommentModerationBusyId(editingCommentId)
    try {
      const { error } = await supabase.from('comments').update({ body }).eq('id', editingCommentId)
      if (error) throw error
      setEditingCommentId(null)
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(formatModerationError(e, 'Save comment'))
    } finally {
      setCommentModerationBusyId(null)
    }
  }

  async function toggleCommentHidden(commentId: string, currentlyHidden: boolean) {
    const p = profileRef.current
    if (!p?.business_id) return
    setCommentModerationBusyId(commentId)
    try {
      const { error } = await supabase
        .from('comments')
        .update({ hidden_at: currentlyHidden ? null : new Date().toISOString() })
        .eq('id', commentId)
      if (error) throw error
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(formatModerationError(e, 'Update comment visibility'))
    } finally {
      setCommentModerationBusyId(null)
    }
  }

  async function deleteComment(commentId: string) {
    const p = profileRef.current
    if (!p?.business_id) return
    if (!window.confirm('Delete this comment?')) return
    setCommentModerationBusyId(commentId)
    try {
      const { error } = await supabase
        .from('comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', commentId)
      if (error) throw error
      if (editingCommentId === commentId) setEditingCommentId(null)
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(formatModerationError(e, 'Delete comment'))
    } finally {
      setCommentModerationBusyId(null)
    }
  }

  async function submitStaffCommentReply(postId: string, parentCommentId: string) {
    const p = profileRef.current
    if (!p?.business_id) return
    const key = `${postId}::${parentCommentId}`
    const text = (staffCommentReplyDrafts[key] || '').trim()
    if (!text) return
    setStaffReplyBusyPostId(postId)
    try {
      const { error } = await supabase.from('comments').insert({
        announcement_id: postId,
        user_id: p.id,
        body: text,
        parent_comment_id: parentCommentId,
      })
      if (error) throw error
      setStaffCommentReplyDrafts((d) => ({ ...d, [key]: '' }))
      await loadMyAnnouncements(p.business_id)
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not post reply. Run migration 008_comments_threading.sql if replies fail.')
    } finally {
      setStaffReplyBusyPostId(null)
    }
  }

  useEffect(() => {
    if (activeTab !== 'post' || !profile?.business_id) return
    void loadMyAnnouncements(profile.business_id)
  }, [activeTab, profile?.business_id, loadMyAnnouncements])

  useEffect(() => {
    let cancelled = false
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, role, username, avatar_url, business_id, business_role, deleted_at, account_status')
        .eq('id', user.id)
        .single()

      if (error || !prof) {
        router.replace('/login')
        return
      }

      const p = prof as ProfileRow & { deleted_at?: string | null; account_status?: string }
      if (p.deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }
      if (p.account_status && p.account_status !== 'approved') {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }

      const pRow: ProfileRow = {
        id: p.id,
        role: p.role,
        username: p.username,
        avatar_url: p.avatar_url,
        business_id: p.business_id,
        business_role: p.business_role,
      }
      if (pRow.role !== 'business') {
        router.replace('/feed')
        return
      }
      if (cancelled) return
      setProfile(pRow)
      setLoading(false)
      await refreshDashboard(pRow)
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
    setInboxContactOpen(false)
  }, [selectedConvoId])

  useEffect(() => {
    if (!inboxLabelsPopoverOpen) return
    function onDoc(e: MouseEvent) {
      const el = inboxLabelsPopoverRef.current
      if (el && !el.contains(e.target as Node)) setInboxLabelsPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [inboxLabelsPopoverOpen])

  useEffect(() => {
    if (!cannedPopoverOpen) return
    function onDoc(e: MouseEvent) {
      const el = cannedPopoverRef.current
      if (el && !el.contains(e.target as Node)) setCannedPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [cannedPopoverOpen])

  useEffect(() => {
    if (!selectedConvoId || threadLoading) return
    const raf = window.requestAnimationFrame(() => scrollThreadToLatest('auto'))
    return () => window.cancelAnimationFrame(raf)
  }, [selectedConvoId, threadLoading, threadMessages.length, scrollThreadToLatest])

  useEffect(() => {
    const p = profileRef.current
    if (!p?.business_id) return

    let timer: number | null = null
    const queueRefresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const current = profileRef.current
        if (current?.business_id) void refreshDashboard(current)
      }, 100)
    }

    const channel = supabase
      .channel(`staff-dashboard-${p.business_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${p.business_id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_reports', filter: `business_id=eq.${p.business_id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `business_id=eq.${p.business_id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_inbox_labels' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_label_definitions' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_canned_replies' }, queueRefresh)
      .subscribe()

    return () => {
      if (timer) window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, refreshDashboard, profile?.business_id])

  useEffect(() => {
    if (!selectedConvoId || !profile?.id) return
    const cid = selectedConvoId
    const myId = profile.id
    let stopped = false
    staffThreadBroadcastReadyRef.current = false
    staffThreadChannelRef.current = null

    const channel = supabase
      .channel(`staff-thread-${cid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` },
        () => {
          void openThread(cid)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` },
        () => {
          void openThread(cid)
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { userId?: string; typing?: boolean }
        if (!p?.userId || p.userId === myId) return
        if (peerCustomerTypingClearTimerRef.current) {
          window.clearTimeout(peerCustomerTypingClearTimerRef.current)
          peerCustomerTypingClearTimerRef.current = null
        }
        if (p.typing) {
          setPeerCustomerTyping(true)
          peerCustomerTypingClearTimerRef.current = window.setTimeout(() => {
            setPeerCustomerTyping(false)
            peerCustomerTypingClearTimerRef.current = null
          }, 3500)
        } else {
          setPeerCustomerTyping(false)
        }
      })
      .subscribe((status) => {
        if (stopped) return
        staffThreadBroadcastReadyRef.current = status === 'SUBSCRIBED'
        if (status === 'SUBSCRIBED') setStaffTypingChannelReady((n) => n + 1)
      })

    staffThreadChannelRef.current = channel

    return () => {
      stopped = true
      staffThreadBroadcastReadyRef.current = false
      staffThreadChannelRef.current = null
      if (staffTypingIdleTimerRef.current) {
        window.clearTimeout(staffTypingIdleTimerRef.current)
        staffTypingIdleTimerRef.current = null
      }
      if (staffTypingSentRef.current) {
        void channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: myId, typing: false },
        })
        staffTypingSentRef.current = false
      }
      if (peerCustomerTypingClearTimerRef.current) {
        window.clearTimeout(peerCustomerTypingClearTimerRef.current)
        peerCustomerTypingClearTimerRef.current = null
      }
      setPeerCustomerTyping(false)
      void supabase.removeChannel(channel)
    }
  }, [supabase, selectedConvoId, profile?.id])

  useEffect(() => {
    if (!selectedConvoId || !profile?.id) return
    const hasComposerContent = Boolean(replyDraft.trim()) || Boolean(replyPendingImage)
    const ch = staffThreadChannelRef.current
    const myId = profile.id

    const sendStop = () => {
      if (staffTypingIdleTimerRef.current) {
        window.clearTimeout(staffTypingIdleTimerRef.current)
        staffTypingIdleTimerRef.current = null
      }
      if (!staffTypingSentRef.current) return
      if (staffThreadBroadcastReadyRef.current && ch) {
        void ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: false } })
      }
      staffTypingSentRef.current = false
    }

    if (!hasComposerContent) {
      sendStop()
      return
    }

    if (staffThreadBroadcastReadyRef.current && ch) {
      if (!staffTypingSentRef.current) {
        void ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: true } })
        staffTypingSentRef.current = true
      }
    }

    if (staffTypingIdleTimerRef.current) window.clearTimeout(staffTypingIdleTimerRef.current)
    staffTypingIdleTimerRef.current = window.setTimeout(() => {
      staffTypingIdleTimerRef.current = null
      sendStop()
    }, 2000)

    return () => {
      if (staffTypingIdleTimerRef.current) {
        window.clearTimeout(staffTypingIdleTimerRef.current)
        staffTypingIdleTimerRef.current = null
      }
    }
  }, [replyDraft, replyPendingImage, selectedConvoId, profile?.id, staffTypingChannelReady])

  useEffect(() => {
    const uid = profile?.id
    if (!uid) return

    async function bumpBell() {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('read', false)
      setStaffNotifyUnread(count ?? 0)
    }

    const channel = supabase
      .channel(`staff-notifications-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        () => void bumpBell()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, profile?.id])

  useEffect(() => {
    if (activeTab !== 'team' || profileRef.current?.business_role !== 'admin') return
    void loadTeam()
  }, [activeTab, loadTeam])

  /** Support must not stay on Team (nav hidden); avoids blank or stale state if URL/bookmark forced the tab. */
  useEffect(() => {
    if (!profile) return
    if (profile.business_role !== 'admin' && activeTab === 'team') {
      setActiveTab('home')
    }
  }, [profile, activeTab])

  async function manualRefresh() {
    const p = profileRef.current
    if (!p?.business_id) return
    setDashRefreshing(true)
    try {
      await refreshDashboard(p)
      if (p.business_role === 'admin' && activeTabRef.current === 'team') await loadTeam()
    } finally {
      setDashRefreshing(false)
    }
  }

  async function createSupportStaff() {
    if (profileRef.current?.business_role !== 'admin') return
    const firstName = newStaffFirst.trim()
    const staffEmail = newStaffEmail.trim().toLowerCase()
    const staffUsername = newStaffUsername.trim().replace(/^@+/, '')
    const pw = newStaffPassword
    const pw2 = newStaffPasswordConfirm
    if (!firstName || !staffEmail || !staffUsername || !pw || !pw2) {
      alert('Fill in first name, work email, username, password, and confirm password.')
      return
    }
    if (pw !== pw2) {
      alert('Password and confirm password must match.')
      return
    }
    if (pw.length < 8) {
      alert('Password must be at least 8 characters.')
      return
    }
    setCreateStaffBusy(true)
    let createdOk = false
    let errMsg: string | null = null
    try {
      const r = await fetch('/api/staff/create-support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          email: staffEmail,
          username: staffUsername,
          password: pw,
          confirmPassword: pw2,
        }),
        signal: AbortSignal.timeout(150_000),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setNewStaffFirst('')
      setNewStaffEmail('')
      setNewStaffUsername('')
      setNewStaffPassword('')
      setNewStaffPasswordConfirm('')
      setShowNewStaffPassword(false)
      void loadTeam()
      createdOk = true
    } catch (e) {
      const aborted =
        e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      errMsg = aborted
        ? 'Request timed out. Check your connection and try again.'
        : e instanceof Error
          ? e.message
          : 'Could not create staff.'
    } finally {
      // Must run before alert(): alert blocks the main thread, so clearing busy in a finally after
      // alert() kept the button spinning until the dialog was dismissed (easy to miss if pop-ups are blocked).
      setCreateStaffBusy(false)
    }
    if (errMsg) alert(errMsg)
    else if (createdOk) {
      alert(
        'Support staff added. They sign in at the same page as you: work email + password. Customers see their name and @username in chat.'
      )
    }
  }

  async function removeSupportMember(targetUserId: string, display: string) {
    if (profileRef.current?.business_role !== 'admin') return
    if (!window.confirm(`Remove ${display} from your team? They will no longer be able to sign in.`)) return
    setRemoveStaffBusyId(targetUserId)
    try {
      const r = await fetch('/api/staff/remove-support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      void loadTeam()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not remove staff.')
    } finally {
      setRemoveStaffBusyId(null)
    }
  }

  async function moderateSuspension(
    userId: string,
    action: 'suspend' | 'unsuspend',
    displayName: string
  ) {
    const role = profileRef.current?.business_role
    if (role !== 'admin' && role !== 'support') return
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

  function clearReplyPendingImage() {
    setReplyPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
  }

  async function applyInboxLabelOnThread(labelId: string, assign: boolean, defOverride?: InboxLabelRow) {
    const convId = selectedConvoIdRef.current
    if (!convId) return
    const def = defOverride ?? inboxLabelCatalog.find((d) => d.id === labelId)
    if (assign && !def) return
    setInboxLabelRowBusy(labelId)
    try {
      if (assign) {
        const { error } = await supabase.from('conversation_inbox_labels').insert({
          conversation_id: convId,
          label_id: labelId,
        })
        if (error) throw error
        setConvoList((prev) =>
          prev.map((c) => {
            if (c.id !== convId || !def) return c
            if (c.labels.some((l) => l.id === labelId)) return c
            const next = [...c.labels, def].sort((a, b) => {
              if (a.is_system !== b.is_system) return a.is_system ? -1 : 1
              return a.name.localeCompare(b.name)
            })
            return { ...c, labels: next }
          })
        )
      } else {
        const { error } = await supabase
          .from('conversation_inbox_labels')
          .delete()
          .eq('conversation_id', convId)
          .eq('label_id', labelId)
        if (error) throw error
        setConvoList((prev) =>
          prev.map((c) => (c.id !== convId ? c : { ...c, labels: c.labels.filter((l) => l.id !== labelId) }))
        )
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update label')
      const cur = profileRef.current
      if (cur?.business_id) void refreshDashboard(cur)
    } finally {
      setInboxLabelRowBusy(null)
    }
  }

  async function createInboxLabelFromDraft() {
    const p = profileRef.current
    const name = newInboxLabelName.trim()
    if (!p?.business_id || !name) return
    setInboxLabelCreateBusy(true)
    try {
      const { data, error } = await supabase
        .from('inbox_label_definitions')
        .insert({
          business_id: p.business_id,
          name,
          color: '#94a3b8',
          is_system: false,
        })
        .select('id, name, color, is_system')
        .single()
      if (error) throw error
      const row = data as { id: string; name: string; color: string | null; is_system: boolean }
      const added: InboxLabelRow = {
        id: row.id,
        name: row.name,
        color: row.color,
        is_system: row.is_system,
      }
      setInboxLabelCatalog((prev) =>
        [...prev, added].sort((a, b) => {
          if (a.is_system !== b.is_system) return a.is_system ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      )
      setNewInboxLabelName('')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not create label')
    } finally {
      setInboxLabelCreateBusy(false)
    }
  }

  async function deleteInboxLabelDefinition(labelId: string) {
    const def = inboxLabelCatalog.find((d) => d.id === labelId)
    if (!def || def.is_system) return
    if (!window.confirm(`Remove label "${def.name}" from your team? It will be removed from all threads.`)) return
    setInboxLabelRowBusy(labelId)
    try {
      const { error } = await supabase.from('inbox_label_definitions').delete().eq('id', labelId)
      if (error) throw error
      setInboxLabelCatalog((prev) => prev.filter((d) => d.id !== labelId))
      setConvoList((prev) => prev.map((c) => ({ ...c, labels: c.labels.filter((l) => l.id !== labelId) })))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete label')
    } finally {
      setInboxLabelRowBusy(null)
    }
  }

  function insertCannedReplyIntoDraft(row: CannedReplyRow) {
    const convId = selectedConvoIdRef.current
    if (!convId) {
      alert('Select a conversation first.')
      return
    }
    const conv = convoListRef.current.find((c) => c.id === convId)
    if (!conv) {
      alert('Select a conversation first.')
      return
    }
    const bizName = businessInfo?.name?.trim() || 'our team'
    const expanded = expandCannedReplyBody(row.body, {
      customerName: conv.customerName,
      customerUsername: conv.customerUsername,
      businessName: bizName,
    })
    setReplyDraft((d) => mergeCannedIntoDraft(d, expanded))
    setCannedPopoverOpen(false)
    setCannedPickerQuery('')
  }

  function beginEditCanned(row: CannedReplyRow) {
    setCannedEditId(row.id)
    setCannedFormTitle(row.title)
    setCannedFormBody(row.body)
  }

  function cancelCannedForm() {
    setCannedEditId(null)
    setCannedFormTitle('')
    setCannedFormBody('')
  }

  async function saveCannedReplyForm() {
    const p = profileRef.current
    if (!p?.business_id) return
    const title = cannedFormTitle.trim()
    const body = cannedFormBody.trim()
    if (!title || !body) {
      alert('Title and message body are required.')
      return
    }
    setCannedSaveBusy(true)
    try {
      if (cannedEditId) {
        const { error } = await supabase
          .from('inbox_canned_replies')
          .update({ title, body })
          .eq('id', cannedEditId)
          .eq('business_id', p.business_id)
        if (error) throw error
        setCannedReplies((prev) =>
          prev
            .map((r) => (r.id === cannedEditId ? { ...r, title, body } : r))
            .sort((a, b) => {
              if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
              return a.title.localeCompare(b.title)
            })
        )
      } else {
        const { data, error } = await supabase
          .from('inbox_canned_replies')
          .insert({
            business_id: p.business_id,
            title,
            body,
            sort_order: cannedReplies.length,
          })
          .select('id, title, body, sort_order')
          .single()
        if (error) throw error
        const row = data as { id: string; title: string; body: string; sort_order: number }
        setCannedReplies((prev) =>
          [...prev, { id: row.id, title: row.title, body: row.body, sort_order: row.sort_order }].sort((a, b) =>
            a.title.localeCompare(b.title)
          )
        )
      }
      cancelCannedForm()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not save quick reply')
    } finally {
      setCannedSaveBusy(false)
    }
  }

  async function deleteCannedReply(id: string) {
    const p = profileRef.current
    if (!p?.business_id) return
    if (!window.confirm('Delete this quick reply?')) return
    setCannedDeleteBusyId(id)
    try {
      const { error } = await supabase.from('inbox_canned_replies').delete().eq('id', id).eq('business_id', p.business_id)
      if (error) throw error
      setCannedReplies((prev) => prev.filter((r) => r.id !== id))
      if (cannedEditId === id) cancelCannedForm()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete quick reply')
    } finally {
      setCannedDeleteBusyId(null)
    }
  }

  async function openThread(conversationId: string) {
    setInboxLabelsPopoverOpen(false)
    setCannedPopoverOpen(false)
    setSelectedConvoId(conversationId)
    setThreadLoading(true)
    setReplyDraft('')
    clearReplyPendingImage()
    try {
      const { data: convoMeta, error: convoErr } = await supabase
        .from('conversations')
        .select('customer_id')
        .eq('id', conversationId)
        .maybeSingle()
      if (convoErr) throw convoErr
      const customerId = convoMeta?.customer_id as string | undefined

      if (customerId) {
        const { errorMessage: readErr } = await markCustomerMessagesReadForStaff(supabase, conversationId, customerId)
        if (readErr) console.error(readErr)
        setConvoList((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)))
      }
      if (profile?.id) {
        const { errorMessage: nErr } = await markConversationNotificationsRead(supabase, profile.id, conversationId)
        if (nErr) console.error(nErr)
        const { count } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('read', false)
        setStaffNotifyUnread(count ?? 0)
      }

      const { data, error } = await supabase
        .from('messages')
        .select(THREAD_MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setThreadMessages((data || []) as ThreadMessage[])
    } catch (e) {
      console.error(e)
      setThreadMessages([])
    } finally {
      setThreadLoading(false)
    }
  }

  async function onReplyImagePick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/') || f.type.startsWith('video/')) {
      alert('Only image files are allowed (no video).')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      alert('Please choose an image under 20 MB.')
      return
    }
    try {
      const blob = await downscaleImageFileToJpeg(f, { maxDim: 1280, quality: 0.85 })
      const previewUrl = URL.createObjectURL(blob)
      setReplyPendingImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl)
        return { blob, previewUrl }
      })
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Could not process the image.')
    }
  }

  async function insertStaffMessageToConversation(
    conversationId: string,
    rawText: string,
    pendingImage: { blob: Blob; previewUrl: string } | null
  ): Promise<ThreadMessage | null> {
    const p = profileRef.current
    if (!p) return null
    const text = rawText.trim()
    const hasImage = !!pendingImage
    if (!text && !hasImage) return null

    let imageUrl: string | null = null
    if (hasImage && pendingImage) {
      const path = `${p.id}/${conversationId}/${crypto.randomUUID()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('message-images')
        .upload(path, pendingImage.blob, {
          contentType: 'image/jpeg',
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
        conversation_id: conversationId,
        sender_id: p.id,
        body,
        image_url: imageUrl,
      })
      .select(THREAD_MESSAGE_SELECT)
      .single()
    if (error) throw error

    const msg = data as ThreadMessage
    if (selectedConvoIdRef.current === conversationId) {
      setThreadMessages((prev) => [...prev, msg])
    }

    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

    const row = data as { body: string }
    let preview = (row.body ?? '').trim().slice(0, 160)
    if (!preview) preview = '📷 Reply'
    void fetch('/api/staff/notify-customer-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, preview }),
    }).then(async (res) => {
      if (res.ok) return
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      console.error('notify-customer-reply failed:', res.status, j.error ?? j)
      if (!p.business_id) return
      const { data: convo, error: convoErr } = await supabase
        .from('conversations')
        .select('customer_id')
        .eq('id', conversationId)
        .single()
      if (convoErr || !(convo as { customer_id?: string } | null)?.customer_id) return
      const customerId = (convo as { customer_id: string }).customer_id
      const { error: nErr } = await supabase.from('notifications').insert({
        user_id: customerId,
        business_id: p.business_id,
        type: 'support_reply',
        title: 'New reply from the team',
        body: preview,
        link: '/feed',
        conversation_id: conversationId,
      })
      if (nErr) console.error('fallback customer notification insert:', nErr)
    })

    return msg
  }

  async function sendReply() {
    if (!profile || !selectedConvoId) return
    const text = replyDraft.trim()
    const hasImage = !!replyPendingImage
    if (!text && !hasImage) return

    const chTyping = staffThreadChannelRef.current
    if (chTyping && staffThreadBroadcastReadyRef.current && staffTypingSentRef.current) {
      void chTyping.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: profile.id, typing: false },
      })
      staffTypingSentRef.current = false
    }
    if (staffTypingIdleTimerRef.current) {
      window.clearTimeout(staffTypingIdleTimerRef.current)
      staffTypingIdleTimerRef.current = null
    }

    setReplyBusy(true)
    try {
      const msg = await insertStaffMessageToConversation(selectedConvoId, replyDraft, replyPendingImage)
      if (!msg) return
      setReplyDraft('')
      clearReplyPendingImage()
      await refreshDashboard(profileRef.current!)
    } catch (e) {
      console.error(e)
      alert(
        'Could not send. Check you are signed in and RLS allows staff replies. For photos, run migration 002_message_images_storage.sql if needed.'
      )
    } finally {
      setReplyBusy(false)
    }
  }

  async function sendMessageToActiveMember(customerId: string) {
    const conversationId = convoIdByCustomerId.get(customerId)
    if (!conversationId) {
      alert('This member has not started a support chat yet. They need to message you first.')
      return
    }
    const draft = (memberMessageDrafts[customerId] ?? '').trim()
    if (!draft) return

    setMemberSendBusyId(customerId)
    try {
      const msg = await insertStaffMessageToConversation(conversationId, draft, null)
      if (!msg) return
      setMemberMessageDrafts((prev) => {
        const next = { ...prev }
        delete next[customerId]
        return next
      })
      await refreshDashboard(profileRef.current!)
    } catch (e) {
      console.error(e)
      alert('Could not send message. Check you are signed in and try again.')
    } finally {
      setMemberSendBusyId(null)
    }
  }

  async function refreshInbox() {
    const p = profileRef.current
    if (!p?.business_id) return
    setInboxRefreshing(true)
    try {
      await refreshDashboard(p)
      const cid = selectedConvoIdRef.current
      if (cid) await openThread(cid)
    } finally {
      setInboxRefreshing(false)
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
    if (!profile?.business_id) return
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
          : 'Could not publish. If this persists, run migration 017_announcements_staff_write.sql (or ensure announcements RLS allows business members). For photos, apply storage migration 002_message_images_storage.sql if uploads fail.'
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

    setNotifyBusy(true)
    try {
      const recipientIds = new Set<string>()

      if (audience === 'all') {
        const { data: convos } = await supabase.from('conversations').select('customer_id').eq('business_id', profile.business_id)
        for (const c of convos || []) recipientIds.add((c as { customer_id: string }).customer_id)
        const { data: follows } = await supabase.from('follows').select('user_id').eq('business_id', profile.business_id)
        for (const f of follows || []) recipientIds.add((f as { user_id: string }).user_id)
      } else if (audience === 'one') {
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
      } else if (audience === 'labels') {
        if (notifyAudienceLabelIds.length === 0) {
          alert('Choose at least one inbox label. Recipients are customers with a labeled thread for your business.')
          setNotifyBusy(false)
          return
        }
        const { data: assignRows, error: aErr } = await supabase
          .from('conversation_inbox_labels')
          .select('conversation_id')
          .in('label_id', notifyAudienceLabelIds)
        if (aErr) throw aErr
        const convIds = [...new Set((assignRows || []).map((r: { conversation_id: string }) => r.conversation_id))]
        if (convIds.length === 0) {
          alert('No conversations use those labels yet.')
          setNotifyBusy(false)
          return
        }
        const convChunk = 200
        for (let i = 0; i < convIds.length; i += convChunk) {
          const slice = convIds.slice(i, i + convChunk)
          const { data: convoRows, error: cErr } = await supabase
            .from('conversations')
            .select('customer_id')
            .eq('business_id', profile.business_id)
            .in('id', slice)
          if (cErr) throw cErr
          for (const row of convoRows || []) {
            recipientIds.add((row as { customer_id: string }).customer_id)
          }
        }
      } else {
        for (const id of selectedRecipientIds) recipientIds.add(id)
      }

      if (recipientIds.size === 0) {
        alert('No recipients match this audience yet.')
        setNotifyBusy(false)
        return
      }

      const candidateIds = [...recipientIds]
      const approvedSet = new Set<string>()
      const idChunk = 200
      for (let i = 0; i < candidateIds.length; i += idChunk) {
        const slice = candidateIds.slice(i, i + idChunk)
        const { data: approvedRows, error: apErr } = await supabase
          .from('profiles')
          .select('id')
          .in('id', slice)
          .eq('role', 'customer')
          .eq('account_status', 'approved')
          .is('deleted_at', null)
        if (apErr) throw apErr
        for (const r of approvedRows || []) approvedSet.add((r as { id: string }).id)
      }
      const approvedIds = [...approvedSet]
      if (approvedIds.length === 0) {
        alert('No approved customers to notify (pending or suspended accounts are skipped).')
        setNotifyBusy(false)
        return
      }

      const rows = approvedIds.map((user_id) => ({
        user_id,
        business_id: profile.business_id,
        type: announcementType,
        title,
        body,
        link: '/notifications',
      }))

      const chunk = 150
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await supabase.from('notifications').insert(rows.slice(i, i + chunk))
        if (error) throw error
      }

      setNotifyTitle('')
      setNotifyBody('')
      setOneUserQuery('')
      setSelectedRecipientIds([])
      setNotifyAudienceLabelIds([])
      setNotifyRecipientQuery('')
      alert(
        `Sent ${rows.length} in-app notification(s). Customers see these under the bell on the feed — not SMS or DM.`
      )
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not send notifications.')
    } finally {
      setNotifyBusy(false)
    }
  }

  async function uploadStaffAvatar(file: File) {
    if (!profile) return
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Please choose an image under 5 MB.')
      return
    }
    setStaffAvatarBusy(true)
    try {
      const ext = extFromImageFile(file)
      const path = `${profile.id}/avatar.${ext}`
      const { error: upErr } = await supabase.storage.from('profile-images').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('profile-images').getPublicUrl(path)
      const nextUrl = `${pub.publicUrl}?v=${Date.now()}`
      const { error: saveErr } = await supabase.from('profiles').update({ avatar_url: nextUrl }).eq('id', profile.id)
      if (saveErr) throw saveErr
      setProfile((prev) => (prev ? { ...prev, avatar_url: nextUrl } : prev))
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not upload profile photo.')
    } finally {
      setStaffAvatarBusy(false)
    }
  }

  async function onStaffAvatarPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    await uploadStaffAvatar(f)
  }

  async function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return
    await supabase.auth.signOut()
    router.replace('/login')
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

  const filteredConvoList = useMemo(() => {
    const q = inboxSearchQuery.trim().toLowerCase()
    if (!q) return convoList
    return convoList.filter((c) => {
      const labelsText = c.labels.map((l) => l.name).join(' ').toLowerCase()
      return (
        c.customerName.toLowerCase().includes(q) ||
        c.customerUsername.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q) ||
        labelsText.includes(q)
      )
    })
  }, [convoList, inboxSearchQuery])

  const inboxDisplayList = useMemo(() => {
    if (inboxThreadLabelFilterIds.length === 0) return filteredConvoList
    return filteredConvoList.filter((c) =>
      inboxThreadLabelFilterIds.some((lid) => c.labels.some((l) => l.id === lid))
    )
  }, [filteredConvoList, inboxThreadLabelFilterIds])

  const filteredCannedPickerList = useMemo(() => {
    const q = cannedPickerQuery.trim().toLowerCase()
    if (!q) return cannedReplies
    return cannedReplies.filter((r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q))
  }, [cannedReplies, cannedPickerQuery])

  const threadSeenIndexes = useMemo(() => {
    const customerId = convoList.find((c) => c.id === selectedConvoId)?.customer_id
    if (!customerId || threadMessages.length === 0) return { lastStaff: -1, lastOther: -1 }
    let lastStaff = -1
    let lastOther = -1
    for (let i = threadMessages.length - 1; i >= 0; i--) {
      if (lastStaff < 0 && threadMessages[i].sender_id !== customerId) lastStaff = i
      if (lastOther < 0 && threadMessages[i].sender_id === customerId) lastOther = i
    }
    return { lastStaff, lastOther }
  }, [threadMessages, selectedConvoId, convoList])

  const convoIdByCustomerId = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of convoList) map.set(c.customer_id, c.id)
    return map
  }, [convoList])

  const selectableRecipients = useMemo(() => {
    const map = new Map<string, ActiveMember>()
    for (const member of activeMembers) map.set(member.id, member)
    return [...map.values()].sort((a, b) => (a.username || '').localeCompare(b.username || ''))
  }, [activeMembers])

  const filteredSelectableRecipients = useMemo(() => {
    const q = notifyRecipientQuery.trim().toLowerCase()
    if (!q) return selectableRecipients
    return selectableRecipients.filter((m) => {
      const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim().toLowerCase()
      return name.includes(q) || (m.username || '').toLowerCase().includes(q)
    })
  }, [selectableRecipients, notifyRecipientQuery])

  function toggleSelectedRecipient(userId: string) {
    setSelectedRecipientIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  function toggleNotifyAudienceLabel(labelId: string) {
    setNotifyAudienceLabelIds((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
    )
  }

  function toggleInboxThreadLabelFilter(labelId: string) {
    setInboxThreadLabelFilterIds((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
    )
  }

  function selectAllNotifyRecipients() {
    setSelectedRecipientIds(selectableRecipients.map((m) => m.id))
  }

  function clearNotifyRecipients() {
    setSelectedRecipientIds([])
  }

  /** Adds everyone currently matching the search filter to the selection (does not remove others). */
  function addFilteredRecipientsToSelection() {
    setSelectedRecipientIds((prev) => {
      const s = new Set(prev)
      for (const m of filteredSelectableRecipients) s.add(m.id)
      return [...s]
    })
  }

  async function updateReportStatus(reportId: string, status: ReportItem['status']) {
    if (!profile?.business_id) return
    setReportBusyId(reportId)
    try {
      const { error } = await supabase
        .from('admin_reports')
        .update({ status })
        .eq('id', reportId)
        .eq('business_id', profile.business_id)
      if (error) throw error
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status } : r)))
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not update report status.')
    } finally {
      setReportBusyId(null)
    }
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const isAdmin = profile.business_role === 'admin'
  const mobileGridClass =
    navItems.length > 6 ? 'grid-cols-7' : navItems.length > 5 ? 'grid-cols-6' : 'grid-cols-5'
  const selectedConvo = convoList.find((c) => c.id === selectedConvoId) || null
  const activeNav = navItems.find((n) => n.id === activeTab)
  const headerTitle = activeNav?.label ?? 'Dashboard'
  const staffRoleLabel = profile.business_role === 'admin' ? 'Admin' : 'Support Staff'
  const headerSubParts = ['Relay Staff', businessInfo?.name, staffRoleLabel].filter(Boolean) as string[]
  const headerSub = headerSubParts.join(' · ')

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden text-[14px] leading-snug text-white antialiased bg-[radial-gradient(ellipse_at_top_left,_#0f1840_0%,_#070a18_45%,_#050814_100%)] lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:flex lg:h-full lg:min-h-0 flex-col border-r border-white/[0.08] bg-[rgba(8,13,28,0.95)] py-3 px-2.5 gap-0.5 overflow-y-auto">
        <div className="admin-sidebar-top px-2 pb-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#4e5a7a] mb-2">Staff Portal</p>
          <div className="flex items-center gap-2.5 mb-2.5">
            <RelayLogo size="sm" theme="dark" className="gap-2 [&>div]:!h-[30px] [&>div]:!w-[30px] [&>div]:!rounded-lg [&_svg]:!h-3.5 [&_svg]:!w-3.5 [&_span]:!text-base [&_span]:!font-extrabold [&_span]:!tracking-[-0.025em]" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              <input
                ref={staffAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onStaffAvatarPick(e)}
              />
              <div className="w-9 h-9 rounded-full overflow-hidden border border-white/[0.08] bg-[#1a2550] flex items-center justify-center text-xs font-bold text-white">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={`${profile.username} avatar`} className="w-full h-full object-cover" />
                ) : (
                  profile.username.slice(0, 2).toUpperCase()
                )}
              </div>
              {staffAvatarBusy ? (
                <div
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 ring-1 ring-black/20"
                  aria-live="polite"
                >
                  <Loader2 className="w-4 h-4 animate-spin text-white" aria-hidden />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => staffAvatarInputRef.current?.click()}
                disabled={staffAvatarBusy}
                className="absolute left-[95.18%] top-[95.18%] z-[1] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-sm backdrop-blur-sm hover:bg-black/50 hover:border-white/30 active:scale-95 disabled:pointer-events-none disabled:opacity-40 transition-colors"
                aria-label="Change profile photo"
                title="Change profile photo"
              >
                <Camera className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">{profile.username}</p>
              <p className="text-[11px] text-[#8892b0] truncate">
                @{profile.username} · {staffRoleLabel}
              </p>
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 flex-1 min-h-0">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeTab
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id)
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-left text-[13px] font-medium transition-all ${
                  active
                    ? 'border-[rgba(141,99,255,0.4)] bg-[rgba(141,99,255,0.1)] text-white shadow-[0_4px_16px_-8px_rgba(124,90,246,0.4)]'
                    : 'border-transparent text-[#8892b0] hover:bg-white/[0.04] hover:text-[#c4cbe6]'
                }`}
              >
                <Icon className="w-[15px] h-[15px] shrink-0 opacity-90" />
                <span className="flex-1 min-w-0">{item.label}</span>
                {item.id === 'inbox' && inboxUnreadTotal > 0 ? (
                  <span className="shrink-0 min-w-4 h-4 px-1 rounded-full bg-[#8d63ff] text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
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
          className="mt-auto flex items-center gap-2 text-left text-[12px] text-[#4e5a7a] hover:text-[#c4cbe6] px-2.5 py-2 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Sign out
        </button>
      </aside>

      <main className="flex flex-col min-h-0 w-full min-h-screen lg:min-h-0 lg:h-full overflow-hidden pb-[max(4.25rem,env(safe-area-inset-bottom))] lg:pb-0">
        <header className="shrink-0 flex flex-wrap items-center gap-2.5 border-b border-white/[0.08] bg-[rgba(11,18,40,0.9)] backdrop-blur-md px-3 py-2.5 sm:px-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold tracking-[-0.02em] text-white leading-tight">{headerTitle}</h2>
            <p className="text-[12px] text-[#8892b0] mt-0.5 leading-snug">{headerSub}</p>
            {businessInfo?.slug ? (
              <p className="text-[11px] text-[#4e5a7a] mt-1 font-mono truncate">
                slug <span className="text-[#8892b0]">{businessInfo.slug}</span>
              </p>
            ) : null}
            {!businessInfo && profile.business_id ? (
              <p className="text-amber-200/90 text-xs mt-1">Could not load business record — check businesses table for this business_id.</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => router.push('/notifications')}
              className="relative inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-[#c4cbe6] hover:bg-white/[0.10]"
              aria-label="Alerts"
            >
              <Bell className="w-4 h-4" />
              {staffNotifyUnread > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#ff3b5c] text-white text-[9px] font-bold flex items-center justify-center leading-none tabular-nums border-2 border-[#0b1228]">
                  {staffNotifyUnread > 99 ? '99+' : staffNotifyUnread}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => void manualRefresh()}
              disabled={dashRefreshing || !profile.business_id}
              className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] font-semibold text-[#c4cbe6] hover:text-white hover:bg-white/[0.06] disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${dashRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="lg:hidden inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-[#c4cbe6] hover:bg-white/[0.10] hover:text-white"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl space-y-3 px-3 py-3 sm:px-4 sm:py-4">
          {loadError ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
              <strong className="font-semibold">Data load issue:</strong> {loadError}
              {/\b(column|relation|does not exist|42703|42P01|suspended|moderation_suspension)\b/i.test(loadError) ? (
                <p className="text-red-200/80 text-xs mt-1">
                  For <code className="text-red-100">suspended</code> status or moderation log errors, run{' '}
                  <code className="text-red-100">005_account_suspend_moderation.sql</code> in the Supabase SQL editor. Other column errors may
                  need earlier migrations.
                </p>
              ) : /pending:/i.test(loadError) ? (
                <p className="text-red-200/80 text-xs mt-1">
                  The pending list comes from your Next server at <code className="text-red-100">/api/staff/pending-signups</code>. A fetch error
                  here is usually connectivity or the dev server — not a database migration.
                </p>
              ) : null}
            </div>
          ) : null}

        {activeTab === 'home' ? (
          <section className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <StatCard icon={<User2 className="w-4 h-4" />} label="Pending" value={metrics.pending} accent="yellow" />
              <StatCard icon={<Inbox className="w-4 h-4" />} label="Threads" value={metrics.unread} accent="purple" />
              <StatCard icon={<ClipboardList className="w-4 h-4" />} label="Reports" value={metrics.reportCount} accent="red" />
              <StatCard icon={<Users className="w-4 h-4" />} label="Active members" value={metrics.members} accent="green" />
            </div>
            <div className={`grid gap-2 ${isAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
              <QuickButton icon={<User2 className="w-4 h-4" />} label="Review Queue" onClick={() => setActiveTab('users')} />
              <QuickButton
                icon={<Inbox className="w-4 h-4" />}
                label="Open Inbox"
                badgeCount={inboxUnreadTotal}
                onClick={() => setActiveTab('inbox')}
              />
              <QuickButton icon={<Megaphone className="w-4 h-4" />} label="Post" onClick={() => setActiveTab('post')} />
              {isAdmin ? (
                <QuickButton icon={<UserCog className="w-4 h-4" />} label="Team" onClick={() => setActiveTab('team')} />
              ) : (
                <QuickButton icon={<Send className="w-4 h-4" />} label="Send Notify" onClick={() => setActiveTab('notify')} />
              )}
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.08]">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8892b0]">Recent Conversations</h3>
              </div>
              <div className="divide-y divide-white/[0.08]">
                {convoList.length === 0 ? (
                  <p className="px-3 py-5 text-[13px] text-[#8892b0]">No customer threads yet.</p>
                ) : (
                  convoList.slice(0, 4).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setActiveTab('inbox')
                        void openThread(item.id)
                      }}
                      className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-[10px] bg-[#131e3e] flex items-center justify-center shrink-0 relative overflow-hidden border border-white/[0.06] text-xs font-bold text-white">
                        {item.customerAvatar ? (
                          <img
                            src={item.customerAvatar}
                            alt={`${item.customerName} avatar`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          item.customerName.slice(0, 2).toUpperCase()
                        )}
                        {item.unreadCount > 0 ? (
                          <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-[#ff3b5c] text-white text-[8px] font-bold flex items-center justify-center leading-none tabular-nums border-2 border-[#050814]">
                            {item.unreadCount > 9 ? '9+' : item.unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-white truncate">{item.customerName}</p>
                        <p className="text-[11px] text-[#8892b0] truncate max-w-[min(100%,240px)]">{item.preview}</p>
                        <p className="text-[10px] text-[#4e5a7a] mt-0.5">{timeAgo(item.updated_at)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'post' ? (
          <section className="space-y-3 max-w-4xl">
            <p className="text-[12px] text-[#8892b0] leading-relaxed">
              Goes to the public feed for all approved customers. They can like and comment. Approved customers get an in-app notification when you
              publish.
            </p>

            <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] p-3 space-y-3">
              <input type="file" ref={postFileInputRef} accept="image/*" className="hidden" onChange={onPostImagePick} />
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#8d63ff] to-[#5a7ff6] flex items-center justify-center">
                  <User2 className="w-5 h-5 text-white" />
                </div>
                <input
                  className="flex-1 bg-[#111a31] border border-white/10 rounded-full px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff] text-[#dce3f9] placeholder:text-[#8b97bf]"
                  placeholder="What's on your mind?"
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                />
              </div>
              <textarea
                className="w-full bg-[#111a31] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff] min-h-20"
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
                className="w-full rounded-xl py-2.5 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
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
                <ul className="space-y-3">
                  {myAnnouncements.map((a) => {
                    const meta = myAnnouncementsMeta[a.id] || {
                      likes: 0,
                      comments: 0,
                      likedBy: [],
                      commentedBy: [],
                      commentPreviews: [],
                      commentDetails: [],
                    }
                    return (
                      <li
                        key={a.id}
                        className="rounded-2xl border border-white/10 bg-[#0d1428]/90 overflow-hidden shadow-[0_16px_40px_-28px_rgba(30,49,112,0.95)]"
                      >
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#7d86a8] min-w-0">
                              <span>{timeAgo(a.created_at)}</span>
                              {a.hidden_at ? (
                                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                  Hidden
                                </span>
                              ) : null}
                            </div>
                            <ContentModerationMenu
                              isHidden={Boolean(a.hidden_at)}
                              busy={postModerationBusyId === a.id}
                              onEdit={() => beginEditPost(a)}
                              onHide={() => void togglePostHidden(a.id, Boolean(a.hidden_at))}
                              onDelete={() => void deletePost(a.id)}
                            />
                          </div>
                          {editingPostId === a.id ? (
                            <div className="space-y-2">
                              <input
                                className="w-full rounded-xl border border-white/10 bg-[#111a31] px-3 py-2 text-sm text-white outline-none focus:border-[#6f54ff]"
                                value={editPostTitle}
                                onChange={(e) => setEditPostTitle(e.target.value)}
                                placeholder="Title"
                              />
                              <textarea
                                className="w-full min-h-20 rounded-xl border border-white/10 bg-[#111a31] px-3 py-2 text-sm text-white outline-none focus:border-[#6f54ff]"
                                value={editPostBody}
                                onChange={(e) => setEditPostBody(e.target.value)}
                                placeholder="Body"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={editPostBusy || !editPostTitle.trim() || !editPostBody.trim()}
                                  onClick={() => void saveEditPost()}
                                  className="rounded-lg bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] px-3 py-2 text-xs font-semibold disabled:opacity-40"
                                >
                                  {editPostBusy ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingPostId(null)}
                                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-[#c4cbe6] hover:bg-white/[0.06]"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="font-semibold text-white">{a.title}</p>
                              <p className="text-sm text-[#c4cbe6] mt-1 whitespace-pre-wrap line-clamp-6">{a.body}</p>
                            </>
                          )}
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
                          <button
                            type="button"
                            disabled={meta.likes === 0}
                            onClick={() =>
                              setEngagementOpen((prev) =>
                                prev?.postId === a.id && prev.mode === 'likes' ? null : { postId: a.id, mode: 'likes' }
                              )
                            }
                            className="inline-flex items-center gap-1.5 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <ThumbsUp className="w-4 h-4 text-[#8d63ff]" />
                            {meta.likes} likes
                          </button>
                          <button
                            type="button"
                            disabled={meta.comments === 0}
                            onClick={() =>
                              setEngagementOpen((prev) =>
                                prev?.postId === a.id && prev.mode === 'comments' ? null : { postId: a.id, mode: 'comments' }
                              )
                            }
                            className="inline-flex items-center gap-1.5 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <RelayChatBubbleIcon className="text-[#8d63ff]" size={16} strokeWidth={2} />
                            {meta.comments} comments
                          </button>
                        </div>
                        {engagementOpen?.postId === a.id ? (
                          <div className="px-4 pb-4 border-t border-white/10">
                            <div className="pt-3">
                              <p className="text-sm font-semibold text-white mb-2">
                                {engagementOpen.mode === 'likes' ? 'People who liked this post' : 'People who commented on this post'}
                              </p>
                              {engagementOpen.mode === 'likes' ? (
                                meta.likedBy.length === 0 ? (
                                  <p className="text-sm text-[#7d86a8]">No likes yet.</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {meta.likedBy.map((u, idx) => (
                                      <li key={`${u.name}-${idx}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#131d3d] px-3 py-2.5">
                                        {u.avatar ? (
                                          <img src={u.avatar} alt={`${u.name} avatar`} className="w-9 h-9 rounded-full object-cover border border-white/10" />
                                        ) : (
                                          <div className="w-9 h-9 rounded-full bg-[#202b51] text-[11px] font-bold text-[#d8def3] border border-white/10 flex items-center justify-center">
                                            {u.name.slice(0, 2).toUpperCase()}
                                          </div>
                                        )}
                                        <p className="text-sm text-white font-medium">{u.name}</p>
                                      </li>
                                    ))}
                                  </ul>
                                )
                              ) : meta.commentDetails.length === 0 ? (
                                <p className="text-sm text-[#7d86a8]">No comments yet.</p>
                              ) : (
                                (() => {
                                  const cBy = engagementCommentsByParent(meta.commentDetails)
                                  const draftKey = (parentId: string) => `${a.id}::${parentId}`
                                  function renderEngagementComment(c: EngagementComment): ReactNode {
                                    const kids = cBy.get(c.id) || []
                                    const dk = draftKey(c.id)
                                    return (
                                      <li key={c.id} className="flex items-start gap-2.5">
                                        {c.userAvatar ? (
                                          <img
                                            src={c.userAvatar}
                                            alt={`${c.userName} avatar`}
                                            className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0"
                                          />
                                        ) : (
                                          <div className="w-9 h-9 rounded-full bg-[#202b51] text-[11px] font-bold text-[#d8def3] border border-white/10 flex items-center justify-center shrink-0">
                                            {c.userName.slice(0, 2).toUpperCase()}
                                          </div>
                                        )}
                                        <div className="min-w-0 flex-1 space-y-2">
                                          <div className="rounded-2xl border border-white/10 bg-[#131d3d] px-3 py-2">
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="min-w-0 flex-1">
                                                <p className="text-sm text-white font-medium leading-tight">{c.userName}</p>
                                                {c.hidden_at ? (
                                                  <span className="mt-0.5 inline-block rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-200">
                                                    Hidden
                                                  </span>
                                                ) : null}
                                              </div>
                                              <ContentModerationMenu
                                                isHidden={Boolean(c.hidden_at)}
                                                busy={commentModerationBusyId === c.id}
                                                onEdit={() => beginEditComment(c)}
                                                onHide={() => void toggleCommentHidden(c.id, Boolean(c.hidden_at))}
                                                onDelete={() => void deleteComment(c.id)}
                                              />
                                            </div>
                                            {editingCommentId === c.id ? (
                                              <div className="mt-2 space-y-2">
                                                <textarea
                                                  className="w-full min-h-16 rounded-xl border border-white/10 bg-[#111a31] px-2.5 py-2 text-sm text-white outline-none focus:border-[#6f54ff]"
                                                  value={editCommentBody}
                                                  onChange={(e) => setEditCommentBody(e.target.value)}
                                                />
                                                <div className="flex flex-wrap gap-2">
                                                  <button
                                                    type="button"
                                                    disabled={commentModerationBusyId === c.id || !editCommentBody.trim()}
                                                    onClick={() => void saveEditComment()}
                                                    className="rounded-lg bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                                                  >
                                                    Save
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => setEditingCommentId(null)}
                                                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-[#c4cbe6]"
                                                  >
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <p className="text-sm text-[#c4cbe6] mt-0.5 break-words whitespace-pre-wrap">{c.body}</p>
                                            )}
                                            <p className="text-[11px] text-[#7d86a8] mt-1">{timeAgo(c.created_at)}</p>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <input
                                              className="flex-1 min-w-[140px] rounded-xl border border-white/10 bg-[#111a31] px-2.5 py-2 text-xs text-white outline-none focus:border-[#6f54ff]"
                                              placeholder={`Reply to ${c.userName}…`}
                                              value={staffCommentReplyDrafts[dk] || ''}
                                              onChange={(e) =>
                                                setStaffCommentReplyDrafts((d) => ({ ...d, [dk]: e.target.value }))
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                  e.preventDefault()
                                                  void submitStaffCommentReply(a.id, c.id)
                                                }
                                              }}
                                            />
                                            <button
                                              type="button"
                                              disabled={
                                                staffReplyBusyPostId === a.id || !(staffCommentReplyDrafts[dk] || '').trim()
                                              }
                                              onClick={() => void submitStaffCommentReply(a.id, c.id)}
                                              className="rounded-lg px-3 py-2 text-xs font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
                                            >
                                              {staffReplyBusyPostId === a.id ? '…' : 'Reply'}
                                            </button>
                                          </div>
                                          {kids.length > 0 ? (
                                            <ul className="space-y-2.5 border-l border-white/10 pl-3 ml-1">
                                              {kids.map((k) => renderEngagementComment(k))}
                                            </ul>
                                          ) : null}
                                        </div>
                                      </li>
                                    )
                                  }
                                  return (
                                    <ul className="space-y-2.5">
                                      {(cBy.get(null) || []).map((c) => renderEngagementComment(c))}
                                    </ul>
                                  )
                                })()
                              )}
                            </div>
                          </div>
                        ) : null}
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-h-[34px]">
                {inboxUnreadTotal > 0 ? (
                  <span className="text-[10px] font-bold text-[#8d63ff] bg-[rgba(141,99,255,0.2)] border border-[rgba(141,99,255,0.35)] rounded-md px-1.5 py-px tabular-nums">
                    {inboxUnreadTotal} new
                  </span>
                ) : null}
                <span className="text-[11px] text-[#8892b0] tabular-nums">
                  {inboxSearchQuery.trim() || inboxThreadLabelFilterIds.length > 0
                    ? `${inboxDisplayList.length} of ${convoList.length} threads`
                    : `${convoList.length} threads`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshInbox()}
                  disabled={inboxRefreshing || !profile.business_id}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] font-semibold text-[#c4cbe6] hover:text-white hover:bg-white/[0.06] disabled:opacity-40"
                >
                  <RefreshCw className={`w-4 h-4 ${inboxRefreshing ? 'animate-spin' : ''}`} />
                  Refresh inbox
                </button>
              </div>
            </div>

            {convoList.length === 0 ? (
              loadError ? (
                <p className="text-sm text-red-300/90 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                  Threads could not load — see the error banner above. Staff must have{' '}
                  <code className="text-red-200">profiles.business_id</code> matching conversations for this business.
                </p>
              ) : (
                <div className="text-sm text-[#7d86a8] space-y-2">
                  <p>
                    When approved customers message your business from the feed, threads show here. Open <strong className="text-[#c4cbe6]">Support</strong>{' '}
                    in the customer feed to create a row in <code className="text-[#9ea8cc] text-xs">conversations</code> for this business.
                  </p>
                  <p className="text-[13px] text-[#8892b0]">
                    This list only includes threads where <code className="text-[#9ea8cc] text-xs">business_id</code> matches{' '}
                    <strong className="text-[#c4cbe6]">{businessInfo?.name ?? 'your business'}</strong>
                    {businessInfo?.slug ? (
                      <>
                        {' '}
                        (<code className="text-[#9ea8cc] text-xs">slug: {businessInfo.slug}</code>
                        ).
                      </>
                    ) : (
                      '.'
                    )}{' '}
                    On the feed, if <code className="text-[#9ea8cc] text-xs">NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG</code> is set to your slug, new chats
                    attach to this business even when the customer follows someone else. Set it to{' '}
                    <code className="text-[#9ea8cc] text-xs">{businessInfo?.slug ?? 'your-slug'}</code>, restart <code className="text-[#9ea8cc] text-xs">npm run dev</code> or
                    redeploy. Older threads created under another business stay on that business&apos;s inbox only.
                  </p>
                </div>
              )
            ) : (
              <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] overflow-hidden lg:grid lg:grid-cols-[minmax(220px,1fr)_minmax(0,1.75fr)] lg:h-[min(calc(100dvh-7.25rem),920px)] lg:min-h-0">
                <aside className="border-r border-white/[0.08] flex flex-col min-h-0 max-h-[44vh] lg:max-h-none lg:h-full">
                  <div className="p-2.5 border-b border-white/[0.08] shrink-0">
                    <div className="relative rounded-xl border border-white/[0.08] bg-[#0f1834]">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5c647e]" aria-hidden />
                      <input
                        type="search"
                        className="w-full rounded-xl bg-transparent py-2 pl-8 pr-2 text-[13px] text-[#e2e6f5] placeholder:text-[#5c647e] outline-none focus:ring-1 focus:ring-[#6f54ff]/40"
                        placeholder="Name, @user, preview, label…"
                        value={inboxSearchQuery}
                        onChange={(e) => setInboxSearchQuery(e.target.value)}
                        aria-label="Search threads"
                      />
                    </div>
                    {inboxLabelCatalog.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-[#5c647e] w-full">Filter by label (any match)</span>
                        {inboxLabelCatalog.map((lbl) => {
                          const on = inboxThreadLabelFilterIds.includes(lbl.id)
                          return (
                            <button
                              key={lbl.id}
                              type="button"
                              onClick={() => toggleInboxThreadLabelFilter(lbl.id)}
                              className={`inline-flex max-w-full truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                                on ? 'ring-1 ring-[#8d63ff]/50' : 'opacity-80 hover:opacity-100'
                              }`}
                              style={inboxLabelChipStyle(lbl.color)}
                            >
                              {lbl.name}
                            </button>
                          )
                        })}
                        {inboxThreadLabelFilterIds.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setInboxThreadLabelFilterIds([])}
                            className="text-[10px] font-medium text-[#8d63ff] hover:underline px-1"
                          >
                            Clear labels
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.08] max-h-[44vh] lg:max-h-none">
                    {inboxDisplayList.length === 0 ? (
                      <p className="px-3 py-6 text-center text-[13px] text-[#7d86a8]">
                        {convoList.length === 0
                          ? 'No threads.'
                          : 'No threads match your search or label filters.'}
                      </p>
                    ) : (
                    inboxDisplayList.map((item) => {
                      const active = selectedConvoId === item.id
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => void openThread(item.id)}
                          className={`w-full text-left px-3 py-2.5 flex gap-2 items-start transition-colors ${
                            active ? 'bg-[rgba(141,99,255,0.07)]' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="w-9 h-9 rounded-[10px] bg-[#131e3e] flex items-center justify-center text-[12px] font-bold shrink-0 relative overflow-hidden border border-white/[0.06] text-white">
                            {item.customerAvatar ? (
                              <img src={item.customerAvatar} alt={`${item.customerName} avatar`} className="w-full h-full object-cover" />
                            ) : (
                              item.customerName.slice(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[13px] font-semibold text-white truncate">{item.customerName}</p>
                              <div className="shrink-0 text-right">
                                <p className="text-[10px] text-[#4e5a7a]">{timeAgo(item.updated_at)}</p>
                                {item.unreadCount > 0 ? (
                                  <span className="inline-flex mt-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-[#ff3b5c] text-white text-[8px] font-bold items-center justify-center tabular-nums border-2 border-[#050814]">
                                    {item.unreadCount > 9 ? '9+' : item.unreadCount}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <p className="text-[11px] text-[#8892b0] truncate">@{item.customerUsername}</p>
                            <p className="text-[11px] text-[#8892b0] truncate mt-0.5 max-w-[min(100%,220px)]">{item.preview}</p>
                            {item.labels.length > 0 ? (
                              <div className="flex flex-wrap gap-1 mt-1.5 max-w-[min(100%,220px)]">
                                {item.labels.slice(0, 4).map((l) => (
                                  <span
                                    key={l.id}
                                    className="inline-flex max-w-full truncate rounded px-1 py-px text-[9px] font-semibold border"
                                    style={inboxLabelChipStyle(l.color)}
                                  >
                                    {l.name}
                                  </span>
                                ))}
                                {item.labels.length > 4 ? (
                                  <span className="text-[9px] text-[#5c647e] font-medium">+{item.labels.length - 4}</span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </button>
                      )
                    })
                    )}
                  </div>
                </aside>

                <div className="flex flex-col relative flex-1 min-h-[260px] max-h-[48vh] lg:min-h-0 lg:max-h-none lg:h-full">
                  {selectedConvo ? (
                    <>
                      <div className="px-3 py-2.5 border-b border-white/[0.08] shrink-0 space-y-2">
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-[#d12f2f] overflow-hidden flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                              {selectedConvo.customerAvatar ? (
                                <img src={selectedConvo.customerAvatar} alt={`${selectedConvo.customerName} avatar`} className="w-full h-full object-cover" />
                              ) : (
                                selectedConvo.customerName.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-white truncate">{selectedConvo.customerName}</p>
                              <p className="text-[11px] text-[#8892b0] truncate">@{selectedConvo.customerUsername} · Customer</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0 relative">
                            <button
                              type="button"
                              onClick={() => {
                                setInboxContactOpen(false)
                                setInboxLabelsPopoverOpen((v) => !v)
                              }}
                              className={`p-2 rounded-lg hover:bg-white/10 ${
                                inboxLabelsPopoverOpen ? 'text-white bg-white/10' : 'text-[#9ea8cc] hover:text-white'
                              }`}
                              aria-expanded={inboxLabelsPopoverOpen}
                              aria-label="Labels"
                            >
                              <Tag className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setInboxLabelsPopoverOpen(false)
                                setInboxContactOpen((v) => !v)
                              }}
                              className="p-2 rounded-lg text-[#9ea8cc] hover:text-white hover:bg-white/10"
                              aria-label="Open contact profile"
                            >
                              <MoreHorizontal className="w-5 h-5" />
                            </button>
                            {inboxLabelsPopoverOpen ? (
                              <div
                                ref={inboxLabelsPopoverRef}
                                className="absolute right-0 top-[calc(100%+6px)] z-30 w-[min(calc(100vw-2rem),320px)] rounded-2xl border border-white/10 bg-[#101937] shadow-[0_20px_40px_-25px_rgba(0,0,0,0.85)] overflow-hidden"
                              >
                                <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
                                  <p className="text-[13px] font-semibold text-white">Labels</p>
                                  <button
                                    type="button"
                                    onClick={() => setInboxLabelsPopoverOpen(false)}
                                    className="p-1 rounded-md text-[#9ea8cc] hover:text-white hover:bg-white/10"
                                    aria-label="Close labels"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="max-h-[min(50vh,280px)] overflow-y-auto p-2 space-y-0.5">
                                  {inboxLabelCatalog.length === 0 ? (
                                    <p className="text-xs text-[#7d86a8] px-2 py-3">
                                      No labels yet. Run the inbox labels migration in Supabase, then refresh.
                                    </p>
                                  ) : (
                                    inboxLabelCatalog.map((def) => {
                                      const on = selectedConvo.labels.some((l) => l.id === def.id)
                                      const busy = inboxLabelRowBusy === def.id
                                      return (
                                        <div
                                          key={def.id}
                                          className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]"
                                        >
                                          <button
                                            type="button"
                                            disabled={busy || !selectedConvoId}
                                            onClick={() => void applyInboxLabelOnThread(def.id, !on, def)}
                                            className="flex-1 min-w-0 flex items-center gap-2 text-left rounded-md px-2 py-1.5 text-[13px] text-[#e2e6f5] disabled:opacity-40"
                                          >
                                            <span
                                              className="w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[10px] font-bold"
                                              style={inboxLabelChipStyle(def.color)}
                                            >
                                              {on ? '✓' : ''}
                                            </span>
                                            <span className="truncate">{def.name}</span>
                                            {def.is_system ? (
                                              <span className="text-[9px] text-[#5c647e] shrink-0 font-medium">preset</span>
                                            ) : null}
                                          </button>
                                          {!def.is_system ? (
                                            <button
                                              type="button"
                                              disabled={busy}
                                              onClick={() => void deleteInboxLabelDefinition(def.id)}
                                              className="p-1.5 rounded-md text-[#9ea8cc] hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                                              aria-label={`Delete label ${def.name}`}
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
                                          ) : null}
                                        </div>
                                      )
                                    })
                                  )}
                                </div>
                                <div className="p-2 border-t border-white/10 space-y-2 bg-[#0c1428]">
                                  <p className="text-[10px] uppercase tracking-wide text-[#5c647e] font-semibold px-1">New label</p>
                                  <div className="flex gap-1.5">
                                    <input
                                      className="flex-1 min-w-0 bg-[#111a31] border border-white/10 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#6f54ff]/50"
                                      placeholder="e.g. Refund"
                                      value={newInboxLabelName}
                                      onChange={(e) => setNewInboxLabelName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          void createInboxLabelFromDraft()
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      disabled={inboxLabelCreateBusy || !newInboxLabelName.trim()}
                                      onClick={() => void createInboxLabelFromDraft()}
                                      className="shrink-0 rounded-lg px-3 py-2 text-[12px] font-semibold bg-white/10 text-white hover:bg-white/[0.14] disabled:opacity-40"
                                    >
                                      {inboxLabelCreateBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {selectedConvo.labels.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 items-center pl-[42px]">
                            {selectedConvo.labels.map((l) => (
                              <button
                                key={l.id}
                                type="button"
                                disabled={inboxLabelRowBusy === l.id}
                                onClick={() => void applyInboxLabelOnThread(l.id, false, l)}
                                className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold max-w-[200px] group disabled:opacity-40"
                                style={inboxLabelChipStyle(l.color)}
                                title="Remove label"
                              >
                                <span className="truncate">{l.name}</span>
                                <X className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-[#5c647e] pl-[42px]">No labels — use the tag icon to add some.</p>
                        )}
                      </div>
                      {inboxContactOpen ? (
                        <div className="absolute top-[62px] right-3 z-20 w-[280px] rounded-2xl border border-white/10 bg-[#101937] p-4 space-y-3 shadow-[0_20px_40px_-25px_rgba(0,0,0,0.8)]">
                          <p className="text-sm font-semibold text-white">Contact profile</p>
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-[#6f54ff] overflow-hidden flex items-center justify-center font-bold">
                              {selectedConvo.customerAvatar ? (
                                <img src={selectedConvo.customerAvatar} alt={`${selectedConvo.customerName} avatar`} className="w-full h-full object-cover" />
                              ) : (
                                selectedConvo.customerName.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-white truncate">{selectedConvo.customerName}</p>
                              <p className="text-xs text-[#7d86a8] truncate">@{selectedConvo.customerUsername}</p>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-white/10 text-xs text-[#7d86a8] space-y-1">
                            <p>Conversation ID</p>
                            <p className="text-[#aeb7d6] font-mono truncate" title={selectedConvo.id}>
                              {selectedConvo.id}
                            </p>
                          </div>
                        </div>
                      ) : null}
                      <div ref={threadScrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                        {threadLoading ? (
                          <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-[#8d63ff]" />
                          </div>
                        ) : threadMessages.length === 0 ? (
                          <p className="text-sm text-[#7d86a8] py-6 text-center">No messages yet. Say hello below.</p>
                        ) : (
                          threadMessages.map((m, i) => {
                            const isFromTeam = m.sender_id !== selectedConvo.customer_id
                            const teamLine = isFromTeam
                              ? formatTeamSenderLine(oneEmbed(m.profiles))
                              : null
                            const showText = Boolean(m.body?.trim()) && m.body !== '📷'
                            const showSeen =
                              m.read === true &&
                              m.read_at &&
                              ((isFromTeam && i === threadSeenIndexes.lastStaff) ||
                                (!isFromTeam && i === threadSeenIndexes.lastOther))
                            return (
                              <div
                                key={m.id}
                                className={`flex flex-col w-full min-w-0 ${isFromTeam ? 'items-end' : 'items-start'}`}
                              >
                                {teamLine ? (
                                  <p
                                    className="text-[10px] text-[#7d86a8] px-1 pb-0.5 font-medium truncate max-w-full text-right"
                                    title={teamLine}
                                  >
                                    {teamLine}
                                  </p>
                                ) : null}
                                <div className={`flex w-full min-w-0 ${isFromTeam ? 'justify-end' : 'justify-start'}`}>
                                  <div
                                    className={`w-fit max-w-[min(85%,24rem)] shrink-0 rounded-2xl px-3 py-2 text-sm ${
                                      isFromTeam ? 'bg-[#6f54ff] text-white' : 'bg-[#151d39] text-[#e2e6f5]'
                                    }`}
                                  >
                                    {m.image_url ? (
                                      <img src={m.image_url} alt="" className="rounded-lg max-h-40 mb-1 max-w-full w-full object-cover" />
                                    ) : null}
                                    {showText ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                                    <p className={`text-[10px] mt-1 ${isFromTeam ? 'text-white/70' : 'text-[#7d86a8]'}`}>
                                      {timeAgo(m.created_at)}
                                    </p>
                                  </div>
                                </div>
                                {showSeen ? (
                                  <p className="text-[11px] text-[#7d86a8] mt-1 px-1">Seen · {timeAgo(m.read_at!)}</p>
                                ) : null}
                              </div>
                            )
                          })
                        )}
                        <div ref={threadEndRef} className="h-px w-full" aria-hidden />
                      </div>
                      <div className="p-2.5 border-t border-white/10 space-y-2 shrink-0">
                        {peerCustomerTyping ? (
                          <p className="text-xs text-[#7d86a8]" aria-live="polite">
                            {selectedConvo.customerName} is typing…
                          </p>
                        ) : null}
                        <input
                          ref={replyImageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden"
                          onChange={onReplyImagePick}
                        />
                        {replyPendingImage ? (
                          <div className="relative rounded-xl overflow-hidden border border-white/10 max-h-32 w-fit max-w-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={replyPendingImage.previewUrl}
                              alt="Attachment preview"
                              className="max-h-32 w-auto max-w-full object-contain bg-[#0a1020]"
                            />
                            <button
                              type="button"
                              onClick={() => clearReplyPendingImage()}
                              className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/65 text-white flex items-center justify-center text-xs hover:bg-black/80"
                              aria-label="Remove photo"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : null}
                        <div className="flex gap-2 items-end">
                          <button
                            type="button"
                            onClick={() => replyImageInputRef.current?.click()}
                            disabled={replyBusy}
                            className="shrink-0 p-2.5 rounded-xl border border-white/10 bg-[#111a31] text-[#aeb7d6] hover:text-white hover:border-[#6f54ff]/50 disabled:opacity-40"
                            aria-label="Attach image"
                          >
                            <ImagePlus className="w-5 h-5" />
                          </button>
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setInboxLabelsPopoverOpen(false)
                                setInboxContactOpen(false)
                                setCannedPickerQuery('')
                                setCannedPopoverOpen((v) => !v)
                              }}
                              disabled={replyBusy}
                              className={`p-2.5 rounded-xl border border-white/10 bg-[#111a31] disabled:opacity-40 ${
                                cannedPopoverOpen
                                  ? 'text-white border-[#6f54ff]/50'
                                  : 'text-[#aeb7d6] hover:text-white hover:border-[#6f54ff]/50'
                              }`}
                              aria-expanded={cannedPopoverOpen}
                              aria-label="Quick replies"
                            >
                              <BookMarked className="w-5 h-5" />
                            </button>
                            {cannedPopoverOpen ? (
                              <div
                                ref={cannedPopoverRef}
                                className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(calc(100vw-2rem),360px)] max-h-[min(70vh,420px)] overflow-hidden rounded-2xl border border-white/10 bg-[#101937] shadow-[0_20px_40px_-25px_rgba(0,0,0,0.85)] flex flex-col"
                              >
                                <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 shrink-0">
                                  <p className="text-[13px] font-semibold text-white">Quick replies</p>
                                  <button
                                    type="button"
                                    onClick={() => setCannedPopoverOpen(false)}
                                    className="rounded-md p-1 text-[#9ea8cc] hover:bg-white/10 hover:text-white"
                                    aria-label="Close quick replies"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="px-2 py-2 border-b border-white/10 shrink-0">
                                  <input
                                    className="w-full rounded-lg border border-white/10 bg-[#0c1428] px-2.5 py-2 text-[12px] text-[#e2e6f5] outline-none focus:border-[#6f54ff]/50"
                                    placeholder="Filter saved replies…"
                                    value={cannedPickerQuery}
                                    onChange={(e) => setCannedPickerQuery(e.target.value)}
                                  />
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                                  {filteredCannedPickerList.length === 0 ? (
                                    <p className="px-2 py-4 text-center text-[12px] text-[#7d86a8]">
                                      {cannedReplies.length === 0
                                        ? 'No saved replies yet. Add one below (requires inbox_canned_replies migration).'
                                        : 'No matches.'}
                                    </p>
                                  ) : (
                                    filteredCannedPickerList.map((r) => (
                                      <div
                                        key={r.id}
                                        className="rounded-xl border border-white/[0.06] bg-[#0c1428] p-2.5 space-y-2"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-[12px] font-semibold text-white truncate">{r.title}</p>
                                          <p className="text-[11px] text-[#8892b0] line-clamp-2 whitespace-pre-wrap break-words">
                                            {r.body}
                                          </p>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                          <button
                                            type="button"
                                            disabled={replyBusy}
                                            onClick={() => insertCannedReplyIntoDraft(r)}
                                            className="rounded-lg bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                                          >
                                            Insert
                                          </button>
                                          <button
                                            type="button"
                                            disabled={cannedDeleteBusyId === r.id}
                                            onClick={() => beginEditCanned(r)}
                                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] font-medium text-[#c4cbe6] hover:bg-white/[0.06]"
                                          >
                                            <Pencil className="w-3 h-3" />
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            disabled={cannedDeleteBusyId === r.id}
                                            onClick={() => void deleteCannedReply(r.id)}
                                            className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 px-2 py-1.5 text-[11px] font-medium text-red-300/90 hover:bg-red-500/10 disabled:opacity-40"
                                          >
                                            {cannedDeleteBusyId === r.id ? (
                                              <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <Trash2 className="w-3 h-3" />
                                            )}
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                                <div className="border-t border-white/10 bg-[#0c1428] p-2.5 space-y-2 shrink-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5c647e] px-0.5">
                                    {cannedEditId ? 'Edit quick reply' : 'New quick reply'}
                                  </p>
                                  <input
                                    className="w-full rounded-lg border border-white/10 bg-[#111a31] px-2.5 py-2 text-[12px] text-[#e2e6f5] outline-none focus:border-[#6f54ff]/50"
                                    placeholder="Short title (e.g. Thanks — investigating)"
                                    value={cannedFormTitle}
                                    onChange={(e) => setCannedFormTitle(e.target.value)}
                                  />
                                  <textarea
                                    className="w-full min-h-[88px] resize-y rounded-lg border border-white/10 bg-[#111a31] px-2.5 py-2 text-[12px] text-[#e2e6f5] outline-none focus:border-[#6f54ff]/50"
                                    placeholder="Message body… Use placeholders: {customer_name}, {username}, {business}"
                                    value={cannedFormBody}
                                    onChange={(e) => setCannedFormBody(e.target.value)}
                                  />
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      disabled={cannedSaveBusy}
                                      onClick={() => void saveCannedReplyForm()}
                                      className="rounded-lg bg-white/10 px-3 py-2 text-[12px] font-semibold text-white hover:bg-white/[0.14] disabled:opacity-40"
                                    >
                                      {cannedSaveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : cannedEditId ? 'Save changes' : 'Save reply'}
                                    </button>
                                    {cannedEditId ? (
                                      <button
                                        type="button"
                                        onClick={() => cancelCannedForm()}
                                        className="rounded-lg border border-white/10 px-3 py-2 text-[12px] font-medium text-[#c4cbe6] hover:bg-white/[0.06]"
                                      >
                                        Cancel edit
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <input
                            className="flex-1 min-w-0 bg-[#111a31] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff]"
                            placeholder="Reply or add a caption…"
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
                            disabled={replyBusy || (!replyDraft.trim() && !replyPendingImage)}
                            onClick={() => void sendReply()}
                            className="shrink-0 rounded-xl px-3.5 py-2.5 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
                          >
                            Send
                          </button>
                        </div>
                        <p className="text-[10px] text-[#5c647e]">
                          Photos only (no video). Quick replies support {'{customer_name}'}, {'{username}'}, and {'{business}'} in the saved
                          message.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center px-5 text-center text-[#7d86a8] text-sm">
                      Select a conversation from the left to open thread details.
                    </div>
                  )}
                </div>

              </div>
            )}
          </section>
        ) : null}

        {activeTab === 'users' ? (
          <section className="space-y-4">
            <p className="text-[12px] text-[#8892b0] leading-relaxed">
              Approve new signups and manage active members for your business. Admins and support use the same tools here; pending customers cannot
              use the app until approved.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatCard icon={<User2 className="w-4 h-4" />} label="Pending" value={pendingCustomers.length} accent="yellow" />
              <StatCard icon={<Users className="w-4 h-4" />} label="Active" value={activeMembers.length} accent="green" />
              <StatCard icon={<Ban className="w-4 h-4" />} label="Suspended" value={suspendedMembers.length} accent="red" />
              <StatCard
                icon={<ClipboardList className="w-4 h-4" />}
                label="Total managed"
                value={pendingCustomers.length + activeMembers.length + suspendedMembers.length}
                accent="purple"
              />
            </div>
              <div className="flex gap-0.5 rounded-[10px] bg-[#0f1834] p-0.5">
                <button
                  type="button"
                  onClick={() => setUsersPanelTab('pending')}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                    usersPanelTab === 'pending' ? 'bg-[rgba(141,99,255,0.15)] text-[#8d63ff]' : 'text-[#8892b0] hover:text-[#c4cbe6]'
                  }`}
                >
                  Pending ({pendingCustomers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setUsersPanelTab('active')}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                    usersPanelTab === 'active' ? 'bg-[rgba(141,99,255,0.15)] text-[#8d63ff]' : 'text-[#8892b0] hover:text-[#c4cbe6]'
                  }`}
                >
                  Active ({activeMembers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setUsersPanelTab('suspended')}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                    usersPanelTab === 'suspended' ? 'bg-[rgba(141,99,255,0.15)] text-[#8d63ff]' : 'text-[#8892b0] hover:text-[#c4cbe6]'
                  }`}
                >
                  Suspended ({suspendedMembers.length})
                </button>
              </div>

              {usersPanelTab === 'pending' ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold tracking-wide text-[#9ea8cc] uppercase">Pending approval</h4>
                  <div className="rounded-2xl border border-white/10 bg-[#0d1428]/90 p-2.5 sm:p-3 space-y-2.5 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                    {pendingCustomers.length === 0 ? (
                      <p className="text-sm text-[#7d86a8] py-4 text-center">No pending signups.</p>
                    ) : (
                      pendingCustomers.map((cust) => (
                        <article key={cust.id} className="rounded-xl border border-white/10 bg-[#121d3a] p-3 space-y-2.5">
                          <div>
                            <p className="font-semibold">
                              {`${cust.first_name ?? ''} ${cust.last_name ?? ''}`.trim() || cust.username}
                            </p>
                            <p className="text-[#7d86a8] text-sm">
                              @{cust.username} · joined {timeAgo(cust.created_at)}
                            </p>
                            <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#9ea8cc]">
                              <p className="break-all">
                                <span className="text-[#7d86a8]">Username:</span> @{cust.username}
                              </p>
                              <p className="break-all">
                                <span className="text-[#7d86a8]">Email:</span>{' '}
                                {cust.email ? (
                                  <>
                                    {cust.email}
                                    <span
                                      className={`ml-1 inline-block rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${
                                        cust.email_verified
                                          ? 'bg-emerald-500/15 text-emerald-300'
                                          : 'bg-amber-500/15 text-amber-300'
                                      }`}
                                    >
                                      {cust.email_verified ? 'Verified' : 'Unverified'}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[#7d86a8]">—</span>
                                )}
                              </p>
                              <p className="break-all">
                                <span className="text-[#7d86a8]">Phone:</span>{' '}
                                {cust.phone?.trim() ? cust.phone : <span className="text-[#7d86a8]">—</span>}
                              </p>
                              <p className="break-all">
                                <span className="text-[#7d86a8]">Referral:</span>{' '}
                                {cust.referral_username ? (
                                  `@${cust.referral_username}`
                                ) : (
                                  <span className="text-[#7d86a8]">—</span>
                                )}
                              </p>
                              <p className="break-all sm:col-span-2">
                                <span className="text-[#7d86a8]">Signed up:</span>{' '}
                                {new Date(cust.created_at).toLocaleString()} ({timeAgo(cust.created_at)})
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              disabled={reviewBusyId === cust.id}
                              onClick={() => void reviewCustomer(cust.id, 'approve')}
                              className="rounded-xl py-2 font-semibold bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-40"
                            >
                              {reviewBusyId === cust.id ? '…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={reviewBusyId === cust.id}
                              onClick={() => void reviewCustomer(cust.id, 'reject')}
                              className="rounded-xl py-2 font-semibold bg-red-500/90 hover:bg-red-500 disabled:opacity-40"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={reviewBusyId === cust.id}
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
              ) : null}

              {usersPanelTab === 'active' ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold tracking-wide text-[#9ea8cc] uppercase">Active members</h4>
                  <p className="text-[#7d86a8] text-xs">
                    Customers approved for the platform who follow your business or have a support thread with you.
                  </p>
                  <div className="rounded-2xl border border-white/10 bg-[#0d1428]/90 divide-y divide-white/10 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)] max-h-[380px] overflow-y-auto">
                    {activeMembers.length === 0 ? (
                      <p className="text-sm text-[#7d86a8] py-6 px-4 text-center">
                        No active members linked to this business yet — approve customers and have them follow or message you.
                      </p>
                    ) : (
                      activeMembers.map((m) => {
                        const label = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.username
                        const memberInitials = label.slice(0, 2).toUpperCase()
                        const memberConvoId = convoIdByCustomerId.get(m.id)
                        const memberDraft = memberMessageDrafts[m.id] ?? ''
                        const memberSending = memberSendBusyId === m.id
                        return (
                          <div key={m.id} className="px-3 py-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2.5">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {m.avatar_url ? (
                                  <img
                                    src={m.avatar_url}
                                    alt={`${label} avatar`}
                                    className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0"
                                  />
                                ) : (
                                  <div
                                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 border border-white/10"
                                    style={{ backgroundColor: '#606770' }}
                                  >
                                    {memberInitials}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-medium truncate text-[14px]">{label}</p>
                                  <p className="text-[13px] text-[#7d86a8] truncate">@{m.username}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={modBusyId === m.id}
                                onClick={() => void moderateSuspension(m.id, 'suspend', label)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[13px] text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
                              >
                                <Ban className="w-4 h-4 shrink-0" />
                                {modBusyId === m.id ? '…' : 'Suspend'}
                              </button>
                            </div>
                            {memberConvoId ? (
                              <div className="flex gap-2 pl-12">
                                <input
                                  className="flex-1 min-w-0 bg-[#111a31] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#6f54ff] disabled:opacity-50"
                                  placeholder="Type a message…"
                                  value={memberDraft}
                                  disabled={memberSending}
                                  onChange={(e) =>
                                    setMemberMessageDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      void sendMessageToActiveMember(m.id)
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={memberSending || !memberDraft.trim()}
                                  onClick={() => void sendMessageToActiveMember(m.id)}
                                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
                                >
                                  {memberSending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Send className="w-4 h-4" />
                                  )}
                                  Send
                                </button>
                              </div>
                            ) : (
                              <p className="text-[11px] text-[#7d86a8] pl-12">
                                No message thread yet — they must contact you first.
                              </p>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              ) : null}

              {usersPanelTab === 'suspended' ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold tracking-wide text-[#9ea8cc] uppercase">Suspended</h4>
                  <p className="text-[#7d86a8] text-xs">
                    These customers cannot use the app until you unsuspend them. Actions are recorded in the moderation log.
                  </p>
                  <div className="rounded-2xl border border-amber-500/20 bg-[#0d1428]/90 divide-y divide-white/10 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)] max-h-[340px] overflow-y-auto">
                    {suspendedMembers.length === 0 ? (
                      <p className="text-sm text-[#7d86a8] py-6 px-4 text-center">No suspended members for this business.</p>
                    ) : (
                      suspendedMembers.map((m) => {
                        const label = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.username
                        return (
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="font-medium truncate text-[14px]">{label}</p>
                              <p className="text-[13px] text-[#7d86a8] truncate">@{m.username}</p>
                            </div>
                            <button
                                type="button"
                                disabled={modBusyId === m.id}
                                onClick={() => void moderateSuspension(m.id, 'unsuspend', label)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[13px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
                              >
                                <UserCheck className="w-4 h-4 shrink-0" />
                                {modBusyId === m.id ? '…' : 'Unsuspend'}
                              </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              ) : null}
          </section>
        ) : null}

        {activeTab === 'team' && isAdmin ? (
          <section className="space-y-4 max-w-3xl">
            <p className="text-[12px] text-[#8892b0] leading-relaxed">
              Everyone on the business team shares this dashboard: inbox, users, posts, and reports. Customers see who sent each reply; in your
              inbox you see the same for every admin and support agent. Only admins can add or remove support accounts below.
            </p>
            {isAdmin ? (
              <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">Add support staff</h3>
                <p className="text-[11px] text-[#8892b0]">
                  They sign in at Relay with <strong className="text-[#c4cbe6]">email + password</strong> (same login page as you). Username is their
                  public <strong className="text-[#c4cbe6]">@handle</strong> for sign-in (lowercase, digits, underscore; 3–30 chars). Only{' '}
                  <strong className="text-[#c4cbe6]">first name</strong> is collected here for your records. Up to 4 support agents per business.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className="rounded-xl border border-white/10 bg-[#0c1428] px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff]/50"
                  placeholder="First name"
                  value={newStaffFirst}
                  onChange={(e) => setNewStaffFirst(e.target.value)}
                  autoComplete="given-name"
                />
                <input
                  type="email"
                  className="rounded-xl border border-white/10 bg-[#0c1428] px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff]/50"
                  placeholder="Work email (their login)"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  autoComplete="off"
                />
                <input
                  className="rounded-xl border border-white/10 bg-[#0c1428] px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff]/50 sm:col-span-2"
                  placeholder="Username — public @handle (e.g. alex_support)"
                  value={newStaffUsername}
                  onChange={(e) => setNewStaffUsername(e.target.value.replace(/\s+/g, '').replace(/^@+/, ''))}
                  autoComplete="off"
                />
                <div className="relative sm:col-span-2">
                  <input
                    type={showNewStaffPassword ? 'text' : 'password'}
                    className="w-full rounded-xl border border-white/10 bg-[#0c1428] px-3 py-2.5 pr-10 text-sm outline-none focus:border-[#6f54ff]/50"
                    placeholder="Password (min 8 characters)"
                    value={newStaffPassword}
                    onChange={(e) => setNewStaffPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewStaffPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f7896] hover:text-white p-0.5"
                    aria-label={showNewStaffPassword ? 'Hide passwords' : 'Show passwords'}
                  >
                    {showNewStaffPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="relative sm:col-span-2">
                  <input
                    type={showNewStaffPassword ? 'text' : 'password'}
                    className="w-full rounded-xl border border-white/10 bg-[#0c1428] px-3 py-2.5 pr-10 text-sm outline-none focus:border-[#6f54ff]/50"
                    placeholder="Confirm password"
                    value={newStaffPasswordConfirm}
                    onChange={(e) => setNewStaffPasswordConfirm(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewStaffPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f7896] hover:text-white p-0.5"
                    aria-label={showNewStaffPassword ? 'Hide passwords' : 'Show passwords'}
                  >
                    {showNewStaffPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="button"
                disabled={createStaffBusy}
                onClick={() => void createSupportStaff()}
                className="w-full rounded-xl py-2.5 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {createStaffBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {createStaffBusy ? 'Creating…' : 'Create staff account'}
              </button>
            </div>
            ) : null}

            <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8892b0]">Team roster</h3>
                {teamLoadBusy ? <Loader2 className="w-4 h-4 animate-spin text-[#8d63ff]" /> : null}
              </div>
              <div className="divide-y divide-white/[0.08]">
                {teamRows.length === 0 && !teamLoadBusy ? (
                  <p className="px-3 py-5 text-[13px] text-[#8892b0]">No team rows loaded.</p>
                ) : (
                  teamRows.map((row) => {
                    const label = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.username
                    const isSupport = row.business_role === 'support'
                    const removed = Boolean(row.deleted_at)
                    return (
                      <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{label}</p>
                          <p className="text-[12px] text-[#7d86a8] truncate">
                            @{row.username} · {row.business_role === 'admin' ? 'Admin' : 'Support'}
                            {removed ? <span className="text-red-300/90"> · removed</span> : null}
                          </p>
                        </div>
                        {isAdmin && isSupport && !removed ? (
                          <button
                            type="button"
                            disabled={removeStaffBusyId === row.id}
                            onClick={() => void removeSupportMember(row.id, label)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-200 hover:bg-red-500/20 disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            {removeStaffBusyId === row.id ? '…' : 'Remove'}
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
          <section className="space-y-3 max-w-3xl">
            <p className="text-[12px] text-[#8892b0] leading-relaxed">
              Sends an <strong className="text-[#c4cbe6]">in-app notification</strong> to each recipient (bell / Notifications screen).{' '}
              This is <strong className="text-[#c4cbe6]">not</strong> SMS, email, or a DM in their support thread — only the notifications list.
            </p>
            <p className="text-[12px] text-[#8892b0] leading-relaxed">
              <strong className="text-[#c4cbe6]">All</strong>: anyone who has messaged your business or follows you.{' '}
              <strong className="text-[#c4cbe6]">Selected</strong>: pick from that same member list.{' '}
              <strong className="text-[#c4cbe6]">Labels</strong>: approved customers with at least one conversation tagged with any label you pick.{' '}
              <strong className="text-[#c4cbe6]">One user</strong>: username or UUID. Pending or suspended customers are always skipped.
            </p>
            <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] p-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(['announcement', 'alert', 'update'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnnouncementType(opt)}
                    className={`rounded-xl py-2.5 border capitalize text-[13px] ${
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
                <AudienceRow label="Users with inbox labels" selected={audience === 'labels'} onClick={() => setAudience('labels')} />
                <AudienceRow label="One user" selected={audience === 'one'} onClick={() => setAudience('one')} />
              </div>
              {audience === 'labels' ? (
                <div className="rounded-xl border border-white/10 bg-[#111a31] p-2 space-y-1">
                  <p className="text-[11px] text-[#8892b0] px-1.5 pt-0.5">
                    Tick one or more labels. Anyone with a tagged thread for your business (any of these labels) gets the notification.
                  </p>
                  <p className="text-[11px] text-[#c4cbe6] px-1.5 pb-1 tabular-nums">
                    {notifyAudienceLabelIds.length} label{notifyAudienceLabelIds.length === 1 ? '' : 's'} selected
                  </p>
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {inboxLabelCatalog.length === 0 ? (
                      <p className="text-xs text-[#7d86a8] px-2 py-3">
                        No labels defined yet. Add labels from the Inbox tab (requires migration 013), then choose who has those tags on a thread.
                      </p>
                    ) : (
                      inboxLabelCatalog.map((lbl) => {
                        const selected = notifyAudienceLabelIds.includes(lbl.id)
                        return (
                          <button
                            key={lbl.id}
                            type="button"
                            onClick={() => toggleNotifyAudienceLabel(lbl.id)}
                            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors flex items-start gap-3 ${
                              selected
                                ? 'border-[#6f54ff] bg-[#221c4a] text-white'
                                : 'border-white/10 bg-[#151d39] text-[#aeb7d6] hover:border-white/20'
                            }`}
                          >
                            <SelectionCheckbox checked={selected} />
                            <span
                              className="shrink-0 mt-1 w-2.5 h-2.5 rounded-full ring-1 ring-white/15"
                              style={{ backgroundColor: lbl.color ?? '#64748b' }}
                              title="Label color"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="text-sm font-medium truncate block">{lbl.name}</span>
                              {lbl.is_system ? (
                                <span className="text-[10px] text-[#5c647e]">preset</span>
                              ) : null}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              ) : null}
              {audience === 'selected' ? (
                <div className="rounded-xl border border-white/10 bg-[#111a31] p-2 space-y-2">
                  <p className="text-[11px] text-[#8892b0] px-1.5">
                    Same people as <strong className="text-[#c4cbe6]">Users → Active</strong>: approved customers who follow you or have a support
                    thread. Tap rows to toggle, or use Select all / Clear.
                  </p>
                  {selectableRecipients.length === 0 ? (
                    <p className="text-xs text-[#7d86a8] px-2 py-3">
                      No selectable members yet. Members appear after they follow your business or open a support thread.
                    </p>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5c647e]" aria-hidden />
                        <input
                          type="search"
                          className="w-full rounded-lg border border-white/10 bg-[#0c1428] py-2 pl-8 pr-2 text-[12px] text-[#e2e6f5] outline-none focus:border-[#6f54ff]/50"
                          placeholder="Search by name or @username…"
                          value={notifyRecipientQuery}
                          onChange={(e) => setNotifyRecipientQuery(e.target.value)}
                          aria-label="Filter members for notify"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 px-0.5">
                        <button
                          type="button"
                          onClick={selectAllNotifyRecipients}
                          className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-[#c4cbe6] hover:bg-white/[0.1]"
                        >
                          Select all ({selectableRecipients.length})
                        </button>
                        <button
                          type="button"
                          onClick={clearNotifyRecipients}
                          disabled={selectedRecipientIds.length === 0}
                          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-[#8892b0] hover:text-white hover:bg-white/[0.06] disabled:opacity-40"
                        >
                          Clear
                        </button>
                        {notifyRecipientQuery.trim() && filteredSelectableRecipients.length > 0 ? (
                          <button
                            type="button"
                            onClick={addFilteredRecipientsToSelection}
                            className="rounded-lg border border-[#6f54ff]/40 bg-[#6f54ff]/15 px-2.5 py-1.5 text-[11px] font-semibold text-[#d4c4ff] hover:bg-[#6f54ff]/25"
                          >
                            Add shown ({filteredSelectableRecipients.length})
                          </button>
                        ) : null}
                        <span className="text-[11px] text-[#c4cbe6] tabular-nums ml-auto">
                          {selectedRecipientIds.length} selected
                        </span>
                      </div>
                      {notifyRecipientQuery.trim() && filteredSelectableRecipients.length < selectableRecipients.length ? (
                        <p className="text-[10px] text-[#5c647e] px-0.5">
                          Showing {filteredSelectableRecipients.length} of {selectableRecipients.length} — Select all still selects everyone.
                        </p>
                      ) : null}
                      <div className="max-h-56 overflow-y-auto space-y-1">
                        {filteredSelectableRecipients.length === 0 ? (
                          <p className="text-xs text-[#7d86a8] px-2 py-3 text-center">No members match your search.</p>
                        ) : (
                          filteredSelectableRecipients.map((member) => {
                            const label = `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.username
                            const selected = selectedRecipientIds.includes(member.id)
                            return (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => toggleSelectedRecipient(member.id)}
                                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors flex items-start gap-3 ${
                                  selected
                                    ? 'border-[#6f54ff] bg-[#221c4a] text-white'
                                    : 'border-white/10 bg-[#151d39] text-[#aeb7d6] hover:border-white/20'
                                }`}
                              >
                                <SelectionCheckbox checked={selected} />
                                <span className="min-w-0 flex-1">
                                  <span className="text-sm font-medium truncate block">{label}</span>
                                  <span className="text-xs text-[#7d86a8] truncate block">@{member.username}</span>
                                </span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
              {audience === 'one' ? (
                <input
                  className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff]"
                  placeholder="Username or user UUID"
                  value={oneUserQuery}
                  onChange={(e) => setOneUserQuery(e.target.value)}
                />
              ) : null}
              <input
                className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff]"
                placeholder="Title"
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
              />
              <textarea
                className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#6f54ff] min-h-24"
                placeholder="Message"
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
              />
              <button
                type="button"
                disabled={
                  notifyBusy ||
                  !notifyTitle.trim() ||
                  !notifyBody.trim() ||
                  (audience === 'selected' && selectedRecipientIds.length === 0) ||
                  (audience === 'labels' && notifyAudienceLabelIds.length === 0)
                }
                onClick={() => void sendMemberNotifications()}
                className="w-full rounded-xl py-2.5 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40"
              >
                {notifyBusy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === 'reports' ? (
          <section className="space-y-3">
            {reports.length === 0 ? (
              <p className="text-sm text-[#7d86a8]">No reports for this business.</p>
            ) : (
              <div className="space-y-2.5">
                {reports.map((report) => (
                  <article key={report.id} className="rounded-2xl border border-white/10 bg-[#0e1528]/90 p-3 shadow-[0_20px_50px_-35px_rgba(30,49,112,0.95)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{report.name}</p>
                      <StatusPill status={report.status} />
                    </div>
                    <p className="text-sm text-[#73a9ff] mt-2">{report.type}</p>
                    <p className="text-[#7d86a8] mt-1">{report.details}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['new', 'in_review', 'resolved'] as const).map((nextStatus) => (
                        <button
                          key={nextStatus}
                          type="button"
                          disabled={reportBusyId === report.id || report.status === nextStatus}
                          onClick={() => void updateReportStatus(report.id, nextStatus)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs capitalize transition-colors disabled:opacity-40 ${
                            report.status === nextStatus
                              ? 'border-[#7e66ff] bg-[#221c4a] text-white'
                              : 'border-white/15 text-[#9ea8cc] hover:text-white hover:border-white/30'
                          }`}
                        >
                          {nextStatus === 'in_review' ? 'In review' : nextStatus}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
          </div>
        </div>
      </main>

      <nav
        className={`relay-footer-bar fixed bottom-0 left-0 right-0 lg:hidden border-t border-white/[0.08] bg-[rgba(9,14,32,0.97)] backdrop-blur-md px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid ${mobileGridClass}`}
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
              }}
              className={`flex flex-col items-center gap-0.5 py-1.5 min-w-0 relative ${
                active ? 'text-[#8d63ff]' : 'text-[#8892b0]'
              }`}
            >
              <span className="relative inline-flex">
                <Icon className="w-[21px] h-[21px] shrink-0" />
                {item.id === 'inbox' && inboxUnreadTotal > 0 ? (
                  <span className="absolute top-1 right-[calc(50%-1.25rem)] min-w-3.5 h-3.5 px-0.5 rounded-full bg-[#ff3b5c] text-white text-[8px] font-bold flex items-center justify-center leading-none tabular-nums border-2 border-[#090e20]">
                    {inboxUnreadTotal > 9 ? '9+' : inboxUnreadTotal}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] font-semibold leading-tight text-center truncate w-full px-0.5">{item.label}</span>
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
  const iconWrap =
    accent === 'yellow'
      ? 'bg-[rgba(246,179,50,0.1)] text-[#f6b332]'
      : accent === 'purple'
        ? 'bg-[rgba(141,99,255,0.1)] text-[#8d63ff]'
        : accent === 'red'
          ? 'bg-[rgba(255,59,92,0.1)] text-[#ff3b5c]'
          : 'bg-[rgba(47,209,127,0.1)] text-[#2fd17f]'
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] p-3 flex items-center gap-2">
      <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 [&_svg]:stroke-current ${iconWrap}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[20px] font-bold leading-none text-white tabular-nums">{value}</p>
        <p className="text-[11px] text-[#8892b0] mt-0.5">{label}</p>
      </div>
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
      className="rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] px-3 py-2.5 flex items-center justify-center gap-2 text-[12px] font-semibold text-[#c4cbe6] hover:text-white hover:border-[rgba(141,99,255,0.3)] hover:bg-[rgba(141,99,255,0.06)] transition-all relative [&_svg]:text-[#8d63ff] [&_svg]:w-[15px] [&_svg]:h-[15px]"
    >
      {typeof badgeCount === 'number' && badgeCount > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#8d63ff] text-white text-[9px] font-bold flex items-center justify-center tabular-nums border-2 border-[#050814]">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      ) : null}
      {icon}
      {label}
    </button>
  )
}

function SelectionCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`mt-0.5 shrink-0 w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center ${
        checked ? 'border-[#a78bfa] bg-[#6f54ff]/35' : 'border-white/30 bg-[#0a1020]'
      }`}
      aria-hidden
    >
      {checked ? <Check className="w-3.5 h-3.5 text-[#ede9fe]" strokeWidth={3} /> : null}
    </span>
  )
}

function AudienceRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full px-3 py-2.5 flex items-center justify-between gap-3">
      <span className="text-left text-sm">{label}</span>
      <span
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
          selected ? 'border-[#a78bfa] bg-[#6f54ff]/40' : 'border-white/25 bg-transparent'
        }`}
      >
        {selected ? <Check className="w-3 h-3 text-[#ede9fe]" strokeWidth={3} /> : null}
      </span>
    </button>
  )
}

function StatusPill({ status }: { status: ReportItem['status'] }) {
  if (status === 'new') return <span className="px-2 py-1 rounded-full text-xs bg-sky-500/20 text-sky-300">New</span>
  if (status === 'in_review')
    return <span className="px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-300">In Review</span>
  return <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-300">Resolved</span>
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CustomerMobileFooterNav } from '@/components/CustomerMobileFooterNav'
import { CustomerRefreshButton } from '@/components/CustomerRefreshButton'
import { Bell, ArrowLeft, Loader2, CheckCheck, Home, User } from 'lucide-react'

type ProfileRow = { id: string; role: 'customer' | 'business'; account_status?: string | null }
type NotificationRow = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  created_at: string
}

function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`
  return new Date(iso).toLocaleDateString()
}

function notificationKind(type: string): 'Post' | 'Reply' | 'Account' {
  if (type === 'support_reply' || type === 'support_reply_reminder' || type === 'support_message') return 'Reply'
  if (type === 'account_approved' || type.includes('account') || type.includes('suspend')) return 'Account'
  return 'Post'
}

function notificationDestination(n: NotificationRow): string | null {
  if (n.type === 'support_reply' || n.type === 'support_reply_reminder' || n.type === 'support_message') {
    return '/feed?openChat=1'
  }
  const link = (n.link || '').trim()
  if (!link || link === '/notifications' || link.startsWith('/notifications?')) return null
  return link
}

function dayBucket(iso: string): 'Today' | 'Earlier' {
  const created = new Date(iso)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return created >= start ? 'Today' : 'Earlier'
}

export default function NotificationsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [listRefreshing, setListRefreshing] = useState(false)
  const [listFilter, setListFilter] = useState<'all' | 'unread'>('all')
  const [portalRole, setPortalRole] = useState<'customer' | 'business' | null>(null)
  const userIdRef = useRef<string | null>(null)

  const load = useCallback(
    async (uid: string) => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, read, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) {
        console.error(error)
        setItems([])
        return
      }
      setItems((data || []) as NotificationRow[])
    },
    [supabase]
  )

  useEffect(() => {
    let cancelled = false

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/login')
        return
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, role, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (error || !prof) {
        router.replace('/login')
        return
      }

      const p = prof as ProfileRow & { deleted_at?: string | null }
      if (p.role !== 'customer' && p.role !== 'business') {
        router.replace('/login')
        return
      }

      if (p.deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }

      if (p.account_status === 'suspended') {
        router.replace('/account-suspended')
        return
      }

      if (p.role === 'customer' && p.account_status !== 'approved') {
        router.replace('/pending-approval')
        return
      }

      setPortalRole(p.role)
      userIdRef.current = session.user.id
      await load(session.user.id)
      if (cancelled) return
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase, load])

  useEffect(() => {
    if (loading) return
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function subscribeRealtime() {
      const { data } = await supabase.auth.getSession()
      const uid = data.session?.user?.id
      if (!uid || !active) return
      channel = supabase
        .channel(`notifications-${uid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
          (payload) => {
            const row = payload.new as NotificationRow
            if (!row?.id) return
            setItems((prev) => {
              if (prev.some((n) => n.id === row.id)) return prev
              return [row, ...prev].slice(0, 100)
            })
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
          (payload) => {
            const row = payload.new as NotificationRow
            if (!row?.id) return
            setItems((prev) => prev.map((n) => (n.id === row.id ? { ...n, ...row } : n)))
          }
        )
        .subscribe()
    }

    void subscribeRealtime()

    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [loading, supabase, load])

  useEffect(() => {
    if (loading) return
    let timer: number | null = null
    let mounted = true

    const tick = async () => {
      if (!mounted || document.visibilityState !== 'visible') return
      const { data } = await supabase.auth.getSession()
      const uid = data.session?.user?.id
      if (uid) await load(uid)
    }

    timer = window.setInterval(() => {
      void tick()
    }, 45_000)
    void tick()

    return () => {
      mounted = false
      if (timer) window.clearInterval(timer)
    }
  }, [loading, supabase, load])

  async function refreshList() {
    const uid = userIdRef.current
    if (!uid || listRefreshing) return
    setListRefreshing(true)
    try {
      await load(uid)
    } finally {
      setListRefreshing(false)
    }
  }

  async function openNotification(n: NotificationRow) {
    if (!n.read) await markOne(n.id)
    const href = notificationDestination(n)
    if (href) router.push(href)
  }

  async function markOne(id: string) {
    setBusy(id)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('user_id', user.id)
      if (error) throw error
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(null)
    }
  }

  async function markAll() {
    setBusy('all')
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const ids = items.filter((n) => !n.read).map((n) => n.id)
      if (ids.length === 0) return
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', ids)
        .eq('user_id', user.id)
      if (error) throw error
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="relay-customer-dark relay-lobby min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#e7b84a]" />
      </div>
    )
  }

  const customerChrome = portalRole !== 'business'

  const unreadCount = items.filter((n) => !n.read).length
  const homeHref = portalRole === 'business' ? '/dashboard' : '/feed'
  const visibleItems = listFilter === 'unread' ? items.filter((n) => !n.read) : items
  const grouped = (['Today', 'Earlier'] as const)
    .map((label) => ({
      label,
      rows: visibleItems.filter((n) => dayBucket(n.created_at) === label),
    }))
    .filter((group) => group.rows.length > 0)

  return (
    <div className={`relay-customer-dark min-h-screen pb-28 ${customerChrome ? 'relay-lobby text-[#fff8ee]' : 'bg-[#070b16] text-white'}`}>
      <header className={`sticky top-0 z-40 border-b ${customerChrome ? 'border-[#edc06e]/25 bg-[#120e1c]/80 backdrop-blur-md' : 'border-white/[0.08] bg-[#070b16]'}`}>
        <div className="max-w-3xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(homeHref)}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className={`w-5 h-5 ${customerChrome ? 'text-[#f9d587]' : 'text-[#b8c0dc]'}`} />
          </button>
          <h1 className={customerChrome ? 'relay-gold-type text-lg font-semibold tracking-tight' : 'font-semibold text-white'}>Notifications</h1>
          {unreadCount > 0 ? (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b5c] text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <CustomerRefreshButton
              variant="plain"
              tone={customerChrome ? 'gold' : 'violet'}
              busy={listRefreshing}
              onRefresh={refreshList}
              aria-label="Refresh notifications"
            />
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={busy === 'all' || unreadCount === 0}
              className={`text-sm font-medium disabled:opacity-40 px-2 py-1 ${customerChrome ? 'text-[#f0c86a]' : 'text-[#c4b5fd]'}`}
            >
              {busy === 'all' ? 'Marking...' : 'Mark all read'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        <div className="mb-4 flex gap-2">
          {(['all', 'unread'] as const).map((key) => {
            const active = listFilter === key
            const label = key === 'all' ? 'All' : 'Unread'
            return (
              <button
                key={key}
                type="button"
                onClick={() => setListFilter(key)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  active
                    ? customerChrome
                      ? 'bg-gradient-to-b from-[#fff6d4] to-[#c9922e] text-[#3a2508]'
                      : 'bg-[#8d63ff] text-white'
                    : customerChrome
                      ? 'bg-white/5 text-[#e4d8f0]'
                      : 'bg-white/5 text-[#b8c0dc]'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        {items.length === 0 ? (
          <div className="px-2 py-16 text-center">
            <p className={`font-semibold ${customerChrome ? 'text-[#fff6e8]' : 'text-white'}`}>You are caught up</p>
            <p className={`text-sm mt-2 ${customerChrome ? 'text-[#cbb89a]' : 'text-[#9aa3c2]'}`}>When the team posts or replies, it will show up here.</p>
            <Link
              href={homeHref}
              className={`inline-flex mt-4 rounded-full px-4 py-2 text-sm font-semibold ${
                customerChrome
                  ? 'bg-gradient-to-b from-[#fff6d4] to-[#c9922e] text-[#3a2508]'
                  : 'bg-[#8d63ff] text-white'
              }`}
            >
              Back to home
            </Link>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="px-2 py-16 text-center">
            <p className={`font-semibold ${customerChrome ? 'text-[#fff6e8]' : 'text-white'}`}>No unread notifications</p>
            <button
              type="button"
              onClick={() => setListFilter('all')}
              className={`mt-4 text-sm font-semibold ${customerChrome ? 'text-[#f0c86a]' : 'text-[#c4b5fd]'}`}
            >
              Show all
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <section key={group.label}>
                <h2 className={`px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] ${customerChrome ? 'text-[#e7c373]' : 'text-[#8f9ab8]'}`}>
                  {group.label}
                </h2>
                <div className="divide-y divide-white/[0.08]">
                  {group.rows.map((n) => {
                    const kind = notificationKind(n.type)
                    return (
                      <div key={n.id} className="flex items-start gap-3 py-3">
                        <button
                          type="button"
                          onClick={() => void openNotification(n)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-semibold uppercase tracking-wide ${customerChrome ? 'text-[#f0c86a]' : 'text-[#c4b5fd]'}`}>
                              {kind}
                            </span>
                            {!n.read ? <span className={`w-1.5 h-1.5 rounded-full ${customerChrome ? 'bg-[#e7b84a]' : 'bg-[#8d63ff]'}`} /> : null}
                            <span className={`ml-auto text-xs ${customerChrome ? 'text-[#cbb89a]' : 'text-[#7f8bad]'}`}>{timeAgo(n.created_at)}</span>
                          </div>
                          <h3 className={`mt-1 ${
                            n.read
                              ? customerChrome
                                ? 'font-medium text-[#e4d8f0]'
                                : 'font-medium text-[#d5dbed]'
                              : customerChrome
                                ? 'font-semibold text-[#fff6e8]'
                                : 'font-semibold text-white'
                          }`}>
                            {n.title}
                          </h3>
                          {n.body ? (
                            <p className={`text-sm mt-0.5 line-clamp-2 whitespace-pre-wrap ${customerChrome ? 'text-[#cbb89a]' : 'text-[#9aa3c2]'}`}>{n.body}</p>
                          ) : null}
                        </button>
                        {!n.read ? (
                          <button
                            type="button"
                            onClick={() => void markOne(n.id)}
                            disabled={busy === n.id}
                            className={`p-1 rounded ${customerChrome ? 'text-[#cbb89a] hover:text-[#f0c86a]' : 'text-[#7f8bad] hover:text-[#c4b5fd]'}`}
                            aria-label="Mark as read"
                          >
                            {busy === n.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCheck className="w-4 h-4" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {portalRole === 'customer' ? (
        <CustomerMobileFooterNav
          unreadNotifications={unreadCount}
          isLight={false}
          tone="gold"
          onChatClick={() => router.push('/feed?openChat=1')}
        />
      ) : (
        <nav
          className="relay-footer-bar fixed bottom-0 left-0 right-0 z-30 flex border-t border-white/[0.08] bg-[#090e20]/96 backdrop-blur-[16px] min-[900px]:hidden"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)', paddingTop: '6px' }}
          aria-label="Primary"
        >
          <Link
            href={homeHref}
            prefetch={false}
            className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-center text-[9px] font-semibold leading-tight text-[#8892b0]"
          >
            <Home className="w-[22px] h-[22px]" strokeWidth={2} />
            Home
          </Link>
          <Link
            href="/notifications"
            className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-center text-[9px] font-semibold leading-tight text-[#8d63ff]"
          >
            <Bell className="w-[22px] h-[22px]" strokeWidth={2} />
            {unreadCount > 0 ? (
              <span className="absolute top-0.5 right-[calc(50%-1.125rem)] h-2 w-2 rounded-full bg-[#ff3b5c] ring-2 ring-[#090e20]" />
            ) : null}
            Notifications
          </Link>
          <Link
            href="/profile"
            className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-center text-[9px] font-semibold leading-tight text-[#8892b0]"
          >
            <User className="w-[22px] h-[22px]" strokeWidth={2} />
            Profile
          </Link>
        </nav>
      )}
    </div>
  )
}

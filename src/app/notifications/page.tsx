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

export default function NotificationsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [listRefreshing, setListRefreshing] = useState(false)
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
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const unreadCount = items.filter((n) => !n.read).length
  const homeHref = portalRole === 'business' ? '/dashboard' : '/feed'

  return (
    <div className="min-h-screen bg-[#050814] pb-28 text-white">
      <header className="sticky top-0 z-40 bg-[#0b1020]/95 border-b border-white/10 backdrop-blur">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(homeHref)}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-[#b8c0dc]" />
          </button>
          <Bell className="w-5 h-5 text-[#8d63ff]" />
          <h1 className="font-semibold text-white">Notifications</h1>
          <span className="text-xs text-[#7f8bad] ml-1 hidden sm:inline">{unreadCount} unread</span>
          <div className="ml-auto flex items-center gap-1">
            <CustomerRefreshButton
              variant="plain"
              busy={listRefreshing}
              onRefresh={refreshList}
              aria-label="Refresh notifications"
            />
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={busy === 'all' || unreadCount === 0}
              className="text-sm font-medium text-[#8d63ff] disabled:opacity-40 px-2 py-1"
            >
              {busy === 'all' ? 'Marking...' : 'Mark all read'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        {items.length === 0 ? (
          <div className="bg-[#0b1020]/95 rounded-xl border border-white/10 p-10 text-center text-[#8f99b8]">
            No notifications yet.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((n) => (
              <article
                key={n.id}
                className={`bg-[#0b1020]/95 rounded-xl border p-4 transition ${
                  n.read ? 'border-white/10' : 'border-[#8d63ff]/40 shadow-[0_0_0_1px_rgba(141,99,255,0.1)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      n.read ? 'bg-white/5' : 'bg-[#8d63ff]/15'
                    }`}
                  >
                    <Bell className={`w-4 h-4 ${n.read ? 'text-[#6f7896]' : 'text-[#8d63ff]'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white truncate">{n.title}</h2>
                      {!n.read ? <span className="w-2 h-2 rounded-full bg-[#8d63ff]" /> : null}
                    </div>
                    <p className="text-sm text-[#b8c0dc] mt-1 whitespace-pre-wrap">{n.body}</p>
                    <div className="text-xs text-[#7f8bad] mt-2">{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.read ? (
                    <button
                      type="button"
                      onClick={() => void markOne(n.id)}
                      disabled={busy === n.id}
                      className="text-[#7f8bad] hover:text-[#8d63ff] p-1 rounded"
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
              </article>
            ))}
          </div>
        )}
      </main>

      {portalRole === 'customer' ? (
        <CustomerMobileFooterNav
          unreadNotifications={unreadCount}
          isLight={false}
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
            className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold text-[#8892b0]"
          >
            <Home className="w-[22px] h-[22px]" strokeWidth={2} />
            Home
          </Link>
          <Link
            href="/notifications"
            className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold text-[#8d63ff]"
          >
            <Bell className="w-[22px] h-[22px]" strokeWidth={2} />
            {unreadCount > 0 ? (
              <span className="absolute top-0.5 right-[calc(50%-1.125rem)] h-2 w-2 rounded-full bg-[#ff3b5c] ring-2 ring-[#090e20]" />
            ) : null}
            Alerts
          </Link>
          <Link
            href="/profile"
            className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold text-[#8892b0]"
          >
            <User className="w-[22px] h-[22px]" strokeWidth={2} />
            Profile
          </Link>
        </nav>
      )}
    </div>
  )
}

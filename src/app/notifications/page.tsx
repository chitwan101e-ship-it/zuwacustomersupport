'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Bell, ArrowLeft, Loader2, CheckCheck } from 'lucide-react'

type ProfileRow = { id: string; role: 'customer' | 'business' }
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

  const load = useCallback(
    async (uid: string) => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, read, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })

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
        router.replace('/signup')
        return
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', session.user.id)
        .single()

      if (error || !prof) {
        router.replace('/signup')
        return
      }

      if ((prof as ProfileRow).role !== 'customer') {
        router.replace('/dashboard')
        return
      }

      await load(session.user.id)
      if (cancelled) return
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase, load])

  async function markOne(id: string) {
    setBusy(id)
    try {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
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
      const ids = items.filter((n) => !n.read).map((n) => n.id)
      if (ids.length === 0) return
      const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids)
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

  return (
    <div className="min-h-screen bg-[#050814] pb-8 text-white">
      <header className="sticky top-0 z-40 bg-[#0b1020]/95 border-b border-white/10 backdrop-blur">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/feed')}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-[#b8c0dc]" />
          </button>
          <Bell className="w-5 h-5 text-[#8d63ff]" />
          <h1 className="font-semibold text-white">Notifications</h1>
          <span className="text-xs text-[#7f8bad] ml-1">{unreadCount} unread</span>
          <button
            type="button"
            onClick={() => void markAll()}
            disabled={busy === 'all' || unreadCount === 0}
            className="ml-auto text-sm font-medium text-[#8d63ff] disabled:opacity-40"
          >
            {busy === 'all' ? 'Marking...' : 'Mark all read'}
          </button>
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
    </div>
  )
}

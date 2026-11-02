'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { countUnreadStaffMessages } from '@/lib/customerMessaging'
import { Bell, Home, MessageCircle, Scale, User } from 'lucide-react'
import clsx from 'clsx'

type Props = {
  /** When set, unread badge uses this count instead of fetching (e.g. feed page). */
  unreadNotifications?: number
  /** Inbound team messages; when set, footer skips its own poll (e.g. feed page). */
  unreadChatCount?: number
  isLight?: boolean
  onChatClick: () => void
  /** Highlight Chat tab when the messages panel is open (feed only). */
  chatActive?: boolean
  /** Gold chrome on the customer lobby, matching the lucky spin. */
  tone?: 'violet' | 'gold'
}

export function CustomerMobileFooterNav({
  unreadNotifications: unreadProp,
  unreadChatCount: unreadChatProp,
  isLight = false,
  onChatClick,
  chatActive = false,
  tone = 'violet',
}: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [unreadFetched, setUnreadFetched] = useState(0)
  const [chatUnreadFetched, setChatUnreadFetched] = useState(0)

  const refreshUnread = useCallback(async () => {
    if (typeof unreadProp === 'number') return
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user) {
      setUnreadFetched(0)
      return
    }
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('read', false)
    if (error) setUnreadFetched(0)
    else setUnreadFetched(count ?? 0)
  }, [supabase, unreadProp])

  const refreshChatUnread = useCallback(async () => {
    if (typeof unreadChatProp === 'number') return
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user) {
      setChatUnreadFetched(0)
      return
    }
    const { count, error } = await countUnreadStaffMessages(supabase, session.user.id)
    if (error) setChatUnreadFetched(0)
    else setChatUnreadFetched(count)
  }, [supabase, unreadChatProp])

  useEffect(() => {
    if (typeof unreadProp === 'number') return
    void refreshUnread()
    const id = window.setInterval(() => void refreshUnread(), 45_000)
    return () => window.clearInterval(id)
  }, [refreshUnread, unreadProp, pathname])

  useEffect(() => {
    if (typeof unreadChatProp === 'number') return
    void refreshChatUnread()
    const id = window.setInterval(() => void refreshChatUnread(), 45_000)
    return () => window.clearInterval(id)
  }, [refreshChatUnread, unreadChatProp, pathname])

  const unread = typeof unreadProp === 'number' ? unreadProp : unreadFetched
  const chatUnread = typeof unreadChatProp === 'number' ? unreadChatProp : chatUnreadFetched
  const hasChatUnread = chatUnread > 0

  const feedActive = pathname === '/feed'
  const rulesActive = pathname === '/rules'
  const alertsActive = pathname.startsWith('/notifications')
  const profileActive = pathname.startsWith('/profile')

  const gold = tone === 'gold' && !isLight
  const muted = isLight ? 'text-slate-500' : gold ? 'text-[#9a8668]' : 'text-[#8892b0]'
  const accent = isLight ? 'text-violet-700' : gold ? 'text-[#f8e7b4]' : 'text-[#c4b5fd]'
  const badgeRing = isLight ? 'ring-white' : gold ? 'ring-[#16111f]' : 'ring-[#090e20]'
  const activeWash = isLight ? 'bg-violet-100' : gold ? 'bg-[#f0c86a]/20' : 'bg-[#8d63ff]/20'

  function goChatFromOtherPage() {
    router.push('/feed?openChat=1')
  }

  function tabClass(active: boolean) {
    return clsx(
      'relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5',
      active ? accent : muted
    )
  }

  function iconWell(active: boolean) {
    return clsx(
      'relative flex h-7 w-11 items-center justify-center rounded-full transition-colors',
      active && activeWash
    )
  }

  function labelClass() {
    return 'max-w-full truncate px-0.5 text-[10px] font-semibold leading-none tracking-[0.01em]'
  }

  function CountBadge({ count }: { count: number }) {
    if (count <= 0) return null
    return (
      <span
        className={clsx(
          'absolute -right-2 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#ff3b5c] px-1 text-[8px] font-bold leading-none text-white ring-2',
          badgeRing
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
    )
  }

  const navWrap = clsx(
    'relay-footer-bar fixed bottom-0 left-0 right-0 z-30 flex border-t px-1 backdrop-blur-xl min-[900px]:hidden',
    isLight
      ? 'border-slate-200 bg-white/96'
      : gold
        ? 'border-[#e7c373]/40 bg-[#16111f]/95 shadow-[0_-12px_28px_rgba(0,0,0,0.45)]'
        : 'border-white/[0.08] bg-[#090e20]/96'
  )

  return (
    <nav
      className={navWrap}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)' }}
      aria-label="Primary"
    >
      <Link href="/feed" className={tabClass(feedActive)} aria-current={feedActive ? 'page' : undefined}>
        <span className={iconWell(feedActive)}>
          <Home className="h-[22px] w-[22px]" strokeWidth={feedActive ? 2.4 : 1.75} />
        </span>
        <span className={labelClass()}>Feed</span>
      </Link>
      <Link href="/rules" className={tabClass(rulesActive)} aria-current={rulesActive ? 'page' : undefined}>
        <span className={iconWell(rulesActive)}>
          <Scale className="h-[22px] w-[22px]" strokeWidth={rulesActive ? 2.4 : 1.75} />
        </span>
        <span className={labelClass()}>Rules</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          if (pathname === '/feed') onChatClick()
          else void goChatFromOtherPage()
        }}
        className={tabClass(chatActive)}
        aria-label={hasChatUnread ? `Chat, ${chatUnread} unread from team` : 'Chat'}
        aria-current={chatActive ? 'page' : undefined}
      >
        <span className={iconWell(chatActive)}>
          <MessageCircle className="h-[22px] w-[22px]" strokeWidth={chatActive ? 2.4 : 1.75} />
          <CountBadge count={chatUnread} />
        </span>
        <span className={labelClass()}>Chat</span>
      </button>
      <Link
        href="/notifications"
        className={tabClass(alertsActive)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-current={alertsActive ? 'page' : undefined}
      >
        <span className={iconWell(alertsActive)}>
          <Bell className="h-[22px] w-[22px]" strokeWidth={alertsActive ? 2.4 : 1.75} />
          <CountBadge count={unread} />
        </span>
        <span className={labelClass()}>Alerts</span>
      </Link>
      <Link
        href="/profile"
        className={tabClass(profileActive)}
        aria-current={profileActive ? 'page' : undefined}
      >
        <span className={iconWell(profileActive)}>
          <User className="h-[22px] w-[22px]" strokeWidth={profileActive ? 2.4 : 1.75} />
        </span>
        <span className={labelClass()}>Profile</span>
      </Link>
    </nav>
  )
}

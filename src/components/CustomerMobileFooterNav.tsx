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
}

export function CustomerMobileFooterNav({
  unreadNotifications: unreadProp,
  unreadChatCount: unreadChatProp,
  isLight = false,
  onChatClick,
  chatActive = false,
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

  const muted = isLight ? 'text-slate-500' : 'text-[#8892b0]'
  const accent = isLight ? 'text-violet-600' : 'text-[#8d63ff]'

  function goChatFromOtherPage() {
    router.push('/feed?openChat=1')
  }

  const navWrap = clsx(
    'relay-footer-bar fixed bottom-0 left-0 right-0 z-30 flex border-t backdrop-blur-[16px] min-[900px]:hidden',
    isLight ? 'border-slate-200 bg-white/96' : 'border-white/[0.08] bg-[#090e20]/96'
  )

  return (
    <nav
      className={navWrap}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)', paddingTop: '6px' }}
      aria-label="Primary"
    >
      <Link
        href="/feed"
        className={clsx(
          'relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold',
          feedActive ? accent : muted
        )}
      >
        <Home className="h-[22px] w-[22px]" strokeWidth={2} />
        Feed
      </Link>
      <Link
        href="/rules"
        className={clsx(
          'relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold',
          rulesActive ? accent : muted
        )}
      >
        <Scale className="h-[22px] w-[22px]" strokeWidth={2} />
        Rules
      </Link>
      <button
        type="button"
        onClick={() => {
          if (pathname === '/feed') onChatClick()
          else void goChatFromOtherPage()
        }}
        className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold"
        aria-label={hasChatUnread ? `Chat, ${chatUnread} unread from team` : 'Chat'}
      >
        <MessageCircle
          className={clsx(
            'h-[22px] w-[22px]',
            hasChatUnread ? 'text-[#ff3b5c]' : chatActive ? accent : muted
          )}
          strokeWidth={hasChatUnread ? 2.25 : 2}
        />
        {hasChatUnread ? (
          <span
            className={clsx(
              'absolute top-0.5 right-[calc(50%-1.125rem)] h-2 w-2 rounded-full bg-[#ff3b5c] ring-2',
              isLight ? 'ring-white' : 'ring-[#090e20]'
            )}
          />
        ) : null}
        <span className={clsx(chatActive ? accent : muted)}>Chat</span>
      </button>
      <Link
        href="/notifications"
        className={clsx(
          'relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold',
          alertsActive ? accent : muted
        )}
      >
        <Bell className="h-[22px] w-[22px]" strokeWidth={2} />
        {unread > 0 ? (
          <span
            className={clsx(
              'absolute top-0.5 right-[calc(50%-1.125rem)] h-2 w-2 rounded-full bg-[#ff3b5c] ring-2',
              isLight ? 'ring-white' : 'ring-[#090e20]'
            )}
          />
        ) : null}
        Alerts
      </Link>
      <Link
        href="/profile"
        className={clsx(
          'flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold',
          profileActive ? accent : muted
        )}
      >
        <User className="h-[22px] w-[22px]" strokeWidth={2} />
        Profile
      </Link>
    </nav>
  )
}

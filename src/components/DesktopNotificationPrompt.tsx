'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import {
  desktopNotifySupported,
  getDesktopNotifyPermission,
  isDesktopNotifyEnabled,
  isDesktopNotifyPromptDismissed,
  requestDesktopNotifyPermission,
  dismissDesktopNotifyPrompt,
  type DesktopNotifyPermission,
} from '@/lib/desktopNotifications'

type Props = {
  variant: 'staff' | 'customer'
  isLight?: boolean
}

export function DesktopNotificationPrompt({ variant, isLight = false }: Props) {
  const [permission, setPermission] = useState<DesktopNotifyPermission>('default')
  const [busy, setBusy] = useState(false)

  const sync = useCallback(() => {
    setPermission(getDesktopNotifyPermission())
  }, [])

  useEffect(() => {
    sync()
  }, [sync])

  if (!desktopNotifySupported()) return null
  if (isDesktopNotifyEnabled()) {
    return (
      <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-[#5c647e]'}`}>
        Desktop alerts are on — corner popups for new messages and signup requests.
      </p>
    )
  }
  if (isDesktopNotifyPromptDismissed()) return null

  const label =
    variant === 'staff'
      ? 'Enable message alerts'
      : 'Enable reply alerts'

  const deniedHint =
    permission === 'denied'
      ? 'Blocked in browser — allow notifications for this site in site settings.'
      : null

  async function onEnable() {
    setBusy(true)
    try {
      const p = await requestDesktopNotifyPermission()
      setPermission(p)
      sync()
    } finally {
      setBusy(false)
    }
  }

  function onDismiss() {
    dismissDesktopNotifyPrompt()
  }

  const shell = isLight
    ? 'border-slate-200/90 bg-slate-50 text-slate-700'
    : 'border-white/[0.08] bg-white/[0.04] text-[#aeb7d6]'
  const btn = isLight
    ? 'bg-slate-900 text-white hover:bg-slate-800'
    : 'bg-[#8d63ff] text-white hover:bg-[#9d73ff]'

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[11px] ${shell}`}>
      <BellRing className="w-3.5 h-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1 leading-snug">
        {deniedHint ??
          'For staff on a laptop: corner popup for each new customer message and signup request (keep this tab open in Chrome/Edge).'}
      </span>
      {permission !== 'denied' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onEnable()}
          className={`shrink-0 rounded-[8px] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${btn}`}
        >
          {busy ? '…' : label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-[10px] opacity-60 hover:opacity-100 underline"
      >
        Not now
      </button>
    </div>
  )
}

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
  sendTestDesktopNotification,
  type DesktopNotifyPermission,
} from '@/lib/desktopNotifications'

type Props = {
  variant: 'staff' | 'customer'
  isLight?: boolean
  /** Sidebar footer card — stacked layout for narrow columns. */
  layout?: 'inline' | 'sidebar'
}

export function DesktopNotificationPrompt({ variant, isLight = false, layout = 'inline' }: Props) {
  const [permission, setPermission] = useState<DesktopNotifyPermission>('default')
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const isSidebar = layout === 'sidebar'

  const sync = useCallback(() => {
    setPermission(getDesktopNotifyPermission())
    setDismissed(isDesktopNotifyPromptDismissed())
  }, [])

  useEffect(() => {
    sync()
  }, [sync])

  function onSendTestAlert() {
    setTestStatus('idle')
    setTestMessage(null)
    const result = sendTestDesktopNotification()
    if (result.ok) {
      setTestStatus('ok')
      setTestMessage(
        isSidebar
          ? 'Test sent — check the corner of your screen.'
          : 'Test sent — check the bottom-right corner of Windows (or Action Center).'
      )
      window.setTimeout(() => {
        setTestStatus('idle')
        setTestMessage(null)
      }, 8000)
      return
    }
    setTestStatus('fail')
    setTestMessage(result.reason ?? 'Could not show test alert.')
  }

  if (!desktopNotifySupported()) return null

  const shell = isLight
    ? 'border-slate-200/90 bg-slate-50 text-slate-700'
    : 'border-white/[0.08] bg-white/[0.04] text-[#aeb7d6]'
  const btn = isLight
    ? 'bg-slate-900 text-white hover:bg-slate-800'
    : 'bg-[#8d63ff] text-white hover:bg-[#9d73ff]'
  const muted = isLight ? 'text-slate-500' : 'text-[#8892b0]'
  const accent = isLight ? 'text-slate-600 hover:text-slate-900' : 'text-[#8d63ff] hover:text-[#a78bff]'

  if (isDesktopNotifyEnabled()) {
    if (isSidebar) {
      return (
        <div className={`rounded-xl border px-3 py-2.5 ${shell}`}>
          <div className="flex items-center gap-2">
            <BellRing className="w-3.5 h-3.5 shrink-0 text-emerald-400/90" aria-hidden />
            <p className={`text-[11px] font-medium ${isLight ? 'text-slate-700' : 'text-[#c4cbe6]'}`}>
              Desktop alerts on
            </p>
          </div>
          <button
            type="button"
            onClick={onSendTestAlert}
            className={`mt-1.5 text-[10px] font-semibold underline underline-offset-2 ${accent}`}
          >
            Send test alert
          </button>
          {testMessage ? (
            <p
              className={`mt-1 text-[10px] leading-snug ${
                testStatus === 'ok'
                  ? isLight
                    ? 'text-emerald-700'
                    : 'text-emerald-300/90'
                  : isLight
                    ? 'text-red-700'
                    : 'text-red-300/90'
              }`}
              role="status"
            >
              {testMessage}
            </p>
          ) : null}
        </div>
      )
    }

    return (
      <div className="space-y-1.5">
        <p className={`text-[10px] ${muted}`}>
          Desktop alerts are on — corner popups for new customer messages and signup requests.
        </p>
        <button
          type="button"
          onClick={onSendTestAlert}
          className={`text-[10px] font-semibold underline underline-offset-2 ${accent}`}
        >
          Send test alert
        </button>
        {testMessage ? (
          <p
            className={`text-[10px] leading-snug ${
              testStatus === 'ok'
                ? isLight
                  ? 'text-emerald-700'
                  : 'text-emerald-300/90'
                : isLight
                  ? 'text-red-700'
                  : 'text-red-300/90'
            }`}
            role="status"
          >
            {testMessage}
          </p>
        ) : null}
      </div>
    )
  }

  if (dismissed) return null

  const label = variant === 'staff' ? 'Enable message alerts' : 'Enable reply alerts'
  const title = variant === 'staff' ? 'Desktop alerts' : 'Reply alerts'
  const description =
    variant === 'staff'
      ? 'Popup when customers message or sign up. Keep this tab open in Chrome or Edge.'
      : 'Popup when staff replies to your message.'

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
    setDismissed(true)
  }

  if (isSidebar) {
    return (
      <div className={`rounded-xl border px-3 py-2.5 ${shell}`}>
        <div className="flex items-start gap-2">
          <BellRing className="mt-0.5 w-3.5 h-3.5 shrink-0 opacity-80" aria-hidden />
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold ${isLight ? 'text-slate-800' : 'text-white'}`}>{title}</p>
            <p className={`mt-1 text-[10px] leading-relaxed ${muted}`}>{deniedHint ?? description}</p>
          </div>
        </div>
        {permission !== 'denied' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onEnable()}
            className={`mt-2.5 w-full rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${btn}`}
          >
            {busy ? '…' : label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className={`mt-2 w-full text-center text-[10px] ${muted} hover:opacity-100`}
        >
          Not now
        </button>
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[11px] ${shell}`}>
      <BellRing className="w-3.5 h-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1 leading-snug">{deniedHint ?? description}</span>
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

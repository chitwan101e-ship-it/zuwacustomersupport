/** Browser corner popups for new message alerts (no native app). */

const ENABLED_KEY = 'relay-desktop-notify-enabled'
const DISMISSED_KEY = 'relay-desktop-notify-dismissed'

export type DesktopNotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export function desktopNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getDesktopNotifyPermission(): DesktopNotifyPermission {
  if (!desktopNotifySupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return 'default'
}

/** True when the browser allows corner popups (permission is enough — no extra toggle). */
export function isDesktopNotifyEnabled(): boolean {
  return getDesktopNotifyPermission() === 'granted'
}

export function setDesktopNotifyEnabled(on: boolean): void {
  if (typeof window === 'undefined') return
  if (on) {
    window.localStorage.setItem(ENABLED_KEY, '1')
    window.localStorage.removeItem(DISMISSED_KEY)
  } else {
    window.localStorage.removeItem(ENABLED_KEY)
  }
}

export function isDesktopNotifyPromptDismissed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(DISMISSED_KEY) === '1'
}

export function dismissDesktopNotifyPrompt(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DISMISSED_KEY, '1')
}

export async function requestDesktopNotifyPermission(): Promise<DesktopNotifyPermission> {
  if (!desktopNotifySupported()) return 'unsupported'
  const result = await Notification.requestPermission()
  if (result === 'granted') {
    setDesktopNotifyEnabled(true)
    showDesktopNotification({
      title: 'Relay alerts on',
      body: 'You will get a corner popup for each new message and signup request.',
    })
  }
  return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'default'
}

export function showDesktopNotification(opts: {
  title: string
  body: string
  tag?: string
  onClick?: () => void
}): void {
  if (!desktopNotifySupported() || Notification.permission !== 'granted') return

  const icon = `${window.location.origin}/favicon.svg`
  const n = new Notification(opts.title, {
    body: opts.body,
    icon,
    tag: opts.tag,
  })

  n.onclick = () => {
    window.focus()
    n.close()
    opts.onClick?.()
  }
}

export function messagePreview(body: string, hasImage?: boolean): string {
  const t = body.trim()
  if (t) return t.length > 160 ? `${t.slice(0, 157)}…` : t
  return hasImage ? '📷 Image' : 'New message'
}

/** e.g. "James message" for staff desktop popups when a customer texts. */
export function customerMessagePopupTitle(
  senderLabel: string | null | undefined,
  fallback = 'New message'
): string {
  const trimmed = senderLabel?.trim()
  if (!trimmed) return fallback
  const first = trimmed.split(/\s+/)[0] || trimmed
  return `${first} message`
}

import { NextResponse } from 'next/server'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const siteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim()
  const secret = (process.env.TURNSTILE_SECRET_KEY ?? '').trim()
  const resendKey = (process.env.RESEND_API_KEY ?? '').trim()
  const resendFrom = (process.env.RESEND_FROM_EMAIL ?? '').trim()

  let challengesApiReachable = false
  let challengesApiError: string | null = null
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/api.js', {
      method: 'HEAD',
      signal: ctrl.signal,
    })
    clearTimeout(timeout)
    challengesApiReachable = r.ok
  } catch (e) {
    challengesApiReachable = false
    challengesApiError = e instanceof Error ? e.message : 'fetch failed'
  }

  return NextResponse.json({
    env: process.env.NODE_ENV,
    hasSiteKey: Boolean(siteKey),
    siteKeyPrefix: siteKey ? `${siteKey.slice(0, 6)}...` : null,
    hasSecretKey: Boolean(secret),
    secretPrefix: secret ? `${secret.slice(0, 6)}...` : null,
    hasResendApiKey: Boolean(resendKey),
    resendKeyPrefix: resendKey ? `${resendKey.slice(0, 6)}...` : null,
    resendFromEmail: resendFrom || null,
    challengesApiReachable,
    challengesApiError,
    hint:
      !siteKey || !secret
        ? 'Restart dev server from project root after editing .env.local. Keys load only at startup.'
        : !challengesApiReachable
          ? 'Server cannot reach challenges.cloudflare.com (firewall/VPN/DNS). Browser widget will also fail.'
          : 'Env OK from server; if widget still blank, check browser URL hostname vs Turnstile hostnames and widget mode (use Managed, not Invisible).',
  })
}

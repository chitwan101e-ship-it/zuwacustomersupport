/**
 * Cloudflare Turnstile server-side verification.
 * Set TURNSTILE_SECRET_KEY in production. When unset, verification is skipped (local dev).
 */

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteip?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return { ok: true }

  if (!token?.trim()) {
    return { ok: false, error: 'Complete the security verification below.' }
  }

  const body = new URLSearchParams()
  body.set('secret', secret)
  body.set('response', token.trim())
  if (remoteip && remoteip !== 'unknown') body.set('remoteip', remoteip)

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await res.json()) as { success?: boolean }
  if (data.success === true) return { ok: true }

  return { ok: false, error: 'Security check failed. Refresh and try again.' }
}

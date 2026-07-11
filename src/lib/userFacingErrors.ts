/** True when running a local / non-production build. */
export const isDev = process.env.NODE_ENV === 'development'

export const TURNSTILE_LOAD_ERROR = isDev
  ? 'Security widget failed to load. Try: allowlist challenges.cloudflare.com, use http://localhost:3000 (not 127.0.0.1 unless added in Cloudflare), disable extensions, restart npm run dev.'
  : 'Security check could not load. Refresh the page or try again in a few minutes.'

export const TURNSTILE_WIDGET_ERROR = 'Security widget error. Refresh and try again.'

export const OTP_SEND_CONFIG_ERROR = isDev
  ? 'OTP email provider is not configured. Set RESEND_API_KEY in .env.local and restart the dev server.'
  : 'Email verification is temporarily unavailable. Please try again later or contact support.'

export const OTP_RESEND_KEY_ERROR = isDev
  ? 'Resend rejected the API key (invalid or revoked). Create a new key at resend.com, put it in RESEND_API_KEY in .env.local, then restart npm run dev.'
  : 'Email verification is temporarily unavailable. Please try again later or contact support.'

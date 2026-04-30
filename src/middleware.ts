import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'jbcoms.com'
const APP_PATH_PREFIXES = [
  '/signup',
  '/login',
  '/feed',
  '/profile',
  '/notifications',
  '/dashboard',
  '/pending-approval',
  '/account-suspended',
  '/api',
]

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone()
  const hostname = req.headers.get('host') || ''

  // Strip port for local dev
  const host = hostname.replace(/:.*/, '')

  // Determine subdomain
  const isRootDomain = host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === 'localhost'
  const subdomain = isRootDomain
    ? null
    : host.endsWith(`.${ROOT_DOMAIN}`)
      ? host.slice(0, -(ROOT_DOMAIN.length + 1))
      : host.includes('localhost')
        ? host.split('.')[0] !== 'localhost' ? host.split('.')[0] : null
        : null

  // ── Subdomain request: rewrite to /business/[slug]/... only for public business pages
  // Keep app routes (/feed, /profile, etc.) on their original paths.
  const isAppPath = APP_PATH_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))
  if (subdomain && subdomain !== 'www' && !isAppPath) {
    // Rewrite so Next.js serves /business/[slug]/... routes
    url.pathname = `/business/${subdomain}${url.pathname}`
    const res = NextResponse.rewrite(url)
    return withSupabaseSession(req, res)
  }

  // ── Root domain: normal routing ────────────────────────────────────────────
  return withSupabaseSession(req, NextResponse.next())
}

// Refresh Supabase session cookie on every request
function withSupabaseSession(req: NextRequest, res: NextResponse) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Allow local UI rendering before environment variables are configured.
  if (!supabaseUrl || !supabaseAnonKey) return res

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
          })
        },
      },
    }
  )
  // Trigger session refresh (fire-and-forget; cookies already set above)
  supabase.auth.getUser()
  return res
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

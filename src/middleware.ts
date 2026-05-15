import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'jbcoms.com'
const APP_PATH_PREFIXES = [
  '/signup',
  '/login',
  '/reset-password',
  '/feed',
  '/rules',
  '/profile',
  '/notifications',
  '/dashboard',
  '/pending-approval',
  '/account-suspended',
  '/auth',
  '/update-password',
  '/business',
  '/api',
]

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone()
  const { pathname } = url

  // Never run auth/session or rewrites on Next internals or public static files. If these requests
  // are handled here (matcher edge cases, *.localhost, etc.), chunk URLs 404 and the app stays blank.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/__nextjs') ||
    pathname === '/favicon.ico' ||
    /\.(?:ico|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot)$/i.test(pathname)
  ) {
    return NextResponse.next({ request: req })
  }

  // Typo recovery: `/fee` has no route → chunk 404s (page.js / layout.css). Send users to the feed.
  if (pathname === '/fee') {
    url.pathname = '/feed'
    return NextResponse.redirect(url)
  }

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
  const isAppPath = APP_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const isNextAsset =
    pathname.startsWith('/_next') || pathname.startsWith('/__nextjs') || pathname === '/favicon.ico'
  if (subdomain && subdomain !== 'www' && !isAppPath && !isNextAsset) {
    // Rewrite so Next.js serves /business/[slug]/... routes
    url.pathname = `/business/${subdomain}${pathname}`
    const res = NextResponse.rewrite(url, { request: req })
    return await withSupabaseSession(req, res)
  }

  // ── Root domain: normal routing ────────────────────────────────────────────
  return await withSupabaseSession(req, NextResponse.next({ request: req }))
}

// Refresh Supabase session cookie on every request (must await; failures must not 500 the app).
async function withSupabaseSession(req: NextRequest, res: NextResponse) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Allow local UI rendering before environment variables are configured.
  if (!supabaseUrl || !supabaseAnonKey) return res

  // Next.js prefetches RSC payloads in the background (fetchServerResponse). Awaiting Supabase
  // session refresh on those requests competes with real traffic and often surfaces as dev overlay
  // errors when Supabase is slow or the dev server is busy. Real navigations still run this block.
  const prefetch = req.headers.get('next-router-prefetch') === '1'
  if (prefetch) {
    return res
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          for (const { name, value, options } of cookiesToSet) {
            try {
              res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
            } catch {
              // Invalid cookie metadata from auth refresh should not take the site down.
            }
          }
        },
      },
    })
    // Do not block indefinitely: slow/unreachable Supabase would stall every page and API call.
    await Promise.race([
      supabase.auth.getUser(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 12_000)
      }),
    ])
  } catch {
    // Stale/invalid refresh token or transient Supabase errors — still serve the page.
  }
  return res
}

export const config = {
  matcher: [
    // Match all paths except Next internals and common static assets. Exclude any `/_next…` (not only `/_next/…`) so dev chunks never hit rewrites.
    '/((?!_next|__nextjs|favicon\\.ico|.*\\.(?:ico|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot)$).*)',
  ],
}

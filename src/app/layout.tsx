import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

/** Loaded once from the server layout so client chunks (e.g. /feed) stay smaller — avoids dev ChunkLoadError/timeouts. */
const relayFooter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-relay-footer',
})

export const metadata: Metadata = {
  title: 'Relay',
  description: 'Customer support and announcements platform',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#070a18',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={relayFooter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}

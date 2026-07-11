'use client'

import { Fragment, useMemo } from 'react'
import clsx from 'clsx'

/** http(s) URLs, www., or bare domains like juwabros.com/path */
const LINK_RE =
  /(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|(?<![@\w./])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?!https?)[a-z]{2,}(?:\/[^\s<>"']*)?)/gi

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string }

function isLinkLike(s: string): boolean {
  return (
    /^https?:\/\/.+/i.test(s) ||
    /^www\./i.test(s) ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}/i.test(s)
  )
}

function stripTrailingPunctuation(url: string): { href: string; trailing: string } {
  let href = url
  let trailing = ''
  while (href.length > 4) {
    const m = href.match(/^(.*?)([.,;:!?)\]]+)$/)
    if (!m) break
    const next = m[1]
    if (!isLinkLike(next)) break
    href = next
    trailing = m[2] + trailing
  }
  return { href, trailing }
}

function toHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

export function splitTextWithUrls(text: string): Segment[] {
  if (!text) return [{ kind: 'text', value: '' }]

  const segments: Segment[] = []
  const re = new RegExp(LINK_RE.source, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const start = match.index
    const raw = match[0]
    const { href: trimmed, trailing } = stripTrailingPunctuation(raw)
    const href = toHref(trimmed)

    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) })
    }
    segments.push({ kind: 'link', value: trimmed, href })
    if (trailing) {
      segments.push({ kind: 'text', value: trailing })
    }
    lastIndex = start + raw.length
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) })
  }

  return segments.length ? segments : [{ kind: 'text', value: text }]
}

type Props = {
  text: string
  className?: string
  linkClassName?: string
}

/** Renders plain text with URLs and domains as clickable links. */
export function LinkifiedText({ text, className, linkClassName }: Props) {
  const segments = useMemo(() => splitTextWithUrls(text), [text])

  return (
    <p className={className}>
      {segments.map((seg, i) =>
        seg.kind === 'link' ? (
          <a
            key={`${i}-${seg.href}`}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx('underline underline-offset-2 break-all hover:opacity-90', linkClassName)}
          >
            {seg.value}
          </a>
        ) : (
          <Fragment key={i}>{seg.value}</Fragment>
        )
      )}
    </p>
  )
}

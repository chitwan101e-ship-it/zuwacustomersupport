'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'

type ExpandablePostTextProps = {
  text: string
  className?: string
  /** Tailwind line-clamp count when collapsed (default 5, ~Facebook feed). */
  collapsedLines?: 3 | 4 | 5 | 6
  isLight?: boolean
}

const LINE_CLAMP: Record<3 | 4 | 5 | 6, string> = {
  3: 'line-clamp-3',
  4: 'line-clamp-4',
  5: 'line-clamp-5',
  6: 'line-clamp-6',
}

export function ExpandablePostText({
  text,
  className,
  collapsedLines = 5,
  isLight,
}: ExpandablePostTextProps) {
  const trimmed = text.trim()
  const [expanded, setExpanded] = useState(false)
  const [showToggle, setShowToggle] = useState(false)
  const contentRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el || !trimmed) {
      setShowToggle(false)
      return
    }
    if (expanded) {
      setShowToggle(true)
      return
    }
    setShowToggle(el.scrollHeight > el.clientHeight + 2)
  }, [trimmed, expanded, collapsedLines])

  if (!trimmed) return null

  return (
    <div>
      <p
        ref={contentRef}
        className={clsx(
          'whitespace-pre-wrap break-words',
          className,
          !expanded && LINE_CLAMP[collapsedLines]
        )}
      >
        {trimmed}
      </p>
      {showToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={clsx(
            'mt-1 text-[15px] font-semibold hover:underline',
            isLight ? 'text-slate-600' : 'text-[#9ea8cc]'
          )}
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      ) : null}
    </div>
  )
}

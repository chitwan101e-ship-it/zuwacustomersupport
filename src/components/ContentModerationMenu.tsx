'use client'

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Eye, EyeOff, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

type Props = {
  isHidden?: boolean
  onEdit: () => void
  onHide: () => void
  onDelete: () => void
  busy?: boolean
  className?: string
  /** Light menus sit on the staff post card. Feed keeps the dark menu. */
  tone?: 'dark' | 'light'
}

export function ContentModerationMenu({
  isHidden,
  onEdit,
  onHide,
  onDelete,
  busy,
  className,
  tone = 'dark',
}: Props) {
  const light = tone === 'light'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={
          light
            ? 'rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40'
            : 'rounded-lg p-1.5 text-[#9ea8cc] hover:bg-white/10 hover:text-white disabled:opacity-40'
        }
        aria-label="More actions"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
      </button>
      {open ? (
        <div
          className={`absolute right-0 top-full z-20 mt-1 min-w-[148px] rounded-xl border py-1 shadow-[0_16px_40px_-20px_rgba(15,23,42,0.35)] ${
            light ? 'border-slate-200 bg-white' : 'border-white/10 bg-[#101937] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.85)]'
          }`}
        >
          <MenuBtn
            light={light}
            icon={Pencil}
            label="Edit"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          />
          <MenuBtn
            light={light}
            icon={isHidden ? Eye : EyeOff}
            label={isHidden ? 'Unhide' : 'Hide'}
            onClick={() => {
              setOpen(false)
              onHide()
            }}
          />
          <MenuBtn
            light={light}
            icon={Trash2}
            label="Delete"
            danger
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function MenuBtn({
  icon: Icon,
  label,
  onClick,
  danger,
  light,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  danger?: boolean
  light?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
        light
          ? danger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-slate-700 hover:bg-slate-50'
          : danger
            ? 'text-red-300 hover:bg-red-500/10'
            : 'text-[#dce3f9] hover:bg-white/[0.06]'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {label}
    </button>
  )
}

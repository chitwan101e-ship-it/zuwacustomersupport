'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LUCKY_SLICE_GEOM,
  LUCKY_WHEEL_SLICES,
  ACTIVE_PLAYER_SPIN_NOTE,
  DECIMAL_PRIZE_NOTE,
  formatLuckyPrize,
  LUCKY_SPIN_COOLDOWN_MS,
  isDecimalLuckyPrize,
  isLuckyWinPrize,
  luckySpinSettleAngle,
  luckySpinSettleAngleAt,
  type LuckyWinPrize,
} from '@/lib/luckySpin'

export const LUCKY_SPIN_SNOOZE_KEY = 'relay-lucky-spin-snooze'

type Phase = 'checking' | 'closed' | 'ready' | 'spinning' | 'won'

type SpinAccess = {
  status: 'unknown' | 'allowed' | 'waiting'
  resetsAt: number | null
}

function resetWaitLabel(resetsAt: number, now: number): string {
  const ms = resetsAt - now
  if (ms <= 0) return 'now'
  const totalMinutes = Math.ceil(ms / 60000)
  if (totalMinutes < 60) return totalMinutes === 1 ? '1 minute' : `${totalMinutes} minutes`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`
  if (minutes === 0) return hourLabel
  const minuteLabel = minutes === 1 ? '1 minute' : `${minutes} minutes`
  return `${hourLabel} ${minuteLabel}`
}

const WIN_COLORS = ['#2a2158', '#34286e', '#24315c', '#3a2d78', '#1d2a4d', '#46348a']

/** Words sit on the spoke so a narrow wedge can still hold "TRY AGAIN" or "4". */
function drawSpokeLabel(
  ctx: CanvasRenderingContext2D,
  mid: number,
  center: number,
  anchor: number,
  parts: readonly string[],
  color: string,
  fontWeight: string,
  maxFont: number,
  span: number,
  roomScale = 0.7
) {
  const room = anchor * roomScale
  const gapFor = (size: number) => Math.round(size * 0.3)
  const widthFor = (size: number) => {
    ctx.font = `${fontWeight} ${size}px Inter, sans-serif`
    return parts.reduce((sum, part) => sum + ctx.measureText(part).width, 0) + gapFor(size) * Math.max(0, parts.length - 1)
  }
  let fontSize = maxFont
  while (fontSize > 14 && (widthFor(fontSize) > room || fontSize > anchor * span * 0.72)) fontSize -= 1

  ctx.save()
  ctx.translate(center + Math.cos(mid) * anchor, center + Math.sin(mid) * anchor)
  const turn = Math.PI * 2
  let norm = mid % turn
  if (norm < 0) norm += turn
  ctx.rotate(norm + (Math.cos(norm) < 0 ? Math.PI : 0))
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${fontWeight} ${fontSize}px Inter, sans-serif`
  const gap = gapFor(fontSize)
  const widths = parts.map((part) => ctx.measureText(part).width)
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, parts.length - 1)
  let cursor = -total / 2
  for (let i = 0; i < parts.length; i += 1) {
    ctx.fillText(parts[i], cursor + widths[i] / 2, 0)
    cursor += widths[i] + gap
  }
  ctx.restore()
}

function drawWheel(canvas: HTMLCanvasElement, angle: number, spinning: boolean) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.width
  const center = size / 2
  const radius = center - 36
  ctx.clearRect(0, 0, size, size)

  const rim = ctx.createLinearGradient(0, 0, size, size)
  rim.addColorStop(0, '#fff1c2')
  rim.addColorStop(0.35, '#e2b34a')
  rim.addColorStop(0.7, '#8d63ff')
  rim.addColorStop(1, '#f3d27a')
  ctx.beginPath()
  ctx.arc(center, center, radius + 22, 0, Math.PI * 2)
  ctx.fillStyle = rim
  ctx.fill()

  const bulbCount = 28
  const chase = (performance.now() / (spinning ? 70 : 280)) % bulbCount
  for (let i = 0; i < bulbCount; i += 1) {
    const theta = (i / bulbCount) * Math.PI * 2 - Math.PI / 2
    const bx = center + Math.cos(theta) * (radius + 22)
    const by = center + Math.sin(theta) * (radius + 22)
    const lit = Math.abs(((i - chase) % bulbCount + bulbCount) % bulbCount) < 1.2 || (i + Math.floor(chase)) % 4 === 0
    ctx.beginPath()
    ctx.arc(bx, by, lit ? 7 : 5, 0, Math.PI * 2)
    ctx.fillStyle = lit ? '#fff6d0' : '#6a4a16'
    ctx.shadowColor = lit ? '#ffe08a' : 'transparent'
    ctx.shadowBlur = lit ? 16 : 0
    ctx.fill()
  }
  ctx.shadowBlur = 0

  ctx.beginPath()
  ctx.arc(center, center, radius + 8, 0, Math.PI * 2)
  ctx.fillStyle = '#241808'
  ctx.fill()

  let winColor = 0
  LUCKY_WHEEL_SLICES.forEach((slice, index) => {
    const geom = LUCKY_SLICE_GEOM[index]
    const start = angle + geom.start - Math.PI / 2
    const thin = slice.prize == null
    ctx.beginPath()
    ctx.moveTo(center, center)
    ctx.arc(center, center, radius, start, start + geom.span)
    ctx.closePath()
    if (thin) {
      const gold = ctx.createRadialGradient(center, center, 20, center, center, radius)
      gold.addColorStop(0, '#fff1c2')
      gold.addColorStop(1, '#e0a83a')
      ctx.fillStyle = gold
    } else {
      ctx.fillStyle = WIN_COLORS[winColor++ % WIN_COLORS.length]
    }
    ctx.fill()
    ctx.strokeStyle = '#f6e2a8'
    ctx.lineWidth = thin ? 3 : 2
    ctx.stroke()

    const peg = start + geom.span
    ctx.beginPath()
    ctx.arc(center + Math.cos(peg) * (radius - 2), center + Math.sin(peg) * (radius - 2), 5, 0, Math.PI * 2)
    ctx.fillStyle = '#f8e7b0'
    ctx.fill()

    const mid = start + geom.span / 2
    if (thin) {
      drawSpokeLabel(ctx, mid, center, radius * 0.74, ['TRY', 'AGAIN'], '#3a2508', '800', 22, geom.span, 0.42)
    } else {
      const textRadius = radius * 0.58
      const chord = 2 * textRadius * Math.sin(geom.span / 2) * 0.78
      let fontSize = 34
      ctx.font = `700 ${fontSize}px Inter, sans-serif`
      while (fontSize > 18 && ctx.measureText(slice.label).width > chord) {
        fontSize -= 1
        ctx.font = `700 ${fontSize}px Inter, sans-serif`
      }
      if (ctx.measureText(slice.label).width <= chord) {
        ctx.fillStyle = '#f7f3ff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(slice.label, center + Math.cos(mid) * textRadius, center + Math.sin(mid) * textRadius)
      } else {
        drawSpokeLabel(ctx, mid, center, radius * 0.66, [slice.label], '#f7f3ff', '700', 34, geom.span)
      }
    }
  })
}

export function LuckySpinModal({ chatOpen = false }: { chatOpen?: boolean }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [prize, setPrize] = useState<LuckyWinPrize | null>(null)
  const [tryAgain, setTryAgain] = useState(false)
  const [activePlayer, setActivePlayer] = useState<boolean | null>(null)
  const [notified, setNotified] = useState(true)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const launcherCanvasRef = useRef<HTMLCanvasElement>(null)
  const angleRef = useRef(0)
  const spinLock = useRef(false)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [access, setAccess] = useState<SpinAccess>({ status: 'unknown', resetsAt: null })
  const [now, setNow] = useState(() => Date.now())

  const spinningRef = useRef(false)

  const paint = useCallback((angle: number) => {
    angleRef.current = angle
    const canvas = canvasRef.current
    if (canvas) drawWheel(canvas, angle, spinningRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/customer/lucky-spin', { credentials: 'same-origin' })
        if (cancelled) return
        const data = (await res.json().catch(() => ({}))) as {
          eligible?: boolean
          activePlayer?: boolean
          resetsAt?: string | null
        }
        if (cancelled) return
        if (!res.ok) {
          setAccess({ status: 'unknown', resetsAt: null })
          setPhase('closed')
          return
        }
        const isActivePlayer = data.activePlayer === true
        setActivePlayer(isActivePlayer)
        if (data.eligible === false) {
          const resetsAt = typeof data.resetsAt === 'string' ? Date.parse(data.resetsAt) : NaN
          setAccess({ status: 'waiting', resetsAt: Number.isFinite(resetsAt) ? resetsAt : null })
          setPhase('closed')
          return
        }
        setAccess({ status: 'allowed', resetsAt: null })
        setPhase(isActivePlayer ? 'ready' : 'closed')
      } catch {
        if (!cancelled) setPhase('closed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (phase === 'spinning') return
    let frame = 0
    let angle = 0
    const loop = () => {
      angle += 0.012
      const canvas = launcherCanvasRef.current
      if (canvas) drawWheel(canvas, angle, false)
      frame = window.requestAnimationFrame(loop)
    }
    frame = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(frame)
  }, [phase])

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'spinning') return
    let frame = 0
    const loop = () => {
      if (!spinningRef.current) paint(angleRef.current)
      frame = window.requestAnimationFrame(loop)
    }
    frame = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(frame)
  }, [phase, paint])

  useEffect(() => {
    if (phase === 'checking' || phase === 'closed') return
    const html = document.documentElement
    const prevHtml = html.style.overflow
    const prevBody = document.body.style.overflow
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      document.body.style.overflow = prevBody
    }
  }, [phase])

  useEffect(() => {
    if (access.status !== 'waiting' || access.resetsAt == null) return
    const tick = () => {
      const current = Date.now()
      setNow(current)
      if (access.resetsAt != null && access.resetsAt <= current) {
        setAccess({ status: 'allowed', resetsAt: null })
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [access.status, access.resetsAt])

  function openFromLauncher() {
    setError('')
    if (phase !== 'closed' || access.status === 'unknown') return
    const current = Date.now()
    if (access.status === 'waiting' && (access.resetsAt == null || access.resetsAt > current)) {
      setNow(current)
      setPhase('ready')
      return
    }
    if (access.status === 'waiting') setAccess({ status: 'allowed', resetsAt: null })
    setPhase('ready')
  }

  function snooze() {
    setPhase('closed')
  }

  function finish() {
    setPhase('closed')
  }

  async function spin() {
    if (spinLock.current || phase === 'spinning' || phase === 'won') return
    if (activePlayer === false) return
    if (access.status === 'waiting' && (access.resetsAt == null || access.resetsAt > Date.now())) return
    spinLock.current = true
    spinningRef.current = true
    setError('')
    setTryAgain(false)
    setPhase('spinning')
    let warmup = true
    let warmFrame = 0
    const warm = () => {
      if (!warmup) return
      angleRef.current += 0.42
      paint(angleRef.current)
      warmFrame = requestAnimationFrame(warm)
    }
    warmFrame = requestAnimationFrame(warm)
    try {
      const res = await fetch('/api/customer/lucky-spin', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await res.json().catch(() => ({}))) as {
        code?: string
        tryAgain?: boolean
        prize?: number
        sliceIndex?: number
        receiptId?: string
        notified?: boolean
        resetsAt?: string
        error?: string
      }
      if (data.code === 'inactive_player') {
        warmup = false
        cancelAnimationFrame(warmFrame)
        setActivePlayer(false)
        setPhase('ready')
        return
      }
      if (data.code === 'spin_waiting') {
        warmup = false
        cancelAnimationFrame(warmFrame)
        const resetsAt = typeof data.resetsAt === 'string' ? Date.parse(data.resetsAt) : NaN
        setAccess({
          status: 'waiting',
          resetsAt: Number.isFinite(resetsAt) ? resetsAt : Date.now() + LUCKY_SPIN_COOLDOWN_MS,
        })
        setPhase('ready')
        return
      }
      const sliceIndex = data.sliceIndex
      const slice = typeof sliceIndex === 'number' ? LUCKY_WHEEL_SLICES[sliceIndex] : undefined
      const landedOnTryAgain = data.tryAgain === true && slice?.prize == null
      const landedOnPrize =
        data.tryAgain !== true &&
        data.prize != null &&
        isLuckyWinPrize(data.prize) &&
        slice?.prize != null &&
        Math.abs(slice.prize - data.prize) < 0.001
      if (!res.ok || sliceIndex == null || (!landedOnTryAgain && !landedOnPrize)) {
        throw new Error(data.error || 'The spin did not go through. Try again.')
      }
      warmup = false
      cancelAnimationFrame(warmFrame)
      const startAngle = angleRef.current
      const finalAngle = luckySpinSettleAngle(sliceIndex, startAngle)
      const duration = 6400
      const started = performance.now()
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          const t = Math.min(1, (now - started) / duration)
          paint(luckySpinSettleAngleAt(t, startAngle, finalAngle))
          if (t < 1) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      const resetsAt = typeof data.resetsAt === 'string' ? Date.parse(data.resetsAt) : NaN
      setAccess({
        status: 'waiting',
        resetsAt: Number.isFinite(resetsAt) ? resetsAt : Date.now() + LUCKY_SPIN_COOLDOWN_MS,
      })
      if (landedOnTryAgain) {
        setPrize(null)
        setTryAgain(true)
        setReceiptId(null)
        setPhase('won')
      } else {
        setTryAgain(false)
        setPrize(data.prize ?? null)
        setReceiptId(data.receiptId ?? null)
        setNotified(data.notified !== false)
        setPhase('won')
      }
    } catch (e) {
      warmup = false
      cancelAnimationFrame(warmFrame)
      setError(e instanceof Error ? e.message : 'The spin did not go through. Try again.')
      setPhase('ready')
    } finally {
      spinningRef.current = false
      spinLock.current = false
    }
  }

  const launcher = chatOpen ? null : (
      <div className="relay-above-tabbar fixed z-[90] flex flex-col items-start gap-2 left-[max(14px,env(safe-area-inset-left))] max-[899px]:bottom-[calc(5.75rem+env(safe-area-inset-bottom))] min-[900px]:bottom-4">
        <button
          type="button"
          onClick={openFromLauncher}
          aria-label={access.status === 'waiting' ? 'Lucky spin unavailable' : 'Open lucky spin'}
          className="relative h-[clamp(56px,15vw,84px)] w-[clamp(56px,15vw,84px)] border-0 bg-transparent p-0 shadow-[0_8px_18px_-6px_rgba(0,0,0,0.75)]"
        >
          <span
            className="pointer-events-none absolute left-1/2 top-[2%] z-30 h-[8%] w-[6.5%] -translate-x-1/2 bg-gradient-to-b from-[#fff6d0] to-[#e2b34a]"
            style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
          />
          <canvas
            ref={launcherCanvasRef}
            width={640}
            height={640}
            className="pointer-events-none block h-full w-full"
            aria-hidden
          />
          <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#fff1c2] bg-gradient-to-b from-[#fff6d4] via-[#e7b84a] to-[#b8862d] text-[clamp(6px,1.6vw,8px)] font-extrabold tracking-[0.06em] text-[#3a2508] shadow-[inset_0_1px_0_#fff6d0]">
            SPIN
          </span>
        </button>
      </div>
  )

  if (phase === 'checking' || phase === 'closed') return launcher

  const prizeLabel = prize == null ? '' : formatLuckyPrize(prize)
  const spinning = phase === 'spinning'
  const spinLocked =
    activePlayer === false || (access.status === 'waiting' && (access.resetsAt == null || access.resetsAt > now))
  const nextSpinMessage =
    access.resetsAt != null && access.resetsAt > now
      ? `Your next free spin is in ${resetWaitLabel(access.resetsAt, now)}.`
      : null

  function close() {
    if (phase === 'won') finish()
    else snooze()
  }

  return (
    <>
    {launcher}
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#070b16]/80 p-4 max-[899px]:pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lucky-spin-title"
        className="relative w-full max-w-[420px] rounded-[22px] border border-[#e1b55d]/55 px-4 pb-4 pt-3.5 text-white shadow-[0_0_65px_rgba(169,71,169,0.16),0_28px_80px_rgba(0,0,0,0.55)]"
        style={{
          background:
            'radial-gradient(ellipse at 85% 28%, rgba(103,25,88,0.42), transparent 58%), radial-gradient(ellipse at 0% 100%, rgba(40,32,91,0.55), transparent 55%), #171127',
        }}
      >
        <h2 id="lucky-spin-title" className="sr-only">
          Lucky spin
        </h2>
        <div className="flex items-center justify-between gap-2 border-b border-[#edc06e]/25 pb-3">
          <span className="text-[12px] font-semibold tracking-[0.16em] text-[#ffdfa0]">≋ RELAY REWARDS</span>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#f0c86a]/50 bg-[#d79c22]/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-[#f9d587]">
              ★ YOUR LUCKY SPIN
            </span>
            {phase !== 'spinning' ? (
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#f0c86a]/45 text-[#f9d587]"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] font-semibold tracking-[0.16em] text-[#e7c373]">
          {phase === 'won' ? (tryAgain ? 'TRY AGAIN.' : 'CONGRATULATIONS.') : 'STEP RIGHT UP. IT’S YOUR LUCKY DAY.'}
        </p>

        {phase === 'won' && tryAgain ? (
          <div className="mt-4 rounded-2xl border border-[#e7c373]/40 bg-[#120e1c] px-4 py-8 text-center">
            <p className="text-[11px] font-semibold tracking-[0.32em] text-[#edcc8e]">NO CREDITS</p>
            <p className="mt-3 bg-gradient-to-b from-[#fff6d4] via-[#f0c86a] to-[#c9922e] bg-clip-text text-[40px] font-extrabold leading-none text-transparent">
              TRY AGAIN
            </p>
            <p className="mx-auto mt-4 max-w-[16rem] text-[13px] leading-relaxed text-[#d8cfe8]">
              The pointer stopped on Try again. Nothing was added, and no receipt was sent.
            </p>
            {nextSpinMessage ? (
              <p className="mx-auto mt-4 max-w-[18rem] text-[13px] leading-relaxed text-[#a39bb8]">{nextSpinMessage}</p>
            ) : null}
          </div>
        ) : phase === 'won' ? (
          <div className="mt-4 rounded-2xl border border-[#e7c373]/40 bg-[#120e1c]">
            <div className="px-4 pb-4 pt-5 text-center">
              <p className="text-[11px] font-semibold tracking-[0.32em] text-[#edcc8e]">YOU WON</p>
              <p className="mt-1 bg-gradient-to-b from-[#fff6d4] via-[#f0c86a] to-[#c9922e] bg-clip-text text-[64px] font-extrabold leading-none text-transparent">
                {prizeLabel}
              </p>
              <p className="mt-1 text-[12px] font-semibold tracking-[0.42em] text-[#f9d587]">CREDITS</p>
              {prize != null && isDecimalLuckyPrize(prize) ? (
                <p className="mx-auto mt-3 max-w-[16rem] text-[12px] leading-relaxed text-[#d8cfe8]">{DECIMAL_PRIZE_NOTE}</p>
              ) : null}
            </div>
            <div className="border-t border-dashed border-[#e7c373]/40 px-4 py-3.5">
              <p className="text-center text-[10px] font-semibold tracking-[0.22em] text-[#edcc8e]">
                {notified ? 'RECEIPT SENT' : 'SAVED IN MESSAGES'}
              </p>
              {receiptId ? (
                <p className="mt-1.5 text-center font-mono text-[15px] tracking-[0.14em] text-[#fff6d0]">{receiptId}</p>
              ) : null}
              <p className="mt-2 text-center text-[13px] leading-relaxed text-[#d8cfe8]">
                {notified
                  ? 'Relay sent this receipt in your messages. Your agent can verify it and reply.'
                  : 'The result is in your messages, but the alert to your agent did not send.'}
              </p>
              {nextSpinMessage ? (
                <p className="mx-auto mt-3 max-w-[18rem] text-center text-[13px] leading-relaxed text-[#a39bb8]">
                  {nextSpinMessage}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div
              className={`relative mx-auto mt-2 w-[240px] ${spinLocked ? 'opacity-90 grayscale-[0.28]' : ''}`}
            >
              <div className="pointer-events-none absolute left-1/2 top-1 z-10 h-5 w-3.5 -translate-x-1/2 bg-gradient-to-b from-[#fff6d0] to-[#e2b34a] [clip-path:polygon(0_0,100%_0,50%_100%)]" />
              <canvas
                ref={canvasRef}
                width={640}
                height={640}
                className="block aspect-square w-full"
                aria-hidden
              />
              <button
                type="button"
                onClick={() => void spin()}
                disabled={spinning || spinLocked}
                aria-label="Spin the wheel"
                className={`absolute left-1/2 top-1/2 z-20 flex h-[84px] w-[84px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-[#fff1c2] bg-gradient-to-b from-[#fff6d4] via-[#e7b84a] to-[#b8862d] text-[#3a2508] transition active:scale-95 disabled:cursor-wait ${
                  spinning ? 'opacity-90' : spinLocked ? '' : 'relay-spin-hub cursor-pointer hover:scale-105'
                }`}
              >
                {spinning ? (
                  <span className="text-[13px] font-extrabold tracking-[0.2em]">···</span>
                ) : (
                  <span className="text-[15px] font-extrabold tracking-[0.14em]">SPIN</span>
                )}
              </button>
            </div>
            {activePlayer === false ? (
              <p className="mx-auto mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed text-[#a39bb8]">
                {ACTIVE_PLAYER_SPIN_NOTE}
              </p>
            ) : spinLocked ? (
              <p className="mx-auto mt-3 max-w-[22rem] text-center text-[13px] leading-relaxed text-[#a39bb8]">
                {nextSpinMessage ?? 'Your next free spin is not ready yet.'}
              </p>
            ) : (
              <p className="mt-1 text-center text-[12px] tracking-wide text-[#e7c373]/90">
                {spinning ? 'The wheel is spinning' : 'Tap the gold center to spin'}
              </p>
            )}
          </>
        )}

        {error ? <p className="mt-3 text-center text-sm text-[#ffb4b4]">{error}</p> : null}

        {phase === 'won' ? (
          <button
            type="button"
            onClick={finish}
            className="mt-4 w-full rounded-full border border-[#f0c86a]/70 bg-gradient-to-r from-[#f6e2a8] to-[#c9922e] px-4 py-2.5 text-sm font-semibold tracking-wide text-[#3a2508]"
          >
            Back to home
          </button>
        ) : null}
      </section>
    </div>
    </>
  )
}

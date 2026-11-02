/**
 * Free spin. Every wedge, including Try again, can be the result.
 * The server picks the wedge before the wheel moves. Slice size is the chance.
 * One spin every 48 hours. A win and a Try again both start that wait.
 * Numbers run from 1 to 4. Low values are split into several wedges.
 * Each Try again wedge is smaller than 1–1.6. Together they are about 39% of spins.
 */

/** Keep this in step with the rules page and profiles.lucky_spin_at. */
export const LUCKY_SPIN_COOLDOWN_MS = 48 * 60 * 60 * 1000

/** ISO time the next spin opens, or null when a spin is available now. */
export function luckySpinResetsAt(spunAtIso: string | null | undefined, now = Date.now()): string | null {
  if (!spunAtIso) return null
  const spun = Date.parse(spunAtIso)
  if (!Number.isFinite(spun)) return null
  const resets = spun + LUCKY_SPIN_COOLDOWN_MS
  return resets > now ? new Date(resets).toISOString() : null
}

export type LuckyWheelSlice = {
  label: string
  prize: number | null
  /** Share of the circle and the chance the pointer stops on this wedge. */
  weight: number
}

/**
 * Real prizes and Try again wedges alternate.
 *
 * Approximate chances of stopping there: 1 8%, 1.2 8%, 1.3 8%, 1.5 7%, 1.6 7%,
 * 2.1 6%, 2.4 6%, 2.8 5%, 3.4 4%, 4 3%. Each Try again wedge is about 3–4%.
 */
export const LUCKY_WHEEL_SLICES: readonly LuckyWheelSlice[] = [
  { label: '1', prize: 1, weight: 1.5 },
  { label: 'Try again', prize: null, weight: 0.82 },
  { label: '1.2', prize: 1.2, weight: 1.45 },
  { label: 'Try again', prize: null, weight: 0.8 },
  { label: '1.3', prize: 1.3, weight: 1.4 },
  { label: 'Try again', prize: null, weight: 0.78 },
  { label: '1.5', prize: 1.5, weight: 1.35 },
  { label: 'Try again', prize: null, weight: 0.76 },
  { label: '1.6', prize: 1.6, weight: 1.3 },
  { label: 'Try again', prize: null, weight: 0.74 },
  { label: '2.1', prize: 2.1, weight: 1.15 },
  { label: 'Try again', prize: null, weight: 0.72 },
  { label: '2.4', prize: 2.4, weight: 1.05 },
  { label: 'Try again', prize: null, weight: 0.7 },
  { label: '2.8', prize: 2.8, weight: 0.85 },
  { label: 'Try again', prize: null, weight: 0.68 },
  { label: '3.4', prize: 3.4, weight: 0.7 },
  { label: 'Try again', prize: null, weight: 0.66 },
  { label: '4', prize: 4, weight: 0.62 },
  { label: 'Try again', prize: null, weight: 0.64 },
]

export type LuckyWinPrize = Exclude<(typeof LUCKY_WHEEL_SLICES)[number]['prize'], null>

type SliceGeom = { start: number; span: number; center: number }

const TOTAL_WEIGHT = LUCKY_WHEEL_SLICES.reduce((sum, slice) => sum + slice.weight, 0)

export const LUCKY_SLICE_GEOM: readonly SliceGeom[] = (() => {
  let cursor = 0
  return LUCKY_WHEEL_SLICES.map((slice) => {
    const span = (slice.weight / TOTAL_WEIGHT) * Math.PI * 2
    const start = cursor
    cursor += span
    return { start, span, center: start + span / 2 }
  })
})()

const LUCKY_SPIN_TZ = 'America/Chicago'

export function isLuckyWinPrize(value: number): value is LuckyWinPrize {
  return LUCKY_WHEEL_SLICES.some((slice) => slice.prize != null && Math.abs(slice.prize - value) < 0.001)
}

export function formatLuckyPrize(prize: number): string {
  const tenths = Math.round(prize * 10) / 10
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1)
}

/** True when the shown prize is not a whole number, so the receipt should mention rounding. */
export function isDecimalLuckyPrize(prize: number): boolean {
  const tenths = Math.round(prize * 10) / 10
  return Number.isFinite(tenths) && !Number.isInteger(tenths)
}

export const DECIMAL_PRIZE_NOTE = 'This decimal may be rounded to the nearest whole number.'

export const ACTIVE_PLAYER_SPIN_NOTE =
  'This spin is reserved for active players. An active player is someone who has made a deposit and has played with us before. Please contact your agent if you would like to become an active player, or if you have already done so. We would be glad to help.'

export type LuckySpinPick =
  | { tryAgain: true; sliceIndex: number; prize: null }
  | { tryAgain: false; sliceIndex: number; prize: LuckyWinPrize }

/** One random draw over every wedge. Bigger weight, better chance, including Try again. */
export function pickLuckySpinResult(): LuckySpinPick {
  const total = LUCKY_WHEEL_SLICES.reduce((sum, slice) => sum + slice.weight, 0)
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  let ticket = (buf[0] / 0x100000000) * total
  for (let index = 0; index < LUCKY_WHEEL_SLICES.length; index += 1) {
    ticket -= LUCKY_WHEEL_SLICES[index].weight
    if (ticket < 0) return pickAt(index)
  }
  return pickAt(LUCKY_WHEEL_SLICES.length - 1)
}

function pickAt(index: number): LuckySpinPick {
  const prize = LUCKY_WHEEL_SLICES[index]?.prize
  if (prize == null) return { tryAgain: true, sliceIndex: index, prize: null }
  return { tryAgain: false, sliceIndex: index, prize }
}

export const RELAY_RECEIPT_HEADER = 'Relay system receipt'

export type SpinReceipt = {
  receiptId: string
  prize: number
  customerName: string
  username: string
  wonAt: string
}

/** Body Relay inserts as the team. A customer can paste the words, but not send them as Relay. */
export function buildSpinReceiptBody(receipt: SpinReceipt): string {
  const prizeLabel = formatLuckyPrize(receipt.prize)
  return [
    RELAY_RECEIPT_HEADER,
    `Receipt ${receipt.receiptId}`,
    `Customer: ${receipt.customerName} (@${receipt.username})`,
    `Prize: ${prizeLabel} credits`,
    ...(isDecimalLuckyPrize(receipt.prize) ? [DECIMAL_PRIZE_NOTE] : []),
    `Won: ${receipt.wonAt}`,
    'Sent by Relay. Verify this receipt and reply to the customer.',
  ].join('\n')
}

export function parseSpinReceipt(body: string): SpinReceipt | null {
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines[0] !== RELAY_RECEIPT_HEADER) return null
  const receiptId = lines.find((line) => line.startsWith('Receipt '))?.slice('Receipt '.length).trim()
  const customer = lines.find((line) => line.startsWith('Customer: '))?.slice('Customer: '.length).trim()
  const prizeLine = lines.find((line) => line.startsWith('Prize: '))
  const wonAt = lines.find((line) => line.startsWith('Won: '))?.slice('Won: '.length).trim()
  const prizeMatch = prizeLine?.match(/^Prize: ([0-9]+(?:\.[0-9]+)?) credits$/)
  if (!receiptId || !customer || !prizeMatch || !wonAt) return null
  const prize = Number(prizeMatch[1])
  if (!Number.isFinite(prize)) return null
  const named = customer.match(/^(.*) \(@([^)]+)\)$/)
  return {
    receiptId,
    prize,
    customerName: named?.[1]?.trim() || customer,
    username: named?.[2]?.trim() || '',
    wonAt,
  }
}

export function luckySpinBody(input: {
  displayName: string
  username: string
  prize: number
}): string {
  const prizeLabel = formatLuckyPrize(input.prize)
  return [
    `Lucky spin confirmed — ${input.displayName} (@${input.username}) won ${prizeLabel} credits.`,
    'This result is confirmed. Please verify and reply to the customer.',
  ].join('\n')
}

export function prizeFromLuckySpinBody(body: string): LuckyWinPrize | null {
  const match = body.match(/won ([0-9]+(?:\.[0-9]+)?) credits/)
  if (!match) return null
  const prize = Number(match[1])
  return isLuckyWinPrize(prize) ? prize : null
}

/** Midnight at the start of the current Chicago day, as an ISO timestamp. */
export function luckySpinDayStart(now = new Date()): string {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: LUCKY_SPIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const utcGuess = new Date(`${key}T00:00:00.000Z`)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: LUCKY_SPIN_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const asUtc = (d: Date) => {
    const map: Record<string, string> = {}
    for (const part of fmt.formatToParts(d)) {
      if (part.type !== 'literal') map[part.type] = part.value
    }
    return Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second)
  }
  const offset = asUtc(utcGuess) - utcGuess.getTime()
  const adjusted = new Date(utcGuess.getTime() - offset)
  const offset2 = asUtc(adjusted) - adjusted.getTime()
  return new Date(utcGuess.getTime() - offset2).toISOString()
}

export function sliceIndexForPrize(prize: number): number {
  const index = LUCKY_WHEEL_SLICES.findIndex((slice) => slice.prize != null && Math.abs(slice.prize - prize) < 0.001)
  if (index < 0) throw new Error('Prize is not on the wheel')
  return index
}

/** Try again wedge beside a winning prize. Wins can still be animated through it. */
export function teaseIndexForPrize(prize: number): number {
  const win = sliceIndexForPrize(prize)
  const tease = (win + 1) % LUCKY_WHEEL_SLICES.length
  if (LUCKY_WHEEL_SLICES[tease]?.prize != null) throw new Error('Tease slice is not Try again')
  return tease
}

export function pointerSliceIndex(angle: number): number {
  const turn = Math.PI * 2
  let position = -angle % turn
  if (position < 0) position += turn
  if (position >= turn - 1e-8) position = 0
  for (let index = 0; index < LUCKY_SLICE_GEOM.length; index += 1) {
    const slice = LUCKY_SLICE_GEOM[index]
    if (position >= slice.start - 1e-8 && position < slice.start + slice.span - 1e-8) return index
  }
  return LUCKY_SLICE_GEOM.length - 1
}

/** Smallest wheel angle at or after `minAngle` that centers `index` under the pointer. */
export function wheelCenterAngle(index: number, minAngle: number): number {
  const base = -LUCKY_SLICE_GEOM[index].center
  const turn = Math.PI * 2
  if (base >= minAngle) return base
  const turns = Math.ceil((minAngle - base) / turn - 1e-9)
  return base + turns * turn
}

export function luckySpinPath(prize: number, startAngle: number) {
  const win = sliceIndexForPrize(prize)
  const tease = teaseIndexForPrize(prize)
  const teaseAngle = wheelCenterAngle(tease, startAngle + Math.PI * 2 * 7)
  const finalAngle = wheelCenterAngle(win, teaseAngle + 0.001)
  const creep = Math.min(LUCKY_SLICE_GEOM[tease].span * 0.22, (finalAngle - teaseAngle) * 0.25)
  return { win, tease, teaseAngle, finalAngle, creep }
}

function easeOut(progress: number, power: number): number {
  return 1 - Math.pow(1 - progress, power)
}

/** Several full turns, then a stop centered on the chosen wedge. */
export function luckySpinSettleAngle(index: number, startAngle: number): number {
  return wheelCenterAngle(index, startAngle + Math.PI * 2 * 7)
}

export function luckySpinSettleAngleAt(progress: number, startAngle: number, finalAngle: number): number {
  const t = Math.min(1, Math.max(0, progress))
  return startAngle + (finalAngle - startAngle) * easeOut(t, 4)
}

/** Fast spins, a pause on a Try again wedge, then a short slip onto a real prize. */
export function luckySpinAngleAt(
  progress: number,
  startAngle: number,
  teaseAngle: number,
  finalAngle: number,
  creep: number
): number {
  const t = Math.min(1, Math.max(0, progress))
  if (t < 0.7) {
    return startAngle + (teaseAngle - startAngle) * easeOut(t / 0.7, 5)
  }
  if (t < 0.86) {
    return teaseAngle + creep * ((t - 0.7) / 0.16)
  }
  const from = teaseAngle + creep
  return from + (finalAngle - from) * easeOut((t - 0.86) / 0.14, 3)
}

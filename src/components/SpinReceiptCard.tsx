import type { SpinReceipt } from '@/lib/luckySpin'
import { DECIMAL_PRIZE_NOTE, formatLuckyPrize, isDecimalLuckyPrize } from '@/lib/luckySpin'

/** Official spin receipt. Render this only when Relay sent the message, not when a customer typed the same words. */
export function SpinReceiptCard({
  receipt,
  tone,
}: {
  receipt: SpinReceipt
  tone: 'customer' | 'staff'
}) {
  const dark = tone === 'customer'
  return (
    <div
      className={`w-[min(100%,18rem)] rounded-xl border px-3 py-2.5 text-left ${
        dark
          ? 'border-[#e7c373]/70 bg-[#161222] text-white'
          : 'border-[#c9a15b] bg-[#fffaf0] text-slate-800'
      }`}
    >
      <p className={`text-[10px] font-bold tracking-[0.14em] ${dark ? 'text-[#e7c373]' : 'text-[#8a6a22]'}`}>
        RELAY SYSTEM
      </p>
      <p className="mt-1 text-sm font-semibold">Spin receipt</p>
      <dl className={`mt-2 space-y-1 text-[13px] leading-snug ${dark ? 'text-[#e7e4f4]' : 'text-slate-700'}`}>
        <div className="flex justify-between gap-3">
          <dt>Customer</dt>
          <dd className="text-right">
            {receipt.customerName}
            {receipt.username ? ` (@${receipt.username})` : ''}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Prize</dt>
          <dd className="font-semibold">{formatLuckyPrize(receipt.prize)} credits</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Won</dt>
          <dd className="text-right">{receipt.wonAt}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Receipt</dt>
          <dd className="font-mono text-[12px]">{receipt.receiptId}</dd>
        </div>
      </dl>
      {isDecimalLuckyPrize(receipt.prize) ? (
        <p className={`mt-2 text-[12px] leading-snug ${dark ? 'text-[#e7c373]' : 'text-[#8a6a22]'}`}>{DECIMAL_PRIZE_NOTE}</p>
      ) : null}
      <p className={`mt-2 text-[11px] leading-relaxed ${dark ? 'text-[#b7b1c9]' : 'text-slate-500'}`}>
        Sent by Relay. A copied message from the customer is not this receipt.
      </p>
    </div>
  )
}

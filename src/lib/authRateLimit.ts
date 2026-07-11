import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

function durationFromEnv(value: string | undefined, fallback: Duration): Duration {
  const v = value?.trim()
  if (v) return v as Duration
  return fallback
}

let redisSingleton: Redis | null | undefined

function getRedis(): Redis | null {
  if (redisSingleton !== undefined) return redisSingleton
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) {
    redisSingleton = null
    return null
  }
  redisSingleton = new Redis({ url, token })
  return redisSingleton
}

let registerLimiter: Ratelimit | undefined
let otpIpLimiter: Ratelimit | undefined
let otpEmailLimiter: Ratelimit | undefined
let verifyOtpIpLimiter: Ratelimit | undefined
let verifyOtpEmailLimiter: Ratelimit | undefined
let passwordResetCompleteLimiter: Ratelimit | undefined

function retryAfterSecFromReset(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000))
}

type MemBucket = { count: number; windowStart: number }
const memBuckets = new Map<string, MemBucket>()
const MEM_PRUNE_AT = 2_000

/** Per-process fallback when Upstash is not configured (still blocks burst abuse on each instance). */
function memSlidingWindow(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (memBuckets.size > MEM_PRUNE_AT) {
    for (const [k, v] of memBuckets) {
      if (now - v.windowStart >= windowMs) memBuckets.delete(k)
    }
  }

  const entry = memBuckets.get(key)
  if (!entry || now - entry.windowStart >= windowMs) {
    memBuckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, retryAfterSec: 0 }
  }

  if (entry.count >= max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)),
    }
  }

  entry.count += 1
  return { allowed: true, retryAfterSec: 0 }
}

function parseWindowMs(value: string | undefined, fallbackMs: number): number {
  const v = value?.trim().toLowerCase()
  if (!v) return fallbackMs
  const m = v.match(/^(\d+)\s*(ms|s|m|h|d)$/)
  if (!m) return fallbackMs
  const n = parseInt(m[1], 10)
  const unit = m[2]
  const mult =
    unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return n * mult
}

/** Signup: default 8 attempts / hour / IP (see env). Falls back to in-memory limits when Upstash is not configured. */
export async function rateLimitRegister(ip: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = getRedis()
  if (!redis) {
    const max = Math.max(1, parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '5', 10))
    const windowMs = parseWindowMs(process.env.RATE_LIMIT_REGISTER_WINDOW, 3_600_000)
    return memSlidingWindow(`register:${ip}`, max, windowMs)
  }

  if (!registerLimiter) {
    registerLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        Math.max(1, parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '8', 10)),
        durationFromEnv(process.env.RATE_LIMIT_REGISTER_WINDOW, '1 h')
      ),
      prefix: 'relay:rl:register',
    })
  }

  const { success, reset } = await registerLimiter.limit(ip)
  if (success) return { allowed: true, retryAfterSec: 0 }
  return { allowed: false, retryAfterSec: retryAfterSecFromReset(reset) }
}

/** OTP send: IP + email buckets to reduce spam and email bombing. */
export async function rateLimitSendOtp(
  ip: string,
  emailRaw: string
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = getRedis()
  const email = emailRaw.trim().toLowerCase().slice(0, 254) || 'invalid'

  if (!redis) {
    const ipMax = Math.max(1, parseInt(process.env.RATE_LIMIT_OTP_IP_MAX || '12', 10))
    const ipWindowMs = parseWindowMs(process.env.RATE_LIMIT_OTP_IP_WINDOW, 3_600_000)
    const emailMax = Math.max(1, parseInt(process.env.RATE_LIMIT_OTP_EMAIL_MAX || '4', 10))
    const emailWindowMs = parseWindowMs(process.env.RATE_LIMIT_OTP_EMAIL_WINDOW, 3_600_000)
    const byIp = memSlidingWindow(`otp_ip:${ip}`, ipMax, ipWindowMs)
    if (!byIp.allowed) return byIp
    return memSlidingWindow(`otp_email:${email}`, emailMax, emailWindowMs)
  }

  if (!otpIpLimiter) {
    otpIpLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        Math.max(1, parseInt(process.env.RATE_LIMIT_OTP_IP_MAX || '20', 10)),
        durationFromEnv(process.env.RATE_LIMIT_OTP_IP_WINDOW, '1 h')
      ),
      prefix: 'relay:rl:otp_ip',
    })
  }

  if (!otpEmailLimiter) {
    otpEmailLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        Math.max(1, parseInt(process.env.RATE_LIMIT_OTP_EMAIL_MAX || '5', 10)),
        durationFromEnv(process.env.RATE_LIMIT_OTP_EMAIL_WINDOW, '1 h')
      ),
      prefix: 'relay:rl:otp_email',
    })
  }

  const [byIp, byEmail] = await Promise.all([otpIpLimiter.limit(ip), otpEmailLimiter.limit(email)])

  if (!byIp.success) return { allowed: false, retryAfterSec: retryAfterSecFromReset(byIp.reset) }
  if (!byEmail.success) return { allowed: false, retryAfterSec: retryAfterSecFromReset(byEmail.reset) }

  return { allowed: true, retryAfterSec: 0 }
}

/** Signup OTP verify: IP + email buckets to limit brute force (default 10 / 10 min IP, 5 / 10 min email). */
export async function rateLimitVerifyOtp(
  ip: string,
  emailRaw: string
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = getRedis()
  const email = emailRaw.trim().toLowerCase().slice(0, 254) || 'invalid'

  if (!redis) {
    const ipMax = Math.max(1, parseInt(process.env.RATE_LIMIT_VERIFY_OTP_IP_MAX || '8', 10))
    const ipWindowMs = parseWindowMs(process.env.RATE_LIMIT_VERIFY_OTP_IP_WINDOW, 600_000)
    const emailMax = Math.max(1, parseInt(process.env.RATE_LIMIT_VERIFY_OTP_EMAIL_MAX || '4', 10))
    const emailWindowMs = parseWindowMs(process.env.RATE_LIMIT_VERIFY_OTP_EMAIL_WINDOW, 600_000)
    const byIp = memSlidingWindow(`verify_otp_ip:${ip}`, ipMax, ipWindowMs)
    if (!byIp.allowed) return byIp
    return memSlidingWindow(`verify_otp_email:${email}`, emailMax, emailWindowMs)
  }

  if (!verifyOtpIpLimiter) {
    verifyOtpIpLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        Math.max(1, parseInt(process.env.RATE_LIMIT_VERIFY_OTP_IP_MAX || '10', 10)),
        durationFromEnv(process.env.RATE_LIMIT_VERIFY_OTP_IP_WINDOW, '10 m')
      ),
      prefix: 'relay:rl:verify_otp_ip',
    })
  }

  if (!verifyOtpEmailLimiter) {
    verifyOtpEmailLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        Math.max(1, parseInt(process.env.RATE_LIMIT_VERIFY_OTP_EMAIL_MAX || '5', 10)),
        durationFromEnv(process.env.RATE_LIMIT_VERIFY_OTP_EMAIL_WINDOW, '10 m')
      ),
      prefix: 'relay:rl:verify_otp_email',
    })
  }

  const [byIp, byEmail] = await Promise.all([
    verifyOtpIpLimiter.limit(ip),
    verifyOtpEmailLimiter.limit(email),
  ])

  if (!byIp.success) return { allowed: false, retryAfterSec: retryAfterSecFromReset(byIp.reset) }
  if (!byEmail.success) return { allowed: false, retryAfterSec: retryAfterSecFromReset(byEmail.reset) }

  return { allowed: true, retryAfterSec: 0 }
}

/** Password reset (OTP verify + update): default 20 attempts / hour / IP. */
export async function rateLimitPasswordResetComplete(
  ip: string
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = getRedis()
  if (!redis) {
    const max = Math.max(1, parseInt(process.env.RATE_LIMIT_PW_RESET_COMPLETE_MAX || '12', 10))
    const windowMs = parseWindowMs(process.env.RATE_LIMIT_PW_RESET_COMPLETE_WINDOW, 3_600_000)
    return memSlidingWindow(`pw_reset:${ip}`, max, windowMs)
  }

  if (!passwordResetCompleteLimiter) {
    passwordResetCompleteLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        Math.max(1, parseInt(process.env.RATE_LIMIT_PW_RESET_COMPLETE_MAX || '20', 10)),
        durationFromEnv(process.env.RATE_LIMIT_PW_RESET_COMPLETE_WINDOW, '1 h')
      ),
      prefix: 'relay:rl:pw_reset_complete',
    })
  }

  const { success, reset } = await passwordResetCompleteLimiter.limit(ip)
  if (success) return { allowed: true, retryAfterSec: 0 }
  return { allowed: false, retryAfterSec: retryAfterSecFromReset(reset) }
}

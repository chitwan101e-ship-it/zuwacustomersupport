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

/** Signup: default 8 attempts / hour / IP (see env). No-op when Upstash is not configured. */
export async function rateLimitRegister(ip: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = getRedis()
  if (!redis) return { allowed: true, retryAfterSec: 0 }

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
  if (!redis) return { allowed: true, retryAfterSec: 0 }

  const email = emailRaw.trim().toLowerCase().slice(0, 254) || 'invalid'

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
  if (!redis) return { allowed: true, retryAfterSec: 0 }

  const email = emailRaw.trim().toLowerCase().slice(0, 254) || 'invalid'

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
  if (!redis) return { allowed: true, retryAfterSec: 0 }

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

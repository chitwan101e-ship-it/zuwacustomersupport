'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RelayLogo from '@/components/RelayLogo'
import { Loader2, Eye, EyeOff } from 'lucide-react'

const inp =
  'w-full px-3 py-2.5 border border-white/10 bg-[#11172a] text-white placeholder:text-[#6f7896] rounded-lg text-sm focus:border-[#7c5af6] focus:ring-4 focus:ring-[#7c5af6]/20 focus:outline-none transition-all'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password })
      if (upErr) throw upErr
      router.replace('/login?reset=ok')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#050814] text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <RelayLogo theme="dark" size="md" />
        </div>
        <h1 className="text-2xl font-bold text-center mb-2">Set a new password</h1>
        <p className="text-sm text-[#7f8bad] text-center mb-8">
          Choose a strong password for your account.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {error ? (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">{error}</p>
          ) : null}

          <div>
            <label className="block text-xs text-[#7f8bad] mb-1.5">New password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inp + ' pr-11'}
                autoComplete="new-password"
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#6f7896] hover:text-white"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#7f8bad] mb-1.5">Confirm password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inp}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-[#7c5af6] hover:bg-[#6d4ee6] font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Update password
          </button>
        </form>

        <p className="text-center mt-8 text-sm text-[#7f8bad]">
          <Link href="/login" className="text-[#8d63ff] hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

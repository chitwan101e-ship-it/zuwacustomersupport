/**
 * Update an existing Supabase auth user (email + password) and profile username.
 *
 * From project root (reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local):
 *
 *   node scripts/update-admin-user.mjs "YOUR_NEW_PASSWORD"
 *
 * Optional overrides (positional):
 *   node scripts/update-admin-user.mjs "password" <user-uuid> <email> <username>
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnvLocal() {
  const p = resolve(process.cwd(), '.env.local')
  if (!existsSync(p)) return
  const raw = readFileSync(p, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const password = process.argv[2]
const userId = process.argv[3] || '5f6a22b8-88ee-4d77-867f-b82ee35b462b'
const email = (process.argv[4] || 'juwabros@gmail.com').trim().toLowerCase()
const username = (process.argv[5] || 'juwabros').replace(/^@/, '')

if (!url || !serviceKey?.trim()) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (!password) {
  console.error('Usage: node scripts/update-admin-user.mjs "YOUR_NEW_PASSWORD"')
  console.error('       node scripts/update-admin-user.mjs "password" <user-uuid> <email> <username>')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: authData, error: authErr } = await admin.auth.admin.updateUserById(userId, {
  email,
  password,
  email_confirm: true,
})

if (authErr) {
  console.error('Auth update failed:', authErr.message)
  process.exit(1)
}

const { error: profileErr } = await admin.from('profiles').update({ username }).eq('id', userId)

if (profileErr) {
  console.error('Profile username update failed:', profileErr.message)
  console.error('Auth user was already updated; fix profiles manually if needed.')
  process.exit(1)
}

console.log('OK — auth user updated:', authData.user?.id ?? userId, email)
console.log('OK — profile username set to:', username)

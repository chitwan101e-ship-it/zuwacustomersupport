/**
 * Set public display name (profiles.first_name + last_name) for a user by @username.
 *
 *   node scripts/set-profile-name.mjs juwabros Juwa Bros
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
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

const username = (process.argv[2] || '').trim().replace(/^@+/, '').toLowerCase()
const firstName = (process.argv[3] || '').trim()
const lastName = (process.argv[4] || '').trim()

if (!url || !serviceKey?.trim()) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (!username || !firstName) {
  console.error('Usage: node scripts/set-profile-name.mjs <username> <firstName> [lastName]')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: row, error: selErr } = await admin.from('profiles').select('id, username').eq('username', username).maybeSingle()
if (selErr || !row) {
  console.error('No profile for username:', username, selErr?.message || '')
  process.exit(1)
}

const { error: updErr } = await admin
  .from('profiles')
  .update({ first_name: firstName, last_name: lastName })
  .eq('id', row.id)

if (updErr) {
  console.error('Update failed:', updErr.message)
  process.exit(1)
}

console.log('OK —', '@' + row.username, '→', [firstName, lastName].filter(Boolean).join(' '))

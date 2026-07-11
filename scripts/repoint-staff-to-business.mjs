/**
 * Point support staff at the same business as your real inbox (same business_id as an admin).
 * Use this when support sees "0 threads" but admin sees threads — usually duplicate businesses
 * from onboarding, so profiles.business_id differs.
 *
 *   node scripts/repoint-staff-to-business.mjs --admin-email juwabros@gmail.com anne777 [@user2 ...]
 *
 * Or by business slug (must match public.businesses.slug):
 *
 *   node scripts/repoint-staff-to-business.mjs vatican-bros anne777
 *
 * Identifiers: @handle or handle, or full email for auth lookup.
 * Only updates rows with business_role = 'support' and deleted_at is null.
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

async function findUserIdByEmail(admin, email) {
  const target = email.trim().toLowerCase()
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    const hit = users.find((u) => (u.email || '').toLowerCase() === target)
    if (hit) return hit.id
    if (users.length < perPage) return null
    page += 1
  }
}

async function resolveStaffUserId(admin, token) {
  const raw = token.trim()
  if (!raw) return null
  if (raw.includes('@')) {
    return findUserIdByEmail(admin, raw)
  }
  const username = raw.replace(/^@+/, '').toLowerCase()
  const { data, error } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey?.trim()) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const argv = process.argv.slice(2)
let businessId = ''
let staffTokens = []

if (argv[0] === '--admin-email' && argv[1]) {
  const adminEmail = argv[1]
  staffTokens = argv.slice(2).filter(Boolean)
  const adminId = await findUserIdByEmail(admin, adminEmail)
  if (!adminId) {
    console.error('No auth user for admin email:', adminEmail)
    process.exit(1)
  }
  const { data: prof, error } = await admin.from('profiles').select('business_id, business_role').eq('id', adminId).maybeSingle()
  if (error || !prof?.business_id) {
    console.error('Admin profile missing business_id', error?.message || '')
    process.exit(1)
  }
  if (prof.business_role !== 'admin') {
    console.warn('Warning: that user is not business_role admin; still using their business_id.')
  }
  businessId = prof.business_id
  console.log('Canonical business_id from admin:', businessId)
} else if (argv[0]) {
  const slug = argv[0]
  staffTokens = argv.slice(1).filter(Boolean)
  const { data: biz, error } = await admin.from('businesses').select('id').eq('slug', slug).maybeSingle()
  if (error || !biz?.id) {
    console.error('Business not found for slug:', slug, error?.message || '')
    process.exit(1)
  }
  businessId = biz.id
  console.log('Canonical business_id from slug', slug + ':', businessId)
} else {
  console.error(
    'Usage:\n  node scripts/repoint-staff-to-business.mjs --admin-email you@example.com staffHandle another@email.com\n  node scripts/repoint-staff-to-business.mjs your-business-slug staffHandle',
  )
  process.exit(1)
}

if (staffTokens.length === 0) {
  console.error('Pass at least one staff @username or email after admin/slug.')
  process.exit(1)
}

for (const tok of staffTokens) {
  const uid = await resolveStaffUserId(admin, tok)
  if (!uid) {
    console.error('Could not resolve user:', tok)
    process.exit(1)
  }
  const { data: row, error: rErr } = await admin
    .from('profiles')
    .select('id, username, business_id, business_role, deleted_at')
    .eq('id', uid)
    .maybeSingle()
  if (rErr || !row) {
    console.error('No profile for', tok, rErr?.message || '')
    process.exit(1)
  }
  if (row.deleted_at) {
    console.error('Skipping deleted profile:', row.username)
    process.exit(1)
  }
  if (row.business_role !== 'support') {
    console.error('Only support staff are repointed (got business_role=', row.business_role, 'for @' + row.username + ')')
    process.exit(1)
  }
  if (row.business_id === businessId) {
    console.log('OK — already on this business:', '@' + row.username, uid)
    continue
  }
  const { error: uErr } = await admin
    .from('profiles')
    .update({ role: 'business', business_id: businessId, business_role: 'support' })
    .eq('id', uid)
    .eq('business_role', 'support')
  if (uErr) {
    console.error('Update failed for', tok, uErr.message)
    process.exit(1)
  }
  console.log('OK — repointed @' + row.username, uid, '| old business_id:', row.business_id, '→', businessId)
}

console.log('Done.')

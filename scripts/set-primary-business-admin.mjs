/**
 * Make one staff user the sole business admin and optionally remove the previous admin
 * (demote + soft-delete profile + ban auth), matching dashboard "remove support" behavior.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 *   node scripts/set-primary-business-admin.mjs <business-slug> <new-admin-email> [old-admin-email]
 *
 * Example:
 *   node scripts/set-primary-business-admin.mjs relay juwabros@gmail.com oldboss@gmail.com
 *
 * If you omit old-admin-email, only the promotion step runs (useful if the old account is already gone).
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

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const businessSlug = process.argv[2]
const newEmail = process.argv[3]
const oldEmail = (process.argv[4] || '').trim()

if (!url || !serviceKey?.trim()) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (!businessSlug || !newEmail) {
  console.error(
    'Usage: node scripts/set-primary-business-admin.mjs <business-slug> <new-admin-email> [old-admin-email]',
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: biz, error: bizErr } = await admin.from('businesses').select('id').eq('slug', businessSlug).maybeSingle()
if (bizErr || !biz?.id) {
  console.error('Business not found for slug:', businessSlug, bizErr?.message || '')
  process.exit(1)
}
const businessId = biz.id

const newId = await findUserIdByEmail(admin, newEmail)
if (!newId) {
  console.error('No auth user found for new admin email:', newEmail)
  process.exit(1)
}

const { data: newProf, error: newProfErr } = await admin.from('profiles').select('id, business_id').eq('id', newId).maybeSingle()
if (newProfErr || !newProf) {
  console.error('New admin has no profiles row. Create staff profile first.', newProfErr?.message || '')
  process.exit(1)
}

if (newProf.business_id && newProf.business_id !== businessId) {
  console.warn(
    'Warning: new admin was on a different business_id; repointing to slug business (common if a duplicate staff account was created).',
  )
}

const { error: promoteErr } = await admin
  .from('profiles')
  .update({
    role: 'business',
    business_id: businessId,
    business_role: 'admin',
    account_status: 'approved',
    deleted_at: null,
  })
  .eq('id', newId)

if (promoteErr) {
  console.error('Failed to promote new admin:', promoteErr.message)
  process.exit(1)
}

console.log('OK — promoted to admin:', newEmail, newId)

if (!oldEmail) {
  console.log('Done (no old-admin email provided).')
  process.exit(0)
}

const oldId = await findUserIdByEmail(admin, oldEmail)
if (!oldId) {
  console.error('No auth user found for old admin email:', oldEmail)
  process.exit(1)
}

if (oldId === newId) {
  console.error('Old and new admin email resolve to the same user; nothing to remove.')
  process.exit(1)
}

const { data: oldProf, error: oldProfErr } = await admin
  .from('profiles')
  .select('id, business_id, business_role')
  .eq('id', oldId)
  .maybeSingle()

if (oldProfErr || !oldProf) {
  console.error('Old admin has no profiles row.', oldProfErr?.message || '')
  process.exit(1)
}

if (oldProf.business_id !== businessId) {
  console.error('Old admin is not on this business (business_id mismatch). Not modifying old account.')
  process.exit(1)
}

const now = new Date().toISOString()
const { error: demoteErr } = await admin
  .from('profiles')
  .update({
    business_role: 'support',
    deleted_at: now,
  })
  .eq('id', oldId)
  .eq('business_id', businessId)

if (demoteErr) {
  console.error('Failed to remove old admin profile:', demoteErr.message)
  process.exit(1)
}

const { error: banErr } = await admin.auth.admin.updateUserById(oldId, { ban_duration: '876000h' })
if (banErr) {
  console.error('Profile updated but auth ban failed (check manually):', banErr.message)
  process.exit(1)
}

console.log('OK — removed previous admin (soft-deleted + banned):', oldEmail, oldId)

/**
 * One-time: create auth user + business admin profile for Relay dashboard.
 *
 * Usage (from project root, with SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/seed-admin.mjs vaticanbros@gmail.com "your-password-here"
 *
 * Or set env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (and optional SEED_BUSINESS_SLUG, SEED_BUSINESS_NAME)
 *
 * No SQL file required — this uses the Auth Admin API.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
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

const email =
  process.argv[2] || process.env.SEED_ADMIN_EMAIL
const password =
  process.argv[3] || process.env.SEED_ADMIN_PASSWORD

const businessSlug = process.env.SEED_BUSINESS_SLUG || 'vatican-bros'
const businessName = process.env.SEED_BUSINESS_NAME || 'Vatican Bros'

if (!url || !serviceKey?.trim()) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).')
  process.exit(1)
}

if (!email || !password) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password>')
  console.error('   or: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node scripts/seed-admin.mjs')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function pickUsername(base) {
  let u = base.slice(0, 26) || 'admin'
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from('profiles').select('id').eq('username', u).maybeSingle()
    if (!data) return u
    u = `${base.slice(0, 20)}_${i}`
  }
  return `${base.slice(0, 10)}_${randomUUID().slice(0, 8)}`
}

async function main() {
  let userId

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  })

  if (createErr) {
    const msg = createErr.message || ''
    const exists =
      /already|exists|registered|duplicate/i.test(msg) || createErr.status === 422 || createErr.code === 'email_exists'
    if (!exists) {
      console.error('createUser failed:', createErr)
      process.exit(1)
    }
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 })
    if (listErr) {
      console.error('listUsers failed:', listErr)
      process.exit(1)
    }
    const u = list.users.find((x) => (x.email || '').toLowerCase() === email.trim().toLowerCase())
    if (!u) {
      console.error('Account may exist but was not found in first 200 users. Create user in Supabase Dashboard, then re-run.')
      process.exit(1)
    }
    userId = u.id
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })
    if (updErr) console.warn('Could not reset password (check dashboard):', updErr.message)
    console.log('Existing auth user:', userId)
  } else {
    userId = created.user.id
    console.log('Created auth user:', userId)
  }

  let { data: biz, error: bizSelErr } = await admin.from('businesses').select('id').eq('slug', businessSlug).maybeSingle()
  if (bizSelErr) {
    console.error(bizSelErr)
    process.exit(1)
  }
  if (!biz) {
    const ins = await admin.from('businesses').insert({ name: businessName, slug: businessSlug }).select('id').single()
    if (ins.error) {
      console.error('business insert:', ins.error)
      process.exit(1)
    }
    biz = ins.data
    console.log('Created business:', businessSlug, biz.id)
  } else {
    console.log('Using business:', businessSlug, biz.id)
  }

  const businessId = biz.id
  const baseUser = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') || 'admin'
  const username = await pickUsername(baseUser)

  const row = {
    id: userId,
    username,
    first_name: 'Vatican',
    last_name: 'Bros',
    phone: null,
    role: 'business',
    business_id: businessId,
    business_role: 'admin',
    account_status: 'approved',
    email_verified: true,
  }

  const { error: profErr } = await admin.from('profiles').upsert(row, { onConflict: 'id' })
  if (profErr) {
    console.error('profiles upsert:', profErr)
    process.exit(1)
  }

  console.log('')
  console.log('Done. Log in at /login with:')
  console.log('  Email:', email.trim().toLowerCase())
  console.log('  Password: (the one you passed in)')
  console.log('  Dashboard: /dashboard')
  console.log('  Username set to:', username)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

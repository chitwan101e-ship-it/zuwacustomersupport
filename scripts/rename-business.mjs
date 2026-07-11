/**
 * Update display name (and optionally URL slug) for a row in public.businesses.
 * Customer-facing "Vatican Bros" text comes from businesses.name — not from staff email.
 *
 *   node scripts/rename-business.mjs <current-slug> "New Display Name"
 *   node scripts/rename-business.mjs <current-slug> "New Display Name" <new-slug>
 *
 * If you change slug, update NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG and any bookmarks
 * to /business/[slug] or subdomains.
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
const currentSlug = process.argv[2]
const newName = process.argv[3]
const newSlug = (process.argv[4] || '').trim()

if (!url || !serviceKey?.trim()) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (!currentSlug || !newName) {
  console.error('Usage: node scripts/rename-business.mjs <current-slug> "New Display Name" [new-slug]')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: row, error: selErr } = await admin.from('businesses').select('id, name, slug').eq('slug', currentSlug).maybeSingle()
if (selErr || !row) {
  console.error('Business not found for slug:', currentSlug, selErr?.message || '')
  process.exit(1)
}

const patch = { name: newName }
if (newSlug) patch.slug = newSlug

const { error: updErr } = await admin.from('businesses').update(patch).eq('id', row.id)
if (updErr) {
  console.error('Update failed:', updErr.message)
  process.exit(1)
}

console.log('OK — updated business', row.id)
console.log('   was:', row.name, '| slug:', row.slug)
console.log('   now:', newName, newSlug ? `| slug: ${newSlug}` : '| slug: (unchanged)')
if (newSlug) {
  console.log('   Remember: set NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG=' + newSlug + ' if you use it.')
}

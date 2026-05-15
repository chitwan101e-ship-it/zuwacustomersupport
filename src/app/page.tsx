import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthenticatedPath } from '@/lib/authRouting'

export default async function HomePage() {
  const supabase = await createClient()
  const path = await resolveAuthenticatedPath(supabase)
  redirect(path ?? '/login')
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Bell,
  ClipboardList,
  Inbox,
  Loader2,
  LogOut,
  MessageCircle,
  Send,
  Shield,
  User2,
  Users,
} from 'lucide-react'

type AppTab = 'home' | 'inbox' | 'users' | 'notify' | 'reports'
type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  business_id: string | null
  business_role: 'admin' | 'support' | null
}
type InboxItem = {
  id: string
  name: string
  body: string
  time: string
  unread: number
}
type MemberRequest = {
  id: string
  name: string
  email: string
  message: string
  status: 'pending' | 'approved' | 'rejected'
}
type ReportItem = {
  id: string
  name: string
  type: string
  status: 'new' | 'in_review' | 'resolved'
  details: string
}

const navItems: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Shield },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'notify', label: 'Notify', icon: Send },
  { id: 'reports', label: 'Reports', icon: ClipboardList },
]

const fallbackInbox: InboxItem[] = [
  { id: '1', name: 'Jordan Lee', body: 'Is there a way to update my account details?', time: '5m ago', unread: 2 },
  { id: '2', name: 'Maria Santos', body: 'Thank you so much! Really excited.', time: '2h ago', unread: 0 },
  { id: '3', name: 'Alex Kim', body: 'It says unauthorized access when opening chat.', time: '1d ago', unread: 1 },
]

const fallbackRequests: MemberRequest[] = [
  {
    id: '1',
    name: 'Priya Nair',
    email: 'priya@email.com',
    message: 'I need support with my account setup. I was referred by a colleague.',
    status: 'pending',
  },
  {
    id: '2',
    name: 'Tom Herz',
    email: 'tom@email.com',
    message: 'Looking to use Relay for our small team communications.',
    status: 'pending',
  },
]

const fallbackReports: ReportItem[] = [
  {
    id: '1',
    name: 'Jordan Lee',
    type: 'Technical issue',
    status: 'new',
    details: 'Notifications are not appearing on my device even though they are enabled in settings.',
  },
  {
    id: '2',
    name: 'Alex Kim',
    type: 'Login problem',
    status: 'in_review',
    details: 'Getting an unauthorized access error intermittently when opening the chat screen.',
  },
  {
    id: '3',
    name: 'Maria Santos',
    type: 'Other',
    status: 'resolved',
    details: 'The interface feels slow on my older Android device. Page transitions lag a bit.',
  },
]

export default function DashboardPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>('home')
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(fallbackInbox)
  const [memberRequests, setMemberRequests] = useState<MemberRequest[]>(fallbackRequests)
  const [reports, setReports] = useState<ReportItem[]>(fallbackReports)
  const [announcementType, setAnnouncementType] = useState<'announcement' | 'alert' | 'update'>('announcement')
  const [audience, setAudience] = useState<'all' | 'selected' | 'one'>('all')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/signup')
        return
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, role, username, business_id, business_role')
        .eq('id', session.user.id)
        .single()

      if (error || !prof) {
        router.replace('/signup')
        return
      }

      const p = prof as ProfileRow
      if (p.role !== 'business') {
        router.replace('/feed')
        return
      }
      if (cancelled) return
      setProfile(p)
      setLoading(false)
      void loadAdminData(p)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  async function loadAdminData(p: ProfileRow) {
    if (!p.business_id) return
    const [{ data: convoRows }, { data: userRows }, { data: reportRows }] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, updated_at, messages(body,created_at)')
        .eq('business_id', p.business_id)
        .order('updated_at', { ascending: false })
        .limit(8),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, username')
        .eq('business_id', p.business_id)
        .eq('role', 'customer')
        .limit(8),
      supabase
        .from('admin_reports')
        .select('id, reporter_name, category, status, details, created_at')
        .eq('business_id', p.business_id)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    if (Array.isArray(convoRows) && convoRows.length > 0) {
      setInboxItems(
        convoRows.map((row: any, idx: number) => ({
          id: row.id,
          name: `Customer ${idx + 1}`,
          body: row.messages?.[0]?.body || 'New message received.',
          time: 'recent',
          unread: 1,
        }))
      )
    }
    if (Array.isArray(userRows) && userRows.length > 0) {
      setMemberRequests(
        userRows.slice(0, 4).map((u: any) => ({
          id: u.id,
          name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username || 'New user',
          email: `${u.username || 'user'}@relay.app`,
          message: 'Requesting access to staff support workspace.',
          status: 'pending',
        }))
      )
    }
    if (Array.isArray(reportRows) && reportRows.length > 0) {
      setReports(
        reportRows.map((r: any) => ({
          id: r.id,
          name: r.reporter_name,
          type: r.category,
          status: r.status,
          details: r.details,
        }))
      )
    }
  }

  async function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return
    await supabase.auth.signOut()
    router.replace('/signup')
  }

  const metrics = useMemo(() => {
    const pending = memberRequests.filter((r) => r.status === 'pending').length
    const unread = inboxItems.reduce((acc, item) => acc + item.unread, 0)
    const reportCount = reports.length
    const members = memberRequests.length + 1
    return { pending, unread, reportCount, members }
  }, [memberRequests, inboxItems, reports])

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#050814] text-white lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:flex flex-col border-r border-white/10 bg-[#090d1c] p-5 gap-4">
        <div className="px-2 py-1">
          <p className="text-xs uppercase tracking-[0.18em] text-[#7d86a8]">Staff Portal</p>
          <h1 className="text-2xl font-bold mt-2">Relay Admin</h1>
          <p className="text-sm text-[#7d86a8] mt-1">@{profile.username}</p>
        </div>
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeTab
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition ${
                  active
                    ? 'bg-[#151d39] border-[#6f54ff]/70 text-white'
                    : 'bg-[#0f1528] border-white/10 text-[#7d86a8] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-auto flex items-center gap-2 text-[#aeb7d6] hover:text-white px-2 py-2"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </aside>

      <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 pb-24 lg:pb-6">
        <header className="mb-5">
          <h2 className="text-3xl font-bold">Dashboard</h2>
          <p className="text-[#7d86a8] text-sm">Relay Admin - {profile.business_role === 'admin' ? 'Admin' : 'Support Staff'}</p>
        </header>

        {activeTab === 'home' ? (
          <section className="space-y-4">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <StatCard icon={<User2 className="w-4 h-4" />} label="Pending" value={metrics.pending} accent="yellow" />
              <StatCard icon={<Inbox className="w-4 h-4" />} label="Unread" value={metrics.unread} accent="purple" />
              <StatCard icon={<ClipboardList className="w-4 h-4" />} label="Reports" value={metrics.reportCount} accent="red" />
              <StatCard icon={<Users className="w-4 h-4" />} label="Members" value={metrics.members} accent="green" />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <QuickButton icon={<User2 className="w-4 h-4" />} label="Review Queue" onClick={() => setActiveTab('users')} />
              <QuickButton icon={<Inbox className="w-4 h-4" />} label="Open Inbox" onClick={() => setActiveTab('inbox')} />
              <QuickButton icon={<Send className="w-4 h-4" />} label="Send Notify" onClick={() => setActiveTab('notify')} />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0d1428] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h3 className="text-sm font-semibold tracking-wide text-[#9ea8cc]">RECENT ACTIVITY</h3>
              </div>
              <div className="divide-y divide-white/10">
                {inboxItems.slice(0, 4).map((item) => (
                  <article key={item.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#171f3e] flex items-center justify-center">
                      <MessageCircle className="w-4 h-4 text-[#8d63ff]" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{item.name} sent a message</p>
                      <p className="text-sm text-[#7984a8]">{item.time}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'inbox' ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold">Inbox</h3>
              <span className="h-7 min-w-7 px-2 rounded-full bg-[#6f54ff] text-xs font-semibold flex items-center justify-center">
                {metrics.unread}
              </span>
            </div>
            {inboxItems.map((item) => (
              <article key={item.id} className="rounded-2xl border border-[#4f43aa]/40 bg-[#0e1528] px-4 py-3 flex gap-3 items-center">
                <div className="w-12 h-12 rounded-full bg-[#6f54ff] flex items-center justify-center font-bold">
                  {item.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold truncate">{item.name}</p>
                    <p className="text-xs text-[#7d86a8]">{item.time}</p>
                  </div>
                  <p className="text-[#7d86a8] text-sm truncate">{item.body}</p>
                </div>
                {item.unread > 0 ? (
                  <span className="w-6 h-6 rounded-full bg-[#6f54ff] text-xs flex items-center justify-center">{item.unread}</span>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}

        {activeTab === 'users' ? (
          <section className="space-y-4">
            <h3 className="text-2xl font-bold">Users</h3>
            <div className="rounded-2xl border border-white/10 bg-[#0d1428] p-3 sm:p-4 space-y-3">
              {memberRequests.map((request) => (
                <article key={request.id} className="rounded-2xl border border-white/10 bg-[#111a31] p-3 space-y-3">
                  <div>
                    <p className="font-semibold">{request.name}</p>
                    <p className="text-[#7d86a8] text-sm">{request.email}</p>
                  </div>
                  <div className="rounded-xl border border-[#6f54ff]/30 bg-[#1a2033] p-3 text-sm text-[#c4cceb]">{request.message}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <button className="rounded-xl py-2 font-semibold bg-emerald-500/90 hover:bg-emerald-500">Approve</button>
                    <button className="rounded-xl py-2 font-semibold bg-red-500/90 hover:bg-red-500">Reject</button>
                    <button className="rounded-xl py-2 font-semibold bg-white/10 hover:bg-white/15">Block</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === 'notify' ? (
          <section className="space-y-4">
            <h3 className="text-2xl font-bold">Send Notification</h3>
            <p className="text-[#7d86a8] text-sm">Compose a message for your members.</p>
            <div className="rounded-2xl border border-white/10 bg-[#0d1428] p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(['announcement', 'alert', 'update'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setAnnouncementType(opt)}
                    className={`rounded-xl py-3 border capitalize ${
                      announcementType === opt
                        ? 'border-[#6f54ff] bg-[#211a47] text-white'
                        : 'border-white/10 bg-[#111a31] text-[#7d86a8]'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden bg-[#111a31]">
                <AudienceRow label="All Members" selected={audience === 'all'} onClick={() => setAudience('all')} />
                <AudienceRow label="Selected Users" selected={audience === 'selected'} onClick={() => setAudience('selected')} />
                <AudienceRow label="One User" selected={audience === 'one'} onClick={() => setAudience('one')} />
              </div>
              <input
                className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff]"
                placeholder="e.g. Platform Update"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="w-full bg-[#111a31] border border-white/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#6f54ff] min-h-28"
                placeholder="Write your notification message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button className="w-full rounded-xl py-3 font-semibold bg-gradient-to-r from-[#6f54ff] to-[#5a7ff6] disabled:opacity-40" disabled={!title || !message}>
                Preview & Send
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === 'reports' ? (
          <section className="space-y-4">
            <h3 className="text-2xl font-bold">Reports</h3>
            <div className="space-y-3">
              {reports.map((report) => (
                <article key={report.id} className="rounded-2xl border border-white/10 bg-[#0e1528] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{report.name}</p>
                    <StatusPill status={report.status} />
                  </div>
                  <p className="text-sm text-[#73a9ff] mt-2">{report.type}</p>
                  <p className="text-[#7d86a8] mt-1">{report.details}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 lg:hidden border-t border-white/10 bg-[#0a0f1f]/95 backdrop-blur px-2 py-2 grid grid-cols-5">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-1 py-1 rounded-xl ${
                active ? 'text-[#9e88ff] bg-[#1d1a3c]' : 'text-[#7480a6]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[11px]">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent: 'yellow' | 'purple' | 'red' | 'green'
}) {
  const dotClass =
    accent === 'yellow'
      ? 'bg-amber-400'
      : accent === 'purple'
      ? 'bg-violet-400'
      : accent === 'red'
      ? 'bg-red-400'
      : 'bg-emerald-400'
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1428] p-4">
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg bg-[#182243] flex items-center justify-center text-[#9f8bff]">{icon}</div>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      </div>
      <p className="text-4xl font-bold mt-4">{value}</p>
      <p className="text-[#7d86a8]">{label}</p>
    </div>
  )
}

function QuickButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-white/10 bg-[#0d1428] px-4 py-3 flex items-center justify-center gap-2 text-[#9ea8cc] hover:text-white">
      {icon}
      {label}
    </button>
  )
}

function AudienceRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full px-4 py-3 flex items-center justify-between">
      <span>{label}</span>
      <span className={`w-5 h-5 rounded-full border ${selected ? 'border-[#7e66ff] bg-[#7e66ff]' : 'border-white/20'}`} />
    </button>
  )
}

function StatusPill({ status }: { status: ReportItem['status'] }) {
  if (status === 'new') return <span className="px-2 py-1 rounded-full text-xs bg-sky-500/20 text-sky-300">New</span>
  if (status === 'in_review')
    return <span className="px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-300">In Review</span>
  return <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-300">Resolved</span>
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/app/AppShell'
import { useAuth } from '@/components/AuthProvider'
import { MemoryPanel } from '@/components/dashboard/MemoryPanel'

interface AnalysisRow {
  id: string
  name: string
  summary: string | null
  providerUsed: string | null
  modelType: string | null
  rowCount: number | null
  datasetName: string | null
  createdAt: number
}

interface DatasetRow {
  id: string
  name: string
  fileName: string
  sizeBytes: number
  rowCount: number | null
  version: number
  createdAt: number
}

interface MemberRow {
  id: string
  role: string
  name: string
  email: string
  joinedAt: number | null
}

interface InviteRow {
  id: string
  role: string
  email: string
  invitedAt: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function DashboardPage() {
  const { user, org } = useAuth()
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([])
  const [datasets, setDatasets] = useState<DatasetRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member')
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const scope = org ? 'org' : 'personal'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [analysesRes, datasetsRes] = await Promise.all([
        fetch(`/api/analyses?scope=${scope}`, { credentials: 'same-origin' }),
        fetch(`/api/datasets?scope=${scope}`, { credentials: 'same-origin' }),
      ])
      const [analysesData, datasetsData] = await Promise.all([analysesRes.json(), datasetsRes.json()])
      setAnalyses(analysesData.analyses ?? [])
      setDatasets(datasetsData.datasets ?? [])
    } catch {
      setAnalyses([])
      setDatasets([])
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!org) return
    void (async () => {
      try {
        const res = await fetch('/api/auth/members', { credentials: 'same-origin' })
        const data = await res.json()
        if (data.success) {
          setMembers(data.members ?? [])
          setInvites(data.invites ?? [])
        }
      } catch {
        // Non-fatal.
      }
    })()
  }, [org])

  async function onInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setInviteMessage(null)
    setInviting(true)
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setInviteError(data.error ?? 'Could not send invite.')
        return
      }
      setInviteMessage(`Invite sent to ${data.invite.email}.`)
      setInviteEmail('')
      const membersRes = await fetch('/api/auth/members', { credentials: 'same-origin' })
      const membersData = await membersRes.json()
      if (membersData.success) setInvites(membersData.invites ?? [])
    } catch {
      setInviteError('Network error. Try again.')
    } finally {
      setInviting(false)
    }
  }

  return (
    <AppShell active="dashboard">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome back, {user?.name.split(' ')[0]}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {org ? `${org.name} workspace` : 'Personal workspace'} · your analyses and datasets live here.
            </p>
          </div>
          <Link
            href="/upload"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New analysis
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="text-3xl font-bold text-emerald-400">{loading ? '…' : datasets.length}</div>
            <div className="text-xs text-zinc-500 mt-1">Datasets</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="text-3xl font-bold text-emerald-400">{loading ? '…' : analyses.length}</div>
            <div className="text-xs text-zinc-500 mt-1">Analyses in memory</div>
          </div>
        </div>

        {/* Knowledge base + RAG retrieval */}
        <MemoryPanel scope={scope} />

        {/* Enterprise: members + invites */}
        {org && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/70 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Team members</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{org.name}</p>
              </div>
              {(org.role === 'owner' || org.role === 'admin') && (
                <span className="text-[11px] text-emerald-400 bg-emerald-950/50 border border-emerald-900/50 px-2 py-0.5 rounded-full">
                  You can invite
                </span>
              )}
            </div>
            <div className="p-5 space-y-5">
              {(org.role === 'owner' || org.role === 'admin') && (
                <form onSubmit={onInvite} className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="email"
                    required
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-900/40"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-zinc-950 text-sm font-semibold transition-colors"
                  >
                    {inviting ? 'Sending…' : 'Invite'}
                  </button>
                </form>
              )}
              {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
              {inviteMessage && <p className="text-xs text-emerald-400">{inviteMessage}</p>}

              <ul className="divide-y divide-zinc-800/60">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 flex items-center justify-center text-xs font-bold uppercase">
                        {m.name.slice(0, 1)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-zinc-100">{m.name}</div>
                        <div className="text-xs text-zinc-500">{m.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-zinc-500">{formatDate(m.joinedAt)}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        m.role === 'owner'
                          ? 'text-emerald-300 border-emerald-700/50 bg-emerald-950/40'
                          : m.role === 'admin'
                            ? 'text-indigo-300 border-indigo-700/50 bg-indigo-950/40'
                            : 'text-zinc-400 border-zinc-700 bg-zinc-900'
                      }`}>
                        {m.role}
                      </span>
                    </div>
                  </li>
                ))}
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-2.5 opacity-70">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs text-zinc-400 uppercase">
                        ?
                      </span>
                      <div>
                        <div className="text-sm font-medium text-zinc-300">{i.email}</div>
                        <div className="text-xs text-zinc-500">Pending invite</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-zinc-500">{formatDate(i.invitedAt)}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-700/50 bg-amber-950/40 text-amber-300">
                        invited
                      </span>
                    </div>
                  </li>
                ))}
                {members.length === 0 && invites.length === 0 && (
                  <li className="py-6 text-center text-sm text-zinc-600">
                    No team members yet — invite someone to collaborate.
                  </li>
                )}
              </ul>
            </div>
          </section>
        )}

        {/* Recent analyses (memory) */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent analyses</h2>
            <span className="text-[11px] text-zinc-500">{analyses.length} saved</span>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 rounded-xl border border-zinc-800 bg-zinc-900/40 animate-pulse" />
              ))}
            </div>
          ) : analyses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center">
              <p className="text-sm text-zinc-300">No analyses saved yet.</p>
              <p className="text-xs text-zinc-600 mt-1">Run your first analysis and it will appear here automatically.</p>
              <Link
                href="/upload"
                className="inline-block mt-4 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
              >
                Start an analysis →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {analyses.map((a) => (
                <Link
                  key={a.id}
                  href={`/analyse?id=${a.id}`}
                  className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 hover:border-emerald-500/40 hover:bg-zinc-900/70 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-zinc-100 truncate group-hover:text-white">
                      {a.name}
                    </div>
                    <span className="text-[11px] text-zinc-500 shrink-0">{formatDate(a.createdAt)}</span>
                  </div>
                  {a.summary && (
                    <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed line-clamp-2">
                      {a.summary}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    {a.modelType && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-300">
                        {a.modelType}
                      </span>
                    )}
                    {a.providerUsed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {a.providerUsed}
                      </span>
                    )}
                    {a.rowCount != null && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {a.rowCount.toLocaleString()} rows
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Datasets */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Datasets</h2>
            <span className="text-[11px] text-zinc-500">{datasets.length} stored</span>
          </div>
          {loading ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 h-16 animate-pulse" />
          ) : datasets.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 px-6 py-6 text-center text-sm text-zinc-600">
              No datasets yet.
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800/60 overflow-hidden">
              {datasets.slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-100 truncate">{d.name}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {d.fileName} · {formatBytes(d.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {d.rowCount != null && (
                      <span className="text-[11px] text-zinc-400">{d.rowCount.toLocaleString()} rows</span>
                    )}
                    <span className="text-[11px] text-zinc-600">{formatDate(d.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}

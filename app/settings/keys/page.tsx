'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app/AppShell'
import { useAuth } from '@/components/AuthProvider'

interface ProviderInfo {
  id: string
  label: string
  defaultModel: string
  platformConfigured: boolean
  hasUserKey: boolean
  userHint: string | null
  hasOrgKey: boolean
  orgHint: string | null
}

interface KeysResponse {
  providers: ProviderInfo[]
  preferred: string
  order: string[]
}

const PROVIDER_LOGO: Record<string, string> = {
  groq: '⚡',
  mistral: '🌀',
  openai: '◯',
  anthropic: '✳',
}

export default function SettingsKeysPage() {
  const { org } = useAuth()
  const [state, setState] = useState<KeysResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [preferred, setPreferred] = useState('groq')
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [scope, setScope] = useState<'user' | 'org'>('user')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preferredCharts, setPreferredCharts] = useState<string[]>([])

  const canManageOrg = org && (org.role === 'owner' || org.role === 'admin')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/keys', { credentials: 'same-origin' })
      const data = await res.json()
      if (data.success) {
        setState(data)
        setPreferred(data.preferred ?? 'groq')
      }
    } catch {
      setError('Could not load key settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/preferences', { credentials: 'same-origin' })
      const data = await res.json()
      if (data.success && data.preferences?.preferred_charts) {
        try {
          setPreferredCharts(JSON.parse(data.preferences.preferred_charts))
        } catch {
          // ignore parsing error
        }
      }
    } catch {
      // safe fallback
    }
  }, [])

  useEffect(() => {
    void load()
    void loadPreferences()
  }, [load, loadPreferences])

  async function onSave(provider: string) {
    const apiKey = inputs[provider]?.trim()
    if (!apiKey) {
      setError('Paste an API key first.')
      return
    }
    setBusy(provider)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/settings/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, scope }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Could not save key.')
        return
      }
      setMessage(
        `${state?.providers.find((p) => p.id === provider)?.label} key saved (${scope === 'org' ? 'workspace' : 'personal'}). It will be used for interpretations and summaries.`,
      )
      setInputs((prev) => ({ ...prev, [provider]: '' }))
      await load()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(null)
    }
  }

  async function onRemove(provider: string) {
    setBusy(provider)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/settings/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, scope }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Could not remove key.')
        return
      }
      setMessage('Key removed.')
      await load()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(null)
    }
  }

  async function onPreferred(next: string) {
    setPreferred(next)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/settings/preferred', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: next }),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Could not update preference.')
        return
      }
      setMessage(`Preferred provider set to ${next}.`)
    } catch {
      setError('Could not update preference.')
    }
  }

  async function togglePreferredChart(chartType: string) {
    const updated = preferredCharts.includes(chartType)
      ? preferredCharts.filter((c) => c !== chartType)
      : [...preferredCharts, chartType]

    setPreferredCharts(updated)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/settings/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'preferred_charts', value: JSON.stringify(updated) }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Could not update preferred charts.')
      } else {
        setMessage('Preferred charts updated.')
      }
    } catch {
      setError('Network error.')
    }
  }

  return (
    <AppShell active="keys">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 sm:py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI keys</h1>
          <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
            StatLab uses <span className="text-emerald-400">Groq</span> and{' '}
            <span className="text-emerald-400">Mistral</span> by default. Bring your own{' '}
            <span className="text-zinc-200">OpenAI</span> or{' '}
            <span className="text-zinc-200">Claude</span> keys to use your own account and
            quotas. Keys are encrypted and never shown back to you.
          </p>
        </div>

        {org && canManageOrg && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Key scope</div>
              <div className="text-xs text-zinc-500">
                {scope === 'org'
                  ? `Saving to ${org.name} workspace (shared with the team).`
                  : 'Saving to your personal account.'}
              </div>
            </div>
            <button
              onClick={() => setScope((s) => (s === 'user' ? 'org' : 'user'))}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-emerald-500/50 text-xs font-medium text-zinc-200 transition-colors"
            >
              {scope === 'user' ? 'Save to workspace' : 'Save to me'}
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            Preferred provider
          </div>
          <div className="flex flex-wrap gap-2">
            {(state?.order ?? ['groq', 'mistral', 'openai', 'anthropic']).map((id) => (
              <button
                key={id}
                onClick={() => onPreferred(id)}
                aria-pressed={preferred === id}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  preferred === id
                    ? 'bg-emerald-600/15 text-emerald-300 border-emerald-600/40'
                    : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white'
                }`}
              >
                {state?.providers.find((p) => p.id === id)?.label ?? id}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2.5 text-xs text-red-500">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2.5 text-xs text-emerald-400">
            {message}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl border border-zinc-800 bg-zinc-900/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {(state?.providers ?? []).map((provider) => {
              const hasKey = scope === 'org' ? provider.hasOrgKey : provider.hasUserKey
              const hint = scope === 'org' ? provider.orgHint : provider.userHint
              return (
                <div key={provider.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-lg">
                        {PROVIDER_LOGO[provider.id] ?? '🔑'}
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-white">{provider.label}</div>
                        <div className="text-xs text-zinc-500 font-mono">{provider.defaultModel}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {provider.platformConfigured && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-950/40 text-emerald-300">
                          platform default
                        </span>
                      )}
                      {hasKey && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                          key set · …{hint}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3.5 flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="password"
                      placeholder={hasKey ? 'Paste a new key to replace' : `Paste your ${provider.label} key`}
                      value={inputs[provider.id] ?? ''}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-900/40"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => onSave(provider.id)}
                        disabled={busy === provider.id}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-zinc-950 text-sm font-semibold transition-colors"
                      >
                        {busy === provider.id ? 'Saving…' : 'Save'}
                      </button>
                      {hasKey && (
                        <button
                          onClick={() => onRemove(provider.id)}
                          disabled={busy === provider.id}
                          className="px-3 py-2 rounded-lg border border-zinc-700 hover:border-red-700/60 hover:text-red-400 text-sm text-zinc-400 transition-colors disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Visualization Preferences</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Boost the confidence and placement of your favorite chart types. The Visualization Intelligence Engine will prioritize these types when scoring candidates.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { id: 'histogram', label: 'Histogram' },
              { id: 'boxplot', label: 'Box Plot' },
              { id: 'scatter', label: 'Scatter Plot' },
              { id: 'bar', label: 'Bar Chart' },
              { id: 'line', label: 'Line Chart' },
              { id: 'heatmap', label: 'Heatmap' },
              { id: 'pie', label: 'Pie Chart' },
            ].map((chart) => {
              const isChecked = preferredCharts.includes(chart.id)
              return (
                <button
                  key={chart.id}
                  onClick={() => togglePreferredChart(chart.id)}
                  aria-pressed={isChecked}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                    isChecked
                      ? 'bg-emerald-600/15 text-emerald-300 border-emerald-600/40'
                      : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white'
                  }`}
                >
                  <span>{chart.label}</span>
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] font-bold ${
                    isChecked ? 'border-emerald-500 bg-emerald-600 text-zinc-950' : 'border-zinc-700 bg-zinc-950'
                  }`}>
                    {isChecked ? '✓' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-4">
          <div className="text-xs text-zinc-500 leading-relaxed">
            <span className="text-zinc-300 font-semibold">How it works:</span> when you run an
            analysis, StatLab tries your preferred provider first — using your key if you added
            one, otherwise your organization&apos;s key, otherwise the platform default (Groq →
            Mistral → OpenAI → Claude). Keys are encrypted at rest with AES-256-GCM and only the
            last four characters are ever shown.
          </div>
        </div>
      </div>
    </AppShell>
  )
}

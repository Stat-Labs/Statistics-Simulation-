'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { Logo, LogoMark } from '@/components/ui/Logo'
import { useAuth } from '@/components/AuthProvider'

const PIPELINE_STEPS = [
  { n: '01', title: 'Upload', desc: 'Drop a CSV, Excel or JSON file — from kilobytes to millions of rows.' },
  { n: '02', title: 'Validate & clean', desc: 'Automatic type detection, missing-value analysis, duplicate and outlier handling.' },
  { n: '03', title: 'Profile', desc: 'An AI data scientist scans your data and decides what matters most.' },
  { n: '04', title: 'Analyse', desc: 'Descriptive stats, hypothesis tests, correlations, regressions and ML models — computed by a Python engine.' },
  { n: '05', title: 'Interpret', desc: 'Every number translated into plain-English business insights and recommendations.' },
  { n: '06', title: 'Remember', desc: 'Every dataset and analysis is stored so you can compare months later without re-uploading.' },
]

const FEATURES = [
  {
    icon: '📊',
    title: 'AI Statistician',
    desc: 'Automatically picks the right tests, checks assumptions, and explains why — in both plain and technical language.',
  },
  {
    icon: '🤖',
    title: 'Auto Machine Learning',
    desc: 'Trains and compares multiple models, tunes hyperparameters, cross-validates, and ranks the best — never just one.',
  },
  {
    icon: '📈',
    title: 'Forecasting',
    desc: 'Detects temporal datasets and generates trends, seasonality, forecasts and prediction intervals automatically.',
  },
  {
    icon: '🧠',
    title: 'Long-term memory',
    desc: 'Your datasets, analyses, KPIs and preferences are saved — ask “how does churn compare to three months ago?”',
  },
  {
    icon: '🔑',
    title: 'Bring your own keys',
    desc: 'Use your own OpenAI or Claude keys for interpretations, or the fast built-in Groq & Mistral defaults.',
  },
  {
    icon: '🛡️',
    title: 'Enterprise-ready',
    desc: 'Organisations, teams, roles, audit logs and encrypted secrets. Postgres on Render, object storage that swaps to S3.',
  },
  {
    icon: '🧾',
    title: 'Reports & presentations',
    desc: 'One-click executive reports and slide decks with speaker notes, straight from the analysis.',
  },
  {
    icon: '💬',
    title: 'Natural language dashboards',
    desc: '“Add a regional comparison”, “show top 10 customers” — your dashboards respond to words.',
  },
]

export default function LandingPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const reduceMotion = useReducedMotion()

  const fade = (delay = 0) => ({
    initial: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-60px' },
    transition: { duration: 0.5, delay },
  })

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 selection:bg-emerald-500/20 antialiased">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" aria-label="StatLab home">
            <Logo subtitle="AI Data Scientist" />
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
            <Link href="#how" className="hover:text-white transition-colors">How it works</Link>
            <Link href="#features" className="hover:text-white transition-colors">Features</Link>
            <Link href="#plans" className="hover:text-white transition-colors">Personal vs Enterprise</Link>
          </nav>
          <div className="flex items-center gap-2.5">
            {!loading && user ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm text-zinc-300 hover:text-white px-3 py-2 rounded-lg transition-colors"
                >
                  Dashboard
                </Link>
                <button
                  onClick={() => router.push('/upload')}
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 transition-colors shadow-sm"
                >
                  New analysis
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm text-zinc-300 hover:text-white px-3 py-2 rounded-lg transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 transition-colors shadow-sm"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60rem 30rem at 50% -10%, rgba(16,185,129,0.18), transparent 60%), radial-gradient(40rem 20rem at 85% 10%, rgba(99,102,241,0.12), transparent 60%)',
          }}
        />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
          <motion.div {...fade(0)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-300">
              <LogoMark size={14} />
              Your AI data scientist team
            </span>
          </motion.div>
          <motion.h1
            {...fade(0.05)}
            className="mt-6 text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05]"
          >
            Upload a dataset.
            <br />
            <span className="text-emerald-400">Get world-class insights.</span>
          </motion.h1>
          <motion.p
            {...fade(0.1)}
            className="mt-6 text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed"
          >
            StatLab is a team of senior statisticians, ML engineers and business analysts in one
            application. It cleans your data, runs the right analyses, explains every result in
            plain English, and remembers everything — so you never start from scratch.
          </motion.p>
          <motion.div
            {...fade(0.15)}
            className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link
              href={user ? '/upload' : '/signup'}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold transition-all shadow-lg shadow-emerald-950/40 active:scale-[0.99]"
            >
              {user ? 'Start an analysis' : 'Get started free — Personal'}
            </Link>
            <Link
              href={user ? '/dashboard' : '/signup/enterprise'}
              className="w-full sm:w-auto px-6 py-3 rounded-xl border border-zinc-700 hover:border-emerald-500/60 hover:bg-zinc-900 text-sm font-semibold text-zinc-200 transition-all active:scale-[0.99]"
            >
              For Enterprise
            </Link>
            {!user && (
              <Link
                href="/login"
                className="w-full sm:w-auto px-4 py-3 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Sign in →
              </Link>
            )}
          </motion.div>

          <motion.div
            {...fade(0.2)}
            className="mt-14 grid grid-cols-3 gap-4 max-w-2xl mx-auto"
          >
            {[
              ['6+', 'analysis engines'],
              ['4', 'AI providers'],
              ['100%', 'explainable results'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-4">
                <div className="text-2xl font-bold text-emerald-400">{value}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <motion.div {...fade(0)} className="max-w-2xl">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            From raw file to board-ready insight
          </h2>
          <p className="mt-3 text-zinc-400 text-sm leading-relaxed">
            No configuration marathon. StatLab decides what to run, then shows you why it chose
            each analysis and what it means for your business.
          </p>
        </motion.div>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PIPELINE_STEPS.map((step, i) => (
            <motion.div
              key={step.n}
              {...fade(0.05 * i)}
              className="group rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 hover:border-emerald-500/40 hover:bg-zinc-900/70 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-emerald-400">{step.n}</span>
                <span className="h-px flex-1 bg-zinc-800" />
              </div>
              <h3 className="mt-4 font-semibold text-white">{step.title}</h3>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="border-y border-zinc-800/80 bg-zinc-900/20 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <motion.div {...fade(0)} className="max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Built like a world-class data science team
            </h2>
            <p className="mt-3 text-zinc-400 text-sm leading-relaxed">
              Every feature exists because a real analyst would do it — automatically, accurately
              and with reasoning you can audit.
            </p>
          </motion.div>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                {...fade(0.04 * i)}
                className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 hover:border-zinc-700 transition-colors"
              >
                <div className="text-2xl" aria-hidden>{feature.icon}</div>
                <h3 className="mt-3 font-semibold text-white text-sm">{feature.title}</h3>
                <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Personal vs Enterprise ──────────────────────────── */}
      <section id="plans" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <motion.div {...fade(0)} className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Choose how you work</h2>
          <p className="mt-3 text-zinc-400 text-sm">
            Start solo in minutes, or spin up a workspace for your whole organisation.
          </p>
        </motion.div>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          <motion.div
            {...fade(0)}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-7 flex flex-col"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Personal</div>
            <h3 className="mt-2 text-xl font-bold">For individuals</h3>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed flex-1">
              Analysts, students and researchers. Full AI data science, your own keys, and
              private long-term memory of everything you analyse.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-zinc-300">
              {['Unlimited analyses', 'BYOK OpenAI & Claude', 'Private memory', 'PDF reports'].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href={user ? '/upload' : '/signup'}
              className="mt-7 w-full text-center py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold transition-colors"
            >
              {user ? 'Open dashboard' : 'Sign up — Personal'}
            </Link>
          </motion.div>

          <motion.div
            {...fade(0.06)}
            className="rounded-2xl border border-emerald-500/40 bg-zinc-900/60 p-7 flex flex-col shadow-lg shadow-emerald-950/20"
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Enterprise</div>
              <span className="rounded-full bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] text-emerald-300">
                Organisations
              </span>
            </div>
            <h3 className="mt-2 text-xl font-bold">For teams</h3>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed flex-1">
              Shared workspaces with roles, invites, organisation-wide AI keys, project history,
              audit logs — ready for the whole company.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-zinc-300">
              {['Team workspaces & invites', 'Roles: owner, admin, member', 'Org-wide AI keys', 'Audit logs'].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href={user ? '/dashboard' : '/signup/enterprise'}
              className="mt-7 w-full text-center py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold transition-colors"
            >
              {user ? 'Open workspace' : 'Sign up — Enterprise'}
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <section className="border-t border-zinc-800/80">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <motion.div {...fade(0)}>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
              Stop asking <span className="text-emerald-400">“what should I analyse next?”</span>
            </h2>
            <p className="mt-4 text-zinc-400 text-sm sm:text-base">
              StatLab already knows — it analyses, explains, recommends and remembers.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href={user ? '/upload' : '/signup'}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold transition-all shadow-lg shadow-emerald-950/40"
              >
                Start analysing free
              </Link>
              <Link
                href="/signup/enterprise"
                className="w-full sm:w-auto px-6 py-3 rounded-xl border border-zinc-700 hover:border-emerald-500/60 hover:bg-zinc-900 text-sm font-semibold text-zinc-200 transition-colors"
              >
                Talk to your team
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/80">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size={20} />
          <p className="text-xs text-zinc-600">
            © {new Date().getFullYear()} StatLab · Statistical analysis, powered by AI.
          </p>
          <div className="flex items-center gap-5 text-xs text-zinc-500">
            <Link href="/login" className="hover:text-zinc-300 transition-colors">Sign in</Link>
            <Link href="/signup" className="hover:text-zinc-300 transition-colors">Sign up</Link>
            <Link href="/signup/enterprise" className="hover:text-zinc-300 transition-colors">Enterprise</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

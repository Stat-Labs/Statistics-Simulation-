'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Logo } from '@/components/ui/Logo'

const NAV = [
  {
    id: 'dashboard',
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-7h6v7h3a1 1 0 001-1V10" />
      </svg>
    ),
  },
  {
    id: 'visualize',
    href: '/visualize',
    label: 'Visualize',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6m4 6V9m4 10V5M5 19h16a1 1 0 001-1V6a1 1 0 00-1-1H5a1 1 0 00-1 1v12a1 1 0 001 1z" />
      </svg>
    ),
  },
  {
    id: 'upload',
    href: '/upload',
    label: 'New analysis',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'keys',
    href: '/settings/keys',
    label: 'Settings',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export function AppShell({
  children,
  active,
}: {
  children: React.ReactNode
  active: string
}) {
  const { user, org, logout } = useAuth()
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
      <div className="flex min-h-screen">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40">
          <div className="h-16 flex items-center px-5 border-b border-zinc-800/80">
            <Link href="/" aria-label="StatLab home">
              <Logo size={22} />
            </Link>
          </div>
          <nav aria-label="Main" className="flex-1 px-3 py-4 space-y-1">
            {NAV.map((item) => {
              const isActive = active === item.id || pathname === item.href
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-emerald-600/15 text-emerald-300 border border-emerald-600/30'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white border border-transparent'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {org && (
            <div className="mx-3 mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                {org.plan === 'free' ? 'Free' : org.plan} workspace
              </div>
              <div className="mt-1 text-sm font-semibold text-white truncate">{org.name}</div>
              <div className="text-[11px] text-zinc-500">You are {org.role}</div>
            </div>
          )}

          {user && (
            <div className="border-t border-zinc-800/80 px-3 py-3 flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center text-xs font-bold uppercase">
                {user.name.slice(0, 1)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white truncate">{user.name}</div>
                <div className="text-[11px] text-zinc-500 truncate">{user.email}</div>
              </div>
              <button
                onClick={() => logout()}
                aria-label="Sign out"
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </aside>

        {/* Mobile topbar */}
        <div className="lg:hidden fixed top-0 inset-x-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
          <div className="flex items-center justify-between px-4 h-14">
            <Link href="/" aria-label="StatLab home">
              <Logo size={20} />
            </Link>
            <button
              onClick={() => logout()}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Sign out
            </button>
          </div>
          <nav aria-label="Main" className="flex gap-1 px-3 pb-2">
            {NAV.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active === item.id ? 'page' : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  active === item.id
                    ? 'bg-emerald-600/15 text-emerald-300'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 lg:pt-0 pt-[104px]">
          {children}
        </main>
      </div>
    </div>
  )
}

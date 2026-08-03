'use client'

import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'

export function AuthCard({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 antialiased flex flex-col items-center justify-center px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(50rem 25rem at 50% -10%, rgba(16,185,129,0.14), transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Link href="/" aria-label="StatLab home">
            <Logo size={28} />
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7 shadow-xl">
          {eyebrow && (
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              {eyebrow}
            </div>
          )}
          <h1 className="mt-1.5 text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-zinc-500">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({
  label,
  type = 'text',
  autoComplete,
  placeholder,
  error,
  ...props
}: {
  label: string
  type?: string
  autoComplete?: string
  placeholder?: string
  error?: string | null
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-zinc-400">{label}</span>
      <input
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={`mt-1.5 w-full rounded-lg border bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 transition-colors ${
          error
            ? 'border-red-800/70 focus:border-red-600 focus:ring-red-900/40'
            : 'border-zinc-800 focus:border-emerald-500 focus:ring-emerald-900/40'
        }`}
        {...props}
      />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  )
}

export function SubmitButton({
  children,
  loading,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
  onClick?: React.MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="submit"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 text-sm font-semibold transition-all shadow-sm active:scale-[0.995] inline-flex items-center justify-center gap-2"
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2.5 text-xs text-red-500"
    >
      {message}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { AuthCard, Field, SubmitButton, FormError } from '@/components/auth/AuthCard'
import { useAuth } from '@/components/AuthProvider'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading, refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const next = searchParams.get('next') ?? '/dashboard'

  useEffect(() => {
    if (!loading && user) router.replace(next)
  }, [loading, user, next, router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Sign in failed. Try again.')
        return
      }
      await refresh()
      router.replace(next)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in to StatLab"
      subtitle="Continue to your analyses, memory and workspaces."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
            Create an account
          </Link>{' '}
          ·{' '}
          <Link href="/signup/enterprise" className="text-emerald-400 hover:text-emerald-300">
            For enterprise
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <FormError message={error} />
        <SubmitButton loading={submitting}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

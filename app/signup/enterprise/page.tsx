'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthCard, Field, SubmitButton, FormError } from '@/components/auth/AuthCard'
import { useAuth } from '@/components/AuthProvider'

export default function EnterpriseSignupPage() {
  const router = useRouter()
  const { user, loading, refresh } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [loading, user, router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (orgName.trim().length < 2) {
      setError('Enter your organization name.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Password must contain at least one letter and one number.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, accountType: 'enterprise', orgName }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Sign up failed. Try again.')
        return
      }
      await refresh()
      router.replace('/dashboard')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      eyebrow="Enterprise workspace"
      title="Create your organisation"
      subtitle="A shared workspace for your team — with roles, invites and org-wide AI keys."
      footer={
        <>
          Just you?{' '}
          <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
            Create a personal account
          </Link>
          <br />
          Already have an account?{' '}
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Organization name"
          placeholder="Acme Analytics Inc."
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
        />
        <Field
          label="Your full name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Field
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@acme.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters, letters + numbers"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <FormError message={error} />
        <SubmitButton loading={submitting}>Create organisation</SubmitButton>
      </form>
    </AuthCard>
  )
}

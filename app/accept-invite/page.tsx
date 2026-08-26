'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { AuthCard, SubmitButton, FormError } from '@/components/auth/AuthCard'
import { useAuth } from '@/components/AuthProvider'
import { LogoMark } from '@/components/ui/Logo'

function AcceptInviteInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading, refresh } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const token = searchParams.get('token') ?? ''

  useEffect(() => {
    if (done) router.replace('/dashboard')
  }, [done, router])

  if (!token) {
    return (
      <AuthCard eyebrow="Invitation" title="Missing invitation link">
        <p className="text-sm text-zinc-400">
          This link is missing its invitation token. Ask the person who invited you to resend it.
        </p>
      </AuthCard>
    )
  }

  async function onAccept() {
    setError(null)
    if (loading) return
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Could not accept this invitation.')
        return
      }
      await refresh()
      setDone(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      eyebrow="Team invitation"
      title="Join your team on StatLab"
      subtitle="You've been invited to an organization workspace. Accept to start collaborating on datasets, analyses and reports."
      footer={
        <>
          <Link href="/" className="text-emerald-400 hover:text-emerald-300">
            ← Back to StatLab
          </Link>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          <LogoMark size={26} />
        </div>
        <FormError message={error} />
        <div className="w-full">
          <SubmitButton loading={submitting || loading} onClick={onAccept}>
            {loading ? 'Checking your session…' : user ? 'Accept invitation' : 'Sign in to accept'}
          </SubmitButton>
        </div>
        {!user && (
          <p className="text-xs text-zinc-600">
            You&apos;ll sign in (or create a free account) before accepting.
          </p>
        )}
      </div>
    </AuthCard>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteInner />
    </Suspense>
  )
}

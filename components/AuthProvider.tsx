'use client'

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface SessionUser {
  id: string
  email: string
  name: string
  accountType: 'personal' | 'enterprise'
  avatarUrl?: string | null
  preferredAiProvider?: string
}

export interface SessionOrg {
  id: string
  name: string
  slug: string
  plan: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export interface AuthState {
  user: SessionUser | null
  orgs: SessionOrg[]
  org: SessionOrg | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [orgs, setOrgs] = useState<SessionOrg[]>([])
  const [org, setOrg] = useState<SessionOrg | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' })
      const data = await res.json()
      setUser(data?.user ?? null)
      setOrgs(data?.orgs ?? [])
      setOrg(data?.org ?? null)
    } catch {
      setUser(null)
      setOrgs([])
      setOrg(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // Ignore — local state resets regardless.
    }
    setUser(null)
    setOrgs([])
    setOrg(null)
    router.push('/')
  }, [router])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, orgs, org, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

'use client'

import React, { createContext, useContext } from 'react'
import { useStatLab as useStatLabHook } from '@/lib/useStatLab'

const StatLabContext = createContext<ReturnType<typeof useStatLabHook> | null>(null)

export function StatLabProvider({ children }: { children: React.ReactNode }) {
  const store = useStatLabHook()
  return (
    <StatLabContext.Provider value={store}>
      {children}
    </StatLabContext.Provider>
  )
}

export function useStatLab() {
  const context = useContext(StatLabContext)
  if (!context) {
    throw new Error('useStatLab must be used within a StatLabProvider')
  }
  return context
}
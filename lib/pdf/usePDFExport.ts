'use client'

import { useState, useCallback } from 'react'
import { generatePDF } from '@/lib/pdf/generator'
import type { PDFGenerationOptions, PDFGenerationResult } from '@/lib/types'

export function usePDFExport() {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exportPDF = useCallback(async (
    options: PDFGenerationOptions
  ): Promise<PDFGenerationResult> => {
    setIsGenerating(true)
    setError(null)
    try {
      const result = await generatePDF(options)
      if (!result.success && result.error) {
        setError(result.error)
      }
      return result
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      return { success: false, error: message }
    } finally {
      setIsGenerating(false)
    }
  }, [])

  return { exportPDF, isGenerating, error }
}

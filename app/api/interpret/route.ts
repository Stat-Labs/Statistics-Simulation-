import { NextRequest, NextResponse } from 'next/server'
import { runInterpreter } from '@/lib/ai/interpreterPrompt'
import { rateLimit, getRateLimitIdentifier } from '@/lib/utils/rateLimit'
import type { InterpretRequestBody, InterpretResponseBody } from '@/lib/types'

/**
 * POST /api/interpret
 * Returns plain-English AI interpretation of computed results.
 * Never returns success: false for AI failures — falls back to
 * generic summary so the results page always renders.
 * @body { schema: DatasetSchema, result: AnalysisResult }
 * @returns { success, summary, perAnalysis, provider, fallbackUsed }
 */
export async function POST(request: NextRequest) {
  try {
    const identifier = getRateLimitIdentifier(request)
    const { allowed } = rateLimit(identifier, 20, 60_000)
    if (!allowed) {
      return Response.json(
        { success: false, error: 'Too many requests. Wait a moment.' },
        {
          status: 429,
          headers: { 'Retry-After': '60' },
        }
      )
    }

    const body = await request.json() as InterpretRequestBody

    if (!body.schema) {
      return NextResponse.json(
        { success: false, error: 'Schema is required' } as InterpretResponseBody,
        { status: 400 }
      )
    }

    if (!body.result) {
      return NextResponse.json(
        { success: false, error: 'Result is required' } as InterpretResponseBody,
        { status: 400 }
      )
    }

    const { summary, perAnalysis, provider, fallbackUsed } = await runInterpreter(body.schema, body.result)

    return NextResponse.json({
      success: true,
      summary,
      perAnalysis,
      provider,
      fallbackUsed,
    })
  } catch {
    return NextResponse.json({
      success: true,
      summary: 'Analysis complete. Review the charts for full insights.',
      perAnalysis: [],
      provider: null,
      fallbackUsed: true,
    })
  }
}

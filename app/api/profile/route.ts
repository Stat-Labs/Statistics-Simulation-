import { NextRequest, NextResponse } from 'next/server'
import { runProfiler } from '@/lib/ai/profilerPrompt'
import { toErrorResponse } from '@/lib/utils/errors'
import { validateSchema } from '@/lib/utils/validation'
import { rateLimit, getRateLimitIdentifier } from '@/lib/utils/rateLimit'
import type { ProfileRequestBody } from '@/lib/types'

/**
 * POST /api/profile
 * Smart Analyse entry point. Sends schema to AI profiler.
 * Returns analysisMap (what to compute) + chartSuggestions (what to render).
 * Call this before /api/analyse in Smart mode.
 * @body { schema: DatasetSchema }
 * @returns { success, output: { analysisMap, chartSuggestions } }
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

    const body = await request.json() as ProfileRequestBody

    const schemaError = validateSchema(body.schema)
    if (schemaError) {
      return Response.json({ success: false, error: schemaError }, { status: 400 })
    }

    const output = await runProfiler(body.schema)

    return NextResponse.json({
      success: true,
      output,
    })
  } catch (err) {
    return Response.json(toErrorResponse(err), { status: 500 })
  }
}

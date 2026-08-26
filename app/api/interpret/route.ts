import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getRateLimitIdentifier } from '@/lib/utils/rateLimit'
import type { InterpretRequestBody } from '@/lib/types'
import { runInterpreter } from '@/lib/ai/interpreterPrompt'
import { buildMemoryQuery } from '@/lib/ai/rag'
import { getSession } from '@/lib/auth/session'
import { getPreferredProvider } from '@/lib/ai/resolve'
import { retrieveMemory, type Scope } from '@/lib/memory/store'

export async function POST(request: NextRequest) {
  try {
    const identifier = getRateLimitIdentifier(request)
    const { allowed } = rateLimit(identifier, 20, 60_000)
    if (!allowed) {
      return Response.json(
        { success: false, error: 'Too many requests. Wait a moment.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json() as InterpretRequestBody
    if (!body.schema || !body.result) {
      return NextResponse.json(
        { success: false, error: 'Schema and Result are required inputs' },
        { status: 400 }
      )
    }

    // Resolve BYOK-aware AI context (user keys → org keys → platform defaults).
    const session = await getSession(request)
    const preferredProvider = await getPreferredProvider(session?.user.id)
    const ctx = {
      userId: session?.user.id,
      orgId: session?.org?.id ?? null,
      preferredProvider,
    }

    // Retrieval-before-answer: pull relevant workspace memory (past findings,
    // KPIs, glossary) for this dataset/columns so the interpretation builds on
    // what StatLab already knows. Never blocks interpretation on failure.
    let memory = null
    if (session?.user.id) {
      try {
        const scope: Scope = session.org
          ? { ownerId: session.user.id, orgId: session.org.id }
          : { ownerId: session.user.id, orgId: null }
        memory = await retrieveMemory(scope, buildMemoryQuery(body.schema, body.result), 6)
      } catch {
        // Retrieval is best-effort; interpretation proceeds without it.
      }
    }

    const interpreted = await runInterpreter(
      body.schema,
      body.result,
      (body.modelTrainingReport ?? null) as Record<string, unknown> | null,
      ctx,
      memory,
    )

    return NextResponse.json({
      success: true,
      summary: interpreted.summary,
      perAnalysis: interpreted.perAnalysis || [],
      provider: interpreted.provider,
      fallbackUsed: interpreted.fallbackUsed,
    })
  } catch (error) {
    console.error('[StatLab AI] Global Fallback Triggered:', error)
    return NextResponse.json({
      success: true,
      summary: 'Analysis complete. Review the charts and data tables for full insights.',
      perAnalysis: [],
      provider: null,
      fallbackUsed: true,
    })
  }
}

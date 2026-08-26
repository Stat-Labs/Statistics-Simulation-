import { NextRequest, NextResponse } from 'next/server'
import { validateCSVFile } from '@/lib/utils/validation'
import { toErrorResponse } from '@/lib/utils/errors'
import { getSession } from '@/lib/auth/session'
import { getDb } from '@/db/client'
import { userPreferences } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getPreferredProvider } from '@/lib/ai/resolve'
import {
  runVisualizeQueryMapper,
  runChartExplainer,
} from '@/lib/ai/visualizePrompt'
import type { DatasetSchema, VisualizationResponse, VizChart } from '@/lib/types'

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL ?? 'http://127.0.0.1:8000'

/**
 * POST /api/visualize
 *
 * Proxies to the FastAPI `/visualize` endpoint: profiles the file and runs the
 * deterministic Visualization Intelligence Engine, returning a multi-chart ECharts
 * dashboard. Integrates AI prompt-mapping (user prompt -> column/intent boosts),
 * loads database-level user preferences, and runs batch AI chart explainers.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const fileEntry = formData.get('file')
    const file = fileEntry instanceof File ? fileEntry : null
    const fileError = validateCSVFile(file)
    if (fileError || !file) {
      return Response.json({ success: false, error: fileError ?? 'No file provided' }, { status: 400 })
    }

    const fileBytes = await file.arrayBuffer()
    const fileBlob = new Blob([fileBytes], { type: 'text/csv' })

    const proxyForm = new FormData()
    proxyForm.append('file', fileBlob, (file as File).name)

    for (const key of ['correlations', 'chunk_size', 'nbins', 'top_frequency', 'verify', 'cache']) {
      const raw = formData.get(key)
      if (raw && typeof raw === 'string') {
        proxyForm.append(key, raw)
      }
    }

    // Auth & Preferred Provider
    const session = await getSession(request)
    const preferredProvider = await getPreferredProvider(session?.user.id)
    const aiCtx = {
      userId: session?.user.id,
      orgId: session?.org?.id ?? null,
      preferredProvider,
    }

    // 1. Fetch user-preferred charts from database
    let dbPreferredCharts: string[] = []
    if (session?.user.id) {
      try {
        const db = await getDb()
        const rows = await db
          .select({ value: userPreferences.value })
          .from(userPreferences)
          .where(
            and(
              eq(userPreferences.userId, session.user.id),
              eq(userPreferences.key, 'preferred_charts')
            )
          )
          .limit(1)
        if (rows.length > 0) {
          dbPreferredCharts = JSON.parse(rows[0].value)
        }
      } catch {
        // Safe to ignore if DB is offline
      }
    }

    // 2. Map user prompt to columns and intents using LLM if supplied
    let boostedColumns: string[] = []
    let boostedIntents: string[] = []
    const prompt = formData.get('prompt')
    if (prompt && typeof prompt === 'string' && prompt.trim()) {
      try {
        const decoder = new TextDecoder('utf-8')
        const sniffText = decoder.decode(fileBytes.slice(0, 10000))
        const firstLine = sniffText.split('\n')[0] || ''
        const columns = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
        
        const schema: DatasetSchema = {
          fileName: file.name,
          rowCount: 0,
          columnCount: columns.length,
          columns: columns.map((name) => ({ name, type: 'continuous' })),
          sampleRows: [],
        }

        const mapped = await runVisualizeQueryMapper(prompt, schema, aiCtx)
        boostedColumns = mapped.boosted_columns
        boostedIntents = mapped.boosted_intents
      } catch (err) {
        console.error('[StatLab Visualize API] Prompt mapping failed:', err)
      }
    }

    // Add user_preferences payload to backend form
    const userPrefsPayload = {
      boosted_columns: boostedColumns,
      boosted_intents: boostedIntents,
      preferred_charts: dbPreferredCharts,
    }
    proxyForm.append('user_preferences', JSON.stringify(userPrefsPayload))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180000)

    const res = await fetch(`${PYTHON_BACKEND}/visualize`, {
      method: 'POST',
      body: proxyForm,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let errDetail = `Python backend error (${res.status})`
      try {
        const errJSON = JSON.parse(errText)
        errDetail = errJSON.detail ?? errDetail
      } catch {
        errDetail = errText.slice(0, 200) || errDetail
      }
      return Response.json(
        { success: false, error: errDetail },
        { status: res.status },
      )
    }

    const text = await res.text()
    const data = JSON.parse(text) as VisualizationResponse

    // 3. Batch explain generated charts using LLM
    if (data.success && data.sections) {
      const charts: VizChart[] = []
      for (const section of data.sections) {
        for (const chart of section.charts) {
          charts.push(chart)
        }
      }

      if (charts.length > 0) {
        try {
          const schema: DatasetSchema = {
            fileName: data.fileName,
            rowCount: data.rowCount,
            columnCount: data.columnCount,
            columns: [],
            sampleRows: [],
          }

          const explained = await runChartExplainer(
            charts.map((c) => ({
              id: c.id,
              title: c.title,
              chartType: c.chartType,
              intent: c.intent,
              reason: c.recommendation.reason,
            })),
            schema,
            aiCtx
          )

          // Inject explanations back into charts
          for (const section of data.sections) {
            for (const chart of section.charts) {
              const exp = explained.explanations[chart.id]
              if (exp) {
                chart.explanation = exp
              }
            }
          }
        } catch (err) {
          console.error('[StatLab Visualize API] Batch explanation failed:', err)
        }
      }
    }

    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('connect')) {
      return Response.json(
        { success: false, error: 'Python backend is not running. Start it with: npm run dev:backend' },
        { status: 502 },
      )
    }
    if (msg.includes('aborted')) {
      return Response.json(
        { success: false, error: 'Visualization timed out. Try a smaller dataset.' },
        { status: 504 },
      )
    }
    return Response.json(toErrorResponse(err), { status: 500 })
  }
}

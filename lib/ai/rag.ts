import type { DatasetSchema, AnalysisResult } from '@/lib/types'
import { callAIForUser, type AIContext } from '@/lib/ai/resolve'
import { retrieveMemory, type Scope } from '@/lib/memory/store'
import type { RetrievedContext } from '@/lib/memory/types'

export interface RagSource {
  title: string
  kind: 'finding' | 'kpi' | 'glossary'
}

export interface RagAnswer {
  answer: string | null
  grounded: boolean
  sources: RagSource[]
  context: RetrievedContext
}

/**
 * Builds a retrieval query for an analysis being interpreted: surface the
 * dataset, its columns, and the model target so past workspace knowledge about
 * those exact metrics/entities is surfaced before the answer is generated.
 */
export function buildMemoryQuery(schema: DatasetSchema, result: AnalysisResult): string {
  const cols = (schema.columns ?? []).map((c) => c.name).join(', ')
  const model = result.predictive?.modelType
  const dependent = result.predictive?.regressionResult?.dependent
  return [
    schema.fileName ? `Dataset "${schema.fileName}"` : 'Dataset',
    schema.rowCount ? `(${schema.rowCount.toLocaleString()} rows)` : '',
    cols ? `columns: ${cols}` : '',
    dependent ? `target: ${dependent}` : '',
    model ? `${model} model` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

export function hasRetrievedContext(context: RetrievedContext): boolean {
  return (
    context.findings.length > 0 ||
    context.kpis.length > 0 ||
    context.glossary.length > 0 ||
    context.datasets.length > 0
  )
}

export function buildRagSystemPrompt(): string {
  return `You are StatLab AI's workspace memory assistant. You answer questions about the user's analysed datasets using ONLY the retrieved knowledge provided.

Rules:
- Answer exclusively from the retrieved knowledge (findings, KPIs, glossary terms, dataset list).
- NEVER fabricate numbers, statistics, or claims. If the knowledge does not answer the question, say so and suggest what the user could analyse next.
- If the retrieved knowledge contains a partial answer, say what is missing.
- Cite the sources you used by their exact titles (findings), term names (glossary), or metric labels (KPIs).
- Be concise and business-friendly: 2-6 sentences, no preamble, no bullet storms.
- "grounded" must be true ONLY if you used at least one retrieved source; otherwise false.
- Return ONLY valid JSON, no markdown, no code fences:
{
  "answer": "your answer",
  "grounded": true,
  "sources": [{"title": "exact source title", "kind": "finding|kpi|glossary"}]
}`
}

export function buildRagUserPrompt(question: string, context: RetrievedContext): string {
  const parts: string[] = []

  if (context.findings.length > 0) {
    parts.push(
      'FINDINGS:\n' +
        context.findings
          .slice(0, 8)
          .map(
            (f) =>
              `- [${f.category}] ${f.title} (match ${Math.round(f.score * 100)}%, ${f.severity}): ${f.body}`,
          )
          .join('\n'),
    )
  }
  if (context.kpis.length > 0) {
    parts.push(
      'KPIs:\n' +
        context.kpis
          .slice(0, 8)
          .map((k) => `- ${k.displayLabel ?? k.name} = ${k.valueText}${k.unit ? ` ${k.unit}` : ''}`)
          .join('\n'),
    )
  }
  if (context.glossary.length > 0) {
    parts.push(
      'GLOSSARY:\n' +
        context.glossary
          .slice(0, 8)
          .map((g) => `- ${g.term}: ${g.definition}`)
          .join('\n'),
    )
  }
  if (context.datasets.length > 0) {
    parts.push(
      'DATASETS ANALYSED:\n' +
        context.datasets
          .slice(0, 5)
          .map((d) => `- ${d.name}${d.rowCount ? ` (${d.rowCount.toLocaleString()} rows)` : ''}`)
          .join('\n'),
    )
  }

  return `QUESTION: ${question}

RETRIEVED WORKSPACE KNOWLEDGE:
${parts.join('\n\n') || '(no retrieved knowledge)'}

Answer the question strictly from the retrieved knowledge above. Return ONLY valid JSON.`
}

export function parseRagAnswer(raw: string): { answer: string; grounded: boolean; sources: RagSource[] } {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
    if (!answer) throw new Error('Invalid answer')
    const sources: RagSource[] = Array.isArray(parsed.sources)
      ? parsed.sources
          .filter(
            (s: unknown): s is RagSource =>
              typeof s === 'object' &&
              s !== null &&
              typeof (s as RagSource).title === 'string' &&
              ['finding', 'kpi', 'glossary'].includes((s as RagSource).kind),
          )
          .slice(0, 12)
      : []
    return { answer, grounded: parsed.grounded === true && sources.length > 0, sources }
  } catch {
    console.error('[StatLab RAG] Parse failed:', raw)
    return { answer: '', grounded: false, sources: [] }
  }
}

function validateRagResponse(raw: string): boolean {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return typeof parsed.answer === 'string' && parsed.answer.trim().length > 0
  } catch {
    return false
  }
}

/**
 * The retrieval-before-answer orchestrator: embeds the question, retrieves
 * relevant workspace knowledge, and generates a grounded answer from it.
 *
 * - Empty context short-circuits to a canned "no knowledge yet" answer with no
 *   LLM call (saves tokens, avoids fabrication).
 * - LLM failure degrades to evidence-only: `answer` is null but the retrieved
 *   context is still returned so the client can show the evidence.
 * - Retrieval failure (DB unavailable) degrades to an empty context.
 */
export async function answerFromMemory(
  scope: Scope,
  question: string,
  ctx: AIContext = {},
): Promise<RagAnswer> {
  let context: RetrievedContext = { findings: [], glossary: [], kpis: [], datasets: [] }
  try {
    context = await retrieveMemory(scope, question)
  } catch (error) {
    console.warn(`[StatLab RAG] Retrieval failed: ${(error as Error).message}`)
  }

  if (!hasRetrievedContext(context)) {
    return {
      answer:
        "I don't have any stored knowledge about that yet. Run an analysis on a related dataset and StatLab will remember the findings, KPIs and glossary terms it can use to answer this later.",
      grounded: false,
      sources: [],
      context,
    }
  }

  try {
    const system = buildRagSystemPrompt()
    const user = buildRagUserPrompt(question, context)
    const response = await callAIForUser(ctx, system, user, validateRagResponse)
    const parsed = parseRagAnswer(response.content)
    return {
      answer: parsed.answer || 'No usable answer could be generated.',
      grounded: parsed.grounded,
      sources: parsed.sources,
      context,
    }
  } catch (error) {
    console.warn(`[StatLab RAG] Answer generation failed: ${(error as Error).message}`)
    return { answer: null, grounded: false, sources: [], context }
  }
}

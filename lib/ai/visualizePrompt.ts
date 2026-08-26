import type { DatasetSchema } from '@/lib/types'
import { callAIForUser, type AIContext } from '@/lib/ai/resolve'

export interface PromptMappingResult {
  boosted_columns: string[]
  boosted_intents: string[]
}

export interface ChartExplanation {
  whyThisChart: string
  whatItShows: string
  howToInterpret: string
  limitations: string
}

export interface BatchExplanationResult {
  explanations: Record<string, ChartExplanation>
}

// ---------------------------------------------------------------------------
// 1. User Prompt Mapper (maps free-text prompts to columns/intents)
// ---------------------------------------------------------------------------

export function buildMapperSystemPrompt(): string {
  return `You are StatLab AI, a senior Data Visualization Architect.
Your task is to analyze a user's visualization request (prompt) and map it onto the variables and statistical intents present in the dataset.

Supported intents:
- "distribution": understand the distribution/shape of continuous/numeric variables
- "relationship": explore correlations/scatters between numeric variables
- "composition": break down parts of a whole (categories <= 6)
- "compare_categories": compare frequencies of categories (categories > 6)
- "trend_over_time": track metrics across dates/times
- "data_quality": analyze missing data or duplicates

Rules:
1. Identify columns mentioned in the prompt. They MUST match the provided schema column names exactly.
2. Identify the intended statistical intents.
3. Return ONLY a valid JSON object matching this schema, with no markdown code blocks, no trailing comments, and no preamble:
{
  "boosted_columns": ["colA", "colB"],
  "boosted_intents": ["relationship", "distribution"]
}`
}

export function buildMapperUserPrompt(prompt: string, schema: DatasetSchema): string {
  return `User prompt: "${prompt}"

Dataset columns:
${schema.columns.map((c) => `- ${c.name} (${c.type})`).join('\n')}

Identify which columns and intents from this dataset are requested or relevant. Return the JSON object.`
}

function validateMapperResponse(raw: string): boolean {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed.boosted_columns) && Array.isArray(parsed.boosted_intents)
  } catch {
    return false
  }
}

export async function runVisualizeQueryMapper(
  prompt: string,
  schema: DatasetSchema,
  ctx: AIContext = {},
): Promise<PromptMappingResult> {
  const system = buildMapperSystemPrompt()
  const user = buildMapperUserPrompt(prompt, schema)
  try {
    const response = await callAIForUser(ctx, system, user, validateMapperResponse)
    const cleaned = response.content.replace(/```json|```/g, '').trim()
    return JSON.parse(cleaned) as PromptMappingResult
  } catch (err) {
    console.error('[StatLab AI Mapper] Error parsing mapping response:', err)
    return { boosted_columns: [], boosted_intents: [] }
  }
}

// ---------------------------------------------------------------------------
// 2. Chart Explainer (explains selected charts without choosing them)
// ---------------------------------------------------------------------------

export function buildExplainerSystemPrompt(): string {
  return `You are StatLab AI, a senior Data Scientist and Data Visualization consultant.
You will be given a list of charts selected for rendering in a visualization dashboard.
For each chart, write a clear, business-oriented statistical explanation.

Rules:
1. Explain what the chart shows, why it was chosen statistically, how to interpret its shapes/patterns, and any limitations (e.g. downsampling, collinearity caveats, correlation vs causation).
2. The AI must never decide or change the chart type or columns; your job is strictly to explain the charts already chosen by the engine.
3. Return ONLY a valid JSON object matching this schema (with no markdown, no code fences, and no preamble):
{
  "explanations": {
    "chartId": {
      "whyThisChart": "Write 1-2 sentences explaining why this chart is the statistically correct choice for these variables (e.g., 'A histogram is selected for age because it is right-skewed and has high variance').",
      "whatItShows": "Write 1-2 sentences explaining the concrete data patterns displayed (e.g., 'It displays the frequency distribution of employee ages, showing a peak around 28-32 years old').",
      "howToInterpret": "Write 1-2 sentences explaining how an analyst should read or use this chart (e.g., 'Observe where the tails fall. The green vertical reference line indicates the population mean, showing how the bulk of employees cluster below it').",
      "limitations": "Write 1 sentence detailing a limitation or caveat (e.g., 'Bin widths are fixed and do not highlight individual high-age outliers')."
    }
  }
}`
}

export function buildExplainerUserPrompt(charts: unknown[], schema: DatasetSchema): string {
  return `Dataset: ${schema.fileName}
Total rows: ${schema.rowCount}

Selected charts to explain:
${JSON.stringify(charts, null, 2)}

Provide explanations for each chart by its ID. Return the JSON object.`
}

function validateExplainerResponse(raw: string): boolean {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return typeof parsed.explanations === 'object' && parsed.explanations !== null
  } catch {
    return false
  }
}

export async function runChartExplainer(
  charts: unknown[],
  schema: DatasetSchema,
  ctx: AIContext = {},
): Promise<BatchExplanationResult> {
  const system = buildExplainerSystemPrompt()
  const user = buildExplainerUserPrompt(charts, schema)
  try {
    const response = await callAIForUser(ctx, system, user, validateExplainerResponse)
    const cleaned = response.content.replace(/```json|```/g, '').trim()
    return JSON.parse(cleaned) as BatchExplanationResult
  } catch (err) {
    console.error('[StatLab AI Explainer] Error explaining charts:', err)
    return { explanations: {} }
  }
}

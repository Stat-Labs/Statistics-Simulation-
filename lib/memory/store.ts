import { getDb } from '@/db/client'
import {
  knowledgeFindings,
  knowledgeGlossary,
  knowledgeKpis,
  knowledgeEmbeddings,
  datasets,
  userPreferences,
} from '@/db/schema'
import { and, eq, isNull, desc, gte, sql } from 'drizzle-orm'
import { jsonify, jsonifyRequired, parseJson, type AnyColumn } from '@/db/table'
import { embedTexts, cosine } from './embeddings'
import type { AIContext } from '@/lib/ai/resolve'
import type { KnowledgeExtract, RetrievedContext } from './types'

export interface Scope {
  ownerId: string
  orgId: string | null
}

function scopeWhere(table: { ownerId: AnyColumn; orgId: AnyColumn }, scope: Scope) {
  return scope.orgId
    ? and(eq(table.ownerId, scope.ownerId), eq(table.orgId, scope.orgId))
    : and(eq(table.ownerId, scope.ownerId), isNull(table.orgId))
}

/**
 * Persists one dataset's extracted knowledge + embeddings. The raw file is
 * intentionally NOT required here — knowledge outlives the dataset.
 */
export async function storeKnowledge(
  scope: Scope,
  input: {
    datasetId: string | null
    analysisId: string | null
    extract: KnowledgeExtract
    summaryText: string
    ctx: AIContext
  },
): Promise<{ findings: number; glossary: number; kpis: number; embeddings: number }> {
  const db = await getDb()
  const now = Date.now()

  // --- Findings ---
  for (const f of input.extract.findings) {
    await db.insert(knowledgeFindings).values({
      id: crypto.randomUUID(),
      ownerId: scope.ownerId,
      orgId: scope.orgId,
      datasetId: input.datasetId,
      analysisId: input.analysisId,
      category: f.category,
      title: f.title,
      body: f.body,
      confidence: f.confidence,
      severity: f.severity,
      evidence: jsonify(f.evidence),
      impact: f.impact,
      financialImpact: f.financialImpact,
      kpiKey: f.kpiKey,
      createdAt: now,
    })
  }

  // --- Glossary (upsert by term) ---
  for (const g of input.extract.glossary) {
    const existing = await db
      .select({ id: knowledgeGlossary.id, confidence: knowledgeGlossary.confidence })
      .from(knowledgeGlossary)
      .where(
        and(
          scopeWhere(knowledgeGlossary, scope),
          sql`lower(${knowledgeGlossary.term}) = ${g.term.toLowerCase()}`,
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      if (g.confidence > existing[0].confidence) {
        await db
          .update(knowledgeGlossary)
          .set({ definition: g.definition, confidence: g.confidence, updatedAt: now })
          .where(eq(knowledgeGlossary.id, existing[0].id))
      }
    } else {
      await db.insert(knowledgeGlossary).values({
        id: crypto.randomUUID(),
        ownerId: scope.ownerId,
        orgId: scope.orgId,
        datasetId: input.datasetId,
        term: g.term,
        definition: g.definition,
        confidence: g.confidence,
        source: g.source,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // --- KPIs ---
  for (const k of input.extract.kpis) {
    await db.insert(knowledgeKpis).values({
      id: crypto.randomUUID(),
      ownerId: scope.ownerId,
      orgId: scope.orgId,
      datasetId: input.datasetId,
      name: k.name,
      metricKey: k.metricKey,
      valueText: k.valueText,
      valueNumber: k.valueNumber,
      unit: k.unit,
      periodKey: k.periodKey,
      displayLabel: k.displayLabel,
      createdAt: now,
    })
  }

  // --- Embeddings for retrieval ---
  const embeddable: { contentId: string; contentType: string; text: string }[] = []
  for (const f of input.extract.findings) {
    embeddable.push({ contentId: f.title, contentType: 'finding', text: `${f.title}. ${f.body}` })
  }
  for (const g of input.extract.glossary) {
    embeddable.push({ contentId: g.term, contentType: 'glossary', text: `${g.term}: ${g.definition}` })
  }
  if (input.summaryText.trim()) {
    embeddable.push({ contentId: 'summary', contentType: 'report', text: input.summaryText })
  }

  let embeddingCount = 0
  if (embeddable.length > 0) {
    const { vectors, model, dimensions } = await embedTexts(input.ctx, embeddable.map((e) => e.text))
    for (let i = 0; i < vectors.length; i++) {
      const src = embeddable[i]
      await db.insert(knowledgeEmbeddings).values({
        id: crypto.randomUUID(),
        ownerId: scope.ownerId,
        orgId: scope.orgId,
        contentType: src.contentType,
        contentId: src.contentId,
        text: src.text,
        model,
        dimensions,
        vector: jsonifyRequired(vectors[i]),
        createdAt: now,
      })
      embeddingCount++
    }
  }

  return {
    findings: input.extract.findings.length,
    glossary: input.extract.glossary.length,
    kpis: input.extract.kpis.length,
    embeddings: embeddingCount,
  }
}

/** Dashboard summary of the workspace's knowledge base. */
export async function getMemorySummary(scope: Scope, limit = 8) {
  const db = await getDb()

  const [findings, kpis, glossary, datasetRows, findingCount, kpiCount] = await Promise.all([
    db
      .select()
      .from(knowledgeFindings)
      .where(scopeWhere(knowledgeFindings, scope))
      .orderBy(desc(knowledgeFindings.createdAt))
      .limit(limit),
    db
      .select()
      .from(knowledgeKpis)
      .where(scopeWhere(knowledgeKpis, scope))
      .orderBy(desc(knowledgeKpis.createdAt))
      .limit(30),
    db
      .select()
      .from(knowledgeGlossary)
      .where(scopeWhere(knowledgeGlossary, scope))
      .orderBy(desc(knowledgeGlossary.updatedAt))
      .limit(limit),
    db
      .select({
        id: datasets.id,
        name: datasets.name,
        rowCount: datasets.rowCount,
        createdAt: datasets.createdAt,
        rawDeletedAt: datasets.rawDeletedAt,
      })
      .from(datasets)
      .where(scopeWhere(datasets, scope))
      .orderBy(desc(datasets.createdAt))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeFindings)
      .where(scopeWhere(knowledgeFindings, scope)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeKpis)
      .where(scopeWhere(knowledgeKpis, scope)),
  ])

  return {
    findings: findings.map((f) => ({
      id: f.id,
      category: f.category,
      title: f.title,
      body: f.body,
      confidence: f.confidence,
      severity: f.severity,
      createdAt: f.createdAt,
    })),
    kpis: kpis.map((k) => ({
      name: k.name,
      metricKey: k.metricKey,
      valueText: k.valueText,
      valueNumber: k.valueNumber,
      unit: k.unit,
      periodKey: k.periodKey,
      displayLabel: k.displayLabel,
      createdAt: k.createdAt,
    })),
    glossary: glossary.map((g) => ({ term: g.term, definition: g.definition })),
    datasets: datasetRows.map((d) => ({
      id: d.id,
      name: d.name,
      rowCount: d.rowCount,
      createdAt: d.createdAt,
      rawDeletedAt: d.rawDeletedAt,
    })),
    counts: {
      findings: Number(findingCount[0]?.count ?? 0),
      kpis: Number(kpiCount[0]?.count ?? 0),
      glossary: glossary.length,
      datasets: datasetRows.length,
    },
  }
}

/**
 * RAG retrieval: embed the question, rank stored embeddings by cosine, then
 * enrich with recent KPIs + glossary matches + recent dataset metadata. This is
 * the context assembled before any future AI answer is generated.
 */
export async function retrieveMemory(scope: Scope, query: string, limit = 8): Promise<RetrievedContext> {
  const db = await getDb()
  const now = Date.now()
  const recentCutoff = now - 1000 * 60 * 60 * 24 * 365 // 1 year of KPIs

  const [rows, kpiRows, glossaryRows, datasetRows] = await Promise.all([
    db
      .select()
      .from(knowledgeEmbeddings)
      .where(scopeWhere(knowledgeEmbeddings, scope)),
    db
      .select()
      .from(knowledgeKpis)
      .where(
        and(
          scopeWhere(knowledgeKpis, scope),
          gte(knowledgeKpis.createdAt, recentCutoff),
        ),
      )
      .orderBy(desc(knowledgeKpis.createdAt))
      .limit(48),
    db
      .select()
      .from(knowledgeGlossary)
      .where(scopeWhere(knowledgeGlossary, scope))
      .limit(100),
    db
      .select({
        id: datasets.id,
        name: datasets.name,
        rowCount: datasets.rowCount,
        createdAt: datasets.createdAt,
      })
      .from(datasets)
      .where(scopeWhere(datasets, scope))
      .orderBy(desc(datasets.createdAt))
      .limit(limit),
  ])

  // Rank embeddings.
  const ranked = new Map<string, { score: number; text: string; contentType: string }>()
  if (query.trim() && rows.length > 0) {
    const { vectors } = await embedTexts(scope, [query])
    const q = vectors[0]
    if (q) {
      const scored: { row: typeof rows[number]; score: number }[] = []
      for (const row of rows) {
        const vec = parseJson<number[]>(row.vector)
        if (!vec) continue
        scored.push({ row, score: cosine(q, vec) })
      }
      scored
        .filter((s) => s.score > 0.15)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .forEach((s) => ranked.set(s.row.contentId, { score: s.score, text: s.row.text, contentType: s.row.contentType }))
    }
  }

  // Match findings by content id, else fall back to most recent.
  const findings = await db
    .select()
    .from(knowledgeFindings)
    .where(scopeWhere(knowledgeFindings, scope))
    .orderBy(desc(knowledgeFindings.createdAt))
    .limit(100)

  const byTitle = new Map(findings.map((f) => [f.title, f]))
  const matched: RetrievedContext['findings'] = []
  for (const [contentId, { score }] of ranked) {
    const f = byTitle.get(contentId)
    if (f) {
      matched.push({
        id: f.id,
        title: f.title,
        body: f.body,
        category: f.category,
        severity: f.severity,
        score: Number(score.toFixed(3)),
        createdAt: f.createdAt,
      })
    }
  }
  // Always surface the most recent findings too (recentcy signal).
  const existing = new Set(matched.map((m) => m.id))
  for (const f of findings.slice(0, 4)) {
    if (!existing.has(f.id)) {
      matched.push({
        id: f.id,
        title: f.title,
        body: f.body,
        category: f.category,
        severity: f.severity,
        score: 0,
        createdAt: f.createdAt,
      })
    }
  }

  // Glossary match by token overlap.
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const glossary: { term: string; definition: string }[] = []
  for (const g of glossaryRows) {
    if (tokens.some((t) => g.term.toLowerCase().includes(t) || g.definition.toLowerCase().includes(t))) {
      glossary.push({ term: g.term, definition: g.definition })
    }
    if (glossary.length >= 8) break
  }

  return {
    findings: matched.slice(0, limit),
    glossary,
    kpis: kpiRows.map((k) => ({
      name: k.name,
      metricKey: k.metricKey,
      valueText: k.valueText,
      valueNumber: k.valueNumber,
      unit: k.unit,
      periodKey: k.periodKey,
      displayLabel: k.displayLabel,
      createdAt: k.createdAt,
    })),
    datasets: datasetRows.map((d) => ({ id: d.id, name: d.name, rowCount: d.rowCount, createdAt: d.createdAt })),
  }
}

/** Store or update a workspace user preference (chart style, format, etc.). */
export async function setPreference(
  userId: string,
  orgId: string | null,
  key: string,
  value: unknown,
): Promise<void> {
  const db = await getDb()
  const existing = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.userId, userId),
        orgId ? eq(userPreferences.orgId, orgId) : isNull(userPreferences.orgId),
        eq(userPreferences.key, key),
      ),
    )
    .limit(1)
  const now = Date.now()
  if (existing.length > 0) {
    await db
      .update(userPreferences)
      .set({ value: jsonifyRequired(value), updatedAt: now })
      .where(eq(userPreferences.id, existing[0].id))
  } else {
    await db.insert(userPreferences).values({
      id: crypto.randomUUID(),
      userId,
      orgId,
      key,
      value: jsonifyRequired(value),
      updatedAt: now,
    })
  }
}

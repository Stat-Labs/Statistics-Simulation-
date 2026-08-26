import type { AIContext } from '@/lib/ai/resolve'
import { resolveKeyChain } from '@/lib/ai/resolve'

export interface EmbeddingResult {
  vectors: number[][]
  model: string
  dimensions: number
}

const LOCAL_DIMENSIONS = 256

// ---------------------------------------------------------------------------
// Local deterministic embedder (no external service). Used as a fallback so
// RAG works even when no embeddings-capable provider key is configured. It
// builds a hashed word/n-gram bag-of-vectors (256 dims, L2-normalized) — not
// as rich as a transformer embedding, but good enough for lexical/semantic
// retrieval of short findings and glossary entries.
// ---------------------------------------------------------------------------

function hashString(input: string): number {
  // FNV-1a
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function localEmbed(texts: string[]): number[][] {
  const dims = LOCAL_DIMENSIONS
  const vectors: number[][] = texts.map((raw) => {
    const vector = new Array(dims).fill(0)
    const tokens = raw
      .toLowerCase()
      .replace(/[^a-z0-9\s₦$€£%]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0)
    const grams: string[] = []
    for (const t of tokens) {
      grams.push(t)
      if (t.length > 3) grams.push(`$${t}`) // word-start marker
    }
    for (const g of grams) {
      const idx = hashString(g) % dims
      vector[idx] += 1
    }
    let norm = 0
    for (const v of vector) norm += v * v
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < dims; i++) vector[i] /= norm
    return vector
  })
  return vectors
}

// ---------------------------------------------------------------------------
// Provider-backed embedders (OpenAI-compatible endpoints).
// ---------------------------------------------------------------------------

interface EmbedProvider {
  id: string
  model: string
  dimensions: number
  apiKey: string
  baseUrl: string
}

function embedApi(provider: EmbedProvider, texts: string[]): Promise<number[][]> {
  return fetch(`${provider.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ model: provider.model, input: texts }),
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Embedding API ${res.status} ${await res.text().catch(() => '')}`)
      }
      const data = (await res.json()) as { data?: { embedding: number[] }[] }
      return (data.data ?? []).map((d) => d.embedding)
    })
}

/** Find the first usable embedding-capable provider key from the chain. */
async function resolveEmbedder(ctx: AIContext): Promise<EmbedProvider | null> {
  const chain = await resolveKeyChain(ctx)
  for (const source of chain) {
    if (source.provider === 'mistral') {
      return {
        id: 'mistral',
        model: 'mistral-embed',
        dimensions: 1024,
        apiKey: source.apiKey,
        baseUrl: 'https://api.mistral.ai/v1',
      }
    }
    if (source.provider === 'openai') {
      return {
        id: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        apiKey: source.apiKey,
        baseUrl: 'https://api.openai.com/v1',
      }
    }
  }
  return null
}

/**
 * Embed a batch of texts, preferring a provider key (Mistral → OpenAI), and
 * falling back to the local hashed embedder on any failure so knowledge
 * extraction and retrieval never block the pipeline.
 */
export async function embedTexts(ctx: AIContext, texts: string[]): Promise<EmbeddingResult> {
  const clean = texts.map((t) => (t ?? '').trim()).filter((t) => t.length > 0)
  if (clean.length === 0) {
    return { vectors: [], model: 'none', dimensions: 0 }
  }

  const provider = await resolveEmbedder(ctx)
  if (provider) {
    try {
      const vectors = await embedApi(provider, clean)
      if (vectors.length === clean.length) {
        return { vectors, model: `${provider.id}:${provider.model}`, dimensions: provider.dimensions }
      }
    } catch (err) {
      console.warn(`[StatLab Memory] Embedding provider failed (${(err as Error).message}); using local embedder.`)
    }
  }

  return { vectors: localEmbed(clean), model: 'local', dimensions: LOCAL_DIMENSIONS }
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

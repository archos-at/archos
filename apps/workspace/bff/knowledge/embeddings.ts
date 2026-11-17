import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import { getBackendUrl } from '@/lib/backend-proxy'
import { internalServiceHeaders } from '@/lib/internal-auth'

export const MAX_EMBED_BATCH = 64
const EMBED_TIMEOUT_MS = 20_000

export interface EmbedOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface EmbeddedNote {
  vector: number[]
  fingerprint: string
}

interface BackendEmbedResponse {
  vectors?: number[][]
  fingerprint?: string
  dimensions?: number
  error?: string | null
}

export async function embedNotes(
  texts: string[],
  options: EmbedOptions = {}
): Promise<EmbeddedNote[] | null> {
  const batch = texts.slice(0, MAX_EMBED_BATCH)
  if (batch.length === 0) return []

  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}/v1/note-embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalServiceHeaders(getBackendUrl()),
      },
      body: JSON.stringify({ texts: batch }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? EMBED_TIMEOUT_MS)])
        : AbortSignal.timeout(options.timeoutMs ?? EMBED_TIMEOUT_MS),
    })
  } catch (error) {
    if (options.signal?.aborted) return null
    console.warn('[embeddings] Backend unreachable; staying on the lexical path:', error)
    return null
  }

  if (!response.ok) {
    console.warn('[embeddings] Backend returned', response.status)
    return null
  }

  let payload: BackendEmbedResponse
  try {
    payload = (await response.json()) as BackendEmbedResponse
  } catch {
    return null
  }
  if (payload.error) {
    console.warn('[embeddings] Embedder unavailable:', payload.error)
    return null
  }

  const vectors = payload.vectors
  const fingerprint = payload.fingerprint
  if (!Array.isArray(vectors) || !fingerprint || vectors.length !== batch.length) return null
  if (!vectors.every((vector) => Array.isArray(vector) && vector.length > 0)) return null

  return vectors.map((vector) => ({ vector, fingerprint }))
}

export async function embedNote(
  text: string,
  options: EmbedOptions = {}
): Promise<EmbeddedNote | null> {
  const embedded = await embedNotes([text], options)
  return embedded?.[0] ?? null
}

export function enrichForEmbedding(content: string, labels: readonly string[]): string {
  const tags = labels.filter(Boolean).join(', ')
  return tags ? `[${tags}] ${content}` : content
}

export function cosineSimilaritySql(column: SQL | unknown, vector: number[]): SQL<number | null> {
  return sql<number | null>`cosine_similarity(${column}, ${toVectorLiteral(vector)}::real[])`
}

export function toVectorLiteral(vector: number[]): string {
  const parts = vector.map((value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      throw new Error('Refusing to build a vector literal from a non-finite value')
    }
    return numeric
  })
  return `{${parts.join(',')}}`
}

export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (normA === 0 || normB === 0) return null
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

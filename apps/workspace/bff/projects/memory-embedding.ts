import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory, type ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { embedNote, embedNotes, enrichForEmbedding, type EmbeddedNote } from '@/lib/knowledge/embeddings'

const MEMORY_BACKFILL_BATCH = 8

export const STALE_VECTOR = { embedding: null, embeddingModel: null, embeddedAt: null } as const

const embeddedText = (note: { kind: string; content: string }): string => enrichForEmbedding(note.content, [note.kind])

function storeVector(id: string, content: string, embedded: EmbeddedNote) {
  return getDb()
    .update(projectMemory)
    .set({ embedding: embedded.vector, embeddingModel: embedded.fingerprint, embeddedAt: new Date() })
    .where(and(eq(projectMemory.id, id), eq(projectMemory.content, content)))
}

export async function embedStoredNote(item: ProjectMemoryItem): Promise<ProjectMemoryItem> {
  const embedded = await embedNote(embeddedText(item))
  if (!embedded) return item
  const [stored] = await storeVector(item.id, item.content, embedded).returning()
  return stored ?? item
}

interface RecalledNote {
  id: string
  kind: string
  content: string
  relevance: number | null
}

export function backfillAfterRecall(
  candidates: readonly RecalledNote[],
  rows: readonly { id: string; embeddingModel: string | null }[],
  embedded: EmbeddedNote | null,
  denseSkipped: boolean
): void {
  if (!denseSkipped && !embedded) return
  const current = new Set(
    embedded ? rows.filter((row) => row.embeddingModel === embedded.fingerprint).map((row) => row.id) : []
  )
  const missing = denseSkipped
    ? candidates
    : candidates.filter((candidate) => candidate.relevance === null && !current.has(candidate.id))
  if (missing.length > 0) void backfillMemoryEmbeddings(missing.slice(0, MEMORY_BACKFILL_BATCH))
}

async function backfillMemoryEmbeddings(items: readonly RecalledNote[]): Promise<void> {
  try {
    const embedded = await embedNotes(items.map(embeddedText))
    if (!embedded) return
    for (let index = 0; index < items.length; index++) {
      await storeVector(items[index].id, items[index].content, embedded[index])
    }
  } catch (error) {
    console.warn('[memory] Embedding backfill failed (non-fatal):', error)
  }
}

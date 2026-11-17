/**
 * A stored note's vector, kept in step with its text: the writes
 * `memory-service.ts` makes outside the insert (an edit, and the digest's
 * self-healing backfill).
 *
 * One rule holds for every write here: a vector is computed from a text read
 * EARLIER, over a provider round trip, so it is stored only while the row
 * still holds that text (`content` in the UPDATE's WHERE). Without it, a note
 * edited while its old text was being embedded kept the old text's vector
 * under the new text, and matched and recalled by what it used to say.
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory, type ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { embedNote, embedNotes, enrichForEmbedding, type EmbeddedNote } from '@/lib/knowledge/embeddings'

/** Backfill batch per digest build: small on purpose; the next build continues. */
const MEMORY_BACKFILL_BATCH = 8

/**
 * What a write that changes a note's text or kind sets with it: no vector. The
 * old one describes the old text. A row without a vector is exactly what the
 * digest's backfill looks for, so an edit made while the embedder is down is
 * healed by the next digest build of its project.
 */
export const STALE_VECTOR = { embedding: null, embeddingModel: null, embeddedAt: null } as const

/** The text that is embedded for a note: its content with its kind (`enrichForEmbedding`). */
const embeddedText = (note: { kind: string; content: string }): string => enrichForEmbedding(note.content, [note.kind])

/** Store `embedded` on the note `id`, unless its text is no longer `content`. */
function storeVector(id: string, content: string, embedded: EmbeddedNote) {
  return getDb()
    .update(projectMemory)
    .set({ embedding: embedded.vector, embeddingModel: embedded.fingerprint, embeddedAt: new Date() })
    .where(and(eq(projectMemory.id, id), eq(projectMemory.content, content)))
}

/**
 * Embed a note that was just written without a vector (`STALE_VECTOR`) and
 * answer the row as it now stands. Fail-open like every embed: with no
 * embedder the row is answered as it is and the backfill embeds it later.
 */
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
  /** Null when the row carried no vector of the query's model. */
  relevance: number | null
}

/**
 * Self-healing backfill: rows written while the embedder was down (or before
 * it existed, or edited since) stay on the lexical path until something embeds
 * them. This is that something: a bounded, fire-and-forget batch per digest
 * build, so an ACTIVE project heals itself and a dormant one costs nothing.
 *
 * `embedded` is the query's vector when the build ranked by one: the rows that
 * scored nothing against it and carry no vector of its model are the ones to
 * embed. `denseSkipped` is the build that did not wait for a vector because no
 * candidate carried one: every candidate is then a row to embed, so skipping
 * the wait never stops the healing.
 */
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

/**
 * Embed and store vectors for notes that missed theirs. Tenant-scoped: called
 * inside the digest's `withTenant` scope, and the async continuation inherits
 * it, so RLS still applies to the update. Never throws.
 */
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

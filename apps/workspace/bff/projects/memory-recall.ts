import { desc, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import { cosineSimilaritySql, type EmbeddedNote } from '@/lib/knowledge/embeddings'

export const RECALL_CANDIDATE_LIMIT = 200

export interface DigestTiming {
  dense?: 'no-query' | 'skipped' | 'ranked' | 'unavailable'
}

export function selectRecallCandidates(scope: SQL | undefined, embedded: EmbeddedNote | null) {
  const relevanceColumn = embedded
    ? cosineSimilaritySql(projectMemory.embedding, embedded.vector)
    : sql<number | null>`null::double precision`
  return getDb()
    .select({
      id: projectMemory.id,
      scope: projectMemory.scope,
      topic: projectMemory.topic,
      kind: projectMemory.kind,
      content: projectMemory.content,
      confidence: projectMemory.confidence,
      verification: projectMemory.verification,
      restrictedFolderIds: projectMemory.restrictedFolderIds,
      pinned: projectMemory.pinned,
      salience: projectMemory.salience,
      lastReferencedAt: projectMemory.lastReferencedAt,
      recallCount: projectMemory.recallCount,
      relevance: relevanceColumn,
      embeddingModel: projectMemory.embeddingModel,
      hasEmbedding: sql<boolean>`(${projectMemory.embedding} is not null)`,
    })
    .from(projectMemory)
    .where(scope)
    .orderBy(...(embedded ? [sql`${relevanceColumn} desc nulls last`] : []), desc(projectMemory.updatedAt))
    .limit(RECALL_CANDIDATE_LIMIT)
}

import 'server-only'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { contentTokens, jaccardSimilarity, normalizeContentGerman } from '@/lib/knowledge/consolidation'
import { cosineSimilaritySql, embedNote } from '@/lib/knowledge/embeddings'
import { fuseHybridRelevance } from '@/lib/knowledge/recall-scoring'
import { projectMemory, type ProjectMemoryKind, type ProjectMemoryVerification } from '@/lib/db/schema/project-memory'
import { SCREENED_ONLY } from '@/lib/documents/visibility'
import { withServedEvidence } from '@/lib/projects/memory-evidence'
import { memoryVisibleTo } from '@/lib/projects/memory-service'
import { isConfirmedMemory } from './decision-origin'

export const DECISION_KINDS: readonly ProjectMemoryKind[] = ['decision', 'constraint']

export const CROSS_PROJECT_MAX_DECISIONS = 6

export interface DecisionScope {
  projectId: string
  readableFolderIds: readonly string[]
}

export interface FoundDecision {
  projectId: string
  kind: ProjectMemoryKind
  content: string
  confirmed: boolean
  verification: ProjectMemoryVerification
  evidence: { fileName: string; page: string | null }[]
  updatedAt: Date
  restrictedFolderIds: string[] | null
}

const DECISION_CANDIDATES = 300

export async function searchProjectDecisions(
  organizationId: string,
  scopes: readonly DecisionScope[],
  question: string,
  limit: number = CROSS_PROJECT_MAX_DECISIONS
): Promise<FoundDecision[]> {
  if (scopes.length === 0 || !question.trim()) return []
  const embedded = await embedNote(question, { timeoutMs: 1500 })
  const relevance = embedded
    ? cosineSimilaritySql(projectMemory.embedding, embedded.vector)
    : sql<number | null>`null::double precision`
  const visible = or(
    ...scopes.map((scope) => and(eq(projectMemory.projectId, scope.projectId), memoryVisibleTo(scope.readableFolderIds)))
  )
  const rows = await getDb()
    .select({
      projectId: projectMemory.projectId,
      kind: projectMemory.kind,
      content: projectMemory.content,
      verification: projectMemory.verification,
      provenanceType: projectMemory.provenanceType,
      pinned: projectMemory.pinned,
      evidence: projectMemory.evidence,
      updatedAt: projectMemory.updatedAt,
      restrictedFolderIds: projectMemory.restrictedFolderIds,
      relevance,
      embeddingModel: projectMemory.embeddingModel,
    })
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.organizationId, organizationId),
        eq(projectMemory.scope, 'project'),
        eq(projectMemory.status, 'active'),
        inArray(projectMemory.kind, [...DECISION_KINDS]),
        visible
      )
    )
    .orderBy(...(embedded ? [sql`${relevance} desc nulls last`] : []), desc(projectMemory.updatedAt))
    .limit(DECISION_CANDIDATES)

  const dense = rows.map((row) =>
    embedded && row.embeddingModel === embedded.fingerprint && row.relevance !== null ? Number(row.relevance) : null
  )
  const asked = contentTokens(question, normalizeContentGerman)
  const lexical = rows.map((row) => jaccardSimilarity(asked, contentTokens(row.content, normalizeContentGerman)))
  const fused = fuseHybridRelevance(dense, lexical)

  const found = rows
    .map((row, index) => ({ row, score: fused[index] }))
    .filter((entry): entry is { row: (typeof rows)[number]; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
      projectId: String(row.projectId),
      kind: row.kind,
      content: row.content,
      confirmed: isConfirmedMemory(row),
      verification: row.verification,
      evidence: row.evidence ?? [],
      updatedAt: new Date(row.updatedAt),
      restrictedFolderIds: row.restrictedFolderIds && row.restrictedFolderIds.length > 0 ? [...row.restrictedFolderIds] : null,
    }))
  const clearance = new Map(scopes.map((scope) => [scope.projectId, scope.readableFolderIds]))
  return withServedEvidence(organizationId, found, {
    reader: SCREENED_ONLY,
    clearanceIn: (projectId) => clearance.get(projectId) ?? [],
  })
}

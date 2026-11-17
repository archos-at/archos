import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { executeRows } from '@/lib/db/execute-rows'
import { projectMemory } from '@/lib/db/schema/project-memory'
import type { NewProjectMemoryItem, ProjectMemoryConfidence, ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import {
  NEAR_DUP_JACCARD_THRESHOLD,
  NEAR_DUP_MIN_TOKENS,
  contentTokens,
  jaccardSimilarity,
  assertionRelation,
  normalizeContent,
  type AssertionRelation,
} from '@/lib/knowledge/consolidation'
import { toVectorLiteral, type EmbeddedNote } from '@/lib/knowledge/embeddings'
import { arrayLiteral, canonicalRestriction, consolidationScope } from './memory-scope'

function normalizedContentEquals(content: string) {
  return sql`btrim(regexp_replace(lower(${projectMemory.content}), '[^a-z0-9]+', ' ', 'g')) = ${normalizeContent(content)}`
}

/**
 * The write-time de-duplication gate (a pragmatic first slice of design §3.2).
 * Finds an existing ACTIVE item in the same scope whose content normalizes to
 * the same string, so a repeated finding updates in place instead of adding a
 * duplicate row. Scope-exact: project items match the project; org items match
 * the org and require project_id IS NULL.
 */
export async function findActiveDuplicate(
  values: Pick<
    NewProjectMemoryItem,
    'scope' | 'projectId' | 'organizationId' | 'content' | 'restrictedFolderIds'
  >
): Promise<ProjectMemoryItem | null> {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(projectMemory)
    .where(
      and(
        consolidationScope(values),
        eq(projectMemory.status, 'active'),
        normalizedContentEquals(values.content)
      )
    )
    .orderBy(desc(projectMemory.updatedAt))
    .limit(1)
  return existing ?? null
}

const NEAR_DUP_CANDIDATE_LIMIT = 200

interface NearMatch {
  item: ProjectMemoryItem
  relation: AssertionRelation
}

export async function findActiveNearMatch(
  values: Pick<
    NewProjectMemoryItem,
    'scope' | 'projectId' | 'organizationId' | 'content' | 'kind' | 'restrictedFolderIds'
  >
): Promise<NearMatch | null> {
  const incomingTokens = contentTokens(values.content)
  if (incomingTokens.size < NEAR_DUP_MIN_TOKENS) return null
  const db = getDb()
  const candidates = await db
    .select()
    .from(projectMemory)
    .where(
      and(
        consolidationScope(values),
        eq(projectMemory.status, 'active'),
        eq(projectMemory.kind, values.kind)
      )
    )
    .orderBy(desc(projectMemory.updatedAt))
    .limit(NEAR_DUP_CANDIDATE_LIMIT)
  let best: ProjectMemoryItem | null = null
  let bestScore = NEAR_DUP_JACCARD_THRESHOLD
  for (const candidate of candidates) {
    const score = jaccardSimilarity(incomingTokens, contentTokens(candidate.content))
    if (score >= bestScore) {
      best = candidate
      bestScore = score
    }
  }
  if (!best) return null
  return { item: best, relation: assertionRelation(values.content, best.content) }
}

const SEMANTIC_DUP_THRESHOLD = 0.9

export async function findSemanticNearMatch(
  values: Pick<
    NewProjectMemoryItem,
    'scope' | 'projectId' | 'organizationId' | 'content' | 'kind' | 'restrictedFolderIds'
  >,
  embedded: EmbeddedNote | null
): Promise<NearMatch | null> {
  if (!embedded) return null
  const db = getDb()
  const owner =
    values.scope === 'organization'
      ? sql`m.scope = 'organization' and m.organization_id = ${values.organizationId} and m.project_id is null`
      : sql`m.scope = 'project' and m.project_id = ${values.projectId as string}`
  const restriction = canonicalRestriction(values.restrictedFolderIds)
  const restricted = restriction
    ? sql`m.restricted_folder_ids = ${arrayLiteral(restriction)}::uuid[]`
    : sql`m.restricted_folder_ids is null`
  const result = await db.execute(sql`
    with scored as (
      select m.*, cosine_similarity(m.embedding, ${toVectorLiteral(embedded.vector)}::real[]) as similarity
      from project_memory m
      where ${owner}
        and ${restricted}
        and m.status = 'active'
        and m.embedding_model = ${embedded.fingerprint}
    )
    select * from scored
    where similarity >= ${SEMANTIC_DUP_THRESHOLD}
    order by similarity desc
    limit 1
  `)
  const rows = executeRows(result)
  if (rows.length === 0) return null
  const raw = rows[0]
  const item = {
    id: String(raw.id),
    content: String(raw.content),
    pinned: Boolean(raw.pinned),
    verification: raw.verification,
    provenanceType: raw.provenance_type,
    confidence: (raw.confidence as ProjectMemoryConfidence | undefined) ?? 'medium',
    supersedesId: (raw.supersedes_id as string | null) ?? null,
  } as ProjectMemoryItem
  return { item, relation: assertionRelation(values.content, item.content) }
}

const SUPERSEDE_MATCH_THRESHOLD = 0.7

export async function resolveSupersedeTarget(
  values: Pick<NewProjectMemoryItem, 'scope' | 'projectId' | 'organizationId' | 'restrictedFolderIds'>,
  supersedesContent: string
): Promise<ProjectMemoryItem | null> {
  const db = getDb()
  const candidates = await db
    .select()
    .from(projectMemory)
    .where(and(consolidationScope(values), eq(projectMemory.status, 'active')))
    .orderBy(desc(projectMemory.updatedAt))
    .limit(NEAR_DUP_CANDIDATE_LIMIT)

  const normalized = normalizeContent(supersedesContent)
  if (!normalized) return null
  const [exactInScope] = await db
    .select()
    .from(projectMemory)
    .where(
      and(
        consolidationScope(values),
        eq(projectMemory.status, 'active'),
        sql`btrim(regexp_replace(lower(${projectMemory.content}), '[^a-z0-9]+', ' ', 'g')) = ${normalized}`
      )
    )
    .orderBy(desc(projectMemory.updatedAt))
    .limit(1)
  if (exactInScope && normalizeContent(exactInScope.content) === normalized) return exactInScope
  const exact = candidates.find((candidate) => normalizeContent(candidate.content) === normalized)
  if (exact) return exact

  const wanted = contentTokens(supersedesContent)
  if (wanted.size < NEAR_DUP_MIN_TOKENS) return null
  let best: ProjectMemoryItem | null = null
  let bestScore = SUPERSEDE_MATCH_THRESHOLD
  for (const candidate of candidates) {
    const score = jaccardSimilarity(wanted, contentTokens(candidate.content))
    if (score >= bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

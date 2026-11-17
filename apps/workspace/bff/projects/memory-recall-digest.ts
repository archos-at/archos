import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { contentTokens, jaccardSimilarity } from '@/lib/knowledge/consolidation'
import { embedNote } from '@/lib/knowledge/embeddings'
import { daysSince, fuseHybridRelevance, rankByRecallScore } from '@/lib/knowledge/recall-scoring'
import { backfillAfterRecall } from './memory-embedding'
import { RECALL_CANDIDATE_LIMIT, selectRecallCandidates, type DigestTiming } from './memory-recall'
import { formatTopicDigest } from './memory-digest'
import { projectTopicsOf } from './memory-topics'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import { memoryVisibleTo } from './memory-scope'

const DIGEST_MAX_CHARS = 1800
const DIGEST_MAX_ITEMS = 20

export type DigestItem = Pick<
  ProjectMemoryItem,
  'scope' | 'kind' | 'content' | 'confidence' | 'verification'
> & {
  restrictedFolderIds?: readonly string[] | null
  topic?: string | null
}

export function formatDigestLines(items: DigestItem[], omitted = 0, shelf?: MemoryTopicCount[]): string | null {
  return formatTopicDigest(items, omitted, DIGEST_MAX_CHARS, shelf)
}

const DIGEST_MAX_PINNED = 12

interface RecallCandidate extends DigestItem {
  id: string
  pinned: boolean
  salience: number
  lastReferencedAt: Date | null
  recallCount: number
  relevance: number | null
}

export interface MemoryDigestOptions {
  query?: string | null
  readableFolderIds?: readonly string[]
  admitRestricted?: (folderIds: string[]) => Promise<ReadonlySet<string>>
  timing?: DigestTiming
}

function restrictedFoldersOfItems(items: readonly Pick<DigestItem, 'restrictedFolderIds'>[]): string[] {
  return [...new Set(items.flatMap((item) => item.restrictedFolderIds ?? []))].sort()
}

function printedItems<T extends DigestItem>(items: readonly T[], digest: string | null): T[] {
  if (!digest) return []
  const lines = digest.split('\n').filter((line) => line.startsWith('- [')).length
  return items.filter((item) => item.content.replace(/\s+/g, ' ').trim()).slice(0, lines)
}

async function formatAdmittedDigest<T extends DigestItem>(
  kept: readonly T[], omitted: number, admit: MemoryDigestOptions['admitRestricted'], shelf?: MemoryTopicCount[]
): Promise<{ digest: string | null; kept: readonly T[] }> {
  const digest = formatDigestLines([...kept], omitted, shelf)
  const restricted = restrictedFoldersOfItems(printedItems(kept, digest))
  if (restricted.length === 0) return { digest, kept }
  const admitted = admit ? await admit(restricted) : new Set<string>()
  if (restricted.every((folderId) => admitted.has(folderId))) return { digest, kept }
  const allowed = kept.filter((item) => (item.restrictedFolderIds ?? []).every((name) => admitted.has(name)))
  return { digest: formatDigestLines([...allowed], omitted + kept.length - allowed.length, shelf), kept: allowed }
}

export async function buildProjectMemoryDigest(
  projectId: string | undefined,
  organizationId: string | undefined,
  options: MemoryDigestOptions = {}
): Promise<string | null> {
  if (!projectId && !organizationId) return null

  const scopeConditions = []
  if (projectId) {
    scopeConditions.push(
      organizationId
        ? and(
            eq(projectMemory.projectId, projectId),
            eq(projectMemory.organizationId, organizationId)
          )
        : eq(projectMemory.projectId, projectId)
    )
  }
  if (organizationId) {
    scopeConditions.push(
      and(
        eq(projectMemory.scope, 'organization'),
        eq(projectMemory.organizationId, organizationId),
        isNull(projectMemory.projectId)
      )
    )
  }

  const scope = and(
    scopeConditions.length > 1 ? or(...scopeConditions) : scopeConditions[0],
    eq(projectMemory.status, 'active'),
    memoryVisibleTo(options.readableFolderIds)
  )

  const queryText = options.query?.trim()
  const abandon = new AbortController()
  const embedding = queryText
    ? embedNote(queryText, { timeoutMs: 1000, signal: abandon.signal })
    : Promise.resolve(null)
  const shelfRead = projectId && organizationId ? projectTopicsOf(projectId, organizationId, []) : undefined
  const [recent, shelf] = await Promise.all([selectRecallCandidates(scope, null), shelfRead])
  const denseCanMatter =
    recent.length > 0 && (recent.length >= RECALL_CANDIDATE_LIMIT || recent.some((row) => Boolean(row.hasEmbedding)))
  if (!denseCanMatter) abandon.abort()
  const embedded = denseCanMatter ? await embedding : null
  const rows = embedded ? await selectRecallCandidates(scope, embedded) : recent
  if (options.timing) {
    options.timing.dense = !queryText ? 'no-query' : !denseCanMatter ? 'skipped' : embedded ? 'ranked' : 'unavailable'
  }

  if (rows.length === 0) return null

  const candidates: RecallCandidate[] = rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    topic: row.topic,
    kind: row.kind,
    content: row.content,
    confidence: row.confidence,
    verification: row.verification,
    restrictedFolderIds: row.restrictedFolderIds ?? null,
    pinned: row.pinned,
    salience: Number(row.salience),
    lastReferencedAt: row.lastReferencedAt ? new Date(row.lastReferencedAt) : null,
    recallCount: Number(row.recallCount),
    relevance:
      embedded && row.embeddingModel === embedded.fingerprint && row.relevance !== null
        ? Number(row.relevance)
        : null,
  }))

  const pinned = candidates.filter((candidate) => candidate.pinned)
  const unpinned = candidates.filter((candidate) => !candidate.pinned)

  const keptPinned = pinned.slice(0, DIGEST_MAX_PINNED)
  const recallSlots = Math.max(0, DIGEST_MAX_ITEMS - keptPinned.length)

  const queryTokens = queryText ? contentTokens(queryText) : null
  const lexical = unpinned.map((candidate) =>
    queryTokens ? jaccardSimilarity(queryTokens, contentTokens(candidate.content)) : 0
  )
  const relevance = fuseHybridRelevance(
    unpinned.map((candidate) => candidate.relevance),
    lexical
  )

  const ranked = rankByRecallScore(
    unpinned.map((candidate, index) => ({
      relevance: relevance[index],
      importance: candidate.salience,
      daysSinceUse: daysSince(candidate.lastReferencedAt),
      timesUsed: candidate.recallCount,
    }))
  )
  const keptRecalled = ranked.slice(0, recallSlots).map((entry) => unpinned[entry.index])

  backfillAfterRecall(candidates, rows, embedded, Boolean(queryText) && !denseCanMatter)

  const selected = [...keptPinned, ...keptRecalled]
  const omitted = candidates.length - selected.length
  const { digest, kept } = await formatAdmittedDigest(selected, omitted, options.admitRestricted, shelf)

  if (queryText) void markMemoryRecalled(kept.map((item) => item.id))

  return digest
}

async function markMemoryRecalled(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await getDb()
      .update(projectMemory)
      .set({
        lastReferencedAt: new Date(),
        recallCount: sql`${projectMemory.recallCount} + 1`,
      })
      .where(inArray(projectMemory.id, ids))
  } catch (error) {
    console.warn('[memory] Could not record recall reinforcement (non-fatal):', error)
  }
}

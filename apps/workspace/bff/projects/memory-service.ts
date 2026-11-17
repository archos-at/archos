import { isUniqueViolation } from '@/lib/db/errors'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { getDb } from '@/lib/db'
import { executeRows } from '@/lib/db/execute-rows'
import { BadRequestError, ConflictError } from '@/lib/api/errors'
import type { OffsetPage } from '@/lib/api/offset-page'
import { sourceFoldersOfCollections } from '@/lib/authz/folder-access'
import { isProjectClosed, projectClosedError } from './project-status'
import { PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS, projectMemory } from '@/lib/db/schema/project-memory'
import { projects } from '@/lib/db/schema/projects'
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
import { embedNote, enrichForEmbedding, toVectorLiteral, type EmbeddedNote } from '@/lib/knowledge/embeddings'
import { assertStorableNote } from '@/lib/knowledge/note-content-guard'
import { daysSince, fuseHybridRelevance, rankByRecallScore } from '@/lib/knowledge/recall-scoring'
import { STALE_VECTOR, backfillAfterRecall, embedStoredNote } from './memory-embedding'
import { refuseStatusMove, statusMayBecome, supersedable } from './memory-status'
import { RECALL_CANDIDATE_LIMIT, selectRecallCandidates, type DigestTiming } from './memory-recall'
import { formatTopicDigest } from './memory-digest'
import { restatedTopicSet } from './memory-refresh-topic'
import { projectTopicsOf } from './memory-topics'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import { maskChatText } from '@/lib/upload-screening/service'

export { PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS }


export function canonicalRestriction(
  folderIds: readonly string[] | null | undefined
): string[] | null {
  const unique = [...new Set((folderIds ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean))].sort()
  return unique.length > 0 ? unique : null
}

function arrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/["\\]/g, '\\$&')}"`).join(',')}}`
}

function sameRestriction(restriction: readonly string[] | null) {
  return restriction
    ? sql`${projectMemory.restrictedFolderIds} = ${arrayLiteral(restriction)}::uuid[]`
    : isNull(projectMemory.restrictedFolderIds)
}

export function memoryVisibleTo(
  readable: readonly string[] = [],
  column: AnyPgColumn = projectMemory.restrictedFolderIds
) {
  const restriction = canonicalRestriction(readable)
  return restriction
    ? sql`(${column} is null or ${column} <@ ${arrayLiteral(restriction)}::uuid[])`
    : isNull(column)
}

const DIGEST_MAX_CHARS = 1800
const DIGEST_MAX_ITEMS = 20

const CONFIDENCE_RANK: Record<ProjectMemoryConfidence, number> = { low: 0, medium: 1, high: 2 }

function normalizedContentEquals(content: string) {
  return sql`btrim(regexp_replace(lower(${projectMemory.content}), '[^a-z0-9]+', ' ', 'g')) = ${normalizeContent(content)}`
}

function memoryOwnerCondition(
  values: Pick<NewProjectMemoryItem, 'scope' | 'projectId' | 'organizationId'>
) {
  return values.scope === 'organization'
    ? and(
        eq(projectMemory.scope, 'organization'),
        eq(projectMemory.organizationId, values.organizationId),
        isNull(projectMemory.projectId)
      )
    : and(
        eq(projectMemory.scope, 'project'),
        eq(projectMemory.projectId, values.projectId as string)
      )
}

function consolidationScope(
  values: Pick<NewProjectMemoryItem, 'scope' | 'projectId' | 'organizationId' | 'restrictedFolderIds'>
) {
  return and(memoryOwnerCondition(values), sameRestriction(canonicalRestriction(values.restrictedFolderIds)))
}

/**
 * The write-time de-duplication gate (a pragmatic first slice of design §3.2).
 * Finds an existing ACTIVE item in the same scope whose content normalizes to
 * the same string, so a repeated finding updates in place instead of adding a
 * duplicate row. Scope-exact: project items match the project; org items match
 * the org and require project_id IS NULL.
 */
async function findActiveDuplicate(
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

async function findActiveNearMatch(
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

async function findSemanticNearMatch(
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

async function resolveSupersedeTarget(
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

function isAgentSupersedable(item: ProjectMemoryItem): boolean {
  return !item.pinned && item.verification !== 'user_confirmed' && item.provenanceType !== 'user'
}

export async function listProjectMemory(
  projectId: string,
  options: {
    includeArchived?: boolean
    organizationId?: string
    sourceConversationId?: string
    readableFolderIds?: readonly string[]
    page?: OffsetPage
  } = {}
): Promise<ProjectMemoryItem[]> {
  const db = getDb()

  const projectCondition = options.organizationId
    ? and(
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.organizationId, options.organizationId)
      )
    : eq(projectMemory.projectId, projectId)
  const scopeCondition = options.organizationId
    ? or(
        projectCondition,
        and(
          eq(projectMemory.scope, 'organization'),
          eq(projectMemory.organizationId, options.organizationId),
          isNull(projectMemory.projectId)
        )
      )
    : projectCondition

  const conditions = [scopeCondition]
  if (!options.includeArchived) {
    conditions.push(eq(projectMemory.status, 'active'))
  }
  conditions.push(memoryVisibleTo(options.readableFolderIds))
  if (options.sourceConversationId) {
    conditions.push(eq(projectMemory.sourceConversationId, options.sourceConversationId))
  }
  const query = db
    .select()
    .from(projectMemory)
    .where(and(...conditions))
    .orderBy(desc(projectMemory.pinned), desc(projectMemory.updatedAt), desc(projectMemory.id))
  return options.page ? query.limit(options.page.limit + 1).offset(options.page.offset) : query
}

export async function listOrganizationMemory(
  organizationId: string,
  options: { includeArchived?: boolean; sourceConversationId?: string; page?: OffsetPage } = {}
): Promise<ProjectMemoryItem[]> {
  const db = getDb()
  const conditions = [
    eq(projectMemory.scope, 'organization'),
    eq(projectMemory.organizationId, organizationId),
    isNull(projectMemory.restrictedFolderIds),
  ]
  if (!options.includeArchived) {
    conditions.push(eq(projectMemory.status, 'active'))
  }
  if (options.sourceConversationId) conditions.push(eq(projectMemory.sourceConversationId, options.sourceConversationId))
  const query = db
    .select()
    .from(projectMemory)
    .where(and(...conditions))
    .orderBy(desc(projectMemory.pinned), desc(projectMemory.updatedAt), desc(projectMemory.id))
  return options.page ? query.limit(options.page.limit + 1).offset(options.page.offset) : query
}

export interface CreateMemoryOptions {
  supersedesContent?: string | null
  onSuperseded?: (supersededId: string) => void
}

async function refreshDuplicate(
  duplicate: ProjectMemoryItem,
  values: NewProjectMemoryItem,
  rewrite = false
): Promise<ProjectMemoryItem> {
  const incoming = (values.confidence ?? 'medium') as ProjectMemoryConfidence
  const best =
    CONFIDENCE_RANK[incoming] > CONFIDENCE_RANK[duplicate.confidence]
      ? incoming
      : duplicate.confidence
  const [updated] = await getDb()
    .update(projectMemory)
    .set({
      ...(rewrite ? { content: values.content, ...STALE_VECTOR } : {}),
      ...restatedTopicSet(values.topic),
      confidence: best,
      lastReferencedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectMemory.id, duplicate.id))
    .returning()
  return updated ?? duplicate
}

async function storableNote(organizationId: string, content: string, refuseContact: boolean): Promise<string> {
  const text = (await maskChatText(organizationId, content)).text
  assertStorableNote(text, { refuseContact })
  return text
}

export async function createProjectMemoryItem(
  input: NewProjectMemoryItem,
  options: CreateMemoryOptions = {}
): Promise<ProjectMemoryItem> {
  const db = getDb()
  const restrictedFolderIds = canonicalRestriction(input.restrictedFolderIds)
  if (restrictedFolderIds && input.scope !== 'project') {
    throw new BadRequestError('Restricted memory is project memory')
  }
  const content = await storableNote(input.organizationId, input.content, input.provenanceType !== 'user')
  const restrictionJudge = restrictedFolderIds ? (input.restrictionJudge ?? null) : null
  const values: NewProjectMemoryItem = { ...input, content, restrictedFolderIds, restrictionJudge }

  const exact = await findActiveDuplicate(values)
  if (exact) {
    const corrected = assertionRelation(values.content, exact.content) === 'corrected'
    return refreshDuplicate(exact, values, corrected && isAgentSupersedable(exact))
  }

  const embedded = await embedNote(enrichForEmbedding(values.content, [values.kind]))

  const near =
    (await findSemanticNearMatch(values, embedded)) ?? (await findActiveNearMatch(values))
  const named = options.supersedesContent?.trim()
    ? await resolveSupersedeTarget(values, options.supersedesContent)
    : null
  if (near && near.relation !== 'corrected') {
    const refreshed = await refreshDuplicate(near.item, values)
    if (named && named.id !== refreshed.id && isAgentSupersedable(named)) {
      const retired = await db
        .update(projectMemory)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(and(eq(projectMemory.id, named.id), supersedable()))
        .returning({ id: projectMemory.id })
      if (retired.length > 0) options.onSuperseded?.(named.id)
    }
    return refreshed
  }

  const replaced = [near?.item, named].filter(
    (item, index, all): item is ProjectMemoryItem => !!item && all.findIndex((other) => other?.id === item.id) === index
  )
  const retiring = replaced.filter(isAgentSupersedable)
  const supersedeTarget = retiring[0] ?? null
  const conflictsWithId = replaced.find((item) => !isAgentSupersedable(item))?.id ?? null
  if (conflictsWithId) {
    console.warn(`[memory] Not superseding human-curated item ${conflictsWithId} (pinned/user-confirmed/user-authored)`)
  }

  const insertValues: NewProjectMemoryItem = {
    ...values,
    ...(embedded ? { embedding: embedded.vector, embeddingModel: embedded.fingerprint, embeddedAt: new Date() } : {}),
    ...(supersedeTarget ? { supersedesId: supersedeTarget.id } : {}),
    ...(conflictsWithId ? { conflictsWithId } : {}),
  }

  try {
    if (!supersedeTarget) {
      const [item] = await db.insert(projectMemory).values(insertValues).returning()
      return item
    }
    return await db.transaction(async (tx) => {
      const [item] = await tx.insert(projectMemory).values(insertValues).returning()
      for (const target of retiring) {
        const retired = await tx
          .update(projectMemory)
          .set({ status: 'superseded', updatedAt: new Date() })
          .where(and(eq(projectMemory.id, target.id), supersedable()))
          .returning({ id: projectMemory.id })
        if (retired.length > 0) options.onSuperseded?.(target.id)
      }
      return item
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findActiveDuplicate(values)
      if (winner) return winner
    }
    throw err
  }
}

async function restrictionFromCollections(
  organizationId: string,
  projectId: string,
  projectCollection: string,
  collections: readonly string[] | null | undefined
): Promise<string[] | null> {
  const named = [...new Set((collections ?? []).map((name) => name.trim()).filter(Boolean))]
  if (named.length === 0) return null
  if (named.length > PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS) {
    throw new BadRequestError(`At most ${PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS} restricted collections`)
  }
  const sources = await sourceFoldersOfCollections(organizationId, projectId, projectCollection, named)
  const unknown = named.filter((name) => !sources.has(name))
  if (unknown.length > 0) {
    throw new BadRequestError(`Not a restricted collection of this project: ${unknown.join(', ')}`)
  }
  return canonicalRestriction([...sources.values()])
}

export async function resolveProjectOrganization(projectId: string): Promise<string | null> {
  const [project] = await getDb()
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project?.organizationId ?? null
}

export async function createProjectMemoryItemForProject(
  projectId: string,
  values: Omit<NewProjectMemoryItem, 'projectId' | 'organizationId' | 'scope' | 'restrictedFolderIds'> & {
    restrictedCollections?: readonly string[] | null
  },
  options: CreateMemoryOptions = {}
): Promise<ProjectMemoryItem | null> {
  const db = getDb()
  const [project] = await db
    .select({ organizationId: projects.organizationId, collectionName: projects.collectionName, status: projects.status })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) return null
  if (isProjectClosed(project)) throw projectClosedError()

  const { restrictedCollections, ...rest } = values
  const restrictedFolderIds = await restrictionFromCollections(
    project.organizationId,
    projectId,
    project.collectionName,
    restrictedCollections
  )
  return createProjectMemoryItem(
    {
      ...rest,
      restrictedFolderIds,
      scope: 'project',
      projectId,
      organizationId: project.organizationId,
    },
    options
  )
}

export type MemoryOwner =
  | {
      projectId: string
      organizationId: string
      readableFolderIds: readonly string[]
    }
  | { organizationId: string }

function ownerCondition(owner: MemoryOwner) {
  return 'projectId' in owner
    ? and(eq(projectMemory.projectId, owner.projectId), memoryVisibleTo(owner.readableFolderIds))
    : and(
        eq(projectMemory.scope, 'organization'),
        eq(projectMemory.organizationId, owner.organizationId),
        isNull(projectMemory.restrictedFolderIds)
      )
}

export async function updateProjectMemoryItem(
  owner: MemoryOwner,
  itemId: string,
  patch: Partial<
    Pick<
      ProjectMemoryItem,
      'content' | 'kind' | 'status' | 'confidence' | 'verification' | 'pinned' | 'salience' | 'topic'
    >
  >
): Promise<ProjectMemoryItem | null> {
  const masked =
    patch.content === undefined
      ? patch
      : { ...patch, content: await storableNote(owner.organizationId, patch.content, false) }
  const reworded = patch.content !== undefined || patch.kind !== undefined
  try {
    const [item] = await getDb()
      .update(projectMemory)
      .set({ ...masked, ...(reworded ? STALE_VECTOR : {}), updatedAt: new Date() })
      .where(and(eq(projectMemory.id, itemId), ownerCondition(owner), statusMayBecome(patch.status)))
      .returning()
    if (!item) return patch.status ? refuseStatusMove(itemId, ownerCondition(owner), patch.status) : null
    return reworded ? embedStoredNote(item) : item
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('Another note already says this')
    throw error
  }
}

export async function deleteProjectMemoryItem(
  owner: MemoryOwner,
  itemId: string
): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(projectMemory)
    .where(and(eq(projectMemory.id, itemId), ownerCondition(owner)))
    .returning({ id: projectMemory.id })
  return deleted.length > 0
}

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

export async function organizationExists(organizationId: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .limit(1)
  return rows.length > 0
}

const IMPLICATION_THRESHOLD = 0.78
const IMPLICATION_LIMIT = 2
const IMPLICATION_SALIENCE_DECAY = 0.6
const IMPLICATION_SALIENCE_FLOOR = 0.05

export async function implicateMemoryFromFeedback(input: {
  organizationId: string
  projectId: string | null
  comment: string
  readableFolderIds: readonly string[]
}): Promise<number> {
  const text = input.comment.trim()
  if (!text) return 0
  try {
    const embedded = await embedNote(text.slice(0, 500))
    if (!embedded) return 0
    const db = getDb()
    const owner = input.projectId
      ? sql`m.organization_id = ${input.organizationId} and ((m.scope = 'project' and m.project_id = ${input.projectId}) or (m.scope = 'organization' and m.project_id is null))`
      : sql`m.organization_id = ${input.organizationId} and m.scope = 'organization' and m.project_id is null`
    const restriction = canonicalRestriction(input.readableFolderIds)
    const visible = restriction
      ? sql`(m.restricted_folder_ids is null or m.restricted_folder_ids <@ ${arrayLiteral(restriction)}::uuid[])`
      : sql`m.restricted_folder_ids is null`
    const result = await db.execute(sql`
      with scored as (
        select m.id, cosine_similarity(m.embedding, ${toVectorLiteral(embedded.vector)}::real[]) as similarity
        from project_memory m
        where ${owner}
          and ${visible}
          and m.status = 'active'
          and m.pinned = false
          and m.embedding_model = ${embedded.fingerprint}
      ),
      implicated as (
        select id from scored
        where similarity >= ${IMPLICATION_THRESHOLD}
        order by similarity desc
        limit ${IMPLICATION_LIMIT}
      )
      update project_memory p
      set salience = greatest(${IMPLICATION_SALIENCE_FLOOR}, p.salience * ${IMPLICATION_SALIENCE_DECAY}),
          confidence = 'low',
          updated_at = now()
      from implicated i
      where p.id = i.id
      returning p.id
    `)
    return executeRows(result).length
  } catch (error) {
    console.warn('[memory] Feedback implication failed (non-fatal):', error)
    return 0
  }
}

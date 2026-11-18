import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { executeRows } from '@/lib/db/execute-rows'
import { ConflictError } from '@/lib/api/errors'
import type { OffsetPage } from '@/lib/api/offset-page'
import { isUniqueViolation } from '@/lib/db/errors'
import { PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS, projectMemory } from '@/lib/db/schema/project-memory'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { projects } from '@/lib/db/schema/projects'
import { embedNote, toVectorLiteral } from '@/lib/knowledge/embeddings'
import { STALE_VECTOR, embedStoredNote } from './memory-embedding'
import { refuseStatusMove, statusMayBecome } from './memory-status'
import { arrayLiteral, canonicalRestriction, memoryVisibleTo } from './memory-scope'
import { storableNote } from './memory-create'

export { PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS, canonicalRestriction, memoryVisibleTo }
export { createProjectMemoryItem, createProjectMemoryItemForProject } from './memory-create'
export type { CreateMemoryOptions } from './memory-create'
export { buildProjectMemoryDigest, formatDigestLines } from './memory-recall-digest'
export type { DigestItem, MemoryDigestOptions } from './memory-recall-digest'

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

export async function resolveProjectOrganization(projectId: string): Promise<string | null> {
  const [project] = await getDb()
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project?.organizationId ?? null
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

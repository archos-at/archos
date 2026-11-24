import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import { PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS, projectMemory } from '@/lib/db/schema/project-memory'
import type { NewProjectMemoryItem, ProjectMemoryConfidence, ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { projects } from '@/lib/db/schema/projects'
import { BadRequestError } from '@/lib/api/errors'
import { sourceFoldersOfCollections } from '@/lib/authz/folder-access'
import { assertionRelation } from '@/lib/knowledge/consolidation'
import { embedNote, enrichForEmbedding } from '@/lib/knowledge/embeddings'
import { assertStorableNote } from '@/lib/knowledge/note-content-guard'
import { maskChatText } from '@/lib/upload-screening/service'
import { isProjectClosed, projectClosedError } from './project-status'
import { STALE_VECTOR } from './memory-embedding'
import { supersedable } from './memory-status'
import { restatedTopicSet } from './memory-refresh-topic'
import { canonicalRestriction } from './memory-scope'
import { findActiveDuplicate, findActiveNearMatch, findSemanticNearMatch, resolveSupersedeTarget } from './memory-matching'

const CONFIDENCE_RANK: Record<ProjectMemoryConfidence, number> = { low: 0, medium: 1, high: 2 }

function isAgentSupersedable(item: ProjectMemoryItem): boolean {
  return !item.pinned && item.verification !== 'user_confirmed' && item.provenanceType !== 'user'
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

export async function storableNote(organizationId: string, content: string, refuseContact: boolean): Promise<string> {
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

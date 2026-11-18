import 'server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { getDb } from '@/lib/db'
import { folderCards } from '@/lib/db/schema/folder-cards'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'
import { officeShelfCollectionNames } from '@/lib/office-shelf/collection'
import { normalizeFolderPath } from '@/lib/projects/folders'
import {
  cardCollectionResolver,
  cardsInCollection,
  isCollectionOfProject,
  projectCollectionCandidates,
  type FolderWithCard,
} from './collection-scope'
import type { FolderCardView, FolderDescriptionView, PutFolderCardRequest } from './types'

export { FOLDER_CARDS_LIMIT } from './collection-scope'

export interface CardFolder {
  folderId: string
  scope: 'project' | 'office_shelf'
}

interface CollectionOwner {
  scope: 'project' | 'office_shelf'
  projectId: string | null
  projectCollection: string | null
}

export async function findCardFolder(
  organizationId: string,
  collection: string,
  folderPath: string,
): Promise<CardFolder | null> {
  const path = normalizeFolderPath(folderPath)
  if (!path) return null
  const db = getDb()
  const owner = await resolveCollectionOwner(organizationId, collection)
  if (!owner) return null
  const [row] = await db
    .select({ id: projectFolders.id })
    .from(projectFolders)
    .where(
      and(
        eq(projectFolders.organizationId, organizationId),
        eq(projectFolders.scope, owner.scope),
        owner.projectId ? eq(projectFolders.projectId, owner.projectId) : isNull(projectFolders.projectId),
        eq(projectFolders.path, path),
        isNull(projectFolders.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null
  if (owner.projectId && owner.projectCollection) {
    const tree = await listProjectFolderTree(organizationId, owner.projectId)
    if (cardCollectionResolver(tree, owner.projectCollection)(row.id) !== collection) return null
  }
  return { folderId: row.id, scope: owner.scope }
}

async function resolveCollectionOwner(organizationId: string, collection: string): Promise<CollectionOwner | null> {
  if (officeShelfCollectionNames(organizationId).includes(collection)) {
    return { scope: 'office_shelf', projectId: null, projectCollection: null }
  }
  const db = getDb()
  for (const name of projectCollectionCandidates(collection)) {
    const [project] = await db
      .select({ id: projects.id, collectionName: projects.collectionName })
      .from(projects)
      .where(and(eq(projects.collectionName, name), eq(projects.organizationId, organizationId)))
      .limit(1)
    if (project?.collectionName && isCollectionOfProject(project.collectionName, collection)) {
      return { scope: 'project', projectId: project.id, projectCollection: project.collectionName }
    }
  }
  return null
}

export async function upsertFolderCard(
  organizationId: string,
  folder: CardFolder,
  body: PutFolderCardRequest,
): Promise<void> {
  const db = getDb()
  const now = new Date()
  const fresh = body.status === 'fresh'
  const values = {
    collection: body.collection,
    abstract: body.abstract,
    keyFacts: body.key_facts,
    inputHash: body.input_hash,
    abstractHash: body.abstract_hash,
    model: body.model,
    promptVersion: body.prompt_version,
    status: body.status,
    updatedAt: now,
  }
  await db
    .insert(folderCards)
    .values({
      organizationId,
      folderId: folder.folderId,
      scope: folder.scope,
      ...values,
      generatedAt: fresh ? now : null,
    })
    .onConflictDoUpdate({
      target: folderCards.folderId,
      set: { ...values, generatedAt: fresh ? now : sql`${folderCards.generatedAt}` },
    })
}

export async function getFolderCards(
  organizationId: string,
  collection: string,
): Promise<{ cards: FolderCardView[]; folders: FolderDescriptionView[] }> {
  const owner = await resolveCollectionOwner(organizationId, collection)
  if (!owner) return { cards: [], folders: [] }
  const db = getDb()
  const rows = await db
    .select({
      folderId: projectFolders.id,
      folderPath: projectFolders.path,
      folderDescription: projectFolders.description,
      cardId: folderCards.id,
      abstract: folderCards.abstract,
      keyFacts: folderCards.keyFacts,
      inputHash: folderCards.inputHash,
      abstractHash: folderCards.abstractHash,
      model: folderCards.model,
      promptVersion: folderCards.promptVersion,
      status: folderCards.status,
      generatedAt: folderCards.generatedAt,
      updatedAt: folderCards.updatedAt,
    })
    .from(projectFolders)
    .leftJoin(
      folderCards,
      and(eq(folderCards.folderId, projectFolders.id), eq(folderCards.organizationId, organizationId)),
    )
    .where(
      and(
        eq(projectFolders.organizationId, organizationId),
        eq(projectFolders.scope, owner.scope),
        owner.projectId ? eq(projectFolders.projectId, owner.projectId) : isNull(projectFolders.projectId),
        isNull(projectFolders.deletedAt),
      ),
    )
    .orderBy(asc(projectFolders.path))
  const folders: FolderWithCard[] = rows.map((row) => ({
    folderId: row.folderId,
    folderPath: row.folderPath,
    folderDescription: row.folderDescription,
    card:
      row.cardId && row.inputHash !== null && row.status !== null && row.updatedAt !== null
        ? {
            abstract: row.abstract,
            keyFacts: row.keyFacts ?? [],
            inputHash: row.inputHash,
            abstractHash: row.abstractHash,
            model: row.model,
            promptVersion: row.promptVersion,
            status: row.status,
            generatedAt: row.generatedAt,
            updatedAt: row.updatedAt,
          }
        : null,
  }))
  if (!owner.projectId || !owner.projectCollection) return cardsInCollection(folders, collection, () => collection)
  const tree = await listProjectFolderTree(organizationId, owner.projectId)
  return cardsInCollection(folders, collection, cardCollectionResolver(tree, owner.projectCollection))
}

export async function deleteFolderCard(organizationId: string, folder: CardFolder): Promise<boolean> {
  const db = getDb()
  const removed = await db
    .delete(folderCards)
    .where(and(eq(folderCards.organizationId, organizationId), eq(folderCards.folderId, folder.folderId)))
    .returning({ id: folderCards.id })
  return removed.length > 0
}

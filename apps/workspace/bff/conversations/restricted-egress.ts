import 'server-only'
import { ConversationConfinedError } from '@/lib/api/errors'
import { errorsCopy } from '@/i18n/namespaces/errors'
import type { Locale } from '@/i18n/config'
import { asShelf } from '@/lib/source-kinds'
import { folderTree, readableByEveryMember } from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { internalRead } from '@/lib/documents/document-reader'
import { findProjectDocumentsByFilenames } from '@/lib/documents/repository'
import type { PlanDocument } from '@/lib/runs/plan-documents'
import { recordedRestrictedFolders, recordedSourceProjects } from './restricted-use'

export type ConfinedAction = ConversationConfinedError['action']

export const AGENT_REFUSAL_LOCALE: Locale = 'de'

export function confinementRefusal(action: ConfinedAction, locale: Locale): ConversationConfinedError {
  return new ConversationConfinedError(action, errorsCopy.messages[locale].confinement[action])
}

export interface ConversationOrigin {
  conversationId: string | null
  locale: Locale
}

async function originFolders(origin: ConversationOrigin, organizationId: string): Promise<string[]> {
  if (!origin.conversationId) return []
  return recordedRestrictedFolders(origin.conversationId, organizationId)
}

async function originProjects(origin: ConversationOrigin, organizationId: string): Promise<string[]> {
  if (!origin.conversationId) return []
  return recordedSourceProjects(origin.conversationId, organizationId)
}

export async function requireMayLeaveConversation(
  origin: ConversationOrigin,
  organizationId: string,
  action: Exclude<ConfinedAction, 'filing' | 'planDocument'>
): Promise<void> {
  const [folders, projects] = await Promise.all([
    originFolders(origin, organizationId),
    originProjects(origin, organizationId),
  ])
  if (folders.length > 0 || projects.length > 0) throw confinementRefusal(action, origin.locale)
}

export interface FilingDestination {
  organizationId: string
  projectId: string | null
  projectCollection: string
  folderId: string | null
}

export async function requireMayFileFrom(origin: ConversationOrigin, destination: FilingDestination): Promise<void> {
  const { organizationId, projectId, folderId } = destination
  if ((await originProjects(origin, organizationId)).length > 0) throw confinementRefusal('filing', origin.locale)
  const required = await originFolders(origin, organizationId)
  if (required.length === 0) return
  if (projectId === null || folderId === null) throw confinementRefusal('filing', origin.locale)
  const tree = folderTree(await listProjectFolderTree(organizationId, projectId))
  const path = new Set<string>()
  for (let current = tree.get(folderId); current && !current.deleted && !path.has(current.id); ) {
    path.add(current.id)
    current = current.parentId ? tree.get(current.parentId) : undefined
  }
  if (required.every((source) => path.has(source))) return
  throw confinementRefusal('filing', origin.locale)
}

export async function folderRestrictsReading(
  organizationId: string,
  projectId: string | null,
  folderId: string | null
): Promise<boolean> {
  if (projectId === null || folderId === null) return false
  const tree = folderTree(await listProjectFolderTree(organizationId, projectId))
  return !readableByEveryMember(tree, folderId)
}


export async function requirePlanDocumentsOpen(
  organizationId: string,
  projectId: string,
  documents: readonly PlanDocument[],
  locale: Locale
): Promise<void> {
  const names = documents.filter((document) => asShelf(document.shelf) !== 'office_shelf').map((document) => document.name)
  if (names.length === 0) return
  const folders = await listProjectFolderTree(organizationId, projectId)
  if (!folders.some((folder) => folder.accessMode === 'custom')) return
  const tree = folderTree(folders)
  const rows = await findProjectDocumentsByFilenames(projectId, organizationId, names, {
    includeArchived: true,
    reader: internalRead('identity'),
  })
  if (rows.some((row) => row.folderId !== null && !readableByEveryMember(tree, row.folderId))) {
    throw confinementRefusal('planDocument', locale)
  }
}

import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  ANY_MEMBER,
  atLeast,
  clearanceOf,
  clearanceOfMember,
  computeFolderAccess,
  effectiveFolderLevel,
  EVERY_FOLDER,
  folderTree,
  readableByEveryMember,
  type AccessFolder,
  type FolderClearance,
  type FolderTree,
} from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { userHoldsProjectPermission } from '@/lib/authz/project-membership'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getDb } from '@/lib/db'
import { personalShelfUsed } from './personal-shelf-use'
import { findProjectCollectionName } from '@/lib/projects/repository'
import { readConversationRow } from '@/lib/conversation-context/audience'
import { recordAnswerReads } from '@/lib/conversation-context/record'
import {
  listRecordedSourceFolders,
  listRecordedSourceFoldersFor,
  listRestrictingSourceProjects,
  listRestrictingSourceProjectsFor,
  lockConversationAudience,
  markAnswerRestrictedUse,
  projectsOfFolders,
  readConversationAudience,
  recordSourceFolders,
  type ConversationAudienceRow,
} from './restricted-use-repository'

export const ADMISSION_MAX_COLLECTIONS = 50

function audiencePeople(audience: ConversationAudienceRow, askerUserId: string | null): string[] {
  return [
    ...new Set([askerUserId, audience.createdBy, ...audience.grantees].filter((id): id is string => Boolean(id))),
  ]
}

export function mayReadFolder(tree: FolderTree, clearance: FolderClearance, folderId: string): boolean {
  return atLeast(effectiveFolderLevel(tree, clearance, folderId), 'read')
}

export function foldersEveryoneMayRead(
  tree: FolderTree,
  candidates: readonly string[],
  audience: Pick<ConversationAudienceRow, 'visibility'>,
  people: readonly string[],
  clearances: ReadonlyMap<string, FolderClearance>
): string[] {
  if (audience.visibility !== 'private') return []
  return candidates.filter((folderId) =>
    people.every((person) => {
      const clearance = clearances.get(person)
      return clearance !== undefined && mayReadFolder(tree, clearance, folderId)
    })
  )
}

export interface ProjectRef {
  projectId: string
  projectCollection: string
}

export async function projectOf(
  organizationId: string,
  audience: ConversationAudienceRow,
  statedProjectId: string | null
): Promise<ProjectRef | null> {
  const projectId = audience.exists ? audience.projectId : statedProjectId
  if (!projectId) return null
  const projectCollection = await findProjectCollectionName(projectId, organizationId)
  return projectCollection ? { projectId, projectCollection } : null
}

async function treeOf(organizationId: string, project: ProjectRef): Promise<FolderTree> {
  return folderTree(await listProjectFolderTree(organizationId, project.projectId))
}

export interface RecordView {
  tree: FolderTree
  ownerOf: ReadonlyMap<string, string>
}

export async function recordView(
  organizationId: string,
  projectId: string | null,
  folderIds: readonly string[]
): Promise<RecordView> {
  const merged = new Map<string, AccessFolder>()
  const ownerOf = new Map<string, string>()
  const load = async (owner: string) => {
    for (const folder of await listProjectFolderTree(organizationId, owner)) {
      merged.set(folder.id, folder)
      ownerOf.set(folder.id, owner)
    }
  }
  if (projectId) await load(projectId)
  const missing = folderIds.filter((folderId) => !merged.has(folderId))
  if (missing.length === 0) return { tree: merged, ownerOf }
  const owners = new Set((await projectsOfFolders(getDb(), organizationId, missing)).values())
  owners.delete(projectId ?? '')
  for (const owner of owners) await load(owner)
  return { tree: merged, ownerOf }
}

export function ownersOf(view: RecordView, folderIds: readonly string[]): string[] {
  return [...new Set(folderIds.map((folderId) => view.ownerOf.get(folderId)).filter((owner): owner is string => !!owner))]
}

export function mayReadEvery(
  view: RecordView,
  clearanceIn: (projectId: string) => FolderClearance | undefined,
  folderIds: readonly string[]
): boolean {
  return folderIds.every((folderId) => {
    const owner = view.ownerOf.get(folderId)
    const clearance = owner ? clearanceIn(owner) : undefined
    return clearance !== undefined && mayReadFolder(view.tree, clearance, folderId)
  })
}

const PROJECT_CHECK_CONCURRENCY = 20

async function peopleWhoMayOpen(
  organizationId: string,
  people: readonly string[],
  projectIds: readonly string[]
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set(people)
  const opensAll = async (person: string): Promise<boolean> => {
    for (const projectId of projectIds) {
      if (!(await userHoldsProjectPermission({ organizationId }, projectId, person, 'project:view'))) return false
    }
    return true
  }
  const opening = new Set<string>()
  for (let start = 0; start < people.length; start += PROJECT_CHECK_CONCURRENCY) {
    const chunk = people.slice(start, start + PROJECT_CHECK_CONCURRENCY)
    const verdicts = await Promise.all(chunk.map(opensAll))
    chunk.forEach((person, index) => {
      if (verdicts[index]) opening.add(person)
    })
  }
  return opening
}

export async function sessionMayOpenAll(
  session: AuthorizedSession,
  projectIds: readonly string[],
  known: Map<string, boolean>
): Promise<boolean> {
  for (const projectId of projectIds) {
    let opens = known.get(projectId)
    if (opens === undefined) {
      opens = await requireProjectAccess(session, projectId, 'project:view').then(
        () => true,
        () => false
      )
      known.set(projectId, opens)
    }
    if (!opens) return false
  }
  return true
}

const CLEARANCE_CONCURRENCY = 20

async function clearancesOf(
  organizationId: string,
  projectId: string | null,
  people: readonly string[],
  known: ReadonlyMap<string, FolderClearance> = new Map()
): Promise<Map<string, FolderClearance>> {
  const clearances = new Map<string, FolderClearance>()
  for (let start = 0; start < people.length; start += CLEARANCE_CONCURRENCY) {
    const chunk = people.slice(start, start + CLEARANCE_CONCURRENCY)
    const found = await Promise.all(
      chunk.map((person) => known.get(person) ?? (projectId ? clearanceOfMember(organizationId, person, projectId) : ANY_MEMBER))
    )
    chunk.forEach((person, index) => clearances.set(person, found[index]))
  }
  return clearances
}

export function stillRestricting(tree: FolderTree, recorded: readonly string[]): string[] {
  return recorded.filter((folderId) => !readableByEveryMember(tree, folderId))
}

export interface ConversationRecord {
  folders: string[]
  otherProjects: string[]
  personalShelf: boolean
}

export async function conversationRecord(
  organizationId: string,
  conversationId: string,
  projectId: string | null
): Promise<ConversationRecord> {
  const [recorded, projects, personalShelf] = await Promise.all([
    listRecordedSourceFolders(getDb(), organizationId, conversationId),
    listRestrictingSourceProjects(getDb(), organizationId, conversationId),
    personalShelfUsed(organizationId, conversationId),
  ])
  if (recorded.length === 0) return { folders: [], otherProjects: projects, personalShelf }
  const view = await recordView(organizationId, projectId, recorded)
  const folders = stillRestricting(view.tree, recorded)
  const foreign = folders
    .filter((folderId) => view.ownerOf.get(folderId) !== projectId)
    .map((folderId) => view.ownerOf.get(folderId) ?? folderId)
  return { folders, otherProjects: [...new Set([...projects, ...foreign])], personalShelf }
}

export async function recordedRestrictedFolders(conversationId: string, organizationId: string): Promise<string[]> {
  const recorded = await listRecordedSourceFolders(getDb(), organizationId, conversationId)
  if (recorded.length === 0) return []
  const audience = await readConversationRow(organizationId, conversationId)
  return stillRestricting((await recordView(organizationId, audience.projectId, recorded)).tree, recorded)
}

export async function recordedForeignRestrictedFolders(
  conversationId: string,
  organizationId: string
): Promise<Map<string, string | null>> {
  const recorded = await listRecordedSourceFolders(getDb(), organizationId, conversationId)
  if (recorded.length === 0) return new Map()
  const audience = await readConversationRow(organizationId, conversationId)
  const view = await recordView(organizationId, audience.projectId, recorded)
  return new Map(
    stillRestricting(view.tree, recorded)
      .filter((folderId) => view.ownerOf.get(folderId) !== audience.projectId)
      .map((folderId) => [folderId, view.ownerOf.get(folderId) ?? null])
  )
}

export async function recordedSourceProjects(conversationId: string, organizationId: string): Promise<string[]> {
  return listRestrictingSourceProjects(getDb(), organizationId, conversationId)
}

export const READERS_MAX_PEOPLE = 200

export async function peopleWhoMayRead(
  organizationId: string,
  conversationId: string,
  userIds: readonly string[],
  known: ReadonlyMap<string, FolderClearance> = new Map(),
  asker?: AuthorizedSession
): Promise<Set<string>> {
  const [recorded, projects] = await Promise.all([
    listRecordedSourceFolders(getDb(), organizationId, conversationId),
    listRestrictingSourceProjects(getDb(), organizationId, conversationId),
  ])
  if (recorded.length === 0 && projects.length === 0) return new Set(userIds)
  const audience = await readConversationRow(organizationId, conversationId)
  const view = await recordView(organizationId, audience.projectId, recorded)
  const restricting = stillRestricting(view.tree, recorded)
  if (restricting.length === 0 && projects.length === 0) return new Set(userIds)
  const asked = [...new Set(userIds)].slice(0, READERS_MAX_PEOPLE)
  const opening = await peopleWhoMayOpen(organizationId, asked, projects)
  if (restricting.length === 0) return opening
  const clearancesByProject = new Map<string, Map<string, FolderClearance>>()
  for (const owner of ownersOf(view, restricting)) {
    const knownHere = new Map(owner === audience.projectId ? known : [])
    if (asker) knownHere.set(asker.userId, await clearanceOf(asker, owner))
    clearancesByProject.set(owner, await clearancesOf(organizationId, owner, asked, knownHere))
  }
  return new Set(
    asked.filter(
      (person) =>
        opening.has(person) &&
        mayReadEvery(view, (owner) => clearancesByProject.get(owner)?.get(person), restricting)
    )
  )
}

export interface ListedConversationRef {
  id: string
  projectId: string | null
}

export async function lockedConversationIds(
  session: AuthorizedSession,
  conversations: readonly ListedConversationRef[]
): Promise<Set<string>> {
  const ids = conversations.map((conversation) => conversation.id)
  const [recorded, projects] = await Promise.all([
    listRecordedSourceFoldersFor(getDb(), session.organizationId, ids),
    listRestrictingSourceProjectsFor(getDb(), session.organizationId, ids),
  ])
  const locked = new Set<string>()
  if (recorded.size === 0 && projects.size === 0) return locked
  const views = new Map<string | null, RecordView>()
  const opens = new Map<string, boolean>()
  const clearances = new Map<string, FolderClearance>()
  for (const conversation of conversations) {
    const foreign = projects.get(conversation.id) ?? []
    if (foreign.length > 0 && !(await sessionMayOpenAll(session, foreign, opens))) {
      locked.add(conversation.id)
      continue
    }
    const folders = recorded.get(conversation.id)
    if (!folders) continue
    const view = await listView(session.organizationId, conversation.projectId, folders, views)
    const restricting = stillRestricting(view.tree, folders)
    for (const owner of ownersOf(view, restricting)) {
      if (!clearances.has(owner)) clearances.set(owner, await clearanceOf(session, owner))
    }
    if (!mayReadEvery(view, (owner) => clearances.get(owner), restricting)) locked.add(conversation.id)
  }
  return locked
}

async function listView(
  organizationId: string,
  projectId: string | null,
  folders: readonly string[],
  views: Map<string | null, RecordView>
): Promise<RecordView> {
  const own = views.get(projectId) ?? (await recordView(organizationId, projectId, []))
  views.set(projectId, own)
  return folders.every((folderId) => own.tree.has(folderId)) ? own : recordView(organizationId, projectId, folders)
}

export interface RestrictedUseRequest {
  organizationId: string
  conversationId: string
  userId: string
  projectId: string | null
  answerMessageId?: string | null
}

function sourceFolders(tree: FolderTree, project: ProjectRef, collections: readonly string[]): Map<string, string> {
  const access = computeFolderAccess([...tree.values()], EVERY_FOLDER, project.projectCollection)
  const found = new Map<string, string>()
  for (const collection of collections) {
    const folderId = access.sourceFolderOf(collection)
    if (folderId) found.set(collection, folderId)
  }
  return found
}

export interface RestrictedReader {
  organizationId: string
  userId: string
  session?: AuthorizedSession
}

export async function readableRestrictedCollections(
  reader: RestrictedReader,
  audience: ConversationAudienceRow,
  project: ProjectRef | null,
  candidates: readonly string[]
): Promise<string[]> {
  if (candidates.length === 0 || !project) return []
  if (audience.exists && audience.projectId !== project.projectId) return []
  const tree = await treeOf(reader.organizationId, project)
  const folders = sourceFolders(tree, project, candidates)
  const people = audiencePeople(audience, reader.userId)
  const known = reader.session
    ? new Map([[reader.userId, await clearanceOf(reader.session, project.projectId)]])
    : new Map<string, FolderClearance>()
  const clearances = await clearancesOf(reader.organizationId, project.projectId, people, known)
  const readable = new Set(foldersEveryoneMayRead(tree, [...folders.values()], audience, people, clearances))
  return candidates.filter((collection) => readable.has(folders.get(collection) ?? ''))
}

export async function sourceFoldersOf(
  organizationId: string,
  project: ProjectRef,
  collections: readonly string[]
): Promise<string[]> {
  if (collections.length === 0) return []
  return [...new Set(sourceFolders(await treeOf(organizationId, project), project, collections).values())]
}

export async function drawableRestrictedCollections(
  request: RestrictedUseRequest,
  candidates: readonly string[]
): Promise<string[]> {
  if (candidates.length === 0) return []
  const row = await readConversationRow(request.organizationId, request.conversationId)
  const project = await projectOf(request.organizationId, row, request.projectId)
  return readableRestrictedCollections(request, row, project, candidates)
}

export interface FolderAdmission {
  admitted: string[]
  refused: string[]
  recorded: string[]
}

export async function admitSourceFolders(request: RestrictedUseRequest, folderIds: readonly string[]): Promise<FolderAdmission> {
  const { organizationId, conversationId } = request
  const asked = [...new Set(folderIds)].slice(0, ADMISSION_MAX_COLLECTIONS)
  const before = await readConversationRow(organizationId, conversationId)
  const project = await projectOf(organizationId, before, request.projectId)
  const tree: FolderTree = project ? await treeOf(organizationId, project) : new Map()
  const open = asked.filter((folderId) => tree.has(folderId) && readableByEveryMember(tree, folderId))
  const restricted = asked.filter((folderId) => tree.has(folderId) && !open.includes(folderId))
  const clearances =
    restricted.length > 0 && project
      ? await clearancesOf(organizationId, project.projectId, audiencePeople(before, request.userId))
      : new Map()
  return getDb().transaction(async (tx) => {
    await lockConversationAudience(tx, organizationId, conversationId)
    const audience = await readConversationAudience(tx, organizationId, conversationId)
    const admitted = foldersEveryoneMayRead(tree, restricted, audience, audiencePeople(audience, request.userId), clearances)
    await recordSourceFolders(tx, organizationId, conversationId, admitted)
    if (request.answerMessageId) {
      await markAnswerRestrictedUse(tx, organizationId, conversationId, request.answerMessageId)
      await recordAnswerReads(tx, organizationId, conversationId, request.answerMessageId, { folders: admitted })
    }
    const recorded = await listRecordedSourceFolders(tx, organizationId, conversationId)
    const kept = new Set([...open, ...admitted])
    return {
      admitted: asked.filter((folderId) => kept.has(folderId)),
      refused: asked.filter((folderId) => !kept.has(folderId)),
      recorded: project ? stillRestricting(tree, recorded) : recorded,
    }
  })
}

export interface AdmissionResult {
  admitted: string[]
  refused: string[]
  recorded: string[]
}

export async function admitRestrictedUse(
  request: RestrictedUseRequest,
  collections: readonly string[]
): Promise<AdmissionResult> {
  const asked = [...new Set(collections)].slice(0, ADMISSION_MAX_COLLECTIONS)
  const audience = await readConversationRow(request.organizationId, request.conversationId)
  const project = await projectOf(request.organizationId, audience, request.projectId)
  const folders = project ? sourceFolders(await treeOf(request.organizationId, project), project, asked) : new Map<string, string>()
  const admission = await admitSourceFolders(request, [...new Set(folders.values())])
  const admitted = new Set(admission.admitted)
  return {
    admitted: asked.filter((collection) => admitted.has(folders.get(collection) ?? '')),
    refused: asked.filter((collection) => !admitted.has(folders.get(collection) ?? '')),
    recorded: admission.recorded,
  }
}

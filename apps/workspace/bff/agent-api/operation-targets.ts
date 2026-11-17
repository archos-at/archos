import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isFolderVisibleTo } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getAccessibleDocument } from '@/lib/documents/access'
import { documentDisplayName } from '@/lib/documents/display-name'
import { requireResourceAccess } from '@/lib/sharing/access'
import type { OperationTargetType, OperationTargetView } from '@/lib/proposals/types'
import type { AgentOperation } from './operation'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { type TargetPlace, findFolderName, findTargetPlace, findProjectName } from './operation-targets-repository'

export type TargetType = OperationTargetType

export interface OperationTarget {
  type: TargetType
  id: string
}

export interface TargetInput {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
}

const PATH_SEGMENT_TARGETS: Readonly<Record<string, TargetType>> = {
  projects: 'project',
  documents: 'document',
  folders: 'folder',
  conversations: 'conversation',
  models: 'bim_model',
  'upload-batches': 'upload_batch',
  proposals: 'proposal',
  'inbound-mails': 'inbound_mail',
  'mail-threads': 'mail_thread',
}

export const KEY_TARGETS: Readonly<Record<string, TargetType>> = {
  projectId: 'project',
  projectIds: 'project',
  documentId: 'document',
  documentIds: 'document',
  folderId: 'folder',
  folderIds: 'folder',
  conversationId: 'conversation',
  modelId: 'bim_model',
  baseModelId: 'bim_model',
  mailId: 'inbound_mail',
  mailIds: 'inbound_mail',
  mailThreadId: 'mail_thread',
  revisionOf: 'document',
}

const TYPED_TARGETS: Readonly<Record<string, TargetType>> = {
  project: 'project',
  document: 'document',
  folder: 'folder',
  conversation: 'conversation',
}

const MAX_DEPTH = 4
export const MAX_TARGETS = 50

export class TooManyTargetsError extends Error {
  constructor() {
    super(`The call names more than ${MAX_TARGETS} projects, documents, folders or conversations`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const idsOf = (value: unknown): string[] =>
  typeof value === 'string' && value.trim()
    ? [value.trim()]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
      : []

function pathTargets(op: Pick<AgentOperation, 'path'>, params: Record<string, unknown> | undefined): OperationTarget[] {
  const segments = op.path.split('/')
  const found: OperationTarget[] = []
  segments.forEach((segment, index) => {
    const name = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment)?.[1]
    if (!name) return
    const value = params?.[name]
    if (typeof value !== 'string' || !value) return
    if (name === 'resourceId' || name === 'entityId') return // read with its type below
    const type = PATH_SEGMENT_TARGETS[segments[index - 1] ?? '']
    if (type) found.push({ type, id: value })
  })
  const typed = typeof params?.resourceType === 'string' ? TYPED_TARGETS[params.resourceType] : undefined
  if (typed && typeof params?.resourceId === 'string') found.push({ type: typed, id: params.resourceId })
  return found
}

function valueTargets(value: unknown, depth: number, into: OperationTarget[]): void {
  if (depth > MAX_DEPTH) return
  if (Array.isArray(value)) {
    for (const item of value) valueTargets(item, depth + 1, into)
    return
  }
  if (!isRecord(value)) return
  for (const [key, inner] of Object.entries(value)) {
    const type = KEY_TARGETS[key]
    if (type) for (const id of idsOf(inner)) into.push({ type, id })
    else valueTargets(inner, depth + 1, into)
  }
  for (const [typeKey, idKey] of [
    ['resourceType', 'resourceId'],
    ['entityType', 'entityId'],
  ] as const) {
    const typed = typeof value[typeKey] === 'string' ? TYPED_TARGETS[value[typeKey] as string] : undefined
    if (typed) for (const id of idsOf(value[idKey])) into.push({ type: typed, id })
  }
}

export function targetsOf(op: Pick<AgentOperation, 'path'>, input: TargetInput): OperationTarget[] {
  const found = pathTargets(op, input.params)
  valueTargets(input.query, 0, found)
  valueTargets(input.body, 0, found)
  const seen = new Set<string>()
  const unique = found.filter((target) => {
    const key = `${target.type}:${target.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length > MAX_TARGETS) throw new TooManyTargetsError()
  return unique
}

const TYPE_ID_PAIRS = [
  ['resourceType', 'resourceId'],
  ['entityType', 'entityId'],
] as const

function namesUntyped(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false
  if (Array.isArray(value)) return value.some((item) => namesUntyped(item, depth + 1))
  if (!isRecord(value)) return false
  const here = TYPE_ID_PAIRS.some(
    ([typeKey, idKey]) =>
      typeof value[typeKey] === 'string' && !TYPED_TARGETS[value[typeKey] as string] && idsOf(value[idKey]).length > 0,
  )
  return here || Object.values(value).some((inner) => namesUntyped(inner, depth + 1))
}

export function namesUntypedResource(input: TargetInput): boolean {
  return namesUntyped(input.params, 0) || namesUntyped(input.query, 0) || namesUntyped(input.body, 0)
}

export async function placesOf(
  organizationId: string,
  userId: string,
  targets: readonly OperationTarget[],
): Promise<(TargetPlace | null)[]> {
  return Promise.all(targets.map((target) => findTargetPlace(organizationId, userId, target)))
}

export async function requireTargetsReadable(
  session: AuthorizedSession,
  targets: readonly OperationTarget[],
): Promise<void> {
  for (const target of targets) {
    const place = await findTargetPlace(session.organizationId, session.userId, target)
    if (!place) throw new NotFoundError(`The ${label(target.type)} ${target.id} was not found`)
    if (target.type === 'document') {
      await getAccessibleDocument(session, target.id, 'read')
      continue
    }
    if (target.type === 'conversation') {
      await requireResourceAccess(session, 'conversation', target.id, 'viewer')
      continue
    }
    if (place.projectId) await requireProjectAccess(session, place.projectId, 'project:view')
    if (target.type === 'folder' && place.projectId && !(await isFolderVisibleTo(session, place.projectId, target.id))) {
      throw new NotFoundError(`The folder ${target.id} was not found`)
    }
    if (target.type === 'proposal' && place.conversationId) {
      await requireResourceAccess(session, 'conversation', place.conversationId, 'viewer')
    }
  }
}


async function readableName(session: AuthorizedSession, target: OperationTarget): Promise<string | null> {
  try {
    if (target.type === 'project') {
      await requireProjectAccess(session, target.id, 'project:view')
      return await findProjectName(session.organizationId, target.id)
    }
    if (target.type === 'document') return documentDisplayName(await getAccessibleDocument(session, target.id, 'read'))
    if (target.type === 'folder') return await readableFolderName(session, target.id)
    if (target.type === 'conversation') {
      await requireResourceAccess(session, 'conversation', target.id, 'viewer')
      return (await findConversationInOrg(target.id, session.organizationId))?.title?.trim() || null
    }
    return null
  } catch {
    return null
  }
}

async function readableFolderName(session: AuthorizedSession, folderId: string): Promise<string | null> {
  const folder = await findFolderName(session.organizationId, folderId)
  if (!folder) return null
  if (folder.projectId) {
    await requireProjectAccess(session, folder.projectId, 'project:view')
    if (!(await isFolderVisibleTo(session, folder.projectId, folderId))) return null
  }
  return folder.name
}

const PERSON_KEYS: ReadonlySet<string> = new Set(['userId', 'userIds', 'memberId', 'assigneeId'])

function personIds(value: unknown, depth: number, into: Set<string>): void {
  if (depth > MAX_DEPTH) return
  if (Array.isArray(value)) {
    for (const item of value) personIds(item, depth + 1, into)
    return
  }
  if (!isRecord(value)) return
  for (const [key, inner] of Object.entries(value)) {
    if (PERSON_KEYS.has(key)) for (const id of idsOf(inner)) into.add(id)
    else personIds(inner, depth + 1, into)
  }
}

export type PersonNames = ReadonlyMap<string, { name: string }>

export async function describeTargets(
  session: AuthorizedSession,
  op: Pick<AgentOperation, 'path'>,
  input: TargetInput,
  people?: PersonNames,
): Promise<OperationTargetView[]> {
  let targets: OperationTarget[]
  try {
    targets = targetsOf(op, input)
  } catch {
    return []
  }
  const named = await Promise.all(targets.map(async (target) => ({ ...target, name: await readableName(session, target) })))
  if (!people) return named
  const ids = new Set<string>()
  for (const part of [input.params, input.query, input.body]) personIds(part, 0, ids)
  const persons = [...ids]
    .slice(0, MAX_TARGETS)
    .map((id): OperationTargetView => ({ type: 'member', id, name: people.get(id)?.name ?? null }))
  return [...named, ...persons]
}

function label(type: TargetType): string {
  return type.replace('_', ' ')
}

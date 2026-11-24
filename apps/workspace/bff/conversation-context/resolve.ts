import 'server-only'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import type { DbExecutor } from '@/lib/db/executor'
import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { conversationRecord, sourceFoldersOf } from '@/lib/conversations/restricted-use'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { featureEntitlement } from '@/lib/turns/feature-entitlement'
import { audienceOf, readConversationRow } from './audience'
import {
  isConfined,
  mayPersonalMemory,
  mayPersonalShelf,
  otherProjectsOf,
  workspaceReadOf,
  type ContextKind,
  type ContextRecorded,
  type ConversationContext,
} from './types'

export interface ContextRequest {
  conversationId?: string
  projectId?: string
  kind: ContextKind
}

export interface AudienceRead {
  tx?: DbExecutor
  row: ConversationAudienceRow
}

export interface ContextOptions {
  audience?: AudienceRead
  withoutShelves?: boolean
}

const NO_ROW: ConversationAudienceRow = {
  exists: false,
  projectId: null,
  createdBy: null,
  visibility: 'private',
  grantees: [],
  version: null,
}

const NOTHING_RECORDED: ContextRecorded = { folders: [], projects: [], personalShelf: false }

function isAuthorized(session: UserSession | null): session is AuthorizedSession {
  return Boolean(session?.organizationId && session.userId)
}

async function rowOf(
  session: UserSession | null,
  conversationId: string | null,
  options: ContextOptions,
): Promise<ConversationAudienceRow> {
  if (options.audience) return options.audience.row
  if (!conversationId || !isAuthorized(session)) return NO_ROW
  return readConversationRow(session.organizationId, conversationId)
}

function drawsOnRestricted(kind: ContextKind, conversationId: string | null): boolean {
  return conversationId !== null && kind === 'chat'
}

export interface ConversationScope {
  kind: ContextKind
  conversationId: string | null
  audience: ConversationContext['audience']
  projectId: string | null
  projectCollectionName: string | null
  shelves: ConversationContext['may']['shelves']
  restrictedCollections: string[]
  verifiedConversationId: string | null
  projectReadOnly: boolean
}

export async function resolveConversationScope(
  session: UserSession | null,
  request: ContextRequest,
  options: ContextOptions = {},
): Promise<ConversationScope> {
  const { kind } = request
  const conversationId = kind === 'external' ? null : (request.conversationId ?? null)
  const row = await rowOf(session, conversationId, options)
  const userId = session?.userId ?? ''
  const audience = isAuthorized(session) ? audienceOf(row, userId) : { row, solo: false, version: row.version }
  const scope = await buildCollectionScopeFromRequest(session, {
    projectId: request.projectId,
    conversationId: conversationId ?? undefined,
    interactiveChat: !options.withoutShelves && drawsOnRestricted(kind, conversationId),
    audience: row,
  })
  const restrictedCollections = kind === 'headless' || options.withoutShelves ? [] : scope.restrictedCollections
  const shelves = options.withoutShelves
    ? []
    : kind === 'headless'
      ? scope.scopedCollections.filter((entry) => entry.shelf === 'project' && !scope.restrictedCollections.includes(entry.collection))
      : scope.scopedCollections
  return {
    kind,
    conversationId,
    audience,
    projectId: scope.projectId ?? null,
    projectCollectionName: scope.projectCollectionName ?? null,
    shelves,
    restrictedCollections,
    verifiedConversationId: scope.verifiedConversationId ?? null,
    projectReadOnly: scope.projectReadOnly ?? false,
  }
}

export async function resolveConversationContext(
  session: UserSession | null,
  request: ContextRequest,
  options: ContextOptions = {},
): Promise<ConversationContext> {
  const { kind, conversationId, audience, projectId, projectCollectionName, shelves, restrictedCollections } =
    await resolveConversationScope(session, request, options)
  const organizationId = session?.organizationId ?? undefined
  const [record, entitlement, readableFolderIds] = await Promise.all([
    conversationId && audience.row.exists && organizationId
      ? conversationRecord(organizationId, conversationId, projectId)
      : Promise.resolve(null),
    featureEntitlement(organizationId, projectId),
    projectId && organizationId && projectCollectionName
      ? sourceFoldersOf(organizationId, { projectId, projectCollection: projectCollectionName }, restrictedCollections)
      : Promise.resolve([]),
  ])
  const recorded: ContextRecorded = record
    ? { folders: record.folders, projects: record.otherProjects, personalShelf: record.personalShelf }
    : NOTHING_RECORDED
  const confined = isConfined({ restrictedCollections }, recorded)
  const personalMemory = isAuthorized(session) && mayPersonalMemory(kind, conversationId, audience.solo)
  const personalShelf = !options.withoutShelves && !audience.row.subject && mayPersonalShelf(kind, personalMemory, projectId ?? audience.row.projectId)
  const personal = personalShelf && isAuthorized(session) ? personalShelfCollectionName(session.organizationId, session.userId) : null
  return {
    kind,
    conversationId,
    audience,
    projectId,
    may: {
      shelves: personal ? [...shelves, { collection: personal, shelf: 'personal' }] : shelves,
      restrictedCollections: personal ? [...restrictedCollections, personal] : restrictedCollections,
      otherProjects: otherProjectsOf(kind, conversationId, audience.solo),
      personalMemory,
      personalShelf,
      projectMemory: { readableFolderIds },
      workspaceRead: workspaceReadOf(kind, conversationId, audience.solo),
      features: {
        deepResearch: entitlement.deepResearch && !confined,
        tasks: entitlement.tasks && !confined,
      },
    },
    recorded,
  }
}

export async function resolveRunConversationContext(
  session: AuthorizedSession,
  request: { projectId: string; conversationId?: string | null; kind: Extract<ContextKind, 'run' | 'headless'> },
): Promise<ConversationContext> {
  const row = await rowOf(session, request.conversationId ?? null, {})
  const inProject = row.exists && row.projectId === request.projectId
  return resolveConversationContext(
    session,
    { projectId: request.projectId, conversationId: inProject ? (request.conversationId ?? undefined) : undefined, kind: request.kind },
    inProject ? { audience: { row } } : {},
  )
}

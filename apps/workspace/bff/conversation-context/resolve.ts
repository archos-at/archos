import 'server-only'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import type { DbExecutor } from '@/lib/db/executor'
import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { conversationRecord, sourceFoldersOf } from '@/lib/conversations/restricted-use'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
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
  tx: DbExecutor
  row: ConversationAudienceRow
}

export interface ContextOptions {
  audience?: AudienceRead
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

export async function resolveConversationContext(
  session: UserSession | null,
  request: ContextRequest,
  options: ContextOptions = {},
): Promise<ConversationContext> {
  const { kind } = request
  const conversationId = kind === 'external' ? null : (request.conversationId ?? null)
  const row = await rowOf(session, conversationId, options)
  const userId = session?.userId ?? ''
  const audience = isAuthorized(session) ? audienceOf(row, userId) : { row, solo: false, version: row.version }
  const scope = await buildCollectionScopeFromRequest(session, {
    projectId: request.projectId,
    conversationId: conversationId ?? undefined,
    interactiveChat: drawsOnRestricted(kind, conversationId),
    audience: row,
  })
  const projectId = scope.projectId ?? null
  const shelves =
    kind === 'headless'
      ? scope.scopedCollections.filter((entry) => entry.shelf === 'project' && !scope.restrictedCollections.includes(entry.collection))
      : scope.scopedCollections
  const restrictedCollections = kind === 'headless' ? [] : scope.restrictedCollections
  const organizationId = session?.organizationId ?? undefined
  const [record, entitlement, readableFolderIds] = await Promise.all([
    conversationId && row.exists && organizationId
      ? conversationRecord(organizationId, conversationId, projectId)
      : Promise.resolve(null),
    featureEntitlement(organizationId, projectId),
    projectId && organizationId && scope.projectCollectionName
      ? sourceFoldersOf(organizationId, { projectId, projectCollection: scope.projectCollectionName }, restrictedCollections)
      : Promise.resolve([]),
  ])
  const recorded: ContextRecorded = record
    ? { folders: record.folders, projects: record.otherProjects, personalShelf: false }
    : NOTHING_RECORDED
  const confined = isConfined({ restrictedCollections }, recorded)
  const personalMemory = isAuthorized(session) && mayPersonalMemory(kind, conversationId, audience.solo)
  return {
    kind,
    conversationId,
    audience,
    projectId,
    may: {
      shelves,
      restrictedCollections,
      otherProjects: otherProjectsOf(kind, conversationId, audience.solo),
      personalMemory,
      personalShelf: mayPersonalShelf(personalMemory, projectId),
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

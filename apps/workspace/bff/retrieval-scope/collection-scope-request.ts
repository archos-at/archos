import { findProjectCollectionName } from '@/lib/projects/repository'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { personalConversationHidden } from '@/lib/conversations/hidden'
import { requireResourceAccess } from '@/lib/sharing/access'
import { readableRestrictedCollections } from '@/lib/conversations/restricted-use'
import { readConversationRow } from '@/lib/conversation-context/audience'
import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { getProjectFolderAccess } from '@/lib/authz/folder-access'
import { ForbiddenError, isAuthzRefusal, NotFoundError } from '@/lib/api/errors'
import {
  computeCollectionScope,
  encodeCollectionScopeHeader,
  sessionCollectionName,
  type CollectionShelf,
  resolveBaseCollectionName,
  type ScopeContext,
  type ScopedCollection,
} from '@/lib/retrieval-scope/collection-scope'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { baseCorpusCountries, projectCorpusCountries } from './base-entry'

export interface RequestContext {
  projectId?: string
  includeProject?: boolean
  conversationId?: string
  interactiveChat?: boolean
  audience?: ConversationAudienceRow
}

export type { CollectionShelf, ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

export { encodeCollectionScopeHeader } from '@/lib/retrieval-scope/collection-scope'

function isAuthRequired(): boolean {
  return process.env.REQUIRE_AUTH?.toLowerCase() === 'true'
}

export async function authorizeConversationScope(
  session: AuthorizedSession,
  conversationId: string
): Promise<boolean> {
  return (await readConversationProject(session, conversationId)) !== NO_ROW
}

const NO_ROW = Symbol('no conversation row')

async function readConversationProject(
  session: AuthorizedSession,
  conversationId: string
): Promise<string | null | typeof NO_ROW> {
  const tenancy = await findConversationTenancy(conversationId)
  if (!tenancy && (await personalConversationHidden(conversationId))) throw new NotFoundError()
  if (!tenancy) return NO_ROW
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  return tenancy.projectId
}

export class ConversationProjectMismatchError extends ForbiddenError {
  constructor() {
    super('This chat belongs to another project than the request names.')
    this.name = 'ConversationProjectMismatchError'
  }
}

async function resolveRestrictedCollections(
  session: AuthorizedSession,
  projectId: string,
  projectCollection: string,
  conversationId: string | undefined,
  known: ConversationAudienceRow | undefined
): Promise<string[]> {
  if (!conversationId) return []
  const access = await getProjectFolderAccess(session, projectId, projectCollection)
  if (access.clearedRestrictedCollections.length === 0) return []
  const audience = known ?? (await readConversationRow(session.organizationId, conversationId))
  return readableRestrictedCollections(
    { organizationId: session.organizationId, userId: session.userId, session },
    audience,
    { projectId, projectCollection },
    access.clearedRestrictedCollections
  )
}

async function resolveProjectCollectionName(
  projectId: string | undefined,
  organizationId: string | undefined
): Promise<string | undefined> {
  if (!projectId || !organizationId) {
    return undefined
  }

  return (await findProjectCollectionName(projectId, organizationId)) ?? undefined
}

export async function buildCollectionScopeFromRequest(
  session: UserSession | null,
  context: RequestContext
): Promise<{
  scope: string[]
  scopedCollections: ScopedCollection[]
  headerValue: string
  projectId: string | undefined
  projectCollectionName: string | undefined
  conversationId: string | undefined
  verifiedConversationId: string | undefined
  restrictedCollections: string[]
  projectReadOnly?: boolean
}> {
  const anonymous = !isAuthRequired()

  const includeProject = context.includeProject !== false

  const conversationId = context.conversationId
  const rowProject =
    conversationId && session && !anonymous
      ? await readConversationProject(session as AuthorizedSession, conversationId)
      : NO_ROW
  const conversationVerified = rowProject !== NO_ROW

  if (conversationVerified && context.projectId && context.projectId !== rowProject) {
    throw new ConversationProjectMismatchError()
  }
  const namedProject = conversationVerified ? (rowProject ?? undefined) : context.projectId
  let projectId = includeProject ? namedProject : undefined

  let projectReadOnly = false
  if (projectId && session && !anonymous) {
    try {
      const access = await requireProjectAccess(session as AuthorizedSession, projectId, CHAT_PERMISSIONS)
      projectReadOnly = access.readsBecauseClosed
    } catch (error) {
      if (context.projectId || !isAuthzRefusal(error)) throw error
      projectId = undefined
    }
  }

  const projectCollectionName = includeProject
    ? await resolveProjectCollectionName(projectId, session?.organizationId ?? undefined)
    : undefined

  const officeShelfCollection =
    session?.organizationId && !anonymous ? officeShelfCollectionName(session.organizationId) : undefined

  const baseCollection = resolveBaseCollectionName()
  const projectCollection = includeProject
    ? (projectCollectionName ?? (projectId ? `proj_${projectId}` : undefined))
    : undefined
  const sessionCollection = conversationId ? sessionCollectionName(conversationId) : undefined

  const restrictedCollections =
    context.interactiveChat && session && !anonymous && projectId && projectCollectionName
      ? await resolveRestrictedCollections(
          session as AuthorizedSession,
          projectId,
          projectCollectionName,
          conversationId,
          context.audience
        )
      : []

  const shelfByCollection = new Map<string, CollectionShelf>()
  shelfByCollection.set(baseCollection, 'base')
  if (officeShelfCollection) shelfByCollection.set(officeShelfCollection, 'office_shelf')
  if (projectCollection) shelfByCollection.set(projectCollection, 'project')
  for (const restricted of restrictedCollections) shelfByCollection.set(restricted, 'project')
  if (sessionCollection) shelfByCollection.set(sessionCollection, 'session')

  const scope = computeCollectionScope(session, {
    projectId,
    projectCollectionName: projectCollection,
    includeProject,
    conversationId: sessionCollection,
    officeShelfCollectionName: officeShelfCollection,
    baseCollection,
    restrictedCollections,
  } satisfies ScopeContext)

  const signsBase = scope.includes(baseCollection) && !anonymous
  const corpusCountries = !signsBase
    ? []
    : projectId
      ? await projectCorpusCountries(session?.organizationId, projectId)
      : await baseCorpusCountries(session?.organizationId)
  const scopedCollections: ScopedCollection[] = scope.map((collection) => {
    const shelf = shelfByCollection.get(collection)
    const entry: ScopedCollection = shelf ? { collection, shelf } : { collection }
    if (collection === baseCollection) entry.countries = corpusCountries
    return entry
  })

  return {
    scope,
    scopedCollections,
    headerValue: encodeCollectionScopeHeader(scopedCollections),
    projectId,
    projectCollectionName,
    conversationId,
    verifiedConversationId: conversationVerified ? conversationId : undefined,
    restrictedCollections,
    projectReadOnly: Boolean(projectId) && projectReadOnly,
  }
}

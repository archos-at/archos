import { findProjectCollectionName } from '@/lib/projects/repository'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { requireResourceAccess } from '@/lib/sharing/access'
import { restrictedCollectionsForChatScope } from '@/lib/conversations/restricted-use'
import { getProjectFolderAccess } from '@/lib/authz/folder-access'
import { ForbiddenError } from '@/lib/api/errors'
import {
  computeCollectionScope,
  sessionCollectionName,
  type CollectionShelf,
  resolveBaseCollectionName,
  type ScopeContext,
  type ScopedCollection,
} from '@/lib/retrieval-scope/collection-scope'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { hasPersonalShelfDocuments } from '@/lib/personal-shelf/repository'
import { conversationMayDrawOnPersonal, recordPersonalSources } from '@/lib/conversations/personal-use'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { baseCorpusCountries, projectCorpusCountries } from './base-entry'

export interface RequestContext {
  projectId?: string
  includeProject?: boolean
  conversationId?: string
  interactiveChat?: boolean
}

export type { CollectionShelf, ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

export function encodeCollectionScopeHeader(collections: ScopedCollection[]): string {
  return Buffer.from(JSON.stringify(collections)).toString('base64url')
}

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
  conversationId: string | undefined
): Promise<string[]> {
  if (!conversationId) return []
  const access = await getProjectFolderAccess(session, projectId, projectCollection)
  if (access.clearedRestrictedCollections.length === 0) return []
  return restrictedCollectionsForChatScope(
    session,
    conversationId,
    { projectId, projectCollection },
    access.clearedRestrictedCollections
  )
}

async function personalCollectionForTurn(session: AuthorizedSession, conversationId: string): Promise<string | undefined> {
  const { organizationId, userId } = session
  if (!(await conversationMayDrawOnPersonal(organizationId, userId, conversationId, null))) return undefined
  try {
    if (await hasPersonalShelfDocuments(organizationId, userId)) {
      await recordPersonalSources(organizationId, conversationId, ['personal_shelf'])
    }
  } catch (error) {
    console.warn('[collection-scope] the use of the personal shelf could not be recorded; the turn reads without it:', error)
    return undefined
  }
  return personalShelfCollectionName(organizationId, userId)
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
  const projectId = includeProject ? namedProject : undefined

  let projectReadOnly = false
  if (projectId && session && !anonymous) {
    const access = await requireProjectAccess(session as AuthorizedSession, projectId, CHAT_PERMISSIONS)
    projectReadOnly = access.readsBecauseClosed
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
          conversationId
        )
      : []

  const personalCollection =
    context.interactiveChat && session && !anonymous && !projectId && conversationId
      ? await personalCollectionForTurn(session as AuthorizedSession, conversationId)
      : undefined

  const shelfByCollection = new Map<string, CollectionShelf>()
  shelfByCollection.set(baseCollection, 'base')
  if (officeShelfCollection) shelfByCollection.set(officeShelfCollection, 'office_shelf')
  if (projectCollection) shelfByCollection.set(projectCollection, 'project')
  for (const restricted of restrictedCollections) shelfByCollection.set(restricted, 'project')
  if (personalCollection) shelfByCollection.set(personalCollection, 'personal')
  if (sessionCollection) shelfByCollection.set(sessionCollection, 'session')

  const scope = computeCollectionScope(session, {
    projectId,
    projectCollectionName: projectCollection,
    includeProject,
    conversationId: sessionCollection,
    officeShelfCollectionName: officeShelfCollection,
    personalCollectionName: personalCollection,
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
    projectReadOnly: Boolean(projectId) && projectReadOnly,
  }
}

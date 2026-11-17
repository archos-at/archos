import { findProjectCollectionName } from '@/lib/projects/repository'
import { findUserPreferencesForSession } from '@/lib/user-preferences/repository'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { requireResourceAccess } from '@/lib/sharing/access'
import { restrictedCollectionsForChatScope } from '@/lib/conversations/restricted-use'
import { getProjectFolderAccess } from '@/lib/authz/folder-access'
import {
  computeCollectionScope,
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
}

export type { CollectionShelf, ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

export function encodeCollectionScopeHeader(collections: ScopedCollection[]): string {
  return Buffer.from(JSON.stringify(collections)).toString('base64url')
}

function isAuthRequired(): boolean {
  return process.env.REQUIRE_AUTH?.toLowerCase() === 'true'
}

export async function resolveActiveProjectId(
  session: UserSession | null,
  explicitProjectId?: string
): Promise<string | undefined> {
  if (explicitProjectId) {
    return explicitProjectId
  }

  if (!session) {
    return undefined
  }

  const prefs = await findUserPreferencesForSession(session.userId, session.organizationId)

  if (prefs && typeof prefs === 'object') {
    const activeId = prefs.active_project_id
    if (typeof activeId === 'string' && activeId) {
      return activeId
    }
  }

  return undefined
}

export async function authorizeConversationScope(
  session: AuthorizedSession,
  conversationId: string
): Promise<boolean> {
  const tenancy = await findConversationTenancy(conversationId)
  if (!tenancy) return false
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  return true
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

  let projectId = includeProject ? context.projectId : undefined
  const explicitProject = Boolean(projectId)
  if (includeProject && !projectId && session && !anonymous) {
    projectId = await resolveActiveProjectId(session, undefined)
  }

  const conversationId = context.conversationId

  const conversationVerified =
    conversationId && session && !anonymous
      ? await authorizeConversationScope(session as AuthorizedSession, conversationId)
      : false

  let projectReadOnly = false
  if (projectId && session && !anonymous) {
    if (explicitProject) {
      const access = await requireProjectAccess(
        session as AuthorizedSession,
        projectId,
        CHAT_PERMISSIONS
      )
      projectReadOnly = access.readsBecauseClosed
    } else {
      try {
        const access = await requireProjectAccess(
          session as AuthorizedSession,
          projectId,
          CHAT_PERMISSIONS
        )
        projectReadOnly = access.readsBecauseClosed
      } catch {
        projectId = undefined
      }
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
          conversationId
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
    projectReadOnly: Boolean(projectId) && projectReadOnly,
  }
}

import { findProjectIdByCollectionName } from '@/lib/projects/repository'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'

const PROJECT_UPLOAD: readonly ProjectPermission[] = ['project:documents:write', 'project:edit']
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { officeShelfCollectionNames } from '@/lib/office-shelf/collection'
import { isOfficeShelfCollectionName } from '@/lib/office-shelf/collection-prefix'
import { sessionCollectionName } from '@/lib/retrieval-scope/collection-scope'
import { getProjectFolderAccess, restrictedCollectionBase } from '@/lib/authz/folder-access'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { errorEnvelope, handleAuthzError } from '@/lib/backend-proxy'

export interface ProxyRequestContext {
  projectId?: string
  conversationId?: string
  collectionName?: string
}

export function parseQueryContext(searchParams: URLSearchParams): ProxyRequestContext {
  return {
    projectId: searchParams.get('projectId') || undefined,
    conversationId: searchParams.get('conversationId') || undefined,
  }
}

export function parseBodyContext(
  parsedBody: Record<string, unknown> | undefined
): ProxyRequestContext {
  return {
    projectId: typeof parsedBody?.projectId === 'string' ? parsedBody.projectId : undefined,
    conversationId:
      typeof parsedBody?.conversationId === 'string'
        ? parsedBody.conversationId
        : typeof parsedBody?.session_id === 'string'
          ? parsedBody.session_id
          : undefined,
    collectionName: typeof parsedBody?.name === 'string' ? parsedBody.name : undefined,
  }
}

export function resolveRequestContext(
  searchParams: URLSearchParams,
  parsedBody?: Record<string, unknown>
): ProxyRequestContext {
  const queryContext = parseQueryContext(searchParams)

  if (!parsedBody) {
    return queryContext
  }

  const bodyContext = parseBodyContext(parsedBody)
  return {
    projectId: bodyContext.projectId ?? queryContext.projectId,
    conversationId: bodyContext.conversationId ?? queryContext.conversationId,
    ...(bodyContext.collectionName ? { collectionName: bodyContext.collectionName } : {}),
  }
}

export { sessionCollectionName as normalizeSessionCollectionName }

export interface CollectionAuthzDeps {
  findProjectIdByCollection(collectionName: string, organizationId: string): Promise<string | null>
  requireProjectAccess(
    session: AuthorizedSession,
    projectId: string,
    permission: readonly ProjectPermission[]
  ): Promise<unknown>
  clearedRestrictedCollections(
    session: AuthorizedSession,
    projectId: string,
    projectCollection: string
  ): Promise<readonly string[]>
}

const defaultDeps: CollectionAuthzDeps = {
  async findProjectIdByCollection(collectionName, organizationId) {
    return findProjectIdByCollectionName(collectionName, organizationId)
  },
  requireProjectAccess: (session, projectId, permission) =>
    requireProjectAccess(session, projectId, permission),
  async clearedRestrictedCollections(session, projectId, projectCollection) {
    return (await getProjectFolderAccess(session, projectId, projectCollection)).clearedRestrictedCollections
  },
}

export interface ValidateCollectionOptions {
  method?: string
  deps?: CollectionAuthzDeps
}

const FIRST_PARTY_UPLOAD: Record<'proj_' | 'office_shelf' | 's_', string> = {
  proj_: '/api/documents/upload',
  office_shelf: '/api/documents/upload (scope=office_shelf)',
  s_: '/api/session/documents/upload',
}

function refuseWholeCollectionDelete(): Response {
  return errorEnvelope(403, 'FORBIDDEN', 'Deleting a whole collection is not allowed')
}

function refuseChunkOnlyDelete(route: string): Response {
  return errorEnvelope(403, 'FORBIDDEN', `Delete through ${route}`)
}

function refuseRawUpload(prefix: 'proj_' | 'office_shelf' | 's_'): Response {
  return errorEnvelope(403, 'FORBIDDEN', `Upload through ${FIRST_PARTY_UPLOAD[prefix]}`)
}

export async function validateCollectionName(
  path: string[],
  session: UserSession | null,
  context: ProxyRequestContext,
  options: ValidateCollectionOptions = {}
): Promise<Response | null> {
  if (path.length < 1 || path[0] !== 'collections') {
    return null
  }
  const method = (options.method ?? 'GET').toUpperCase()
  const deps = options.deps ?? defaultDeps

  if (path.length === 1) {
    if (method !== 'POST') return errorEnvelope(404, 'NOT_FOUND', 'Not found')
    const created = context.collectionName
    if (!created) return errorEnvelope(400, 'INVALID_COLLECTION', 'Collection name is required')
    return authorizeCollection(created, [], method, session, context, deps)
  }

  return authorizeCollection(path[1], path.slice(2), method, session, context, deps)
}

async function authorizeCollection(
  collectionName: string,
  subPath: string[],
  method: string,
  session: UserSession | null,
  context: ProxyRequestContext,
  deps: CollectionAuthzDeps
): Promise<Response | null> {
  const wholeCollectionDelete = method === 'DELETE' && subPath.length === 0
  const upload = method === 'POST' && subPath[0] === 'documents'
  const fileDelete = method === 'DELETE' && subPath[0] === 'documents'
  const baseName = process.env.BASE_COLLECTION_NAME || 'oib_knowledge'

  if (collectionName === baseName) {
    return errorEnvelope(400, 'INVALID_COLLECTION', 'Uploads to the base corpus are not allowed')
  }

  if (collectionName.startsWith('proj_')) {
    if (wholeCollectionDelete) return refuseWholeCollectionDelete()
    if (upload) return refuseRawUpload('proj_')
    if (fileDelete) return refuseChunkOnlyDelete('/api/documents/[id]')
    if (!session?.organizationId) {
      return handleAuthzError(new ForbiddenError())
    }
    const restrictedBase = restrictedCollectionBase(collectionName)
    const projectCollection = restrictedBase ?? collectionName
    try {
      const projectId = await deps.findProjectIdByCollection(projectCollection, session.organizationId)

      if (!projectId) {
        return handleAuthzError(new NotFoundError())
      }

      await deps.requireProjectAccess(session as AuthorizedSession, projectId, PROJECT_UPLOAD)

      if (restrictedBase) {
        const cleared = await deps.clearedRestrictedCollections(
          session as AuthorizedSession,
          projectId,
          projectCollection
        )
        if (!cleared.includes(collectionName)) return handleAuthzError(new NotFoundError())
      }
    } catch (error) {
      return handleAuthzError(error)
    }
    return null
  }

  if (isOfficeShelfCollectionName(collectionName)) {
    if (wholeCollectionDelete) return refuseWholeCollectionDelete()
    if (upload) return refuseRawUpload('office_shelf')
    if (fileDelete) return refuseChunkOnlyDelete('/api/documents/[id]')
    if (!session?.organizationId) {
      return handleAuthzError(new ForbiddenError())
    }
    if (
      !officeShelfCollectionNames(session.organizationId).includes(collectionName) ||
      !canManageOfficeShelf(session)
    ) {
      return handleAuthzError(new ForbiddenError())
    }
    return null
  }

  if (collectionName.startsWith('s_')) {
    if (method !== 'GET') {
      if (upload) return refuseRawUpload('s_')
      if (wholeCollectionDelete) return refuseWholeCollectionDelete()
      return errorEnvelope(403, 'FORBIDDEN', 'Change chat attachments through /api/session/documents')
    }
    if (
      !context.conversationId ||
      sessionCollectionName(context.conversationId) !== collectionName
    ) {
      return errorEnvelope(
        400,
        'INVALID_COLLECTION',
        'Collection does not match active conversation'
      )
    }
    return null
  }

  return errorEnvelope(400, 'INVALID_COLLECTION', 'Invalid collection name')
}

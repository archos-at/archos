import 'server-only'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DbExecutor } from '@/lib/db/executor'
import { RESOURCE_ROLES, SHAREABLE_RESOURCE_TYPES, type ResourceRole, type ResourceVisibility, type ShareableResourceType } from '@/lib/db/schema/resource-shares'
import {
  conversationIdsExisting,
  findConversationInOrg,
  findConversationTenancy,
  listConversationIdsForProject,
  updateConversationVisibilityInOrg,
} from '@/lib/conversations/repository'
import {
  assertMayWidenConversation,
  peopleWhoMayRead,
  widenConversationAudience,
  type AudienceWidening,
} from '@/lib/conversations/restricted-use'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import {
  documentIdsExisting,
  findDocumentTenancy,
  listDocumentIdsForProject,
  updateDocumentVisibilityInOrg,
} from '@/lib/documents/repository'
import { documentDisplayName } from '@/lib/documents/display-name'

export interface ResourceContainer {
  kind: 'project' | 'organization'
  id: string | null
}

export interface ResourceRef {
  title: string | null
}

export interface ResourceProbe {
  organizationId: string
  projectId: string | null
  container: ResourceContainer
  visibility: ResourceVisibility
  createdBy: string | null
  deletedAt: Date | null
  folderId?: string | null
}

export interface DeepLinkOptions {
  anchorId?: string
  markId?: string
  projectId?: string | null
}

export interface ShareableDescriptor {
  readonly type: ShareableResourceType
  readonly probe: (resourceId: string) => Promise<ResourceProbe | null>
  readonly allowedVisibilities: readonly ResourceVisibility[]
  readonly defaultVisibility: ResourceVisibility
  readonly roles: readonly ResourceRole[]
  readonly supportsMentions: boolean
  readonly deepLink: (resourceId: string, options?: DeepLinkOptions) => string
  readonly labelKey: string
  readonly setVisibility: (
    resourceId: string,
    organizationId: string,
    visibility: ResourceVisibility,
    executor?: DbExecutor,
  ) => Promise<boolean>
  readonly describeRef: (resourceId: string, organizationId: string) => Promise<ResourceRef | null>
  readonly exists: (ids: readonly string[]) => Promise<Set<string>>
  readonly listIdsInProject: (projectId: string, organizationId: string) => Promise<string[]>
  readonly assertMayWiden?: (session: AuthorizedSession, resourceId: string, widening: AudienceWidening) => Promise<void>
  readonly widenAudience?: <T>(
    session: AuthorizedSession,
    resourceId: string,
    widening: AudienceWidening,
    write: (executor: DbExecutor) => Promise<T>,
  ) => Promise<T>
  readonly requireWriteAccess?: (session: AuthorizedSession, resourceId: string) => Promise<void>
  readonly readersAmong?: (
    organizationId: string,
    resourceId: string,
    userIds: readonly string[],
    asker?: AuthorizedSession,
  ) => Promise<ReadonlySet<string>>
}

const CONVERSATION_VISIBILITIES = ['private', 'project'] as const

const conversationDescriptor: ShareableDescriptor = {
  type: 'conversation',
  probe: async (resourceId) => {
    const row = await findConversationTenancy(resourceId)
    if (!row) return null
    return {
      organizationId: row.organizationId,
      projectId: row.projectId,
      container: row.projectId
        ? { kind: 'project', id: row.projectId }
        : { kind: 'organization', id: row.organizationId },
      visibility: row.visibility,
      createdBy: row.createdBy,
      deletedAt: row.deletedAt,
    }
  },
  allowedVisibilities: CONVERSATION_VISIBILITIES,
  defaultVisibility: 'private',
  roles: RESOURCE_ROLES,
  supportsMentions: true,
  setVisibility: async (resourceId, organizationId, visibility, executor) => {
    const row = await updateConversationVisibilityInOrg(resourceId, organizationId, visibility, executor)
    return row !== null
  },
  describeRef: async (resourceId, organizationId) => {
    const row = await findConversationInOrg(resourceId, organizationId)
    if (!row) return null
    return { title: row.title ?? null }
  },
  exists: (ids) => conversationIdsExisting(ids),
  listIdsInProject: (projectId, organizationId) => listConversationIdsForProject(projectId, organizationId),
  assertMayWiden: (session, resourceId, widening) => assertMayWidenConversation(session, resourceId, widening),
  widenAudience: (session, resourceId, widening, write) =>
    widenConversationAudience(session, resourceId, widening, write),
  readersAmong: async (organizationId, resourceId, userIds, asker) =>
    peopleWhoMayRead(organizationId, resourceId, userIds, undefined, asker),
  deepLink: (resourceId, options) => {
    const anchor = options?.anchorId ? `#message-${encodeURIComponent(options.anchorId)}` : ''
    return options?.projectId
      ? `/app/projects/${encodeURIComponent(options.projectId)}/chat?session=${encodeURIComponent(resourceId)}${anchor}`
      : `/app/chat?session=${encodeURIComponent(resourceId)}${anchor}`
  },
  labelKey: 'conversation',
}

const DOCUMENT_VISIBILITIES = ['project'] as const

const documentDescriptor: ShareableDescriptor = {
  type: 'document',
  probe: async (resourceId) => {
    const row = await findDocumentTenancy(resourceId)
    if (!row) return null
    return {
      organizationId: row.organizationId,
      projectId: row.projectId,
      container: row.projectId
        ? { kind: 'project', id: row.projectId }
        : { kind: 'organization', id: row.organizationId },
      visibility: row.visibility,
      createdBy: row.createdBy,
      deletedAt: null,
      folderId: row.folderId,
    }
  },
  allowedVisibilities: DOCUMENT_VISIBILITIES,
  defaultVisibility: 'project',
  roles: RESOURCE_ROLES,
  supportsMentions: false,
  setVisibility: async (resourceId, organizationId, visibility, executor) => {
    const row = await updateDocumentVisibilityInOrg(resourceId, organizationId, visibility, executor)
    return row !== null
  },
  describeRef: async (resourceId, organizationId) => {
    const row = await findDocumentTenancy(resourceId)
    if (!row || row.organizationId !== organizationId) return null
    return { title: documentDisplayName(row) }
  },
  requireWriteAccess: async (session, resourceId) => {
    const row = await findDocumentTenancy(resourceId)
    if (!row?.projectId) return
    await requireFolderWrite(session, row.projectId, [row.folderId ?? null])
  },
  exists: (ids) => documentIdsExisting(ids),
  listIdsInProject: (projectId, organizationId) => listDocumentIdsForProject(projectId, organizationId),
  deepLink: (resourceId, options) => {
    const doc = encodeURIComponent(resourceId)
    const review = options?.markId ? `&review=1&mark=${encodeURIComponent(options.markId)}` : ''
    if (!options?.projectId) return `/app/office-shelf?doc=${doc}${review}`
    return `/app/projects/${encodeURIComponent(options.projectId)}/files?doc=${doc}${review}`
  },
  labelKey: 'document',
}

export const SHAREABLE_REGISTRY: Record<ShareableResourceType, ShareableDescriptor> = {
  conversation: conversationDescriptor,
  document: documentDescriptor,
}

export function describeResource(type: ShareableResourceType): ShareableDescriptor {
  const descriptor = SHAREABLE_REGISTRY[type]
  if (!descriptor) {
    throw new Error(`[sharing] No registry entry for resource type "${type}"`)
  }
  return descriptor
}

export function roleRank(role: ResourceRole): number {
  return RESOURCE_ROLES.indexOf(role)
}

export function strongerRole(a: ResourceRole | null, b: ResourceRole | null): ResourceRole | null {
  if (!a) return b
  if (!b) return a
  return roleRank(a) >= roleRank(b) ? a : b
}

export function roleSatisfies(role: ResourceRole | null, minimum: ResourceRole): boolean {
  return role !== null && roleRank(role) >= roleRank(minimum)
}

export function requireShareableType(raw: string): ShareableResourceType {
  const resourceType = SHAREABLE_RESOURCE_TYPES.find((candidate) => candidate === raw)
  if (!resourceType) {
    throw new BadRequestError(`"${raw}" is not a shareable resource type`, {
      allowed: SHAREABLE_RESOURCE_TYPES,
    })
  }
  return resourceType
}

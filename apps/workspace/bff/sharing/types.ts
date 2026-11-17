import type { ResourceRole, ResourceVisibility, ShareableResourceType } from '@/lib/db/schema/resource-shares'

export type { ResourceRole, ResourceVisibility, ShareableResourceType }

export type AccessReason = 'creator' | 'grant' | 'visibility-project' | 'visibility-organization'

export interface DirectoryPerson {
  userId: string
  email: string | null
  name: string
  profilePictureUrl: string | null
}

export interface ResourceAccessEntry {
  person: DirectoryPerson
  role: ResourceRole
  reason: AccessReason
  grantedBy: string | null
  lostAccess?: boolean
}

export interface ResourceSharingState {
  resourceType: ShareableResourceType
  resourceId: string
  visibility: ResourceVisibility
  allowedVisibilities: readonly ResourceVisibility[]
  myRole: ResourceRole | null
  canManage: boolean
  canEscalate: boolean
  entries: ResourceAccessEntry[]
  shared: boolean
}

export interface ShareCandidate {
  person: DirectoryPerson
  alreadyHasAccess: boolean
  needsProjectAccess: boolean
  lacksFolderAccess?: boolean
}

export const SHARING_ERROR_REASONS = {
  containerAccessRequired: 'container-access-required',
  organizationMembershipRequired: 'organization-membership-required',
  lastOwner: 'last-owner',
  rateLimited: 'rate-limited',
  rosterFull: 'roster-full',
  restrictedContent: 'restricted-content',
  restrictedContentSelf: 'restricted-content-self',
  restrictedContentProject: 'restricted-content-project',
  crossProjectContent: 'cross-project-content',
  crossProjectContentSelf: 'cross-project-content-self',
  crossProjectContentProject: 'cross-project-content-project',
} as const

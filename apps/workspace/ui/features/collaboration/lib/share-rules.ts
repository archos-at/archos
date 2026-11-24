import type { ResourceRole, ResourceSharingState, ResourceVisibility, ShareCandidate } from '@/lib/sharing/types'

export const ROLE_OPTIONS: readonly ResourceRole[] = ['viewer', 'collaborator', 'owner']
export const VISIBILITY_RANK: Record<ResourceVisibility, number> = {
  private: 0,
  project: 1,
  organization: 2,
}

export const MAX_CANDIDATES = 6

export const isBlocked = (candidate: ShareCandidate): boolean =>
  candidate.needsProjectAccess || candidate.lacksFolderAccess === true

export const canLeave = (state: ResourceSharingState, currentUserId: string): boolean =>
  state.myRole !== 'owner' ||
  state.entries.some((entry) => entry.role === 'owner' && entry.person.userId !== currentUserId)

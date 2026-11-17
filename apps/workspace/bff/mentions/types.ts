import type { DirectoryPerson } from '@/lib/sharing/types'
import { isLegacyAgentMentionId } from './legacy-mention-ids'

export type { DirectoryPerson }

export const AGENT_MENTION_ID = 'agent:core'

export const isAgentMentionId = (targetId: string): boolean =>
  targetId === AGENT_MENTION_ID || isLegacyAgentMentionId(targetId)

export interface MentionInput {
  targetId: string
}

export interface AddresseeSet {
  agent: boolean
  users: string[]
}

export interface PersistedMessageResult {
  id: string
  addressees: AddresseeSet
  createdRequests: number
}

export interface PendingMentionView {
  id: string
  person: DirectoryPerson
  requestedBy: DirectoryPerson | null
  note: string | null
  anchorId: string | null
  createdAt: string
}

export interface AwaitingStateResponse {
  pending: PendingMentionView[]
  awaitingMe: boolean
}

export interface MentionCandidate {
  targetId: string
  person: DirectoryPerson
  isAgent: boolean
  isParticipant: boolean
  needsInvite: boolean
}

export interface MentionCandidatesResponse {
  candidates: MentionCandidate[]
  canInvite: boolean
}

export const MENTION_ERROR_REASONS = {
  inviteRequiresOwner: 'mention-invite-requires-owner',
  containerAccessRequired: 'container-access-required',
  rateLimited: 'mention-rate-limited',
} as const

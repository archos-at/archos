import type { ResourceRole } from '@/lib/sharing/types'
import type { ThreadSharing } from '@/shared/collaboration/thread-sharing'

const ROLE_LADDER: readonly ResourceRole[] = ['viewer', 'collaborator', 'owner']

const MINIMUM_CONTRIBUTOR_ROLE: ResourceRole = 'collaborator'

export function roleMayContribute(role: ResourceRole | null): boolean {
  if (role === null) return false
  const rank = ROLE_LADDER.indexOf(role)
  const minimum = ROLE_LADDER.indexOf(MINIMUM_CONTRIBUTOR_ROLE)
  return rank >= 0 && rank >= minimum
}

export type ComposerDenial =
  | 'unauthenticated'
  | 'read-only-role'
  | 'no-project-chat-permission'

export interface ComposerCapabilityInput {
  readonly isAuthenticated: boolean
  readonly canCollaborate: boolean
  readonly sharing: ThreadSharing
  readonly myRole: ResourceRole | null
  readonly mayChatInProject?: boolean
  readonly isBusy: boolean
  readonly isResponseMode: boolean
  readonly otherPersonsTurn: boolean
  readonly ownTurnStreaming?: boolean
}

export interface ComposerCapabilities {
  readonly canContribute: boolean
  readonly canCompose: boolean
  readonly canDraft: boolean
  readonly canBroadcastTyping: boolean
  readonly deniedBy: ComposerDenial | null
  readonly roleUnknown: boolean
}

export function composerCapabilities(input: ComposerCapabilityInput): ComposerCapabilities {
  const roleUnknown = input.sharing === 'shared' && input.myRole === null

  const deniedBy: ComposerDenial | null = !input.isAuthenticated
    ? 'unauthenticated'
    : // Checked before the conversation role, because it is the broader fact:
      input.mayChatInProject === false
      ? 'no-project-chat-permission'
      : // A role we have is ranked. A role we do NOT have is deliberately not a
        input.myRole !== null && !roleMayContribute(input.myRole)
        ? 'read-only-role'
        : null

  const canContribute = deniedBy === null

  const canCompose =
    canContribute &&
    !(input.isBusy && !input.isResponseMode) &&
    !input.otherPersonsTurn

  const canDraft =
    canCompose ||
    (canContribute && !input.otherPersonsTurn && input.ownTurnStreaming === true)

  const canBroadcastTyping = input.canCollaborate && input.sharing === 'shared' && canContribute

  return { canContribute, canCompose, canDraft, canBroadcastTyping, deniedBy, roleUnknown }
}

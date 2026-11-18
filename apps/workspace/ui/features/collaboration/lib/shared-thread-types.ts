import type { ConversationEngagement } from '@/lib/db/schema/conversations'
import type { DirectoryPerson, ResourceRole } from '@/lib/sharing/types'

export interface ConversationAccessFacts {
  shared?: boolean
  myRole?: ResourceRole | null
  myReadState?: { lastReadMessageId: string | null } | null
  engagementMode?: ConversationEngagement
  engagementSuggestion?: ConversationEngagement | null
}

export interface SharedThreadTurn {
  actorUserId: string | null
}

export interface SharedThreadArrival {
  messageId: string
  authorUserId: string | null
  authorName: string | null
}

export interface UseSharedThreadOptions {
  conversationId: string | null
  enabled?: boolean
  currentUserId?: string | null
  active?: boolean
}

export interface UseSharedThreadResult {
  shared: boolean
  myRole: ResourceRole | null
  loading: boolean
  connected: boolean
  accessLost: boolean
  turnInFlight: SharedThreadTurn | null
  clearTurnInFlight: () => void
  noteTurnActivity: () => void
  typists: DirectoryPerson[]
  participants: DirectoryPerson[]
  authorOf: (userId: string | null | undefined) => DirectoryPerson | null
  unreadAfterMessageId: string | null
  lastArrival: SharedThreadArrival | null
  engagement: ConversationEngagement
  engagementSuggestion: ConversationEngagement | null
  setEngagement: (mode: ConversationEngagement) => Promise<boolean>
  refresh: () => void
}

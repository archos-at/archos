import type { InboxItemType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'

export type CollaborationEvent =
  | {
      kind: 'inbox.changed'
      pending: number
      itemType?: InboxItemType
    }
  | {
      kind: 'conversation.message'
      conversationId: string
      authorUserId: string | null
      messageId: string
    }
  | {
      kind: 'conversation.turn'
      conversationId: string
      phase: 'started' | 'ended'
      actorUserId: string | null
    }
  | {
      kind: 'conversation.awaiting'
      conversationId: string
      awaitingUserIds: string[]
    }
  | {
      kind: 'conversation.typing'
      conversationId: string
      userId: string
      typing: boolean
      ttlMs: number
    }
  | {
      kind: 'document.version.changed'
      documentId: string
      versionId: string
      state: string
    }
  | {
      kind: 'resource.access.changed'
      resourceType: ShareableResourceType
      resourceId: string
      change: 'granted' | 'revoked' | 'visibility' | 'role_changed'
    }

export interface EventEnvelope {
  id: string
  at: string
  event: CollaborationEvent
}

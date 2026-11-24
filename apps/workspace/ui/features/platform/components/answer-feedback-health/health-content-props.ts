import type { RatingsFilters } from '@/lib/feedback/filters'
import type { ConversationTagKey } from '@/lib/conversations/tags'
import type { FeedbackHealthResponse, FeedbackHealthTurn, FeedbackReason } from '../answer-feedback-types'

export interface HealthContentProps {
  data: FeedbackHealthResponse
  busy: boolean
  digestSearch: string
  narrowed: boolean
  filtered: boolean
  filters: RatingsFilters
  organizationIds: readonly string[]
  locale: string
  onReason: (key: FeedbackReason) => void
  onOrg: (id: string) => void
  onTopic: (key: ConversationTagKey) => void
  onClearFilters: () => void
  onOpenTurn: (turn: FeedbackHealthTurn) => void
}

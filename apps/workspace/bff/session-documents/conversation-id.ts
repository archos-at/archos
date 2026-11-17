import { z } from 'zod'
import { BadRequestError } from '@/lib/api/api-error'

export const CONVERSATION_ID_PATTERN =
  /^s_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/

const CONVERSATION_ID_MESSAGE =
  'conversationId must be a conversation id (`s_` followed by a UUID with underscores)'

export const conversationIdSchema = z.string().regex(CONVERSATION_ID_PATTERN, CONVERSATION_ID_MESSAGE)

export function parseConversationId(value: unknown): string {
  const parsed = conversationIdSchema.safeParse(value)
  if (!parsed.success) {
    throw new BadRequestError(CONVERSATION_ID_MESSAGE)
  }
  return parsed.data
}

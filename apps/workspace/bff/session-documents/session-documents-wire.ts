import { z } from 'zod'
import { conversationIdSchema } from './conversation-id'

export const listSessionDocumentsQuerySchema = z.object({
  conversationId: conversationIdSchema,
})

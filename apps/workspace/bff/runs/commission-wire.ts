import { z } from 'zod'
import { TASK_GOAL_MAX_CHARS } from '@/lib/tasks/wire'
import { planDocumentsSchema } from './plan-documents'

export const commissionRunSchema = z.object({
  conversationId: z.string().min(1),
  question: z.string().trim().min(1).max(TASK_GOAL_MAX_CHARS),
  context: z.string().trim().max(20_000).optional(),
  documents: planDocumentsSchema.optional(),
})

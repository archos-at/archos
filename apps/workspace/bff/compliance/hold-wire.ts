import { z } from 'zod'

export const createHoldSchema = z.object({
  entityType: z.enum(['project', 'document', 'conversation', 'organization', 'user', 'folder']),
  entityId: z.string().min(1),
  reason: z.string().min(1).max(2000),
})

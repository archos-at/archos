import { z } from 'zod'

export const risDocumentQuerySchema = z.object({
  reference: z.string().min(1).max(2048),
  application: z.string().max(32).optional(),
  passage: z.string().max(2000).optional(),
})

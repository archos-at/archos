import { z } from 'zod'

export const assignmentBodySchema = z.object({
  userId: z.string().min(1),
})

export const assignmentDeleteQuerySchema = z.object({
  userId: z.string().min(1),
})

export const assignmentCandidatesQuerySchema = z.object({
  access: z.enum(['read', 'write']).optional(),
})

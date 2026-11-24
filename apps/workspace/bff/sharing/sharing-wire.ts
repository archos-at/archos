import { z } from 'zod'
import { RESOURCE_ROLES, RESOURCE_VISIBILITIES } from '@/lib/sharing/sharing-vocabulary'

const confirmPersonalContent = z
  .boolean()
  .optional()
  .describe('The owner confirms sharing a chat that drew on their own shelf or personal notes (ADR-0191).')

export function confirmedByThePerson(confirm: boolean | undefined, actingForThePerson: boolean): boolean {
  return confirm === true && !actingForThePerson
}

export const visibilitySchema = z.object({
  visibility: z.enum(RESOURCE_VISIBILITIES),
  confirmPersonalContent,
})

export const grantSchema = z.object({
  subjectUserId: z.string().min(1).max(256),
  role: z.enum(RESOURCE_ROLES).default('collaborator'),
  confirmPersonalContent,
})

export const escalateSchema = z.object({ escalate: z.literal(true) })

export const grantPostSchema = z.union([escalateSchema, grantSchema])

export const roleChangeSchema = z.object({
  subjectUserId: z.string().min(1).max(256),
  role: z.enum(RESOURCE_ROLES),
})

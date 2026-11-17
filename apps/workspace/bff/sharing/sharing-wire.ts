import { z } from 'zod'
import { RESOURCE_ROLES, RESOURCE_VISIBILITIES } from '@/lib/sharing/sharing-vocabulary'

export const visibilitySchema = z.object({
  visibility: z.enum(RESOURCE_VISIBILITIES),
})

export const grantSchema = z.object({
  subjectUserId: z.string().min(1).max(256),
  role: z.enum(RESOURCE_ROLES).default('collaborator'),
})

export const escalateSchema = z.object({ escalate: z.literal(true) })

export const grantPostSchema = z.union([escalateSchema, grantSchema])

export const roleChangeSchema = z.object({
  subjectUserId: z.string().min(1).max(256),
  role: z.enum(RESOURCE_ROLES),
})

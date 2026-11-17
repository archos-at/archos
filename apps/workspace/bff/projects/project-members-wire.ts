import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'

export const addMemberSchema = z.object({
  organizationMembershipId: z.string().min(1),
  roleSlug: z.union([
    z.enum(['project-viewer', 'project-contributor', 'project-editor', 'project-admin']),
    z.literal(''),
  ]),
})

export const listMembersQuerySchema = z.object({
  scope: z.enum(['members', 'organization']).optional(),
  ...pageQueryShape,
})

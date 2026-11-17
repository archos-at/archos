import { z } from 'zod'
import type { AuthorizedSession } from '@/lib/auth/types'

export const requesterSchema = z.object({
  userId: z.string().min(1),
  email: z.string(),
  organizationMembershipId: z.string().min(1),
  role: z.string().min(1),
  permissions: z.array(z.string()),
  featureFlags: z.array(z.string()).nullable().optional(),
})
export type JobRequester = z.infer<typeof requesterSchema>

export function requesterOf(session: AuthorizedSession): JobRequester {
  return {
    userId: session.userId,
    email: session.email,
    organizationMembershipId: session.organizationMembershipId,
    role: session.role,
    permissions: session.permissions,
    ...(session.featureFlags ? { featureFlags: session.featureFlags } : {}),
  }
}

export function sessionOf(requester: JobRequester, organizationId: string): AuthorizedSession {
  return {
    userId: requester.userId,
    email: requester.email,
    name: null,
    accessToken: '',
    organizationId,
    organizationMembershipId: requester.organizationMembershipId,
    role: requester.role,
    permissions: requester.permissions,
    featureFlags: requester.featureFlags ?? null,
  }
}

/**
 * Who a job runs on behalf of (ADR-0079): the requester a payload carries, and
 * the session a slice is run as.
 */

import { z } from 'zod'
import type { AuthorizedSession } from '@/lib/auth/types'

/**
 * The person a job runs on behalf of, as the permission checks need them.
 *
 * The job is authorized when it is enqueued, by the route that took the request.
 * What travels here says WHO asked; the walks that run as a person
 * (`reindex_project`, `reingest_failed`, `restore_folder_bin`) do not trust
 * the rest of it: `handlers.ts` resolves the person's membership and role
 * again before every slice, so a role revoked while the job waited ends it. Only `file_research_report`, a one-step job a
 * reader's request authorizes up front, files on the snapshot. It is NOT a
 * session token. The worker has no access token and nothing here can be
 * replayed against WorkOS; a project or resource check asks WorkOS live, by the
 * membership id, as it does for a request.
 */
export const requesterSchema = z.object({
  userId: z.string().min(1),
  email: z.string(),
  organizationMembershipId: z.string().min(1),
  role: z.string().min(1),
  permissions: z.array(z.string()),
  /**
   * The feature flags the person's session carried, for the one kind that is
   * gated on them when it files a document (`file_research_report`). Optional
   * because a payload stored before it existed has none, and a job that does
   * not file reads nothing from it.
   */
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

/** The session a slice runs as: the requester's identity in the job's organization, with no access token. */
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

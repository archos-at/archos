import 'server-only'

import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { can } from '@/lib/authz/decide'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'

export interface MailReviewAccess {
  closed: boolean
}

export function requireInboundMailEnabled(session: AuthorizedSession): void {
  if (!isInboundMailEnabled(session)) throw new NotFoundError()
}

export async function requireMailReviewer(session: AuthorizedSession, projectId: string): Promise<MailReviewAccess> {
  requireInboundMailEnabled(session)
  const access = await requireProjectAccess(session, projectId, DOCUMENT_WRITE_PERMISSIONS, { evenWhenClosed: true })
  return { closed: access.closed }
}

export async function mailReviewerProjectIds(session: AuthorizedSession, projectIds: readonly string[]): Promise<string[]> {
  if (!isInboundMailEnabled(session)) return []
  const allowed = await Promise.all(
    projectIds.map((projectId) =>
      requireMailReviewer(session, projectId).then(
        () => true,
        (error: unknown) => {
          if (error instanceof NotFoundError) return false
          throw error
        },
      ),
    ),
  )
  return projectIds.filter((_, index) => allowed[index])
}

export async function requireAddressManager(session: AuthorizedSession, projectId: string): Promise<void> {
  requireInboundMailEnabled(session)
  await requireProjectAccess(session, projectId, 'project:manage')
}

export function managesProject(session: AuthorizedSession, projectId: string): Promise<boolean> {
  return can(session, 'project:manage', { type: 'project', id: projectId })
}

import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { mailReviewerProjectIds } from './access'
import { countWaitingMailsByProject } from './repository'

export async function waitingMailCounts(session: AuthorizedSession, projectIds: readonly string[]): Promise<Record<string, number>> {
  const readable = await mailReviewerProjectIds(session, projectIds)
  return Object.fromEntries(await countWaitingMailsByProject(readable))
}

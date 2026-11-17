import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { endFollowsOnProjectClose } from '@/lib/mail-thread/follows'
import { rearmOneShotsSkippedWhileParked } from '@/lib/scheduling/scheduled-runs'

export async function endFollowsOfClosedProject(session: AuthorizedSession, projectId: string, now: Date): Promise<void> {
  try {
    await endFollowsOnProjectClose(session, projectId, now)
  } catch (error) {
    console.error('[projects] ending the follows of a closed project failed; sweep 12 ends them:', error)
  }
}

export async function rearmParkedOneShots(projectId: string, organizationId: string): Promise<void> {
  try {
    await rearmOneShotsSkippedWhileParked(projectId, organizationId)
  } catch (error) {
    console.error('[projects] re-arming one-shots skipped while the project was not active failed:', error)
  }
}

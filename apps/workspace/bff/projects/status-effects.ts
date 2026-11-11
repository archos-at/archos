import 'server-only'
/**
 * What a lifecycle move (`setProjectStatus`, `./service.ts`) sets off once it
 * committed (ADR-0098, ADR-0137). Each is logged on failure, never an error for
 * a move that happened.
 */

import type { AuthorizedSession } from '@/lib/auth/types'
import { endFollowsOnProjectClose } from '@/lib/mail-thread/follows'
import { rearmOneShotsSkippedWhileParked } from '@/lib/scheduling/scheduled-runs'

/**
 * Closing ends every follow of the project's E-Mail-Verläufe (`project_closed`,
 * ADR-0137): a standing decision to file replies ends with the work. After the
 * close committed, so a failure is logged, never an error for a close that
 * happened; sweep 12 ends what this missed.
 */
export async function endFollowsOfClosedProject(session: AuthorizedSession, projectId: string, now: Date): Promise<void> {
  try {
    await endFollowsOnProjectClose(session, projectId, now)
  } catch (error) {
    console.error('[projects] ending the follows of a closed project failed; sweep 12 ends them:', error)
  }
}

/**
 * The dated one-shots a pause or close retired, due again now that the project
 * runs (ADR-0098). After the move has committed, so a failure here is logged,
 * not turned into an error for a move that happened.
 */
export async function rearmParkedOneShots(projectId: string, organizationId: string): Promise<void> {
  try {
    await rearmOneShotsSkippedWhileParked(projectId, organizationId)
  } catch (error) {
    console.error('[projects] re-arming one-shots skipped while the project was not active failed:', error)
  }
}

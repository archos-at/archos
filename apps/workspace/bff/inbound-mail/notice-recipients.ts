import 'server-only'
/**
 * Who the E-Mail-Eingang's notices go to, asked of WorkOS (`./announce.ts`
 * says who is told what): whether one member holds a permission on the
 * project, the project's writers (any of `DOCUMENT_WRITE_PERMISSIONS`, the
 * people a held mail waits for) and its managers (`project:manage`). Every
 * notice is best effort, so a check that fails reads as "no" here, except for
 * the writers, whose list a burst of held mail reuses and must never be a
 * throttle's guess.
 */

import { PERMISSION_CHECKS_AT_ONCE, userHoldsProjectPermission, userHoldsProjectPermissionStrict } from '@/lib/authz/project-membership'
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access-rule'
import { getCached } from '@/lib/cache'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { inPool } from '@/lib/utils/in-pool'

type AskedPermission = 'project:view' | 'project:manage' | (typeof DOCUMENT_WRITE_PERMISSIONS)[number]

/** Whether the member holds the permission on the project; a check that failed reads as "no" (a notice is best effort). */
export const holds = (organizationId: string, projectId: string, userId: string, permission: AskedPermission) =>
  userHoldsProjectPermission({ organizationId }, projectId, userId, permission).catch(() => false)

/** Whether the member may write in the project (any of `DOCUMENT_WRITE_PERMISSIONS`), as the E-Mail-Eingang asks before a filing. */
export async function writes(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
    if (await holds(organizationId, projectId, userId, permission)) return true
  }
  return false
}

/** How long a project's writers are reused for its notices: a burst of held mail asks WorkOS once, not once per mail. */
export const PROJECT_WRITERS_TTL_MS = 5 * 60 * 1000

/** Some write check went unanswered: the writers it did name, and how many it could not. */
class WritersUnansweredError extends Error {
  constructor(
    readonly answered: readonly string[],
    why: string,
  ) {
    super(why)
    this.name = 'WritersUnansweredError'
  }
}

/**
 * Every member who may write in the project, so may file its mail: the people
 * a held mail waits for. Reused for {@link PROJECT_WRITERS_TTL_MS} per
 * organization and project, so a burst of held mail costs the directory's
 * write checks once (up to two per member), not once per mail; a member given
 * write rights is told from the next read on.
 *
 * Asked strictly, a few at a time: a check WorkOS did not answer is not a
 * "no". When one goes unanswered nothing is stored, and the mail is told to
 * the writers it did name and to the project's managers, never to nobody
 * (`[inbound-mail]` warning). An unreadable directory names nobody, and says so.
 */
export async function projectWriters(organizationId: string, projectId: string, label: string): Promise<string[]> {
  try {
    return await getCached(`inbound-mail-writers:${organizationId}:${projectId}`, PROJECT_WRITERS_TTL_MS, () =>
      askWriters(organizationId, projectId),
    )
  } catch (error) {
    const answered = error instanceof WritersUnansweredError ? error.answered : []
    console.warn(
      `[inbound-mail] the writers of project ${projectId} could not all be asked for ${label} (${error instanceof Error ? error.message : 'unknown'}): telling the managers too`,
    )
    const recipients = [...new Set([...answered, ...(await projectManagers(organizationId, projectId, label))])]
    if (recipients.length === 0) console.warn(`[inbound-mail] nobody to tell about ${label}: no writer or manager could be named`)
    return recipients
  }
}

/** The writers, every member asked; throws {@link WritersUnansweredError} unless every check answered, so a guess is never stored. */
async function askWriters(organizationId: string, projectId: string): Promise<string[]> {
  const directory = await loadOrganizationDirectory(organizationId)
  if (directory.size === 0) throw new WritersUnansweredError([], 'the directory is empty')
  const verdicts = await inPool([...directory.keys()], PERMISSION_CHECKS_AT_ONCE, async (userId) => {
    try {
      return { userId, writes: await writesStrictly(organizationId, projectId, userId) }
    } catch {
      return { userId, writes: null }
    }
  })
  const writers = verdicts.filter((verdict) => verdict.writes === true).map((verdict) => verdict.userId)
  const unanswered = verdicts.filter((verdict) => verdict.writes === null).length
  if (unanswered > 0) throw new WritersUnansweredError(writers, `${unanswered} of ${verdicts.length} write checks went unanswered`)
  return writers
}

/** {@link writes}, but a check WorkOS did not answer throws instead of reading as "no". */
async function writesStrictly(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
    if (await userHoldsProjectPermissionStrict({ organizationId }, projectId, userId, permission)) return true
  }
  return false
}

/**
 * Every member who manages the project (`project:manage`), asked a few at a
 * time. The directory is the whole roster; an unreadable one tells nobody, and
 * says so in the log.
 */
export async function projectManagers(organizationId: string, projectId: string, label: string): Promise<string[]> {
  const directory = await loadOrganizationDirectory(organizationId)
  if (directory.size === 0) console.warn(`[inbound-mail] nobody to tell about ${label}: the directory is empty`)
  const verdicts = await inPool([...directory.keys()], PERMISSION_CHECKS_AT_ONCE, async (userId) =>
    (await holds(organizationId, projectId, userId, 'project:manage')) ? userId : null,
  )
  return verdicts.filter((userId): userId is string => userId !== null)
}

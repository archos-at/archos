import 'server-only'

import { PERMISSION_CHECKS_AT_ONCE, userHoldsProjectPermission, userHoldsProjectPermissionStrict } from '@/lib/authz/project-membership'
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access-rule'
import { getCached } from '@/lib/cache'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { inPool } from '@/lib/utils/in-pool'

type AskedPermission = 'project:view' | 'project:manage' | (typeof DOCUMENT_WRITE_PERMISSIONS)[number]

export const holds = (organizationId: string, projectId: string, userId: string, permission: AskedPermission) =>
  userHoldsProjectPermission({ organizationId }, projectId, userId, permission).catch(() => false)

export async function writes(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
    if (await holds(organizationId, projectId, userId, permission)) return true
  }
  return false
}

export const PROJECT_WRITERS_TTL_MS = 5 * 60 * 1000

class WritersUnansweredError extends Error {
  constructor(
    readonly answered: readonly string[],
    why: string,
  ) {
    super(why)
    this.name = 'WritersUnansweredError'
  }
}

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

async function writesStrictly(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
    if (await userHoldsProjectPermissionStrict({ organizationId }, projectId, userId, permission)) return true
  }
  return false
}

export async function projectManagers(organizationId: string, projectId: string, label: string): Promise<string[]> {
  const directory = await loadOrganizationDirectory(organizationId)
  if (directory.size === 0) console.warn(`[inbound-mail] nobody to tell about ${label}: the directory is empty`)
  const verdicts = await inPool([...directory.keys()], PERMISSION_CHECKS_AT_ONCE, async (userId) =>
    (await holds(organizationId, projectId, userId, 'project:manage')) ? userId : null,
  )
  return verdicts.filter((userId): userId is string => userId !== null)
}

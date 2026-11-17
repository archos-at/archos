import 'server-only'

import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { can } from '@/lib/authz/decide'
import { canManageBudgets } from '@/lib/authz/organizations'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'

export interface ProjectSettingsAccess {
  manage: boolean
  changeStatus: boolean
  manageMembers: boolean
  editProfile: boolean
  writeMemory: boolean
  writeDocuments: boolean
  manageBudget: boolean
}

const CHECKS = {
  manage: ['project:manage'],
  manageMembers: ['project:members:manage', 'project:manage'],
  editProfile: ['project:edit'],
  writeMemory: ['project:memory:write', 'project:edit'],
  writeDocuments: ['project:documents:write', 'project:edit'],
} as const satisfies Record<string, readonly ProjectPermission[]>

type CheckKey = keyof typeof CHECKS

async function holdsAny(
  session: AuthorizedSession,
  projectId: string,
  permissions: readonly ProjectPermission[]
): Promise<boolean> {
  const resource = { type: 'project', id: projectId } as const
  const held = await Promise.all(
    permissions.map((permission) => can(session, permission, resource))
  )
  return held.some(Boolean)
}

export async function canWriteProjectMemory(session: AuthorizedSession, projectId: string): Promise<boolean> {
  return holdsAny(session, projectId, CHECKS.writeMemory)
}

export async function holdsManageEvenWhenClosed(
  session: AuthorizedSession,
  projectId: string
): Promise<boolean> {
  try {
    await requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true })
    return true
  } catch (error) {
    if (error instanceof NotFoundError) return false
    throw error
  }
}

export async function resolveProjectSettingsAccess(
  session: AuthorizedSession,
  projectId: string
): Promise<ProjectSettingsAccess> {
  const keys = Object.keys(CHECKS) as CheckKey[]
  const [changeStatus, ...results] = await Promise.all([
    holdsManageEvenWhenClosed(session, projectId),
    ...keys.map((key) => holdsAny(session, projectId, CHECKS[key])),
  ])
  const flags = Object.fromEntries(keys.map((key, index) => [key, results[index]])) as Record<
    CheckKey,
    boolean
  >
  return { ...flags, changeStatus, manageBudget: flags.manage || canManageBudgets(session) }
}

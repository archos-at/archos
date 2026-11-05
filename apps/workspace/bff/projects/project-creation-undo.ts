/**
 * Undoing a project creation that failed part-way (`createProject`).
 *
 * A creation writes in two systems: the `projects` row, then the WorkOS
 * resource and the creator's `project-admin` assignment on it. The undo used to
 * delete only the row, so every failure after `createResource` (the role
 * assignment, the intake, the close) left a resource and an admin assignment in
 * WorkOS for a project that no longer exists. The resource is asked for by its
 * external id whether or not `createResource` answered: a call that timed out
 * after WorkOS committed it left one behind too, and a resource that was never
 * made is a 404, which is nothing to undo.
 */

import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import { deleteProjectRow } from './repository'

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

/**
 * Best-effort: removes the project's WorkOS resource (with every role assigned
 * on it) and its row. Never throws, so the caller rethrows the failure that
 * started the undo; what could not be undone is logged loudly, by project id.
 */
export async function undoHalfCreatedProject(projectId: string, organizationId: string): Promise<void> {
  try {
    await getWorkOS().authorization.deleteResourceByExternalId({
      organizationId,
      resourceTypeSlug: 'project',
      externalId: projectId,
      cascadeDelete: true,
    })
  } catch (error) {
    if (!isNotFound(error)) {
      console.error(`[projects] project ${projectId} was created half-way; its WorkOS resource could not be removed:`, error)
    }
  }
  // If even this fails the row survives unreachable, which is the state we are
  // trying to avoid — so say so loudly rather than swallow it.
  await deleteProjectRow(projectId, organizationId).catch((cleanupError: unknown) => {
    console.error(`[projects] project ${projectId} was created half-way and could not be rolled back:`, cleanupError)
  })
}

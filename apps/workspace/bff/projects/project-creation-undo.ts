import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import { deleteProjectRow } from './repository'

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

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
  await deleteProjectRow(projectId, organizationId).catch((cleanupError: unknown) => {
    console.error(`[projects] project ${projectId} was created half-way and could not be rolled back:`, cleanupError)
  })
}

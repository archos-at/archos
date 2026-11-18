import 'server-only'
import { z } from 'zod'
import { getCached, invalidateCached } from '@/lib/cache'
import {
  DELETED_FOLDER_CONTENT_POLICIES,
  type DeletedFolderContentPolicy,
} from '@/lib/authz/folder-access-rule'
import { findOrganization } from './repository'

export const DELETED_FOLDER_CONTENT_SETTING = 'deletedFolderContent'

export const DEFAULT_DELETED_FOLDER_CONTENT: DeletedFolderContentPolicy = 'unchanged'

export { deletedFolderContentSchema } from './organization-wire'

const CACHE_TTL_MS = 30_000
const cacheKey = (organizationId: string): string => `deleted-folder-content:${organizationId}`

export function resolveDeletedFolderContentPolicy(stored: unknown): DeletedFolderContentPolicy {
  const parsed = z.enum(DELETED_FOLDER_CONTENT_POLICIES).safeParse(stored)
  return parsed.success ? parsed.data : DEFAULT_DELETED_FOLDER_CONTENT
}

export async function getDeletedFolderContentPolicy(organizationId: string): Promise<DeletedFolderContentPolicy> {
  return getCached(cacheKey(organizationId), CACHE_TTL_MS, async () => {
    const row = await findOrganization(organizationId)
    const settings = (row?.settings ?? {}) as Record<string, unknown>
    return resolveDeletedFolderContentPolicy(settings[DELETED_FOLDER_CONTENT_SETTING])
  })
}

export async function invalidateDeletedFolderContentPolicy(organizationId: string): Promise<void> {
  await invalidateCached(cacheKey(organizationId))
}

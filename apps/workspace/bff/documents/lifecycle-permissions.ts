import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { can } from '@/lib/authz/decide'
import type { DocumentLifecyclePermission } from './lifecycle-types'

const LIFECYCLE_PERMISSIONS: readonly DocumentLifecyclePermission[] = [
  'project:view',
  'project:edit',
  'project:documents:write',
  'project:documents:generate',
]

export async function resolveDocumentLifecyclePermissions(
  session: AuthorizedSession,
  projectId: string,
): Promise<DocumentLifecyclePermission[]> {
  const resource = { type: 'project', id: projectId } as const
  const held = await Promise.all(
    LIFECYCLE_PERMISSIONS.map(async (permission) => ({
      permission,
      allowed: await can(session, permission, resource),
    })),
  )
  return held.filter((row) => row.allowed).map((row) => row.permission)
}

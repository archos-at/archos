import { ForbiddenError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { DocumentShelf } from './shelf'

const PROJECT_WRITE_PERMISSIONS = ['project:documents:write', 'project:edit'] as const

export async function requireShelfRead(session: AuthorizedSession, shelf: DocumentShelf): Promise<void> {
  if (shelf.kind === 'office_shelf') return
  await requireProjectAccess(session, shelf.projectId, 'project:view')
}

export async function requireShelfWrite(session: AuthorizedSession, shelf: DocumentShelf): Promise<void> {
  if (shelf.kind === 'project') {
    await requireProjectAccess(session, shelf.projectId, PROJECT_WRITE_PERMISSIONS)
    return
  }
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
}

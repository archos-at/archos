import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import { requirePersonalShelfDoor } from './personal-shelf-door'
import type { DocumentShelf } from './shelf'

const PROJECT_WRITE_PERMISSIONS = ['project:documents:write', 'project:edit'] as const

function requireOwnShelf(session: AuthorizedSession, userId: string): void {
  if (userId !== session.userId) throw new NotFoundError()
  requirePersonalShelfDoor()
}

export async function requireShelfRead(session: AuthorizedSession, shelf: DocumentShelf): Promise<void> {
  switch (shelf.kind) {
    case 'office_shelf':
      return
    case 'project':
      await requireProjectAccess(session, shelf.projectId, 'project:view')
      return
    case 'personal':
      requireOwnShelf(session, shelf.userId)
  }
}

export async function requireShelfWrite(session: AuthorizedSession, shelf: DocumentShelf): Promise<void> {
  switch (shelf.kind) {
    case 'project':
      await requireProjectAccess(session, shelf.projectId, PROJECT_WRITE_PERMISSIONS)
      return
    case 'office_shelf':
      if (!canManageOfficeShelf(session)) throw new ForbiddenError()
      return
    case 'personal':
      requireOwnShelf(session, shelf.userId)
  }
}

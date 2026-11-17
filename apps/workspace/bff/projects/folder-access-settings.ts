import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { folderReadOnlyError, getProjectFolderAccess, type FolderGrantLevel } from '@/lib/authz/folder-access'
import {
  ensureFolderResource,
  listFolderRoleHolders,
  removeFolderResource,
  replaceFolderRoleHolders,
} from '@/lib/authz/folder-roles'
import { resolveSubjectMembership } from '@/lib/authz/project-membership'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { projectFolderGrants } from '@/lib/db/schema/project-folder-grants'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { findProjectInOrg } from '@/lib/projects/repository'
import { placeProjectDocuments, type PlacementResult } from './collection-placement'
import { assertRestrictionKeepsIfcOpen } from './ifc-folder-guard'
import { projectShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'

import { FOLDER_ACCESS_MAX_PEOPLE } from './folder-access-wire'

export { FOLDER_ACCESS_MAX_PEOPLE }

export interface FolderPersonGrant {
  userId: string
  level: FolderGrantLevel
}

export type FolderAccessSetting =
  | { mode: 'inherit' }
  | { mode: 'custom'; everyoneReads: boolean; people: FolderPersonGrant[] }

export interface FolderAccessResult extends PlacementResult {
  folderId: string
  access: FolderAccessSetting
}

export function describeAccess(access: FolderAccessSetting): string {
  if (access.mode === 'inherit') return ''
  const entries = access.people.map((person) => `user:${person.userId}:${person.level}`).sort()
  return [...(access.everyoneReads ? ['*:read'] : []), ...entries].join(',')
}

interface ResolvedPerson {
  userId: string
  organizationMembershipId: string
  level: FolderGrantLevel
}

async function resolvedPeople(
  organizationId: string,
  access: Extract<FolderAccessSetting, { mode: 'custom' }>
): Promise<ResolvedPerson[]> {
  if (access.people.length === 0 && !access.everyoneReads) {
    throw new BadRequestError('A folder with its own access list needs at least one person, or everyone reading it')
  }
  if (access.people.length > FOLDER_ACCESS_MAX_PEOPLE) {
    throw new BadRequestError(`A folder names at most ${FOLDER_ACCESS_MAX_PEOPLE} people`)
  }
  const userIds = access.people.map((person) => person.userId)
  if (new Set(userIds).size !== userIds.length) throw new BadRequestError('A person is listed twice')
  const memberships = await Promise.all(userIds.map((userId) => resolveSubjectMembership(organizationId, userId)))
  const unknown = userIds.filter((_userId, index) => !memberships[index])
  if (unknown.length > 0) throw new BadRequestError(`Not a member of this organization: ${unknown.join(', ')}`)
  return access.people.map((person, index) => ({
    userId: person.userId,
    organizationMembershipId: memberships[index]?.organizationMembershipId ?? '',
    level: person.level,
  }))
}

async function requireListManager(session: AuthorizedSession, projectId: string, folderId: string) {
  await requireProjectAccess(session, projectId, 'project:manage')
  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError('Project not found')
  const current = await getProjectFolderAccess(session, projectId, project.collectionName)
  if (!current.isVisible(folderId)) throw new NotFoundError('Folder not found')
  if (current.levelOf(folderId) !== 'write') throw folderReadOnlyError()
  return project
}

async function livingFolder(organizationId: string, projectId: string, folderId: string) {
  const db = getDb()
  const [folder] = await withTenant({ organizationId }, () =>
    db
      .select({ name: projectFolders.name, accessMode: projectFolders.accessMode, everyoneReads: projectFolders.everyoneReads })
      .from(projectFolders)
      .where(and(eq(projectFolders.id, folderId), eq(projectFolders.projectId, projectId), isNull(projectFolders.deletedAt)))
      .limit(1)
  )
  if (!folder) throw new NotFoundError('Folder not found')
  return folder
}

export async function getFolderAccess(
  session: AuthorizedSession,
  input: { projectId: string; folderId: string }
): Promise<FolderAccessSetting> {
  await requireListManager(session, input.projectId, input.folderId)
  const folder = await livingFolder(session.organizationId, input.projectId, input.folderId)
  if (folder.accessMode !== 'custom') return { mode: 'inherit' }
  const holders = await listFolderRoleHolders(session.organizationId, input.folderId)
  return {
    mode: 'custom',
    everyoneReads: folder.everyoneReads,
    people: holders.map((holder) => ({ userId: holder.userId, level: holder.level })),
  }
}

export async function setFolderAccess(
  session: AuthorizedSession,
  input: { projectId: string; folderId: string; access: FolderAccessSetting },
  request: Request
): Promise<FolderAccessResult> {
  const { organizationId } = session
  await requireListManager(session, input.projectId, input.folderId)
  const folder = await livingFolder(organizationId, input.projectId, input.folderId)
  const access = input.access
  const people = access.mode === 'custom' ? await resolvedPeople(organizationId, access) : null
  await assertRestrictionKeepsIfcOpen(
    organizationId,
    input.projectId,
    input.folderId,
    access.mode === 'custom' ? access.everyoneReads : null
  )

  const db = getDb()
  const updated = await withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`folder_access:${organizationId}:${input.folderId}`}, 0))`
      )
      if (access.mode === 'custom' && people) {
        await ensureFolderResource(organizationId, input.projectId, input.folderId, folder.name)
        await replaceFolderRoleHolders(organizationId, input.projectId, input.folderId, people)
      }
      const rows = await tx
        .update(projectFolders)
        .set({
          accessMode: access.mode,
          everyoneReads: access.mode === 'custom' && access.everyoneReads,
          accessChangedBy: session.userId,
          accessChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectFolders.id, input.folderId),
            eq(projectFolders.projectId, input.projectId),
            isNull(projectFolders.deletedAt)
          )
        )
        .returning({ id: projectFolders.id })
      if (rows.length === 0) return rows
      await tx.delete(projectFolderGrants).where(eq(projectFolderGrants.folderId, input.folderId))
      if (access.mode === 'inherit' && folder.accessMode === 'custom') {
        await removeFolderResource(organizationId, input.projectId, input.folderId).catch((error: unknown) => {
          console.warn(`[folder-access] folder ${input.folderId} inherits again; its WorkOS resource stays:`, error)
        })
      }
      return rows
    })
  )
  if (updated.length === 0) throw new NotFoundError('Folder not found')

  publishShelfChanged(organizationId, projectShelf(input.projectId), { folders: true })
  const placement = await placeProjectDocuments(organizationId, input.projectId)
  if (placement.moved > 0) publishShelfChanged(organizationId, projectShelf(input.projectId))
  const stored: FolderAccessSetting =
    access.mode === 'custom' && people
      ? { mode: 'custom', everyoneReads: access.everyoneReads, people: people.map(({ userId, level }) => ({ userId, level })) }
      : { mode: 'inherit' }
  await recordAuditEvent({
    organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.folder.access_changed',
    targetType: 'project',
    targetId: input.projectId,
    metadata: {
      folderId: input.folderId,
      mode: stored.mode,
      grants: describeAccess(stored),
      roles: '',
      documentsMoved: placement.moved,
    },
    request,
  })
  return { folderId: input.folderId, access: stored, ...placement }
}

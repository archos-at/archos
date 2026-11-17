import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  documentRoleDefinition,
  isDocumentRole,
  isScopeInstanceValid,
} from '@/lib/project-profile/document-roles'
import type { DocumentRole, RoleConfidence, RoleSource } from '@/lib/project-profile/document-roles'
import { invalidateProjectPromptViewCache } from '@/lib/project-profile/prompt-view'
import { lockProjectProfile } from '@/lib/projects/repository'
import type { DbTransaction } from '@/lib/storage/repository'
import { defaultBuildings } from '@/lib/project-profile/intake-building-keys'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import {
  confirmBinding,
  deleteBindings,
  documentBelongsToProject,
  findBindingsForRole,
  listProjectDocumentRoles,
  replaceSlotBinding,
} from './repository'
import type { DocumentRoleBinding, DocumentRoleReader } from './repository'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { normalizeBuildingId } from '@/lib/project-profile/legacy-names'

export type { DocumentRoleBinding } from './repository'

const WRITE_PERMISSIONS = ['project:documents:write', 'project:edit'] as const

export function buildingIds(profile: ProjectProfile | null): string[] {
  const buildings = profile
    ? answersFromProfile(profile, projectIntakeDefinitionV1).buildings
    : defaultBuildings()
  return buildings.map((building) => building.id)
}

function requireBuilding(projectId: string, buildingId: string) {
  return async (tx: DbTransaction): Promise<void> => {
    if (!buildingIds(await lockProjectProfile(tx, projectId)).includes(buildingId)) {
      throw new BadRequestError(`Building '${buildingId}' does not exist in this project.`)
    }
  }
}


async function sessionRoleReader(session: AuthorizedSession, projectId: string): Promise<DocumentRoleReader> {
  const [hiddenFolderIds, documents] = await Promise.all([
    getHiddenFolderIds(session, projectId),
    shelfReaderFor(session, { scope: 'project', projectId }),
  ])
  return { hiddenFolderIds, documents }
}

export async function listDocumentRoles(
  projectId: string,
  session: AuthorizedSession
): Promise<DocumentRoleBinding[]> {
  await requireProjectAccess(session, projectId, 'project:view')
  return listProjectDocumentRoles(projectId, await sessionRoleReader(session, projectId))
}

export interface DeclareDocumentRoleInput {
  projectId: string
  documentId: string
  role: string
  scopeInstanceId?: string | null
  confidence?: RoleConfidence
  source?: RoleSource
}

export interface DeclareDocumentRoleResult {
  binding: DocumentRoleBinding
  replaced: DocumentRoleBinding[]
}

export async function declareDocumentRole(
  input: DeclareDocumentRoleInput,
  session: AuthorizedSession
): Promise<DeclareDocumentRoleResult> {
  await requireProjectAccess(session, input.projectId, [...WRITE_PERMISSIONS])

  if (!isDocumentRole(input.role)) {
    throw new BadRequestError(`Unknown document role '${input.role}'.`)
  }
  const role: DocumentRole = input.role
  const definition = documentRoleDefinition(role)
  const scopeInstanceId = input.scopeInstanceId == null ? null : normalizeBuildingId(input.scopeInstanceId)

  if (!isScopeInstanceValid(role, scopeInstanceId)) {
    throw new BadRequestError(
      definition.scope === 'building'
        ? `Role '${role}' belongs to one building and needs its id.`
        : `Role '${role}' takes no scope instance.`
    )
  }

  const reader = await sessionRoleReader(session, input.projectId)
  if (!(await documentBelongsToProject(input.documentId, input.projectId, reader))) {
    throw new NotFoundError('Document not found in this project.')
  }

  const existing = await findBindingsForRole(input.projectId, role, scopeInstanceId)
  const confidence = input.confidence ?? 'declared'
  const source = input.source ?? 'user'

  const alreadyPresent = existing.find((binding) => binding.documentId === input.documentId)
  if (alreadyPresent) {
    const upgrades = alreadyPresent.confidence === 'suggested' && confidence === 'declared'
    if (!upgrades) return { binding: alreadyPresent, replaced: [] }

    await confirmBinding(input.projectId, alreadyPresent.id, confidence, source)
    await invalidateProjectPromptViewCache(input.projectId, session.organizationId)
    return {
      binding: { ...alreadyPresent, confidence, source },
      replaced: [],
    }
  }

  const replaced = definition.cardinality === 'one' ? existing : []
  const reported = await keepVisible(input.projectId, replaced, reader)

  await replaceSlotBinding(
    {
      organizationId: session.organizationId,
      projectId: input.projectId,
      documentId: input.documentId,
      role,
      scopeInstanceId,
      confidence,
      source,
      createdBy: session.userId,
    },
    replaced.map((binding) => binding.id),
    scopeInstanceId !== null ? requireBuilding(input.projectId, scopeInstanceId) : undefined
  )

  await invalidateProjectPromptViewCache(input.projectId, session.organizationId)

  const after = await findBindingsForRole(input.projectId, role, scopeInstanceId)
  const binding = after.find((row) => row.documentId === input.documentId)
  if (!binding) {
    throw new Error('Document role was written but could not be read back.')
  }
  return { binding, replaced: reported }
}

async function keepVisible(
  projectId: string,
  replaced: DocumentRoleBinding[],
  reader: DocumentRoleReader
): Promise<DocumentRoleBinding[]> {
  if (replaced.length === 0) return replaced
  const visible = new Set((await listProjectDocumentRoles(projectId, reader)).map((row) => row.documentId))
  return replaced.filter((row) => visible.has(row.documentId))
}

export async function revokeDocumentRole(
  projectId: string,
  bindingId: string,
  session: AuthorizedSession
): Promise<void> {
  await requireProjectAccess(session, projectId, [...WRITE_PERMISSIONS])
  const visible = await listProjectDocumentRoles(projectId, await sessionRoleReader(session, projectId))
  const removed = visible.some((row) => row.id === bindingId) ? await deleteBindings(projectId, [bindingId]) : 0
  await invalidateProjectPromptViewCache(projectId, session.organizationId)
  if (removed === 0) throw new NotFoundError('Document role binding not found.')
}

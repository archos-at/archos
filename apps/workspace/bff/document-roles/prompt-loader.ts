import { findProjectProfile } from '@/lib/projects/repository'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import { documentRoleDefinition, recommendedRoles } from '@/lib/project-profile/document-roles'
import type { DocumentRole } from '@/lib/project-profile/document-roles'
import { getRestrictedFolderIds } from '@/lib/authz/folder-access'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { listProjectDocumentRoles } from './repository'
import type { DocumentRoleReader } from './repository'
import { buildDocumentRolesSection, missingSlots } from './prompt-section'
import type { RecommendedSlot } from './prompt-section'

async function readerFor(
  projectId: string,
  organizationId: string | null | undefined
): Promise<DocumentRoleReader> {
  if (!organizationId) return { unfiledOnly: true, documents: SCREENED_ONLY }
  return { hiddenFolderIds: await getRestrictedFolderIds(organizationId, projectId), documents: SCREENED_ONLY }
}

export function recommendedSlotsFor(profile: Awaited<ReturnType<typeof findProjectProfile>>): {
  recommended: RecommendedSlot[]
  buildingNames: Record<string, string>
} {
  const buildingNames: Record<string, string> = {}
  if (!profile) return { recommended: [], buildingNames }
  const { answers, buildings } = answersFromProfile(profile, projectIntakeDefinitionV1)
  const collected = new Map<string, RecommendedSlot>()
  const add = (role: DocumentRole, scopeInstanceId: string | null) => {
    collected.set(`${role}@${scopeInstanceId ?? ''}`, { role, scopeInstanceId })
  }
  for (const role of recommendedRoles(answers)) add(role, null)
  for (const building of buildings) {
    buildingNames[building.id] = building.name
    for (const role of recommendedRoles(answers, building.id)) {
      add(role, documentRoleDefinition(role).scope === 'building' ? building.id : null)
    }
  }
  return { recommended: [...collected.values()], buildingNames }
}

export interface MissingDocument {
  role: DocumentRole
  label: string
  buildingName: string | null
}

export async function loadMissingDocuments(
  projectId: string,
  organizationId: string | null | undefined
): Promise<MissingDocument[] | null> {
  try {
    const [bindings, profile] = await Promise.all([
      readerFor(projectId, organizationId).then((reader) => listProjectDocumentRoles(projectId, reader)),
      findProjectProfile(projectId, organizationId),
    ])
    const { recommended, buildingNames } = recommendedSlotsFor(profile)
    return missingSlots(bindings, recommended).map((slot) => ({
      role: slot.role,
      label: documentRoleDefinition(slot.role).label,
      buildingName: slot.scopeInstanceId ? (buildingNames[slot.scopeInstanceId] ?? null) : null,
    }))
  } catch {
    return null
  }
}

export async function loadDocumentRolesPromptSection(
  projectId: string,
  organizationId: string | null | undefined
): Promise<string> {
  try {
    const [bindings, profile] = await Promise.all([
      readerFor(projectId, organizationId).then((reader) => listProjectDocumentRoles(projectId, reader)),
      findProjectProfile(projectId, organizationId),
    ])

    const { recommended, buildingNames } = recommendedSlotsFor(profile)
    return buildDocumentRolesSection(bindings, recommended, buildingNames)
  } catch {
    return ''
  }
}

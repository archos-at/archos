import 'server-only'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { can } from '@/lib/authz/decide'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { UploadScreeningPolicy } from './policy'
import {
  EMPTY_PROJECT_OVERRIDE,
  applyProjectOverride,
  effectiveOverride,
  type ProjectScreeningOverride,
} from './project-policy'
import { saveProjectScreeningOverride } from './project-repository'
import {
  forgetProjectScreeningOverride,
  getProjectScreeningOverride,
  getUploadScreeningPolicy,
  hasSavedUploadScreeningPolicy,
} from './service'

export interface ProjectUploadScreening {
  policy: UploadScreeningPolicy
  office: UploadScreeningPolicy
  officeSuggested: boolean
  override: ProjectScreeningOverride
  canManage: boolean
}

async function viewOf(session: AuthorizedSession, projectId: string, closed: boolean): Promise<ProjectUploadScreening> {
  const [office, stored, saved, manage] = await Promise.all([
    getUploadScreeningPolicy(session.organizationId),
    getProjectScreeningOverride(session.organizationId, projectId),
    hasSavedUploadScreeningPolicy(session.organizationId),
    closed ? Promise.resolve(false) : can(session, 'project:manage', { type: 'project', id: projectId }),
  ])
  const override = effectiveOverride(office, stored ?? EMPTY_PROJECT_OVERRIDE)
  return {
    policy: applyProjectOverride(office, override),
    office,
    officeSuggested: !saved,
    override,
    canManage: manage && office.enabled,
  }
}

export async function getProjectUploadScreening(
  session: AuthorizedSession,
  projectId: string
): Promise<ProjectUploadScreening> {
  const access = await requireProjectAccess(session, projectId, 'project:view')
  return viewOf(session, projectId, access.closed)
}

export async function saveProjectUploadScreening(
  session: AuthorizedSession,
  projectId: string,
  input: ProjectScreeningOverride,
  request: Request
): Promise<ProjectUploadScreening> {
  await requireProjectAccess(session, projectId, 'project:manage')
  const office = await getUploadScreeningPolicy(session.organizationId)
  const override = effectiveOverride(office, input)
  await saveProjectScreeningOverride(session.organizationId, projectId, override, session.userId)
  await forgetProjectScreeningOverride(session.organizationId, projectId)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.upload_screening.updated',
    targetType: 'project',
    targetId: projectId,
    metadata: {
      addedNameTerms: override.addedNameTerms.length,
      removedNameTerms: override.removedNameTerms.length,
    },
    request,
  })
  return viewOf(session, projectId, false)
}

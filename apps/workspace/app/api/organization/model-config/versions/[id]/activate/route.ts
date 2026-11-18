import { apiRoute } from '@/lib/api/handler'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import type { OrgModelConfigVersion } from '@/lib/db/schema/org-model-config'
import { getAgentGroup } from '@/lib/model-config/agent-groups'
import { catalogUnavailableError, fetchZdrEndpoints, zdrRejection } from '@/lib/model-config/openrouter'
import { isZdrApplicableForOrg } from '@/lib/model-config/org-catalog'
import type { ModelRejection } from '@/lib/model-config/rejections'
import { activateVersion, versionModelsByGroup } from '@/lib/model-config/service'
import { isZdrOnlyForOrg } from '@/lib/organizations/service'
import { recordAuditEvent } from '@/lib/audit/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.modelConfiguration)
    if (gated) return gated
    const versionId = params.id === 'none' ? null : params.id
    if (versionId !== null && !/^[0-9a-f-]{36}$/i.test(versionId)) {
      throw new BadRequestError('Invalid version id')
    }
    const version = await activateVersion({
      organizationId: session.organizationId,
      versionId,
      actorUserId: session.userId,
      validate: (candidate) => requireZdrCompliantVersion(session.organizationId, candidate),
    })
    await recordAuditEvent({
      organizationId: session.organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'model_config.version.activated',
      targetType: 'model_config_version',
      targetId: versionId,
      metadata: versionId === null ? { reset: true } : { rollback: true },
      request,
    })
    return { activeVersion: version }
  },
  { authz: { permission: ORG_PERMISSIONS.modelsManage } }
)

async function requireZdrCompliantVersion(organizationId: string, version: OrgModelConfigVersion): Promise<void> {
  if (!(await isZdrOnlyForOrg(organizationId))) return
  if (!(await isZdrApplicableForOrg(organizationId))) return
  const zdr = await fetchZdrEndpoints().catch((error: unknown) => {
    console.error('[Model Config API] ZDR list unavailable for a rollback:', error)
    throw catalogUnavailableError(error)
  })
  const errors: Record<string, ModelRejection[]> = {}
  for (const [groupId, modelId] of Object.entries(versionModelsByGroup(version))) {
    const group = getAgentGroup(groupId)
    const rejection = group ? zdrRejection({ id: modelId }, group, zdr) : null
    if (rejection) errors[groupId] = [rejection]
  }
  if (Object.keys(errors).length > 0) {
    throw new UnprocessableError('This version selects models that zero data retention does not allow', errors)
  }
}

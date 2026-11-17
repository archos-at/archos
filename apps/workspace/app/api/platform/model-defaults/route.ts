import { NextResponse } from 'next/server'
import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { UnprocessableError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import {
  AGENT_GROUPS,
  getAgentGroup,
  isAgentGroupId,
} from '@/lib/model-config/agent-groups'
import { modelDefaultsPutSchema } from '@/lib/platform/platform-wire'
import { getWorkflowGroupDefaults, splitGroupDefault, type GroupDefaults } from '@/lib/model-config/backend-defaults'
import {
  catalogUnavailableError,
  fetchModelCatalog,
  fetchZdrEndpoints,
  hasZdrEndpoint,
  validateOverrides,
  type ZdrIndex,
} from '@/lib/model-config/openrouter'
import {
  listPlatformModelDefaults,
  savePlatformModelDefaults,
} from '@/lib/model-config/platform-defaults'
import { definedValues } from '@/lib/utils/defined-values'

export const GET = platformApiRoute(
  async () => {
    const [rows, workflowDefaults, zdr] = await Promise.all([
      listPlatformModelDefaults(),
      getWorkflowGroupDefaults(),
      zdrIndexOrNull(),
    ])

    const defaults = Object.fromEntries(
      rows.filter((row) => isAgentGroupId(row.agentGroup)).map((row) => [
        row.agentGroup,
        {
          model: row.model,
          note: row.note,
          updatedBy: row.updatedBy,
          updatedByEmail: row.updatedByEmail,
          updatedAt: row.updatedAt,
          zdrSafe: liveZdrSafe(row.model, row.agentGroup, zdr),
        },
      ])
    )

    return NextResponse.json({
      agentGroups: AGENT_GROUPS,
      defaults,
      workflowDefaults,
      workflowDefaultsZdrSafe: workflowZdrSafe(workflowDefaults, zdr),
    })
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const PUT = platformApiRoute(
  async ({ request, session }) => {
    const input = await parseJsonBody(request, modelDefaultsPutSchema)
    const flat = Object.fromEntries(
      Object.entries(definedValues(input.defaults)).map(([group, value]) => [group, value.model])
    )

    const [catalog, zdr] = await Promise.all([fetchModelCatalog(), fetchZdrEndpoints()]).catch((error: unknown) => {
      console.error('[Platform Model Defaults] Model catalog or ZDR list unavailable:', error)
      throw catalogUnavailableError(error)
    })
    const validation = validateOverrides(catalog, flat, true, zdr)
    if (!validation.ok) {
      throw new UnprocessableError('Model validation failed', validation.errors)
    }
    const rows = await savePlatformModelDefaults({
      defaults: flat,
      modelSnapshot: validation.snapshot,
      note: input.note ?? null,
      actorUserId: session.userId,
      actorEmail: session.email ?? null,
    })

    const platformOrgId = await getPlatformOrganizationId()
    if (platformOrgId) {
      await recordAuditEvent({
        organizationId: platformOrgId,
        actor: { userId: session.userId, email: session.email },
        action: 'platform.model_defaults.updated',
        targetType: 'platform_model_defaults',
        targetId: 'platform',
        metadata: flat,
        request,
      })
    } else {
      console.error(
        '[Platform Model Defaults] Fleet defaults were saved without an audit event: the platform organization did not resolve'
      )
    }

    return NextResponse.json({
      defaults: Object.fromEntries(
        rows.map((row) => [
          row.agentGroup,
          {
            model: row.model,
            note: row.note,
            updatedBy: row.updatedBy,
            updatedByEmail: row.updatedByEmail,
            updatedAt: row.updatedAt,
          },
        ])
      ),
    })
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

async function zdrIndexOrNull(): Promise<ZdrIndex | null> {
  try {
    return await fetchZdrEndpoints()
  } catch (error) {
    console.warn('[Platform Model Defaults] ZDR list unavailable; ZDR status unknown:', error)
    return null
  }
}

function liveZdrSafe(modelId: string, groupId: string, zdr: ZdrIndex | null): boolean | null {
  const group = getAgentGroup(groupId)
  if (!zdr || !group) return null
  return hasZdrEndpoint(modelId, zdr, group)
}

function workflowZdrSafe(workflowDefaults: GroupDefaults, zdr: ZdrIndex | null): Record<string, boolean | null> {
  return Object.fromEntries(
    Object.entries(workflowDefaults).map(([groupId, value]) => {
      const ids = splitGroupDefault(value)
      if (ids.length === 0) return [groupId, null]
      const verdicts = ids.map((id) => liveZdrSafe(id, groupId, zdr))
      return [groupId, verdicts.includes(null) ? null : verdicts.every(Boolean)]
    })
  )
}

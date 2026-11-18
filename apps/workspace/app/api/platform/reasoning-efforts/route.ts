import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { recordAuditEvent } from '@/lib/audit/service'
import { AGENT_GROUPS, isAgentGroupId } from '@/lib/model-config/agent-groups'
import { getWorkflowGroupReasoningEfforts } from '@/lib/model-config/backend-defaults'
import { reasoningEffortsPutSchema } from '@/lib/platform/platform-wire'
import {
  listPlatformReasoningEfforts,
  savePlatformReasoningEfforts,
} from '@/lib/reasoning-settings/service'
import { definedValues } from '@/lib/utils/defined-values'

export const GET = platformApiRoute(
  async () => {
    const [rows, workflowEfforts] = await Promise.all([
      listPlatformReasoningEfforts(),
      getWorkflowGroupReasoningEfforts(),
    ])

    const efforts = Object.fromEntries(
      rows.filter((row) => isAgentGroupId(row.agentGroup)).map((row) => [
        row.agentGroup,
        {
          effort: row.effort,
          note: row.note,
          updatedBy: row.updatedBy,
          updatedByEmail: row.updatedByEmail,
          updatedAt: row.updatedAt,
        },
      ])
    )

    return { agentGroups: AGENT_GROUPS, efforts, workflowEfforts }
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const PUT = platformApiRoute(
  async ({ request, session }) => {
    const input = await parseJsonBody(request, reasoningEffortsPutSchema)

    const rows = await savePlatformReasoningEfforts({
      efforts: definedValues(input.efforts),
      note: input.note ?? null,
      actorUserId: session.userId,
      actorEmail: session.email ?? null,
    })

    const platformOrgId = await getPlatformOrganizationId()
    if (platformOrgId) {
      await recordAuditEvent({
        organizationId: platformOrgId,
        actor: { userId: session.userId, email: session.email },
        action: 'platform.reasoning_efforts.updated',
        targetType: 'platform_reasoning_efforts',
        targetId: 'platform',
        metadata: input.efforts,
        request,
      })
    } else {
      console.error(
        '[Platform Reasoning] Fleet efforts were saved without an audit event: the platform organization did not resolve'
      )
    }

    return {
      efforts: Object.fromEntries(
        rows.map((row) => [
          row.agentGroup,
          {
            effort: row.effort,
            note: row.note,
            updatedBy: row.updatedBy,
            updatedByEmail: row.updatedByEmail,
            updatedAt: row.updatedAt,
          },
        ])
      ),
    }
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

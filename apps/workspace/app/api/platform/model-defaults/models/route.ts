import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getAgentGroup } from '@/lib/model-config/agent-groups'
import {
  catalogUnavailableError,
  fetchModelCatalog,
  fetchZdrEndpoints,
  searchModelsForGroup,
} from '@/lib/model-config/openrouter'

export const GET = platformApiRoute(
  async ({ request }) => {
    const url = new URL(request.url)
    const groupId = url.searchParams.get('group') ?? ''
    const query = url.searchParams.get('q') ?? ''
    const group = getAgentGroup(groupId)
    if (!group) {
      return NextResponse.json(
        { error: 'Unknown agent group', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const [catalog, zdr] = await Promise.all([fetchModelCatalog(), fetchZdrEndpoints()]).catch((error: unknown) => {
      console.error('[Platform Model Search] Model catalog or ZDR list unavailable:', error)
      throw catalogUnavailableError(error)
    })

    const models = searchModelsForGroup(catalog, groupId, query, 30, true, zdr)

    return NextResponse.json({ group: group.id, models })
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { resolveSkillsForAgent } from '@/lib/skills/service'
import { resolveQuerySchema } from '@/lib/skills/types'

export const GET = internalApiRoute(
  'Skill Resolve',
  async ({ request }) => {
    const { organization_id, agent } = parseQuery(request, resolveQuerySchema)
    return withTenant({ organizationId: organization_id }, () =>
      resolveSkillsForAgent(organization_id, agent ?? undefined)
    )
  },
  { tenancy: { fromPayload: 'the organization id from query.organization_id' } }
)

import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { getEffectiveModelOverrides } from '@/lib/model-config/service'
import { isZdrOnlyForOrg } from '@/lib/organizations/service'
import { getProcessingPolicy } from '@/lib/residency/processing-policy'

const querySchema = z.object({
  organizationId: z.string().regex(/^org_[A-Za-z0-9]+$/, 'not a WorkOS organization id'),
})

export const GET = internalApiRoute(
  'model-overrides',
  async ({ request }) => {
    const { organizationId } = parseQuery(request, querySchema)
    return withTenant({ organizationId }, async () => {
      const [overrides, zdrOnly, processingPolicy] = await Promise.all([
        getEffectiveModelOverrides(organizationId),
        isZdrOnlyForOrg(organizationId),
        getProcessingPolicy(organizationId).catch((error: unknown) => {
          console.error('[model-overrides] processing policy unreadable:', error)
          return null
        }),
      ])
      return { overrides, zdrOnly, processingPolicy }
    })
  },
  { tenancy: { fromPayload: '?organizationId' } }
)

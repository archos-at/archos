import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { chatScreeningFor } from '@/lib/upload-screening/service'

const querySchema = z.object({
  organizationId: z.string().min(1).max(128),
})

export const GET = internalApiRoute(
  'Internal Chat Screening',
  async ({ request }) => {
    const { organizationId } = parseQuery(request, querySchema)
    return withTenant({ organizationId }, () => chatScreeningFor(organizationId))
  },
  { tenancy: { fromPayload: '?organizationId' } }
)

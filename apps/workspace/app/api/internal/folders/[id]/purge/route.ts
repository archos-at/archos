import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { purgeBinnedFolder } from '@/lib/projects/folder-bin'

type Params = { id: string }

const purgeSchema = z.object({
  organizationId: z.string().min(1).max(128),
})

export const POST = internalApiRoute<Params>(
  'Internal Folder Purge',
  async ({ request, params }) => {
    const { organizationId } = await parseJsonBody(request, purgeSchema)
    const result = await withTenant({ organizationId }, () => purgeBinnedFolder(organizationId, params.id))
    return {
      status: result.status,
      counts: result.counts,
      traceConversationIds: result.traceConversationIds,
    }
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)

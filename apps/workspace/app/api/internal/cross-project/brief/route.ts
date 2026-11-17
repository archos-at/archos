import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { crossProjectCaller, readProjectBrief } from '@/lib/cross-project/service'
import { crossProjectBriefRequestSchema } from '@/lib/cross-project/types'
import { withTenant } from '@/lib/db/tenant-context'

export const POST = internalApiRoute(
  'cross-project-brief',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, crossProjectBriefRequestSchema)
    const session = await requirePinnedSession(context)
    const caller = crossProjectCaller(context, session, body.answerMessageId)
    return withTenant({ organizationId: context.organizationId }, () => readProjectBrief(caller, body))
  },
  { tenancy: { fromPayload: 'the signed request-context envelope' } }
)

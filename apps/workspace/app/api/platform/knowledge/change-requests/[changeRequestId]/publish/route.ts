import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { publishPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'
import { publishBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    publishPlatformChangeRequest(session, params.changeRequestId, await parseJsonBody(request, publishBodySchema)),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)

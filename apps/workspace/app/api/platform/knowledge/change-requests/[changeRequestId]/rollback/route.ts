import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { rollbackPlatformChangeRequest } from '@/lib/base-knowledge/platform/service'
import { rollbackBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    rollbackPlatformChangeRequest(session, params.changeRequestId, (await parseJsonBody(request, rollbackBodySchema)).reason),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)

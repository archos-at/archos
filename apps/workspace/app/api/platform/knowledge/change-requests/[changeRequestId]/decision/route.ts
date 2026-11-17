import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { decidePlatformChangeRequest } from '@/lib/base-knowledge/platform/service'
import { approvalBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    decidePlatformChangeRequest(session, params.changeRequestId, await parseJsonBody(request, approvalBodySchema)),
  { permission: PLATFORM_PERMISSIONS.knowledgeReview },
)

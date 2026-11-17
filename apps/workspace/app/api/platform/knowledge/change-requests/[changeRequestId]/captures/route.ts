import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { capturePlatformCitation } from '@/lib/base-knowledge/platform/onboarding'
import { captureBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => capturePlatformCitation(session, params.changeRequestId, await parseJsonBody(request, captureBodySchema))),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)

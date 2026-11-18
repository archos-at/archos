import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { proposePlatformRecords } from '@/lib/base-knowledge/platform/service'
import { proposeRecordsBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () =>
      proposePlatformRecords(
        session,
        params.changeRequestId,
        await parseJsonBody(request, proposeRecordsBodySchema),
        actingReaderIsAgent() ? 'agent' : 'person',
      ),
    ),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite },
)

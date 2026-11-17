import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { proposePlatformRecords } from '@/lib/base-knowledge/platform/service'
import { territoriesFromIso } from '@/lib/base-knowledge/platform/territory-import'
import { territoryImportBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      const body = await parseJsonBody(request, territoryImportBodySchema)
      return proposePlatformRecords(
        session,
        params.changeRequestId,
        { records: territoriesFromIso(body.rows, body.captureId), dryRun: body.dryRun },
        actingReaderIsAgent() ? 'agent' : 'person',
      )
    }),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite },
)

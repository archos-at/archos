import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { startGoldenRun } from '@/lib/base-knowledge/golden/run'
import { goldenRunBodySchema } from '@/lib/base-knowledge/wire/golden-case'

export const dynamic = 'force-dynamic'

export const POST = platformApiRoute(
  async ({ session, request }) => {
    const body = await parseJsonBody(request, goldenRunBodySchema)
    return asProblem(async () => startGoldenRun(session, body))
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)

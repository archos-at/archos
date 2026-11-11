import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { importCountryRelease } from '@/lib/base-knowledge/platform/release-transfer'
import { releaseImportBodySchema } from '@/lib/base-knowledge/platform/release-wire'

export const POST = platformApiRoute(
  async ({ session, request }) =>
    asProblem(async () =>
      importCountryRelease(session, await parseJsonBody(request, releaseImportBodySchema), actingReaderIsAgent() ? 'agent' : 'person'),
    ),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite },
)

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { getGoldenRun } from '@/lib/base-knowledge/golden/run'

export const dynamic = 'force-dynamic'

type Params = { runId: string }

export const GET = platformApiRoute<Params>(async ({ session, params }) => asProblem(async () => getGoldenRun(session, params.runId)), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})

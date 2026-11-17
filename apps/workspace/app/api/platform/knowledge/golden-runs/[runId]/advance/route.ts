/**
 * Step a golden run (ADR-0165 amendment): settle the asks that ended, ask the
 * next cases, and answer the run as it stands. Platform staff with
 * `platform:knowledge:write`; only the person who started the run steps it,
 * because its questions are asked as them.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { advanceGoldenRun } from '@/lib/base-knowledge/golden/run'
import { goldenRunAdvanceBodySchema } from '@/lib/base-knowledge/wire/golden-case'

export const dynamic = 'force-dynamic'

type Params = { runId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, request, params }) => {
    const { waitSeconds } = await parseJsonBody(request, goldenRunAdvanceBodySchema)
    return asProblem(async () => advanceGoldenRun(session, params.runId, waitSeconds))
  },
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite },
)

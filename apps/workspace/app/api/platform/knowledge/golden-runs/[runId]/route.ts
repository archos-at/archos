/**
 * Read a golden run (ADR-0165 amendment): every case with its state, its
 * verdict and its scores, and the run's medians. Platform staff with
 * `platform:settings:view`; a read, so anyone on the platform follows a run
 * another person started.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { getGoldenRun } from '@/lib/base-knowledge/golden/run'

export const dynamic = 'force-dynamic'

type Params = { runId: string }

export const GET = platformApiRoute<Params>(async ({ session, params }) => asProblem(async () => getGoldenRun(session, params.runId)), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})

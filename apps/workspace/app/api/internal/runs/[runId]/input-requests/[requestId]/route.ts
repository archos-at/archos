/**
 * INTERNAL service endpoint: a run reads one of its questions, and the answer
 * once a person gave one (ADR-0181). The worker holds no connection open to
 * learn it; it reads this on its own heartbeat. Identity is the run row, as for
 * the route that asks.
 */

import { internalApiRoute } from '@/lib/api/handler'
import { readInputRequestForRun } from '@/lib/runs/input-requests'

type Params = { runId: string; requestId: string }

export const GET = internalApiRoute<Params>(
  'Run Input Request',
  async ({ params }) => readInputRequestForRun(params.runId, params.requestId),
  {
    tenancy: {
      fromPayload:
        'the task_runs row named by params.runId: resolved under platform access, then entered as that run’s organization',
    },
  }
)

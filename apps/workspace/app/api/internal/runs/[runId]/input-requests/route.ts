/**
 * INTERNAL service endpoint: a run asks a person (ADR-0181).
 *
 * The worker posts the question here; the request is stored and the run's
 * ledger moves to `waiting`. Same identity rule as the ledger route beside it:
 * the run id is a path parameter and appears nowhere in the body, the
 * organization and the project are read off the `task_runs` row, and nothing
 * about the acting identity is taken from the request. No request-context
 * envelope for the same reason: this route acts as nobody, it files a question
 * under a run that already exists.
 */

import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { inputRequestCreateSchema } from '@/lib/runs/input-request-types'
import { askForInput } from '@/lib/runs/input-requests'

type Params = { runId: string }

export const POST = internalApiRoute<Params>(
  'Run Input Request',
  async ({ request, params }) => askForInput(params.runId, await parseJsonBody(request, inputRequestCreateSchema)),
  {
    tenancy: {
      fromPayload:
        'the task_runs row named by params.runId: resolved under platform access, then entered as that run’s organization. The body never names one',
    },
  }
)

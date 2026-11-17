import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { applyRunLedgerOp } from '@/lib/runs/service'
import { z } from 'zod'
import { modernizeRunLedger, runLedgerRequestSchema } from '@/lib/runs/run-ledger-types'

const requestSchema = z.preprocess(modernizeRunLedger, runLedgerRequestSchema)

type Params = { runId: string }

export const POST = internalApiRoute<Params>(
  'Run Ledger',
  async ({ request, params }) => {
    const op = await parseJsonBody(request, requestSchema)
    return applyRunLedgerOp(params.runId, op)
  },
  {
    tenancy: {
      fromPayload:
        'the task_runs row named by params.runId — resolved under platform access, then entered as that run’s organization. The body never names one',
    },
  },
)

import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { writeRunReport } from '@/lib/runs/service'

type Params = { backendJobId: string }

const runReportSchema = z.object({
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const POST = internalApiRoute<Params>(
  'Run Report',
  async ({ request, params }) => {
    const body = await parseJsonBody(request, runReportSchema)
    return writeRunReport(params.backendJobId, body)
  },
  {
    tenancy: {
      fromPayload:
        'the task_runs row named by params.backendJobId — resolved under platform access, then entered as that run’s organization. The body never names one',
    },
  },
)

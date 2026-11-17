import { z } from 'zod'
import { NotFoundError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { settleIntakeOutcome } from '@/lib/project-intake/service'
import { loadRunForOutcome, recordRunOutcome } from '@/lib/tasks/service'

type Params = { jobId: string }

const REPORT_MAX_CHARS = 400_000

const outcomeSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(['success', 'failure', 'interrupted']),
  error: z.string().max(2000).nullish(),
  report: z.string().max(REPORT_MAX_CHARS).nullish(),
  cards: z.array(z.unknown()).max(200).nullish(),
})


export const POST = internalApiRoute<Params>(
  'Job Outcome',
  async ({ request, params }) => {
    const { organizationId, status, error, report, cards } = await parseJsonBody(request, outcomeSchema)

    const run = await withPlatformAccess(
      'job outcome: the worker identifies a run by backend job id, before any organization is known',
      () => loadRunForOutcome(params.jobId)
    )
    if (!run) {
      const intake = await withTenant({ organizationId }, () => settleIntakeOutcome(organizationId, params.jobId, status))
      if (intake) return { intake: { projectId: intake.projectId, status: intake.status } }
    }
    if (!run || run.organizationId !== organizationId) throw new NotFoundError('Unknown job run')

    const outcome = { status, error: error ?? null, report: report ?? null, cards: cards ?? null }
    return withTenant({ organizationId: run.organizationId }, () => recordRunOutcome(run, outcome))
  },
  { tenancy: { fromPayload: 'the run named by params.jobId, cross-checked against body.organizationId' } }
)

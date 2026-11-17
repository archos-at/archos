import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { BATCH_STATUS_MAX_IDS } from '@/lib/documents/status-batch'
import { settlePushedIngestJobs } from '@/lib/documents/settle-push'

const settledPushSchema = z.object({
  job_ids: z.array(z.string().min(1).max(128)).min(1).max(BATCH_STATUS_MAX_IDS),
})

export const POST = internalApiRoute(
  'Ingest Settled',
  async ({ request }) => settlePushedIngestJobs((await parseJsonBody(request, settledPushSchema)).job_ids),
  {
    status: 202,
    tenancy: {
      crossTenant:
        'discovery only: finds the in-flight documents of the named ingest jobs in every organization; each ' +
        "organization's rows are reconciled inside withTenant for that organization, so every write is subject " +
        'to row-level security',
    },
  }
)

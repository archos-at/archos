/**
 * INTERNAL — the settle push. The ingest worker calls this when a job reaches a
 * terminal status (`agent.common.bff_http`, `X-Internal-Token`), so its
 * documents are settled at once rather than when somebody next reads a list
 * (`lib/documents/settle-push.ts`). It runs the existing reconcile for exactly
 * those documents, which still asks the backend what each job did: the body
 * names jobs, it is never taken as their outcome.
 *
 * `202 { settled }`, the rows that came to rest. A job id no in-flight row
 * carries is ignored, so a repeated push, a job of a document since deleted, or
 * one a read settled first is not an error. Best effort for the caller: the
 * upload sweep stays the fallback.
 *
 * Service-to-service only: `INTERNAL_API_TOKEN` via `internalApiRoute`,
 * fail-closed when unconfigured. Not an agent capability: internal routes are a
 * service's door, outside the person-facing catalog (`agent-reachability.spec.ts`).
 */

import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { BATCH_STATUS_MAX_IDS } from '@/lib/documents/status-batch'
import { settlePushedIngestJobs } from '@/lib/documents/settle-push'

/** As many ids as one backend batch-status call answers, so one push is one status lookup. */
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

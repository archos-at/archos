import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { storePermitRecord } from '@/lib/permits/service'
import { storePermitRecordRequestSchema } from '@/lib/permits/types'

export const POST = internalApiRoute(
  'permit-records',
  async ({ request }) => storePermitRecord(await parseJsonBody(request, storePermitRecordRequestSchema)),
  { tenancy: { fromPayload: 'body.organizationId, the org the ingest was dispatched for' } }
)

import { internalApiRoute } from '@/lib/api/handler'
import { MAX_SWEEP_WINDOW_DAYS, sweepUploadBatches } from '@/lib/upload-batches/sweep'

const windowMsOf = (request: Request): number | undefined => {
  const days = Number(new URL(request.url).searchParams.get('windowDays'))
  return Number.isInteger(days) && days > 0 ? Math.min(days, MAX_SWEEP_WINDOW_DAYS) * 24 * 60 * 60_000 : undefined
}

export const POST = internalApiRoute('Upload Sweep', ({ request }) => sweepUploadBatches(new Date(), windowMsOf(request)), {
  tenancy: {
    crossTenant:
      'discovery only: lists the open upload batches and the quarantine decisions owed to the audit trail of ' +
      'every organization; each batch is sealed, reconciled and settled, and each decision marked audited, ' +
      'inside withTenant for its own organization, so those writes are subject to row-level security. The one ' +
      'cross-tenant write is the retention: deleting the decisions the trail has, or older than a week',
  },
})

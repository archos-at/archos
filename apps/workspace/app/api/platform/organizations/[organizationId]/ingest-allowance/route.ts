import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { ingestAllowancePutSchema } from '@/lib/budgets/ingest-allowance-contract'
import { savePlatformIngestAllowance } from '@/lib/budgets/platform-service'

interface Params {
  organizationId: string
}

export const PUT = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    savePlatformIngestAllowance(
      session,
      params.organizationId,
      await parseJsonBody(request, ingestAllowancePutSchema),
      request,
    ),
  { permission: PLATFORM_PERMISSIONS.organizationsManage },
)

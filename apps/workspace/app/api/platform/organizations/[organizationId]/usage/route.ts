import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrgUsage } from '@/lib/budgets/platform-service'

interface Params {
  organizationId: string
}

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => getPlatformOrgUsage(session, params.organizationId),
  { permission: PLATFORM_PERMISSIONS.usageView },
)

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { storageQuotaPutSchema } from '@/lib/storage/contract'
import { getOrganizationStorage, setStorageQuota } from '@/lib/storage/service'

interface Params {
  organizationId: string
}

export const GET = platformApiRoute<Params>(
  async ({ params }) => getOrganizationStorage(params.organizationId),
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)

export const PUT = platformApiRoute<Params>(
  async ({ session, request, params }) => {
    const { quotaBytes } = await parseJsonBody(request, storageQuotaPutSchema)
    return setStorageQuota(session, params.organizationId, quotaBytes, request)
  },
  { permission: PLATFORM_PERMISSIONS.organizationsManage }
)

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { uploadLimitPutSchema } from '@/lib/storage/contract'
import { setMaxUploadFileBytes } from '@/lib/storage/upload-limit'

interface Params {
  organizationId: string
}

export const PUT = platformApiRoute<Params>(
  async ({ session, request, params }) => {
    const { maxUploadFileBytes } = await parseJsonBody(request, uploadLimitPutSchema)
    return setMaxUploadFileBytes(session, params.organizationId, maxUploadFileBytes, request)
  },
  { permission: PLATFORM_PERMISSIONS.organizationsManage }
)

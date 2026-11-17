import { apiRoute } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { releaseHold } from '@/lib/compliance/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => releaseHold(session, params.id, request),
  { authz: { permission: ORG_PERMISSIONS.complianceManage } }
)

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { createHoldSchema } from '@/lib/compliance/hold-wire'
import { createHold, listOpenHolds } from '@/lib/compliance/service'

export const GET = apiRoute(async ({ session }) => listOpenHolds(session), {
  authz: { permission: ORG_PERMISSIONS.complianceManage },
})

export const POST = apiRoute(
  async ({ session, request }) =>
    createHold(session, await parseJsonBody(request, createHoldSchema), request),
  { status: 201, authz: { permission: ORG_PERMISSIONS.complianceManage } }
)

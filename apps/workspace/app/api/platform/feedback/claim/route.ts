import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { claimProductFeedbackTicket } from '@/lib/product-feedback/service'
import { claimProductFeedbackSchema } from '@/lib/product-feedback/types'

export const POST = platformApiRoute(
  async ({ session, request }) => {
    const { ticketId } = await parseJsonBody(request, claimProductFeedbackSchema)
    return claimProductFeedbackTicket(session, ticketId)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

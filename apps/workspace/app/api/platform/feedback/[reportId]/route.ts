import { z } from 'zod'
import { NotFoundError } from '@/lib/api/errors'
import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import {
  getProductFeedbackForPlatform,
  triageProductFeedback,
} from '@/lib/product-feedback/service'
import { triageProductFeedbackSchema } from '@/lib/product-feedback/types'

type Params = { reportId?: string | string[] }

function parseReportId(params: Params): string {
  const parsed = z.guid().safeParse(params.reportId)
  if (!parsed.success) throw new NotFoundError('Unknown feedback report.')
  return parsed.data
}

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => {
    return getProductFeedbackForPlatform(session, parseReportId(params))
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const PATCH = platformApiRoute<Params>(
  async ({ session, request, params }) => {
    const { status } = await parseJsonBody(request, triageProductFeedbackSchema)
    return triageProductFeedback(session, parseReportId(params), status)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

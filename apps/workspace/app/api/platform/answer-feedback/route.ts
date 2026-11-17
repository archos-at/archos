import { ForbiddenError } from '@/lib/api/errors'
import { apiRoute } from '@/lib/api/handler'
import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import { getAnswerFeedbackHealth } from '@/lib/feedback/service'
import { requireFeedbackQuery } from '@/lib/feedback/query'

export const GET = apiRoute(
  async ({ request, session }) => {
    const query = requireFeedbackQuery(new URL(request.url).searchParams)
    try {
      return await getAnswerFeedbackHealth(session, query)
    } catch (error) {
      if (error instanceof PlatformAccessDeniedError) throw new ForbiddenError()
      throw error
    }
  },
  {
    authz: {
      enforcedBy: 'getAnswerFeedbackHealth (requirePlatformPermission platform:organizations:view)',
    },
  }
)

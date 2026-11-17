import { NextResponse } from 'next/server'
import { ForbiddenError } from '@/lib/api/errors'
import { apiRoute } from '@/lib/api/handler'
import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import { requireFeedbackQuery } from '@/lib/feedback/query'
import { getAnswerFeedbackFilterOptions } from '@/lib/feedback/export-service'

export const GET = apiRoute(
  async ({ request, session }) => {
    const query = requireFeedbackQuery(new URL(request.url).searchParams)
    try {
      const options = await getAnswerFeedbackFilterOptions(session, query)
      return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof PlatformAccessDeniedError) throw new ForbiddenError()
      throw error
    }
  },
  {
    authz: {
      enforcedBy: 'getAnswerFeedbackFilterOptions (requirePlatformPermission platform:organizations:view)',
    },
  }
)

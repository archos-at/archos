import { NextResponse } from 'next/server'
import { ForbiddenError } from '@/lib/api/errors'
import { apiRoute } from '@/lib/api/handler'
import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import { getAnswerFeedbackDigest } from '@/lib/feedback/service'
import { requireFeedbackQuery } from '@/lib/feedback/query'

export const GET = apiRoute(
  async ({ request, session }) => {
    const params = new URL(request.url).searchParams
    const query = requireFeedbackQuery(params)
    try {
      const result = await getAnswerFeedbackDigest(session, query, {
        locale: params.get('locale') ?? 'de',
        refresh: params.get('refresh') === '1',
      })

      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof PlatformAccessDeniedError) throw new ForbiddenError()
      throw error
    }
  },
  {
    authz: {
      enforcedBy: 'getAnswerFeedbackDigest (requirePlatformPermission platform:organizations:view)',
    },
  }
)

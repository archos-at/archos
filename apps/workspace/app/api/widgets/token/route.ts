import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/api/handler'
import { mintWidgetToken } from '@/lib/workos/widget-token-service'

export const GET = apiRoute(
  async ({ session, request }) => {
    const url = new URL(request.url)
    const { token } = await mintWidgetToken(
      session,
      url.searchParams.getAll('scope'),
      url.searchParams.get('org') === 'platform'
    )

    return NextResponse.json(
      { token },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  },
  { authz: { enforcedBy: 'mintWidgetToken (drops every scope the caller does not hold)' } }
)

import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { listProfiledConversations } from '@/lib/profiler/service'
import { parseQualityScopeStrict } from '@/lib/quality/scope'

export const GET = platformApiRoute(
  async ({ request }) => {
    const params = new URL(request.url).searchParams
    const parsed = parseQualityScopeStrict(params)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Invalid scope', code: 'BAD_REQUEST', details: { scope: parsed.error } },
        { status: 400 }
      )
    }
    const result = await listProfiledConversations(parsed.scope, {
      query: params.get('q')?.trim() || undefined,
      conversationId: params.get('conversation')?.trim() || undefined,
    })
    return NextResponse.json(result)
  },
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)

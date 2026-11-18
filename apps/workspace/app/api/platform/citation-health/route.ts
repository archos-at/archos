import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getCitationHealth } from '@/lib/citations/service'
import { parseQualityScopeStrict } from '@/lib/quality/scope'

export const GET = platformApiRoute(
  async ({ request }) => {
    const parsed = parseQualityScopeStrict(new URL(request.url).searchParams)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Invalid scope', code: 'BAD_REQUEST', details: { scope: parsed.error } },
        { status: 400 }
      )
    }
    const snapshot = await getCitationHealth(parsed.scope)
    return NextResponse.json(snapshot)
  },
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)

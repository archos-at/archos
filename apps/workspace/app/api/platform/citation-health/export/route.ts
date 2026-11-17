import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getCitationExport } from '@/lib/citations/service'
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
    const bundle = await getCitationExport(parsed.scope)

    const fileName = `citation-health-${bundle.scope.from}-to-${bundle.scope.to}.json`
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  },
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)

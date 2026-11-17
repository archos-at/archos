import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { generateAuditPortalLink, trustedAppOrigin } from '@/lib/audit/service'

export const POST = platformApiRoute(
  async ({ request }) => {
    const platformOrgId = await getPlatformOrganizationId()
    if (!platformOrgId) {
      return NextResponse.json({ error: 'platform-org-missing' }, { status: 404 })
    }
    const returnUrl = `${trustedAppOrigin(request)}/app/platform`
    try {
      const link = await generateAuditPortalLink(platformOrgId, returnUrl)
      return NextResponse.json({ link })
    } catch (error) {
      console.error('[Platform Audit Portal] WorkOS link generation failed:', error)
      return NextResponse.json({ error: 'portal-unavailable' }, { status: 502 })
    }
  },
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)

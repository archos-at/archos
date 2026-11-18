import { apiRoute } from '@/lib/api/handler'
import { UpstreamError } from '@/lib/api/errors'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { generateAuditPortalLink, trustedAppOrigin } from '@/lib/audit/service'

export const POST = apiRoute(
  async ({ session, request }) => {
    const returnUrl = `${trustedAppOrigin(request)}/app/organization`
    try {
      return { link: await generateAuditPortalLink(session.organizationId, returnUrl) }
    } catch (error) {
      console.error('[Audit Portal] WorkOS link generation failed:', error)
      throw new UpstreamError('portal-unavailable')
    }
  },
  { authz: { permission: ORG_PERMISSIONS.auditView } }
)

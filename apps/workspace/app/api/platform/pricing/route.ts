import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { parseJsonBody } from '@/lib/api/handler'
import { recordAuditEvent } from '@/lib/audit/service'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { invalidateSeededLimits } from '@/lib/budgets/service'
import { pricingPutSchema } from '@/lib/platform/platform-wire'
import { getPricingView, PRICING_BOUNDS, REFERENCE_REQUEST, savePricing } from '@/lib/pricing/service'

export const GET = platformApiRoute(
  async () => {
    const pricing = await getPricingView()
    return NextResponse.json({ pricing, bounds: PRICING_BOUNDS, referenceRequest: REFERENCE_REQUEST })
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const PUT = platformApiRoute(
  async ({ request, session }) => {
    const input = await parseJsonBody(request, pricingPutSchema)

    const version = await savePricing({
      marginMultiplier: input.marginMultiplier,
      usdPerCredit: input.usdPerCredit,
      defaultOrgDailyCredits: input.defaultOrgDailyCredits,
      defaultOrgMonthlyCredits: input.defaultOrgMonthlyCredits,
      note: input.note ?? null,
      actorUserId: session.userId,
      actorEmail: session.email ?? null,
    })
    await invalidateSeededLimits()

    const platformOrgId = await getPlatformOrganizationId()
    if (platformOrgId) {
      await recordAuditEvent({
        organizationId: platformOrgId,
        actor: { userId: session.userId, email: session.email },
        action: 'platform.pricing.updated',
        targetType: 'platform_pricing_version',
        targetId: version.id,
        metadata: {
          marginMultiplier: input.marginMultiplier,
          usdPerCredit: input.usdPerCredit,
          defaultOrgDailyCredits: input.defaultOrgDailyCredits,
          defaultOrgMonthlyCredits: input.defaultOrgMonthlyCredits,
          supersedesId: version.supersedesId,
          note: input.note ?? null,
        },
        request,
      })
    } else {
      console.error(
        '[Platform Pricing] Pricing was saved without an audit event: the platform organization did not resolve'
      )
    }

    return NextResponse.json({ pricing: await getPricingView() })
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { isZdrApplicableForOrg } from '@/lib/model-config/org-catalog'
import { getZdrCoverage, UNKNOWN_COVERAGE, type ZdrCoverage } from '@/lib/model-config/zdr-coverage'
import { zdrPutSchema } from '@/lib/organizations/organization-wire'
import { setOrgZdrOnly } from '@/lib/organizations/service'

export const PUT = apiRoute(
  async ({ session, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.modelConfiguration)
    if (gated) return gated
    const { enabled } = await parseJsonBody(request, zdrPutSchema)
    const { zdrOnly } = await setOrgZdrOnly(session, enabled, request)
    return { zdrOnly, ...(await describeAfterSave(session.organizationId, zdrOnly)) }
  },
  { authz: { permission: ORG_PERMISSIONS.modelsManage } }
)

async function describeAfterSave(
  organizationId: string,
  zdrOnly: boolean
): Promise<{ zdrApplicable: boolean | null; zdrCoverage: ZdrCoverage | null }> {
  const [applicable, coverage] = await Promise.allSettled([
    isZdrApplicableForOrg(organizationId),
    zdrOnly ? getZdrCoverage(organizationId) : Promise.resolve(null),
  ])
  const zdrApplicable = applicable.status === 'fulfilled' ? applicable.value : null
  if (applicable.status === 'rejected') {
    console.warn('[Model Config API] ZDR saved; could not resolve whether it applies:', applicable.reason)
  }
  if (coverage.status === 'rejected') {
    console.warn('[Model Config API] ZDR saved; could not compute its coverage:', coverage.reason)
  }
  if (!zdrOnly || zdrApplicable === false) return { zdrApplicable, zdrCoverage: null }
  return {
    zdrApplicable,
    zdrCoverage: coverage.status === 'fulfilled' ? coverage.value : UNKNOWN_COVERAGE,
  }
}

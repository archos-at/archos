import { apiRoute, parseQuery } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { getAgentGroup } from '@/lib/model-config/agent-groups'
import {
  catalogUnavailableError,
  fetchZdrEndpoints,
  hasZdrEndpoint,
  searchModelsForGroup,
  type ZdrIndex,
} from '@/lib/model-config/openrouter'
import { getCatalogForOrg } from '@/lib/model-config/org-catalog'
import { isZdrOnlyForOrg } from '@/lib/organizations/service'
import { estimateCreditsPerRequest, getEffectivePricing } from '@/lib/pricing/service'
import { modelSearchQuerySchema } from '@/lib/organizations/organization-wire'
import { getOrgBudgetUnit } from '@/lib/budgets/service'

export const GET = apiRoute(
  async ({ session, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.modelConfiguration)
    if (gated) return gated
    const { group: groupId, q: query } = parseQuery(request, modelSearchQuerySchema)
    const group = getAgentGroup(groupId)
    if (!group) {
      throw new BadRequestError('Unknown agent group')
    }

    const [zdrOnly, pricing, unit] = await Promise.all([
      isZdrOnlyForOrg(session.organizationId),
      getEffectivePricing(),
      getOrgBudgetUnit(session.organizationId),
    ])
    let catalog
    try {
      catalog = await getCatalogForOrg(session.organizationId, { zdrOnly })
    } catch (error) {
      console.error('[Model Search API] Model catalog unavailable:', error)
      throw catalogUnavailableError(error)
    }
    const marking = catalog.zdr ?? (catalog.zdrApplicable ? await zdrIndexForMarking() : null)
    return {
      group: group.id,
      catalogSource: {
        source: catalog.source,
        provider: catalog.provider,
        validation: catalog.validation,
        zdrOnly: catalog.zdrOnly,
        zdrApplicable: catalog.zdrApplicable,
      },
      models: searchModelsForGroup(catalog.models, groupId, query, 30, catalog.validation === 'full', catalog.zdr).map(
        ({ id, name, contextLength, promptPrice, completionPrice }) => ({
          id,
          name,
          contextLength,
          zdrSafe: marking ? hasZdrEndpoint(id, marking, group) : null,
          creditsPerRequest:
            unit === 'credit' ? estimateCreditsPerRequest({ promptPrice, completionPrice }, pricing) : null,
        })
      ),
    }
  },
  { authz: { permission: ORG_PERMISSIONS.modelsManage } }
)

async function zdrIndexForMarking(): Promise<ZdrIndex | null> {
  try {
    return await fetchZdrEndpoints()
  } catch (error) {
    console.warn('[Model Search API] ZDR list unavailable; models are shown unmarked:', error)
    return null
  }
}

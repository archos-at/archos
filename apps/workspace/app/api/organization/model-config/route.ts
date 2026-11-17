import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { UnprocessableError } from '@/lib/api/errors'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { AGENT_GROUPS, isAgentGroupId } from '@/lib/model-config/agent-groups'
import { getGroupDefaults } from '@/lib/model-config/backend-defaults'
import { catalogUnavailableError, validateOverrides } from '@/lib/model-config/openrouter'
import { getCatalogForOrg, isZdrApplicableForOrg } from '@/lib/model-config/org-catalog'
import { getZdrCoverage, UNKNOWN_COVERAGE } from '@/lib/model-config/zdr-coverage'
import { createAndActivateVersion, getOrgModelConfig } from '@/lib/model-config/service'
import { isZdrOnlyForOrg } from '@/lib/organizations/service'
import { modelConfigPutSchema } from '@/lib/organizations/organization-wire'
import { recordAuditEvent } from '@/lib/audit/service'
import { definedValues } from '@/lib/utils/defined-values'

export const GET = apiRoute(
  async ({ session }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.modelConfiguration)
    if (gated) return gated
    const [config, defaults, zdrOnly] = await Promise.all([
      getOrgModelConfig(session.organizationId),
      getGroupDefaults(),
      isZdrOnlyForOrg(session.organizationId),
    ])
    const [catalog, applicable, coverage] = await Promise.allSettled([
      getCatalogForOrg(session.organizationId),
      isZdrApplicableForOrg(session.organizationId),
      zdrOnly ? getZdrCoverage(session.organizationId) : Promise.resolve(null),
    ])
    for (const failed of [catalog, applicable, coverage]) {
      if (failed.status === 'rejected') {
        console.warn('[Model Config API] Part of the model configuration is unknown:', failed.reason)
      }
    }
    const catalogSource =
      catalog.status === 'fulfilled'
        ? { source: catalog.value.source, provider: catalog.value.provider, validation: catalog.value.validation }
        : null
    const zdrApplicable = applicable.status === 'fulfilled' ? applicable.value : null
    const zdrCoverage =
      !zdrOnly || zdrApplicable === false
        ? null
        : coverage.status === 'fulfilled'
          ? coverage.value
          : UNKNOWN_COVERAGE
    return {
      agentGroups: AGENT_GROUPS,
      defaults,
      catalogSource,
      zdrOnly,
      zdrApplicable,
      zdrCoverage,
      activeVersion: withoutRetiredGroups(config.activeVersion),
      updatedBy: config.updatedBy,
      updatedAt: config.updatedAt,
    }
  },
  { authz: { permission: ORG_PERMISSIONS.modelsManage } }
)

export const PUT = apiRoute(
  async ({ session, request }) => {
    const gated = requireFeature(session, FEATURE_FLAGS.modelConfiguration)
    if (gated) return gated

    const input = await parseJsonBody(request, modelConfigPutSchema)

    const zdrOnly = await isZdrOnlyForOrg(session.organizationId)
    let catalog
    try {
      catalog = await getCatalogForOrg(session.organizationId, { zdrOnly })
    } catch (error) {
      console.error('[Model Config API] Model catalog unavailable:', error)
      throw catalogUnavailableError(error)
    }
    const overrides = definedValues(input.overrides)
    const flat = Object.fromEntries(Object.entries(overrides).map(([g, v]) => [g, v.model]))
    const validation = validateOverrides(catalog.models, flat, catalog.validation === 'full', catalog.zdr)
    if (!validation.ok) {
      throw new UnprocessableError('Model validation failed', validation.errors)
    }

    const version = await createAndActivateVersion({
      organizationId: session.organizationId,
      overrides,
      modelSnapshot: {
        ...validation.snapshot,
        _catalog: {
          source: catalog.source,
          provider: catalog.provider,
          validation: catalog.validation,
          zdrOnly: catalog.zdrOnly,
        },
      },
      comment: input.comment ?? null,
      actorUserId: session.userId,
    })
    await recordAuditEvent({
      organizationId: session.organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'model_config.version.activated',
      targetType: 'model_config_version',
      targetId: version.id,
      metadata: flat,
      request,
    })
    return { activeVersion: version }
  },
  { status: 201, authz: { permission: ORG_PERMISSIONS.modelsManage } }
)

function withoutRetiredGroups<T extends { overrides: unknown }>(version: T | null): T | null {
  if (!version || !version.overrides || typeof version.overrides !== 'object') return version
  const overrides = Object.fromEntries(
    Object.entries(version.overrides as Record<string, unknown>).filter(([group]) => isAgentGroupId(group))
  )
  return { ...version, overrides }
}

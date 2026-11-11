/**
 * Internal model-override resolution (ADR-0014).
 *
 * Called just-in-time by the Python backend for invocations whose request
 * context carries no `x-grid-model-overrides` header — endpoints the BFF does
 * not front (direct HTTP), or turns where the best-effort WebSocket-scope
 * injection failed. Guarded by `INTERNAL_API_TOKEN`, same as the BYOK
 * credential route.
 *
 * `overrides` is the EFFECTIVE selection: the platform-owner defaults
 * (`platform_model_defaults`) with the org's own choices layered on top. It is
 * `null` only when neither layer has anything to say — then the workflow YAML
 * models apply. `zdrOnly` is the org's EFFECTIVE zero-data-retention policy, a
 * boolean the backend uses to add `provider.zdr` to its OpenRouter requests: true
 * unless the org explicitly opted out (`isZdrOnlyForOrg`), so an org that never
 * touched the switch is reported as ZDR, not as an absent field. Both reuse
 * write-invalidated caches, so a config save/toggle — by the tenant OR by the
 * platform owner — is visible on the next backend fetch. `processingPolicy` is
 * the org's residency cell and allowed purposes (ADR-0167,
 * `bff/residency/processing-policy.ts`), read uncached: two primary-key reads
 * the backend itself caches per org.
 */

import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { getEffectiveModelOverrides } from '@/lib/model-config/service'
import { isZdrOnlyForOrg } from '@/lib/organizations/service'
import { getProcessingPolicy } from '@/lib/residency/processing-policy'

const querySchema = z.object({
  organizationId: z.string().regex(/^org_[A-Za-z0-9]+$/, 'not a WorkOS organization id'),
})

export const GET = internalApiRoute(
  'model-overrides',
  async ({ request }) => {
    const { organizationId } = parseQuery(request, querySchema)
    // Reads the org's own configuration plus the platform defaults, which every
    // tenant is allowed to read but none may write.
    return withTenant({ organizationId }, async () => {
      const [overrides, zdrOnly, processingPolicy] = await Promise.all([
        getEffectiveModelOverrides(organizationId),
        isZdrOnlyForOrg(organizationId),
        // Never the whole answer's failure: without it the backend reads the policy as unreadable (the
        // service alone, and refused inside a residency cell), and still gets the overrides and the ZDR bit.
        getProcessingPolicy(organizationId).catch((error: unknown) => {
          console.error('[model-overrides] processing policy unreadable:', error)
          return null
        }),
      ])
      return { overrides, zdrOnly, processingPolicy }
    })
  },
  { tenancy: { fromPayload: '?organizationId' } }
)

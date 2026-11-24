import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { enabledPostAnswerStages, isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { featureEntitlement } from '@/lib/turns/feature-entitlement'

const querySchema = z.object({
  organizationId: z
    .string()
    .regex(/^org_[A-Za-z0-9]+$/, 'not a WorkOS organization id')
    .optional(),
  projectId: z.guid().optional(),
})

export const GET = internalApiRoute(
  'post-answer-stages',
  async ({ request }) => {
    const { organizationId, projectId } = parseQuery(request, querySchema)
    const [enabled, entitlement, folderCards, licensedSeam] = await Promise.all([
      enabledPostAnswerStages(organizationId),
      featureEntitlement(organizationId, projectId),
      isOrgFeatureEnabled(FEATURE_FLAGS.folderCards, organizationId),
      isOrgFeatureEnabled(FEATURE_FLAGS.licensedSeam, organizationId),
    ])
    return {
      enabled,
      features: {
        deepResearch: entitlement.deepResearch,
        tasks: entitlement.tasks,
        folderCards,
        licensedSeam,
        timeEditions: true,
      },
    }
  },
  { tenancy: { fromPayload: '?organizationId' } }
)

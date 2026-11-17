import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import {
  enabledPostAnswerStages,
  isOrgFeatureEnabled,
  isDeepResearchEnabledForOrg,
  isTaskAutomationEnabledForOrg,
} from '@/lib/workos/feature-flags'
import { findProjectTenancy } from '@/lib/projects/repository'
import { isProjectClosed } from '@/lib/projects/project-status'

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
    const [enabled, deepResearch, tasks, folderCards, licensedSeam, project] = await Promise.all([
      enabledPostAnswerStages(organizationId),
      isDeepResearchEnabledForOrg(organizationId),
      isTaskAutomationEnabledForOrg(organizationId),
      isOrgFeatureEnabled(FEATURE_FLAGS.folderCards, organizationId),
      isOrgFeatureEnabled(FEATURE_FLAGS.licensedSeam, organizationId),
      projectId ? findProjectTenancy(projectId) : Promise.resolve(null),
    ])
    const closed =
      project !== null && project.organizationId === organizationId && isProjectClosed(project)
    return {
      enabled,
      features: {
        deepResearch: deepResearch && !closed,
        tasks: tasks && !closed,
        folderCards,
        licensedSeam,
        timeEditions: true,
      },
    }
  },
  { tenancy: { fromPayload: '?organizationId' } }
)

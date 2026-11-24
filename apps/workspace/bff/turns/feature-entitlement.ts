import 'server-only'
import { isDeepResearchEnabledForOrg, isTaskAutomationEnabledForOrg } from '@/lib/workos/feature-flags'
import { findProjectTenancy } from '@/lib/projects/repository'
import { isProjectClosed } from '@/lib/projects/project-status'

export interface FeatureEntitlement {
  deepResearch: boolean
  tasks: boolean
}

export async function featureEntitlement(
  organizationId: string | undefined,
  projectId: string | null | undefined,
): Promise<FeatureEntitlement> {
  const [deepResearch, tasks, project] = await Promise.all([
    isDeepResearchEnabledForOrg(organizationId),
    isTaskAutomationEnabledForOrg(organizationId),
    projectId ? findProjectTenancy(projectId) : Promise.resolve(null),
  ])
  const closed = project !== null && project.organizationId === organizationId && isProjectClosed(project)
  return { deepResearch: deepResearch && !closed, tasks: tasks && !closed }
}

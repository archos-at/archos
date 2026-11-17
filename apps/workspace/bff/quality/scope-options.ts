import 'server-only'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'
import { scopeBounds, type QualityScope } from './scope'
import { listActiveOrganizationIds, listScopeProjects } from './scope-options-repository'

export interface QualityScopeOrganizationOption {
  id: string
  name: string | null
}

export interface QualityScopeProjectOption {
  id: string
  name: string
  organizationId: string
}

export interface QualityScopeOptions {
  organizations: QualityScopeOrganizationOption[]
  organizationsTruncated: boolean
  projects: QualityScopeProjectOption[]
  projectsTruncated: boolean
}

export async function getQualityScopeOptions(scope: QualityScope): Promise<QualityScopeOptions> {
  const { start, endExclusive } = scopeBounds(scope)
  const [active, projects] = await Promise.all([
    listActiveOrganizationIds(start, endExclusive),
    listScopeProjects(scope.organizationIds, scope.projectIds),
  ])
  const ids = [...new Set([...scope.organizationIds, ...active.ids])]
  const names = await getOrganizationDisplayNames(ids)
  const organizations = ids
    .map((id) => ({ id, name: names.get(id) ?? null }))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, 'de'))
  return {
    organizations,
    organizationsTruncated: active.truncated,
    projects: projects.projects,
    projectsTruncated: projects.truncated,
  }
}

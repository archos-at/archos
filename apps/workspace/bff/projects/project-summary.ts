import type { Project } from '@/lib/db/schema/projects'
import type { ListProjectsQuery, ProjectSummary } from './project-wire'
import { projectFactText, projectSiteAddress } from './site-address'

export function toProjectSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    projectName: projectFactText(project, 'project_name'),
    siteAddress: projectSiteAddress(project),
    createdAt: project.createdAt,
    pausedAt: project.pausedAt,
    closedAt: project.closedAt,
  }
}

export function projectsView(projects: Project[], query: ListProjectsQuery): ProjectSummary[] | Project[] {
  const wanted = query.nameContains?.toLowerCase()
  const matching = projects.filter((project) => {
    if (!wanted) return true
    const summary = toProjectSummary(project)
    return [summary.name, summary.projectName].some((name) => name?.toLowerCase().includes(wanted))
  })
  return query.view === 'full' ? matching : matching.map(toProjectSummary)
}

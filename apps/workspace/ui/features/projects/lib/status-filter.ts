import type { Project } from '@/lib/db/schema/projects'

export const PROJECT_STATUS_FILTERS = ['active', 'paused', 'closed', 'all'] as const
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number]

export function isProjectStatusFilter(value: string): value is ProjectStatusFilter {
  return (PROJECT_STATUS_FILTERS as readonly string[]).includes(value)
}

export function filterProjectsByStatus<P extends Pick<Project, 'status'>>(projects: readonly P[], filter: ProjectStatusFilter): P[] {
  if (filter === 'all') return [...projects]
  return projects.filter((project) => project.status === filter)
}

export function defaultProjectStatusFilter(projects: readonly Pick<Project, 'status'>[]): ProjectStatusFilter {
  return projects.some((project) => project.status === 'active') ? 'active' : 'all'
}

export function countByStatus(projects: readonly Pick<Project, 'status'>[]): Record<ProjectStatusFilter, number> {
  const count = (status: Project['status']) => projects.filter((project) => project.status === status).length
  return { active: count('active'), paused: count('paused'), closed: count('closed'), all: projects.length }
}

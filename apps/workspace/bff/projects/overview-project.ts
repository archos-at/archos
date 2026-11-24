import type { Project } from '@/lib/db/schema/projects'
import { projectSearchText, searchTokens } from './project-search'
import { projectCity, projectFactText } from './site-address'

/** A project as the shell carries it: the picker reads id, name and status, the overview the rest. */
export interface OverviewProject extends Pick<Project, 'id' | 'name' | 'status' | 'profileUpdatedAt' | 'createdAt'> {
  place: string | null
  phase: string | null
  searchText: string
}

export function toOverviewProject(project: Project): OverviewProject {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    profileUpdatedAt: project.profileUpdatedAt,
    createdAt: project.createdAt,
    place: projectCity(project),
    phase: projectFactText(project, 'project_phase'),
    searchText: projectSearchText(project),
  }
}

export function overviewMatchesQuery(project: Pick<OverviewProject, 'searchText'>, query: string): boolean {
  return searchTokens(query).every((token) => project.searchText.includes(token))
}

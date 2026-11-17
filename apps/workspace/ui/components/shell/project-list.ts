import type { ProjectStatus } from '@/lib/projects/project-status'
import { foldDiacritics } from '@/lib/text/latinize'

export interface ProjectSwitcherProject {
  id: string
  name: string
  status?: ProjectStatus
}

export function switchableProjects(projects: readonly ProjectSwitcherProject[], currentId?: string): ProjectSwitcherProject[] {
  return projects.filter((project) => project.status !== 'closed' || project.id === currentId)
}

const RECENT_SLOTS = 3

export type SwitcherSections =
  | { kind: 'browse'; recent: ProjectSwitcherProject[]; rest: ProjectSwitcherProject[] }
  | { kind: 'search'; matches: ProjectSwitcherProject[] }

function fold(value: string): string {
  return foldDiacritics(value).toLowerCase()
}

export function switcherSections(
  projects: readonly ProjectSwitcherProject[],
  currentId: string | undefined,
  recentIds: readonly string[],
  query: string
): SwitcherSections {
  const offered = switchableProjects(projects, currentId)
  const needle = fold(query.trim())
  if (needle) {
    return {
      kind: 'search',
      matches: offered.filter((project) => fold(project.name).includes(needle)),
    }
  }
  const byId = new Map(offered.map((project) => [project.id, project]))
  const recent = recentIds
    .map((id) => byId.get(id))
    .filter((project): project is ProjectSwitcherProject => project !== undefined)
    .slice(0, RECENT_SLOTS)
  const recentSet = new Set(recent.map((project) => project.id))
  return { kind: 'browse', recent, rest: offered.filter((project) => !recentSet.has(project.id)) }
}

export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /^\p{L}/u.test(word))
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
  return (initials || name.trim().charAt(0) || '?').toLocaleUpperCase('de')
}

import type { ProjectStatus } from '@/lib/projects/project-status'
import { foldDiacritics } from '@/lib/text/latinize'

export interface ProjectSwitcherProject {
  id: string
  name: string
  status?: ProjectStatus
}

export function switchableProjects(
  projects: readonly ProjectSwitcherProject[],
  currentId?: string
): ProjectSwitcherProject[] {
  return projects.filter((project) => project.status !== 'closed' || project.id === currentId)
}

export const SHORTLIST_SLOTS = 5

export type SwitcherSections =
  | {
      kind: 'browse'
      shortlist: ProjectSwitcherProject[]
      rest: ProjectSwitcherProject[]
      all: ProjectSwitcherProject[]
      fromRecents: boolean
    }
  | { kind: 'search'; matches: ProjectSwitcherProject[] }

function fold(value: string): string {
  return foldDiacritics(value).toLowerCase()
}

/** `projects` arrive in the overview's order; the ones this browser opened last move to the front. The shortlist
 *  is the first five, and always holds the open project, in the last slot when it would not have made the cut. */
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
  const recent = [...new Set(recentIds)]
    .map((id) => byId.get(id))
    .filter((project): project is ProjectSwitcherProject => project !== undefined)
  const recentSet = new Set(recent.map((project) => project.id))
  const ordered = [...recent, ...offered.filter((project) => !recentSet.has(project.id))]
  let shortlist = ordered.slice(0, SHORTLIST_SLOTS)
  const current = currentId === undefined ? undefined : byId.get(currentId)
  if (current && !shortlist.includes(current))
    shortlist = [...shortlist.slice(0, SHORTLIST_SLOTS - 1), current]
  const listed = new Set(shortlist)
  return {
    kind: 'browse',
    shortlist,
    rest: ordered.filter((project) => !listed.has(project)),
    all: ordered,
    fromRecents: shortlist.every((project) => recentSet.has(project.id)),
  }
}

export function projectInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
  return (initials || name.trim().charAt(0) || '?').toLocaleUpperCase('de')
}

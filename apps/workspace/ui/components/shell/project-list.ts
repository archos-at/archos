/**
 * Which projects the switchers offer, and in what order: one rule for the
 * rail's switcher (a popover) and the phone's sheet, so a desk and a phone list
 * the same office the same way. Pure, so the ordering is tested without a
 * browser.
 */
import type { ProjectStatus } from '@/lib/projects/project-status'
import { foldDiacritics } from '@/lib/text/latinize'

export interface ProjectSwitcherProject {
  id: string
  name: string
  /** Absent reads as active. */
  status?: ProjectStatus
}

/**
 * The projects the switcher offers: where one works. Every member reads every
 * closed project (ADR-0090), so listing them would bury the dozen running ones
 * under everything the office ever finished; a closed project is reached from
 * the projects list, and stays here only while it is the one open (ADR-0098).
 */
export function switchableProjects(projects: readonly ProjectSwitcherProject[], currentId?: string): ProjectSwitcherProject[] {
  return projects.filter((project) => project.status !== 'closed' || project.id === currentId)
}

/** How many recent projects lead the list. Three is a week on site, not a history. */
const RECENT_SLOTS = 3

export type SwitcherSections =
  | { kind: 'browse'; recent: ProjectSwitcherProject[]; rest: ProjectSwitcherProject[] }
  | { kind: 'search'; matches: ProjectSwitcherProject[] }

function fold(value: string): string {
  return foldDiacritics(value).toLowerCase()
}

/**
 * What a switcher lists: recents first (in the order they were opened, only
 * ones still offered), then the rest by the order the server sent (name); a
 * query folds case and diacritics, so "muhlgasse" finds „Mühlgasse".
 */
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

/**
 * A project's two initials, from its first two words that start with a letter
 * („Wohnbau Seestadt Baufeld D12" → „WS", „Bürohaus Lände 3" → „BL"); one for a
 * one-word name, the first sign for a name with no letter word. The mark that tells one project from another where its name
 * does not fit (the icon rail) and before it is read (a list).
 */
export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /^\p{L}/u.test(word))
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
  // A name with no word that starts with a letter („2024-07") keeps its first sign.
  return (initials || name.trim().charAt(0) || '?').toLocaleUpperCase('de')
}

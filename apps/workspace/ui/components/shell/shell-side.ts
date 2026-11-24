import { projectIdFromPathname } from './org-sections'
import { railModeOf } from './rail-mode'
import type { RailSide } from './rail-side'

export const PERSONAL_SIDE: RailSide = { mode: 'personal', projectId: null }

export function sideOfPath(pathname: string): RailSide | null {
  const mode = railModeOf(pathname)
  if (mode === 'personal') return PERSONAL_SIDE
  return mode === 'project' ? { mode, projectId: projectIdFromPathname(pathname) } : null
}

export function sideOfLastPlace(lastPlace: string | undefined, reachableProjectIds: readonly string[]): RailSide {
  const side = lastPlace ? sideOfPath(safeDecode(lastPlace)) : null
  if (!side || (side.projectId !== null && !reachableProjectIds.includes(side.projectId))) return PERSONAL_SIDE
  return side
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

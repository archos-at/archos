const STORAGE_KEY = 'return-trail'

const MAX_ENTRIES = 12

export interface TrailEntry {
  path: string
  label?: string
}

export type ReturnTrail = readonly TrailEntry[]

const TAB_SHELLS = new Set(['platform', 'organization', 'inbox', 'profile'])

export function navigationArea(path: string): string | null {
  const segments = path.split('?')[0].split('/').filter(Boolean)
  if (segments[0] !== 'app' || !segments[1]) return null
  return TAB_SHELLS.has(segments[1]) ? segments[1] : null
}

function dropTrailingArea(trail: ReturnTrail, path: string): ReturnTrail {
  const area = navigationArea(path)
  if (!area) return trail
  let end = trail.length
  while (end > 0 && navigationArea(trail[end - 1].path) === area) end--
  return end === trail.length ? trail : trail.slice(0, end)
}

export function recordVisit(trail: ReturnTrail, path: string): ReturnTrail {
  if (path === '') return trail
  if (trail[trail.length - 1]?.path === path) return trail

  const withoutArea = dropTrailingArea(trail, path)
  const seenAt = lastIndexOfPath(withoutArea, path)
  if (seenAt !== -1) return withoutArea.slice(0, seenAt + 1)

  return [...withoutArea, { path }].slice(-MAX_ENTRIES)
}

export function labelVisit(trail: ReturnTrail, path: string, label: string): ReturnTrail {
  if (label === '') return trail
  const at = lastIndexOfPath(trail, path)
  if (at === -1 || trail[at].label === label) return trail
  const next = [...trail]
  next[at] = { path, label }
  return next
}

export function previousVisit(trail: ReturnTrail, currentPath: string): TrailEntry | null {
  if (trail[trail.length - 1]?.path !== currentPath) return null
  const area = navigationArea(currentPath)
  for (let i = trail.length - 2; i >= 0; i--) {
    if (area && navigationArea(trail[i].path) === area) continue
    return trail[i]
  }
  return null
}

export function backReaches(trail: ReturnTrail, currentPath: string, target: string): boolean {
  const previous = previousVisit(trail, currentPath)
  if (!previous || trail[trail.length - 2]?.path !== previous.path) return false
  return previous.path === target
}

export function readTrail(): ReturnTrail {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): TrailEntry[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const { path, label } = entry as { path?: unknown; label?: unknown }
      if (typeof path !== 'string' || path === '') return []
      return [typeof label === 'string' && label !== '' ? { path, label } : { path }]
    })
  } catch {
    return []
  }
}

export function writeTrail(trail: ReturnTrail): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail))
  } catch {
    // Nothing to do: the trail is an enhancement over the server-resolved link.
  }
}

function lastIndexOfPath(trail: ReturnTrail, path: string): number {
  for (let i = trail.length - 1; i >= 0; i--) {
    if (trail[i].path === path) return i
  }
  return -1
}

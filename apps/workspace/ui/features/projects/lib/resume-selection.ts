export const RESUME_SLOTS = 3

export interface ResumeCandidate {
  id: string
  profileUpdatedAt: Date | string | null
  createdAt: Date | string
}

export interface ResumeSplit<T extends ResumeCandidate> {
  resume: T[]
  rest: T[]
  basis: 'activity' | 'fallback'
}

function toMillis(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

export function projectTouchedAt(project: ResumeCandidate): number {
  return toMillis(project.profileUpdatedAt) ?? toMillis(project.createdAt) ?? 0
}

export function splitForResume<T extends ResumeCandidate>(
  projects: readonly T[],
  viewerActivity: Readonly<Record<string, string | undefined>> = {},
  slots: number = RESUME_SLOTS,
  railable: (project: T) => boolean = () => true
): ResumeSplit<T> {
  const railSize = Math.max(0, Math.trunc(slots))

  const active: Array<{ project: T; at: number }> = []
  const untouched: Array<{ project: T; at: number }> = []

  for (const project of projects) {
    const at = toMillis(viewerActivity[project.id])
    if (at === null) untouched.push({ project, at: projectTouchedAt(project) })
    else active.push({ project, at })
  }

  const byRecency = (a: { at: number }, b: { at: number }): number => b.at - a.at
  active.sort(byRecency)
  untouched.sort(byRecency)

  const ordered = [...active, ...untouched].map((entry) => entry.project)
  const resume = ordered.filter(railable).slice(0, railSize)
  const onRail = new Set(resume)
  const worked = new Set(active.map((entry) => entry.project))

  return {
    resume,
    rest: ordered.filter((project) => !onRail.has(project)),
    basis: resume.some((project) => worked.has(project)) ? 'activity' : 'fallback',
  }
}

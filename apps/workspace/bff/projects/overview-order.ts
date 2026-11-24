import type { Project } from '@/lib/db/schema/projects'
import { toProjectStatus } from './project-status'

type Ordered = Pick<Project, 'id' | 'status' | 'profileUpdatedAt' | 'createdAt'>

const STATUS_ORDER = { active: 0, paused: 1, closed: 2 } as const

export function overviewOrder<T extends Ordered>(
  projects: readonly T[],
  viewerActivity: Readonly<Record<string, string>>
): T[] {
  const touched = (project: T): number =>
    new Date(viewerActivity[project.id] ?? project.profileUpdatedAt ?? project.createdAt).getTime()
  return [...projects].sort(
    (a, b) =>
      STATUS_ORDER[toProjectStatus(a.status)] - STATUS_ORDER[toProjectStatus(b.status)] ||
      touched(b) - touched(a)
  )
}

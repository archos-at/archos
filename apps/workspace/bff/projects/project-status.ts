import { ForbiddenError } from '@/lib/api/api-error'
import type { ProjectPermission } from '@/lib/authz/permissions'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { dateToMonth, isMonth, isOrderedPeriod, type Month } from './month'

export const PROJECT_STATUSES = ['active', 'paused', 'closed'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_OUTCOMES = ['completed', 'cancelled'] as const
export type ProjectOutcome = (typeof PROJECT_OUTCOMES)[number]

export const PROJECT_LIFECYCLE = defineLifecycle<ProjectStatus, 'pause' | 'resume' | 'close' | 'reopen'>({
  id: 'project',
  initial: 'active',
  states: {
    active: { on: { pause: 'paused', close: 'closed' } },
    paused: { on: { resume: 'active', close: 'closed' } },
    closed: { on: { reopen: 'active' } },
  },
})

export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  active: PROJECT_STATUSES.filter((to) => PROJECT_LIFECYCLE.canTransition('active', to)),
  paused: PROJECT_STATUSES.filter((to) => PROJECT_LIFECYCLE.canTransition('paused', to)),
  closed: PROJECT_STATUSES.filter((to) => PROJECT_LIFECYCLE.canTransition('closed', to)),
}

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_LIFECYCLE.canTransition(from, to)
}

export function invalidTransition(from: ProjectStatus, to: ProjectStatus) {
  return { reason: 'invalid-transition', from, to, allowed: PROJECT_TRANSITIONS[from] } as const
}

export function statusesThatMayBecome(to: ProjectStatus): ProjectStatus[] {
  return [...PROJECT_LIFECYCLE.statesThatMayBecome(to)]
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value)
}

export function toProjectStatus(value: unknown): ProjectStatus {
  return isProjectStatus(value) ? value : 'active'
}

export function closingOf(project: { status?: ProjectStatus | string | null; endedOn?: string | null }): string | null {
  return isProjectClosed(project) ? (project.endedOn ?? null) : null
}

export interface ProjectLifecycleView {
  status: ProjectStatus
  pausedAt: string | null
  closedAt: string | null
  closedOutcome: ProjectOutcome | null
  suggestedOutcome: ProjectOutcome | null
  endedOn: Month | null
  startedOn: Month | null
  suggestedEndedOn: Month | null
}

type LifecycleRow = {
  status: ProjectStatus
  pausedAt: Date | string | null
  closedAt: Date | string | null
  closedOutcome: ProjectOutcome | null
  startedOn: string | null
  endedOn: string | null
}

const iso = (value: Date | string | null): string | null => (value ? new Date(value).toISOString() : null)

export function lifecycleViewOf(project: LifecycleRow): ProjectLifecycleView {
  const startedOn = dateToMonth(project.startedOn)
  const stored = dateToMonth(project.endedOn)
  return {
    status: project.status,
    pausedAt: iso(project.pausedAt),
    closedAt: iso(project.closedAt),
    closedOutcome: isProjectClosed(project) ? project.closedOutcome : null,
    suggestedOutcome: project.closedOutcome,
    endedOn: dateToMonth(closingOf(project)),
    startedOn,
    suggestedEndedOn: stored && isOrderedPeriod(startedOn, stored) ? stored : null,
  }
}

export function closingBounds(startedOn: Month | null, thisMonth: Month): { min: Month | null; max: Month } {
  return { min: startedOn, max: startedOn && startedOn > thisMonth ? startedOn : thisMonth }
}

export function closingProblem(
  endedOn: string,
  startedOn: Month | null,
  thisMonth: Month
): 'invalid' | 'future' | 'beforeStart' | null {
  if (!isMonth(endedOn)) return 'invalid'
  const { min, max } = closingBounds(startedOn, thisMonth)
  if (endedOn > max) return 'future'
  if (min && endedOn < min) return 'beforeStart'
  return null
}

export function defaultClosing(suggested: Month | null, startedOn: Month | null, thisMonth: Month): Month {
  const { min, max } = closingBounds(startedOn, thisMonth)
  if (suggested && suggested <= max && (!min || suggested >= min)) return suggested
  return max
}

export const SCHEDULE_SKIPPED_BECAUSE = { paused: 'Project is paused', closed: 'Project is closed' } as const

export function runsOnSchedule(project: { status?: ProjectStatus | string | null } | null | undefined): boolean {
  return project?.status === 'active'
}

export const PROJECT_CLOSED_REASON = 'project-closed'

export const CLOSED_PROJECT_KEEPS: ReadonlySet<ProjectPermission> = new Set<ProjectPermission>([
  'project:view',
  'project:chat',
  'project:members:manage',
])

export const CLOSED_PROJECT_OPEN_TO_ORGANIZATION: ReadonlySet<ProjectPermission> = new Set<ProjectPermission>([
  'project:view',
  'project:chat',
])

export function isProjectClosed(project: { status?: ProjectStatus | string | null } | null | undefined): boolean {
  return project?.status === 'closed'
}

export function keptWhenClosed(accepted: readonly ProjectPermission[]): ProjectPermission[] {
  return accepted.filter((permission) => CLOSED_PROJECT_KEEPS.has(permission))
}

export function openToOrganizationWhenClosed(accepted: readonly ProjectPermission[]): boolean {
  return accepted.length > 0 && accepted.every((permission) => CLOSED_PROJECT_OPEN_TO_ORGANIZATION.has(permission))
}

export function projectClosedError(): ForbiddenError {
  return new ForbiddenError('This project is closed and can only be read. Reopen it to change it.', {
    reason: PROJECT_CLOSED_REASON,
  })
}

export function isProjectClosedError(error: unknown): boolean {
  if (!(error instanceof ForbiddenError)) return false
  const details = error.details as { reason?: unknown } | undefined
  return details?.reason === PROJECT_CLOSED_REASON
}

export function isProjectClosedBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const details = (body as { details?: unknown }).details
  return !!details && typeof details === 'object' && (details as { reason?: unknown }).reason === PROJECT_CLOSED_REASON
}

export const PROJECT_CLOSED_SQLSTATE = 'GPC01'

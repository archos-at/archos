import type { JobRun } from '@/adapters/api/jobs-client'
import { isBrokenRunStatus } from '@/lib/tasks/run-display'
import { isActiveTaskRunStatus } from '@/lib/tasks/task-vocabulary'
import type { Session } from '../types'

export const hasResearchMark = (session: Session): boolean =>
  Boolean(session.hasResearch || session.hasActiveDeepResearch || session.hasCompletedReport || session.hasFailedResearch)

const newestRunByConversation = (runs: readonly JobRun[]): Map<string, JobRun> => {
  const newest = new Map<string, JobRun>()
  for (const run of runs) {
    if (!run.conversationId) continue
    const known = newest.get(run.conversationId)
    if (!known || run.createdAt > known.createdAt) newest.set(run.conversationId, run)
  }
  return newest
}

export const withRunMarks = (sessions: readonly Session[], runs: readonly JobRun[]): Session[] => {
  const newest = newestRunByConversation(runs)
  if (newest.size === 0) return [...sessions]
  return sessions.map((session) => {
    const run = newest.get(session.id)
    if (!run) return session
    const live = session.hasActiveDeepResearch || isActiveTaskRunStatus(run.status)
    return {
      ...session,
      hasResearch: true,
      hasActiveDeepResearch: live,
      hasCompletedReport: !live && (session.hasCompletedReport || run.status === 'succeeded'),
      hasFailedResearch: !live && isBrokenRunStatus(run.status),
    }
  })
}

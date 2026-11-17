import type { Session } from '../types'

export const statusKeyFor = (session: Session, isSessionActive: boolean): string | null => {
  if (isSessionActive || session.hasActiveDeepResearch) return 'sessionsPanel.sessionActive'
  if (session.hasCompletedReport) return 'sessionsPanel.reportCompleted'
  return null
}

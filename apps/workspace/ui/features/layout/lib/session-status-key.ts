import type { Session } from '../types'

export const statusKeyFor = (session: Session): string | null => {
  if (session.activity === 'waiting') return 'sessionsPanel.sessionWaiting'
  if (session.activity === 'working' || session.hasActiveDeepResearch) return 'sessionsPanel.sessionActive'
  if (session.activity === 'answered') return 'sessionsPanel.answerReady'
  if (session.activity === 'failed') return 'sessionsPanel.answerFailed'
  if (session.hasCompletedReport) return 'sessionsPanel.reportCompleted'
  return null
}

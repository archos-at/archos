export const isRunActive = (status: string): boolean =>
  status !== 'completed' && status !== 'failed' && status !== 'cancelled'

export const runStatusKey = (status: string): string => {
  if (status === 'completed') return 'sessionsPanel.runStatus.completed'
  if (status === 'failed') return 'sessionsPanel.runStatus.failed'
  if (status === 'cancelled') return 'sessionsPanel.runStatus.cancelled'
  return 'sessionsPanel.runStatus.running'
}

export const runBadgeVariant = (status: string): 'success' | 'info' | 'destructive' | 'secondary' => {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'cancelled') return 'secondary'
  return 'info'
}

export type CreateReport =
  | { type: 'create.started'; temporary: boolean }
  | { type: 'row.created'; temporary: boolean }
  | { type: 'create.failed' }

const reports = new Map<string, CreateReport>()
const listeners = new Set<(conversationId: string, report: CreateReport) => void>()

function report(conversationId: string, next: CreateReport): void {
  reports.set(conversationId, next)
  for (const listener of listeners) listener(conversationId, next)
}

export function recordCreateStarted(conversationId: string, temporary: boolean): void {
  report(conversationId, { type: 'create.started', temporary })
}

export function recordCreatedTemporary(conversationId: string, temporary: boolean): void {
  report(conversationId, { type: 'row.created', temporary })
}

export function recordCreateFailed(conversationId: string): void {
  report(conversationId, { type: 'create.failed' })
}

export function lastCreateReport(conversationId: string): CreateReport | undefined {
  return reports.get(conversationId)
}

export function onCreateReport(listener: (conversationId: string, report: CreateReport) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCreatedTemporary(): void {
  reports.clear()
}

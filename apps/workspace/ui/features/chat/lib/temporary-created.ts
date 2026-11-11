/**
 * What the create of a conversation this page minted did with `temporary`
 * (ADR-0180): the flag it left with, the flag the server answered, or that it
 * failed. The store's create path reports here; the temporary switch
 * (`temporary-conversation.ts`) listens, so a switch made while the create is
 * in flight is settled against the row the server really made.
 *
 * Its own module, without the store: the store's create path writes it and the
 * switch reads it, and neither may import the other. The last report per id is
 * kept, so a switch first read after the create still knows what it carried.
 */

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

/** The create left with this flag. */
export function recordCreateStarted(conversationId: string, temporary: boolean): void {
  report(conversationId, { type: 'create.started', temporary })
}

/** The row exists; the server answered this flag (an id that already existed answers its row as it stands). */
export function recordCreatedTemporary(conversationId: string, temporary: boolean): void {
  report(conversationId, { type: 'row.created', temporary })
}

/** The create failed: the chat is still only in this page. */
export function recordCreateFailed(conversationId: string): void {
  report(conversationId, { type: 'create.failed' })
}

/** The last report for a conversation, `undefined` for one this page did not create. */
export function lastCreateReport(conversationId: string): CreateReport | undefined {
  return reports.get(conversationId)
}

/** Hear every report from now on. Returns the unsubscribe. */
export function onCreateReport(listener: (conversationId: string, report: CreateReport) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Specs only. */
export function resetCreatedTemporary(): void {
  reports.clear()
}

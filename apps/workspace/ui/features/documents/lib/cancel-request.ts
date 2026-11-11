/**
 * One request to stop a running ingest, and what came of it.
 *
 * Shared by the document menu's „Lesen abbrechen" and the upload tray's stop,
 * so the two read the server's answer the same way. The server answers
 * `{ result, status }` (`@/lib/documents/cancel-wire`): a stop it made, a job
 * that had already finished, or work it cannot reach from where it stands,
 * and the status the document holds afterwards.
 */


import { cancelIngestResultSchema } from '@/lib/documents/cancel-wire'

export type CancelIngestOutcome =
  /**
   * A live job was stopped. `status` is what the document holds afterwards:
   * `cancelled`, unless the read ended in the same moment and a report settled
   * it first. Absent from a server that predates the field.
   */
  | { kind: 'cancelled'; status?: string }
  /** The durable queue held no live job: it had already run to an end. */
  | { kind: 'finished' }
  /** Nothing this tier can stop: the durable ingest queue is off, or the work runs inside the BFF. */
  | { kind: 'unavailable' }
  /** The request itself failed (transport, or a 5xx). */
  | { kind: 'failed' }

export async function requestCancelIngest(documentId: string): Promise<CancelIngestOutcome> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/cancel`, { method: 'POST' })
    if (!res.ok) return { kind: 'failed' }
    const answer = cancelIngestResultSchema.partial({ id: true }).safeParse(await res.json().catch(() => null))
    if (!answer.success) return { kind: 'failed' }
    const { result, status } = answer.data
    return result === 'cancelled' ? { kind: result, ...(status ? { status } : {}) } : { kind: result }
  } catch {
    return { kind: 'failed' }
  }
}

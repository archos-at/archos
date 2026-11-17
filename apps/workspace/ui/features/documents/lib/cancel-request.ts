import { cancelIngestResultSchema } from '@/lib/documents/cancel-wire'

export type CancelIngestOutcome =
  | { kind: 'cancelled'; status?: string }
  | { kind: 'finished' }
  | { kind: 'unavailable' }
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

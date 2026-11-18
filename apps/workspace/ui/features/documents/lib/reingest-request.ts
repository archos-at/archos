import { INGEST_ALREADY_DONE, INGEST_RUNNING, INGEST_WOULD_FAIL_AGAIN } from '@/lib/documents/reingest-codes'

export type ReingestOutcome =
  | { kind: 'started'; status: string }
  | { kind: 'settled'; code: typeof INGEST_RUNNING | typeof INGEST_ALREADY_DONE; status: string | null }
  | { kind: 'unchanged' }
  | { kind: 'failed' }

async function readReingestRefusal(res: Response): Promise<{ code: string | null; status: string | null } | null> {
  const body: unknown = await res.json().catch(() => null)
  if (!body || typeof body !== 'object') return null
  const details = (body as { details?: unknown }).details
  if (!details || typeof details !== 'object') return null
  const { code, status } = details as { code?: unknown; status?: unknown }
  return {
    code: typeof code === 'string' ? code : null,
    status: typeof status === 'string' ? status : null,
  }
}

export async function requestReingest(documentId: string): Promise<ReingestOutcome> {
  try {
    const res = await fetch(`/api/documents/${documentId}/reingest`, { method: 'POST' })
    if (res.status === 409) {
      const refusal = await readReingestRefusal(res)
      if (refusal?.code === INGEST_RUNNING || refusal?.code === INGEST_ALREADY_DONE) {
        return { kind: 'settled', code: refusal.code, status: refusal.status }
      }
      if (refusal?.code === INGEST_WOULD_FAIL_AGAIN) return { kind: 'unchanged' }
      return { kind: 'failed' }
    }
    if (!res.ok) return { kind: 'failed' }
    const data: unknown = await res.json().catch(() => ({}))
    const status = (data as { status?: unknown } | null)?.status
    return { kind: 'started', status: typeof status === 'string' ? status : 'pending' }
  } catch {
    return { kind: 'failed' }
  }
}

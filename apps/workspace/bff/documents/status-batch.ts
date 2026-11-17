import type { JobClock } from './ingest-timing'

export const BATCH_STATUS_MAX_IDS = 200

export async function fetchInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<Record<string, T> | null>
): Promise<Map<string, T> | null> {
  const merged = new Map<string, T>()
  for (let start = 0; start < ids.length; start += BATCH_STATUS_MAX_IDS) {
    const chunk = ids.slice(start, start + BATCH_STATUS_MAX_IDS)
    const answered = await fetchChunk(chunk)
    if (answered === null) {
      console.warn(`[reconcile] job status lookup failed for ${chunk.length} of ${ids.length} job(s); rows left as they are`)
      return null
    }
    for (const [id, status] of Object.entries(answered)) merged.set(id, status)
  }
  return merged
}

export interface BackendJobFile {
  status?: string
  error_message?: string | null
  screening?: string | null
  quarantine?: unknown
  failure_category?: string | null
  retryable?: boolean | null
}

export interface BackendJobStatus extends JobClock {
  status?: string
  error_message?: string | null
  metadata?: { queue_ahead?: unknown } | null
  reader_version?: string | null
  file_details?: BackendJobFile[]
}

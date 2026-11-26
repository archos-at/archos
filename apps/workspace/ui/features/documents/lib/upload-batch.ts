import type { NameStopTally } from '@/lib/upload-screening/name-stop'
import type { NameMatch } from '@/lib/upload-screening/name-screen'
import { exclusionsByTerm } from '@/lib/upload-screening/name-stop'

export type UploadBatchShelf = 'project' | 'office_shelf' | 'personal' | 'session'

export type UploadBatchExclusion = NameStopTally

export { exclusionsByTerm } from '@/lib/upload-screening/name-stop'

export interface OpenBatchInput {
  id: string
  scope: UploadBatchShelf
  projectId: string | null
  conversationId: string | null
  expectedCount: number
  excluded: UploadBatchExclusion[]
}

export async function openUploadBatch(input: OpenBatchInput): Promise<string | null> {
  try {
    const response = await fetch('/api/upload-batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return response.ok ? input.id : null
  } catch {
    return null
  }
}

export interface HeldUploadBatch {
  id: string
  unchanged: number
  failed: number
  excluded: ReadonlyArray<readonly NameMatch[]>
}

export function sealHeldUploadBatch(held: HeldUploadBatch, skipped: number): Promise<void> {
  const excluded = exclusionsByTerm(held.excluded)
  return sealUploadBatch(held.id, {
    unchanged: held.unchanged + skipped,
    failed: held.failed,
    ...(excluded.length > 0 ? { excluded } : {}),
  })
}

export async function sealUploadBatch(
  id: string,
  counts: { unchanged: number; failed: number; excluded?: UploadBatchExclusion[] }
): Promise<void> {
  try {
    await fetch(`/api/upload-batches/${encodeURIComponent(id)}/seal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(counts),
    })
  } catch {
    // The sweep seals a batch its browser never came back to.
  }
}

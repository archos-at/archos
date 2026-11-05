/** Tells PostHog which ingests a status read just brought to rest (`document_ingest_finished`). */

import 'server-only'
import { announceIngestsFinished, finishedIngestOf, type FinishedIngest, type SettledBy } from '@/lib/analytics/ingest-events'
import { findIngestAnnouncementFacts } from './repository'

type SettledRow = { id: string; filename: string; updatedAt?: Date | string | null }
type SettledResolution = Parameters<typeof finishedIngestOf>[1]

/**
 * One event per row THIS read moved, so a concurrent read that lost the race
 * announces nothing. A stop is not an ingest result: nothing was read, so there
 * is no duration to report (the row's own write is the settle, not the dispatch)
 * and no outcome the funnel can use. The person's act is the record; this event
 * stays what it says it is: a read that came to rest. `settledBy` is the path
 * that asked (the push, a read or a sweep).
 */
export async function announceSettledIngests(
  organizationId: string,
  settled: Array<[string, SettledResolution]>,
  rowsById: Map<string, SettledRow>,
  metaByRow: Map<string, { pageCount?: number; chunkCount?: number }>,
  settledBy: SettledBy
): Promise<void> {
  const announced = settled.filter(([id, resolution]) => rowsById.has(id) && resolution.status !== 'pending' && resolution.status !== 'cancelled')
  const facts = await findIngestAnnouncementFacts(organizationId, announced.map(([id]) => id))
  const finished: FinishedIngest[] = announced.flatMap(([id, resolution]) => {
    const row = rowsById.get(id)
    if (!row) return []
    return [{ ...finishedIngestOf(row, resolution, metaByRow.get(id)), attempt: facts.get(id)?.attempt, uploadId: facts.get(id)?.uploadBatchId, fileBytes: facts.get(id)?.fileSize }]
  })
  announceIngestsFinished(organizationId, finished, settledBy)
}

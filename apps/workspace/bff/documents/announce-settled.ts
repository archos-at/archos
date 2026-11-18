import 'server-only'
import { announceIngestsFinished, finishedIngestOf, type FinishedIngest, type SettledBy } from '@/lib/analytics/ingest-events'
import { findIngestAnnouncementFacts } from './repository'
import type { ReconcilableDocument } from './reconcile-status'
import { documentShelf } from './shelf'
import { publishShelfChanged } from './shelf-live'

type SettledRow = { id: string; filename: string; updatedAt?: Date | string | null }
type SettledResolution = Parameters<typeof finishedIngestOf>[1]

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

export function announceSettledShelves(
  organizationId: string,
  rows: readonly ReconcilableDocument[],
  settledIds: ReadonlySet<string>
): void {
  const shelves = new Map<string, NonNullable<ReturnType<typeof documentShelf>>>()
  for (const row of rows) {
    if (!settledIds.has(row.id) || !('projectId' in row)) continue
    const shelf = documentShelf(row as { projectId: string | null; scope?: string })
    if (shelf) shelves.set(shelf.kind === 'project' ? shelf.projectId : 'office_shelf', shelf)
  }
  for (const shelf of shelves.values()) publishShelfChanged(organizationId, shelf)
}

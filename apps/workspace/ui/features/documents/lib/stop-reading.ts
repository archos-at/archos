/**
 * Stop a read in progress and make the upload row say what came of it.
 *
 * The row is written `canceled` only when the stop took effect. The request
 * is out for a moment, and a report can settle the row in that time (a job
 * poll, a listing): the read may have finished first. Then the row is not
 * overwritten on the queue's word alone. The document is asked, and the row
 * says cancelled only if the document does; otherwise it keeps what the
 * report said and the caller hears `finished`, the server's own word for a
 * read that had already run to an end.
 */

import { useDocumentsStore } from '../store'
import { requestCancelIngest, type CancelIngestOutcome } from './cancel-request'
import { readDocumentStatuses } from './document-status-reads'

export async function stopReadingRow(fileId: string, documentId: string): Promise<CancelIngestOutcome['kind']> {
  const outcome = await requestCancelIngest(documentId)
  if (outcome.kind !== 'cancelled') return outcome.kind

  const { trackedFiles, updateTrackedFile } = useDocumentsStore.getState()
  const row = trackedFiles.find((file) => file.id === fileId)
  if (row && row.status !== 'ingesting') {
    const read = (await readDocumentStatuses([documentId])).get(documentId)
    if (read?.kind !== 'row' || read.fields.status !== 'cancelled') return 'finished'
  }
  updateTrackedFile(fileId, { status: 'canceled' })
  return 'cancelled'
}

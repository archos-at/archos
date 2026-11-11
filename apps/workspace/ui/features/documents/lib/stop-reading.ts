/**
 * Stop a read in progress and make the upload row say what came of it.
 *
 * The row is written `canceled` only when the stop took effect. The queue
 * stopping a job is not that: the read may have ended in the same moment, and
 * a report (a job poll, a listing) then settled the document with its real
 * outcome. The stop's answer carries the status the document holds afterwards,
 * and the row says cancelled only if the document does; otherwise it keeps what
 * the report said and the caller hears `finished`, the server's own word for a
 * read that had already run to an end.
 *
 * A server from before the answer carried the status (a deploy in progress)
 * leaves the question open. The row is then written only while it still says
 * the file is being read, so a report that arrived meanwhile is never
 * overwritten on the queue's word alone.
 */

import { useDocumentsStore } from '../store'
import { requestCancelIngest, type CancelIngestOutcome } from './cancel-request'

export async function stopReadingRow(fileId: string, documentId: string): Promise<CancelIngestOutcome['kind']> {
  const outcome = await requestCancelIngest(documentId)
  if (outcome.kind !== 'cancelled') return outcome.kind

  const { trackedFiles, updateTrackedFile } = useDocumentsStore.getState()
  const row = trackedFiles.find((file) => file.id === fileId)
  const documentCancelled =
    outcome.status === undefined ? !row || row.status === 'ingesting' : outcome.status === 'cancelled'
  if (!documentCancelled) return 'finished'
  updateTrackedFile(fileId, { status: 'canceled' })
  return 'cancelled'
}

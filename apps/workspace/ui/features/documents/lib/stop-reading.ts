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

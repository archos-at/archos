import { UploadOrchestrator } from '../orchestrator'
import { useDocumentsStore } from '../store'

export function readAllowedRowAgain(rowId: string): void {
  useDocumentsStore.getState().updateTrackedFile(rowId, {
    status: 'ingesting',
    errorMessage: null,
    quarantine: null,
    jobId: undefined,
    progress: 0,
  })
  UploadOrchestrator.watchDocuments([rowId])
}

/**
 * A tray row whose held file its reviewer just allowed (ADR-0086) is read
 * again: the row goes back to reading and the orchestrator follows it by
 * document status, as it follows a re-read.
 */

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

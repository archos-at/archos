import { removePersistedJobForCollection, unmarkSessionCollection } from './persistence'
import { UploadOrchestrator } from './orchestrator'
import { useDocumentsStore } from './store'

export const discardSessionDocumentsResources = (sessionId: string): void => {
  UploadOrchestrator.stopPollingIfCollection(sessionId)
  unmarkSessionCollection(sessionId)
  removePersistedJobForCollection(sessionId)

  const docs = useDocumentsStore.getState()
  docs.clearFilesForCollection(sessionId)
  if (docs.currentCollectionName === sessionId) {
    docs.setCurrentCollection(null)
    docs.setCollectionInfo(null)
  }
}

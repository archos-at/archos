'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import { useLayoutStore } from '@/features/layout/store'
import { UploadOrchestrator, type OrchestratorCallbacks } from '../orchestrator'
import { useDocumentsStore } from '../store'
import { useShelfLive } from '@/features/realtime/use-shelf-live'

export interface UploadOrchestratorBinding extends OrchestratorCallbacks {
  /** The collection this surface uploads into; a chat's conversation id for its attachments. */
  collectionName: string | undefined
  /** The project whose shelf this surface files into, if it is one. */
  projectId?: string
  /** This surface files into the office shelf. */
  officeShelf?: boolean
}

/**
 * One upload surface's tie to the upload orchestrator: it hears completion and
 * failure, tells the orchestrator which collection is on screen, and passes on
 * the shelf's live hints.
 *
 * The hint is why an upload's read status needs no fast clock. The server says
 * `shelf.changed` on `shelf:<id>` the moment a read settles
 * (`reconcileDocumentStatuses`, reached by the ingest worker's settle push), to
 * everyone who may read the shelf; the orchestrator then asks about its job
 * and its watched rows at once (`askNow`) and keeps a one-minute poll as the
 * floor. The channel is open only while this tab has a read in flight. A
 * chat's attachments are on no shelf, so they have no channel and stay on the
 * orchestrator's own clock.
 *
 * The orchestrator is deliberately not cleaned up on unmount: it is a
 * singleton that follows uploads across component lifecycles, and a session
 * change (`handleSessionChange`) is what clears it.
 */
export function useUploadOrchestrator({
  collectionName,
  projectId,
  officeShelf = false,
  onComplete,
  onError,
}: UploadOrchestratorBinding): void {
  // One subscription per mount: several surfaces use this at once, and each
  // must hear about the uploads it is showing.
  useEffect(() => UploadOrchestrator.subscribe({ onComplete, onError }), [onComplete, onError])

  const session = !officeShelf && !projectId
  const previousCollection = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (collectionName === previousCollection.current) return
    void UploadOrchestrator.handleSessionChange(collectionName, session ? 'session' : 'corpus')
    previousCollection.current = collectionName
  }, [collectionName, session])

  // On a browser refresh the first load may run before the data sources are
  // known and skip itself; it is asked again once the knowledge layer is confirmed.
  const knowledgeLayerAvailable = useLayoutStore((state) => state.knowledgeLayerAvailable)
  useEffect(() => {
    if (collectionName) void UploadOrchestrator.loadFilesForSession(collectionName)
  }, [knowledgeLayerAvailable, collectionName])

  const shelf = useMemo<LiveShelf | null>(
    () => (officeShelf ? { kind: 'office_shelf' } : projectId ? { kind: 'project', projectId } : null),
    [officeShelf, projectId]
  )
  const reading = useDocumentsStore(
    (state) => state.isPolling || state.trackedFiles.some((file) => file.status === 'ingesting')
  )
  useShelfLive(shelf, () => UploadOrchestrator.askNow(), { enabled: reading })
}

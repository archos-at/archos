'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import { useLayoutStore } from '@/features/layout/store'
import { UploadOrchestrator, type OrchestratorCallbacks } from '../orchestrator'
import { useDocumentsStore } from '../store'
import { useShelfLive } from '@/features/realtime/use-shelf-live'

export interface UploadOrchestratorBinding extends OrchestratorCallbacks {
  collectionName: string | undefined
  projectId?: string
  officeShelf?: boolean
  personalShelf?: string
}

export function useUploadOrchestrator({
  collectionName,
  projectId,
  officeShelf = false,
  personalShelf,
  onComplete,
  onError,
}: UploadOrchestratorBinding): void {
  useEffect(() => UploadOrchestrator.subscribe({ onComplete, onError }), [onComplete, onError])

  const session = !officeShelf && !personalShelf && !projectId
  const previousCollection = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (collectionName === previousCollection.current) return
    void UploadOrchestrator.handleSessionChange(collectionName, session ? 'session' : 'corpus')
    previousCollection.current = collectionName
  }, [collectionName, session])

  const knowledgeLayerAvailable = useLayoutStore((state) => state.knowledgeLayerAvailable)
  useEffect(() => {
    if (collectionName) void UploadOrchestrator.loadFilesForSession(collectionName)
  }, [knowledgeLayerAvailable, collectionName])

  const shelf = useMemo<LiveShelf | null>(
    () =>
      officeShelf
        ? { kind: 'office_shelf' }
        : personalShelf
          ? { kind: 'personal', userId: personalShelf }
          : projectId
            ? { kind: 'project', projectId }
            : null,
    [officeShelf, personalShelf, projectId]
  )
  const reading = useDocumentsStore(
    (state) => state.isPolling || state.trackedFiles.some((file) => file.status === 'ingesting')
  )
  useShelfLive(shelf, () => UploadOrchestrator.askNow(), { enabled: reading })
}

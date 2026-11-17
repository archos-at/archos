'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listProjectUploads, type UploadHistoryEntry } from '@/adapters/api/upload-batches-client'

export type ProjectUploadsState =
  | { status: 'loading' }
  | {
      status: 'ready'
      uploads: UploadHistoryEntry[]
      nextCursor: string | null
      more: 'idle' | 'loading' | 'error'
    }
  | { status: 'error' }

export function useProjectUploads(projectId: string): {
  state: ProjectUploadsState
  retry: () => void
  loadMore: () => void
} {
  const [state, setState] = useState<ProjectUploadsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'loading' })
    listProjectUploads(projectId, { signal: controller.signal })
      .then(({ uploads, nextCursor }) => setState({ status: 'ready', uploads, nextCursor, more: 'idle' }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [projectId, attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.nextCursor || state.more === 'loading') return
    const controller = controllerRef.current
    const cursor = state.nextCursor
    setState({ ...state, more: 'loading' })
    listProjectUploads(projectId, { cursor, signal: controller?.signal })
      .then((page) =>
        setState((current) =>
          current.status === 'ready' && current.nextCursor === cursor
            ? { status: 'ready', uploads: [...current.uploads, ...page.uploads], nextCursor: page.nextCursor, more: 'idle' }
            : current
        )
      )
      .catch(() => {
        if (controller?.signal.aborted) return
        setState((current) => (current.status === 'ready' ? { ...current, more: 'error' } : current))
      })
  }, [projectId, state])

  return { state, retry, loadMore }
}

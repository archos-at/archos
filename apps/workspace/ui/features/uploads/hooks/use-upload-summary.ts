'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '@/adapters/api/api-error'
import { getProjectName, getUploadSummary, type UploadSummary } from '@/adapters/api/upload-batches-client'
import { isSettling } from '../lib/upload-summary'
import { useDocumentsGeneration } from '@/lib/documents/document-changes'

export const UPLOAD_SUMMARY_POLL_MS = 10_000

export type UploadSummaryState =
  | { status: 'loading' }
  | { status: 'ready'; summary: UploadSummary }
  | { status: 'not-found' }
  | { status: 'error' }

export function useUploadSummary(
  batchId: string,
  pollMs: number = UPLOAD_SUMMARY_POLL_MS
): { state: UploadSummaryState; retry: () => void } {
  const [state, setState] = useState<UploadSummaryState>({ status: 'loading' })
  const [answers, setAnswers] = useState(0)

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const summary = await getUploadSummary(batchId, signal)
        setState({ status: 'ready', summary })
      } catch (error) {
        if (signal.aborted) return
        const notFound = error instanceof ApiRequestError && error.status === 404
        setState((previous) =>
          notFound ? { status: 'not-found' } : previous.status === 'ready' ? previous : { status: 'error' }
        )
      }
      if (!signal.aborted) setAnswers((count) => count + 1)
    },
    [batchId]
  )

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const generation = useDocumentsGeneration()
  const seenGeneration = useRef(generation)
  useEffect(() => {
    if (generation === seenGeneration.current) return
    seenGeneration.current = generation
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [generation, load])

  const settling = state.status === 'ready' && isSettling(state.summary)
  useEffect(() => {
    if (!settling) return
    const controller = new AbortController()
    const timer = setTimeout(() => void load(controller.signal), pollMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [settling, answers, load, pollMs])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void load(new AbortController().signal)
  }, [load])

  return { state, retry }
}

export function useProjectName(projectId: string | null): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    setName(null)
    if (!projectId) return
    const controller = new AbortController()
    getProjectName(projectId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setName(value)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [projectId])
  return name
}

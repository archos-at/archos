'use client'

import { useCallback, useEffect, useState } from 'react'
import { capturePosthog } from '@/lib/analytics/posthog'
import { fetchSimilarPassages, SimilarPassagesError, type SimilarPassagesFailure } from '@/lib/similar-passages/client'
import type {
  SimilarGroupKind,
  SimilarPassagesRequest,
  SimilarPassagesResponse,
} from '@/lib/similar-passages/types'
import { similarDocumentsOf } from '@/lib/similar-passages/types'
import { documentFileUrl } from '@/lib/documents/urls'

export type SimilarPassagesLoader = (
  request: SimilarPassagesRequest,
  signal: AbortSignal
) => Promise<SimilarPassagesResponse>

export const loadSimilarPassages: SimilarPassagesLoader = (request, signal) =>
  fetchSimilarPassages(request, { signal })

export type SimilarPassagesState =
  | { status: 'loading' }
  | { status: 'ready'; response: SimilarPassagesResponse }
  | { status: 'error'; failure: SimilarPassagesFailure }

export function useSimilarPassages(
  request: SimilarPassagesRequest,
  load: SimilarPassagesLoader = loadSimilarPassages
): { state: SimilarPassagesState; retry: () => void } {
  const [state, setState] = useState<SimilarPassagesState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify(request)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    load(JSON.parse(key) as SimilarPassagesRequest, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setState({ status: 'ready', response })
        capturePosthog('similar_passages_searched', {
          entry: (JSON.parse(key) as SimilarPassagesRequest).passage.cited ? 'citation' : 'selection',
          origin: response.origin,
          groups: response.groups.length,
          documents: similarDocumentsOf(response).length,
          projects_searched: response.projectsSearched,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: error instanceof SimilarPassagesError ? error.reason : 'failed' })
      })
    return () => controller.abort()
  }, [key, load, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}

export interface OpenedPassage {
  key: string
  documentId: string
  filename: string
  title: string
  contentType: string | null
  page: number | null
  snippet: string
  groupKind: SimilarGroupKind
  groupLabel: string
  rank: number
}

export interface SimilarStage {
  src: string
  fileName: string
  title: string
  page: number | null
  highlight: string
  isImage: boolean
}

export type DocumentSrcOf = (documentId: string) => string

export const stageOf = (opened: OpenedPassage, srcOf: DocumentSrcOf = documentFileUrl): SimilarStage => ({
  src: srcOf(opened.documentId),
  fileName: opened.filename,
  title: opened.title,
  page: opened.page,
  highlight: opened.snippet,
  isImage: (opened.contentType ?? '').toLowerCase().startsWith('image/'),
})

export function useSimilarPassagesViewer(): {
  request: SimilarPassagesRequest | null
  opened: OpenedPassage | null
  start: (request: SimilarPassagesRequest) => void
  open: (passage: OpenedPassage) => void
  backToSource: () => void
  close: () => void
} {
  const [request, setRequest] = useState<SimilarPassagesRequest | null>(null)
  const [opened, setOpened] = useState<OpenedPassage | null>(null)

  const start = useCallback((next: SimilarPassagesRequest) => {
    setRequest(next)
    setOpened(null)
  }, [])
  const open = useCallback((passage: OpenedPassage) => {
    setOpened(passage)
    capturePosthog('similar_passage_opened', { group: passage.groupKind, rank: passage.rank })
  }, [])
  const backToSource = useCallback(() => setOpened(null), [])
  const close = useCallback(() => {
    setRequest(null)
    setOpened(null)
  }, [])
  return { request, opened, start, open, backToSource, close }
}

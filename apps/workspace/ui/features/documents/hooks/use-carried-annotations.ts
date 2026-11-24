'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnnotationRequestError, listAnnotations } from '@/lib/annotations/client'
import type { RevisionRef } from '@/lib/documents/revision-links'
import type { CarriedGroup, ReviewRevision } from '../lib/review-types'
import type { CanvasAskState } from './use-canvas-ask'

export const CARRY_GROUPS_MAX = 3

export function useCarriedAnnotations({
  enabled,
  documentId,
  revision,
  canvas,
}: {
  enabled: boolean
  documentId: string
  revision?: ReviewRevision | null
  canvas: Pick<CanvasAskState, 'asks'>
}) {
  const [carried, setCarried] = useState<CarriedGroup[]>([])
  const sourcesKey = JSON.stringify(
    revision?.replacedBy
      ? []
      : (revision?.replaces ?? []).slice(0, CARRY_GROUPS_MAX).map(({ id, filename }) => ({ id, filename }))
  )
  const sources = useMemo(() => JSON.parse(sourcesKey) as RevisionRef[], [sourcesKey])
  const carriedRead = useRef(0)
  const fetchCarried = useCallback(async () => {
    const ticket = ++carriedRead.current
    const groups = await Promise.all(
      sources.map(async (from): Promise<CarriedGroup> => {
        const listed = await listAnnotations(from.id).catch((error: unknown) =>
          error instanceof AnnotationRequestError && error.status === 404 ? { annotations: [] } : null
        )
        if (!listed) return { from, annotations: [], load: 'error' }
        const open = listed.annotations.filter((annotation) => annotation.status === 'open')
        return { from, annotations: open, load: 'ready' }
      })
    )
    if (carriedRead.current === ticket) {
      setCarried(groups.filter((group) => group.load === 'error' || group.annotations.length > 0))
    }
  }, [sources])
  const retryCarried = useCallback(() => void fetchCarried(), [fetchCarried])
  const checking = useRef(new Set<string>())
  useEffect(() => {
    let ended = false
    for (const ask of canvas.asks) {
      if (!ask.checkFixed || ask.checkFixed.documentId === documentId) continue
      if (ask.status === 'thinking') checking.current.add(ask.id)
      else if (checking.current.delete(ask.id)) ended = true
    }
    if (ended) void fetchCarried()
  }, [canvas.asks, documentId, fetchCarried])
  useEffect(() => {
    if (!enabled) return
    setCarried([])
    void fetchCarried()
    return () => {
      carriedRead.current += 1
    }
  }, [enabled, documentId, fetchCarried])

  return { carried, fetchCarried, retryCarried }
}

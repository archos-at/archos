'use client'

import { useCallback, useEffect, useState } from 'react'
import { getAnnotation } from '@/lib/annotations/client'
import type { AnnotationView } from '@/lib/annotations/types'
import { isMarkAnchored, type InboxItemView } from '@/lib/inbox/types'

export type InboxMarkLoad = (documentId: string, annotationId: string) => Promise<AnnotationView>

export interface InboxMark {
  mark: AnnotationView | null
  loading: boolean
  failed: boolean
  replace: (mark: AnnotationView) => void
}

export function markOf(item: InboxItemView): { documentId: string; annotationId: string } | null {
  if (!isMarkAnchored(item.type) || item.resourceType !== 'document' || !item.anchorId || !item.href) return null
  if (item.state === 'inert') return null
  return { documentId: item.resourceId, annotationId: item.anchorId }
}

export function useInboxMark(item: InboxItemView, load: InboxMarkLoad = getAnnotation): InboxMark {
  const target = markOf(item)
  const documentId = target?.documentId ?? null
  const annotationId = target?.annotationId ?? null
  const [mark, setMark] = useState<AnnotationView | null>(null)
  const [loading, setLoading] = useState(target !== null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setMark(null)
    setFailed(false)
    if (!documentId || !annotationId) {
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    load(documentId, annotationId)
      .then((found) => {
        if (live) setMark(found)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [documentId, annotationId, load])

  const replace = useCallback((next: AnnotationView) => setMark(next), [])
  return { mark, loading, failed, replace }
}

'use client'

/**
 * A Skizze in its review, for the `/dev/sketch-*` previews: the real
 * `DocumentReviewMode` with the real sketch stage, the review read from an
 * in-page stand-in for the annotations route (the marks given here), and the
 * room on a transport the page chooses (a `BroadcastChannel` between tabs, or
 * a room of one). `GET /api/documents/{id}/sketch` is answered here when the
 * page gives the Skizze (`sketch`), else by the page's own stand-in.
 */

import { useEffect, useState } from 'react'
import type { AnnotationView } from '@/lib/annotations/types'
import type { RoomTransport } from '@/features/documents/document-room'
import { DocumentReviewMode } from '@/features/documents/components/review/document-review'
import { useDocumentReview } from '@/features/documents/hooks/use-document-review'
import { SketchStage } from '@/features/diagrams/sketch/sketch-stage'

/** A room of one: the welcome, and every post dropped. */
export const roomOfOne = (self: { userId: string; name: string }): RoomTransport => ({
  connect({ onFrame, onOpen }) {
    queueMicrotask(() => {
      onFrame({ kind: 'welcome', self: { ...self, kind: 'person' } })
      onOpen()
    })
    return () => {}
  },
  post: () => {},
})

/** The annotations route of one document (and its sketch, when given), from memory; the rest goes on to the page's stand-ins. */
function useDocumentRoutes(documentId: string, annotations: readonly AnnotationView[], sketch: object | null) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const original = window.fetch
    const base = `/api/documents/${documentId}`
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, window.location.href).pathname
      if ((init?.method ?? 'GET') === 'GET') {
        if (path === `${base}/annotations`) return json({ annotations, canAnnotate: true, pilotiWakes: false })
        if (path === `${base}/sketch` && sketch) return json(sketch)
      }
      return original(input, init)
    }
    setReady(true)
    return () => {
      window.fetch = original
    }
  }, [documentId, annotations, sketch])
  return ready
}

export function DevSketchReview({
  documentId,
  documentName,
  revisionLabel = null,
  transport,
  annotations = [],
  sketch = null,
  open,
  onOpenChange,
}: {
  documentId: string
  documentName: string
  revisionLabel?: string | null
  transport: RoomTransport
  annotations?: readonly AnnotationView[]
  /** What `GET …/sketch` answers, when the page has no stand-in of its own for it. */
  sketch?: object | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const ready = useDocumentRoutes(documentId, annotations, sketch)
  const review = useDocumentReview(documentId, { enabled: ready, transport })
  return (
    <DocumentReviewMode
      open={open && ready}
      onOpenChange={onOpenChange}
      review={review}
      documentName={documentName}
      revisionLabel={revisionLabel}
      canPickAssignee={false}
      stage={(slots) => <SketchStage {...slots} documentId={documentId} review={review} canPickAssignee={false} onChanged={() => {}} />}
    />
  )
}

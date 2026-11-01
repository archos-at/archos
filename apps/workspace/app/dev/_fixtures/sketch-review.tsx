'use client'

/**
 * A Skizze in its review, for the `/dev/sketch-*` previews: the real
 * `DocumentReviewMode` with the real sketch stage, the review read from an
 * in-page stand-in for the annotations route (the marks given here), and the
 * room on a transport the page chooses (a `BroadcastChannel` between tabs, or
 * a room of one). The page answers `GET /api/documents/{id}/sketch` itself.
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

/** The annotations route of one document, from memory; everything else goes on to the page's own stand-ins. */
function useAnnotationsRoute(documentId: string, annotations: readonly AnnotationView[]) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const original = window.fetch
    const path = `/api/documents/${documentId}/annotations`
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, window.location.href).pathname === path && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ annotations, canAnnotate: true, pilotiWakes: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return original(input, init)
    }
    setReady(true)
    return () => {
      window.fetch = original
    }
  }, [documentId, annotations])
  return ready
}

export function DevSketchReview({
  documentId,
  documentName,
  revisionLabel = null,
  transport,
  annotations = [],
  open,
  onOpenChange,
}: {
  documentId: string
  documentName: string
  revisionLabel?: string | null
  transport: RoomTransport
  annotations?: readonly AnnotationView[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const ready = useAnnotationsRoute(documentId, annotations)
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

import type { AnnotationShape, AnnotationView } from '@/lib/annotations/types'
import type { RevisionRef } from '@/lib/documents/revision-links'

export type ReviewTool = 'select' | 'point' | 'region' | 'ask'
export type ReviewFilter = 'open' | 'closed'

export interface ReviewRevision {
  replacedBy: RevisionRef | null
  replaces: readonly RevisionRef[]
}

export interface CarriedGroup {
  from: RevisionRef
  annotations: AnnotationView[]
  load: 'ready' | 'error'
}

export interface ReviewDraft {
  page: number
  shape: AnnotationShape
  x: number
  y: number
  w: number | null
  h: number | null
}

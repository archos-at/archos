import { AnnotationRequestError, updateAnnotation } from '@/lib/annotations/client'
import type { LiveMarks } from '../../hooks/use-canvas-document'

export type AnswerOutcome = 'done' | 'moved' | 'gone' | 'forbidden' | 'failed'

export async function answerMark(
  documentId: string,
  annotationId: string,
  status: 'open' | 'dismissed',
  live: LiveMarks
): Promise<AnswerOutcome> {
  try {
    live.adopt(await updateAnnotation(documentId, annotationId, { status, expectedStatus: 'proposed' }))
    return 'done'
  } catch (failure) {
    if (!(failure instanceof AnnotationRequestError)) return 'failed'
    if (failure.status === 409) return 'moved'
    if (failure.status === 403) return 'forbidden'
    if (failure.status === 404) {
      live.forget(annotationId)
      return 'gone'
    }
    return 'failed'
  }
}

import { agentRepliedSince, replyIsForAgent, type AnnotationReplyView, type AnnotationView } from '@/lib/annotations/types'
import type { DocumentReview } from '../hooks/use-document-review'

export function takenUpByAgent(annotation: AnnotationView, reply: AnnotationReplyView, asking: boolean): boolean {
  if (!replyIsForAgent(annotation, reply)) return false
  if (asking || agentRepliedSince(annotation.replies, reply)) return true
  const work = annotation.pilotiWork
  return Boolean(
    work && (work.state === 'queued' || work.state === 'working') && work.trigger !== 'assigned' && work.forUserId === reply.createdBy
  )
}

export const agentAskingIn = (review: DocumentReview, annotationId: string): boolean =>
  review.piloti.asks.some((ask) => ask.replyInThread && ask.annotationId === annotationId && ask.status === 'thinking')

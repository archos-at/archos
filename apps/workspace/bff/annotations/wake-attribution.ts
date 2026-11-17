import type { AnnotationRecord } from './repository'
import type { AgentWakeTrigger } from './types'
import { listAnsweringWakes, type WakeSpanRow } from './wake-repository'

export type WakeSpan = WakeSpanRow

export function wakeOfReply(
  reply: { annotationId: string; authorKind: 'person' | 'piloti'; createdBy: string; createdAt: Date | string },
  spans: readonly WakeSpan[]
): AgentWakeTrigger | null {
  if (reply.authorKind !== 'piloti') return null
  const at = new Date(reply.createdAt).getTime()
  const span = spans.find(
    (candidate) =>
      candidate.annotationId === reply.annotationId &&
      candidate.actorUserId === reply.createdBy &&
      candidate.createdAt.getTime() <= at &&
      (candidate.endedAt === null || at <= candidate.endedAt.getTime())
  )
  return span?.triggerKind ?? null
}

export async function wakeSpansFor(
  organizationId: string,
  documentId: string,
  records: ReadonlyArray<Pick<AnnotationRecord, 'replies'>>
): Promise<WakeSpan[]> {
  const anyAgentReply = records.some((record) => record.replies.some((reply) => reply.authorKind === 'piloti'))
  return anyAgentReply ? listAnsweringWakes(organizationId, documentId).catch(() => []) : []
}

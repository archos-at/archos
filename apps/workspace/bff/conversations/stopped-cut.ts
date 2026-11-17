import { v5 as uuidv5 } from 'uuid'
import type { Message } from '@/lib/db/schema/messages'
import { ConflictError } from '@/lib/api/errors'
import { holdsNoMoreThan, sharedPrefixChars, stoppedAnswer } from '@/lib/turns/stopped-answer'

export const STOP_CUT_WINDOW_MS = 10 * 60_000

export const answerMessageId = (conversationId: string, turnId: string): string =>
  uuidv5(`grid:assistant:${conversationId}:${turnId}`, uuidv5.URL)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const storedAsStopped = (metadata: Record<string, unknown>): boolean =>
  metadata.stopped === true || (isRecord(metadata.provenance) && metadata.provenance.stopped === true)

const answeredElsewhere = (metadata: Record<string, unknown>): boolean =>
  metadata.run !== undefined || metadata.job_admission_rejected === true

export const cutStoppedRow = (
  existing: Message,
  shown: string,
  now: number
): { content: string; metadata: Record<string, unknown> } | null => {
  const metadata = isRecord(existing.metadata) ? existing.metadata : {}
  if (existing.role !== 'assistant' || existing.runId || answeredElsewhere(metadata)) {
    throw new ConflictError('Only a chat answer can be stopped.', { reason: 'not_an_answer' })
  }
  if (now - new Date(existing.createdAt).getTime() > STOP_CUT_WINDOW_MS) {
    throw new ConflictError('This answer can no longer be stopped.', { reason: 'too_late' })
  }
  if (storedAsStopped(metadata) && holdsNoMoreThan(existing.content, shown)) return null

  const cards: unknown[] = Array.isArray(metadata.cards) ? metadata.cards : []
  const citations = metadata.citations === undefined ? [] : [metadata.citations]
  const kept = stoppedAnswer(
    { text: existing.content, settled: existing.content, sources: citations, cards },
    sharedPrefixChars(existing.content, shown)
  )
  if (!kept.text && kept.cards.length === 0) {
    throw new ConflictError('Nothing of this answer was on screen to keep.', { reason: 'nothing_shown' })
  }
  const { cards: _cards, citations: _citations, ...rest } = metadata
  const provenance = isRecord(metadata.provenance) ? metadata.provenance : {}
  return {
    content: kept.text,
    metadata: {
      ...rest,
      ...(kept.cards.length > 0 && { cards: kept.cards }),
      ...(kept.sources.length > 0 && { citations: metadata.citations }),
      provenance: { ...provenance, stopped: true },
    },
  }
}

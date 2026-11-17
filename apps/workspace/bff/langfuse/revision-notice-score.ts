import 'server-only'

import { langfuseApiConfig } from './config'
import { upsertScore } from './feedback-score'

export const REVISION_NOTICE_SCORE_NAME = 'revision-notice'

type ScoreRequest = Parameters<typeof upsertScore>[2]

export function toRevisionNoticeScore(input: {
  noticeId: string
  traceId: string
  proposed: number
  pagesCompared: number
  pagesChanged: number
}): ScoreRequest {
  return {
    id: `${REVISION_NOTICE_SCORE_NAME}-${input.noticeId}`,
    traceId: input.traceId,
    name: REVISION_NOTICE_SCORE_NAME,
    dataType: 'NUMERIC',
    value: input.proposed,
    metadata: {
      notice_id: input.noticeId,
      pages_compared: input.pagesCompared,
      pages_changed: input.pagesChanged,
    },
  }
}

export async function recordRevisionNoticeScore(input: {
  noticeId: string
  traceId: string | null
  proposed: number
  pagesCompared: number
  pagesChanged: number
}): Promise<void> {
  const config = langfuseApiConfig()
  if (!config || !input.traceId) return
  const score = toRevisionNoticeScore({ ...input, traceId: input.traceId })
  try {
    await upsertScore(config, String(score.id), score)
  } catch (error) {
    console.warn(`[Langfuse] revision-notice score failed for ${input.noticeId} (non-fatal):`, error)
  }
}

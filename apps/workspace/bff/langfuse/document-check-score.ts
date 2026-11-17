import 'server-only'

import { langfuseApiConfig } from './config'
import { upsertScore } from './feedback-score'

export const DOCUMENT_CHECK_SCORE_NAME = 'document-check'

type ScoreRequest = Parameters<typeof upsertScore>[2]

export function toDocumentCheckScore(input: { checkId: string; traceId: string; findings: number }): ScoreRequest {
  return {
    id: `${DOCUMENT_CHECK_SCORE_NAME}-${input.checkId}`,
    traceId: input.traceId,
    name: DOCUMENT_CHECK_SCORE_NAME,
    dataType: 'NUMERIC',
    value: input.findings,
    metadata: { check_id: input.checkId },
  }
}

export async function recordDocumentCheckScore(input: {
  checkId: string
  traceId: string | null
  findings: number
}): Promise<void> {
  const config = langfuseApiConfig()
  if (!config || !input.traceId) return
  const score = toDocumentCheckScore({ ...input, traceId: input.traceId })
  try {
    await upsertScore(config, String(score.id), score)
  } catch (error) {
    console.warn(`[Langfuse] document-check score failed for ${input.checkId} (non-fatal):`, error)
  }
}

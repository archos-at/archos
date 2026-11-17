import 'server-only'

import type { LangfuseClient } from '@langfuse/client'
import { withTenant } from '@/lib/db/tenant-context'
import { getAnswerTraceId } from '@/lib/feedback/repository'
import { langfuseApiConfig } from './config'
import { upsertScore } from './feedback-score'

export const DIAGRAM_SCORE_NAME = 'diagram-filed'

type ScoreRequest = Parameters<LangfuseClient['api']['scores']['create']>[0]

export interface DiagramScoreInput {
  organizationId: string
  answerId: string | null
  documentId: string
  edited: boolean
}

export function diagramScoreId(documentId: string): string {
  return `${DIAGRAM_SCORE_NAME}-${documentId}`
}

export function toDiagramScore(input: { traceId: string; documentId: string; edited: boolean }): ScoreRequest {
  return {
    id: diagramScoreId(input.documentId),
    traceId: input.traceId,
    name: DIAGRAM_SCORE_NAME,
    dataType: 'CATEGORICAL',
    value: input.edited ? 'edited' : 'as_drawn',
    metadata: { document_id: input.documentId },
  }
}

export async function recordDiagramScore(input: DiagramScoreInput): Promise<void> {
  const config = langfuseApiConfig()
  if (!config || !input.answerId) return
  const answerId = input.answerId
  try {
    const traceId = await withTenant({ organizationId: input.organizationId }, () =>
      getAnswerTraceId(answerId, input.organizationId)
    )
    if (!traceId) return
    await upsertScore(config, diagramScoreId(input.documentId), toDiagramScore({ ...input, traceId }))
  } catch (error) {
    console.warn(`[Langfuse] diagram score failed for ${input.documentId} (non-fatal):`, error)
  }
}

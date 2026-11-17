import 'server-only'

import type { LangfuseClient } from '@langfuse/client'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { pilotiChanges } from '@/lib/db/schema/piloti-changes'
import { getAnswerTraceId } from '@/lib/feedback/repository'
import { findProposedChange } from '@/lib/proposals/repository'
import { langfuseApiConfig } from './config'
import { upsertScore } from './feedback-score'

export type DecisionSubject = 'proposal' | 'annotation' | 'change' | 'intake_suggestion' | 'inbound_mail_suggestion'
export type Decision = 'accepted' | 'dismissed' | 'undone'

export const DECISION_SCORE_NAME = 'piloti-decision'


type ScoreRequest = Parameters<LangfuseClient['api']['scores']['create']>[0]

export interface DecisionScoreInput {
  organizationId: string
  subject: DecisionSubject
  subjectId: string
  decision: Decision
  decidedBy: string
  origin?: { conversationId: string; messageId: string } | null
  traceId?: string | null
  detail?: Readonly<Record<string, string>>
}

export function decisionScoreId(subject: DecisionSubject, subjectId: string): string {
  return `${DECISION_SCORE_NAME}-${subject}-${subjectId}`
}

export function toDecisionScore(input: {
  traceId: string
  subject: DecisionSubject
  subjectId: string
  decision: Decision
  detail?: Readonly<Record<string, string>>
}): ScoreRequest {
  return {
    id: decisionScoreId(input.subject, input.subjectId),
    traceId: input.traceId,
    name: DECISION_SCORE_NAME,
    dataType: 'CATEGORICAL',
    value: input.decision,
    metadata: { ...input.detail, subject: input.subject, subject_id: input.subjectId },
  }
}

async function changeOriginMessage(
  organizationId: string,
  where: ReturnType<typeof and>
): Promise<string | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select({ messageId: pilotiChanges.originMessageId })
      .from(pilotiChanges)
      .where(where)
      .orderBy(asc(pilotiChanges.createdAt))
      .limit(1)
  )
  return row?.messageId ?? null
}

async function originMessageId(input: DecisionScoreInput): Promise<string | null> {
  if (input.origin?.messageId) return input.origin.messageId
  const org = eq(pilotiChanges.organizationId, input.organizationId)
  switch (input.subject) {
    case 'proposal':
      return (await findProposedChange(input.organizationId, input.subjectId))?.originMessageId ?? null
    case 'annotation':
      return changeOriginMessage(
        input.organizationId,
        and(org, eq(pilotiChanges.annotationId, input.subjectId), eq(pilotiChanges.op, 'create'))
      )
    case 'change':
      return changeOriginMessage(input.organizationId, and(org, eq(pilotiChanges.id, input.subjectId)))
    case 'intake_suggestion':
    case 'inbound_mail_suggestion':
      return null
  }
}

async function producingTraceId(input: DecisionScoreInput): Promise<string | null> {
  if (input.traceId) return input.traceId
  const messageId = await originMessageId(input)
  if (!messageId) return null
  return withTenant({ organizationId: input.organizationId }, () => getAnswerTraceId(messageId, input.organizationId))
}

export async function recordDecisionScore(input: DecisionScoreInput): Promise<void> {
  const config = langfuseApiConfig()
  if (!config) return
  try {
    const traceId = await producingTraceId(input)
    if (!traceId) return
    await upsertScore(config, decisionScoreId(input.subject, input.subjectId), toDecisionScore({ ...input, traceId }))
  } catch (error) {
    console.warn(`[Langfuse] decision score failed for ${input.subject} ${input.subjectId} (non-fatal):`, error)
  }
}

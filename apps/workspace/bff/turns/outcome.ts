import 'server-only'
import { onWakeEnded } from '@/lib/annotations/attention'
import { auditWakeEnded } from '@/lib/annotations/wake-audit'
import { findDocumentAnnotation } from '@/lib/annotations/repository'
import { delegationEventId, documentThreadConversationId } from '@/lib/annotations/wake-ids'
import {
  endWake,
  findWakeById,
  handBackDelegation,
  type WakeEnd,
} from '@/lib/annotations/wake-repository'
import { getDb } from '@/lib/db'
import type { AgentWakeRow } from '@/lib/db/schema/document-annotations'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { memberReader } from '@/lib/documents/document-reader'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { announceAgentWork } from '@/lib/annotations/agent-work'
import { recordAskOutcome } from '@/lib/agent-asks/service'
import type { TurnOutcomeRequest, TurnOutcomeResponse } from './outcome-types'

export const DEFAULT_FAILURE_REASON = 'the turn ended without an answer'

export function wakeEndOf(request: Pick<TurnOutcomeRequest, 'outcome' | 'reason'>): WakeEnd {
  switch (request.outcome) {
    case 'answered':
    case 'handed_off':
      return { status: 'answered' }
    case 'stopped':
      return { status: 'stopped' }
    case 'refused':
    case 'failed':
      return { status: 'failed', reason: request.reason?.trim() || DEFAULT_FAILURE_REASON }
  }
}

const NOT_SETTLED: TurnOutcomeResponse = { settled: false }

async function endInTransaction(
  wake: AgentWakeRow,
  end: WakeEnd
): Promise<{ ended: AgentWakeRow; markNumber: number | null; markText: string | null; handedBack: boolean } | null> {
  const mark = await findDocumentAnnotation(wake.organizationId, wake.documentId, wake.annotationId)
  const delegatedAt = mark?.delegatedAt ? new Date(mark.delegatedAt) : null
  const ownsDelegation =
    wake.triggerKind === 'assigned' &&
    delegatedAt !== null &&
    delegationEventId(wake.annotationId, delegatedAt) === wake.eventId
  const db = getDb()
  return withTenant({ organizationId: wake.organizationId }, () =>
    db.transaction(async (tx) => {
      const ended = await endWake(tx, wake.organizationId, wake.id, end)
      if (!ended) return null
      const handedBack =
        ownsDelegation && delegatedAt
          ? await handBackDelegation(tx, wake.organizationId, wake.annotationId, delegatedAt)
          : false
      return { ended, markNumber: mark?.number ?? null, markText: mark?.body ?? null, handedBack }
    })
  )
}

async function wakeDocument(wake: AgentWakeRow) {
  try {
    return await findDocumentInOrg(wake.documentId, wake.organizationId, memberReader(wake.actorUserId))
  } catch (error) {
    console.error('[turns/outcome] could not read the document of a wake that ended:', error)
    return null
  }
}

async function afterEnd(
  wake: AgentWakeRow,
  end: WakeEnd,
  done: { markNumber: number | null; markText: string | null; handedBack: boolean },
  turnOutcome: TurnOutcomeRequest['outcome']
): Promise<void> {
  await announceAgentWork(wake)
  const doc = await wakeDocument(wake)
  auditWakeEnded(
    {
      organizationId: wake.organizationId,
      wakeId: wake.id,
      documentId: wake.documentId,
      annotationId: wake.annotationId,
      trigger: wake.triggerKind,
      wokenBy: { userId: wake.actorUserId, email: null },
      projectId: doc?.projectId ?? null,
      markNumber: done.markNumber,
    },
    {
      outcome: end.status,
      turnOutcome,
      reason: end.status === 'failed' ? end.reason : null,
      handedBack: done.handedBack,
    }
  )
  if (done.markNumber === null || !doc) return
  try {
    await onWakeEnded({
      organizationId: wake.organizationId,
      documentId: wake.documentId,
      annotationId: wake.annotationId,
      annotationNumber: done.markNumber,
      projectId: doc.projectId ?? null,
      actorUserId: wake.actorUserId,
      trigger: wake.triggerKind,
      outcome: end.status,
      reason: end.status === 'failed' ? end.reason : null,
      markText: done.markText,
    })
  } catch (error) {
    console.error('[turns/outcome] attention failed after a wake ended:', error)
  }
}

export async function recordTurnOutcome(request: TurnOutcomeRequest): Promise<TurnOutcomeResponse> {
  const wake = await withPlatformAccess(
    'turn outcome: the chat socket names a turn by id, before any organization is known',
    () => findWakeById(request.turnId)
  )
  if (!wake) return { settled: await recordAskOutcome(request) }
  if (wake.status !== 'started' && wake.status !== 'queued') return NOT_SETTLED
  if (request.conversationId !== documentThreadConversationId(wake.documentId, wake.actorUserId)) return NOT_SETTLED

  const end = wakeEndOf(request)
  const done = await endInTransaction(wake, end)
  if (!done) return NOT_SETTLED
  await afterEnd(done.ended, end, done, request.outcome)
  return { settled: true }
}

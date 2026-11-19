import 'server-only'

import type { LangfuseClient } from '@langfuse/client'
import { v5 as uuidv5 } from 'uuid'
import type { InboundMailDecisionVia } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { threadPreselection, type SenderEvidence, type ThreadMatch, type ThreadParticipation } from '@/lib/mail-thread/mail-threading'
import { langfuseApiConfig } from './config'
import { clientFor, deploymentTags, environment, release } from './tool-call-trace'

export const MAIL_THREAD_MATCH_SCORE_NAME = 'mail-thread-match'

export type MailThreadMatchValue = 'followed' | 'other_thread' | 'new_thread'

export type ThreadChoice = { action: 'append'; mailThreadId: string } | { action: 'create' }

export function mailThreadMatchValue(matches: readonly ThreadMatch[], choice: ThreadChoice): MailThreadMatchValue | null {
  const strongest = matches[0]
  if (!strongest) return null
  if (choice.action === 'create') return 'new_thread'
  return choice.mailThreadId === strongest.threadId ? 'followed' : 'other_thread'
}

export interface MailThreadMatchRecord {
  organizationId: string
  projectId: string
  mailId: string
  partId: string
  matches: readonly ThreadMatch[]
  sender: SenderEvidence
  strongestThread: ThreadParticipation | null
  choice: ThreadChoice
  via: InboundMailDecisionVia
  decidedAt: Date
}

type IngestionBatch = Parameters<LangfuseClient['api']['ingestion']['batch']>[0]

const derivedHexId = (name: string): string => uuidv5(name, uuidv5.URL).replace(/-/g, '')

export function mailThreadMatchIds(partId: string): { traceId: string; scoreId: string } {
  return {
    traceId: derivedHexId(`grid:mail-thread-match:${partId}`),
    scoreId: `${MAIL_THREAD_MATCH_SCORE_NAME}-${partId}`,
  }
}

export function mailThreadMatchBatch(record: MailThreadMatchRecord, eventIds: [string, string]): IngestionBatch | null {
  const value = mailThreadMatchValue(record.matches, record.choice)
  const strongest = record.matches[0]
  if (!value || !strongest) return null
  const { traceId, scoreId } = mailThreadMatchIds(record.partId)
  const { choice } = record
  const chosenRank = choice.action === 'append' ? record.matches.findIndex((match) => match.threadId === choice.mailThreadId) : -1
  const metadata = {
    mail_id: record.mailId,
    project_id: record.projectId,
    part_id: record.partId,
    strength: strongest.strength,
    preselected: threadPreselection(strongest, record.sender, record.strongestThread).preselected,
    candidates: record.matches.length,
    chosen_rank: chosenRank,
    sender_trust: record.sender.senderTrust,
    via: record.via,
  }
  const timestamp = record.decidedAt.toISOString()
  const env = environment()
  const rel = release()
  return {
    batch: [
      {
        type: 'trace-create',
        id: eventIds[0],
        timestamp,
        body: {
          id: traceId,
          timestamp,
          name: MAIL_THREAD_MATCH_SCORE_NAME,
          metadata,
          tags: ['feature:inbound-mail', `strength:${strongest.strength}`, `via:${record.via}`, ...deploymentTags()],
          ...(env ? { environment: env } : {}),
          ...(rel ? { release: rel } : {}),
        },
      },
      {
        type: 'score-create',
        id: eventIds[1],
        timestamp,
        body: {
          id: scoreId,
          traceId,
          name: MAIL_THREAD_MATCH_SCORE_NAME,
          dataType: 'CATEGORICAL',
          value,
          metadata,
          ...(env ? { environment: env } : {}),
        },
      },
    ],
  }
}

export async function recordMailThreadMatchScore(record: MailThreadMatchRecord): Promise<void> {
  const config = langfuseApiConfig()
  if (!config) return
  try {
    const batch = mailThreadMatchBatch(record, [crypto.randomUUID(), crypto.randomUUID()])
    if (!batch) return
    await clientFor(config).api.ingestion.batch(batch, { timeoutInSeconds: 5, maxRetries: 1 })
  } catch (error) {
    console.warn(`[Langfuse] mail-thread-match score failed for part ${record.partId} (non-fatal):`, error)
  }
}

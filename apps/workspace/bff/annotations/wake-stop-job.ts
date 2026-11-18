import 'server-only'
import type { JobAttempt, AgentWakeStopPayload } from '@/lib/jobs-queue/types'
import { cancelHeadlessTurn, chatSocketUrl } from '@/lib/turns/headless-turn'
import { HEADLESS_MODE_HEADERS } from '@/lib/turns/headless-mode'
import { turnContextHeaders } from '@/lib/turns/turn-headers.js'
import { documentThreadConversationId } from './wake-ids'
import { findWake } from './wake-repository'

export async function runAgentWakeStop(
  organizationId: string,
  payload: AgentWakeStopPayload,
  _attempt: JobAttempt
): Promise<void> {
  const wake = await findWake(organizationId, payload.wakeId)
  if (wake && wake.status !== 'started') return

  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) throw new Error('INTERNAL_API_TOKEN is not set: a stop cannot sign its socket')
  const conversationId = documentThreadConversationId(payload.documentId, payload.actorUserId)
  const outcome = await cancelHeadlessTurn({
    url: chatSocketUrl(conversationId),
    conversationId,
    turnId: payload.wakeId,
    headers: {
      ...turnContextHeaders({ organizationId, userId: payload.actorUserId, conversationId }, { issuedAt: Date.now(), secret }),
      ...HEADLESS_MODE_HEADERS,
    },
  })
  switch (outcome.kind) {
    case 'sent':
    case 'not_running':
      return
    case 'unavailable':
      throw new Error(`the stop of wake ${payload.wakeId} reached no server: ${outcome.reason}`)
    case 'rejected':
      throw new Error(
        `the chat socket refused the stop of wake ${payload.wakeId}: ${outcome.code}${outcome.message ? ` (${outcome.message})` : ''}`
      )
  }
}

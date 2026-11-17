/**
 * A turn's Herleitung, stored by the server and not only by the browser that
 * watched the turn.
 *
 * The Herleitung hangs on the QUESTION: its `provenance.thinkingSteps`, the
 * rows the fold makes of the step frames (`foldStep`, `foldSubagent`,
 * `foldSteer` in `./turn-fold`). The asker's browser stores the rows it folded
 * (`_persistTurnProvenance`). A turn nobody watched to its end (asked through
 * the agent door, woken by an event, a browser closed mid-turn) had no other
 * writer, so its answer reloaded without a Herleitung. The agent tier keeps the
 * frames of each row the fold needs and hands them over after the answer row
 * (`agent_host/turn_record.py`); this folds them with the browser's own fold
 * and stores the same shape through the same sanitizer, so the two writers
 * agree and either may land first.
 */

import 'server-only'
import { z } from 'zod'
import { parseWireEvent, type WireEvent } from '@/adapters/api/wire-v2'
import { NotFoundError } from '@/lib/api/errors'
import { sanitizeThinkingSteps, type StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { findConversationInOrg, findMessageInConversation, mergeMessageMetadata } from '@/lib/conversations/repository'
import type { Message } from '@/lib/db/schema/messages'
import { closeSteps, foldTurnEvents, initialTurnView } from './turn-fold'

/** The most frames one turn hands over: three per row (`MAX_STEP_FRAMES` in `turn_record.py`, held to this by the spec). */
export const MAX_TURN_STEP_FRAMES = 7200

/** `PUT /api/internal/conversations/{id}/messages/{turnId}/steps`. */
export const internalTurnStepsSchema = z
  .object({
    /** The conversation's organization, as on the answer row's write: the lookup is scoped by it. */
    organizationId: z.string().min(1),
    /** The wire frames as the socket sent them; each is parsed like a browser parses it, and one that does not parse is dropped. */
    frames: z.array(z.unknown()).max(MAX_TURN_STEP_FRAMES),
  })
  .strict()

/**
 * The rows the browser's fold makes of `frames`, in its order, every row
 * closed (the turn has ended). Pure.
 *
 * Only the frames that touch a step arrive, so their `seq` has holes the fold
 * would hold as a gap; they are numbered afresh in their order. A frame of
 * another turn, and a repeated `seq`, are dropped.
 */
export function foldedTurnSteps(conversationId: string, turnId: string, frames: readonly unknown[]): StoredThinkingStep[] {
  const events = frames
    .map(parseWireEvent)
    .filter((event): event is WireEvent => event !== null && event.turn_id === turnId)
    .sort((a, b) => a.seq - b.seq)
    .filter((event, index, sorted) => index === 0 || event.seq !== sorted[index - 1]!.seq)
    .map((event, index) => ({ ...event, seq: index + 1 }))
  const view = foldTurnEvents(initialTurnView(turnId, conversationId), events)
  if (!view) return []
  const steps = closeSteps(view.steps)
  return view.stepOrder.map((id) => steps[id]!)
}

/**
 * Store a finished turn's Herleitung on its question. Idempotent: the
 * question's `provenance.thinkingSteps` is replaced whole, which is what the
 * browser's own write does, so whichever lands last leaves one copy.
 *
 * 404 when the conversation is not in the organization, or `turnId` names no
 * question in it. A turn that took no step writes nothing.
 */
export async function recordTurnSteps(
  organizationId: string,
  conversationId: string,
  turnId: string,
  frames: readonly unknown[]
): Promise<{ stored: number }> {
  // The session-less path's tenancy gate, as for the answer row.
  const conversation = await findConversationInOrg(conversationId, organizationId)
  if (!conversation) throw new NotFoundError()
  const question = await findMessageInConversation(conversationId, turnId)
  if (!question || question.role !== 'user') throw new NotFoundError()
  const thinkingSteps = sanitizeThinkingSteps(foldedTurnSteps(conversationId, turnId, frames))
  if (!thinkingSteps) return { stored: 0 }
  const row: Message | null = await mergeMessageMetadata(conversationId, turnId, { provenance: { thinkingSteps } }, [
    'provenance',
  ])
  if (!row) throw new NotFoundError()
  return { stored: thinkingSteps.length }
}

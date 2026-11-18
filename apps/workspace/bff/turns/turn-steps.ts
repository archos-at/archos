import 'server-only'
import { z } from 'zod'
import { parseWireEvent, type WireEvent } from '@/adapters/api/wire-v2'
import { NotFoundError } from '@/lib/api/errors'
import { sanitizeThinkingSteps, type StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { findConversationInOrg, findMessageInConversation, mergeMessageMetadata } from '@/lib/conversations/repository'
import type { Message } from '@/lib/db/schema/messages'
import { closeSteps, foldTurnEvents, initialTurnView } from './turn-fold'

export const MAX_TURN_STEP_FRAMES = 7200

export const internalTurnStepsSchema = z
  .object({
    organizationId: z.string().min(1),
    frames: z.array(z.unknown()).max(MAX_TURN_STEP_FRAMES),
  })
  .strict()

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

export async function recordTurnSteps(
  organizationId: string,
  conversationId: string,
  turnId: string,
  frames: readonly unknown[]
): Promise<{ stored: number }> {
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

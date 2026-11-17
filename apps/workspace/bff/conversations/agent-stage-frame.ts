/**
 * A post-answer stage's frame, made durable by the agent tier itself
 * (`docs/architecture/post-answer-stages.md` §11 risk 3).
 *
 * The browser stores a stage's output when its frame arrives
 * (`updateMessageDetail`), which holds only while a browser is attached to the
 * conversation's socket. A person who opens another chat before the stage
 * ends would see the note saved and never shown under its answer. So the
 * stage that SAVES something (memory reflection) also hands its frame to the
 * BFF, and this module stores it with the same sanitiser and the same merge
 * as the browser's PATCH: a frame arriving both ways is one write's content,
 * and the second write leaves the row as the first left it.
 *
 * Only the stages in {@link AGENT_DURABLE_STAGES} are accepted. This is not a
 * write of arbitrary metadata: the payload is reduced by `sanitizeStages` to
 * the closed shape a reader of the message already accepts from a browser.
 */

import { z } from 'zod'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import type { Message } from '@/lib/db/schema/messages'
import { sanitizeStages, type MessageStages } from './message-stages'
import { findConversationInOrg, findMessageInConversation, mergeMessageMetadata } from './repository'

/** The stages whose frame the agent tier writes itself: the ones that record a write the reader was promised. */
export const AGENT_DURABLE_STAGES = ['memory_reflection'] as const
export type AgentDurableStage = (typeof AGENT_DURABLE_STAGES)[number]

/** Where each lands in `metadata.stages`, the key the browser's PATCH writes too. */
const STAGE_KEYS: Record<AgentDurableStage, keyof MessageStages> = {
  memory_reflection: 'memoryReflection',
}

/** `PATCH /api/internal/conversations/{id}/messages/{messageId}/stages`. */
export const internalStageFrameSchema = z
  .object({
    stage: z.enum(AGENT_DURABLE_STAGES),
    /** The frame's `payload` as the socket carried it; bounded by `sanitizeStages`, never stored as sent. */
    payload: z.unknown(),
  })
  .strict()

export type InternalStageFrame = z.infer<typeof internalStageFrameSchema>

/**
 * Store one stage's frame on the answer it belongs to. Idempotent: the stage's
 * key is replaced whole, and every other metadata key and every other stage's
 * output is kept (`mergeMessageMetadata`, deep-merged on `stages`).
 *
 * 404 while the answer row does not exist (the agent host persists it in the
 * background, possibly after the stage); the caller retries. 400 when nothing
 * in the payload survives the sanitiser.
 */
export async function recordAgentStageFrame(
  organizationId: string,
  conversationId: string,
  messageId: string,
  frame: InternalStageFrame
): Promise<Message> {
  const stages = sanitizeStages({ [STAGE_KEYS[frame.stage]]: frame.payload })
  if (!stages) throw new BadRequestError('Nothing in the stage payload can be stored')
  // The session-less path's tenancy gate: the conversation, in the
  // organization the signed envelope names.
  const conversation = await findConversationInOrg(conversationId, organizationId)
  if (!conversation) throw new NotFoundError()
  // A stage follows an answer: a question or a prompt never carries one.
  const message = await findMessageInConversation(conversationId, messageId)
  if (!message || message.role !== 'assistant') throw new NotFoundError()
  const row = await mergeMessageMetadata(conversationId, messageId, { stages }, ['stages'])
  if (!row) throw new NotFoundError()
  return row
}

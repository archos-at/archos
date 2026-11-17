import { z } from 'zod'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import type { Message } from '@/lib/db/schema/messages'
import { sanitizeStages, type MessageStages } from './message-stages'
import { findConversationInOrg, findMessageInConversation, mergeMessageMetadata } from './repository'

export const AGENT_DURABLE_STAGES = ['memory_reflection'] as const
export type AgentDurableStage = (typeof AGENT_DURABLE_STAGES)[number]

const STAGE_KEYS: Record<AgentDurableStage, keyof MessageStages> = {
  memory_reflection: 'memoryReflection',
}

export const internalStageFrameSchema = z
  .object({
    stage: z.enum(AGENT_DURABLE_STAGES),
    payload: z.unknown(),
  })
  .strict()

export type InternalStageFrame = z.infer<typeof internalStageFrameSchema>

export async function recordAgentStageFrame(
  organizationId: string,
  conversationId: string,
  messageId: string,
  frame: InternalStageFrame
): Promise<Message> {
  const stages = sanitizeStages({ [STAGE_KEYS[frame.stage]]: frame.payload })
  if (!stages) throw new BadRequestError('Nothing in the stage payload can be stored')
  const conversation = await findConversationInOrg(conversationId, organizationId)
  if (!conversation) throw new NotFoundError()
  const message = await findMessageInConversation(conversationId, messageId)
  if (!message || message.role !== 'assistant') throw new NotFoundError()
  const row = await mergeMessageMetadata(conversationId, messageId, { stages }, ['stages'])
  if (!row) throw new NotFoundError()
  return row
}

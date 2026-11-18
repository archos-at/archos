import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { FEATURE_FLAGS, isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import type { Message } from '@/lib/db/schema/messages'
import { applyMessageMentions, threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { AddresseeSet, MentionInput, PersistedMessageResult } from '@/lib/mentions/types'
import type { EngagementState } from './engagement'
import { sanitizePromptDetail } from './message-prompt'
import { findMessageInConversation } from './repository'

export interface CreateMessageInput {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  messageType?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  mentions?: MentionInput[]
  mentionNote?: string | null
}

export interface PersistedMessage extends Message, PersistedMessageResult {}

const AGENT_ADDRESSED: AddresseeSet = { agent: true, users: [] }

const THREAD_ADDRESSED: AddresseeSet = { agent: false, users: [] }
export const NOBODY_ADDRESSED: AddresseeSet = { agent: false, users: [] }

const MENTION_EXCERPT_MAX = 280

export interface PreparedMessage {
  input: CreateMessageInput
  addressees: AddresseeSet | null
  createdRequests: number
}

export function buildMessageRow(
  conversationId: string,
  prepared: PreparedMessage,
  authorUserId: string | null
) {
  const { input } = prepared
  const {
    addressees: _clientRuling,
    prompt: clientPrompt,
    ...clientMetadata
  } = input.metadata ?? {}
  const prompt = sanitizePromptDetail(clientPrompt)
  return {
    id: input.id,
    conversationId,
    role: input.role,
    authorUserId: input.role === 'user' ? authorUserId : null,
    content: input.content,
    metadata: {
      ...clientMetadata,
      ...(prompt ? { prompt } : {}),
      ...(input.messageType ? { messageType: input.messageType } : {}),
      ...(prepared.addressees ? { addressees: prepared.addressees } : {}),
    },
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
  }
}

function storedAddressees(row: Message | null): AddresseeSet | null {
  const stored = (row?.metadata as { addressees?: unknown } | null)?.addressees
  if (!stored || typeof stored !== 'object') return null
  const candidate = stored as Partial<AddresseeSet>
  if (typeof candidate.agent !== 'boolean' || !Array.isArray(candidate.users)) return null
  return {
    agent: candidate.agent,
    users: candidate.users.filter((id): id is string => typeof id === 'string'),
  }
}

export async function prepareMessage(
  session: AuthorizedSession,
  conversationId: string,
  input: CreateMessageInput,
  context: { shared: boolean; engagement: () => Promise<EngagementState> }
): Promise<PreparedMessage> {
  if (input.role !== 'user') {
    return { input, addressees: null, createdRequests: 0 }
  }

  const mentions = input.mentions ?? []
  if (mentions.length === 0) {
    if (!context.shared) {
      return { input, addressees: AGENT_ADDRESSED, createdRequests: 0 }
    }

    if (await threadIsAwaitingHuman('conversation', conversationId)) {
      return { input, addressees: THREAD_ADDRESSED, createdRequests: 0 }
    }

    const { mode } = await context.engagement()
    return {
      input,
      addressees: mode === 'mention' ? THREAD_ADDRESSED : AGENT_ADDRESSED,
      createdRequests: 0,
    }
  }

  if (!isCollaborationEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.collaboration)

  const existing = storedAddressees(await findMessageInConversation(conversationId, input.id))
  if (existing) return { input, addressees: existing, createdRequests: 0 }

  const applied = await applyMessageMentions({
    session,
    resourceType: 'conversation',
    resourceId: conversationId,
    anchorId: input.id,
    mentions,
    note: input.mentionNote ?? input.content.slice(0, MENTION_EXCERPT_MAX) ?? null,
    excerpt: input.content.slice(0, MENTION_EXCERPT_MAX),
  })
  return { input, addressees: applied.addressees, createdRequests: applied.createdRequests }
}
